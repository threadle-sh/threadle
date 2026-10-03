import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execa } from "execa";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = path.join(repoRoot, "packages/server/src/cli.ts");
const node = process.execPath;

let dir: string;
let prevConfig: string | undefined;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-cli-ie-"));
  prevConfig = process.env.THREADLE_CONFIG_DIR;
  process.env.THREADLE_CONFIG_DIR = dir;
});

afterAll(() => {
  if (prevConfig === undefined) delete process.env.THREADLE_CONFIG_DIR;
  else process.env.THREADLE_CONFIG_DIR = prevConfig;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

async function threadle(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const res = await execa(
    node,
    ["--import", "tsx", cli, ...args],
    {
      cwd: repoRoot,
      env: { ...process.env, THREADLE_CONFIG_DIR: dir },
      reject: false,
      timeout: 30_000,
    },
  );
  return { stdout: res.stdout, stderr: res.stderr, code: res.exitCode ?? 1 };
}

describe("threadle import / export (portable graph)", () => {
  it("exports a template as threadle/graph@1 and imports it back", async () => {
    const out = path.join(dir, "hello.json");
    const exp = await threadle(["export", "hello", out]);
    expect(exp.code, exp.stderr || exp.stdout).toBe(0);
    expect(exp.stdout).toMatch(/exported portable graph/);
    expect(fs.existsSync(out)).toBe(true);

    const raw = JSON.parse(fs.readFileSync(out, "utf8")) as {
      $schema?: string;
      name?: string;
    };
    expect(raw.$schema).toBe("threadle/graph@1");
    expect(raw.name).toBeTruthy();

    const imp = await threadle(["import", out]);
    expect(imp.code, imp.stderr || imp.stdout).toBe(0);
    expect(imp.stdout).toMatch(/imported workflow/);
    expect(imp.stdout).toMatch(/\([a-f0-9]+\)/i);
  });

  it("export --backup still writes threadle/backup@1", async () => {
    const out = path.join(dir, "backup.json");
    const exp = await threadle(["export", "--backup", out]);
    expect(exp.code, exp.stderr || exp.stdout).toBe(0);
    expect(exp.stdout).toMatch(/exported backup/);
    const raw = JSON.parse(fs.readFileSync(out, "utf8")) as { $schema?: string };
    expect(raw.$schema).toBe("threadle/backup@1");

    const imp = await threadle(["import", out]);
    expect(imp.code, imp.stderr || imp.stdout).toBe(0);
    expect(imp.stdout).toMatch(/restored backup/);
  });
});

describe("threadle run (foreground) records a job", () => {
  it("appends the run to runs/jobs.jsonl with logs", async () => {
    const graph = path.join(repoRoot, "examples/workflows/iterator-lines.json");
    const res = await threadle(["run", graph, "--accept-imported", "--ephemeral"]);
    expect(res.code, res.stderr || res.stdout).toBe(0);

    const rows = fs
      .readFileSync(path.join(dir, "runs", "jobs.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { id: string; kind: string; status: string; label?: string });
    const last = rows[rows.length - 1]!;
    expect(last.kind).toBe("workflow");
    expect(last.status).toBe("done");
    expect(last.label).toMatch(/^cli: /);
    // started checkpoint + finished row for the same job
    expect(rows.filter((r) => r.id === last.id).map((r) => r.status)).toEqual(["running", "done"]);

    const logs = fs.readFileSync(path.join(dir, "runs", "logs", `${last.id}.jsonl`), "utf8");
    expect(logs).toMatch(/workflow run started from the CLI/);
    expect(logs).toMatch(/workflow run finished/);
  });
});
