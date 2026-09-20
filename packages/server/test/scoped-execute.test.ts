/**
 * Scoped execute + job output cache.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Graph } from "@threadle/shared";

vi.mock("../src/providers/cursor/inject.js", () => ({
  runCursorAgent: vi.fn(),
}));
vi.mock("../src/providers/claude-code/inject.js", () => ({
  runClaudeAgent: vi.fn(),
}));
vi.mock("../src/providers/opencode/inject.js", () => ({
  runOpencodeAgent: vi.fn(),
}));
vi.mock("../src/routes/lineage.js", () => ({
  recordInject: vi.fn(),
}));
vi.mock("../src/providers/registry.js", () => ({
  registry: {
    get: () => ({
      getSession: async () => undefined,
      getTranscript: async () => [],
      listAgents: async () => [],
      listSessions: async () => [],
      available: async () => true,
      version: async () => undefined,
      liveStatuses: async () => new Map(),
    }),
  },
}));

import { executeWorkflow } from "../src/workflows/executor.js";
import { saveGraph } from "../src/graphs/store.js";
import {
  jobs,
  readJobOutputs,
  writeJobOutputs,
} from "../src/jobs.js";

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-scope-"));
  process.env.THREADLE_CONFIG_DIR = dir;
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.THREADLE_CONFIG_DIR;
});

function graph(): Graph {
  return {
    id: "scope-pipe",
    name: "scope-pipe",
    schemaVersion: 1,
    kind: "workflow",
    createdAt: 0,
    updatedAt: 0,
    nodes: [
      {
        id: "p1",
        type: "prompt",
        position: { x: 0, y: 0 },
        data: { type: "prompt", text: "hello upstream" },
      },
      {
        id: "d1",
        type: "delay",
        position: { x: 100, y: 0 },
        data: { type: "delay", ms: 0 },
      },
      {
        id: "o1",
        type: "output",
        position: { x: 200, y: 0 },
        data: { type: "output" },
      },
    ],
    edges: [
      { id: "e1", source: "p1", target: "d1" },
      { id: "e2", source: "d1", target: "o1" },
    ],
  };
}

describe("scoped executeWorkflow", () => {
  beforeEach(async () => {
    await saveGraph(graph());
  });

  it("seeds out-of-scope prompt and runs only scoped nodes", async () => {
    const { jobId, signal } = jobs.create("workflow", "scoped", "scope-pipe");
    const logs: string[] = [];
    const res = await executeWorkflow({
      graphId: "scope-pipe",
      projectDir: dir,
      approveAll: true,
      signal,
      jobId,
      scope: ["d1", "o1"],
      log: (_lane, line) => logs.push(line),
    });
    expect(res.outputs).toBe(1);
    expect(res.outputTexts[0]).toContain("hello upstream");
    expect(logs.some((l) => /reuse/.test(l))).toBe(true);
    const cached = await readJobOutputs(jobId);
    expect(cached.o1?.text).toContain("hello upstream");
    jobs.finish(jobId, { status: "done", result: { type: "job.done", jobId } });
  });

  it("prefers prior job outputs when seeding", async () => {
    const prior = jobs.create("workflow", "prior", "scope-pipe");
    await writeJobOutputs(prior.jobId, {
      p1: { text: "from-cache" },
    });
    jobs.finish(prior.jobId, {
      status: "done",
      result: { type: "job.done", jobId: prior.jobId },
    });

    const { jobId, signal } = jobs.create("workflow", "replay", "scope-pipe");
    const logs: string[] = [];
    const res = await executeWorkflow({
      graphId: "scope-pipe",
      projectDir: dir,
      approveAll: true,
      signal,
      jobId,
      scope: ["d1", "o1"],
      replayFromJobId: prior.jobId,
      log: (_lane, line) => logs.push(line),
    });
    expect(res.outputTexts[0]).toBe("from-cache");
    expect(logs.some((l) => /seeding from job/.test(l))).toBe(true);
    jobs.finish(jobId, { status: "done", result: { type: "job.done", jobId } });
  });
});
