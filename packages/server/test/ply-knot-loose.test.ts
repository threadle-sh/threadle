import { describe, expect, it } from "vitest";
import {
  assessLooseEnds,
  DEFAULT_PLY,
  defaultJudgeMatchers,
  evaluateJudge,
  evaluateTripwire,
  judgePortsOutput,
  mapPool,
  mergeKnotTexts,
  plyReady,
  predecessorMap,
  type Graph,
} from "@threadle/shared";

function graph(nodes: Graph["nodes"], edges: Graph["edges"] = []): Graph {
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

describe("mergeKnotTexts", () => {
  it("concats with separator", () => {
    expect(mergeKnotTexts(["a", "b"], "concat", { separator: "|" })).toBe("a|b");
  });
  it("first wins", () => {
    expect(mergeKnotTexts(["one", "two"], "first")).toBe("one");
  });
  it("majority votes", () => {
    expect(mergeKnotTexts(["x", "y", "x"], "majority")).toBe("x");
  });
  it("synthesize labels candidates", () => {
    const out = mergeKnotTexts(["alpha", "beta"], "synthesize");
    expect(out).toContain("### candidate 1");
    expect(out).toContain("alpha");
    expect(out).toContain("Synthesize");
  });
});

describe("evaluateTripwire", () => {
  const base = {
    text: "hello world",
    runSpend: 0.5,
    runStartedAt: 1_000,
    runFailures: 0,
    now: 1_000,
  };

  it("spend trips at threshold", () => {
    expect(
      evaluateTripwire(
        { mode: "spend", action: "abort", thresholdUsd: 1 },
        { ...base, runSpend: 1 },
      ).tripped,
    ).toBe(true);
    expect(
      evaluateTripwire(
        { mode: "spend", action: "abort", thresholdUsd: 1 },
        { ...base, runSpend: 0.5 },
      ).tripped,
    ).toBe(false);
  });

  it("content trips on empty / pattern", () => {
    expect(
      evaluateTripwire(
        { mode: "content", action: "skip" },
        { ...base, text: "  " },
      ).tripped,
    ).toBe(true);
    expect(
      evaluateTripwire(
        { mode: "content", action: "abort", pattern: "ERROR", tripOnMatch: true },
        { ...base, text: "boom ERROR here" },
      ).tripped,
    ).toBe(true);
    expect(
      evaluateTripwire(
        { mode: "content", action: "abort", pattern: "^ok", tripOnMatch: false },
        { ...base, text: "ok done" },
      ).tripped,
    ).toBe(false);
  });

  it("duration and retries", () => {
    expect(
      evaluateTripwire(
        { mode: "duration", action: "abort", thresholdMs: 5_000 },
        { ...base, runStartedAt: 0, now: 6_000 },
      ).tripped,
    ).toBe(true);
    expect(
      evaluateTripwire(
        { mode: "retries", action: "skip", thresholdRetries: 3 },
        { ...base, runFailures: 3 },
      ).tripped,
    ).toBe(true);
  });
  it("tokens trips on estimate or explicit count", () => {
    expect(
      evaluateTripwire(
        { mode: "tokens", action: "abort", thresholdTokens: 10 },
        { ...base, text: "abcdefghij" /* ~3 tokens */, tokens: 10 },
      ).tripped,
    ).toBe(true);
    expect(
      evaluateTripwire(
        { mode: "tokens", action: "abort", thresholdTokens: 100 },
        { ...base, text: "short", tokens: undefined },
      ).tripped,
    ).toBe(false);
  });

  it("invalid content pattern trips", () => {
    expect(
      evaluateTripwire(
        { mode: "content", action: "abort", pattern: "(unclosed" },
        base,
      ).tripped,
    ).toBe(true);
  });

  it("minChars trips short text", () => {
    expect(
      evaluateTripwire(
        { mode: "content", action: "skip", minChars: 20 },
        { ...base, text: "tiny" },
      ).tripped,
    ).toBe(true);
  });
});

describe("evaluateJudge", () => {
  it("first-hit regex routes to pass", () => {
    const r = evaluateJudge(
      { matchers: defaultJudgeMatchers(), unmatched: "unsure" },
      "tests: PASS ok",
    );
    expect(r.port).toBe("pass");
    expect(r.park).toBe(false);
  });

  it("contains is case-insensitive by default", () => {
    const r = evaluateJudge(
      {
        matchers: [
          { id: "1", port: "fail", kind: "contains", pattern: "ERROR" },
        ],
        unmatched: "unsure",
      },
      "got an error here",
    );
    expect(r.port).toBe("fail");
  });

  it("unmatched emits unsure", () => {
    const r = evaluateJudge(
      { matchers: defaultJudgeMatchers(), unmatched: "unsure" },
      "neither outcome",
    );
    expect(r.port).toBe("unsure");
    expect(r.park).toBe(false);
  });

  it("unmatched park sets park flag", () => {
    const r = evaluateJudge(
      { matchers: [], unmatched: "park" },
      "mystery",
    );
    expect(r.port).toBe("unsure");
    expect(r.park).toBe(true);
  });

  it("invalid regex is skipped", () => {
    const r = evaluateJudge(
      {
        matchers: [
          { id: "bad", port: "pass", kind: "regex", pattern: "(unclosed" },
          { id: "ok", port: "fail", kind: "contains", pattern: "x" },
        ],
        unmatched: "unsure",
      },
      "x",
    );
    expect(r.port).toBe("fail");
  });

  it("judgePortsOutput empties losing lanes", () => {
    expect(judgePortsOutput("pass", "body")).toEqual({
      pass: "body",
      fail: "",
      unsure: "",
    });
  });
});

describe("ply scheduling", () => {
  it("ready set is nodes with completed preds", () => {
    const preds = predecessorMap(
      ["a", "b", "c"],
      [
        { source: "a", target: "b" },
        { source: "a", target: "c" },
      ],
    );
    expect(plyReady(["a", "b", "c"], preds, new Set())).toEqual(["a"]);
    expect(plyReady(["b", "c"], preds, new Set(["a"])).sort()).toEqual(["b", "c"]);
  });

  it("mapPool respects concurrency", async () => {
    let inflight = 0;
    let max = 0;
    const items = [1, 2, 3, 4, 5];
    await mapPool(items, 2, async () => {
      inflight++;
      max = Math.max(max, inflight);
      await new Promise((r) => setTimeout(r, 20));
      inflight--;
    });
    expect(max).toBeLessThanOrEqual(2);
    expect(DEFAULT_PLY).toBe(4);
  });
});

describe("assessLooseEnds", () => {
  it("flags dangling producers and unused params", () => {
    const ends = assessLooseEnds(
      graph(
        [
          {
            id: "p",
            type: "prompt",
            position: { x: 0, y: 0 },
            status: "idle",
            data: { type: "prompt", text: "hello" },
          },
        ],
        [],
      ),
    );
    expect(ends.some((e) => e.kind === "dangling" && e.nodeId === "p")).toBe(true);

    const withParam = assessLooseEnds(
      graph(
        [
          {
            id: "p",
            type: "prompt",
            position: { x: 0, y: 0 },
            status: "idle",
            data: { type: "prompt", text: "no pe" },
          },
        ],
        [],
      ),
    );
    // add param via mutation
    const g = graph(
      [
        {
          id: "p",
          type: "prompt",
          position: { x: 0, y: 0 },
          status: "idle",
          data: { type: "prompt", text: "hi" },
        },
      ],
      [],
    );
    g.params = [{ name: "task", type: "text" }];
    const pe = assessLooseEnds(g);
    expect(pe.some((e) => e.kind === "unused-param" && e.label === "task")).toBe(true);
    void withParam;
  });

  it("flags muted nodes", () => {
    const ends = assessLooseEnds(
      graph([
        {
          id: "p",
          type: "prompt",
          position: { x: 0, y: 0 },
          status: "idle",
          muted: true,
          data: { type: "prompt", text: "x" },
        },
      ]),
    );
    expect(ends.some((e) => e.kind === "muted")).toBe(true);
  });

  it("hints parallel iterator without a Merge downstream", () => {
    const ends = assessLooseEnds(
      graph(
        [
          {
            id: "p",
            type: "prompt",
            position: { x: 0, y: 0 },
            status: "idle",
            data: { type: "prompt", text: "a\nb" },
          },
          {
            id: "it",
            type: "iterator",
            position: { x: 1, y: 0 },
            status: "idle",
            data: { type: "iterator", splitMode: "lines", mode: "parallel" },
          },
          {
            id: "o",
            type: "output",
            position: { x: 2, y: 0 },
            status: "idle",
            data: { type: "output" },
          },
        ],
        [
          { id: "e1", source: "p", target: "it" },
          { id: "e2", source: "it", target: "o" },
        ],
      ),
    );
    expect(
      ends.some(
        (e) =>
          e.kind === "hint" &&
          e.nodeId === "it" &&
          /parallel iterator without a Merge/i.test(e.message),
      ),
    ).toBe(true);
  });

  it("hints wait-idle without an inbound session", () => {
    const ends = assessLooseEnds(
      graph(
        [
          {
            id: "p",
            type: "prompt",
            position: { x: 0, y: 0 },
            status: "idle",
            data: { type: "prompt", text: "x" },
          },
          {
            id: "w",
            type: "wait-idle",
            position: { x: 1, y: 0 },
            status: "idle",
            data: { type: "wait-idle" },
          },
          {
            id: "o",
            type: "output",
            position: { x: 2, y: 0 },
            status: "idle",
            data: { type: "output" },
          },
        ],
        [
          { id: "e1", source: "p", target: "w" },
          { id: "e2", source: "w", target: "o" },
        ],
      ),
    );
    expect(
      ends.some(
        (e) =>
          e.kind === "hint" &&
          e.nodeId === "w" &&
          /no inbound session/i.test(e.message),
      ),
    ).toBe(true);
  });
});
