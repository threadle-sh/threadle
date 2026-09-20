import fs from "node:fs";
import path from "node:path";
import type { SessionRef, SessionStatus } from "@threadle/shared";
import {
  countCodexMessages,
  firstUserPrompt,
  readSessionMeta,
} from "./jsonl.js";
import { archivedSessionsDir, sessionsDir } from "./paths.js";
import { resolveCodexUsage } from "./usage.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DiscoveredCodexSession {
  ref: SessionRef;
  transcriptPath: string;
}

/** Extract session UUID from `rollout-<ts>-<uuid>.jsonl` (or with rollout suffix). */
export function sessionIdFromFilename(name: string): string | undefined {
  const base = name.replace(/\.jsonl$/i, "");
  // rollout-2026-08-10T13-02-51-<uuid> or …-<uuid>_<rolloutId>
  const m = base.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_[0-9a-f-]+)?$/i,
  );
  return m?.[1];
}

async function walkRollouts(root: string): Promise<string[]> {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) {
      out.push(full);
      continue;
    }
    if (!e.isDirectory()) continue;
    // YYYY/MM/DD tree or flat archived
    if (/^\d{4}$/.test(e.name) || /^\d{2}$/.test(e.name)) {
      out.push(...(await walkRollouts(full)));
    } else if (e.name.startsWith("rollout-")) {
      // unlikely dir
    } else {
      // one more level for archived or unexpected nesting
      try {
        const nested = await fs.promises.readdir(full, { withFileTypes: true });
        for (const n of nested) {
          if (n.isFile() && n.name.startsWith("rollout-") && n.name.endsWith(".jsonl")) {
            out.push(path.join(full, n.name));
          }
        }
      } catch {
        // skip
      }
    }
  }
  return out;
}

async function buildRef(
  transcriptPath: string,
): Promise<DiscoveredCodexSession | undefined> {
  const name = path.basename(transcriptPath);
  let id = sessionIdFromFilename(name);
  const meta = await readSessionMeta(transcriptPath);
  if (meta?.id && UUID_RE.test(meta.id)) id = meta.id;
  if (!id || !UUID_RE.test(id)) return undefined;

  let st: fs.Stats;
  try {
    st = await fs.promises.stat(transcriptPath);
  } catch {
    return undefined;
  }

  const prompt = await firstUserPrompt(transcriptPath);
  const messageCount = await countCodexMessages(transcriptPath);
  const usage = await resolveCodexUsage(transcriptPath).catch(() => undefined);
  const title =
    meta?.title?.trim() ||
    (prompt ? prompt.replace(/\s+/g, " ").slice(0, 80) : undefined) ||
    `codex ${id.slice(0, 8)}`;

  const ref: SessionRef = {
    provider: "codex",
    id,
    projectDir: meta?.cwd?.trim() || "",
    title,
    model: meta?.model,
    agent: "codex",
    createdAt: st.birthtimeMs || st.mtimeMs,
    updatedAt: st.mtimeMs,
    status: "unknown" as SessionStatus,
    kind: "session",
    messageCount,
    tokensIn: usage?.tokensIn,
    tokensOut: usage?.tokensOut,
    tokensReasoning: usage?.tokensReasoning,
    meta: {
      transcriptPath,
      tokenSource: usage?.source,
    },
  };
  return { ref, transcriptPath };
}

let cache: { at: number; sessions: DiscoveredCodexSession[] } | undefined;
const CACHE_TTL_MS = 4_000;

export function invalidateDiscoverCache(): void {
  cache = undefined;
}

export async function discoverSessions(force = false): Promise<DiscoveredCodexSession[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.sessions;

  const files = [
    ...(await walkRollouts(sessionsDir())),
    ...(await walkRollouts(archivedSessionsDir())),
  ];
  // prefer newest path per id (active over archived if same id)
  const byId = new Map<string, DiscoveredCodexSession>();
  const built = await Promise.all(files.map((f) => buildRef(f)));
  for (const d of built) {
    if (!d) continue;
    const prev = byId.get(d.ref.id);
    if (!prev || d.ref.updatedAt >= prev.ref.updatedAt) byId.set(d.ref.id, d);
  }
  const sessions = [...byId.values()].sort((a, b) => b.ref.updatedAt - a.ref.updatedAt);
  cache = { at: Date.now(), sessions };
  return sessions;
}

export async function findTranscriptPath(sessionId: string): Promise<string | undefined> {
  const all = await discoverSessions();
  return all.find((d) => d.ref.id === sessionId)?.transcriptPath;
}

export async function childrenOf(
  _all: DiscoveredCodexSession[],
  _sessionId: string,
): Promise<SessionRef[]> {
  // Codex rollouts don't expose a stable parent/child link we can parse yet
  return [];
}

export async function liveStatuses(): Promise<Map<string, SessionStatus>> {
  return new Map();
}
