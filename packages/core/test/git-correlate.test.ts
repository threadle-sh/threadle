import { describe, expect, it } from "vitest";
import { correlateCommitSessions } from "../src/git/correlate.js";

describe("correlateCommitSessions", () => {
  const commit = {
    hash: "abc123",
    commitTs: 1_700_000_000_000,
    subject: "fix foo",
    branch: "main",
    files: ["src/foo.ts", "packages/web/src/theme/theme.css"],
  };

  it("ranks by file overlap + time + branch", () => {
    const matches = correlateCommitSessions(commit, [
      {
        provider: "claude-code",
        sessionId: "s1",
        title: "hit",
        projectDir: "/proj",
        updatedAt: commit.commitTs + 60_000,
        gitBranch: "main",
        touchedFiles: ["/proj/src/foo.ts", "/proj/other.ts"],
      },
      {
        provider: "cursor",
        sessionId: "s2",
        title: "miss",
        projectDir: "/proj",
        updatedAt: commit.commitTs + 86_400_000 * 2,
        touchedFiles: ["/proj/unrelated.ts"],
      },
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.sessionId).toBe("s1");
    expect(matches[0]!.label).toBe("possible");
    expect(matches[0]!.matchReasons.some((r) => /touched/.test(r))).toBe(true);
    expect(matches[0]!.matchReasons.some((r) => /gitBranch|branch/i.test(r))).toBe(true);
  });

  it("ignores basename-only overlaps (theme.css ≠ any theme.css)", () => {
    const matches = correlateCommitSessions(commit, [
      {
        provider: "claude-code",
        sessionId: "noise",
        projectDir: "/proj",
        updatedAt: commit.commitTs,
        gitBranch: "main",
        touchedFiles: ["/other-repo/styles/theme.css"],
      },
    ]);
    expect(matches).toEqual([]);
  });

  it("ignores branch-only matches without file overlap", () => {
    const matches = correlateCommitSessions(commit, [
      {
        provider: "codex",
        sessionId: "tutor",
        title: "Understanding parallelism",
        projectDir: "/proj",
        updatedAt: commit.commitTs,
        gitBranch: "main",
        touchedFiles: [],
      },
    ]);
    expect(matches).toEqual([]);
  });

  it("matches absolute paths that end with the commit-relative path", () => {
    const matches = correlateCommitSessions(commit, [
      {
        provider: "cursor",
        sessionId: "ui",
        projectDir: "/Users/me/z-weft",
        updatedAt: commit.commitTs + 120_000,
        touchedFiles: [
          "/Users/me/z-weft/packages/web/src/theme/theme.css",
          "/Users/me/z-weft/src/foo.ts",
        ],
      },
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.sessionId).toBe("ui");
    expect(matches[0]!.score).toBeGreaterThanOrEqual(20);
  });

  it("returns empty when nothing correlates", () => {
    const matches = correlateCommitSessions(commit, [
      {
        provider: "opencode",
        sessionId: "x",
        projectDir: "/proj",
        updatedAt: 0,
        touchedFiles: [],
      },
    ]);
    expect(matches).toEqual([]);
  });
});
