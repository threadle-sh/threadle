import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  countCodexMessages,
  readCodexTranscript,
} from "../src/providers/codex/jsonl.js";
import { readCodexTouchedFiles } from "../src/providers/codex/files.js";
import {
  discoverSessions,
  invalidateDiscoverCache,
  sessionIdFromFilename,
} from "../src/providers/codex/discover.js";
import { CodexProvider } from "../src/providers/codex/index.js";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-codex-"));
const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const projectDir = "/tmp/threadle-codex-fixture-proj";

const rolloutLines = [
  {
    timestamp: "2026-09-15T21:35:27.000Z",
    type: "session_meta",
    payload: {
      id: sessionId,
      cwd: projectDir,
      model: "gpt-5",
      session_name: "Fixture Codex",
    },
  },
  {
    timestamp: "2026-09-15T21:35:28.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "hello codex" }],
    },
  },
  {
    timestamp: "2026-09-15T21:35:29.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "hi from codex" }],
    },
  },
  {
    timestamp: "2026-09-15T21:35:30.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name: "read_file",
      call_id: "call_1",
      arguments: JSON.stringify({ path: `${projectDir}/src/a.ts` }),
    },
  },
  {
    timestamp: "2026-09-15T21:35:31.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: "<environment_context>\ncwd: /tmp\n</environment_context>",
        },
      ],
    },
  },
  {
    timestamp: "2026-09-15T21:35:32.000Z",
    type: "unknown_future",
    payload: { ignore: true },
  },
];

function writeFixture(): void {
  const day = path.join(tmpRoot, "sessions", "2026", "09", "15");
  fs.mkdirSync(day, { recursive: true });
  fs.writeFileSync(
    path.join(day, `rollout-2026-09-15T21-35-27-${sessionId}.jsonl`),
    rolloutLines.map((l) => JSON.stringify(l)).join("\n"),
  );
}

beforeAll(() => {
  process.env.CODEX_HOME = tmpRoot;
  writeFixture();
  invalidateDiscoverCache();
});

afterAll(() => {
  delete process.env.CODEX_HOME;
  fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe("codex filename parse", () => {
  it("extracts uuid from rollout name", () => {
    expect(sessionIdFromFilename(`rollout-2026-09-15T21-35-27-${sessionId}.jsonl`)).toBe(
      sessionId,
    );
  });
});

describe("codex jsonl", () => {
  it("normalizes response_item messages and skips environment_context + unknown", async () => {
    const tPath = path.join(
      tmpRoot,
      "sessions",
      "2026",
      "09",
      "15",
      `rollout-2026-09-15T21-35-27-${sessionId}.jsonl`,
    );
    const msgs = await readCodexTranscript(tPath);
    expect(msgs).toHaveLength(3); // user, assistant, tool_use
    expect(msgs[0]!.role).toBe("user");
    expect(msgs[0]!.parts[0]).toEqual({ type: "text", text: "hello codex" });
    expect(msgs[1]!.role).toBe("assistant");
    expect(msgs[1]!.parts[0]).toEqual({ type: "text", text: "hi from codex" });
    expect(msgs[2]!.parts[0]?.type).toBe("tool_use");
    expect(await countCodexMessages(tPath)).toBe(3);
  });

  it("skips AGENTS.md instruction user dumps", async () => {
    const snip = path.join(tmpRoot, "agents-dump.jsonl");
    fs.writeFileSync(
      snip,
      [
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "# AGENTS.md instructions for /tmp\n\n<INSTRUCTIONS>\nbe nice\n",
              },
            ],
          },
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "real prompt" }],
          },
        },
      ]
        .map((o) => JSON.stringify(o))
        .join("\n"),
    );
    const msgs = await readCodexTranscript(snip);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.parts[0]?.text).toBe("real prompt");
  });

  it("harvests read_file as touched reads", async () => {
    const tPath = path.join(
      tmpRoot,
      "sessions",
      "2026",
      "09",
      "15",
      `rollout-2026-09-15T21-35-27-${sessionId}.jsonl`,
    );
    const files = await readCodexTouchedFiles(tPath);
    expect(files).toEqual([{ path: `${projectDir}/src/a.ts`, op: "read" }]);
  });
});

describe("codex discover", () => {
  it("finds the fixture session", async () => {
    const all = await discoverSessions(true);
    expect(all.length).toBeGreaterThanOrEqual(1);
    const hit = all.find((d) => d.ref.id === sessionId);
    expect(hit).toBeDefined();
    expect(hit!.ref.provider).toBe("codex");
    expect(hit!.ref.title).toBe("Fixture Codex");
    expect(hit!.ref.projectDir).toBe(projectDir);
    expect(hit!.ref.model).toBe("gpt-5");
    expect(hit!.ref.tokensIn).toBeGreaterThan(0);
    expect(hit!.ref.tokensOut).toBeGreaterThan(0);
    expect(hit!.ref.meta?.tokenSource).toBe("estimate");
  });

  it("estimates usage from transcript chars", async () => {
    const { estimateUsageFromTranscript } = await import("../src/providers/codex/usage.js");
    const dayDir = path.join(tmpRoot, "sessions", "2026", "09", "15");
    const file = path.join(dayDir, `rollout-2026-09-15T21-35-27-${sessionId}.jsonl`);
    const u = await estimateUsageFromTranscript(file);
    expect(u?.source).toBe("estimate");
    expect(u!.tokensIn).toBe(Math.ceil("hello codex".length / 4));
    // assistant text + tool_use name/args
    expect(u!.tokensOut).toBeGreaterThan(0);
  });
});

describe("codex provider", () => {
  it("provider getTranscript works", async () => {
    const p = new CodexProvider();
    expect(await p.available()).toBe(true);
    const msgs = await p.getTranscript(sessionId);
    expect(msgs[0]!.parts[0]?.text).toBe("hello codex");
    const agents = await p.listAgents();
    expect(agents.some((a) => a.name === "codex")).toBe(true);
  });
});
