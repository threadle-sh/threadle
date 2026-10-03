import { describe, expect, it } from "vitest";
import type { NormalizedMessage } from "@threadle/shared";
import { renderTranscript } from "../src/context/extract.js";
import { hashPayload } from "../src/context/store.js";

const messages: NormalizedMessage[] = [
  {
    id: "m1",
    role: "user",
    parts: [{ type: "text", text: "add feature X" }],
    timestamp: Date.UTC(2026, 8, 12, 10, 0, 0),
  },
  {
    id: "m2",
    role: "assistant",
    parts: [
      { type: "thinking", text: "secret reasoning" },
      { type: "tool_use", toolName: "Bash", toolInput: { command: "ls" } },
      { type: "tool_result", text: "a.txt\nb.txt" },
      { type: "text", text: "Done, feature X added." },
    ],
  },
  {
    id: "m3",
    role: "user",
    parts: [{ type: "text", text: "thanks" }],
  },
];

const base = {
  kind: "transcript-excerpt" as const,
  roles: ["user", "assistant"] as Array<"user" | "assistant">,
  includeThinking: false,
  includeToolCalls: "names" as const,
};

describe("renderTranscript", () => {
  it("renders roles, tool names, drops thinking by default", () => {
    const out = renderTranscript(messages, base);
    expect(out).toContain("## user — 2026-09-12 10:00:00");
    expect(out).toContain("add feature X");
    expect(out).toContain('> tool: Bash({"command":"ls"})');
    expect(out).toContain("Done, feature X added.");
    expect(out).not.toContain("secret reasoning");
    expect(out).not.toContain("a.txt"); // results only in "full" mode
  });

  it("includes thinking and full tool I/O when configured", () => {
    const out = renderTranscript(messages, {
      ...base,
      includeThinking: true,
      includeToolCalls: "full",
    });
    expect(out).toContain("secret reasoning");
    expect(out).toContain("a.txt");
  });

  it("respects range and maxChars", () => {
    const ranged = renderTranscript(messages, { ...base, range: [2, 2] });
    expect(ranged).toContain("thanks");
    expect(ranged).not.toContain("add feature X");

    const truncated = renderTranscript(messages, { ...base, maxChars: 40 });
    expect(truncated.length).toBeLessThan(80);
    expect(truncated).toContain("[…truncated]");
  });

  it("filters roles", () => {
    const out = renderTranscript(messages, { ...base, roles: ["user"] });
    expect(out).toContain("add feature X");
    expect(out).not.toContain("Done, feature X added.");
  });
});

describe("hashPayload", () => {
  it("is stable for identical inputs and distinct otherwise", () => {
    const input = {
      kind: "transcript-excerpt" as const,
      source: { provider: "opencode" as const, sessionId: "ses_x" },
      content: "hello",
    };
    expect(hashPayload(input)).toBe(hashPayload({ ...input }));
    expect(hashPayload(input)).not.toBe(
      hashPayload({ ...input, content: "hello!" }),
    );
    expect(hashPayload(input)).not.toBe(
      hashPayload({ ...input, kind: "distilled-summary" as const }),
    );
  });
});
