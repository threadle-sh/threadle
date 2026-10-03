import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flushJobWrites, jobs } from "../src/jobs.js";

// jobs.finish appends to runs/jobs.jsonl — keep it out of the real config dir.
let dir: string;
let prevConfig: string | undefined;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-jobref-"));
  prevConfig = process.env.THREADLE_CONFIG_DIR;
  process.env.THREADLE_CONFIG_DIR = dir;
});

afterAll(async () => {
  await flushJobWrites();
  if (prevConfig === undefined) delete process.env.THREADLE_CONFIG_DIR;
  else process.env.THREADLE_CONFIG_DIR = prevConfig;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe("JobRecord.sessionRef", () => {
  it("stores sessionRef on create when provided", () => {
    const { jobId } = jobs.create("run-session", "abc123", "g1", {
      sessionRef: { provider: "claude-code", sessionId: "sess-full-id" },
    });
    const job = jobs.get(jobId);
    expect(job?.sessionRef).toEqual({
      provider: "claude-code",
      sessionId: "sess-full-id",
    });
    jobs.finish(jobId, { status: "cancelled", error: "test cleanup" });
  });

  it("omits sessionRef when not provided", () => {
    const { jobId } = jobs.create("run-agent", "claude-code:x");
    expect(jobs.get(jobId)?.sessionRef).toBeUndefined();
    jobs.finish(jobId, { status: "cancelled", error: "test cleanup" });
  });
});
