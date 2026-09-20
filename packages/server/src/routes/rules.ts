import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";
import {
  IMPORT_TEXT_MAX_BYTES,
  RULE_FILENAMES,
  isAbsolutePath,
  validateRulesImport,
  validateSkillImport,
} from "@threadle/shared";
import { registry } from "../providers/registry.js";
import { claudeHome } from "../providers/claude-code/discover.js";
import { threadleSkillsDir } from "../paths.js";
import {
  parseSkillFrontmatter,
  setFrontmatterField,
  skillAutoInvoke,
  skillDescription,
} from "./skill-md.js";
import {
  applySkillPrecedence,
  skillMetaFromSource,
  type SkillOrigin,
} from "./skill-precedence.js";

export interface RuleArtifact {
  path: string;
  name: string;
  kind: "rules" | "agent" | "skill";
  source: string; // e.g. "CLAUDE.md", ".cursorrules", ".claude/skills"
  size: number;
  mtime: number;
  /** skill: one-line description from frontmatter */
  description?: string;
  /** skill: false when disable-model-invocation is set */
  autoInvoke?: boolean;
  /** skill: library bucket for UI grouping */
  origin?: SkillOrigin;
  /** skill: lower = higher precedence on name clash */
  layer?: number;
  /** skill: path of the higher-priority skill that shadows this one */
  shadowedBy?: string;
}

export interface RuleGroup {
  scope: string; // project dir or "global"
  artifacts: RuleArtifact[];
}

export type SkillLocation =
  | "claude"
  | "opencode"
  | "cursor"
  | "agents"
  | "threadle-custom"
  | "threadle-imported";

async function statArtifact(
  p: string,
  kind: RuleArtifact["kind"],
  source: string,
  name?: string,
  scopeForMeta?: string,
): Promise<RuleArtifact | undefined> {
  try {
    const st = await fs.promises.stat(p);
    if (!st.isFile()) return undefined;
    const base: RuleArtifact = {
      path: p,
      name: name ?? path.basename(p),
      kind,
      source,
      size: st.size,
      mtime: st.mtimeMs,
    };
    if (kind === "skill") {
      try {
        const raw = await fs.promises.readFile(p, "utf8");
        const { fields } = parseSkillFrontmatter(raw.slice(0, 8_192));
        base.description = skillDescription(fields);
        base.autoInvoke = skillAutoInvoke(fields);
      } catch {
        base.autoInvoke = true;
      }
      const meta = skillMetaFromSource(source, scopeForMeta ?? "global");
      base.origin = meta.origin;
      base.layer = meta.layer;
    }
    return base;
  } catch {
    return undefined;
  }
}

/** All *.md agent defs in a dir. */
async function agentDefs(dir: string, source: string): Promise<RuleArtifact[]> {
  const out: RuleArtifact[] = [];
  try {
    for (const f of await fs.promises.readdir(dir)) {
      if (!f.endsWith(".md")) continue;
      const a = await statArtifact(path.join(dir, f), "agent", source, f.slice(0, -3));
      if (a) out.push(a);
    }
  } catch {
    // dir absent
  }
  return out;
}

/** All <name>/SKILL.md skill definitions in a dir. */
async function skillDefs(
  dir: string,
  source: string,
  scope: string,
): Promise<RuleArtifact[]> {
  const out: RuleArtifact[] = [];
  try {
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const a = await statArtifact(
        path.join(dir, entry.name, "SKILL.md"),
        "skill",
        source,
        entry.name,
        scope,
      );
      if (a) out.push(a);
    }
  } catch {
    // dir absent
  }
  return out;
}

/** Loose rules files in a cursor-style rules directory. */
async function rulesDir(dir: string, source: string): Promise<RuleArtifact[]> {
  const out: RuleArtifact[] = [];
  try {
    for (const f of await fs.promises.readdir(dir)) {
      const a = await statArtifact(path.join(dir, f), "rules", source);
      if (a) out.push(a);
    }
  } catch {
    // dir absent
  }
  return out;
}

export function skillBase(scope: string, location: SkillLocation): string {
  const home = os.homedir();
  if (location === "threadle-custom" || location === "threadle-imported") {
    const kind = location === "threadle-custom" ? "custom" : "imported";
    if (scope === "global") return threadleSkillsDir(kind);
    return path.join(scope, ".threadle", "skills", kind);
  }
  if (scope === "global") {
    switch (location) {
      case "opencode":
        return path.join(home, ".config", "opencode", "skills");
      case "cursor":
        return path.join(home, ".cursor", "skills");
      case "agents":
        return path.join(home, ".agents", "skills");
      case "claude":
      default:
        return path.join(claudeHome(), "skills");
    }
  }
  switch (location) {
    case "opencode":
      return path.join(scope, ".opencode", "skills");
    case "cursor":
      return path.join(scope, ".cursor", "skills");
    case "agents":
      return path.join(scope, ".agents", "skills");
    case "claude":
    default:
      return path.join(scope, ".claude", "skills");
  }
}

function locationSource(location: SkillLocation, scope: string): string {
  switch (location) {
    case "threadle-custom":
      return scope === "global" ? "~/.config/threadle/skills/custom" : ".threadle/skills/custom";
    case "threadle-imported":
      return scope === "global" ? "~/.config/threadle/skills/imported" : ".threadle/skills/imported";
    case "opencode":
      return scope === "global" ? "~/.config/opencode/skills" : ".opencode/skills";
    case "cursor":
      return scope === "global" ? "~/.cursor/skills" : ".cursor/skills";
    case "agents":
      return scope === "global" ? "~/.agents/skills" : ".agents/skills";
    case "claude":
    default:
      return scope === "global" ? "~/.claude/skills" : ".claude/skills";
  }
}

export async function projectArtifacts(dir: string): Promise<RuleArtifact[]> {
  const out: RuleArtifact[] = [];
  const singles: Array<[string, string]> = [
    ["CLAUDE.md", "CLAUDE.md"],
    ["CLAUDE.local.md", "CLAUDE.local.md"],
    ["AGENTS.md", "AGENTS.md"],
    [".cursorrules", ".cursorrules"],
    [path.join(".github", "copilot-instructions.md"), "copilot-instructions"],
  ];
  for (const [rel, source] of singles) {
    const a = await statArtifact(path.join(dir, rel), "rules", source);
    if (a) out.push(a);
  }
  out.push(...(await rulesDir(path.join(dir, ".cursor", "rules"), ".cursor/rules")));
  out.push(...(await agentDefs(path.join(dir, ".claude", "agents"), ".claude/agents")));
  // Project agent skills first (highest precedence), then threadle project libraries.
  out.push(...(await skillDefs(path.join(dir, ".claude", "skills"), ".claude/skills", dir)));
  out.push(...(await skillDefs(path.join(dir, ".agents", "skills"), ".agents/skills", dir)));
  out.push(...(await skillDefs(path.join(dir, ".cursor", "skills"), ".cursor/skills", dir)));
  out.push(...(await skillDefs(path.join(dir, ".opencode", "skills"), ".opencode/skills", dir)));
  out.push(
    ...(await skillDefs(path.join(dir, ".threadle", "skills", "custom"), ".threadle/skills/custom", dir)),
  );
  out.push(
    ...(await skillDefs(
      path.join(dir, ".threadle", "skills", "imported"),
      ".threadle/skills/imported",
      dir,
    )),
  );
  return out;
}

export async function globalArtifacts(): Promise<RuleArtifact[]> {
  const out: RuleArtifact[] = [];
  const home = os.homedir();
  const claude = claudeHome();
  const single = await statArtifact(path.join(claude, "CLAUDE.md"), "rules", "~/.claude/CLAUDE.md");
  if (single) out.push(single);
  out.push(...(await agentDefs(path.join(claude, "agents"), "~/.claude/agents")));
  out.push(...(await skillDefs(path.join(claude, "skills"), "~/.claude/skills", "global")));
  const ocAgents = await statArtifact(
    path.join(home, ".config", "opencode", "AGENTS.md"),
    "rules",
    "~/.config/opencode/AGENTS.md",
  );
  if (ocAgents) out.push(ocAgents);
  out.push(
    ...(await skillDefs(
      path.join(home, ".config", "opencode", "skills"),
      "~/.config/opencode/skills",
      "global",
    )),
  );
  out.push(...(await skillDefs(path.join(home, ".cursor", "skills"), "~/.cursor/skills", "global")));
  out.push(...(await skillDefs(path.join(home, ".agents", "skills"), "~/.agents/skills", "global")));
  // Threadle-managed libraries (below project, above bare global agent homes for custom/imported UI)
  out.push(
    ...(await skillDefs(threadleSkillsDir("custom"), "~/.config/threadle/skills/custom", "global")),
  );
  out.push(
    ...(await skillDefs(threadleSkillsDir("imported"), "~/.config/threadle/skills/imported", "global")),
  );
  return out;
}

async function knownProjectDirs(): Promise<Set<string>> {
  const dirs = new Set<string>();
  for (const p of registry.providers.values()) {
    try {
      if (!(await p.available())) continue;
      for (const s of await p.listSessions()) {
        if (s.projectDir && isAbsolutePath(s.projectDir)) dirs.add(s.projectDir);
      }
    } catch {
      // provider offline
    }
  }
  return dirs;
}

function withPrecedence(groups: RuleGroup[]): RuleGroup[] {
  const flat = groups.flatMap((g) => g.artifacts);
  applySkillPrecedence(flat);
  return groups;
}

async function collectKnownArtifacts(): Promise<Map<string, RuleArtifact>> {
  const known = new Map<string, RuleArtifact>();
  for (const a of await globalArtifacts()) known.set(a.path, a);
  for (const dir of await knownProjectDirs()) {
    for (const a of await projectArtifacts(dir)) known.set(a.path, a);
  }
  applySkillPrecedence([...known.values()]);
  return known;
}

/** Read a scanner-known rules/skill file — refuses unknown paths. */
export async function readKnownArtifact(
  target: string,
): Promise<{ artifact: RuleArtifact; content: string }> {
  const known = await collectKnownArtifacts();
  const artifact = known.get(target);
  if (!artifact) {
    throw new Error(`not a known rules/skill artifact: ${target}`);
  }
  const raw = await fs.promises.readFile(target, "utf8");
  return { artifact, content: raw.slice(0, 512_000) };
}

/**
 * Resolve a skill/rules node by absolute path (preferred) or by name
 * (+ optional origin/source). Used for portable graphs that travel without paths.
 */
export async function resolveKnownArtifact(opts: {
  kind: "skill" | "rules";
  name: string;
  path?: string;
  origin?: SkillOrigin;
  source?: string;
}): Promise<RuleArtifact> {
  const known = await collectKnownArtifacts();
  if (opts.path) {
    const hit = known.get(opts.path);
    if (hit && (opts.kind === "skill" ? hit.kind === "skill" : hit.kind === "rules")) {
      return hit;
    }
  }
  const wantKind = opts.kind === "skill" ? "skill" : "rules";
  let candidates = [...known.values()].filter(
    (a) => a.kind === wantKind && a.name === opts.name,
  );
  if (!candidates.length) {
    throw new Error(`no ${opts.kind} named "${opts.name}" found on this machine`);
  }
  if (opts.origin) {
    const byOrigin = candidates.filter((a) => a.origin === opts.origin);
    if (byOrigin.length) candidates = byOrigin;
  }
  if (opts.source) {
    const bySource = candidates.filter(
      (a) => a.source === opts.source || a.source.includes(opts.source!),
    );
    if (bySource.length) candidates = bySource;
  }
  candidates.sort((a, b) => (a.layer ?? 99) - (b.layer ?? 99));
  return candidates[0]!;
}

/** Read skill/rules content for a graph node (path or name-based). */
export async function readArtifactForNode(opts: {
  kind: "skill" | "rules";
  name: string;
  path?: string;
  origin?: SkillOrigin;
  source?: string;
}): Promise<{ artifact: RuleArtifact; content: string }> {
  const artifact = await resolveKnownArtifact(opts);
  const raw = await fs.promises.readFile(artifact.path, "utf8");
  return { artifact, content: raw.slice(0, 512_000) };
}

/** Provenance header so merged text lanes stay attributable. */
export function formatArtifactInject(
  kind: "skill" | "rules",
  name: string,
  source: string | undefined,
  content: string,
): string {
  const heading = kind === "skill" ? "Skill" : "Rules";
  const src = source ? ` (${source})` : "";
  return `# ${heading}: ${name}${src}\n\n${content.trim()}\n`;
}

async function knownScopes(): Promise<Set<string>> {
  const dirs = await knownProjectDirs();
  dirs.add("global");
  return dirs;
}

export const ruleRoutes = new Hono();

ruleRoutes.get("/", async (c) => {
  const groups: RuleGroup[] = [];
  const globalArts = await globalArtifacts();
  if (globalArts.length) groups.push({ scope: "global", artifacts: globalArts });

  for (const dir of [...(await knownProjectDirs())].sort()) {
    const artifacts = await projectArtifacts(dir);
    if (artifacts.length) groups.push({ scope: dir, artifacts });
  }
  return c.json(withPrecedence(groups));
});

/** Read an artifact's content — only paths the scanner itself discovered. */
ruleRoutes.get("/content", async (c) => {
  const target = c.req.query("path");
  const byName = c.req.query("name");
  const kind = c.req.query("kind") as "skill" | "rules" | undefined;
  const origin = c.req.query("origin") as SkillOrigin | undefined;
  const source = c.req.query("source") || undefined;

  if (target) {
    const known = await collectKnownArtifacts();
    if (!known.has(target)) {
      return c.json({ error: "not a known rules/skill artifact" }, 404);
    }
    const raw = await fs.promises.readFile(target, "utf8");
    return c.json({ content: raw.slice(0, 512_000), path: target });
  }

  if (byName && (kind === "skill" || kind === "rules")) {
    try {
      const { artifact, content } = await readArtifactForNode({
        kind,
        name: byName,
        origin,
        source,
      });
      return c.json({ content, path: artifact.path, artifact });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        404,
      );
    }
  }

  return c.json({ error: "?path= or ?name=&kind= required" }, 400);
});

/** Resolve skill/rules by name for portable graph nodes. */
ruleRoutes.get("/resolve", async (c) => {
  const name = c.req.query("name");
  const kind = c.req.query("kind") as "skill" | "rules" | undefined;
  const origin = c.req.query("origin") as SkillOrigin | undefined;
  const source = c.req.query("source") || undefined;
  if (!name || (kind !== "skill" && kind !== "rules")) {
    return c.json({ error: "?name= and ?kind=skill|rules required" }, 400);
  }
  try {
    const artifact = await resolveKnownArtifact({ kind, name, origin, source });
    return c.json(artifact);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      404,
    );
  }
});

/** Save content for a known artifact (skills + rules + agents). */
ruleRoutes.put("/content", async (c) => {
  const body = (await c.req.json()) as { path?: string; content?: unknown };
  if (!body.path) return c.json({ error: "path required" }, 400);
  if (typeof body.content !== "string") return c.json({ error: "content required" }, 400);
  if (body.content.length > IMPORT_TEXT_MAX_BYTES) {
    return c.json({ error: `content too large (max ${IMPORT_TEXT_MAX_BYTES} bytes)` }, 413);
  }

  const known = await collectKnownArtifacts();
  if (!known.has(body.path)) {
    return c.json({ error: "not a known rules/skill artifact" }, 404);
  }
  await fs.promises.writeFile(body.path, body.content, "utf8");
  const prev = known.get(body.path)!;
  const artifact = await statArtifact(body.path, prev.kind, prev.source, prev.name, "global");
  if (artifact && prev.kind === "skill") {
    artifact.origin = prev.origin;
    artifact.layer = prev.layer;
    artifact.shadowedBy = prev.shadowedBy;
  }
  return c.json({ ok: true, artifact });
});

const RULE_FILENAME_SET = new Set<string>(RULE_FILENAMES);

/** Create a rules file or a skillset. Refuses overwrites and unknown scopes. */
ruleRoutes.post("/create", async (c) => {
  const body = (await c.req.json()) as {
    kind?: "rules" | "skill";
    scope?: string;
    /** rules: filename from the allowlist */
    type?: string;
    /** skill: kebab-case name */
    name?: string;
    /** skill home — defaults to threadle-custom */
    location?: SkillLocation;
    content?: unknown;
  };
  const scopes = await knownScopes();
  if (!body.scope || !scopes.has(body.scope)) {
    return c.json({ error: "unknown scope — must be a project with sessions or 'global'" }, 400);
  }

  let target: string;
  let skillName: string | undefined;
  let location: SkillLocation | undefined;
  let content: string;
  if (body.kind === "skill") {
    const skill = validateSkillImport({
      content: body.content,
      name: body.name,
      allowDeriveName: false,
    });
    if (!skill.ok) {
      const status = skill.error.includes("too large") ? 413 : 400;
      return c.json({ error: skill.error }, status);
    }
    skillName = skill.data.name;
    content = skill.data.content;
    location = body.location ?? "threadle-custom";
    target = path.join(skillBase(body.scope, location), skillName, "SKILL.md");
  } else {
    const rules = validateRulesImport({ content: body.content, type: body.type });
    if (!rules.ok) {
      const status = rules.error.includes("too large") ? 413 : 400;
      return c.json({ error: rules.error }, status);
    }
    content = rules.data.content;
    target =
      body.scope === "global"
        ? path.join(claudeHome(), "CLAUDE.md")
        : path.join(body.scope, rules.data.type);
  }

  try {
    await fs.promises.access(target);
    return c.json({ error: `already exists: ${target}` }, 409);
  } catch {
    // good — does not exist
  }
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, content, "utf8");
  const source =
    body.kind === "skill" && location
      ? locationSource(location, body.scope)
      : (typeof body.type === "string" && RULE_FILENAME_SET.has(body.type)
          ? body.type
          : "CLAUDE.md");
  const artifact = await statArtifact(
    target,
    body.kind === "skill" ? "skill" : "rules",
    source,
    skillName,
    body.scope,
  );
  return c.json({ ok: true, artifact }, 201);
});

/**
 * Toggle skill auto-invocation via `disable-model-invocation` frontmatter.
 * autoInvoke=true → model may pick it; false → explicit `/skill-name` only.
 */
ruleRoutes.post("/skill/toggle", async (c) => {
  const body = (await c.req.json()) as { path?: string; autoInvoke?: boolean };
  if (!body.path) return c.json({ error: "path required" }, 400);
  if (typeof body.autoInvoke !== "boolean") {
    return c.json({ error: "autoInvoke boolean required" }, 400);
  }

  const known = await collectKnownArtifacts();
  const prev = known.get(body.path);
  if (!prev || prev.kind !== "skill") {
    return c.json({ error: "not a known skill artifact" }, 404);
  }

  const raw = await fs.promises.readFile(body.path, "utf8");
  const next = body.autoInvoke
    ? setFrontmatterField(raw, "disable-model-invocation", null)
    : setFrontmatterField(raw, "disable-model-invocation", true);
  await fs.promises.writeFile(body.path, next, "utf8");
  const artifact = await statArtifact(body.path, "skill", prev.source, prev.name, "global");
  if (artifact) {
    artifact.origin = prev.origin;
    artifact.layer = prev.layer;
    artifact.shadowedBy = prev.shadowedBy;
  }
  return c.json({ ok: true, artifact });
});

/** Download a known skill's SKILL.md. */
ruleRoutes.get("/skill/export", async (c) => {
  const target = c.req.query("path");
  if (!target) return c.json({ error: "?path= required" }, 400);

  const known = await collectKnownArtifacts();
  const art = known.get(target);
  if (!art || art.kind !== "skill") {
    return c.json({ error: "not a known skill artifact" }, 404);
  }
  const raw = await fs.promises.readFile(target, "utf8");
  const filename = `${art.name}.SKILL.md`;
  return new Response(raw, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

/**
 * Import a SKILL.md into threadle's imported library (default) or another skill home.
 * name may be omitted — taken from frontmatter or derived from filename hint.
 */
ruleRoutes.post("/skill/import", async (c) => {
  const body = (await c.req.json()) as {
    scope?: string;
    location?: SkillLocation;
    name?: string;
    content?: unknown;
    filename?: string;
  };
  const scopes = await knownScopes();
  if (!body.scope || !scopes.has(body.scope)) {
    return c.json({ error: "unknown scope — must be a project with sessions or 'global'" }, 400);
  }
  const skill = validateSkillImport({
    content: body.content,
    name: body.name,
    filename: body.filename,
    allowDeriveName: true,
  });
  if (!skill.ok) {
    const status = skill.error.includes("too large") ? 413 : 400;
    return c.json({ error: skill.error }, status);
  }

  const location: SkillLocation = body.location ?? "threadle-imported";
  const name = skill.data.name;
  let content = skill.data.content;
  const { fields } = parseSkillFrontmatter(content);
  if (!fields.name) {
    content = setFrontmatterField(content, "name", name);
  }
  if (!fields.description) {
    content = setFrontmatterField(content, "description", `Imported skill ${name}`);
  }

  const target = path.join(skillBase(body.scope, location), name, "SKILL.md");
  try {
    await fs.promises.access(target);
    return c.json({ error: `already exists: ${target}` }, 409);
  } catch {
    // ok
  }
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, content, "utf8");

  const artifact = await statArtifact(
    target,
    "skill",
    locationSource(location, body.scope),
    name,
    body.scope,
  );
  return c.json({ ok: true, artifact }, 201);
});

/**
 * Import a rules file (CLAUDE.md / AGENTS.md / …) into a known scope.
 * Filename or explicit type must be on the allowlist.
 */
ruleRoutes.post("/rules/import", async (c) => {
  const body = (await c.req.json()) as {
    scope?: string;
    type?: string;
    content?: unknown;
    filename?: string;
  };
  const scopes = await knownScopes();
  if (!body.scope || !scopes.has(body.scope)) {
    return c.json({ error: "unknown scope — must be a project with sessions or 'global'" }, 400);
  }
  if (body.scope === "global") {
    return c.json(
      { error: "import rules into a project scope — global CLAUDE.md is create-only" },
      400,
    );
  }
  const rules = validateRulesImport({
    content: body.content,
    type: body.type,
    filename: body.filename,
  });
  if (!rules.ok) {
    const status = rules.error.includes("too large") ? 413 : 400;
    return c.json({ error: rules.error }, status);
  }
  const target = path.join(body.scope, rules.data.type);
  try {
    await fs.promises.access(target);
    return c.json({ error: `already exists: ${target}` }, 409);
  } catch {
    // ok
  }
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, rules.data.content, "utf8");
  const artifact = await statArtifact(
    target,
    "rules",
    rules.data.type,
    undefined,
    body.scope,
  );
  return c.json({ ok: true, artifact }, 201);
});
