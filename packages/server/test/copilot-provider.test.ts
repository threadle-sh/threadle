import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CopilotProvider } from "../src/providers/copilot/index.js";
import { readCopilotTranscript } from "../src/providers/copilot/transcript.js";
import {
  discoverSessions,
  listSessionFiles,
} from "../src/providers/copilot/discover.js";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-copilot-"));
const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const projectDir = "/tmp/threadle-copilot-fixture-proj";
const prevHome = process.env.COPILOT_HOME;

function openWritableDb(dbPath: string): import("node:sqlite").DatabaseSync {
  const sqlite = process.getBuiltinModule(
    "node:sqlite",
  ) as typeof import("node:sqlite");
  return new sqlite.DatabaseSync(dbPath);
}

beforeAll(() => {
  process.env.COPILOT_HOME = tmpRoot;
  const stateDir = path.join(tmpRoot, "session-state", sessionId);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "workspace.yaml"),
    [
      `cwd: ${projectDir}`,
      "repository: zfarbp/threadle-fixture",
      "created_at: 2026-09-15T21:35:27.000Z",
      "updated_at: 2026-09-15T21:40:00.000Z",
      "",
    ].join("\n"),
  );

  const db = openWritableDb(path.join(tmpRoot, "session-store.db"));
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT,
      repository TEXT,
      host_type TEXT,
      branch TEXT,
      summary TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      turn_index INTEGER NOT NULL,
      user_message TEXT,
      assistant_response TEXT,
      timestamp TEXT,
      UNIQUE(session_id, turn_index)
    );
    CREATE TABLE session_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      tool_name TEXT,
      turn_index INTEGER,
      first_seen_at TEXT,
      UNIQUE(session_id, file_path)
    );
    CREATE TABLE assistant_usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      turn_index INTEGER,
      model TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      reasoning_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_write_tokens INTEGER
    );
  `);
  db.prepare(
    `INSERT INTO sessions (id, cwd, repository, summary, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    projectDir,
    "zfarbp/threadle-fixture",
    "Fixture Copilot",
    "2026-09-15T21:35:27.000Z",
    "2026-09-15T21:40:00.000Z",
  );
  db.prepare(
    `INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp)
     VALUES (?, 0, ?, ?, ?)`,
  ).run(sessionId, "hello copilot", "hi from copilot", "2026-09-15T21:35:28.000Z");
  db.prepare(
    `INSERT INTO session_files (session_id, file_path, tool_name, first_seen_at)
     VALUES (?, ?, ?, ?)`,
  ).run(sessionId, `${projectDir}/src/a.ts`, "edit", "2026-09-15T21:35:30.000Z");
  db.prepare(
    `INSERT INTO assistant_usage_events
       (session_id, turn_index, model, input_tokens, output_tokens, reasoning_tokens)
     VALUES (?, 0, ?, 100, 50, 10)`,
  ).run(sessionId, "gpt-5");
  db.close();
});

afterAll(() => {
  if (prevHome === undefined) delete process.env.COPILOT_HOME;
  else process.env.COPILOT_HOME = prevHome;
  fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe("copilot provider", () => {
  it("discovers sessions from session-store.db", async () => {
    const refs = await discoverSessions();
    expect(refs.some((r) => r.id === sessionId)).toBe(true);
    const hit = refs.find((r) => r.id === sessionId)!;
    expect(hit.provider).toBe("copilot");
    expect(hit.projectDir).toBe(projectDir);
    expect(hit.title).toBe("Fixture Copilot");
    expect(hit.messageCount).toBe(2);
  });

  it("reads transcript turns as normalized messages", () => {
    const msgs = readCopilotTranscript(sessionId);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe("user");
    expect(msgs[0]?.parts[0]?.text).toBe("hello copilot");
    expect(msgs[1]?.role).toBe("assistant");
    expect(msgs[1]?.parts[0]?.text).toBe("hi from copilot");
  });

  it("lists touched files from session_files", () => {
    const files = listSessionFiles(sessionId);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(`${projectDir}/src/a.ts`);
  });

  it("lists builtin agent and enriches token usage", async () => {
    const p = new CopilotProvider();
    const agents = await p.listAgents();
    expect(agents.some((a) => a.name === "copilot")).toBe(true);
    const sess = await p.getSession(sessionId);
    expect(sess?.tokensIn).toBe(100);
    expect(sess?.tokensOut).toBe(50);
    expect(sess?.tokensReasoning).toBe(10);
    expect(sess?.model).toBe("gpt-5");
  });
});
