import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SessionRef, SessionStatus } from "@threadle/shared";
import { scanSessionCached } from "./jsonl.js";
import { claudeUsageRows } from "../../routes/pricing.js";
import { readSettings } from "../../routes/settings.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
}

export function projectsDir(): string {
  return path.join(claudeHome(), "projects");
}

/** Best-effort reverse of the project dir slug; authoritative cwd comes from the transcript. */
export function deslugProjectDir(slug: string): string {
  return slug.replace(/-/g, "/");
}

interface HistoryIndexEntry {
  display: string;
  timestamp: number;
  project: string;
}

let historyCache: { mtimeMs: number; map: Map<string, HistoryIndexEntry> } | undefined;

/** sessionId → {first prompt, project} from ~/.claude/history.jsonl (cheap global index). */
export async function historyIndex(): Promise<Map<string, HistoryIndexEntry>> {
  const file = path.join(claudeHome(), "history.jsonl");
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    return new Map();
  }
  if (historyCache && historyCache.mtimeMs === stat.mtimeMs) return historyCache.map;
  const map = new Map<string, HistoryIndexEntry>();
  const content = await fs.promises.readFile(file, "utf8");
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as {
        display?: string;
        timestamp?: number;
        project?: string;
        sessionId?: string;
      };
      if (e.sessionId && !map.has(e.sessionId)) {
        map.set(e.sessionId, {
          display: e.display ?? "",
          timestamp: e.timestamp ?? 0,
          project: e.project ?? "",
        });
      }
    } catch {
      // skip bad lines
    }
  }
  historyCache = { mtimeMs: stat.mtimeMs, map };
  return map;
}

/** Live session statuses from ~/.claude/sessions/<pid>.json, filtered to live pids. */
export async function liveStatuses(): Promise<Map<string, SessionStatus>> {
  const dir = path.join(claudeHome(), "sessions");
  const out = new Map<string, SessionStatus>();
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await fs.promises.readFile(path.join(dir, name), "utf8");
      const info = JSON.parse(raw) as {
        pid?: number;
        sessionId?: string;
        status?: string;
      };
      if (!info.sessionId || !info.pid) continue;
      try {
        process.kill(info.pid, 0); // liveness probe only
      } catch {
        continue; // stale file, process gone
      }
      // Claude writes status on the registry file: idle | running | waiting.
      // A live PID with status "idle" is just an open terminal — not working.
      out.set(info.sessionId, mapClaudeLiveStatus(info.status));
    } catch {
      // unreadable/corrupt registry file
    }
  }
  return out;
}

/** Map Claude Code session-registry status → threadle SessionStatus.
 *  Claude's "idle" means the process is alive but not generating — surface as
 *  "live" so the UI can mark open terminals without claiming they're working. */
export function mapClaudeLiveStatus(raw: string | undefined): SessionStatus {
  switch (raw) {
    case "waiting":
      return "waiting";
    case "running":
      return "running";
    case "idle":
      return "live";
    default:
      // Unknown / missing: process is alive but we don't know — don't claim "running".
      return "unknown";
  }
}

export interface DiscoveredSession {
  ref: SessionRef;
  transcriptPath: string;
}

export async function discoverSessions(): Promise<DiscoveredSession[]> {
  const root = projectsDir();
  let projectDirs: string[];
  try {
    projectDirs = await fs.promises.readdir(root);
  } catch {
    return [];
  }
  const history = await historyIndex();
  const live = await liveStatuses();
  const billing = (await readSettings()).claudeBilling ?? "subscription";
  const out: DiscoveredSession[] = [];

  await Promise.all(
    projectDirs.map(async (slug) => {
      const dir = path.join(root, slug);
      let files: fs.Dirent[];
      try {
        files = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      await Promise.all(
        files.map(async (f) => {
          if (!f.isFile() || !f.name.endsWith(".jsonl")) return;
          const id = f.name.slice(0, -".jsonl".length);
          if (!UUID_RE.test(id)) return;
          const transcriptPath = path.join(dir, f.name);
          try {
            const scan = await scanSessionCached(transcriptPath);
            const hist = history.get(id);
            const stat = await fs.promises.stat(transcriptPath);
            const usage = await claudeUsageRows(scan.usageByModel);
            const actualCost =
              usage.total === undefined ? undefined : billing === "api" ? usage.total : 0;
            out.push({
              transcriptPath,
              ref: {
                provider: "claude-code",
                id,
                projectDir: scan.cwd ?? hist?.project ?? deslugProjectDir(slug),
                title: scan.title ?? hist?.display?.slice(0, 120) ?? undefined,
                model: scan.model,
                createdAt: scan.firstTimestamp,
                updatedAt: scan.lastTimestamp ?? stat.mtimeMs,
                status: live.get(id) ?? "idle",
                kind: "session",
                messageCount: scan.messageCount,
                tokensIn: scan.tokensIn,
                tokensOut: scan.tokensOut,
                tokensCacheRead: scan.tokensCacheRead,
                tokensCacheWrite: scan.tokensCacheWrite,
                cost: usage.total,
                actualCost,
                meta: {
                  slug,
                  gitBranch: scan.gitBranch,
                  permissionMode: scan.permissionMode,
                  planPath: scan.planFilePath,
                  planMode:
                    scan.permissionMode === "plan"
                      ? "plan"
                      : scan.planFilePath
                        ? "plan"
                        : undefined,
                  cliVersion: scan.cliVersion,
                  bridgeSessionId: scan.bridgeSessionId,
                  transcriptPath,
                  transcriptBytes: stat.size,
                  usageByModel: usage.rows.length ? usage.rows : undefined,
                  apiDurationMs: scan.apiDurationMs || undefined,
                  linesAdded: scan.linesAdded || undefined,
                  linesRemoved: scan.linesRemoved || undefined,
                },
              },
            });
          } catch {
            // unreadable transcript — skip
          }
        }),
      );
    }),
  );

  out.sort((a, b) => b.ref.updatedAt - a.ref.updatedAt);
  return out;
}

export async function findTranscriptPath(
  sessionId: string,
): Promise<string | undefined> {
  const root = projectsDir();
  let projectDirs: string[];
  try {
    projectDirs = await fs.promises.readdir(root);
  } catch {
    return undefined;
  }
  for (const slug of projectDirs) {
    const p = path.join(root, slug, `${sessionId}.jsonl`);
    try {
      await fs.promises.access(p);
      return p;
    } catch {
      // keep looking
    }
  }
  return undefined;
}
