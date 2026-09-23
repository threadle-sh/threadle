import fs from "node:fs";
import path from "node:path";
import type { SessionRef, SessionStatus, TouchedFile } from "@threadle/shared";
import { runtimeSessionsDir, sessionsRoot, sessionsRootAvailable } from "./paths.js";

type Json = Record<string, unknown>;

function microsToMs(us: unknown): number {
  if (typeof us !== "number" || !Number.isFinite(us)) return 0;
  // Muse timestamps are microseconds since epoch
  return us > 1e15 ? Math.floor(us / 1000) : Math.floor(us);
}

function asObj(v: unknown): Json | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined;
}

function* recordsFromLine(line: string): Generator<Json> {
  let outer: Json;
  try {
    outer = JSON.parse(line) as Json;
  } catch {
    return;
  }
  yield outer;
  const children = outer.children;
  if (!Array.isArray(children)) return;
  for (const ch of children) {
    const raw = asObj(ch)?.record_json;
    if (typeof raw !== "string") continue;
    try {
      yield JSON.parse(raw) as Json;
    } catch {
      /* skip */
    }
  }
}

export interface MuseSessionMeta {
  id: string;
  sessionDir: string;
  logPath: string;
  projectDir: string;
  title?: string;
  model?: string;
  parentId?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  tokensIn?: number;
  tokensOut?: number;
  tokensCacheRead?: number;
  tokensReasoning?: number;
  kind: "session" | "subagent-run";
}

async function scanLog(logPath: string): Promise<Partial<MuseSessionMeta> & { firstPrompt?: string }> {
  const out: Partial<MuseSessionMeta> & { firstPrompt?: string } = {};
  let raw: string;
  try {
    raw = await fs.promises.readFile(logPath, "utf8");
  } catch {
    return out;
  }
  let msgCount = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    for (const rj of recordsFromLine(line)) {
      const pt = typeof rj.payload_type === "string" ? rj.payload_type : "";
      const ts = microsToMs(rj.recorded_at);
      if (ts) {
        if (!out.createdAt || ts < out.createdAt) out.createdAt = ts;
        if (!out.updatedAt || ts > out.updatedAt) out.updatedAt = ts;
      }
      const payload = asObj(rj.payload) ?? {};
      const record = asObj(payload.record) ?? payload;

      if (pt === "runtime.session.metadata") {
        const root = record.workspace_root;
        if (typeof root === "string" && root.trim()) out.projectDir = root.trim();
      }
      if (pt === "runtime.session.route_facts") {
        const cwd = record.cwd;
        if (typeof cwd === "string" && cwd.trim() && !out.projectDir) {
          out.projectDir = cwd.trim();
        }
      }
      if (pt === "session.name.changed") {
        const name = payload.new_name;
        if (typeof name === "string" && name.trim()) out.title = name.trim();
      }
      if (pt === "run.model.configured") {
        const mid = record.model_id ?? record.display_label;
        if (typeof mid === "string" && mid.trim()) out.model = mid.trim();
      }
      if (pt === "runtime.user_intent.accepted") {
        msgCount += 1;
        if (!out.firstPrompt) {
          const blocks = payload.refill_blocks;
          if (Array.isArray(blocks)) {
            for (const b of blocks) {
              const t = asObj(b)?.text;
              if (typeof t === "string" && t.trim()) {
                out.firstPrompt = t.trim();
                break;
              }
            }
          }
        }
      }
      if (pt === "runtime.session") {
        const event = asObj(payload.event);
        if (payload.kind === "run" && event?.kind === "assistant_message_committed") {
          msgCount += 1;
        }
        if (payload.kind === "run" && event?.kind === "model_completed") {
          const usage = asObj(event.usage);
          if (usage) {
            const tin = usage.input_tokens;
            const tout = usage.output_tokens;
            const cache = usage.cache_read_tokens ?? usage.cached_tokens;
            const reason = usage.reasoning_tokens;
            if (typeof tin === "number") out.tokensIn = (out.tokensIn ?? 0) + tin;
            if (typeof tout === "number") out.tokensOut = (out.tokensOut ?? 0) + tout;
            if (typeof cache === "number") {
              out.tokensCacheRead = (out.tokensCacheRead ?? 0) + cache;
            }
            if (typeof reason === "number") {
              out.tokensReasoning = (out.tokensReasoning ?? 0) + reason;
            }
            if (typeof event.model === "string" && event.model.trim()) {
              out.model = event.model.trim();
            }
          }
        }
      }
    }
  }
  out.messageCount = msgCount;
  return out;
}

function toRef(meta: BuildMeta): SessionRef {
  const title =
    meta.title ||
    (meta.firstPrompt ? meta.firstPrompt.slice(0, 80) : undefined) ||
    `muse ${meta.id.slice(0, 8)}`;
  const ref: SessionRef = {
    provider: "muse",
    id: meta.id,
    projectDir: meta.projectDir || "",
    title,
    model: meta.model,
    createdAt: meta.createdAt || meta.updatedAt,
    updatedAt: meta.updatedAt || meta.createdAt || Date.now(),
    status: "idle",
    kind: meta.kind,
    messageCount: meta.messageCount,
    tokensIn: meta.tokensIn,
    tokensOut: meta.tokensOut,
    tokensCacheRead: meta.tokensCacheRead,
    tokensReasoning: meta.tokensReasoning,
    actualCost: 0,
    meta: {
      sessionDir: meta.sessionDir,
      logPath: meta.logPath,
      ...(meta.tokensIn !== undefined || meta.tokensOut !== undefined
        ? { tokenSource: "transcript" }
        : {}),
    },
  };
  if (meta.parentId) ref.parentId = meta.parentId;
  return ref;
}

type BuildMeta = MuseSessionMeta & { firstPrompt?: string };

const sessionCache = new Map<string, BuildMeta>();

async function collectSessionDirs(root: string): Promise<
  Array<{ id: string; sessionDir: string; logPath: string; parentId?: string }>
> {
  const out: Array<{ id: string; sessionDir: string; logPath: string; parentId?: string }> = [];
  async function walk(dir: string, parentId?: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const logPath = path.join(dir, "session.jsonl");
    try {
      await fs.promises.access(logPath, fs.constants.R_OK);
      const base = path.basename(dir);
      if (/^[0-9a-f-]{16,}$/i.test(base)) {
        out.push({ id: base, sessionDir: dir, logPath, parentId });
      }
    } catch {
      /* not a session dir */
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith(".")) continue;
      const child = path.join(dir, ent.name);
      if (ent.name === "subagent") {
        let kids: fs.Dirent[];
        try {
          kids = await fs.promises.readdir(child, { withFileTypes: true });
        } catch {
          continue;
        }
        // parent id from enclosing session dir
        const enclosing = path.basename(dir);
        const pid = /^[0-9a-f-]{16,}$/i.test(enclosing) ? enclosing : parentId;
        for (const k of kids) {
          if (k.isDirectory()) await walk(path.join(child, k.name), pid);
        }
      } else {
        await walk(child, parentId);
      }
    }
  }
  await walk(root);
  return out;
}

async function loadMeta(
  entry: { id: string; sessionDir: string; logPath: string; parentId?: string },
): Promise<BuildMeta> {
  const scanned = await scanLog(entry.logPath);
  let st: fs.Stats | undefined;
  try {
    st = await fs.promises.stat(entry.logPath);
  } catch {
    /* */
  }
  const updatedAt =
    scanned.updatedAt || st?.mtimeMs || Date.now();
  const createdAt = scanned.createdAt || st?.birthtimeMs || updatedAt;
  const meta: BuildMeta = {
    id: entry.id,
    sessionDir: entry.sessionDir,
    logPath: entry.logPath,
    projectDir: scanned.projectDir || "",
    title: scanned.title,
    model: scanned.model,
    parentId: entry.parentId,
    createdAt,
    updatedAt,
    messageCount: scanned.messageCount ?? 0,
    tokensIn: scanned.tokensIn,
    tokensOut: scanned.tokensOut,
    tokensCacheRead: scanned.tokensCacheRead,
    tokensReasoning: scanned.tokensReasoning,
    kind: entry.parentId ? "subagent-run" : "session",
    firstPrompt: scanned.firstPrompt,
  };
  sessionCache.set(entry.id, meta);
  return meta;
}

export async function discoverSessions(): Promise<SessionRef[]> {
  if (!sessionsRootAvailable()) return [];
  sessionCache.clear();
  const entries = await collectSessionDirs(sessionsRoot());
  // Top-level only for listSessions (exclude children — they come via listChildren)
  const tops = entries.filter((e) => !e.parentId);
  const refs: SessionRef[] = [];
  for (const e of tops) {
    refs.push(toRef(await loadMeta(e)));
  }
  // Still cache children for listChildren / getSession
  for (const e of entries.filter((x) => x.parentId)) {
    await loadMeta(e);
  }
  refs.sort((a, b) => b.updatedAt - a.updatedAt);
  return refs;
}

export async function childrenOf(sessionId: string): Promise<SessionRef[]> {
  if (!sessionsRootAvailable()) return [];
  if (sessionCache.size === 0) await discoverSessions();
  const kids = [...sessionCache.values()].filter((m) => m.parentId === sessionId);
  return kids.map(toRef).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSessionRow(sessionId: string): Promise<SessionRef | undefined> {
  if (sessionCache.has(sessionId)) return toRef(sessionCache.get(sessionId)!);
  if (!sessionsRootAvailable()) return undefined;
  const entries = await collectSessionDirs(sessionsRoot());
  const hit = entries.find((e) => e.id === sessionId);
  if (!hit) return undefined;
  return toRef(await loadMeta(hit));
}

export async function resolveSessionDir(sessionId: string): Promise<string | undefined> {
  if (sessionCache.has(sessionId)) return sessionCache.get(sessionId)!.sessionDir;
  await getSessionRow(sessionId);
  return sessionCache.get(sessionId)?.sessionDir;
}

export async function resolveLogPath(sessionId: string): Promise<string | undefined> {
  if (sessionCache.has(sessionId)) return sessionCache.get(sessionId)!.logPath;
  await getSessionRow(sessionId);
  return sessionCache.get(sessionId)?.logPath;
}

export async function liveStatuses(): Promise<Map<string, SessionStatus>> {
  const map = new Map<string, SessionStatus>();
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(runtimeSessionsDir(), { withFileTypes: true });
  } catch {
    return map;
  }
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith(".json")) continue;
    try {
      const raw = await fs.promises.readFile(
        path.join(runtimeSessionsDir(), ent.name),
        "utf8",
      );
      const row = JSON.parse(raw) as Json;
      const id = typeof row.session_id === "string" ? row.session_id : ent.name.replace(/\.json$/, "");
      const hint = typeof row.process_generation_hint === "string" ? row.process_generation_hint : "";
      const m = /pid=(\d+)/.exec(hint);
      if (m) {
        try {
          process.kill(Number(m[1]), 0);
          map.set(id, "live");
          continue;
        } catch {
          /* dead */
        }
      }
      if (row.target_eligibility === "message_capable") {
        map.set(id, "live");
      }
    } catch {
      /* skip */
    }
  }
  return map;
}

export async function listSessionFiles(sessionId: string): Promise<TouchedFile[]> {
  // MSP tool file paths are not yet stably attributed; return empty rather than invent.
  void sessionId;
  return [];
}

export { recordsFromLine, microsToMs, asObj };
