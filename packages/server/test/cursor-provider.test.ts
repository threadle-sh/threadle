import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readCursorTranscript, countCursorMessages } from "../src/providers/cursor/jsonl.js";
import { readCursorTouchedFiles } from "../src/providers/cursor/files.js";
import { discoverSessions, invalidateDiscoverCache } from "../src/providers/cursor/discover.js";
import { chatHash } from "../src/providers/cursor/paths.js";
import { CursorProvider } from "../src/providers/cursor/index.js";
import {
  normalizeCursorPrompt,
  extractTaskSpawns,
  firstUserPrompt,
} from "../src/providers/cursor/subagents.js";
import { estimateUsageFromTranscript } from "../src/providers/cursor/usage.js";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-cursor-"));
const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const childId = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
const projectDir = "/tmp/threadle-cursor-fixture-proj";
const projectSlug = "tmp-threadle-cursor-fixture-proj";

const taskPrompt = `Explore the threadle codebase at ${projectDir} to understand providers.`;

const transcriptLines = [
  {
    role: "user",
    message: {
      content: [{ type: "text", text: "<user_query>\nhello cursor\n</user_query>" }],
    },
  },
  {
    role: "assistant",
    message: {
      content: [
        { type: "text", text: "Working on it." },
        {
          type: "tool_use",
          name: "Read",
          input: { path: "/tmp/threadle-cursor-fixture-proj/src/a.ts" },
        },
        {
          type: "tool_use",
          name: "Write",
          input: {
            path: "/tmp/threadle-cursor-fixture-proj/src/b.ts",
            contents: "export const x = 1;\n",
          },
        },
        {
          type: "tool_use",
          name: "StrReplace",
          input: {
            path: "/tmp/threadle-cursor-fixture-proj/src/a.ts",
            old_string: "old",
            new_string: "new\nline",
          },
        },
        {
          type: "tool_use",
          id: "task-1",
          name: "Task",
          input: {
            description: "Explore providers",
            subagent_type: "explore",
            prompt: taskPrompt,
          },
        },
      ],
    },
  },
  { type: "turn_ended", status: "success" },
];

const childLines = [
  {
    role: "user",
    message: {
      content: [
        {
          type: "text",
          text: `<timestamp>Sunday, Sep 13, 2026, 11:05 PM (UTC+2)</timestamp>\n<user_query>\n${taskPrompt}\n</user_query>`,
        },
      ],
    },
  },
  {
    role: "assistant",
    message: {
      content: [{ type: "text", text: "Here is my report." }],
    },
  },
];

function writeTranscript(id: string, lines: unknown[]): void {
  const tDir = path.join(tmpRoot, "projects", projectSlug, "agent-transcripts", id);
  fs.mkdirSync(tDir, { recursive: true });
  fs.writeFileSync(
    path.join(tDir, `${id}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join("\n"),
  );
}

beforeAll(() => {
  process.env.CURSOR_CONFIG_DIR = tmpRoot;
  writeTranscript(sessionId, transcriptLines);
  writeTranscript(childId, childLines);

  const chatDir = path.join(tmpRoot, "chats", chatHash(projectDir), sessionId);
  fs.mkdirSync(chatDir, { recursive: true });
  fs.writeFileSync(
    path.join(chatDir, "meta.json"),
    JSON.stringify({
      schemaVersion: 1,
      title: "Fixture Chat",
      cwd: projectDir,
      createdAtMs: 1_700_000_000_000,
      updatedAtMs: 1_700_000_100_000,
      hasConversation: true,
    }),
  );
  invalidateDiscoverCache();
});

afterAll(() => {
  delete process.env.CURSOR_CONFIG_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe("cursor jsonl normalize", () => {
  it("reads role messages and skips turn_ended", async () => {
    const file = path.join(
      tmpRoot,
      "projects",
      projectSlug,
      "agent-transcripts",
      sessionId,
      `${sessionId}.jsonl`,
    );
    const msgs = await readCursorTranscript(file);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("user");
    expect(msgs[0]!.parts).toEqual([{ type: "text", text: "hello cursor" }]);
    expect(msgs[1]!.role).toBe("assistant");
    expect(msgs[1]!.parts.filter((p) => p.type === "tool_use")).toHaveLength(4);
    expect(await countCursorMessages(file)).toBe(2);
  });

  it("strips timestamp + user_query wrappers from user text", async () => {
    const file = path.join(tmpRoot, "scratch-user-format.jsonl");
    fs.writeFileSync(
      file,
      JSON.stringify({
        role: "user",
        message: {
          content: [
            {
              type: "text",
              text: "<timestamp>Wed</timestamp>\n<user_query>\nfix the formatting\nline two\n</user_query>",
            },
          ],
        },
      }) + "\n",
    );
    const msgs = await readCursorTranscript(file);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.parts[0]).toEqual({
      type: "text",
      text: "fix the formatting\nline two",
    });
  });
});

describe("cursor touched files", () => {
  it("records Read/Write/StrReplace ops", async () => {
    const file = path.join(
      tmpRoot,
      "projects",
      projectSlug,
      "agent-transcripts",
      sessionId,
      `${sessionId}.jsonl`,
    );
    const files = await readCursorTouchedFiles(file);
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
    expect(byPath["/tmp/threadle-cursor-fixture-proj/src/a.ts"]?.op).toBe("edit");
    expect(byPath["/tmp/threadle-cursor-fixture-proj/src/b.ts"]?.op).toBe("write");
  });
});

describe("cursor Task child linking", () => {
  it("normalizes wrappers so Task prompt matches child first user message", async () => {
    const parentFile = path.join(
      tmpRoot,
      "projects",
      projectSlug,
      "agent-transcripts",
      sessionId,
      `${sessionId}.jsonl`,
    );
    const childFile = path.join(
      tmpRoot,
      "projects",
      projectSlug,
      "agent-transcripts",
      childId,
      `${childId}.jsonl`,
    );
    const tasks = await extractTaskSpawns(parentFile);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.subagentType).toBe("explore");
    const childFirst = await firstUserPrompt(childFile);
    expect(normalizeCursorPrompt(tasks[0]!.prompt)).toBe(
      normalizeCursorPrompt(childFirst!),
    );
  });

  it("lists Task children under the parent and hides them from top-level", async () => {
    invalidateDiscoverCache();
    const provider = new CursorProvider();
    const top = await provider.listSessions();
    expect(top.map((s) => s.id)).toEqual([sessionId]);
    const children = await provider.listChildren(sessionId);
    expect(children).toHaveLength(1);
    expect(children[0]!.id).toBe(childId);
    expect(children[0]!.parentId).toBe(sessionId);
    expect(children[0]!.kind).toBe("subagent-run");
    expect(children[0]!.agent).toBe("explore");
    expect(children[0]!.title).toBe("Explore providers");
  });
});

describe("cursor discover", () => {
  it("joins transcript with chats meta and links Task children", async () => {
    invalidateDiscoverCache();
    const sessions = await discoverSessions();
    const parent = sessions.find((d) => d.ref.id === sessionId);
    expect(parent?.ref.title).toBe("Fixture Chat");
    expect(parent?.ref.projectDir).toBe(projectDir);
    const child = sessions.find((d) => d.ref.id === childId);
    expect(child?.ref.parentId).toBe(sessionId);
    expect(child?.ref.kind).toBe("subagent-run");
  });

  it("estimates tokens from transcript when no CLI usage is cached", async () => {
    invalidateDiscoverCache();
    const sessions = await discoverSessions();
    const parent = sessions.find((d) => d.ref.id === sessionId);
    expect(parent?.ref.tokensIn).toBeGreaterThan(0);
    expect(parent?.ref.tokensOut).toBeGreaterThan(0);
    expect(parent?.ref.meta?.tokenSource).toBe("estimate");
  });

  it("hashes cwd the same way Cursor does", () => {
    expect(chatHash("/Users/you/Projects/my-app")).toBe(
      crypto.createHash("md5").update("/Users/you/Projects/my-app").digest("hex"),
    );
  });
});

describe("cursor usage estimate", () => {
  it("ceil(chars/4) for user in and assistant out", async () => {
    const file = path.join(
      tmpRoot,
      "projects",
      projectSlug,
      "agent-transcripts",
      sessionId,
      `${sessionId}.jsonl`,
    );
    const usage = await estimateUsageFromTranscript(file);
    expect(usage?.source).toBe("estimate");
    // user_query text "hello cursor\n" inside wrappers — still counts full text blocks
    expect(usage!.tokensIn).toBeGreaterThan(0);
    expect(usage!.tokensOut).toBeGreaterThan(0);
  });

  it("splits thinking into tokensReasoning and reads turn_ended cache/reasoning", async () => {
    const id = "cccccccc-dddd-eeee-ffff-000000000001";
    const think = "x".repeat(40); // 10 tokens est
    writeTranscript(id, [
      {
        role: "user",
        message: { content: [{ type: "text", text: "hi" }] },
      },
      {
        role: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: think },
            { type: "text", text: "done" },
          ],
        },
      },
      {
        type: "turn_ended",
        status: "success",
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 15,
        cacheReadTokens: 50,
        cacheWriteTokens: 10,
      },
    ]);
    const file = path.join(
      tmpRoot,
      "projects",
      projectSlug,
      "agent-transcripts",
      id,
      `${id}.jsonl`,
    );
    const usage = await estimateUsageFromTranscript(file);
    expect(usage?.source).toBe("turn_ended");
    expect(usage?.tokensIn).toBe(100);
    expect(usage?.tokensOut).toBe(20);
    expect(usage?.tokensReasoning).toBe(15);
    expect(usage?.tokensCacheRead).toBe(50);
    expect(usage?.tokensCacheWrite).toBe(10);
  });

  it("estimates reasoning from thinking blocks when turn_ended has no usage", async () => {
    const id = "cccccccc-dddd-eeee-ffff-000000000002";
    const think = "y".repeat(20); // 5 tokens
    writeTranscript(id, [
      { role: "user", message: { content: [{ type: "text", text: "q" }] } },
      {
        role: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: think },
            { type: "text", text: "a" },
          ],
        },
      },
      { type: "turn_ended", status: "success" },
    ]);
    const file = path.join(
      tmpRoot,
      "projects",
      projectSlug,
      "agent-transcripts",
      id,
      `${id}.jsonl`,
    );
    const usage = await estimateUsageFromTranscript(file);
    expect(usage?.source).toBe("estimate");
    expect(usage?.tokensReasoning).toBe(5);
    // thinking not folded into out
    expect(usage!.tokensOut).toBe(1); // "a"
  });
});

describe("cursor plan files", () => {
  it("resolves ~/.cursor/plans by short id and merges into touched files", async () => {
    const { resolveCursorPlanPath, mergeCursorPlanFiles, invalidateCursorPlanIndex } =
      await import("../src/providers/cursor/plan.js");
    invalidateCursorPlanIndex();
    const plans = path.join(tmpRoot, "plans");
    fs.mkdirSync(plans, { recursive: true });
    const planFile = path.join(plans, `Demo Plan-${sessionId.slice(0, 8)}.plan.md`);
    fs.writeFileSync(
      planFile,
      `<!-- ${sessionId} -->\n# Demo\n\n- do stuff\n`,
    );
    const resolved = await resolveCursorPlanPath(sessionId);
    expect(resolved).toBe(planFile);
    const merged = await mergeCursorPlanFiles(sessionId, []);
    expect(merged.some((f) => f.path === planFile)).toBe(true);
  });
});
