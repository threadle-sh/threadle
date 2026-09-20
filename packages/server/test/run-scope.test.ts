import { describe, expect, it } from "vitest";
import {
  classifyRunScope,
  descendantsOf,
  SEEDABLE_NODE_TYPES,
} from "@threadle/shared";

describe("classifyRunScope", () => {
  const nodes = [
    { id: "p1", data: { type: "prompt" as const } },
    { id: "a1", data: { type: "agent-def" as const } },
    { id: "c1", data: { type: "custom" as const } },
    { id: "n1", data: { type: "note" as const } },
    { id: "o1", data: { type: "output" as const } },
  ];

  it("marks in-scope as re-run", () => {
    const scope = new Set(["a1", "o1"]);
    const c = classifyRunScope(nodes, scope);
    expect(c.reRun).toEqual(["a1", "o1"]);
    expect(c.counts.reRun).toBe(2);
  });

  it("marks seedable / skip-exec out-of-scope as reuse", () => {
    const scope = new Set(["a1"]);
    const c = classifyRunScope(nodes, scope);
    expect(c.reuse).toContain("p1");
    expect(c.reuse).toContain("o1");
    expect(c.reuse).toContain("n1");
    expect(c.missing).toContain("c1");
  });

  it("muted out-of-scope counts as reuse", () => {
    const c = classifyRunScope(
      [{ id: "x", data: { type: "custom" }, muted: true }],
      new Set(),
    );
    expect(c.reuse).toEqual(["x"]);
    expect(c.missing).toEqual([]);
  });

  it("SEEDABLE_NODE_TYPES covers prompt/output/session", () => {
    expect(SEEDABLE_NODE_TYPES.has("prompt")).toBe(true);
    expect(SEEDABLE_NODE_TYPES.has("output")).toBe(true);
    expect(SEEDABLE_NODE_TYPES.has("session")).toBe(true);
    expect(SEEDABLE_NODE_TYPES.has("custom")).toBe(false);
  });
});

describe("descendantsOf", () => {
  it("includes start and downstream", () => {
    const scope = descendantsOf("a", [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "x", target: "y" },
    ]);
    expect([...scope].sort()).toEqual(["a", "b", "c"]);
  });
});
