import { describe, expect, it } from "vitest";
import {
  assessDetachedReadiness,
  filterDetachedIssuesForScope,
  DEFAULT_DISTILL_CONFIG,
  DEFAULT_FILES_CONFIG,
  type Graph,
} from "@threadle/shared";

function bareGraph(nodes: Graph["nodes"], edges: Graph["edges"] = []): Graph {
  return {
    id: "test",
    name: "test",
    createdAt: 0,
    updatedAt: 0,
    nodes,
    edges,
  };
}

describe("assessDetachedReadiness", () => {
  it("blocks context with neither payload nor session source", () => {
    const issues = assessDetachedReadiness(
      bareGraph([
        {
          id: "c1",
          type: "context",
          position: { x: 0, y: 0 },
          data: {
            type: "context",
            kind: "distilled-summary",
            config: { ...DEFAULT_DISTILL_CONFIG },
            label: "brief",
          },
        },
      ]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "context", blocking: true, label: "brief" });
    expect(issues[0]?.message).toMatch(/session source|materialize/i);
  });

  it("allows unmaterialized context when a session is wired", () => {
    const issues = assessDetachedReadiness(
      bareGraph(
        [
          {
            id: "s1",
            type: "session",
            position: { x: 0, y: 0 },
            data: {
              type: "session",
              ref: { provider: "claude-code", sessionId: "abc" },
            },
          },
          {
            id: "c1",
            type: "context",
            position: { x: 1, y: 0 },
            data: {
              type: "context",
              kind: "distilled-summary",
              config: { ...DEFAULT_DISTILL_CONFIG },
              label: "brief",
            },
          },
        ],
        [{ id: "e1", source: "s1", target: "c1" }],
      ),
    );
    expect(issues.filter((i) => i.kind === "context")).toEqual([]);
  });

  it("allows unmaterialized context when an agent-def is wired", () => {
    const issues = assessDetachedReadiness(
      bareGraph(
        [
          {
            id: "a1",
            type: "agent-def",
            position: { x: 0, y: 0 },
            data: {
              type: "agent-def",
              ref: { provider: "opencode", name: "build", source: "x" },
              model: "test-model",
            },
          },
          {
            id: "c1",
            type: "context",
            position: { x: 1, y: 0 },
            data: {
              type: "context",
              kind: "files",
              config: { ...DEFAULT_FILES_CONFIG },
            },
          },
        ],
        [{ id: "e1", source: "a1", target: "c1" }],
      ),
    );
    expect(issues.filter((i) => i.kind === "context")).toEqual([]);
  });

  it("allows materialized context", () => {
    const issues = assessDetachedReadiness(
      bareGraph([
        {
          id: "c1",
          type: "context",
          position: { x: 0, y: 0 },
          data: {
            type: "context",
            kind: "distilled-summary",
            config: { ...DEFAULT_DISTILL_CONFIG },
            payloadHash: "abc123",
          },
        },
      ]),
    );
    expect(issues).toEqual([]);
  });

  it("flags approval gates as non-blocking (need confirm)", () => {
    const issues = assessDetachedReadiness(
      bareGraph(
        [
          {
            id: "p1",
            type: "prompt",
            position: { x: 0, y: 0 },
            data: { type: "prompt", text: "ok" },
          },
          {
            id: "a1",
            type: "approval",
            position: { x: 1, y: 0 },
            data: { type: "approval", label: "review" },
          },
        ],
        [{ id: "e1", source: "p1", target: "a1" }],
      ),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "approval", blocking: false, label: "review" });
  });

  it("flags live-handoff gates as non-blocking (need confirm)", () => {
    const issues = assessDetachedReadiness(
      bareGraph([
        {
          id: "h1",
          type: "live-handoff",
          position: { x: 0, y: 0 },
          data: {
            type: "live-handoff",
            label: "plan chat",
            ref: { provider: "opencode", name: "build", source: "global" },
          },
        },
      ]),
    );
    const gate = issues.filter((i) => i.kind === "live-handoff" && !i.blocking);
    expect(gate).toHaveLength(1);
    expect(gate[0]).toMatchObject({ label: "plan chat" });
  });

  it("blocks agents without a model", () => {
    const issues = assessDetachedReadiness(
      bareGraph(
        [
          {
            id: "p",
            type: "prompt",
            position: { x: 0, y: 0 },
            data: { type: "prompt", text: "x" },
          },
          {
            id: "a",
            type: "agent-def",
            position: { x: 1, y: 0 },
            data: {
              type: "agent-def",
              ref: { provider: "opencode", name: "build", source: "x" },
            },
          },
        ],
        [{ id: "e", source: "p", target: "a" }],
      ),
    );
    expect(issues.some((i) => i.kind === "model" && i.blocking)).toBe(true);
  });

  it("allows skill/rules with name but no path (portable)", () => {
    const issues = assessDetachedReadiness(
      bareGraph([
        {
          id: "s1",
          type: "skill",
          position: { x: 0, y: 0 },
          data: { type: "skill", name: "review-diff", path: "" },
        },
      ]),
    );
    expect(issues).toEqual([]);
  });

  it("blocks skill/rules with neither path nor name", () => {
    const issues = assessDetachedReadiness(
      bareGraph([
        {
          id: "s1",
          type: "skill",
          position: { x: 0, y: 0 },
          data: { type: "skill", name: "", path: "" },
        },
      ]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "artifact", blocking: true });
  });

  it("filterDetachedIssuesForScope drops gates outside the partial-run set", () => {
    const issues = assessDetachedReadiness(
      bareGraph([
        {
          id: "g1",
          type: "approval",
          position: { x: 0, y: 0 },
          data: { type: "approval" },
        },
        {
          id: "p1",
          type: "prompt",
          position: { x: 1, y: 0 },
          data: { type: "prompt", text: "hi" },
        },
      ]),
    );
    expect(issues.some((i) => i.nodeId === "g1")).toBe(true);
    expect(filterDetachedIssuesForScope(issues, ["p1"])).toEqual([]);
    const onlyGate = filterDetachedIssuesForScope(issues, ["g1"]);
    expect(onlyGate.length).toBeGreaterThan(0);
    expect(onlyGate.every((i) => i.nodeId === "g1")).toBe(true);
    expect(filterDetachedIssuesForScope(issues).some((i) => i.nodeId === "g1")).toBe(true);
  });
});
