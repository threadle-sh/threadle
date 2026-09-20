/**
 * threadle run --watch helpers: graph source path + git fingerprint + kicks.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import {
  gitChangeFingerprint,
  resolveGraphSourceFile,
  startRunWatch,
} from "../src/cli-run-watch.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

function mkTmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

describe("resolveGraphSourceFile", () => {
  it("resolves an absolute portable graph path", () => {
    const dir = mkTmp("threadle-watch-g-");
    const file = path.join(dir, "flow.json");
    fs.writeFileSync(file, "{}", "utf8");
    expect(resolveGraphSourceFile(file)).toBe(file);
  });

  it("returns undefined for template ids (no on-disk source)", () => {
    expect(resolveGraphSourceFile("hello-wire")).toBeUndefined();
  });
});

describe("gitChangeFingerprint", () => {
  it("returns null outside a git work tree", async () => {
    const dir = mkTmp("threadle-watch-nogit-");
    expect(await gitChangeFingerprint(dir)).toBeNull();
  });

  it("changes when a tracked file is modified", async () => {
    const dir = mkTmp("threadle-watch-git-");
    await execa("git", ["init"], { cwd: dir });
    await execa("git", ["config", "user.email", "t@example.com"], { cwd: dir });
    await execa("git", ["config", "user.name", "t"], { cwd: dir });
    const file = path.join(dir, "a.txt");
    fs.writeFileSync(file, "one\n", "utf8");
    await execa("git", ["add", "a.txt"], { cwd: dir });
    await execa("git", ["commit", "-m", "init"], { cwd: dir });

    const before = await gitChangeFingerprint(dir);
    expect(before).toBeTruthy();

    fs.writeFileSync(file, "two\n", "utf8");
    const after = await gitChangeFingerprint(dir);
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
  });
});

describe("startRunWatch", () => {
  it("kicks on graph file change", async () => {
    const dir = mkTmp("threadle-watch-kick-");
    const graph = path.join(dir, "g.json");
    fs.writeFileSync(graph, '{"v":1}\n', "utf8");

    const kicks: string[] = [];
    const handle = await startRunWatch({
      graphFile: graph,
      projectDir: dir,
      debounceMs: 50,
      onKick: (reason) => {
        kicks.push(reason);
      },
    });

    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(graph, '{"v":2}\n', "utf8");

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 5_000;
      const tick = (): void => {
        if (kicks.includes("graph")) return resolve();
        if (Date.now() > deadline) return reject(new Error(`no kick: ${kicks.join(",")}`));
        setTimeout(tick, 50);
      };
      tick();
    });

    await handle.close();
    expect(kicks).toContain("graph");
  });

  it("kicks on git working-tree change", async () => {
    const dir = mkTmp("threadle-watch-gitkick-");
    await execa("git", ["init"], { cwd: dir });
    await execa("git", ["config", "user.email", "t@example.com"], { cwd: dir });
    await execa("git", ["config", "user.name", "t"], { cwd: dir });
    const file = path.join(dir, "a.txt");
    fs.writeFileSync(file, "one\n", "utf8");
    await execa("git", ["add", "a.txt"], { cwd: dir });
    await execa("git", ["commit", "-m", "init"], { cwd: dir });

    const kicks: string[] = [];
    const handle = await startRunWatch({
      projectDir: dir,
      debounceMs: 50,
      onKick: (reason) => {
        kicks.push(reason);
      },
    });
    expect(handle.label).toMatch(/git/);

    await new Promise((r) => setTimeout(r, 200));
    fs.writeFileSync(file, "two\n", "utf8");

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 8_000;
      const tick = (): void => {
        if (kicks.includes("git")) return resolve();
        if (Date.now() > deadline) return reject(new Error(`no git kick: ${kicks.join(",")}`));
        setTimeout(tick, 100);
      };
      tick();
    });

    await handle.close();
    expect(kicks).toContain("git");
  }, 15_000);
});
