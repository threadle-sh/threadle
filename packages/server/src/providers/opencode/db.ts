import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";

export function opencodeDataDir(): string {
  return (
    process.env.OPENCODE_DATA_DIR ??
    path.join(os.homedir(), ".local", "share", "opencode")
  );
}

export function opencodeDbPath(): string {
  return path.join(opencodeDataDir(), "opencode.db");
}

export interface SessionRow {
  id: string;
  slug: string | null;
  title: string | null;
  directory: string | null;
  parent_id: string | null;
  agent: string | null;
  model: string | null;
  cost: number | null;
  version: string | null;
  share_url: string | null;
  summary_additions: number | null;
  summary_deletions: number | null;
  summary_files: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  tokens_reasoning: number | null;
  tokens_cache_read: number | null;
  tokens_cache_write: number | null;
  time_created: number | null;
  time_updated: number | null;
}

export interface MessageRow {
  id: string;
  data: string;
}

export interface PartRow {
  message_id: string;
  data: string;
}

const REQUIRED_SESSION_COLUMNS = [
  "id",
  "title",
  "directory",
  "parent_id",
  "agent",
  "time_updated",
];

type SqliteDb = import("node:sqlite").DatabaseSync;

let db: SqliteDb | null | undefined; // undefined = untried, null = unusable

/** Test-only: close and forget the cached connection so OPENCODE_DATA_DIR can change. */
export function _resetDbForTests(): void {
  if (db) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
  db = undefined;
}

async function openDb(): Promise<SqliteDb | null> {
  if (db !== undefined) return db;
  try {
    if (!fs.existsSync(opencodeDbPath())) {
      db = null;
      return db;
    }
    // process.getBuiltinModule survives bundlers that mangle `import("node:sqlite")`
    const sqlite = process.getBuiltinModule(
      "node:sqlite",
    ) as typeof import("node:sqlite");
    const candidate = new sqlite.DatabaseSync(opencodeDbPath(), { readOnly: true });
    // schema gate: if the session table shape drifted, fall back to the CLI
    const cols = candidate
      .prepare("SELECT name FROM pragma_table_info('session')")
      .all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    if (!REQUIRED_SESSION_COLUMNS.every((c) => names.has(c))) {
      console.warn(
        "threadle: opencode.db session table schema unexpected; using `opencode db` CLI fallback",
      );
      candidate.close();
      db = null;
      return db;
    }
    db = candidate;
  } catch (err) {
    console.warn(`threadle: cannot open opencode.db directly (${String(err)}); using CLI fallback`);
    db = null;
  }
  return db;
}

async function cliQuery<T>(sql: string): Promise<T[]> {
  const { stdout } = await execa("opencode", ["db", "--format", "json", sql], {
    timeout: 30_000,
  });
  return JSON.parse(stdout || "[]") as T[];
}

/**
 * Run a read-only query, preferring the in-process readonly connection,
 * falling back to the `opencode db` CLI. Parameters must be pre-escaped;
 * use only trusted, internally-built SQL.
 */
export async function query<T>(sql: string, params: Array<string | number> = []): Promise<T[]> {
  const conn = await openDb();
  if (conn) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return conn.prepare(sql).all(...params) as T[];
      } catch (err) {
        const msg = String(err);
        if (msg.includes("BUSY") || msg.includes("LOCKED")) {
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
  }
  // CLI fallback can't do bound params — inline escaped literals
  const inlined = sql.replace(/\?/g, () => {
    const v = params.shift();
    return typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
  });
  return cliQuery<T>(inlined);
}

export async function dbAvailable(): Promise<boolean> {
  return fs.existsSync(opencodeDbPath());
}
