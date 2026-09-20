/**
 * Golden provider fixtures — known record types still parse; unknown types skip.
 * Update these when a real session-bundle shows a new upstream shape.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { scanSession } from "../src/providers/claude-code/jsonl.js";
import { readThread, readAllMessages } from "../src/providers/claude-code/thread.js";
import { readCursorTranscript } from "../src/providers/cursor/jsonl.js";
import { readCodexTranscript } from "../src/providers/codex/jsonl.js";
import { readAntigravityTranscript } from "../src/providers/antigravity/jsonl.js";
import { _resetDbForTests } from "../src/providers/opencode/db.js";
import { readOpencodeTranscript } from "../src/providers/opencode/normalize.js";
import { discoverSessions } from "../src/providers/grok/discover.js";
import { readGrokTranscript } from "../src/providers/grok/transcript.js";

const fixturesRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "providers",
);

function fixture(...parts: string[]): string {
  return path.join(fixturesRoot, ...parts);
}

describe("provider golden fixtures", () => {
  describe("claude-code", () => {
    const file = fixture("claude-code", "session.jsonl");

    it("scans known types and ignores unknown / corrupt lines", async () => {
      const scan = await scanSession(file);
      expect(scan.messageCount).toBeGreaterThanOrEqual(3);
      expect(scan.model).toBe("claude-sonnet-4");
      expect(scan.cwd).toBe("/tmp/threadle-claude-fixture");
      expect(scan.cliVersion).toBe("1.0.0");
      expect(scan.tokensIn).toBeGreaterThan(0);
    });

    it("reads thread leaf and skips unknown content blocks", async () => {
      const thread = await readThread(file);
      expect(thread.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
      const asst = thread[1]!;
      expect(asst.parts.some((p) => p.type === "text")).toBe(true);
      expect(asst.parts.some((p) => p.type === "tool_use")).toBe(true);
      expect(asst.parts.every((p) => p.type !== "unknown_block")).toBe(true);
    });

    it("readAllMessages does not throw on unknown record types", async () => {
      const all = await readAllMessages(file);
      expect(all.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("cursor", () => {
    it("normalizes role messages and skips control / unknown", async () => {
      const msgs = await readCursorTranscript(fixture("cursor", "transcript.jsonl"));
      expect(msgs.length).toBeGreaterThanOrEqual(2);
      expect(msgs[0]?.role).toBe("user");
      expect(msgs.some((m) => m.parts.some((p) => p.type === "tool_use"))).toBe(true);
    });
  });

  describe("codex", () => {
    it("normalizes response_item messages and skips unknown_future", async () => {
      const msgs = await readCodexTranscript(fixture("codex", "rollout.jsonl"));
      expect(msgs.length).toBe(2);
      expect(msgs[0]?.role).toBe("user");
      expect(msgs[1]?.role).toBe("assistant");
    });
  });

  describe("antigravity", () => {
    it("normalizes known steps and skips UNKNOWN_FUTURE_STEP", async () => {
      const msgs = await readAntigravityTranscript(
        fixture("antigravity", "transcript_full.jsonl"),
      );
      expect(msgs.length).toBe(2);
      expect(msgs[0]?.role).toBe("user");
      expect(msgs[1]?.role).toBe("assistant");
    });
  });

  describe("opencode", () => {
    let tmpDir: string | undefined;

    afterEach(() => {
      _resetDbForTests();
      if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
        tmpDir = undefined;
      }
      delete process.env.OPENCODE_DATA_DIR;
    });

    it("reads known part types and skips unknown from fixture schema", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-oc-fix-"));
      process.env.OPENCODE_DATA_DIR = tmpDir;
      _resetDbForTests();

      const raw = JSON.parse(
        fs.readFileSync(fixture("opencode", "session.json"), "utf8"),
      ) as {
        sessionId: string;
        directory: string;
        title: string;
        messages: Array<{
          id: string;
          data: Record<string, unknown>;
          parts: Array<Record<string, unknown>>;
        }>;
      };

      const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
      const dbPath = path.join(tmpDir, "opencode.db");
      const db = new sqlite.DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE session (
          id TEXT PRIMARY KEY,
          slug TEXT,
          title TEXT,
          directory TEXT,
          parent_id TEXT,
          agent TEXT,
          model TEXT,
          cost REAL,
          version TEXT,
          share_url TEXT,
          summary_additions INTEGER,
          summary_deletions INTEGER,
          summary_files INTEGER,
          tokens_input INTEGER,
          tokens_output INTEGER,
          tokens_reasoning INTEGER,
          tokens_cache_read INTEGER,
          tokens_cache_write INTEGER,
          time_created INTEGER,
          time_updated INTEGER
        );
        CREATE TABLE message (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          data TEXT,
          time_created INTEGER
        );
        CREATE TABLE part (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id TEXT,
          session_id TEXT,
          data TEXT
        );
      `);
      db.prepare(
        `INSERT INTO session (id, title, directory, parent_id, agent, time_created, time_updated)
         VALUES (?, ?, ?, NULL, NULL, ?, ?)`,
      ).run(raw.sessionId, raw.title, raw.directory, 1726400000000, 1726400001000);

      for (const m of raw.messages) {
        db.prepare(
          `INSERT INTO message (id, session_id, data, time_created) VALUES (?, ?, ?, ?)`,
        ).run(
          m.id,
          raw.sessionId,
          JSON.stringify(m.data),
          (m.data.time as { created?: number } | undefined)?.created ?? 0,
        );
        for (const p of m.parts) {
          db.prepare(
            `INSERT INTO part (message_id, session_id, data) VALUES (?, ?, ?)`,
          ).run(m.id, raw.sessionId, JSON.stringify(p));
        }
      }
      db.close();

      const msgs = await readOpencodeTranscript(raw.sessionId);
      expect(msgs).toHaveLength(2);
      expect(msgs[0]?.parts.some((p) => p.type === "text" && p.text?.includes("hello"))).toBe(
        true,
      );
      expect(msgs[1]?.parts.some((p) => p.type === "thinking")).toBe(true);
      expect(msgs[1]?.parts.some((p) => p.type === "tool_use")).toBe(true);
      expect(msgs[1]?.parts.some((p) => p.type === "tool_result")).toBe(true);
      // unknown_future_part must not appear as a content part
      expect(
        msgs.every((m) =>
          m.parts.every((p) => !("unknown_future_part" === (p as { type?: string }).type)),
        ),
      ).toBe(true);
    });
  });

  describe("grok", () => {
    const prevHome = process.env.GROK_HOME;
    const planId = "01a0b4cb-89b1-7272-9175-a4b4e5ebd857";
    const updatesOnlyId = "c3d4e5f6-7890-4bcd-ef01-222222222222";

    afterEach(() => {
      if (prevHome === undefined) delete process.env.GROK_HOME;
      else process.env.GROK_HOME = prevHome;
    });

    it("discovers sessions and skips unknown chat / update types", async () => {
      process.env.GROK_HOME = fixture("grok");
      const refs = await discoverSessions();
      expect(refs.length).toBe(3);
      const msgs = await readGrokTranscript(planId);
      expect(msgs.length).toBeGreaterThanOrEqual(4);
      expect(msgs.every((m) => m.role === "user" || m.role === "assistant")).toBe(true);
      // unknown_future_record / backend_tool_call / tool_result must not surface
      expect(
        msgs.every((m) =>
          m.parts.every((p) => p.type === "text" || p.type === "thinking"),
        ),
      ).toBe(true);
    });

    it("falls back to updates.jsonl when chat_history is absent", async () => {
      process.env.GROK_HOME = fixture("grok");
      const msgs = await readGrokTranscript(updatesOnlyId);
      expect(msgs.some((m) => m.parts.some((p) => p.text?.includes("updates only")))).toBe(true);
      expect(msgs.some((m) => m.parts.some((p) => p.text?.includes("reply from updates.jsonl")))).toBe(
        true,
      );
    });
  });
});
