/**
 * Regression tests for the memory-leak remediation: the abandoned-job
 * reaper, the LRU cache bound, and job-history compaction.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jobs, compactJobHistory, JOB_ABANDON_MS, type JobRecord } from "../src/jobs.js";
import { LruMap } from "../src/lru.js";

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-leaks-"));
  process.env.THREADLE_CONFIG_DIR = dir;
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.THREADLE_CONFIG_DIR;
});

describe("abandoned-job reaper", () => {
  it("reaps stale client-driven jobs, leaves server-driven and fresh ones", () => {
    const { jobId: clientStale } = jobs.create("workflow", "stale", undefined, {
      clientDriven: true,
    });
    const { jobId: clientFresh } = jobs.create("workflow", "fresh", undefined, {
      clientDriven: true,
    });
    const { jobId: serverJob } = jobs.create("workflow", "server-driven");

    // age the stale one past the idle window
    const rec = jobs.get(clientStale)!;
    rec.touchedAt = Date.now() - JOB_ABANDON_MS - 1000;
    // the server job being old must NOT matter — it isn't client-driven
    jobs.get(serverJob)!.touchedAt = Date.now() - JOB_ABANDON_MS - 1000;

    const reaped = jobs.reapAbandoned();
    expect(reaped).toBe(1);
    expect(jobs.get(clientStale)!.status).toBe("error");
    expect(jobs.get(clientStale)!.error).toMatch(/abandoned/);
    expect(jobs.get(clientFresh)!.status).toBe("running");
    expect(jobs.get(serverJob)!.status).toBe("running");

    // touch() keeps a live client job out of the reaper's reach
    jobs.get(clientFresh)!.touchedAt = Date.now() - JOB_ABANDON_MS - 1000;
    jobs.touch(clientFresh);
    expect(jobs.reapAbandoned()).toBe(0);

    // cleanup
    jobs.finish(clientFresh, { status: "cancelled", error: "test done" });
    jobs.finish(serverJob, { status: "cancelled", error: "test done" });
  });
});

describe("LruMap", () => {
  it("evicts the least-recently-used entry past max", () => {
    const lru = new LruMap<string, number>(3);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);
    lru.get("a"); // refresh a — b is now oldest
    lru.set("d", 4);
    expect(lru.size).toBe(3);
    expect(lru.has("b")).toBe(false);
    expect(lru.get("a")).toBe(1);
    expect(lru.get("d")).toBe(4);
  });

  it("re-setting an existing key does not evict", () => {
    const lru = new LruMap<string, number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("a", 10);
    expect(lru.size).toBe(2);
    expect(lru.get("a")).toBe(10);
    expect(lru.get("b")).toBe(2);
  });
});

describe("compactJobHistory", () => {
  it("marks interrupted running rows and caps the file", async () => {
    const runsDir = path.join(dir, "runs");
    await fs.promises.mkdir(runsDir, { recursive: true });
    const rows: JobRecord[] = [];
    for (let i = 0; i < 2500; i++) {
      rows.push({
        id: `job_hist_${i}`,
        kind: "workflow",
        status: i === 2499 ? "running" : "done",
        createdAt: i,
      } as JobRecord);
    }
    await fs.promises.writeFile(
      path.join(runsDir, "jobs.jsonl"),
      rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
      "utf8",
    );

    await compactJobHistory(2000);

    const raw = await fs.promises.readFile(path.join(runsDir, "jobs.jsonl"), "utf8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines.length).toBe(2000);
    // Assert on the running row by id, not lines.at(-1): the registry's
    // fire-and-forget appendHistory() (from other tests' settling jobs) can
    // append a trailing row to the shared jobs.jsonl between our write and the
    // compact read, which would otherwise masquerade as "the last line".
    const marked = lines
      .map((l) => JSON.parse(l) as JobRecord)
      .find((r) => r.id === "job_hist_2499")!;
    expect(marked.status).toBe("error");
    expect(marked.error).toMatch(/interrupted/);
  });
});
