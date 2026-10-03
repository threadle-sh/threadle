import { describe, expect, it } from "vitest";
import { eventToLogs } from "../src/providers/codex/inject.js";

describe("codex eventToLogs", () => {
  it("maps agent_message and text", () => {
    expect(eventToLogs(JSON.stringify({ type: "agent_message", message: "hi" }))).toEqual([
      ["text", "hi"],
    ]);
    expect(eventToLogs(JSON.stringify({ text: "plain" }))).toEqual([["text", "plain"]]);
  });

  it("maps reasoning to thinking", () => {
    expect(
      eventToLogs(
        JSON.stringify({
          type: "reasoning",
          summary: [{ type: "summary_text", text: "consider options" }],
        }),
      ),
    ).toEqual([["thinking", "consider options"]]);

    expect(
      eventToLogs(
        JSON.stringify({
          payload: { type: "reasoning", content: "deep thought" },
        }),
      ),
    ).toEqual([["thinking", "deep thought"]]);
  });

  it("maps function_call / tool_call to tool", () => {
    expect(
      eventToLogs(
        JSON.stringify({
          type: "function_call",
          name: "shell",
          arguments: JSON.stringify({ command: "ls -la" }),
        }),
      ),
    ).toEqual([["tool", "shell: ls -la"]]);

    expect(
      eventToLogs(
        JSON.stringify({
          item: { type: "tool_call", name: "Read", input: { path: "/tmp/a.ts" } },
        }),
      ),
    ).toEqual([["tool", "Read: /tmp/a.ts"]]);
  });

  it("ignores garbage", () => {
    expect(eventToLogs("not-json")).toEqual([]);
  });
});
