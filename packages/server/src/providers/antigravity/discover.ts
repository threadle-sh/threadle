import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { SessionRef, SessionStatus } from "@threadle/shared";
import { isAbsolutePath } from "@threadle/shared";
import { countAntigravityMessages, firstUserPrompt } from "./jsonl.js";
import {
  brainDir,
  historyPath,
  lastConversationsPath,
  summariesDbPath,
  transcriptFullPath,
  transcriptPath,
} from "./paths.js";
import { resolveAntigravityUsage } from "./usage.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AntigravitySummary {
  title?: string;
  preview?: string;
  workspaceDir?: string;
  status?: SessionStatus;
  parentId?: string;
  agent?: string;
  updatedAtMs?: number;
  stepCount?: number;
}

export interface DiscoveredAntigravitySession {
  ref: SessionRef;
  transcriptPath: string;
}

type SqliteDb = import("node:sqlite").DatabaseSync;

let summaryCache: { at: number; byId: Map<string, AntigravitySummary> } | undefined;
const SUMMARY_TTL_MS = 5_000;

/** `file://` / `file:///C:/…` → platform path (Windows-safe). */
export function fileUriToPath(uri: string): string | undefined {
  if (!uri.startsWith("file:")) return undefined;
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

function parseWorkspaceUris(raw: string | null | undefined): string | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return undefined;
    for (const item of arr) {
      if (typeof item !== "string") continue;
      const p = fileUriToPath(item);
      if (p) return p;
    }
  } catch {
    // not JSON — ignore
  }
  return undefined;
}

function statusFromCascade(raw: string | null | undefined): SessionStatus {
  if (!raw) return "unknown";
  if (/BUSY|RUNNING|ACTIVE/i.test(raw)) return "running";
  if (/IDLE|DONE|SUCCESS|COMPLETE/i.test(raw)) return "idle";
  return "unknown";
}

function parseSummaryTime(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  // "2026-09-15 21:35:29.262117+00:00"
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : undefined;
}

async function loadSummariesFromDb(): Promise<Map<string, AntigravitySummary>> {
  const byId = new Map<string, AntigravitySummary>();
  const dbPath = summariesDbPath();
  if (!fs.existsSync(dbPath)) return byId;
  try {
    const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
    const db: SqliteDb = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db
        .prepare(
          `SELECT conversation_id, title, preview, step_count, last_modified_time,
                  workspace_uris, status, agent_name, parent_conversation_id
           FROM conversation_summaries`,
        )
        .all() as Array<{
        conversation_id: string;
        title: string;
        preview: string;
        step_count: number;
        last_modified_time: string;
        workspace_uris: string;
        status: string;
        agent_name: string;
        parent_conversation_id: string;
      }>;
      for (const row of rows) {
        if (!UUID_RE.test(row.conversation_id)) continue;
        byId.set(row.conversation_id, {
          title: row.title?.trim() || undefined,
          preview: row.preview?.trim() || undefined,
          workspaceDir: parseWorkspaceUris(row.workspace_uris),
          status: statusFromCascade(row.status),
          parentId: row.parent_conversation_id?.trim() || undefined,
          agent: row.agent_name?.trim() || undefined,
          updatedAtMs: parseSummaryTime(row.last_modified_time),
          stepCount: typeof row.step_count === "number" ? row.step_count : undefined,
        });
      }
    } finally {
      db.close();
    }
  } catch {
    // schema churn / locked — discover still works from brain dirs
  }
  return byId;
}

async function loadHistoryWorkspaces(): Promise<Map<string, string>> {
  const byId = new Map<string, string>();
  try {
    const text = await fs.promises.readFile(historyPath(), "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line) as {
          conversationId?: string;
          workspace?: string;
        };
        if (
          typeof o.conversationId === "string" &&
          UUID_RE.test(o.conversationId) &&
          typeof o.workspace === "string" &&
          isAbsolutePath(o.workspace)
        ) {
          byId.set(o.conversationId, o.workspace);
        }
      } catch {
        // skip
      }
    }
  } catch {
    // missing
  }
  return byId;
}

async function loadLastConversationDirs(): Promise<Map<string, string>> {
  /** conversationId → projectDir (inverted from last_conversations.json) */
  const byId = new Map<string, string>();
  try {
    const raw = JSON.parse(await fs.promises.readFile(lastConversationsPath(), "utf8")) as Record<
      string,
      string
    >;
    for (const [dir, id] of Object.entries(raw)) {
      if (isAbsolutePath(dir) && UUID_RE.test(id)) byId.set(id, dir);
    }
  } catch {
    // missing
  }
  return byId;
}

export async function loadSummaryIndex(): Promise<Map<string, AntigravitySummary>> {
  if (summaryCache && Date.now() - summaryCache.at < SUMMARY_TTL_MS) {
    return summaryCache.byId;
  }
  const byId = await loadSummariesFromDb();
  summaryCache = { at: Date.now(), byId };
  return byId;
}

let discoverCache: { at: number; sessions: DiscoveredAntigravitySession[] } | undefined;
const DISCOVER_TTL_MS = 3_000;

export function invalidateDiscoverCache(): void {
  discoverCache = undefined;
  summaryCache = undefined;
}

async function resolveTranscriptPath(id: string): Promise<string | undefined> {
  const full = transcriptFullPath(id);
  try {
    await fs.promises.access(full);
    return full;
  } catch {
    // fall through
  }
  const plain = transcriptPath(id);
  try {
    await fs.promises.access(plain);
    return plain;
  } catch {
    return undefined;
  }
}

export async function discoverSessions(): Promise<DiscoveredAntigravitySession[]> {
  if (discoverCache && Date.now() - discoverCache.at < DISCOVER_TTL_MS) {
    return discoverCache.sessions;
  }

  const summaries = await loadSummaryIndex();
  const historyWs = await loadHistoryWorkspaces();
  const lastDirs = await loadLastConversationDirs();
  const sessions: DiscoveredAntigravitySession[] = [];
  const root = brainDir();

  let ids: string[];
  try {
    ids = await fs.promises.readdir(root);
  } catch {
    discoverCache = { at: Date.now(), sessions };
    return sessions;
  }

  for (const id of ids) {
    if (!UUID_RE.test(id)) continue;
    const tPath = await resolveTranscriptPath(id);
    if (!tPath) continue;

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(tPath);
    } catch {
      continue;
    }

    const sum = summaries.get(id);
    const projectDir =
      sum?.workspaceDir || historyWs.get(id) || lastDirs.get(id) || "";
    const parentId = sum?.parentId || undefined;

    let messageCount: number | undefined;
    try {
      messageCount = await countAntigravityMessages(tPath);
    } catch {
      messageCount = sum?.stepCount;
    }

    let title = sum?.title || sum?.preview;
    if (!title) {
      try {
        title = (await firstUserPrompt(tPath))?.slice(0, 80);
      } catch {
        // leave undefined
      }
    }

    const usage = await resolveAntigravityUsage(id, tPath).catch(() => undefined);
    const updatedAt = sum?.updatedAtMs ?? Math.floor(stat.mtimeMs);
    const createdAt = Math.floor(stat.birthtimeMs || stat.ctimeMs || updatedAt);

    const ref: SessionRef = {
      provider: "antigravity",
      id,
      parentId,
      projectDir,
      title,
      agent: sum?.agent || undefined,
      createdAt,
      updatedAt,
      status: sum?.status ?? "idle",
      kind: parentId ? "subagent-run" : "session",
      messageCount,
      tokensIn: usage?.tokensIn,
      tokensOut: usage?.tokensOut,
      tokensReasoning: usage?.tokensReasoning,
      tokensCacheRead: usage?.tokensCacheRead,
      meta: {
        transcriptPath: tPath,
        tokenSource: usage?.source,
      },
    };

    sessions.push({ ref, transcriptPath: tPath });
  }

  sessions.sort((a, b) => b.ref.updatedAt - a.ref.updatedAt);
  discoverCache = { at: Date.now(), sessions };
  return sessions;
}

export async function findTranscriptPath(sessionId: string): Promise<string | undefined> {
  const all = await discoverSessions();
  return all.find((d) => d.ref.id === sessionId)?.transcriptPath ?? resolveTranscriptPath(sessionId);
}

export async function liveStatuses(): Promise<Map<string, SessionStatus>> {
  const map = new Map<string, SessionStatus>();
  const summaries = await loadSummaryIndex();
  for (const [id, sum] of summaries) {
    if (sum.status && sum.status !== "unknown") map.set(id, sum.status);
  }
  return map;
}

export function childrenOf(
  all: DiscoveredAntigravitySession[],
  parentId: string,
): SessionRef[] {
  return all.filter((d) => d.ref.parentId === parentId).map((d) => d.ref);
}
