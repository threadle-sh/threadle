import { describe, expect, it } from "vitest";
import type { NodeType } from "@threadle/shared";
import {
  BUILTIN_NODE_DEFINITIONS,
  EMITS_TEXT,
  FORBIDDEN_TEXT_PAIRS,
  getNodeDefinition,
  isValidConnection,
  MUTABLE_NODE_TYPES,
  paletteBlockEntries,
  REQUIRES_INPUT,
  TEXT_SINKS,
  TEXT_SOURCES,
  VALID_CONNECTIONS,
  wireMenuBlocks,
} from "@threadle/shared";

const ALL_TYPES: NodeType[] = [
  "agent-def",
  "session",
  "subagent-run",
  "context",
  "prompt",
  "output",
  "prompt-convert",
  "delay",
  "data",
  "approval",
  "live-handoff",
  "wait-idle",
  "iterator",
  "knot",
  "tripwire",
  "judge",
  "until",
  "group",
  "note",
  "custom",
  "mcp-tool",
  "skill",
  "rules",
];

describe("NodeDefinition registry", () => {
  it("registers every NodeType exactly once", () => {
    const ids = BUILTIN_NODE_DEFINITIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of ALL_TYPES) {
      expect(getNodeDefinition(t), t).toBeDefined();
    }
    expect(ids).toHaveLength(ALL_TYPES.length);
  });

  it("derives text sources/sinks; skill may wire to output (invoke mode)", () => {
    expect(TEXT_SOURCES).toContain("prompt");
    expect(TEXT_SINKS).toContain("agent-def");
    expect(TEXT_SINKS).toContain("skill");
    expect(FORBIDDEN_TEXT_PAIRS.has("skill>output")).toBe(false);
    expect(isValidConnection("skill", "output")).toBe(true);
    expect(isValidConnection("prompt", "skill")).toBe(true);
    expect(isValidConnection("prompt", "agent-def")).toBe(true);
    expect(VALID_CONNECTIONS.length).toBeGreaterThan(20);
  });

  it("exposes palette blocks and wire menu from definitions", () => {
    const pal = paletteBlockEntries();
    expect(pal.some((b) => b.type === "prompt")).toBe(true);
    expect(pal.some((b) => b.type === "agent-def")).toBe(false);
    const wire = wireMenuBlocks();
    expect(wire.filter((b) => b.type === "context")).toHaveLength(3);
    expect(wire.some((b) => b.type === "note")).toBe(true);
  });

  it("keeps readiness / mute flags coherent", () => {
    expect(REQUIRES_INPUT.has("output")).toBe(true);
    expect(REQUIRES_INPUT.has("prompt")).toBe(false);
    expect(EMITS_TEXT.has("session")).toBe(true);
    expect(MUTABLE_NODE_TYPES.has("note")).toBe(false);
    expect(MUTABLE_NODE_TYPES.has("prompt")).toBe(true);
  });
});
