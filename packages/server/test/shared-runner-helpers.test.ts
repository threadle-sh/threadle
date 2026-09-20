import { describe, expect, it } from "vitest";
import {
  advanceUntil,
  decideWaitIdle,
  splitIteratorItems,
} from "@threadle/shared";

describe("splitIteratorItems", () => {
  it("splits lines and respects maxItems", () => {
    const r = splitIteratorItems("a\nb\nc", { splitMode: "lines", maxItems: 2 });
    expect(r).toEqual({ ok: true, items: ["a", "b"] });
  });

  it("fails hard on bad JSON", () => {
    const r = splitIteratorItems("not-json", { splitMode: "json" });
    expect(r.ok).toBe(false);
  });

  it("parses JSON arrays", () => {
    const r = splitIteratorItems('["x", {"y":1}]', { splitMode: "json" });
    expect(r).toEqual({ ok: true, items: ["x", '{"y":1}'] });
  });
});

describe("advanceUntil", () => {
  it("reenters while under cap when wired", () => {
    expect(
      advanceUntil({ maxIterations: 3, iterCount: 0, hasReenterTargets: true }),
    ).toEqual({ kind: "reenter", winner: "reenter", nextIter: 1 });
  });

  it("exhausts when no reenter wire", () => {
    expect(
      advanceUntil({ maxIterations: 3, iterCount: 0, hasReenterTargets: false }),
    ).toEqual({ kind: "exhausted-no-wire", winner: "exhausted" });
  });

  it("exhausts after max iterations", () => {
    expect(
      advanceUntil({ maxIterations: 2, iterCount: 2, hasReenterTargets: true }),
    ).toEqual({ kind: "exhausted", winner: "exhausted" });
  });
});

describe("decideWaitIdle", () => {
  it("continues when idle", () => {
    expect(decideWaitIdle({ gotIdle: true })).toEqual({ kind: "continue" });
  });

  it("applies onTimeout", () => {
    expect(decideWaitIdle({ gotIdle: false, onTimeout: "skip" })).toEqual({
      kind: "skip",
    });
    expect(decideWaitIdle({ gotIdle: false, onTimeout: "abort" })).toEqual({
      kind: "abort",
    });
    expect(decideWaitIdle({ gotIdle: false })).toEqual({ kind: "park" });
  });
});
