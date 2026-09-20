import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { execa } from "execa";
import type { CustomParamDef, CustomPortDef, ValueType } from "@threadle/shared";
import {
  PARAM_TYPES,
  paramValueError,
  validateCustomNodeManifest,
  valueTypeError,
} from "@threadle/shared";
import { threadleConfigDir } from "../graphs/store.js";
import { appendJobLog, jobs } from "../jobs.js";
import { pathContained } from "../path-safe.js";
import { childProcessEnv } from "../safe-env.js";
import { isReadablePath } from "../readable-paths.js";
import { assertPublicHttpUrl } from "../public-url.js";
import { LruMap } from "../lru.js";

/**
 * User-authored workflow nodes: ~/.config/threadle/nodes/<name>/node.json plus
 * whatever executable the manifest points at. Text in on stdin, text out on
 * stdout — any language, no code shipped into threadle's renderer.
 *
 * Manifests are local files the user placed themselves, so running them is
 * the same trust level as their shell. Commands are argv arrays (never a
 * shell string), cwd is the manifest's own directory, and runs are bounded
 * by a timeout and an output cap.
 *
 * CAVEAT (class nodes): reading a class node's metadata means IMPORTING the
 * file in a child process — top-level code in a class file executes when the
 * node list loads, not only on ▶. That probe runs with the allowlisted child
 * env. Anything that writes into nodes/ (import, upload, backup restore) is
 * therefore an execution decision and must be explicitly user-confirmed.
 */
export type { ValueType } from "@threadle/shared";
const VALUE_TYPES = new Set<string>(["text", "int", "float", "bool", "json"]);

export interface CustomNodeDef {
  /** stable identity referenced by graphs — node.json "id", else the directory name */
  name: string;
  /** the directory the node lives in (may differ from the id) */
  dir: string;
  /** "class" = TypeScript class entry file · "command" = argv manifest */
  kind: "class" | "command";
  label: string;
  glyph: string;
  description?: string;
  /** command flavor: argv array; relative argv[0] resolves against the manifest directory */
  command?: string[];
  /** class flavor: the module file */
  file?: string;
  timeoutMs: number;
  /** Value types for the single legacy ports (default text/text) */
  input: ValueType;
  output: ValueType;
  /** named ports — when present they supersede the scalar input/output */
  inputs?: CustomPortDef[];
  outputs?: CustomPortDef[];
  /** inspector-editable params (widgets on the node card) */
  params?: CustomParamDef[];
  /** manifest opted into the full parent environment */
  envInherit?: boolean;
}

interface Manifest {
  /** stable node identity; graphs reference this, not the folder name */
  id?: string;
  /** "inherit" opts into the full parent environment (API keys included!) — default is a minimal allowlist */
  env?: string;
  label?: string;
  glyph?: string;
  description?: string;
  /** class flavor: the file whose default export implements run(input, ctx) */
  entry?: string;
  command?: unknown;
  timeoutMs?: number;
  input?: string;
  output?: string;
  inputs?: unknown;
  outputs?: unknown;
  params?: unknown;
}

/** port and param names double as env-var suffixes and JSON keys — keep them tame */
const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/** normalize a manifest "inputs"/"outputs" array; returns an error string on bad shape */
function parsePortDefs(
  raw: unknown,
  side: "inputs" | "outputs",
): { ports?: CustomPortDef[]; error?: string } {
  if (!Array.isArray(raw) || !raw.length) {
    return { error: `"${side}" must be a non-empty array of { name, type? } objects` };
  }
  const ports: CustomPortDef[] = [];
  const seen = new Set<string>();
  for (const p of raw as Array<Record<string, unknown>>) {
    if (typeof p !== "object" || p === null || typeof p.name !== "string" || !NAME_RE.test(p.name)) {
      return { error: `every ${side} entry needs a "name" (letter first, then letters/digits/_/-)` };
    }
    if (seen.has(p.name)) return { error: `duplicate ${side} port "${p.name}"` };
    seen.add(p.name);
    const type = (p.type ?? "text") as string;
    if (!VALUE_TYPES.has(type)) {
      return { error: `${side} port "${p.name}": type must be one of text, int, float, bool, json` };
    }
    if (p.required !== undefined && (side === "outputs" || typeof p.required !== "boolean")) {
      return { error: `${side} port "${p.name}": "required" must be a boolean on an input port` };
    }
    let maxConnections: number | undefined;
    if (p.maxConnections !== undefined) {
      if (
        typeof p.maxConnections !== "number" ||
        !Number.isInteger(p.maxConnections) ||
        p.maxConnections < 1 ||
        p.maxConnections > 64
      ) {
        return {
          error: `${side} port "${p.name}": "maxConnections" must be an integer from 1 to 64`,
        };
      }
      maxConnections = p.maxConnections === 1 ? undefined : p.maxConnections;
    }
    ports.push({
      name: p.name,
      type: type as ValueType,
      required: side === "inputs" && p.required === false ? false : undefined,
      maxConnections,
    });
  }
  return { ports };
}

/** normalize a manifest "params" array; returns an error string on bad shape */
function parseParamDefs(raw: unknown): { params?: CustomParamDef[]; error?: string } {
  if (!Array.isArray(raw) || !raw.length) {
    return { error: `"params" must be a non-empty array of { name, type, ... } objects` };
  }
  const params: CustomParamDef[] = [];
  const seen = new Set<string>();
  for (const p of raw as Array<Record<string, unknown>>) {
    if (typeof p !== "object" || p === null || typeof p.name !== "string" || !NAME_RE.test(p.name)) {
      return { error: `every param needs a "name" (letter first, then letters/digits/_/-)` };
    }
    if (seen.has(p.name)) return { error: `duplicate param "${p.name}"` };
    seen.add(p.name);
    const type = (p.type ?? "text") as string;
    if (!PARAM_TYPES.includes(type as (typeof PARAM_TYPES)[number])) {
      return { error: `param "${p.name}": type must be one of ${PARAM_TYPES.join(", ")}` };
    }
    const def: CustomParamDef = { name: p.name, type: type as CustomParamDef["type"] };
    if (p.label !== undefined) {
      if (typeof p.label !== "string") return { error: `param "${p.name}": "label" must be a string` };
      def.label = p.label;
    }
    if (typeof p.description === "string") def.description = p.description;
    if (type === "choice") {
      if (!Array.isArray(p.options) || !p.options.length || !p.options.every((o) => typeof o === "string")) {
        return { error: `param "${p.name}": choice params need "options", a non-empty string array` };
      }
      def.options = p.options as string[];
    }
    for (const bound of ["min", "max"] as const) {
      if (p[bound] === undefined) continue;
      if (typeof p[bound] !== "number" || (type !== "int" && type !== "float")) {
        return { error: `param "${p.name}": "${bound}" is a number and only valid on int/float params` };
      }
      def[bound] = p[bound];
    }
    if (p.multiline !== undefined) {
      if (p.multiline !== true || type !== "text") {
        return { error: `param "${p.name}": "multiline" is only valid as true on text params` };
      }
      def.multiline = true;
    }
    if (p.default !== undefined) {
      // authors may write native JSON (numbers, booleans); values travel as strings
      const d =
        typeof p.default === "string"
          ? p.default
          : typeof p.default === "number" || typeof p.default === "boolean"
            ? String(p.default)
            : type === "json"
              ? JSON.stringify(p.default)
              : undefined;
      if (d === undefined) return { error: `param "${p.name}": "default" has an unsupported shape` };
      const bad = paramValueError(d, def);
      if (bad) return { error: `param "${p.name}": default ${bad}` };
      def.default = d;
    } else if (type === "choice") {
      def.default = def.options![0];
    }
    params.push(def);
  }
  return { params };
}

function cleanId(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

const MAX_TIMEOUT = 5 * 60_000;
const MAX_OUTPUT = 4 * 1024 * 1024;

/** custom-node runs currently executing as child processes */
let activeRuns = 0;
export function activeCustomRuns(): number {
  return activeRuns;
}

function nodesDir(): string {
  return path.join(threadleConfigDir(), "nodes");
}

/**
 * Class nodes execute in an isolated child process — metadata extraction
 * included, so user code never runs inside the threadle server itself. Node's
 * native type stripping loads the .ts file directly.
 */
const RUNNER = `
const [file, mode] = [process.argv[1], process.argv[2]];
const { pathToFileURL } = await import("node:url");
async function instantiate() {
  const mod = await import(pathToFileURL(file).href);
  const Cls = mod.default;
  if (!Cls) throw new Error("node.ts has no default export");
  const inst = typeof Cls === "function" ? new Cls() : Cls;
  if (typeof inst.run !== "function") throw new Error("node class has no run(input) method");
  return inst;
}
try {
  if (mode === "meta") {
    const n = await instantiate();
    process.stdout.write(JSON.stringify({
      label: n.label, glyph: n.glyph, description: n.description,
      input: n.input, output: n.output, timeoutMs: n.timeoutMs,
      inputs: n.inputs, outputs: n.outputs, params: n.params,
    }));
  } else {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    const ctx = { params: JSON.parse(process.env.THREADLE_PARAMS ?? "{}") };
    if (process.env.THREADLE_INPUTS_JSON === "1") {
      try { ctx.inputs = JSON.parse(raw); } catch {}
    }
    const n = await instantiate();
    const out = await n.run(raw, ctx);
    // named-output nodes may return the ports object directly
    process.stdout.write(typeof out === "string" ? out : out == null ? "" : JSON.stringify(out));
  }
} catch (err) {
  console.error((err && err.stack) || String(err));
  process.exit(1);
}
`;

function nodeFlags(): string[] {
  // type stripping is on by default from Node 23; 22.6+ needs the flag
  const major = Number(process.version.slice(1).split(".")[0]);
  return major < 23 ? ["--experimental-strip-types"] : [];
}

function classRunnerArgs(file: string, mode?: string): string[] {
  const args = [...nodeFlags(), "--input-type=module", "-e", RUNNER, file];
  if (mode) args.push(mode);
  return args;
}

const CLASS_FILES = ["node.ts", "node.mts", "node.js", "node.mjs"];

interface MetaCacheEntry {
  mtime: number;
  meta?: Manifest;
  error?: string;
}
const metaCache = new LruMap<string, MetaCacheEntry>(200);

/** read a class node's metadata via the sandboxed runner, cached by mtime */
async function classMeta(
  file: string,
): Promise<{ meta?: Manifest; error?: string }> {
  const mtime = (await fs.promises.stat(file)).mtimeMs;
  const hit = metaCache.get(file);
  if (hit && hit.mtime === mtime) return hit;
  let entry: MetaCacheEntry;
  try {
    // The meta probe IMPORTS the class file, so its top-level code runs on
    // every node listing — same env discipline as an actual run: allowlisted
    // child env only, never the parent's API keys. The `envInherit` opt-in is
    // honored only by real runs the user pressed ▶ on, not by this probe.
    const res = await execa(process.execPath, classRunnerArgs(file, "meta"), {
      cwd: path.dirname(file),
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      extendEnv: false,
      env: childProcessEnv(),
    });
    entry = { mtime, meta: JSON.parse(res.stdout) as Manifest };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    entry = {
      mtime,
      error: (e.stderr?.trim().split("\n")[0] ?? e.message ?? String(err)).slice(0, 300),
    };
  }
  metaCache.set(file, entry);
  return entry;
}

export interface InvalidNode {
  name: string;
  error: string;
}

/** Installed custom-node row for Settings — valid (enabled/disabled) or broken. */
export type CustomNodeInstallStatus = "enabled" | "disabled" | "error";

export interface CustomNodeStatusRow {
  /** Stable id graphs reference (node.json `id`, else directory name). */
  id: string;
  /** Directory under the nodes folder. */
  dir: string;
  status: CustomNodeInstallStatus;
  /** Present when status === "error". */
  error?: string;
  label?: string;
  glyph?: string;
  description?: string;
  kind?: "class" | "command";
  command?: string[];
  file?: string;
  envInherit?: boolean;
}

/** Sidecar listing disabled node ids — does not mutate author manifests. */
function disabledStatePath(): string {
  return path.join(nodesDir(), ".disabled.json");
}

async function readDisabledIds(): Promise<Set<string>> {
  try {
    const raw = JSON.parse(await fs.promises.readFile(disabledStatePath(), "utf8")) as unknown;
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.filter((x): x is string => typeof x === "string" && !!x));
  } catch {
    return new Set();
  }
}

async function writeDisabledIds(ids: Set<string>): Promise<void> {
  await fs.promises.mkdir(nodesDir(), { recursive: true });
  const sorted = [...ids].sort();
  await fs.promises.writeFile(disabledStatePath(), `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}

/** Full install inventory for Settings (enabled + disabled + validation errors). */
export async function listNodeStatus(): Promise<{
  dir: string;
  nodes: CustomNodeStatusRow[];
  defs: CustomNodeDef[];
  invalid: InvalidNode[];
}> {
  const { defs, invalid } = await scanNodes();
  const disabled = await readDisabledIds();
  const nodes: CustomNodeStatusRow[] = [];
  for (const d of defs) {
    nodes.push({
      id: d.name,
      dir: d.dir,
      status: disabled.has(d.name) ? "disabled" : "enabled",
      label: d.label,
      glyph: d.glyph,
      description: d.description,
      kind: d.kind,
      command: d.command,
      file: d.file,
      envInherit: d.envInherit,
    });
  }
  for (const b of invalid) {
    nodes.push({
      id: b.name,
      dir: b.name,
      status: "error",
      error: b.error,
      glyph: "✗",
      label: b.name,
    });
  }
  return { dir: nodesDir(), nodes, defs, invalid };
}

export async function setNodeEnabled(id: string, enabled: boolean): Promise<CustomNodeStatusRow> {
  const clean = cleanId(id);
  if (!clean) throw Object.assign(new Error("invalid node id"), { status: 400 });
  const { defs, invalid } = await scanNodes();
  const broken = invalid.find((b) => b.name === clean || cleanId(b.name) === clean);
  if (broken) {
    throw Object.assign(
      new Error(`"${clean}" has validation errors — fix node.json before enabling`),
      { status: 400 },
    );
  }
  const def = defs.find((d) => d.name === clean);
  if (!def) {
    throw Object.assign(new Error(`no custom node named "${clean}"`), { status: 404 });
  }
  const disabled = await readDisabledIds();
  if (enabled) disabled.delete(def.name);
  else disabled.add(def.name);
  await writeDisabledIds(disabled);
  return {
    id: def.name,
    dir: def.dir,
    status: enabled ? "enabled" : "disabled",
    label: def.label,
    glyph: def.glyph,
    description: def.description,
    kind: def.kind,
    command: def.command,
    file: def.file,
    envInherit: def.envInherit,
  };
}

export async function scanNodes(): Promise<{ defs: CustomNodeDef[]; invalid: InvalidNode[] }> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(nodesDir(), { withFileTypes: true });
  } catch {
    return { defs: [], invalid: [] };
  }
  const defs: CustomNodeDef[] = [];
  const invalid: InvalidNode[] = [];
  const seen = new Map<string, string>(); // id → dir

  for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    const dirName = ent.name;
    const dirPath = path.join(nodesDir(), dirName);

    // node.json is the canonical descriptor (id + entry|command + metadata);
    // a bare class file without one still works, with the dir name as id
    let raw: Manifest | undefined;
    try {
      const text = await fs.promises.readFile(path.join(dirPath, "node.json"), "utf8");
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(text) as unknown;
      } catch (err) {
        invalid.push({
          name: dirName,
          error: `node.json is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
        });
        continue;
      }
      const checked = validateCustomNodeManifest(parsedJson);
      if (!checked.ok) {
        invalid.push({ name: dirName, error: checked.error });
        continue;
      }
      raw = checked.data as Manifest;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        invalid.push({
          name: dirName,
          error: `node.json is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
        });
        continue;
      }
    }

    const id = cleanId(raw?.id ?? dirName);
    if (!id) {
      invalid.push({ name: dirName, error: `"id" cleans to nothing — use a-z, 0-9, dashes` });
      continue;
    }
    const dupe = seen.get(id);
    if (dupe) {
      invalid.push({ name: dirName, error: `duplicate id "${id}" — already provided by ${dupe}/` });
      continue;
    }

    const bad = (error: string): void => {
      invalid.push({ name: dirName, error });
    };

    // resolve the flavor
    let kind: "class" | "command" | undefined;
    let entryFile: string | undefined;

    if (raw?.entry !== undefined) {
      if (typeof raw.entry !== "string" || !raw.entry) {
        bad(`"entry" must be a file name like "node.ts"`);
        continue;
      }
      const resolved = path.resolve(dirPath, raw.entry);
      if (!pathContained(resolved, dirPath)) {
        bad(`"entry" must stay inside the node's own directory`);
        continue;
      }
      try {
        await fs.promises.access(resolved);
      } catch {
        bad(`entry file "${raw.entry}" does not exist`);
        continue;
      }
      kind = "class";
      entryFile = raw.entry;
    } else if (raw?.command !== undefined) {
      if (
        !Array.isArray(raw.command) ||
        !raw.command.length ||
        !raw.command.every((cmd) => typeof cmd === "string")
      ) {
        bad('"command" must be a non-empty array of strings, e.g. ["node", "./run.js"]');
        continue;
      }
      kind = "command";
    } else {
      // no entry/command in the manifest (or no manifest): look for a bare class file
      const found = (
        await Promise.all(
          CLASS_FILES.map(async (f) => {
            try {
              await fs.promises.access(path.join(dirPath, f));
              return f;
            } catch {
              return undefined;
            }
          }),
        )
      ).find(Boolean);
      if (!found) {
        bad(
          raw
            ? `node.json needs "entry" (class file) or "command" (argv array)`
            : "no node.json and no node.ts in this directory",
        );
        continue;
      }
      kind = "class";
      entryFile = found;
    }

    // metadata: manifest wins; a bare class file is asked via the sandboxed runner
    let meta: Manifest = raw ?? {};
    if (kind === "class" && !raw) {
      const res = await classMeta(path.join(dirPath, entryFile!));
      if (res.error || !res.meta) {
        bad(res.error ?? "could not read node class metadata");
        continue;
      }
      meta = res.meta;
    }

    let portBad = false;
    for (const port of ["input", "output"] as const) {
      const v = meta[port];
      if (v !== undefined && !VALUE_TYPES.has(v)) {
        bad(`"${port}" must be one of text, int, float, bool, json — got "${String(v)}"`);
        portBad = true;
      }
      if (v !== undefined && meta[`${port}s`] !== undefined) {
        bad(`declare "${port}" (single port) or "${port}s" (named ports), not both`);
        portBad = true;
      }
    }
    if (portBad) continue;

    // named ports + params
    let inputs: CustomPortDef[] | undefined;
    let outputs: CustomPortDef[] | undefined;
    let params: CustomParamDef[] | undefined;
    if (meta.inputs !== undefined) {
      const r = parsePortDefs(meta.inputs, "inputs");
      if (r.error) {
        bad(r.error);
        continue;
      }
      inputs = r.ports;
    }
    if (meta.outputs !== undefined) {
      const r = parsePortDefs(meta.outputs, "outputs");
      if (r.error) {
        bad(r.error);
        continue;
      }
      outputs = r.ports;
    }
    if (meta.params !== undefined) {
      const r = parseParamDefs(meta.params);
      if (r.error) {
        bad(r.error);
        continue;
      }
      params = r.params;
    }

    seen.set(id, dirName);
    defs.push({
      name: id,
      dir: dirName,
      kind: kind!,
      label: meta.label ?? id,
      glyph: (meta.glyph ?? "⌁").slice(0, 2),
      description: meta.description,
      command: kind === "command" ? (raw!.command as string[]) : undefined,
      file: entryFile,
      timeoutMs: Math.min(meta.timeoutMs ?? 60_000, MAX_TIMEOUT),
      input: (meta.input as ValueType) ?? "text",
      output: (meta.output as ValueType) ?? "text",
      inputs,
      outputs,
      params,
      envInherit: meta.env === "inherit" || undefined,
    });
  }
  return { defs, invalid };
}

async function readDefs(): Promise<CustomNodeDef[]> {
  const [{ defs }, disabled] = await Promise.all([scanNodes(), readDisabledIds()]);
  // Disabled nodes stay on disk (and in Settings) but leave the palette / runner.
  return defs.filter((d) => !disabled.has(d.name));
}

/** resolve one def by id — used by the run route and the server executor */
export async function getCustomDef(name: string): Promise<CustomNodeDef | undefined> {
  return (await readDefs()).find((d) => d.name === name);
}

/** the implicit port name legacy single-input nodes collect their wires under */
export const LEGACY_PORT = "input";

/** merge stored values over declared defaults; every value validated against its declaration */
export function resolveParams(
  def: CustomNodeDef,
  values?: Record<string, string>,
): Record<string, string> {
  if (!def.params) return {};
  const out: Record<string, string> = {};
  for (const p of def.params) {
    const v = values?.[p.name] ?? p.default ?? "";
    const bad = paramValueError(v, p);
    if (bad) throw new Error(`${def.name}: param "${p.name}" ${bad}`);
    out[p.name] = v;
  }
  return out;
}

/**
 * Per-port inbound texts → the stdin payload. Legacy nodes get the joined
 * text as before; named-input nodes get a JSON object keyed by port name.
 * Required ports and declared value types are enforced here.
 */
export function buildStdin(def: CustomNodeDef, ports: Record<string, string[]>): string {
  if (!def.inputs) {
    const joined = (ports[LEGACY_PORT] ?? []).join("\n\n");
    if (def.input !== "text") {
      const bad = valueTypeError(joined, def.input);
      if (bad) throw new Error(`${def.name} expects ${def.input} input but ${bad}`);
    }
    return joined;
  }
  const obj: Record<string, string> = {};
  for (const p of def.inputs) {
    const vals = ports[p.name] ?? [];
    if (!vals.length) {
      if (p.required !== false) throw new Error(`${def.name}: required input "${p.name}" has no value`);
      continue;
    }
    const joined = vals.join("\n\n");
    if (p.type !== "text") {
      const bad = valueTypeError(joined, p.type);
      if (bad) throw new Error(`${def.name}: input "${p.name}" expects ${p.type} but ${bad}`);
    }
    obj[p.name] = joined;
  }
  return JSON.stringify(obj);
}

/**
 * stdout → lane values. Named-output nodes must print a JSON object keyed by
 * port name (non-string values are carried as JSON); every declared port must
 * be present and type-conformant — fail loudly instead of poisoning
 * downstream nodes. `text` is the primary lane value (first declared port).
 */
export function parseRunOutput(
  def: CustomNodeDef,
  stdout: string,
): { text: string; ports?: Record<string, string> } {
  if (!def.outputs) {
    if (def.output !== "text") {
      const bad = valueTypeError(stdout, def.output);
      if (bad) throw new Error(`${def.name} declares ${def.output} output but ${bad}`);
    }
    return { text: stdout };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`${def.name} declares named outputs but did not print a JSON object`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${def.name} declares named outputs but printed ${Array.isArray(parsed) ? "an array" : typeof parsed}`);
  }
  const obj = parsed as Record<string, unknown>;
  const ports: Record<string, string> = {};
  for (const p of def.outputs) {
    const v = obj[p.name];
    if (v === undefined) throw new Error(`${def.name}: output is missing port "${p.name}"`);
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (p.type !== "text") {
      const bad = valueTypeError(s, p.type);
      if (bad) throw new Error(`${def.name}: output "${p.name}" declares ${p.type} but ${bad}`);
    }
    ports[p.name] = s;
  }
  return { text: ports[def.outputs[0]!.name] ?? "", ports };
}

/**
 * Resolve argv[0] for command nodes. Relative paths (`./`, `../`, `.\`, `..\`)
 * are resolved against the node directory so Windows manifests work too.
 */
export function resolveCommandBin(nodeDir: string, bin: string): string {
  if (
    bin.startsWith("./") ||
    bin.startsWith("../") ||
    bin.startsWith(".\\") ||
    bin.startsWith("..\\")
  ) {
    return path.resolve(nodeDir, bin);
  }
  return bin;
}

/**
 * Execute a custom node def: argv only (never a shell), cwd pinned to the
 * node's own directory, bounded by timeout and output cap. `params` must
 * already be resolved (see resolveParams) — they reach the process as
 * THREADLE_PARAMS (JSON) plus one THREADLE_PARAM_<NAME> per param.
 */
export async function execCustomDef(
  def: CustomNodeDef,
  input: string,
  params?: Record<string, string>,
): Promise<{ output: string; stderr?: string; ms: number }> {
  const dir = path.join(nodesDir(), def.dir);
  let bin: string;
  let args: string[];
  if (def.kind === "class") {
    bin = process.execPath;
    args = classRunnerArgs(path.join(dir, def.file!));
  } else {
    const [b, ...rest] = def.command!;
    bin = b ? resolveCommandBin(dir, b) : b!;
    args = rest;
    // Shebang-only scripts are not executable on Windows CreateProcess.
    if (
      process.platform === "win32" &&
      bin &&
      /\.(mjs|cjs|js|ts)$/i.test(bin) &&
      !/\.(cmd|exe|bat)$/i.test(bin)
    ) {
      args = [bin, ...args];
      bin = process.execPath;
    }
  }
  if (activeRuns >= MAX_PARALLEL_RUNS) {
    throw new Error(`too many custom nodes running (max ${MAX_PARALLEL_RUNS}) — try again in a moment`);
  }
  activeRuns += 1;
  try {
    const started = Date.now();
    const res = await execa(bin, args, {
      cwd: dir,
      input,
      timeout: def.timeoutMs,
      maxBuffer: MAX_OUTPUT,
      extendEnv: false,
      env: nodeEnv(def, params),
    });
    return {
      output: res.stdout,
      stderr: res.stderr.slice(0, 4000) || undefined,
      ms: Date.now() - started,
    };
  } finally {
    activeRuns -= 1;
  }
}

/**
 * One-stop run used by the run route and the workflow executors: resolve
 * params, build stdin from per-port inputs, execute, parse named outputs.
 */
export async function runCustomDef(
  def: CustomNodeDef,
  ports: Record<string, string[]>,
  paramValues?: Record<string, string>,
): Promise<{ text: string; ports?: Record<string, string>; stderr?: string; ms: number }> {
  const params = resolveParams(def, paramValues);
  const stdin = buildStdin(def, ports);
  const res = await execCustomDef(def, stdin, params);
  const out = parseRunOutput(def, res.output);
  return { ...out, stderr: res.stderr, ms: res.ms };
}

const MAX_PARALLEL_RUNS = 8;

/**
 * Environment guardrail: custom nodes get a minimal allowlist, NOT the
 * server's full environment — a malicious node must not read API keys out
 * of process.env. A manifest can opt in with "env": "inherit", which the
 * Settings view can then surface as a trust decision the user made.
 */
function nodeEnv(def: CustomNodeDef, params?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = def.envInherit
    ? { ...process.env }
    : childProcessEnv();
  env.THREADLE_NODE = def.name;
  if (def.params) {
    env.THREADLE_PARAMS = JSON.stringify(params ?? {});
    for (const [k, v] of Object.entries(params ?? {})) {
      env[`THREADLE_PARAM_${k.toUpperCase().replaceAll("-", "_")}`] = v;
    }
  }
  if (def.inputs) env.THREADLE_INPUTS_JSON = "1";
  return env;
}

export const customNodeRoutes = new Hono();

customNodeRoutes.get("/", async (c) => c.json(await readDefs()));

/** valid + broken + disabled manifests — the Settings view shows all three */
customNodeRoutes.get("/status", async (c) => {
  const { dir, nodes, defs, invalid } = await listNodeStatus();
  // `defs` / `invalid` kept for older clients; `nodes` is the unified install list.
  return c.json({ dir, nodes, defs, invalid });
});

customNodeRoutes.post("/enabled", async (c) => {
  const body = (await c.req.json()) as { name?: string; enabled?: boolean };
  const name = typeof body.name === "string" ? body.name : "";
  if (typeof body.enabled !== "boolean") {
    return c.json({ error: '"enabled" must be a boolean' }, 400);
  }
  try {
    const row = await setNodeEnabled(name, body.enabled);
    return c.json({ ok: true, node: row });
  } catch (err) {
    const code = (err as { status?: number }).status;
    const status = code === 400 || code === 404 ? code : 500;
    return c.json({ error: err instanceof Error ? err.message : String(err) }, status);
  }
});

const SCAFFOLD_TS = `/**
 * A threadle custom node: a default-exported class with a run(input) method.
 * Identity + metadata live in node.json next to this file; this class is
 * pure logic. It runs as its own process — crash away, threadle survives.
 */
export default class __CLASS__ {
  async run(input: string): Promise<string> {
    // input is the wired-in text (stdin); the return value flows onward
    return input;
  }
}
`;

const SCAFFOLD_JSON = (id: string): string =>
  JSON.stringify(
    {
      id,
      label: id,
      glyph: "⌁",
      description: "describe what this node does",
      entry: "node.ts",
      input: "text",
      output: "text",
      timeoutMs: 60_000,
    },
    null,
    2,
  ) + "\n";

/**
 * Import a node someone published: shallow git clone into the nodes dir.
 * No registry — and the clone never executes anything; metadata is read
 * through the sandboxed runner only, and the node runs only when the user
 * wires it and presses Run.
 */
customNodeRoutes.post("/import", async (c) => {
  const { url } = (await c.req.json()) as { url?: string };
  const u = (url ?? "").trim();
  const isGit = /^(https:\/\/|git@)[\w.@:/~+-]+$/.test(u);
  let localPath = u;
  if (u === "~") localPath = os.homedir();
  else if (u.startsWith("~/") || u.startsWith("~\\")) {
    localPath = path.join(os.homedir(), u.slice(2));
  }
  const isLocal = !isGit && path.isAbsolute(localPath);
  if (!isGit && !isLocal) {
    return c.json(
      { error: "expected a git URL (https://… or git@…) or an absolute local path" },
      400,
    );
  }

  // provisional dir name from the source; renamed to the node.json id after
  const base = (
    isGit
      ? u.replace(/[/\\]+$/, "").split(/[/\\]/).pop()
      : path.basename(localPath.replace(/[/\\]+$/, ""))
  )?.replace(/\.git$/, "") ?? "";
  let name = cleanId(base);
  if (!name) return c.json({ error: "could not derive a node name from that source" }, 400);
  let dir = path.join(nodesDir(), name);
  try {
    await fs.promises.access(dir);
    return c.json({ error: `"${name}" already exists — remove it first` }, 409);
  } catch {
    // free — good
  }
  await fs.promises.mkdir(nodesDir(), { recursive: true });

  if (isGit) {
    // https clones must target a public host — git happily fetches from
    // 127.0.0.1/169.254.… and that's SSRF with a helpful error channel.
    if (u.startsWith("https://")) {
      try {
        await assertPublicHttpUrl(u);
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
      }
    }
    try {
      await execa("git", ["clone", "--depth", "1", u, dir], {
        timeout: 60_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      await fs.promises.rm(dir, { recursive: true, force: true });
      return c.json(
        { error: (e.stderr?.trim().split("\n").pop() ?? e.message ?? String(err)).slice(0, 300) },
        500,
      );
    }
  } else {
    // a project directory or an already-cloned repo: copy it in
    try {
      const st = await fs.promises.stat(localPath);
      if (!st.isDirectory()) return c.json({ error: "local path is not a directory" }, 400);
    } catch {
      return c.json({ error: `no directory at ${localPath}` }, 404);
    }
    if (pathContained(localPath, nodesDir())) {
      return c.json({ error: "that directory is already inside the nodes folder" }, 400);
    }
    // The nodes dir is itself an allowlisted READABLE root — copying an
    // arbitrary tree in (~/.ssh, ~/.aws) would launder it past the file-read
    // allowlist. Sources must be readable to begin with.
    if (!(await isReadablePath(localPath))) {
      return c.json({ error: "local path is not in the readable allowlist" }, 403);
    }
    await fs.promises.cp(localPath, dir, {
      recursive: true,
      dereference: false,
      filter: (src) => {
        // no .git, and no symlinks — a link's target would resolve inside
        // nodesDir() later and escape the source-side check above
        if (src.includes(`${path.sep}.git${path.sep}`) || src.endsWith(`${path.sep}.git`)) {
          return false;
        }
        try {
          return !fs.lstatSync(src).isSymbolicLink();
        } catch {
          return false;
        }
      },
    });
  }

  // if the package declares an id, the directory takes that name
  try {
    const text = await fs.promises.readFile(path.join(dir, "node.json"), "utf8");
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text) as unknown;
    } catch (err) {
      await fs.promises.rm(dir, { recursive: true, force: true });
      return c.json(
        {
          error: `invalid node.json — ${err instanceof Error ? err.message : String(err)}`,
        },
        400,
      );
    }
    const checked = validateCustomNodeManifest(parsedJson);
    if (!checked.ok) {
      await fs.promises.rm(dir, { recursive: true, force: true });
      return c.json({ error: checked.error }, 400);
    }
    const id = cleanId(checked.data.id ?? "");
    if (id && id !== name) {
      const target = path.join(nodesDir(), id);
      try {
        await fs.promises.access(target);
        // id already taken — leave under the provisional name; scan reports the dupe
      } catch {
        await fs.promises.rename(dir, target);
        name = id;
        dir = target;
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      await fs.promises.rm(dir, { recursive: true, force: true });
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        400,
      );
    }
    // no manifest — bare class node keeps the derived name
  }

  const { defs, invalid } = await scanNodes();
  const def = defs.find((d) => d.dir === name || d.name === name);
  const bad = invalid.find((b) => b.name === name);
  if (bad) {
    await fs.promises.rm(dir, { recursive: true, force: true });
    return c.json(
      {
        error: `import rejected — ${bad.error}`,
      },
      400,
    );
  }
  return c.json({ ok: true, name: def?.name ?? name, def, invalid: undefined });
});

/**
 * Import via the browser's directory picker: the client uploads the folder's
 * files (browsers never expose real paths). Same id-rename + scan flow as
 * git/path imports; strict caps and path sanitization.
 */
customNodeRoutes.post("/upload", async (c) => {
  const { folder, files } = (await c.req.json()) as {
    folder?: string;
    files?: Array<{ path?: string; b64?: string }>;
  };
  if (!Array.isArray(files) || !files.length) {
    return c.json({ error: "no files received" }, 400);
  }
  if (files.length > 200) return c.json({ error: "too many files (max 200)" }, 400);

  let name = cleanId(folder ?? "");
  if (!name) return c.json({ error: "could not derive a node name from that folder" }, 400);
  let dir = path.join(nodesDir(), name);
  try {
    await fs.promises.access(dir);
    return c.json({ error: `"${name}" already exists — remove it first` }, 409);
  } catch {
    // free — good
  }

  let total = 0;
  const writes: Array<{ abs: string; buf: Buffer }> = [];
  for (const f of files) {
    if (typeof f.path !== "string" || typeof f.b64 !== "string") {
      return c.json({ error: "malformed file entry" }, 400);
    }
    const rel = f.path.replaceAll("\\", "/");
    if (rel.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rel) || rel.split(/[/\\]/).some((p) => p === ".." || p === "")) {
      return c.json({ error: `unsafe path "${f.path}"` }, 400);
    }
    if (/(^|\/)(\.git|node_modules)(\/|$)/.test(rel)) continue;
    const buf = Buffer.from(f.b64, "base64");
    if (buf.length > 2 * 1024 * 1024) return c.json({ error: `${rel} exceeds 2 MB` }, 400);
    total += buf.length;
    if (total > 10 * 1024 * 1024) return c.json({ error: "folder exceeds 10 MB" }, 400);
    writes.push({ abs: path.join(dir, rel), buf });
  }
  if (!writes.length) return c.json({ error: "nothing to import after filtering" }, 400);

  const manifestWrite = writes.find((w) => path.basename(w.abs) === "node.json");
  if (manifestWrite) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(manifestWrite.buf.toString("utf8")) as unknown;
    } catch (err) {
      return c.json(
        {
          error: `invalid node.json — ${err instanceof Error ? err.message : String(err)}`,
        },
        400,
      );
    }
    const checked = validateCustomNodeManifest(parsedJson);
    if (!checked.ok) return c.json({ error: checked.error }, 400);
  }

  for (const w of writes) {
    await fs.promises.mkdir(path.dirname(w.abs), { recursive: true });
    await fs.promises.writeFile(w.abs, w.buf);
  }

  // directory takes the descriptor's id, same as every other import
  try {
    const text = await fs.promises.readFile(path.join(dir, "node.json"), "utf8");
    const checked = validateCustomNodeManifest(JSON.parse(text) as unknown);
    if (!checked.ok) {
      await fs.promises.rm(dir, { recursive: true, force: true });
      return c.json({ error: checked.error }, 400);
    }
    const id = cleanId(checked.data.id ?? "");
    if (id && id !== name) {
      const target = path.join(nodesDir(), id);
      try {
        await fs.promises.access(target);
      } catch {
        await fs.promises.rename(dir, target);
        name = id;
        dir = target;
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      await fs.promises.rm(dir, { recursive: true, force: true });
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        400,
      );
    }
    // no descriptor — keep folder name
  }

  const { defs, invalid } = await scanNodes();
  const def = defs.find((d) => d.dir === name || d.name === name);
  const bad = invalid.find((b) => b.name === name);
  if (bad) {
    await fs.promises.rm(dir, { recursive: true, force: true });
    return c.json({ error: `import rejected — ${bad.error}` }, 400);
  }
  return c.json({ ok: true, name: def?.name ?? name, def, invalid: undefined });
});

/** one-click scaffold: creates <name>/node.ts ready to edit */
customNodeRoutes.post("/scaffold", async (c) => {
  const { name } = (await c.req.json()) as { name?: string };
  const clean = cleanId(name ?? "");
  if (!clean) return c.json({ error: "a node needs a name (a-z, 0-9, dashes)" }, 400);
  const dir = path.join(nodesDir(), clean);
  const file = path.join(dir, "node.ts");
  try {
    await fs.promises.access(dir);
    return c.json({ error: `"${clean}" already exists` }, 409);
  } catch {
    // free — good
  }
  const cls = clean
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(file, SCAFFOLD_TS.replace("__CLASS__", cls || "MyNode"), "utf8");
  await fs.promises.writeFile(path.join(dir, "node.json"), SCAFFOLD_JSON(clean), "utf8");
  return c.json({ ok: true, name: clean, path: file });
});

customNodeRoutes.post("/run", async (c) => {
  const { name, input, inputs, params } = (await c.req.json()) as {
    name?: string;
    /** legacy single-lane payload */
    input?: string;
    /** named ports: port → wire values (joined per port before stdin) */
    inputs?: Record<string, string[]>;
    /** node-stored param values; defaults fill the gaps */
    params?: Record<string, string>;
  };
  const def = (await readDefs()).find((d) => d.name === name);
  if (!def) return c.json({ error: `no custom node named "${name}"` }, 404);

  const ports: Record<string, string[]> =
    inputs ?? (input !== undefined ? { [LEGACY_PORT]: [input] } : {});
  const inChars = Object.values(ports)
    .flat()
    .reduce((n, s) => n + s.length, 0);
  const { jobId } = jobs.create("custom-node", `${def.glyph} ${def.label}`);
  appendJobLog(jobId, "meta", `custom node ${def.name} (${def.kind}) · ${inChars} chars in`);
  try {
    const res = await runCustomDef(def, ports, params);
    appendJobLog(jobId, "stdout", res.text.slice(0, 2000));
    if (res.stderr) appendJobLog(jobId, "stderr", res.stderr.slice(0, 2000));
    appendJobLog(jobId, "meta", `finished in ${res.ms}ms · ${res.text.length} chars out`);
    jobs.finish(jobId, { status: "done", result: { type: "job.done", jobId } });
    return c.json({ output: res.text, ports: res.ports, stderr: res.stderr, ms: res.ms });
  } catch (err) {
    const e = err as { timedOut?: boolean; stderr?: string; message?: string };
    const msg = e.timedOut
      ? `timed out after ${def.timeoutMs}ms`
      : e.stderr?.slice(0, 4000) || e.message || String(err);
    appendJobLog(jobId, "stderr", msg);
    jobs.finish(jobId, { status: "error", error: msg.slice(0, 500) });
    return c.json({ error: msg }, 500);
  }
});
