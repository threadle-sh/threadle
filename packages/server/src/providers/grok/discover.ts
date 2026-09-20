import fs from "node:fs";
import path from "node:path";
import type { SessionRef, SessionStatus, TouchedFile } from "@threadle/shared";
import { activeSessionsPath, sessionsRoot } from "./paths.js";
import { enrichSessionTokens } from "./usage.js";

interface GrokSummary {
  info?: { id?: string; cwd?: string };
  session_summary?: string;
  generated_title?: string;
  created_at?: string;
  updated_at?: string;
  last_active_at?: string;
  num_messages?: number;
  num_chat_messages?: number;
  current_model_id?: string;
  agent_name?: string;
  git_root_dir?: string;
}

interface ActiveEntry {
  session_id?: string;
  pid?: number;
  cwd?: string;
}

function parseTime(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function decodeCwdSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

async function readCwdHint(groupDir: string, slug: string): Promise<string> {
  const cwdFile = path.join(groupDir, ".cwd");
  try {
    const raw = (await fs.promises.readFile(cwdFile, "utf8")).trim();
    if (raw) return raw;
  } catch {
    /* no .cwd */
  }
  return decodeCwdSlug(slug);
}

function summaryToRef(
  summary: GrokSummary,
  sessionId: string,
  projectDir: string,
  sessionDir: string,
  st: fs.Stats,
): SessionRef {
  const title =
    summary.generated_title?.trim() ||
    summary.session_summary?.trim() ||
    `grok ${sessionId.slice(0, 8)}`;
  const updatedAt =
    parseTime(summary.last_active_at) ||
    parseTime(summary.updated_at) ||
    st.mtimeMs;
  const createdAt = parseTime(summary.created_at) || st.birthtimeMs || updatedAt;
  const messageCount =
    typeof summary.num_messages === "number"
      ? summary.num_messages
      : typeof summary.num_chat_messages === "number"
        ? summary.num_chat_messages
        : undefined;

  const ref: SessionRef = {
    provider: "grok",
    id: sessionId,
    projectDir:
      summary.info?.cwd?.trim() ||
      summary.git_root_dir?.trim()?.replace(/\/$/, "") ||
      projectDir,
    title,
    agent: summary.agent_name?.trim() || "grok",
    model: summary.current_model_id,
    createdAt,
    updatedAt,
    status: "unknown",
    kind: "session",
    messageCount,
    meta: {
      transcriptPath: path.join(sessionDir, "updates.jsonl"),
      sessionDir,
    },
  };
  attachGrokPlanMeta(ref, sessionDir);
  return enrichSessionTokens(ref, sessionDir);
}

/** Attach plan.md path + plan_mode.json state when present (Grok Build plan mode). */
function attachGrokPlanMeta(ref: SessionRef, sessionDir: string): void {
  const planPath = path.join(sessionDir, "plan.md");
  try {
    if (fs.existsSync(planPath) && fs.statSync(planPath).isFile()) {
      ref.meta = { ...ref.meta, planPath };
    }
  } catch {
    /* skip */
  }
  try {
    const raw = fs.readFileSync(path.join(sessionDir, "plan_mode.json"), "utf8");
    const pm = JSON.parse(raw) as Record<string, unknown>;
    if (pm && typeof pm === "object") {
      ref.meta = {
        ...ref.meta,
        planMode:
          typeof pm.state === "string"
            ? pm.state
            : "active",
        planAwaitingApproval: pm.awaiting_plan_approval === true,
      };
    }
  } catch {
    /* no plan mode */
  }
}

/** Walk `~/.grok/sessions/<urlencoded-cwd>/<session-id>/`. */
export async function discoverSessions(): Promise<SessionRef[]> {
  const root = sessionsRoot();
  const byId = new Map<string, SessionRef>();
  let groups: fs.Dirent[];
  try {
    groups = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const g of groups) {
    if (!g.isDirectory()) continue;
    if (g.name.startsWith(".")) continue;
    const groupDir = path.join(root, g.name);
    const projectDir = await readCwdHint(groupDir, g.name);
    let sessions: fs.Dirent[];
    try {
      sessions = await fs.promises.readdir(groupDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const s of sessions) {
      if (!s.isDirectory()) continue;
      const sessionId = s.name;
      const sessionDir = path.join(groupDir, sessionId);
      const summaryPath = path.join(sessionDir, "summary.json");
      try {
        const raw = await fs.promises.readFile(summaryPath, "utf8");
        const summary = JSON.parse(raw) as GrokSummary;
        const id = summary.info?.id?.trim() || sessionId;
        const st = await fs.promises.stat(summaryPath);
        byId.set(id, summaryToRef(summary, id, projectDir, sessionDir, st));
      } catch {
        /* skip incomplete / churn */
      }
    }
  }

  return [...byId.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export async function getSessionRow(sessionId: string): Promise<SessionRef | undefined> {
  const all = await discoverSessions();
  return all.find((s) => s.id === sessionId);
}

/** Resolve on-disk session directory for a session id. */
export async function resolveSessionDir(sessionId: string): Promise<string | undefined> {
  const ref = await getSessionRow(sessionId);
  const dir = ref?.meta?.sessionDir;
  return typeof dir === "string" ? dir : undefined;
}

export async function childrenOf(sessionId: string): Promise<SessionRef[]> {
  const parentDir = await resolveSessionDir(sessionId);
  if (!parentDir) return [];
  const subDir = path.join(parentDir, "subagents");
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(subDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: SessionRef[] = [];
  for (const e of entries) {
    if (!e.isDirectory() && !e.isFile()) continue;
    // meta.json or child id dirs — prefer linking via discover by child id in meta
    if (e.name === "meta.json" || e.name.endsWith(".json")) {
      try {
        const raw = await fs.promises.readFile(path.join(subDir, e.name), "utf8");
        const meta = JSON.parse(raw) as { session_id?: string; id?: string };
        const childId = meta.session_id || meta.id;
        if (!childId) continue;
        const child = await getSessionRow(childId);
        if (child) {
          child.parentId = sessionId;
          child.kind = "subagent-run";
          out.push(child);
        }
      } catch {
        /* skip */
      }
      continue;
    }
    if (e.isDirectory()) {
      try {
        const metaPath = path.join(subDir, e.name, "meta.json");
        const raw = await fs.promises.readFile(metaPath, "utf8");
        const meta = JSON.parse(raw) as { session_id?: string; id?: string };
        const childId = meta.session_id || meta.id || e.name;
        const child = await getSessionRow(childId);
        if (child) {
          child.parentId = sessionId;
          child.kind = "subagent-run";
          out.push(child);
        }
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

/** Live = listed in active_sessions.json with a still-running pid. */
export async function liveStatuses(): Promise<Map<string, SessionStatus>> {
  const map = new Map<string, SessionStatus>();
  try {
    const raw = await fs.promises.readFile(activeSessionsPath(), "utf8");
    const list = JSON.parse(raw) as ActiveEntry[];
    if (!Array.isArray(list)) return map;
    for (const entry of list) {
      const id = entry.session_id?.trim();
      if (!id) continue;
      const pid = entry.pid;
      if (typeof pid === "number" && pid > 0) {
        try {
          process.kill(pid, 0);
          map.set(id, "running");
        } catch {
          /* dead */
        }
      } else {
        map.set(id, "live");
      }
    }
  } catch {
    /* missing */
  }
  return map;
}

/** Best-effort touched files: session `plan.md` + paths from updates.jsonl tool calls. */
export async function listSessionFiles(sessionId: string): Promise<TouchedFile[]> {
  const dir = await resolveSessionDir(sessionId);
  if (!dir) return [];
  const byPath = new Map<string, TouchedFile>();

  const planPath = path.join(dir, "plan.md");
  try {
    const st = await fs.promises.stat(planPath);
    if (st.isFile()) {
      byPath.set(planPath, {
        path: planPath,
        op: "write",
        lastSeenAt: st.mtimeMs,
        bytes: st.size,
      });
    }
  } catch {
    /* no plan */
  }

  const updatesPath = path.join(dir, "updates.jsonl");
  let fh: fs.promises.FileHandle | undefined;
  try {
    fh = await fs.promises.open(updatesPath, "r");
    const stream = fh.createReadStream({ encoding: "utf8" });
    let buf = "";
    for await (const chunk of stream) {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line) as {
            params?: {
              update?: Record<string, unknown>;
              _meta?: { agentTimestampMs?: number };
            };
          };
          const update = row.params?.update;
          if (!update) continue;
          const kind = update.sessionUpdate;
          if (kind !== "tool_call" && kind !== "tool_call_update") continue;
          ingestGrokToolUpdate(byPath, update, row.params?._meta?.agentTimestampMs);
        } catch {
          /* skip line */
        }
      }
    }
  } catch {
    /* missing / unreadable updates */
  } finally {
    await fh?.close().catch(() => undefined);
  }

  return [...byPath.values()].sort((a, b) =>
    (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0) || a.path.localeCompare(b.path),
  );
}

function ingestGrokToolUpdate(
  byPath: Map<string, TouchedFile>,
  update: Record<string, unknown>,
  agentTs?: number,
): void {
  const title = typeof update.title === "string" ? update.title : "";
  const rawInput =
    update.rawInput && typeof update.rawInput === "object"
      ? (update.rawInput as Record<string, unknown>)
      : undefined;
  const metaTool =
    update._meta &&
    typeof update._meta === "object" &&
    (update._meta as { "x.ai/tool"?: Record<string, unknown> })["x.ai/tool"];

  const toolName =
    (typeof metaTool?.name === "string" && metaTool.name) ||
    title.split(/\s/)[0] ||
    "";
  const toolKind = typeof metaTool?.kind === "string" ? metaTool.kind : undefined;

  const paths = new Set<string>();
  const push = (p: unknown) => {
    if (typeof p === "string" && p.trim() && !p.startsWith("<")) paths.add(p.trim());
  };
  push(rawInput?.target_file);
  push(rawInput?.path);
  push(rawInput?.file_path);
  if (metaTool?.input && typeof metaTool.input === "object") {
    push((metaTool.input as { path?: unknown }).path);
  }
  if (Array.isArray(update.locations)) {
    for (const loc of update.locations) {
      if (loc && typeof loc === "object") push((loc as { path?: unknown }).path);
    }
  }
  if (paths.size === 0) return;

  const op = grokToolOp(toolName, toolKind);
  const ts = typeof agentTs === "number" && Number.isFinite(agentTs) ? agentTs : undefined;
  for (const p of paths) {
    const prev = byPath.get(p);
    if (prev) {
      // Prefer write/edit over read when both seen
      if (opRank(op) >= opRank(prev.op)) prev.op = op;
      if (ts != null && (prev.lastSeenAt == null || ts >= prev.lastSeenAt)) {
        prev.lastSeenAt = ts;
      }
    } else {
      byPath.set(p, { path: p, op, lastSeenAt: ts });
    }
  }
}

function grokToolOp(
  toolName: string,
  toolKind?: string,
): TouchedFile["op"] {
  const n = toolName.toLowerCase();
  const k = (toolKind ?? "").toLowerCase();
  if (n.includes("read") || k === "read" || n === "list_dir" || n === "grep") return "read";
  if (n.includes("search_replace") || n.includes("edit") || k === "edit") return "edit";
  if (n.includes("write") || n.includes("create") || k === "write") return "write";
  if (n.includes("delete") || k === "delete") return "delete";
  return "edit";
}

function opRank(op: TouchedFile["op"]): number {
  switch (op) {
    case "read":
      return 0;
    case "edit":
    case "patch":
      return 1;
    case "write":
    case "create":
      return 2;
    case "delete":
      return 3;
    default:
      return 0;
  }
}

export function sessionsRootAvailable(): boolean {
  try {
    fs.accessSync(sessionsRoot(), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
