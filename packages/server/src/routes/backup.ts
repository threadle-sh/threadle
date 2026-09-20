import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { validateCustomNodeManifestJsonText } from "@threadle/shared";
import { threadleConfigDir } from "../paths.js";
import { normalizeSettings, validateEditorCommand, type ThreadleSettings } from "./settings.js";

export const BACKUP_SCHEMA = "threadle/backup@1" as const;

/** Relative paths under threadleConfigDir included in a backup. */
export const BACKUP_ENTRIES = [
  "graphs",
  "payloads",
  "nodes",
  "settings.json",
  "workflow-folders.json",
  "favorites.json",
] as const;

/**
 * Restore categories that can lead to CODE EXECUTION (`nodes/` runs via the
 * class-node meta probe on the next listing; `settings.json` arms
 * `editor.command`). These are never restored implicitly — the request must
 * name them in `categories`, which the UI does after showing the manifest.
 */
export const EXECUTING_ENTRIES: readonly string[] = ["nodes", "settings.json"];

export interface BackupFile {
  path: string;
  /** utf8 text or base64 for binary */
  encoding: "utf8" | "base64";
  content: string;
}

export interface BackupBundle {
  $schema: typeof BACKUP_SCHEMA;
  exportedAt: string;
  files: BackupFile[];
}

async function walkFiles(absRoot: string, relBase: string): Promise<string[]> {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(absRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const rel = path.join(relBase, ent.name);
    const abs = path.join(absRoot, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await walkFiles(abs, rel)));
    } else if (ent.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function isTextish(rel: string): boolean {
  const lower = rel.toLowerCase();
  return (
    lower.endsWith(".json") ||
    lower.endsWith(".jsonl") ||
    lower.endsWith(".md") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".toml") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml")
  );
}

/** Pack config dirs/files into a threadle/backup@1 JSON bundle (no zip dep). */
export async function packBackup(root = threadleConfigDir()): Promise<BackupBundle> {
  const files: BackupFile[] = [];
  for (const entry of BACKUP_ENTRIES) {
    const abs = path.join(root, entry);
    let st: fs.Stats;
    try {
      st = await fs.promises.stat(abs);
    } catch {
      continue;
    }
    if (st.isFile()) {
      const buf = await fs.promises.readFile(abs);
      const encoding = isTextish(entry) ? "utf8" : "base64";
      files.push({
        path: entry,
        encoding,
        content: encoding === "utf8" ? buf.toString("utf8") : buf.toString("base64"),
      });
      continue;
    }
    if (!st.isDirectory()) continue;
    for (const rel of await walkFiles(abs, entry)) {
      // Skip live version snapshots of graphs (rebuilt on save); keep current graphs/*.json
      if (rel.startsWith(`graphs${path.sep}versions${path.sep}`) || rel.startsWith("graphs/versions/")) {
        continue;
      }
      const buf = await fs.promises.readFile(path.join(root, rel));
      const encoding = isTextish(rel) ? "utf8" : "base64";
      files.push({
        path: rel.split(path.sep).join("/"),
        encoding,
        content: encoding === "utf8" ? buf.toString("utf8") : buf.toString("base64"),
      });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    $schema: BACKUP_SCHEMA,
    exportedAt: new Date().toISOString(),
    files,
  };
}

export function parseBackupBundle(raw: unknown): BackupBundle {
  if (!raw || typeof raw !== "object") throw new Error("backup must be a JSON object");
  const o = raw as Record<string, unknown>;
  if (o.$schema !== BACKUP_SCHEMA) {
    throw new Error(`unsupported backup schema (expected ${BACKUP_SCHEMA})`);
  }
  if (!Array.isArray(o.files)) throw new Error("backup.files must be an array");
  const files: BackupFile[] = [];
  for (const f of o.files) {
    if (!f || typeof f !== "object") throw new Error("invalid backup file entry");
    const fe = f as Record<string, unknown>;
    if (typeof fe.path !== "string" || !fe.path || fe.path.includes("..") || path.isAbsolute(fe.path)) {
      throw new Error(`invalid backup path: ${String(fe.path)}`);
    }
    if (fe.encoding !== "utf8" && fe.encoding !== "base64") {
      throw new Error(`invalid encoding for ${fe.path}`);
    }
    if (typeof fe.content !== "string") throw new Error(`missing content for ${fe.path}`);
    // Only restore known top-level entries
    const top = fe.path.split("/")[0];
    if (!(BACKUP_ENTRIES as readonly string[]).includes(top!)) {
      throw new Error(`path outside backup allowlist: ${fe.path}`);
    }
    files.push({ path: fe.path, encoding: fe.encoding, content: fe.content });
  }
  return {
    $schema: BACKUP_SCHEMA,
    exportedAt: typeof o.exportedAt === "string" ? o.exportedAt : new Date().toISOString(),
    files,
  };
}

function decodeContent(f: BackupFile): Buffer {
  return f.encoding === "base64"
    ? Buffer.from(f.content, "base64")
    : Buffer.from(f.content, "utf8");
}

/**
 * Pre-restore validation of executable-adjacent content:
 * - every `nodes/…/node.json` must be a valid custom-node manifest;
 * - a restored `settings.json` is re-normalized through the same code path as
 *   `PUT /api/settings` (never written verbatim), and an `editor.command`
 *   that fails the editor allowlist is dropped.
 * Throws with a path-naming message on invalid content.
 */
async function vetBundleContent(bundle: BackupBundle): Promise<Map<string, Buffer>> {
  const rewrites = new Map<string, Buffer>();
  for (const f of bundle.files) {
    const isNodeManifest = /^nodes\/[^/]+\/node\.json$/.test(f.path);
    if (isNodeManifest) {
      const res = validateCustomNodeManifestJsonText(decodeContent(f).toString("utf8"));
      if (!res.ok) throw new Error(`refusing restore — ${f.path}: ${res.error}`);
    }
    if (f.path === "settings.json") {
      let raw: Partial<ThreadleSettings>;
      try {
        raw = JSON.parse(decodeContent(f).toString("utf8")) as Partial<ThreadleSettings>;
      } catch {
        throw new Error("refusing restore — settings.json is not valid JSON");
      }
      const normalized = normalizeSettings(raw);
      if (normalized.editor.command) {
        const check = await validateEditorCommand(normalized.editor.command);
        if (!check.ok) normalized.editor = { mode: normalized.editor.mode };
      }
      rewrites.set(f.path, Buffer.from(JSON.stringify(normalized, null, 2), "utf8"));
    }
  }
  return rewrites;
}

/** Write one restored file, refusing symlinked targets and escaped parents. */
async function writeRestoredFile(root: string, rel: string, buf: Buffer): Promise<void> {
  const abs = path.join(root, ...rel.split("/"));
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  // A pre-existing symlink at the target (or a symlinked intermediate dir)
  // would turn this into an arbitrary-location write — resolve and refuse.
  const parentReal = await fs.promises.realpath(path.dirname(abs));
  const rootReal = await fs.promises.realpath(root);
  if (parentReal !== rootReal && !parentReal.startsWith(rootReal + path.sep)) {
    throw new Error(`refusing restore — ${rel} escapes the config dir via a symlink`);
  }
  const st = await fs.promises.lstat(abs).catch(() => undefined);
  if (st?.isSymbolicLink()) {
    throw new Error(`refusing restore — ${rel} is a symlink`);
  }
  await fs.promises.writeFile(abs, buf);
}

/**
 * Write a backup bundle into `root`, merging over existing files.
 * Only categories named in `categories` are restored; code-bearing categories
 * (`EXECUTING_ENTRIES`) are skipped unless explicitly requested.
 */
export async function restoreBackup(
  bundle: BackupBundle,
  root = threadleConfigDir(),
  categories?: readonly string[],
): Promise<{ written: number; skipped: string[] }> {
  const wanted = new Set(categories ?? BACKUP_ENTRIES.filter((e) => !EXECUTING_ENTRIES.includes(e)));
  for (const cat of wanted) {
    if (!(BACKUP_ENTRIES as readonly string[]).includes(cat)) {
      throw new Error(`unknown restore category: ${cat}`);
    }
  }
  const rewrites = await vetBundleContent(bundle);
  let written = 0;
  const skippedCategories = new Set<string>();
  for (const f of bundle.files) {
    const top = f.path.split("/")[0]!;
    if (!wanted.has(top)) {
      skippedCategories.add(top);
      continue;
    }
    await writeRestoredFile(root, f.path, rewrites.get(f.path) ?? decodeContent(f));
    written++;
  }
  return { written, skipped: [...skippedCategories].sort() };
}

export const backupRoutes = new Hono();

backupRoutes.post("/pack", async (c) => {
  const bundle = await packBackup();
  return c.json(bundle);
});

backupRoutes.get("/download", async (c) => {
  const bundle = await packBackup();
  const body = JSON.stringify(bundle, null, 2);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="threadle-backup-${stamp}.json"`,
    },
  });
});

backupRoutes.post("/restore", async (c) => {
  const raw = (await c.req.json().catch(() => undefined)) as
    | { bundle?: unknown; categories?: unknown }
    | Record<string, unknown>
    | undefined;
  try {
    // Wrapper form `{bundle, categories}` opts into specific categories;
    // a bare bundle (legacy) restores only the non-executing ones.
    const isWrapper = !!raw && typeof raw === "object" && "bundle" in raw && !("$schema" in raw);
    const bundle = parseBackupBundle(isWrapper ? (raw as { bundle: unknown }).bundle : raw);
    const categories = isWrapper
      ? (Array.isArray((raw as { categories?: unknown }).categories)
          ? ((raw as { categories: unknown[] }).categories.filter(
              (x): x is string => typeof x === "string",
            ) as string[])
          : undefined)
      : undefined;
    const result = await restoreBackup(bundle, threadleConfigDir(), categories);
    return c.json({ ok: true, ...result, exportedAt: bundle.exportedAt });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});
