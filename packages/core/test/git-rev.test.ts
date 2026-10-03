import { execa } from "execa";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isGitMissing, resolveCommitQuery, resolveCommitSha } from "../src/git/rev.js";

describe("resolveCommitSha / resolveCommitQuery", () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  async function initRepo(): Promise<string> {
    tmp = await mkdtemp(path.join(os.tmpdir(), "threadle-git-rev-"));
    await execa("git", ["init"], { cwd: tmp });
    await execa("git", ["config", "user.email", "t@example.com"], { cwd: tmp });
    await execa("git", ["config", "user.name", "t"], { cwd: tmp });
    await writeFile(path.join(tmp, "a.txt"), "hi\n");
    await execa("git", ["add", "a.txt"], { cwd: tmp });
    await execa("git", ["commit", "-m", "init"], { cwd: tmp });
    await writeFile(path.join(tmp, "a.txt"), "hi2\n");
    await execa("git", ["add", "a.txt"], { cwd: tmp });
    await execa("git", ["commit", "-m", "fix flaky auth race"], { cwd: tmp });
    return tmp;
  }

  it("resolves HEAD to a full sha", async () => {
    const dir = await initRepo();
    const sha = await resolveCommitSha(dir, "HEAD");
    expect(sha).toMatch(/^[0-9a-f]{40}$/i);
  });

  it("resolves by commit message substring", async () => {
    const dir = await initRepo();
    const r = await resolveCommitQuery(dir, "flaky auth");
    expect(r.matchedBy).toBe("message");
    if (r.matchedBy !== "message") return;
    expect(r.subject).toMatch(/flaky auth/i);
    expect(r.matchCount).toBeGreaterThanOrEqual(1);
    expect(r.sha).toMatch(/^[0-9a-f]{40}$/i);
  });

  it("prefers rev over message when both could apply", async () => {
    const dir = await initRepo();
    const r = await resolveCommitQuery(dir, "HEAD");
    expect(r.matchedBy).toBe("rev");
  });

  it("rejects unknown query with a short error", async () => {
    const dir = await initRepo();
    await expect(resolveCommitSha(dir, "cursor-xyz-no-match")).rejects.toThrow(
      /no commit matches rev or message/,
    );
  });

  it("rejects empty", async () => {
    await expect(resolveCommitSha("/tmp", "  ")).rejects.toThrow(/empty/);
  });

  it("detects missing git binary from spawn errors", () => {
    expect(isGitMissing(Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }))).toBe(
      true,
    );
    expect(isGitMissing(new Error("not a git repository"))).toBe(false);
  });

  it("reports when git binary is missing", async () => {
    const prev = process.env.PATH;
    process.env.PATH = path.join(os.tmpdir(), "threadle-no-git-bins");
    try {
      await expect(resolveCommitSha("/tmp", "HEAD")).rejects.toThrow(
        /git is not installed \(or not on PATH\)/,
      );
    } finally {
      process.env.PATH = prev;
    }
  });
});
