/**
 * threadle skills — list / import / export / toggle against a live local server.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";

vi.mock("../src/watch.js", () => ({
  startWatchers: () => undefined,
}));
vi.mock("../src/providers/registry.js", () => ({
  registry: {
    providers: new Map(),
    get: () => ({
      available: async () => false,
      listAgents: async () => [],
      listSessions: async () => [],
      getSession: async () => undefined,
      getTranscript: async () => [],
      liveStatuses: async () => [],
    }),
  },
}));

import { createApp } from "../src/server.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = path.join(repoRoot, "packages/server/src/cli.ts");
const node = process.execPath;

let dir: string;
let port: number;
let base: string;
let server: ReturnType<typeof serve>;
let prevConfig: string | undefined;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-cli-skills-"));
  prevConfig = process.env.THREADLE_CONFIG_DIR;
  process.env.THREADLE_CONFIG_DIR = dir;

  const app = createApp({ projectDir: dir });
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
      port = info.port;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  if (prevConfig === undefined) delete process.env.THREADLE_CONFIG_DIR;
  else process.env.THREADLE_CONFIG_DIR = prevConfig;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

async function threadle(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const res = await execa(node, ["--import", "tsx", cli, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      THREADLE_CONFIG_DIR: dir,
      THREADLE_URL: base,
    },
    reject: false,
    timeout: 30_000,
  });
  return { stdout: res.stdout, stderr: res.stderr, code: res.exitCode ?? 1 };
}

const SAMPLE = `---
name: cli-test-skill
description: Skill used by CLI tests
---

# cli-test-skill

Do the thing.
`;

describe("threadle skills", () => {
  it("imports, lists, toggles, and exports a skill", async () => {
    const md = path.join(dir, "cli-test-skill.SKILL.md");
    fs.writeFileSync(md, SAMPLE, "utf8");

    const empty = await threadle(["skills"]);
    expect(empty.code, empty.stderr || empty.stdout).toBe(0);
    expect(empty.stdout).toMatch(/\(no skills\)|NAME/);

    const imp = await threadle(["skills", "import", md]);
    expect(imp.code, imp.stderr || imp.stdout).toBe(0);
    expect(imp.stdout).toMatch(/imported skill "cli-test-skill"/);
    expect(imp.stdout).toMatch(/auto/);

    const list = await threadle(["skills", "list"]);
    expect(list.code, list.stderr || list.stdout).toBe(0);
    expect(list.stdout).toMatch(/cli-test-skill/);
    expect(list.stdout).toMatch(/auto/);

    const tog = await threadle(["skills", "toggle", "cli-test-skill", "--manual"]);
    expect(tog.code, tog.stderr || tog.stdout).toBe(0);
    expect(tog.stdout).toMatch(/manual/);

    const list2 = await threadle(["skills", "list"]);
    expect(list2.code, list2.stderr || list2.stdout).toBe(0);
    expect(list2.stdout).toMatch(/manual/);

    const out = path.join(dir, "exported.SKILL.md");
    const exp = await threadle(["skills", "export", "cli-test-skill", out]);
    expect(exp.code, exp.stderr || exp.stdout).toBe(0);
    expect(exp.stdout).toMatch(/exported skill/);
    expect(fs.existsSync(out)).toBe(true);
    const raw = fs.readFileSync(out, "utf8");
    expect(raw).toMatch(/cli-test-skill/);
    expect(raw).toMatch(/disable-model-invocation/);

    const back = await threadle(["skills", "toggle", "cli-test-skill", "--auto"]);
    expect(back.code, back.stderr || back.stdout).toBe(0);
    expect(back.stdout).toMatch(/auto/);
  }, 30_000);

  it("rejects toggle without --auto/--manual", async () => {
    const res = await threadle(["skills", "toggle", "cli-test-skill"]);
    expect(res.code).toBe(1);
    expect(res.stderr || res.stdout).toMatch(/--auto|--manual/);
  });
});
