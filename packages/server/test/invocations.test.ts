import { describe, expect, it } from "vitest";
import type { NormalizedMessage } from "@threadle/shared";
import { renderInvocationsMarkdown } from "../src/context/invocations.js";

describe("renderInvocationsMarkdown", () => {
  it("dumps every tool call for a name", () => {
    const transcript: NormalizedMessage[] = [
      {
        id: "m1",
        role: "assistant",
        timestamp: 1_700_000_000_000,
        parts: [
          { type: "tool_use", toolName: "Edit", toolInput: { file_path: "/a.ts" } },
          { type: "tool_use", toolName: "Read", toolInput: { file_path: "/b.ts" } },
          { type: "tool_use", toolName: "Edit", toolInput: { file_path: "/c.ts" } },
        ],
      },
    ];
    const { md, count, title } = renderInvocationsMarkdown(transcript, "tool", "Edit");
    expect(title).toBe("Edit");
    expect(count).toBe(2);
    expect(md).toContain("2 invocation(s)");
    expect(md).toContain("/a.ts");
    expect(md).toContain("/c.ts");
    expect(md).not.toContain("/b.ts");
  });

  it("dumps reasoning blocks", () => {
    const transcript: NormalizedMessage[] = [
      {
        id: "m2",
        role: "assistant",
        parts: [{ type: "thinking", text: "hmm" }],
      },
    ];
    const { md, count } = renderInvocationsMarkdown(transcript, "reasoning", "reasoning");
    expect(count).toBe(1);
    expect(md).toContain("hmm");
  });
});
