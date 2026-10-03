import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import {
  deslugProjectDir,
  projectsDir,
} from "../providers/claude-code/discover.js";
import { grokHome, sessionsRoot as grokSessionsRoot } from "../providers/grok/paths.js";
import { codexHome } from "../providers/codex/paths.js";
import { pathContained } from "../path-safe.js";
import { FILE_PREVIEW_MAX_BYTES } from "./files.js";

export type MemoryProvider = "claude-code" | "grok" | "codex";

export type MemoryEntryKind =
  | "index"
  | "topic"
  | "observation"
  | "archive"
  | "stage1"
  | "other";

export interface MemoryEntry {
  provider: MemoryProvider;
  scope: string;
  slug: string;
  path: string;
  name: string;
  bytes: number;
  /** Epoch milliseconds */
  mtime: number;
  kind: MemoryEntryKind;
}

export const CODEX_MEMORY_PREFIX = "codex-memory:";

function claudeKind(name: string): MemoryEntryKind {
  if (name === "MEMORY.md") return "index";
  if (name.endsWith(".md")) return "topic";
  return "other";
}

function grokKind(relPosix: string): MemoryEntryKind {
  const base = relPosix.split("/").pop() ?? relPosix;
  if (base === "MEMORY.md") return "index";
  if (relPosix.includes("/archive/") || relPosix.startsWith("archive/")) {
    return "archive";
  }
  if (relPosix.includes("/observations/") || relPosix.startsWith("observations/")) {
    return "observation";
  }
  if (relPosix.includes("/topics/") || relPosix.startsWith("topics/")) {
    return "topic";
  }
  if (base.endsWith(".md")) return "topic";
  return "other";
}

function codexFsKind(relPosix: string): MemoryEntryKind {
  const base = relPosix.split("/").pop() ?? relPosix;
  if (base === "MEMORY.md") return "index";
  if (base.endsWith(".md")) return "topic";
  return "other";
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Recursive `.md` walk under `root`; skips `.git` and known junk names */
async function walkMdFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === ".git" || e.name === "phase2_workspace_diff.md") continue;
      const abs = path.join(dir, e.name);
      if (!pathContained(abs, root) && abs !== root) continue;
      if (e.isDirectory()) {
        await walk(abs);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        out.push(abs);
      }
    }
  }
  await walk(root);
  return out;
}

function openSqliteReadonly(dbPath: string): import("node:sqlite").DatabaseSync | null {
  try {
    if (!fs.existsSync(dbPath)) return null;
    const sqlite = process.getBuiltinModule(
      "node:sqlite",
    ) as typeof import("node:sqlite");
    return new sqlite.DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
}

/** Read-only scan of Claude Code auto-memory trees under projects/<slug>/memory/ */
export async function listClaudeMemory(): Promise<MemoryEntry[]> {
  const root = projectsDir();
  let slugs: string[];
  try {
    slugs = await fs.promises.readdir(root);
  } catch {
    return [];
  }

  const out: MemoryEntry[] = [];
  await Promise.all(
    slugs.map(async (slug) => {
      const memoryRoot = path.join(root, slug, "memory");
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(memoryRoot, { withFileTypes: true });
      } catch {
        return;
      }
      const scope = deslugProjectDir(slug);
      for (const e of entries) {
        if (!e.isFile()) continue;
        const abs = path.join(memoryRoot, e.name);
        if (!pathContained(abs, memoryRoot)) continue;
        try {
          const st = await fs.promises.stat(abs);
          out.push({
            provider: "claude-code",
            scope,
            slug,
            path: abs,
            name: e.name,
            bytes: st.size,
            mtime: st.mtimeMs,
            kind: claudeKind(e.name),
          });
        } catch {
          // unreadable — skip
        }
      }
    }),
  );

  return out;
}

/**
 * Map Grok workspace slug → project cwd via session prompt_context.json
 * (`memory_workspace_path`).
 */
async function grokWorkspaceScopes(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const sessions = grokSessionsRoot();
  let encCwds: string[];
  try {
    encCwds = await fs.promises.readdir(sessions);
  } catch {
    return map;
  }
  await Promise.all(
    encCwds.map(async (enc) => {
      let cwd: string;
      try {
        cwd = decodeURIComponent(enc);
      } catch {
        cwd = enc;
      }
      const encDir = path.join(sessions, enc);
      let ids: string[];
      try {
        ids = await fs.promises.readdir(encDir);
      } catch {
        return;
      }
      for (const id of ids) {
        const ctxPath = path.join(encDir, id, "prompt_context.json");
        try {
          const raw = await fs.promises.readFile(ctxPath, "utf8");
          const j = JSON.parse(raw) as { memory_workspace_path?: string };
          const wp = j.memory_workspace_path;
          if (!wp || typeof wp !== "string") continue;
          const slug = path.basename(wp.replace(/\\/g, "/"));
          if (slug && !map.has(slug)) map.set(slug, cwd);
        } catch {
          // skip bad/missing
        }
      }
    }),
  );
  return map;
}

async function collectGrokRoot(
  memoryRoot: string,
  slug: string,
  scope: string,
  out: MemoryEntry[],
): Promise<void> {
  const files = await walkMdFiles(memoryRoot);
  for (const abs of files) {
    try {
      const st = await fs.promises.stat(abs);
      const rel = toPosix(path.relative(memoryRoot, abs));
      if (!rel || rel.startsWith("..")) continue;
      out.push({
        provider: "grok",
        scope,
        slug,
        path: abs,
        name: rel,
        bytes: st.size,
        mtime: st.mtimeMs,
        kind: grokKind(rel),
      });
    } catch {
      // skip
    }
  }
}

/** Read-only scan of Grok Build memory-v2 markdown trees */
export async function listGrokMemory(): Promise<MemoryEntry[]> {
  const base = path.join(grokHome(), "memory-v2");
  const out: MemoryEntry[] = [];
  const scopes = await grokWorkspaceScopes();

  await collectGrokRoot(path.join(base, "global"), "global", "global", out);

  const wsRoot = path.join(base, "workspaces");
  let slugs: string[];
  try {
    slugs = await fs.promises.readdir(wsRoot);
  } catch {
    return out;
  }
  await Promise.all(
    slugs.map(async (slug) => {
      const memoryRoot = path.join(wsRoot, slug);
      let st: fs.Stats;
      try {
        st = await fs.promises.stat(memoryRoot);
      } catch {
        return;
      }
      if (!st.isDirectory()) return;
      const scope = scopes.get(slug) ?? slug;
      await collectGrokRoot(memoryRoot, slug, scope, out);
    }),
  );

  return out;
}

type CodexThreadMeta = {
  cwd?: string;
  memoryMode?: string;
};

function loadCodexThreadMeta(): Map<string, CodexThreadMeta> {
  const map = new Map<string, CodexThreadMeta>();
  const db = openSqliteReadonly(path.join(codexHome(), "state_5.sqlite"));
  if (!db) return map;
  try {
    const cols = (
      db.prepare("SELECT name FROM pragma_table_info('threads')").all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    if (!cols.includes("id")) return map;
    const hasCwd = cols.includes("cwd");
    const hasMode = cols.includes("memory_mode");
    const select = [
      "id",
      hasCwd ? "cwd" : "NULL as cwd",
      hasMode ? "memory_mode" : "NULL as memory_mode",
    ].join(", ");
    const rows = db.prepare(`SELECT ${select} FROM threads`).all() as Array<{
      id: string;
      cwd: string | null;
      memory_mode: string | null;
    }>;
    for (const r of rows) {
      if (!r?.id) continue;
      map.set(r.id, {
        cwd: r.cwd ?? undefined,
        memoryMode: r.memory_mode ?? undefined,
      });
    }
  } catch {
    // schema churn — ignore
  } finally {
    try {
      db.close();
    } catch {
      /* */
    }
  }
  return map;
}

async function listCodexFsMemory(): Promise<MemoryEntry[]> {
  const root = path.join(codexHome(), "memories");
  const out: MemoryEntry[] = [];
  const files = await walkMdFiles(root);
  for (const abs of files) {
    try {
      const st = await fs.promises.stat(abs);
      const rel = toPosix(path.relative(root, abs));
      if (!rel || rel.startsWith("..")) continue;
      out.push({
        provider: "codex",
        scope: "global",
        slug: "memories",
        path: abs,
        name: rel,
        bytes: st.size,
        mtime: st.mtimeMs,
        kind: codexFsKind(rel),
      });
    } catch {
      // skip
    }
  }
  return out;
}

function listCodexStage1Memory(): MemoryEntry[] {
  const dbPath = path.join(codexHome(), "memories_1.sqlite");
  const db = openSqliteReadonly(dbPath);
  if (!db) return [];
  const meta = loadCodexThreadMeta();
  const out: MemoryEntry[] = [];
  try {
    const rows = db
      .prepare(
        `SELECT thread_id, source_updated_at, raw_memory, rollout_summary,
                rollout_slug, generated_at
         FROM stage1_outputs`,
      )
      .all() as Array<{
      thread_id: string;
      source_updated_at: number;
      raw_memory: string;
      rollout_summary: string;
      rollout_slug: string | null;
      generated_at: number;
    }>;
    for (const r of rows) {
      if (!r?.thread_id) continue;
      const raw = (r.raw_memory ?? "").trim();
      const summary = (r.rollout_summary ?? "").trim();
      if (!raw && !summary) continue;
      const t = meta.get(r.thread_id);
      if (t?.memoryMode && t.memoryMode !== "enabled") continue;
      // If we have a threads table and this id is absent, still show (join optional)
      const short = r.thread_id.slice(0, 8);
      const label = (r.rollout_slug && r.rollout_slug.trim()) || short;
      const sec = Number(r.generated_at) || Number(r.source_updated_at) || 0;
      out.push({
        provider: "codex",
        scope: t?.cwd || r.rollout_slug || r.thread_id,
        slug: r.thread_id,
        path: `${CODEX_MEMORY_PREFIX}${r.thread_id}`,
        name: `${label}.stage1.md`,
        bytes: Buffer.byteLength(r.raw_memory ?? "", "utf8"),
        mtime: sec > 1e12 ? sec : sec * 1000,
        kind: "stage1",
      });
    }
  } catch {
    // missing table / churn
  } finally {
    try {
      db.close();
    } catch {
      /* */
    }
  }
  return out;
}

/** Codex phase-2 markdown tree + stage-1 SQLite extracts */
export async function listCodexMemory(): Promise<MemoryEntry[]> {
  const [fsItems, stage1] = await Promise.all([
    listCodexFsMemory(),
    Promise.resolve(listCodexStage1Memory()),
  ]);
  return [...fsItems, ...stage1];
}

export async function listAllMemory(): Promise<MemoryEntry[]> {
  const [claude, grok, codex] = await Promise.all([
    listClaudeMemory(),
    listGrokMemory(),
    listCodexMemory(),
  ]);
  const out = [...claude, ...grok, ...codex];
  out.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
  return out;
}

export function readCodexStage1Content(
  threadId: string,
): { name: string; content: string; truncated: boolean; size: number } | undefined {
  const id = threadId.trim();
  if (!id || id.includes("/") || id.includes("\\") || id.includes("\0")) {
    return undefined;
  }
  const db = openSqliteReadonly(path.join(codexHome(), "memories_1.sqlite"));
  if (!db) return undefined;
  try {
    const row = db
      .prepare(
        `SELECT thread_id, raw_memory, rollout_summary, rollout_slug
         FROM stage1_outputs WHERE thread_id = ?`,
      )
      .get(id) as
      | {
          thread_id: string;
          raw_memory: string;
          rollout_summary: string;
          rollout_slug: string | null;
        }
      | undefined;
    if (!row) return undefined;
    const parts: string[] = [];
    const raw = row.raw_memory ?? "";
    const summary = row.rollout_summary ?? "";
    if (raw.trim()) {
      parts.push(raw.trimEnd());
    }
    if (summary.trim()) {
      parts.push("", "## Rollout summary", "", summary.trimEnd());
    }
    let content = parts.join("\n") || "(empty)";
    const size = Buffer.byteLength(content, "utf8");
    let truncated = false;
    if (size > FILE_PREVIEW_MAX_BYTES) {
      content = content.slice(0, FILE_PREVIEW_MAX_BYTES);
      truncated = true;
    }
    const short = row.thread_id.slice(0, 8);
    const label = (row.rollout_slug && row.rollout_slug.trim()) || short;
    return {
      name: `${label}.stage1.md`,
      content,
      truncated,
      size,
    };
  } catch {
    return undefined;
  } finally {
    try {
      db.close();
    } catch {
      /* */
    }
  }
}

export const memoryRoutes = new Hono();

memoryRoutes.get("/", async (c) => {
  const items = await listAllMemory();
  return c.json(items);
});

memoryRoutes.get("/content", async (c) => {
  const provider = c.req.query("provider")?.trim();
  const id = c.req.query("id")?.trim();
  if (provider !== "codex" || !id) {
    return c.json({ error: "provider=codex and id required" }, 400);
  }
  const body = readCodexStage1Content(id);
  if (!body) return c.json({ error: "not found" }, 404);
  return c.json({
    ...body,
    format: "markdown",
    previewMaxBytes: FILE_PREVIEW_MAX_BYTES,
  });
});
