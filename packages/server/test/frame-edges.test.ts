import { describe, expect, it } from "vitest";
import { expandFrameEdges, frameBoundaryWarnings, type GraphEdge, type GraphNode } from "@threadle/shared";

function node(
  id: string,
  partial: Partial<GraphNode> & { data: GraphNode["data"] },
): GraphNode {
  return {
    id,
    type: partial.type ?? partial.data.type,
    position: partial.position ?? { x: 0, y: 0 },
    status: "idle",
    data: partial.data,
    subOf: partial.subOf,
    originId: partial.originId,
  };
}

describe("expandFrameEdges", () => {
  it("zips frame→frame by y-order instead of cartesian product", () => {
    const nodes: GraphNode[] = [
      node("fa", {
        type: "group",
        data: { type: "group", label: "A", size: { width: 100, height: 100 }, graphId: "ga" },
      }),
      node("fb", {
        type: "group",
        data: { type: "group", label: "B", size: { width: 100, height: 100 }, graphId: "gb" },
      }),
      node("a1", {
        type: "prompt",
        position: { x: 0, y: 0 },
        subOf: "fa",
        data: { type: "prompt", text: "a1" },
      }),
      node("a2", {
        type: "prompt",
        position: { x: 0, y: 100 },
        subOf: "fa",
        data: { type: "prompt", text: "a2" },
      }),
      node("b1", {
        type: "output",
        position: { x: 0, y: 0 },
        subOf: "fb",
        data: { type: "output" },
      }),
      node("b2", {
        type: "output",
        position: { x: 0, y: 100 },
        subOf: "fb",
        data: { type: "output" },
      }),
    ];
    const edges: GraphEdge[] = [{ id: "e1", source: "fa", target: "fb" }];
    const expanded = expandFrameEdges(nodes, edges);
    // 2 exits × 2 entries would be 4 under cartesian; zip yields 2
    expect(expanded).toHaveLength(2);
    expect(expanded.map((e) => `${e.source}→${e.target}`).sort()).toEqual([
      "a1→b1",
      "a2→b2",
    ]);
  });

  it("warns when a linked frame has no members", () => {
    const nodes: GraphNode[] = [
      node("fa", {
        type: "group",
        data: { type: "group", label: "A", size: { width: 100, height: 100 }, graphId: "ga" },
      }),
      node("p", { type: "prompt", data: { type: "prompt", text: "hi" } }),
    ];
    const edges: GraphEdge[] = [{ id: "e1", source: "p", target: "fa" }];
    const warn = frameBoundaryWarnings(nodes, edges);
    expect(warn.some((w) => w.includes("no member"))).toBe(true);
  });

  it("warns when inbound wires hit a frame with no entry (all members are fed)", () => {
    const nodes: GraphNode[] = [
      node("fa", {
        type: "group",
        data: { type: "group", label: "A", size: { width: 100, height: 100 }, graphId: "ga" },
      }),
      node("m1", {
        type: "prompt",
        position: { x: 0, y: 0 },
        subOf: "fa",
        data: { type: "prompt", text: "a" },
      }),
      node("m2", {
        type: "prompt",
        position: { x: 0, y: 40 },
        subOf: "fa",
        data: { type: "prompt", text: "b" },
      }),
      node("p", { type: "prompt", data: { type: "prompt", text: "hi" } }),
    ];
    // internal cycle: both members are fed → no entry
    const edges: GraphEdge[] = [
      { id: "i1", source: "m1", target: "m2" },
      { id: "i2", source: "m2", target: "m1" },
      { id: "e1", source: "p", target: "fa" },
    ];
    const warn = frameBoundaryWarnings(nodes, edges);
    expect(warn.some((w) => w.includes("no entry"))).toBe(true);
  });
});
