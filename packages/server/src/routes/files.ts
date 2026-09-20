import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { isAbsolutePath } from "@threadle/shared";
import { threadleConfigDir } from "../graphs/store.js";
import { discoverSessions } from "../providers/claude-code/discover.js";
import { discoverSessions as discoverCursorSessions } from "../providers/cursor/discover.js";
import { discoverSessions as discoverAntigravitySessions } from "../providers/antigravity/discover.js";
import { discoverSessions as discoverCodexSessions } from "../providers/codex/discover.js";
import { discoverSessions as discoverCopilotSessions } from "../providers/copilot/discover.js";
import {
  sessionStateDir as copilotStateDir,
  sessionStoreDbPath as copilotDbPath,
} from "../providers/copilot/paths.js";
import { discoverSessions as discoverGrokSessions } from "../providers/grok/discover.js";
import { opencodeDataDir, opencodeDbPath } from "../providers/opencode/db.js";
import { registry } from "../providers/registry.js";
import { isReadablePath } from "../readable-paths.js";
import { appLog } from "../jobs.js";

export const fileRoutes = new Hono();

/** Bytes returned in the in-app viewer; larger files are truncated with `truncated: true`. */
export const FILE_PREVIEW_MAX_BYTES = 1_500_000;

const TEXT_EXT = new Set([
  ".md",
  ".txt",
  ".text",
  ".json",
  ".jsonc",
  ".jsonl",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".env",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".astro",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".htm",
  ".svg",
  ".xml",
  ".csv",
  ".tsv",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".m",
  ".mm",
  ".cs",
  ".php",
  ".r",
  ".lua",
  ".pl",
  ".pm",
  ".ex",
  ".exs",
  ".erl",
  ".hs",
  ".ml",
  ".fs",
  ".f90",
  ".zig",
  ".nim",
  ".dart",
  ".scala",
  ".clj",
  ".edn",
  ".graphql",
  ".gql",
  ".proto",
  ".tf",
  ".hcl",
  ".nix",
  ".dockerfile",
  ".makefile",
  ".cmake",
  ".gradle",
  ".properties",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".npmrc",
  ".nvmrc",
  ".prettierrc",
  ".eslintrc",
  ".babelrc",
  ".lock",
  ".log",
  ".patch",
  ".diff",
  ".rst",
  ".adoc",
  ".tex",
  ".bib",
  ".org",
]);

const TEXT_BASENAMES = new Set([
  "makefile",
  "dockerfile",
  "containerfile",
  "gemfile",
  "rakefile",
  "procfile",
  "license",
  "licence",
  "copying",
  "authors",
  "contributors",
  "changelog",
  "changes",
  "readme",
  "todo",
  "agents.md",
  "claude.md",
  "skill.md",
]);

export function isLikelyTextPath(filePath: string): boolean {
  const base = path.basename(filePath);
  const lower = base.toLowerCase();
  if (TEXT_BASENAMES.has(lower)) return true;
  if (lower.startsWith(".") && !lower.includes(".", 1)) return true; // .gitignore-style
  const ext = path.extname(lower);
  if (ext && TEXT_EXT.has(ext)) return true;
  // multi-dot configs like .eslintrc.cjs already covered by ext; bare .env.local:
  if (lower.startsWith(".env")) return true;
  return false;
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8_192);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export interface FileEntry {
  path: string;
  label?: string;
  size: number;
  mtime?: number;
  kind: "file" | "dir";
  note?: string;
}

export interface FileGroup {
  name: string;
  entries: FileEntry[];
}

async function statEntry(
  p: string,
  label?: string,
  note?: string,
): Promise<FileEntry | undefined> {
  try {
    const st = await fs.promises.stat(p);
    return {
      path: p,
      label,
      size: st.size,
      mtime: st.mtimeMs,
      kind: st.isDirectory() ? "dir" : "file",
      note,
    };
  } catch {
    return undefined;
  }
}

/** Aggregate a directory tree into one entry (total size + file count). */
async function dirSummary(dir: string, label: string): Promise<FileEntry | undefined> {
  let count = 0;
  let size = 0;
  let mtime = 0;
  async function walk(d: string, depth: number): Promise<void> {
    if (depth > 4) return;
    let items: fs.Dirent[];
    try {
      items = await fs.promises.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      const p = path.join(d, it.name);
      if (it.isDirectory()) {
        await walk(p, depth + 1);
      } else {
        try {
          const st = await fs.promises.stat(p);
          count += 1;
          size += st.size;
          if (st.mtimeMs > mtime) mtime = st.mtimeMs;
        } catch {
          // skip
        }
      }
    }
  }
  try {
    await fs.promises.access(dir);
  } catch {
    return undefined;
  }
  await walk(dir, 0);
  return {
    path: dir,
    label,
    size,
    mtime: mtime || undefined,
    kind: "dir",
    note: `${count} files`,
  };
}

fileRoutes.get("/", async (c) => {
  const groups: FileGroup[] = [];

  // ---- threadle's own storage ----
  const threadleDir = threadleConfigDir();
  const threadleEntries: FileEntry[] = [];
  try {
    const graphFiles = await fs.promises.readdir(path.join(threadleDir, "graphs"));
    for (const name of graphFiles) {
      if (!name.endsWith(".json")) continue;
      const p = path.join(threadleDir, "graphs", name);
      let label: string | undefined;
      try {
        const parsed = JSON.parse(await fs.promises.readFile(p, "utf8")) as {
          name?: string;
        };
        label = parsed.name;
      } catch {
        label = undefined;
      }
      const entry = await statEntry(p, label, "workflow");
      if (entry) threadleEntries.push(entry);
    }
  } catch {
    // no graphs yet
  }
  const payloads = await dirSummary(path.join(threadleDir, "payloads"), "context payloads");
  if (payloads) threadleEntries.push(payloads);
  const favorites = await statEntry(
    path.join(threadleDir, "favorites.json"),
    "favorites",
    "config",
  );
  if (favorites) threadleEntries.push(favorites);
  const tmp = await dirSummary(path.join(threadleDir, "tmp"), "inject/agent temp files");
  if (tmp) threadleEntries.push(tmp);
  groups.push({ name: "threadle", entries: threadleEntries });

  // ---- claude code transcripts ----
  const claudeEntries: FileEntry[] = [];
  for (const d of await discoverSessions()) {
    const entry = await statEntry(d.transcriptPath, d.ref.title, "transcript");
    if (entry) claudeEntries.push(entry);
  }
  claudeEntries.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  groups.push({ name: "claude-code", entries: claudeEntries });

  // ---- opencode storage ----
  const ocEntries: FileEntry[] = [];
  const db = await statEntry(opencodeDbPath(), "sessions database", "sqlite (read-only)");
  if (db) ocEntries.push(db);
  const wal = await statEntry(`${opencodeDbPath()}-wal`, "write-ahead log");
  if (wal) ocEntries.push(wal);
  const spill = await dirSummary(
    path.join(opencodeDataDir(), "tool-output"),
    "spilled tool outputs",
  );
  if (spill) ocEntries.push(spill);
  groups.push({ name: "opencode", entries: ocEntries });

  // ---- cursor agent transcripts ----
  const cursorEntries: FileEntry[] = [];
  for (const d of await discoverCursorSessions()) {
    const entry = await statEntry(d.transcriptPath, d.ref.title, "transcript");
    if (entry) cursorEntries.push(entry);
  }
  cursorEntries.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  groups.push({ name: "cursor", entries: cursorEntries });

  // ---- antigravity transcripts ----
  const agyEntries: FileEntry[] = [];
  for (const d of await discoverAntigravitySessions()) {
    const entry = await statEntry(d.transcriptPath, d.ref.title, "transcript");
    if (entry) agyEntries.push(entry);
  }
  agyEntries.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  groups.push({ name: "antigravity", entries: agyEntries });

  // ---- codex rollouts ----
  const codexEntries: FileEntry[] = [];
  for (const d of await discoverCodexSessions()) {
    const entry = await statEntry(d.transcriptPath, d.ref.title, "transcript");
    if (entry) codexEntries.push(entry);
  }
  codexEntries.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  groups.push({ name: "codex", entries: codexEntries });

  // ---- copilot store + session-state ----
  const copilotEntries: FileEntry[] = [];
  const cpDb = await statEntry(copilotDbPath(), "sessions database", "sqlite (read-only)");
  if (cpDb) copilotEntries.push(cpDb);
  const cpWal = await statEntry(`${copilotDbPath()}-wal`, "write-ahead log");
  if (cpWal) copilotEntries.push(cpWal);
  for (const s of await discoverCopilotSessions()) {
    const yaml = path.join(copilotStateDir(), s.id, "workspace.yaml");
    const entry = await statEntry(yaml, s.title, "workspace");
    if (entry) copilotEntries.push(entry);
  }
  groups.push({ name: "copilot", entries: copilotEntries });

  // ---- grok sessions ----
  const grokEntries: FileEntry[] = [];
  for (const s of await discoverGrokSessions()) {
    const tp =
      typeof s.meta?.transcriptPath === "string"
        ? s.meta.transcriptPath
        : typeof s.meta?.sessionDir === "string"
          ? path.join(s.meta.sessionDir, "updates.jsonl")
          : undefined;
    if (!tp) continue;
    const entry = await statEntry(tp, s.title, "transcript");
    if (entry) grokEntries.push(entry);
  }
  grokEntries.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  groups.push({ name: "grok", entries: grokEntries });

  return c.json(groups);
});

/**
 * Read a local text file for the in-app viewer.
 * Caps at FILE_PREVIEW_MAX_BYTES; larger files return truncated content + truncated:true.
 */
fileRoutes.get("/read", async (c) => {
  const raw = c.req.query("path");
  if (!raw || typeof raw !== "string" || !isAbsolutePath(raw)) {
    return c.json({ error: "absolute path required" }, 400);
  }
  const target = path.resolve(raw);
  if (target.includes("\0") || target !== path.normalize(target)) {
    return c.json({ error: "invalid path" }, 400);
  }
  // reject path escape tricks after resolve
  if (raw.includes("\0")) return c.json({ error: "invalid path" }, 400);

  if (!(await isReadablePath(target))) {
    appLog("server", "file read denied — path not in allowed roots");
    return c.json({ error: "path not in allowed roots" }, 403);
  }

  let st: fs.Stats;
  try {
    st = await fs.promises.stat(target);
  } catch {
    return c.json({ error: "file not found" }, 404);
  }
  if (!st.isFile()) return c.json({ error: "not a regular file" }, 400);
  if (!isLikelyTextPath(target)) {
    return c.json({ error: "not a text file — open in your editor instead" }, 415);
  }

  const size = st.size;
  const truncated = size > FILE_PREVIEW_MAX_BYTES;
  const readLen = Math.min(size, FILE_PREVIEW_MAX_BYTES);
  const fh = await fs.promises.open(target, "r");
  let buf: Buffer;
  try {
    buf = Buffer.alloc(readLen);
    const { bytesRead } = await fh.read(buf, 0, readLen, 0);
    buf = buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }

  if (looksBinary(buf)) {
    return c.json({ error: "binary file — open in your editor instead" }, 415);
  }

  const content = buf.toString("utf8");
  return c.json({
    path: target,
    name: path.basename(target),
    size,
    truncated,
    previewMaxBytes: FILE_PREVIEW_MAX_BYTES,
    content,
  });
});

/** Lightweight existence check (stat only) for UI gray-out / missing badges. */
fileRoutes.get("/exists", async (c) => {
  const raw = c.req.query("path");
  if (!raw || typeof raw !== "string" || !isAbsolutePath(raw)) {
    return c.json({ error: "absolute path required" }, 400);
  }
  const target = path.resolve(raw);
  if (target.includes("\0") || target !== path.normalize(target) || raw.includes("\0")) {
    return c.json({ error: "invalid path" }, 400);
  }
  if (!(await isReadablePath(target))) {
    appLog("server", "file exists denied — path not in allowed roots");
    return c.json({ path: target, exists: false, denied: true }, 403);
  }
  try {
    const st = await fs.promises.stat(target);
    return c.json({ path: target, exists: st.isFile() });
  } catch {
    return c.json({ path: target, exists: false });
  }
});

/** File activity across every session: which files each session read/wrote. */
fileRoutes.get("/activity", async (c) => {
  const providers = [...registry.providers.values()];
  const lists = await Promise.all(
    providers.map(async (p) => {
      try {
        if (!(await p.available())) return [];
        return await p.listSessions();
      } catch {
        return [];
      }
    }),
  );
  const sessions = lists.flat();

  const activity = await Promise.all(
    sessions.map(async (ref) => {
      try {
        const files = await registry.get(ref.provider).getTouchedFiles(ref.id);
        return {
          provider: ref.provider,
          sessionId: ref.id,
          title: ref.title,
          projectDir: ref.projectDir,
          updatedAt: ref.updatedAt,
          files,
        };
      } catch {
        return {
          provider: ref.provider,
          sessionId: ref.id,
          title: ref.title,
          projectDir: ref.projectDir,
          updatedAt: ref.updatedAt,
          files: [],
        };
      }
    }),
  );
  activity.sort((a, b) => b.updatedAt - a.updatedAt);
  return c.json(activity);
});
