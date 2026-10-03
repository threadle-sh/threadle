import { describe, expect, it } from "vitest";
import type { NormalizedMessage } from "@threadle/shared";
import { buildContextGrowth, buildContextTimeline } from "../src/context/timeline.js";

describe("buildContextTimeline", () => {
  it("uses per-message usage when present", () => {
    const transcript: NormalizedMessage[] = [
      {
        id: "1",
        role: "user",
        parts: [{ type: "text", text: "hi" }],
      },
      {
        id: "2",
        role: "assistant",
        parts: [{ type: "text", text: "hello" }],
        tokens: { input: 1000, cacheRead: 200 },
      },
      {
        id: "3",
        role: "assistant",
        parts: [{ type: "text", text: "more" }],
        tokens: { input: 1500, cacheRead: 400 },
      },
    ];
    const { timeline, estimated } = buildContextTimeline(transcript);
    expect(estimated).toBe(false);
    expect(timeline).toEqual([
      { context: 1200, ts: undefined },
      { context: 1900, ts: undefined },
    ]);
  });

  it("estimates cumulative chars÷4 when usage is missing (Cursor)", () => {
    const transcript: NormalizedMessage[] = [
      {
        id: "1",
        role: "user",
        parts: [{ type: "text", text: "abcd" }], // 4 chars
      },
      {
        id: "2",
        role: "assistant",
        parts: [{ type: "text", text: "efghijkl" }], // 8 chars → cum 12 → 3 tok
      },
      {
        id: "3",
        role: "user",
        parts: [{ type: "text", text: "xxxx" }], // +4 → 16
      },
      {
        id: "4",
        role: "assistant",
        parts: [{ type: "text", text: "yyyy" }], // +4 → 20 → 5 tok
      },
    ];
    const { timeline, estimated } = buildContextTimeline(transcript);
    expect(estimated).toBe(true);
    expect(timeline.map((t) => t.context)).toEqual([3, 5]);
  });
});

describe("buildContextGrowth", () => {
  it("pairs prompts with usage-based context and deltas", () => {
    const transcript: NormalizedMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "first prompt" }],
        timestamp: 100,
      },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "ok" }],
        tokens: { input: 1000, cacheRead: 200 },
        timestamp: 110,
      },
      {
        id: "u2",
        role: "user",
        parts: [{ type: "text", text: "second prompt grows a lot" }],
        timestamp: 200,
      },
      {
        id: "a2",
        role: "assistant",
        parts: [{ type: "text", text: "sure" }],
        tokens: { input: 5000, cacheRead: 1000 },
        timestamp: 210,
      },
    ];
    const g = buildContextGrowth(transcript);
    expect(g.estimated).toBe(false);
    expect(g.peakContext).toBe(6000);
    expect(g.lastContext).toBe(6000);
    expect(g.steps).toHaveLength(2);
    expect(g.steps[0]).toMatchObject({
      context: 1200,
      delta: 1200,
      assistantMessageId: "a1",
      promptMessageId: "u1",
      promptPreview: "first prompt",
      compacted: false,
      input: 1000,
      cacheRead: 200,
    });
    expect(g.steps[1]).toMatchObject({
      context: 6000,
      delta: 4800,
      assistantMessageId: "a2",
      promptMessageId: "u2",
      promptPreview: "second prompt grows a lot",
      compacted: false,
      input: 5000,
      cacheRead: 1000,
    });
  });

  it("attributes continued assistant turns to the same user prompt", () => {
    const transcript: NormalizedMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "do stuff" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "tool…" }],
        tokens: { input: 800 },
      },
      {
        id: "a2",
        role: "assistant",
        parts: [{ type: "text", text: "done" }],
        tokens: { input: 1200 },
      },
    ];
    const g = buildContextGrowth(transcript);
    expect(g.steps.map((s) => s.promptMessageId)).toEqual(["u1", "u1"]);
    expect(g.steps.map((s) => s.delta)).toEqual([800, 400]);
  });

  it("marks compaction on sharp context drops", () => {
    const transcript: NormalizedMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "big" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "…" }],
        tokens: { input: 50_000 },
      },
      {
        id: "u2",
        role: "user",
        parts: [{ type: "text", text: "after compact" }],
      },
      {
        id: "a2",
        role: "assistant",
        parts: [{ type: "text", text: "…" }],
        tokens: { input: 10_000 },
      },
    ];
    const g = buildContextGrowth(transcript);
    expect(g.steps[0]!.compacted).toBe(false);
    expect(g.steps[1]!.compacted).toBe(true);
    expect(g.steps[1]!.delta).toBe(-40_000);
  });

  it("keeps the prior text prompt across tool-result user turns", () => {
    const transcript: NormalizedMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "real question" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "tool_use", toolName: "Read" }],
        tokens: { input: 1000 },
      },
      {
        id: "u2",
        role: "user",
        parts: [{ type: "tool_result", toolName: "Read", text: "file contents…" }],
      },
      {
        id: "a2",
        role: "assistant",
        parts: [{ type: "text", text: "done" }],
        tokens: { input: 2500 },
      },
    ];
    const g = buildContextGrowth(transcript);
    expect(g.steps.map((s) => s.promptMessageId)).toEqual(["u1", "u1"]);
    expect(g.steps[1]!.promptPreview).toBe("real question");
  });

  it("counts tool and skill invocations on growth steps", () => {
    const transcript: NormalizedMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "run checks" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "tool_use", toolName: "Bash", toolInput: { command: "npm test" } },
          { type: "tool_use", toolName: "Skill", toolInput: { skill: "review" } },
        ],
        tokens: { input: 2000, cacheRead: 100 },
      },
    ];
    const g = buildContextGrowth(transcript);
    expect(g.steps).toHaveLength(1);
    expect(g.steps[0]).toMatchObject({
      toolCalls: 2,
      skillCalls: 1,
      assistantMessageId: "a1",
      promptMessageId: "u1",
    });
  });
});
