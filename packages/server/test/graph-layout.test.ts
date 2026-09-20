import { describe, expect, it } from "vitest";
import {
  alapLayerRanks,
  idealCenterY,
  packLayeredFlow,
} from "@threadle/shared";

describe("graphLayout", () => {
  it("ALAP keeps mid-chain side inputs off column 0", () => {
    // P1 → A1 → O1 → A2 → O2
    //            P2 ↗
    const ids = ["p1", "a1", "o1", "p2", "a2", "o2"];
    const preds = new Map<string, string[]>([
      ["p1", []],
      ["a1", ["p1"]],
      ["o1", ["a1"]],
      ["p2", []],
      ["a2", ["o1", "p2"]],
      ["o2", ["a2"]],
    ]);
    const succs = new Map<string, string[]>([
      ["p1", ["a1"]],
      ["a1", ["o1"]],
      ["o1", ["a2"]],
      ["p2", ["a2"]],
      ["a2", ["o2"]],
      ["o2", []],
    ]);
    const rank = alapLayerRanks(ids, preds, succs);
    expect(rank.get("p1")).toBe(0);
    expect(rank.get("p2")).toBe(rank.get("o1"));
    expect(rank.get("p2")!).toBeGreaterThan(0);
    expect(rank.get("a2")).toBe((rank.get("p2") ?? 0) + 1);
  });

  it("ideal Y pulls a side prompt toward sibling feeders of the same agent", () => {
    const preds = new Map<string, string[]>([
      ["p2", []],
      ["o1", ["a1"]],
      ["a2", ["o1", "p2"]],
    ]);
    const succs = new Map<string, string[]>([
      ["p2", ["a2"]],
      ["o1", ["a2"]],
      ["a1", ["o1"]],
    ]);
    const placed = new Map([["a1", 400]]);
    // o1 not placed yet — still inherits a1 via sibling walk
    expect(idealCenterY("p2", placed, preds, succs, 0)).toBe(400);
  });

  it("packLayeredFlow places mid prompt near the agent, not at the start", () => {
    const nodes = [
      { id: "p1", w: 200, h: 100 },
      { id: "a1", w: 200, h: 80 },
      { id: "o1", w: 240, h: 120 },
      { id: "p2", w: 200, h: 100 },
      { id: "a2", w: 200, h: 80 },
      { id: "o2", w: 240, h: 140 },
    ];
    const edges = [
      { source: "p1", target: "a1" },
      { source: "a1", target: "o1" },
      { source: "o1", target: "a2" },
      { source: "p2", target: "a2" },
      { source: "a2", target: "o2" },
    ];
    const pos = packLayeredFlow(nodes, edges, { gapX: 100, gapY: 40, originX: 0, originY: 200 });
    expect(pos.get("p1")!.x).toBeLessThan(pos.get("a1")!.x);
    expect(pos.get("p2")!.x).toBeGreaterThan(pos.get("p1")!.x);
    expect(pos.get("p2")!.x).toBe(pos.get("o1")!.x);
    expect(pos.get("p2")!.x).toBeLessThan(pos.get("a2")!.x);
    // vertically near the spine around a2 / o1, not dumped at origin alone
    const p2c = pos.get("p2")!.y + 50;
    const o1c = pos.get("o1")!.y + 60;
    expect(Math.abs(p2c - o1c)).toBeLessThan(200);
  });
});
