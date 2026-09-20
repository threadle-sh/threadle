import { describe, expect, it } from "vitest";
import type { NormalizedMessage } from "@threadle/shared";
import { buildContextTimeline } from "../src/context/timeline.js";

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
