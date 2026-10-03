import { describe, expect, it } from "vitest";
import type { GitSessionMatch } from "../src/routes/git.js";

/** Pure scoring helper mirrored for unit tests without git. */
function scoreSession(opts: {
  authorDate: number;
  sessionUpdatedAt: number;
  windowMs: number;
  branch?: string;
  sessionBranch?: string;
  commitFiles: string[];
  touched: string[];
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (Math.abs(opts.sessionUpdatedAt - opts.authorDate) <= opts.windowMs) {
    score += 3;
    reasons.push("time window");
  }
  if (opts.branch && opts.sessionBranch === opts.branch) {
    score += 2;
    reasons.push(`branch ${opts.branch}`);
  }
  const set = new Set(opts.touched);
  const hits = opts.commitFiles.filter((f) => set.has(f));
  if (hits.length) {
    score += Math.min(4, hits.length);
    reasons.push(`files: ${hits.slice(0, 3).join(", ")}`);
  }
  return { score, reasons };
}

describe("git↔session heuristic scoring", () => {
  it("ranks overlapping time+files above time alone", () => {
    const base = {
      authorDate: 1_000_000,
      windowMs: 3_600_000,
      branch: "main",
      commitFiles: ["a.ts", "b.ts"],
    };
    const a = scoreSession({
      ...base,
      sessionUpdatedAt: 1_000_100,
      sessionBranch: "main",
      touched: ["a.ts"],
    });
    const b = scoreSession({
      ...base,
      sessionUpdatedAt: 1_000_100,
      sessionBranch: undefined,
      touched: [],
    });
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.reasons.some((r) => r.startsWith("files:"))).toBe(true);
  });

  it("types GitSessionMatch shape", () => {
    const m: GitSessionMatch = {
      provider: "claude-code",
      sessionId: "abc",
      score: 3,
      reasons: ["time window"],
    };
    expect(m.score).toBe(3);
  });
});
