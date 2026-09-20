import { describe, expect, it } from "vitest";
import {
  assessWorkflowReadiness,
  type Graph,
} from "@threadle/shared";

function graph(
  nodes: Graph["nodes"],
  edges: Graph["edges"] = [],
): Graph {
  return {
    id: "t",
    name: "t",
    schemaVersion: 1,
    nodes,
    edges,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("assessWorkflowReadiness", () => {
  it("requires a model on agent-def nodes", () => {
    const issues = assessWorkflowReadiness(
      graph(
        [
          {
            id: "p",
            type: "prompt",
            position: { x: 0, y: 0 },
            status: "idle",
            data: { type: "prompt", text: "hi" },
          },
          {
            id: "a",
            type: "agent-def",
            position: { x: 1, y: 0 },
            status: "idle",
            data: {
              type: "agent-def",
              ref: { provider: "opencode", name: "build", source: "x" },
            },
          },
        ],
        [{ id: "e", source: "p", target: "a" }],
      ),
    );
    expect(issues.some((i) => i.kind === "model" && i.nodeId === "a")).toBe(true);
  });

  it("passes when agent has a model and prompt wired", () => {
    const issues = assessWorkflowReadiness(
      graph(
        [
          {
            id: "p",
            type: "prompt",
            position: { x: 0, y: 0 },
            status: "idle",
            data: { type: "prompt", text: "hi" },
          },
          {
            id: "a",
            type: "agent-def",
            position: { x: 1, y: 0 },
            status: "idle",
            data: {
              type: "agent-def",
              model: "opencode/claude-sonnet-4",
              ref: { provider: "opencode", name: "build", source: "x" },
            },
          },
        ],
        [{ id: "e", source: "p", target: "a" }],
      ),
    );
    expect(issues).toEqual([]);
  });

  it("flags unwired agent inputs", () => {
    const issues = assessWorkflowReadiness(
      graph([
        {
          id: "a",
          type: "agent-def",
          position: { x: 0, y: 0 },
          status: "idle",
          data: {
            type: "agent-def",
            model: "x",
            ref: { provider: "opencode", name: "build", source: "x" },
          },
        },
      ]),
    );
    expect(issues.some((i) => i.kind === "wiring")).toBe(true);
  });

  it("skips muted agents", () => {
    const issues = assessWorkflowReadiness(
      graph([
        {
          id: "a",
          type: "agent-def",
          position: { x: 0, y: 0 },
          status: "idle",
          muted: true,
          data: {
            type: "agent-def",
            ref: { provider: "opencode", name: "build", source: "x" },
          },
        },
      ]),
    );
    expect(issues).toEqual([]);
  });
});
