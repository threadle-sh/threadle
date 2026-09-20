import fs from "node:fs";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { ProviderId, SessionStatus } from "@threadle/shared";
import { bus } from "./events.js";
import { jobs } from "./jobs.js";
import { claudeHome } from "./providers/claude-code/discover.js";
import { projectsDir as cursorProjectsDir, chatsDir as cursorChatsDir } from "./providers/cursor/paths.js";
import { brainDir as antigravityBrainDir, summariesDbPath } from "./providers/antigravity/paths.js";
import { sessionsDir as codexSessionsDir } from "./providers/codex/paths.js";
import { sessionStoreDbPath as copilotSessionStoreDb } from "./providers/copilot/paths.js";
import { sessionsRoot as grokSessionsRoot } from "./providers/grok/paths.js";
import { registry } from "./providers/registry.js";
import { opencodeDbPath } from "./providers/opencode/db.js";

const watchers: FSWatcher[] = [];
let opencodePoll: ReturnType<typeof setInterval> | undefined;
let antigravityPoll: ReturnType<typeof setInterval> | undefined;
let copilotPoll: ReturnType<typeof setInterval> | undefined;
let livePoll: ReturnType<typeof setInterval> | undefined;
let jobReapPoll: ReturnType<typeof setInterval> | undefined;

function debounced(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

export function startWatchers(): void {
  // Claude Code: transcripts append → sessions.changed; sessions dir → live.status
  const projects = path.join(claudeHome(), "projects");
  if (fs.existsSync(projects)) {
    const emitChanged = debounced(
      () => bus.publish({ type: "sessions.changed", provider: "claude-code" }),
      500,
    );
    watchers.push(
      chokidar
        .watch(projects, {
          ignoreInitial: true,
          depth: 3,
          awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
        })
        .on("add", emitChanged)
        .on("change", emitChanged),
    );
  }

  const publishLive = async (): Promise<void> => {
    const statuses: Array<{ provider: ProviderId; id: string; status: SessionStatus }> = [];
    for (const p of registry.providers.values()) {
      try {
        const map = await p.liveStatuses();
        for (const [id, status] of map) {
          statuses.push({ provider: p.id, id, status });
        }
      } catch {
        // provider offline
      }
    }
    bus.publish({ type: "live.status", statuses });
  };

  // Poll so UI stays current even if a registry write is missed, and so
  // dead PIDs clear without waiting for an unlink event.
  void publishLive();
  livePoll = setInterval(() => void publishLive(), 2_000);

  // Reap client-driven jobs whose tab went away (see jobs.reapAbandoned) —
  // without this, zombie "running" jobs are unevictable from the registry.
  jobReapPoll = setInterval(() => jobs.reapAbandoned(), 60_000);

  const sessionsDir = path.join(claudeHome(), "sessions");
  if (fs.existsSync(sessionsDir)) {
    const emitStatus = debounced(() => void publishLive(), 500);
    watchers.push(
      chokidar
        .watch(sessionsDir, { ignoreInitial: true })
        .on("add", emitStatus)
        .on("change", emitStatus)
        .on("unlink", emitStatus),
    );
  }

  // Cursor Agent: transcripts under ~/.cursor/projects/*/agent-transcripts
  // (ignore sockets / worker files — chokidar crashes on unix sockets)
  const cursorProjects = cursorProjectsDir();
  if (fs.existsSync(cursorProjects)) {
    const emitCursor = debounced(
      () => bus.publish({ type: "sessions.changed", provider: "cursor" }),
      500,
    );
    watchers.push(
      chokidar
        .watch(path.join(cursorProjects, "**/agent-transcripts/**/*.jsonl"), {
          ignoreInitial: true,
          ignored: (p) => p.endsWith(".sock"),
          awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
        })
        .on("add", emitCursor)
        .on("change", emitCursor)
        .on("error", (err) => {
          console.warn(`threadle: cursor transcript watch error: ${String(err)}`);
        }),
    );
  }
  const cursorChats = cursorChatsDir();
  if (fs.existsSync(cursorChats)) {
    const emitCursorMeta = debounced(
      () => bus.publish({ type: "sessions.changed", provider: "cursor" }),
      800,
    );
    watchers.push(
      chokidar
        .watch(path.join(cursorChats, "**/meta.json"), {
          ignoreInitial: true,
          awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
        })
        .on("add", emitCursorMeta)
        .on("change", emitCursorMeta)
        .on("error", (err) => {
          console.warn(`threadle: cursor chats watch error: ${String(err)}`);
        }),
    );
  }

  // opencode: poll the WAL file mtime (chokidar on a sqlite WAL is too noisy)
  const wal = `${opencodeDbPath()}-wal`;
  let lastMtime = 0;
  opencodePoll = setInterval(() => {
    fs.promises
      .stat(wal)
      .then((s) => {
        if (lastMtime && s.mtimeMs !== lastMtime) {
          bus.publish({ type: "sessions.changed", provider: "opencode" });
        }
        lastMtime = s.mtimeMs;
      })
      .catch(() => {
        // no WAL — db idle
      });
  }, 3_000);

  // Antigravity: brain transcripts + summaries db mtime
  const agyBrain = antigravityBrainDir();
  if (fs.existsSync(agyBrain)) {
    const emitAgy = debounced(
      () => bus.publish({ type: "sessions.changed", provider: "antigravity" }),
      500,
    );
    watchers.push(
      chokidar
        .watch(path.join(agyBrain, "**/transcript*.jsonl"), {
          ignoreInitial: true,
          awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
        })
        .on("add", emitAgy)
        .on("change", emitAgy)
        .on("error", (err) => {
          console.warn(`threadle: antigravity transcript watch error: ${String(err)}`);
        }),
    );
  }
  const agySummaries = summariesDbPath();
  let agySumMtime = 0;
  antigravityPoll = setInterval(() => {
    fs.promises
      .stat(agySummaries)
      .then((s) => {
        if (agySumMtime && s.mtimeMs !== agySumMtime) {
          bus.publish({ type: "sessions.changed", provider: "antigravity" });
        }
        agySumMtime = s.mtimeMs;
      })
      .catch(() => {
        // db missing
      });
  }, 3_000);

  // Codex: rollout JSONL under ~/.codex/sessions/YYYY/MM/DD/
  const codexSessions = codexSessionsDir();
  if (fs.existsSync(codexSessions)) {
    const emitCodex = debounced(
      () => bus.publish({ type: "sessions.changed", provider: "codex" }),
      500,
    );
    watchers.push(
      chokidar
        .watch(path.join(codexSessions, "**/rollout-*.jsonl"), {
          ignoreInitial: true,
          awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
        })
        .on("add", emitCodex)
        .on("change", emitCodex)
        .on("error", (err) => {
          console.warn(`threadle: codex transcript watch error: ${String(err)}`);
        }),
    );
  }

  // Copilot: poll session-store.db WAL mtime (same pattern as opencode)
  const copilotWal = `${copilotSessionStoreDb()}-wal`;
  let copilotMtime = 0;
  copilotPoll = setInterval(() => {
    fs.promises
      .stat(copilotWal)
      .then((s) => {
        if (copilotMtime && s.mtimeMs !== copilotMtime) {
          bus.publish({ type: "sessions.changed", provider: "copilot" });
        }
        copilotMtime = s.mtimeMs;
      })
      .catch(() => {
        // no WAL — db idle or missing
      });
  }, 3_000);

  // Grok Build: watch session dirs under ~/.grok/sessions
  const grokRoot = grokSessionsRoot();
  if (fs.existsSync(grokRoot)) {
    const emitGrok = debounced(() => {
      bus.publish({ type: "sessions.changed", provider: "grok" });
    }, 400);
    watchers.push(
      chokidar
        .watch(grokRoot, {
          ignoreInitial: true,
          ignored: (p) =>
            p.endsWith(".lock") ||
            p.endsWith(".sqlite") ||
            p.endsWith("-wal") ||
            p.endsWith("-shm"),
          awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
          depth: 4,
        })
        .on("add", emitGrok)
        .on("change", emitGrok)
        .on("unlink", emitGrok)
        .on("error", (err) => {
          console.warn(`threadle: grok session watch error: ${String(err)}`);
        }),
    );
  }
}

export async function stopWatchers(): Promise<void> {
  if (opencodePoll) clearInterval(opencodePoll);
  if (antigravityPoll) clearInterval(antigravityPoll);
  if (copilotPoll) clearInterval(copilotPoll);
  if (livePoll) clearInterval(livePoll);
  if (jobReapPoll) clearInterval(jobReapPoll);
  opencodePoll = undefined;
  antigravityPoll = undefined;
  copilotPoll = undefined;
  livePoll = undefined;
  jobReapPoll = undefined;
  await Promise.all(watchers.map((w) => w.close()));
  watchers.length = 0;
}
