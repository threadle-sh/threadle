import { describe, expect, it } from "vitest";
import { toolInvocationBody, toolSummary } from "../src/providers/stream.js";

describe("toolSummary", () => {
  it("surfaces the interesting field per tool", () => {
    expect(toolSummary("Bash", { command: "ls -la" })).toBe("Bash: ls -la");
    expect(toolSummary("WebFetch", { url: "https://x.dev" })).toBe(
      "WebFetch: https://x.dev",
    );
    expect(toolSummary("Read", { file_path: "/tmp/a.ts" })).toBe("Read: /tmp/a.ts");
    expect(toolSummary("WebSearch", { search_term: "hello world" })).toBe(
      "WebSearch: hello world",
    );
  });

  it("truncates long payloads and handles empty input", () => {
    const long = toolSummary("Edit", { file_path: "x".repeat(300) });
    expect(long.length).toBeLessThan(120);
    expect(long.endsWith("…")).toBe(true);
    expect(toolSummary("Tool", undefined)).toBe("Tool");
  });
});

describe("toolInvocationBody", () => {
  it("pretty-prints object input", () => {
    const body = toolInvocationBody("WebSearch", {
      search_term: "Cursor agent skills",
      explanation: "find docs",
    });
    expect(body).toContain("WebSearch");
    expect(body).toContain('"search_term": "Cursor agent skills"');
    expect(body).toContain('"explanation": "find docs"');
  });
});
