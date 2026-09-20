import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { SessionRef, SessionStatus } from "@threadle/shared";
import { countCursorMessages } from "./jsonl.js";
import { chatsDir, deslugProjectDir, projectsDir, transcriptPath } from "./paths.js";
import { agentBin } from "./agent-bin.js";
import { linkTaskChildren } from "./subagents.js";
import { invalidateUsageCache, resolveCursorUsage } from "./usage.js";
import { resolveCursorPlanPath, invalidateCursorPlanIndex } from "./plan.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CursorSessionMeta {
  title?: string;
  cwd?: string;
  createdAtMs?: number;
  updatedAtMs?: number;
  model?: string;
}

export interface DiscoveredCursorSession {
  ref: SessionRef;
  transcriptPath: string;
  projectSlug: string;
}

interface MetaCache {
  at: number;
  byId: Map<string, CursorSessionMeta>;
}

let metaCache: MetaCache | undefined;
const META_TTL_MS = 5_000;

/** Index all ~/.cursor/chats/<hash>/<uuid>/meta.json by session uuid. */
export async function loadChatMetaIndex(): Promise<Map<string, CursorSessionMeta>> {
  if (metaCache && Date.now() - metaCache.at < META_TTL_MS) return metaCache.byId;
  const byId = new Map<string, CursorSessionMeta>();
  const root = chatsDir();
  let hashes: string[];
  try {
    hashes = await fs.promises.readdir(root);
  } catch {
    metaCache = { at: Date.now(), byId };
    return byId;
  }
  for (const hash of hashes) {
    const hashDir = path.join(root, hash);
    let entries: string[];
    try {
      const st = await fs.promises.stat(hashDir);
      if (!st.isDirectory()) continue;
      entries = await fs.promises.readdir(hashDir);
    } catch {
      continue;
    }
    for (const id of entries) {
      if (!UUID_RE.test(id)) continue;
      const metaFile = path.join(hashDir, id, "meta.json");
      try {
        const raw = JSON.parse(await fs.promises.readFile(metaFile, "utf8")) as {
          title?: string;
          cwd?: string;
          createdAtMs?: number;
          updatedAtMs?: number;
        };
        // model lives in store.db meta (encrypted); not available here
        byId.set(id, {
          title: typeof raw.title === "string" ? raw.title : undefined,
          cwd: typeof raw.cwd === "string" ? raw.cwd : undefined,
          createdAtMs: typeof raw.createdAtMs === "number" ? raw.createdAtMs : undefined,
          updatedAtMs: typeof raw.updatedAtMs === "number" ? raw.updatedAtMs : undefined,
        });
      } catch {
        // skip unreadable meta
      }
    }
  }
  metaCache = { at: Date.now(), byId };
  return byId;
}

let discoverCache:
  | { at: number; sessions: DiscoveredCursorSession[] }
  | undefined;
const DISCOVER_TTL_MS = 3_000;

export async function discoverSessions(): Promise<DiscoveredCursorSession[]> {
  if (discoverCache && Date.now() - discoverCache.at < DISCOVER_TTL_MS) {
    return discoverCache.sessions;
  }
  const meta = await loadChatMetaIndex();
  const live = await liveStatuses();
  const sessions: DiscoveredCursorSession[] = [];
  const root = projectsDir();
  let slugs: string[];
  try {
    slugs = await fs.promises.readdir(root);
  } catch {
    discoverCache = { at: Date.now(), sessions };
    return sessions;
  }

  for (const slug of slugs) {
    const transcriptsRoot = path.join(root, slug, "agent-transcripts");
    let ids: string[];
    try {
      const st = await fs.promises.stat(transcriptsRoot);
      if (!st.isDirectory()) continue;
      ids = await fs.promises.readdir(transcriptsRoot);
    } catch {
      continue;
    }
    for (const id of ids) {
      if (!UUID_RE.test(id)) continue;
      const tPath = transcriptPath(slug, id);
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(tPath);
      } catch {
        continue;
      }
      const m = meta.get(id);
      const projectDir = m?.cwd || deslugProjectDir(slug);
      let messageCount: number | undefined;
      try {
        messageCount = await countCursorMessages(tPath);
      } catch {
        messageCount = undefined;
      }
      let usage: Awaited<ReturnType<typeof resolveCursorUsage>>;
      try {
        usage = await resolveCursorUsage(id, tPath);
      } catch {
        usage = undefined;
      }
      const planPath = await resolveCursorPlanPath(id).catch(() => undefined);
      const ref: SessionRef = {
        provider: "cursor",
        id,
        projectDir,
        title: m?.title,
        model: m?.model,
        createdAt: m?.createdAtMs ?? stat.birthtimeMs,
        updatedAt: m?.updatedAtMs ?? stat.mtimeMs,
        status: live.get(id) ?? "idle",
        kind: "session",
        messageCount,
        tokensIn: usage?.tokensIn,
        tokensOut: usage?.tokensOut,
        tokensReasoning: usage?.tokensReasoning,
        tokensCacheRead: usage?.tokensCacheRead,
        tokensCacheWrite: usage?.tokensCacheWrite,
        // subscription-billed; no list-price usage in the public JSONL
        actualCost: 0,
        meta: {
          ...(usage ? { tokenSource: usage.source } : {}),
          ...(planPath
            ? { planPath, planMode: "plan", transcriptPath: tPath }
            : { transcriptPath: tPath }),
        },
      };
      sessions.push({ ref, transcriptPath: tPath, projectSlug: slug });
    }
  }

  sessions.sort((a, b) => b.ref.updatedAt - a.ref.updatedAt);
  await linkTaskChildren(sessions);
  discoverCache = { at: Date.now(), sessions };
  return sessions;
}

export async function findTranscriptPath(sessionId: string): Promise<string | undefined> {
  const all = await discoverSessions();
  return all.find((d) => d.ref.id === sessionId)?.transcriptPath;
}

/** How recently a transcript must have been written to count as live. */
const CURSOR_LIVE_WINDOW_MS = 90_000;

/**
 * Live Cursor chats.
 * Prefer `agent persist list` when tmux persist is available; always also
 * treat recently-written agent transcripts as running (IDE Composer chats
 * never appear in persist list).
 */
export async function liveStatuses(): Promise<Map<string, SessionStatus>> {
  const map = new Map<string, SessionStatus>();

  try {
    const { stdout, exitCode } = await execa(agentBin(), ["persist", "list"], {
      timeout: 8_000,
      reject: false,
    });
    if (
      exitCode === 0 &&
      stdout &&
      !/persistence requires tmux/i.test(stdout)
    ) {
      for (const line of stdout.split("\n")) {
        const m = line.match(UUID_RE);
        if (m) map.set(m[0], "running");
      }
    }
  } catch {
    // CLI missing or persist unavailable
  }

  const cutoff = Date.now() - CURSOR_LIVE_WINDOW_MS;
  const root = projectsDir();
  let slugs: string[];
  try {
    slugs = await fs.promises.readdir(root);
  } catch {
    return map;
  }
  await Promise.all(
    slugs.map(async (slug) => {
      const transcriptsRoot = path.join(root, slug, "agent-transcripts");
      let ids: string[];
      try {
        const st = await fs.promises.stat(transcriptsRoot);
        if (!st.isDirectory()) return;
        ids = await fs.promises.readdir(transcriptsRoot);
      } catch {
        return;
      }
      await Promise.all(
        ids.map(async (id) => {
          if (!UUID_RE.test(id)) return;
          try {
            const st = await fs.promises.stat(transcriptPath(slug, id));
            if (st.mtimeMs >= cutoff) map.set(id, "running");
          } catch {
            // missing transcript
          }
        }),
      );
    }),
  );

  return map;
}

export function invalidateDiscoverCache(): void {
  discoverCache = undefined;
  metaCache = undefined;
  invalidateUsageCache();
  invalidateCursorPlanIndex();
}
