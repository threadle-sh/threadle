import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanUserContent,
  countAntigravityMessages,
  readAntigravityTranscript,
} from "../src/providers/antigravity/jsonl.js";
import { readAntigravityTouchedFiles } from "../src/providers/antigravity/files.js";
import {
  discoverSessions,
  invalidateDiscoverCache,
} from "../src/providers/antigravity/discover.js";
import { AntigravityProvider } from "../src/providers/antigravity/index.js";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-agy-"));
const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const projectDir = "/tmp/threadle-agy-fixture-proj";

const transcriptLines = [
  {
    step_index: 0,
    source: "USER_EXPLICIT",
    type: "USER_INPUT",
    status: "DONE",
    created_at: "2026-09-15T21:35:27Z",
    content:
      "<USER_REQUEST>\nhello antigravity\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nmeta\n</ADDITIONAL_METADATA>",
  },
  {
    step_index: 1,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    created_at: "2026-09-15T21:35:28Z",
    content: "Working on [proj](file:///tmp/threadle-agy-fixture-proj/src/a.ts) today.",
  },
  {
    step_index: 2,
    type: "UNKNOWN_FUTURE_STEP",
    content: "should be skipped",
  },
];

function writeFixture(): void {
  const tDir = path.join(
    tmpRoot,
    "brain",
    sessionId,
    ".system_generated",
    "logs",
  );
  fs.mkdirSync(tDir, { recursive: true });
  fs.writeFileSync(
    path.join(tDir, "transcript_full.jsonl"),
    transcriptLines.map((l) => JSON.stringify(l)).join("\n"),
  );

  // Minimal summaries db via node:sqlite
  const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  const dbPath = path.join(tmpRoot, "conversation_summaries.db");
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT DEFAULT '',
      preview TEXT DEFAULT '',
      step_count INTEGER DEFAULT 0,
      last_modified_time TEXT,
      workspace_uris TEXT,
      status TEXT DEFAULT '',
      agent_name TEXT DEFAULT '',
      parent_conversation_id TEXT DEFAULT ''
    );
  `);
  db.prepare(
    `INSERT INTO conversation_summaries
      (conversation_id, title, preview, step_count, last_modified_time, workspace_uris, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    "Fixture Chat",
    "hello antigravity",
    2,
    "2026-09-15 21:35:29.000000+00:00",
    JSON.stringify([`file://${projectDir}`]),
    "CASCADE_RUN_STATUS_IDLE",
  );
  db.close();

  fs.mkdirSync(path.join(tmpRoot, "cache"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRoot, "cache", "last_conversations.json"),
    JSON.stringify({ [projectDir]: sessionId }),
  );
}

beforeAll(() => {
  process.env.ANTIGRAVITY_HOME = tmpRoot;
  writeFixture();
  invalidateDiscoverCache();
});

afterAll(() => {
  delete process.env.ANTIGRAVITY_HOME;
  fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe("antigravity jsonl", () => {
  it("strips USER_REQUEST wrappers", () => {
    expect(
      cleanUserContent(
        "<USER_REQUEST>\nhello\n</USER_REQUEST>\n<ADDITIONAL_METADATA>x</ADDITIONAL_METADATA>",
      ),
    ).toBe("hello");
  });

  it("normalizes known step types and skips unknown", async () => {
    const tPath = path.join(
      tmpRoot,
      "brain",
      sessionId,
      ".system_generated",
      "logs",
      "transcript_full.jsonl",
    );
    const msgs = await readAntigravityTranscript(tPath);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("user");
    expect(msgs[0]!.parts[0]).toEqual({ type: "text", text: "hello antigravity" });
    expect(msgs[1]!.role).toBe("assistant");
    expect(await countAntigravityMessages(tPath)).toBe(2);
  });

  it("harvests file:// links as touched reads", async () => {
    const tPath = path.join(
      tmpRoot,
      "brain",
      sessionId,
      ".system_generated",
      "logs",
      "transcript_full.jsonl",
    );
    const files = await readAntigravityTouchedFiles(tPath);
    expect(files).toEqual([
      { path: "/tmp/threadle-agy-fixture-proj/src/a.ts", op: "read" },
    ]);
  });
});

describe("antigravity discover", () => {
  it("joins brain transcripts with conversation_summaries", async () => {
    invalidateDiscoverCache();
    const sessions = await discoverSessions();
    expect(sessions).toHaveLength(1);
    const ref = sessions[0]!.ref;
    expect(ref.provider).toBe("antigravity");
    expect(ref.id).toBe(sessionId);
    expect(ref.projectDir).toBe(projectDir);
    expect(ref.title).toBe("Fixture Chat");
    expect(ref.status).toBe("idle");
    expect(ref.messageCount).toBe(2);
    expect(ref.tokensIn).toBeGreaterThan(0);
    expect(ref.meta?.tokenSource).toBe("estimate");
  });
});

describe("AntigravityProvider", () => {
  it("lists sessions and reads transcript", async () => {
    const p = new AntigravityProvider();
    expect(await p.available()).toBe(true);
    const sessions = await p.listSessions();
    expect(sessions.map((s) => s.id)).toEqual([sessionId]);
    const msgs = await p.getTranscript(sessionId);
    expect(msgs[0]!.parts[0]?.text).toBe("hello antigravity");
  });
});
