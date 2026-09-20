import fs from "node:fs";
import path from "node:path";
import type { SessionRef, SessionStatus, TouchedFile } from "@threadle/shared";
import { sessionStateDir, sessionStoreDbPath } from "./paths.js";

type SqliteDb = import("node:sqlite").DatabaseSync;

export interface CopilotSessionRow {
  id: string;
  cwd: string | null;
  repository: string | null;
  host_type: string | null;
  branch: string | null;
  summary: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CopilotTurnRow {
  turn_index: number;
  user_message: string | null;
  assistant_response: string | null;
  timestamp: string | null;
}

export interface CopilotFileRow {
  file_path: string;
  tool_name: string | null;
  first_seen_at: string | null;
}

function openDb(): SqliteDb | undefined {
  try {
    const sqlite = process.getBuiltinModule(
      "node:sqlite",
    ) as typeof import("node:sqlite");
    return new sqlite.DatabaseSync(sessionStoreDbPath(), { readOnly: true });
  } catch {
    return undefined;
  }
}

export function dbAvailable(): boolean {
  try {
    fs.accessSync(sessionStoreDbPath(), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function parseTime(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function rowToRef(row: CopilotSessionRow): SessionRef {
  const title =
    row.summary?.trim() ||
    (row.repository ? row.repository : undefined) ||
    `copilot ${row.id.slice(0, 8)}`;
  return {
    provider: "copilot",
    id: row.id,
    projectDir: row.cwd?.trim() || "",
    title,
    agent: "copilot",
    createdAt: parseTime(row.created_at),
    updatedAt: parseTime(row.updated_at) || parseTime(row.created_at),
    status: "unknown" as SessionStatus,
    kind: "session",
    meta: {
      repository: row.repository ?? undefined,
      hostType: row.host_type ?? undefined,
      branch: row.branch ?? undefined,
    },
  };
}

/** List sessions from session-store.db (preferred) and/or session-state dirs. */
export async function discoverSessions(): Promise<SessionRef[]> {
  const byId = new Map<string, SessionRef>();
  const msgCounts = new Map<string, number>();

  const db = openDb();
  if (db) {
    try {
      const rows = db
        .prepare(
          `SELECT id, cwd, repository, host_type, branch, summary, created_at, updated_at
           FROM sessions ORDER BY updated_at DESC`,
        )
        .all() as unknown as CopilotSessionRow[];
      for (const row of rows) {
        if (!row?.id) continue;
        byId.set(row.id, rowToRef(row));
      }
      try {
        const counts = db
          .prepare(
            `SELECT session_id AS id,
               SUM(
                 CASE WHEN user_message IS NOT NULL AND trim(user_message) != '' THEN 1 ELSE 0 END
               ) + SUM(
                 CASE WHEN assistant_response IS NOT NULL AND trim(assistant_response) != '' THEN 1 ELSE 0 END
               ) AS n
             FROM turns GROUP BY session_id`,
          )
          .all() as unknown as Array<{ id: string; n: number }>;
        for (const c of counts) {
          if (c?.id) msgCounts.set(c.id, Number(c.n) || 0);
        }
      } catch {
        /* turns table missing / churn */
      }
    } catch {
      /* schema churn — fall through to filesystem */
    } finally {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
  }

  try {
    const root = sessionStateDir();
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const id = e.name;
      if (byId.has(id)) continue;
      const yamlPath = path.join(root, id, "workspace.yaml");
      try {
        const raw = await fs.promises.readFile(yamlPath, "utf8");
        const cwd = /^cwd:\s*(.+)$/m.exec(raw)?.[1]?.trim();
        const repo = /^repository:\s*(.+)$/m.exec(raw)?.[1]?.trim();
        const created = /^created_at:\s*(.+)$/m.exec(raw)?.[1]?.trim();
        const updated = /^updated_at:\s*(.+)$/m.exec(raw)?.[1]?.trim();
        const st = await fs.promises.stat(yamlPath);
        byId.set(id, {
          provider: "copilot",
          id,
          projectDir: cwd || "",
          title: repo || `copilot ${id.slice(0, 8)}`,
          agent: "copilot",
          createdAt: parseTime(created) || st.birthtimeMs || st.mtimeMs,
          updatedAt: parseTime(updated) || st.mtimeMs,
          status: "unknown",
          kind: "session",
        });
      } catch {
        /* skip incomplete dirs */
      }
    }
  } catch {
    /* no session-state dir */
  }

  for (const ref of byId.values()) {
    const n = msgCounts.get(ref.id);
    if (n !== undefined && n > 0) ref.messageCount = n;
    // Expose events.jsonl when present (gates ≡ transcript via meta.transcriptPath)
    const eventsPath = path.join(sessionStateDir(), ref.id, "events.jsonl");
    try {
      await fs.promises.access(eventsPath, fs.constants.R_OK);
      ref.meta = { ...ref.meta, transcriptPath: eventsPath };
    } catch {
      /* no events file */
    }
  }

  return [...byId.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export async function getSessionRow(sessionId: string): Promise<SessionRef | undefined> {
  const all = await discoverSessions();
  return all.find((s) => s.id === sessionId);
}

export function listTurns(sessionId: string): CopilotTurnRow[] {
  const db = openDb();
  if (!db) return [];
  try {
    return db
      .prepare(
        `SELECT turn_index, user_message, assistant_response, timestamp
         FROM turns WHERE session_id = ? ORDER BY turn_index ASC`,
      )
      .all(sessionId) as unknown as CopilotTurnRow[];
  } catch {
    return [];
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

export function listSessionFiles(sessionId: string): TouchedFile[] {
  const db = openDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT file_path, tool_name, first_seen_at
         FROM session_files WHERE session_id = ? ORDER BY first_seen_at ASC`,
      )
      .all(sessionId) as unknown as CopilotFileRow[];
    return rows
      .filter((r) => r.file_path)
      .map((r) => ({
        path: r.file_path,
        op: "write" as const,
        lastSeenAt: parseTime(r.first_seen_at) || undefined,
      }));
  } catch {
    return [];
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

/** Detect in-use lock files under session-state/<id>/. */
export async function liveStatuses(): Promise<Map<string, SessionStatus>> {
  const map = new Map<string, SessionStatus>();
  try {
    const root = sessionStateDir();
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name);
      let locks: string[];
      try {
        locks = await fs.promises.readdir(dir);
      } catch {
        continue;
      }
      if (locks.some((n) => n.startsWith("inuse.") && n.endsWith(".lock"))) {
        map.set(e.name, "running");
      }
    }
  } catch {
    /* ignore */
  }
  return map;
}

export function childrenOf(_sessionId: string): SessionRef[] {
  return [];
}
