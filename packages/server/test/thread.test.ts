import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readThread } from "../src/providers/claude-code/thread.js";
import { scanSession } from "../src/providers/claude-code/jsonl.js";

function writeFixture(lines: object[]): string {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "threadle-test-")),
    "session.jsonl",
  );
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n"), "utf8");
  return file;
}

const user = (uuid: string, parent: string | null, text: string) => ({
  type: "user",
  uuid,
  parentUuid: parent,
  timestamp: "2026-09-12T10:00:00Z",
  message: { role: "user", content: text },
});

const assistant = (uuid: string, parent: string, text: string) => ({
  type: "assistant",
  uuid,
  parentUuid: parent,
  timestamp: "2026-09-12T10:00:01Z",
  message: {
    role: "assistant",
    content: [{ type: "text", text }],
    usage: { input_tokens: 10, output_tokens: 5 },
  },
});

describe("readThread", () => {
  it("follows the leafUuid chain and drops abandoned branches", async () => {
    const file = writeFixture([
      user("u1", null, "first prompt"),
      assistant("a1", "u1", "first answer"),
      // abandoned branch (user rewound)
      user("u2-abandoned", "a1", "bad follow-up"),
      assistant("a2-abandoned", "u2-abandoned", "bad answer"),
      // active branch
      user("u2", "a1", "good follow-up"),
      assistant("a2", "u2", "good answer"),
      { type: "last-prompt", lastPrompt: "good follow-up", leafUuid: "a2" },
    ]);
    const thread = await readThread(file);
    expect(thread.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(thread[3]?.parts[0]?.text).toBe("good answer");
    expect(thread[3]?.tokens).toEqual({ input: 10, output: 5 });
  });

  it("falls back to file order without a last-prompt line", async () => {
    const file = writeFixture([
      user("u1", null, "hello"),
      assistant("a1", "u1", "hi"),
    ]);
    const thread = await readThread(file);
    expect(thread).toHaveLength(2);
  });

  it("skips sidechain entries and unknown line types", async () => {
    const file = writeFixture([
      { type: "ai-title", aiTitle: "My session" },
      { type: "some-future-type", data: 123 },
      user("u1", null, "hello"),
      { ...assistant("a-side", "u1", "sidechain"), isSidechain: true },
      assistant("a1", "u1", "hi"),
      { type: "last-prompt", leafUuid: "a1" },
    ]);
    const thread = await readThread(file);
    expect(thread.map((m) => m.id)).toEqual(["u1", "a1"]);
  });

  it("folds tool_result user entries into parts", async () => {
    const file = writeFixture([
      user("u1", null, "run it"),
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
          ],
        },
      },
      {
        type: "user",
        uuid: "u2",
        parentUuid: "a1",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "file.txt" },
          ],
        },
      },
      { type: "last-prompt", leafUuid: "u2" },
    ]);
    const thread = await readThread(file);
    expect(thread[1]?.parts[0]).toMatchObject({ type: "tool_use", toolName: "Bash" });
    expect(thread[2]?.parts[0]).toMatchObject({
      type: "tool_result",
      text: "file.txt",
    });
  });
});

describe("scanSession", () => {
  it("collects title, timestamps, counts", async () => {
    const file = writeFixture([
      { type: "ai-title", aiTitle: "Old title" },
      user("u1", null, "hello"),
      assistant("a1", "u1", "hi"),
      { type: "ai-title", aiTitle: "New title" },
    ]);
    const scan = await scanSession(file);
    expect(scan.title).toBe("New title"); // last one wins
    expect(scan.messageCount).toBe(2);
    expect(scan.firstTimestamp).toBeDefined();
  });
});
