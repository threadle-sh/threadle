/**
 * Server owns workflow job execution: POST /api/run/workflow registers a job,
 * runs executeWorkflow in-process on the server, persists graph outputs, and
 * exposes status/logs — independent of any browser runner.
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

const runCursorAgent = vi.fn();
const runClaudeAgent = vi.fn();
const runOpencodeAgent = vi.fn();

vi.mock("../src/providers/cursor/inject.js", () => ({
  runCursorAgent: (...args: unknown[]) => runCursorAgent(...args),
}));
vi.mock("../src/providers/claude-code/inject.js", () => ({
  runClaudeAgent: (...args: unknown[]) => runClaudeAgent(...args),
}));
vi.mock("../src/providers/opencode/inject.js", () => ({
  runOpencodeAgent: (...args: unknown[]) => runOpencodeAgent(...args),
  shutdownManagedServer: () => undefined,
}));
vi.mock("../src/routes/lineage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/routes/lineage.js")>();
  return {
    ...actual,
    recordInject: vi.fn(),
  };
});
vi.mock("../src/providers/registry.js", () => ({
  registry: {
    get: () => ({
      getSession: async () => undefined,
      getTranscript: async () => [],
      listAgents: async () => [],
      listSessions: async () => [],
      available: async () => true,
      version: async () => undefined,
      liveStatuses: async () => [],
    }),
  },
}));
vi.mock("../src/watch.js", () => ({
  startWatchers: () => undefined,
}));

import { createApp } from "../src/server.js";
import { jobs, readJobLogs } from "../src/jobs.js";
import { importGraph, readGraph, saveGraph } from "../src/graphs/store.js";
import { getWorkflowTemplate } from "../src/templates/workflows.js";
import type { Graph } from "@threadle/shared";

let dir: string;
let app: ReturnType<typeof createApp>;

const HOST = { Host: "127.0.0.1:4570" };

/** Detached readiness requires a model on every agent-def. */
async function withModels(g: Graph): Promise<Graph> {
  for (const n of g.nodes) {
    if (n.data.type === "agent-def" && !n.data.model) n.data.model = "mock-model";
  }
  return saveGraph(g);
}

async function api(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const init: RequestInit = {
    method,
    headers: {
      ...HOST,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.request(url, init);
  const json = await res.json().catch(() => undefined);
  return { status: res.status, json };
}

async function waitJob(
  jobId: string,
  timeoutMs = 8_000,
): Promise<{ status: string; error?: string; graphId?: string; kind?: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const live = jobs.get(jobId);
    if (live && live.status !== "running") {
      return live;
    }
    const { status, json } = await api("GET", `/api/jobs/${jobId}`);
    if (status === 200) {
      const job = json as { status: string; error?: string };
      if (job.status !== "running") return job as never;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`job ${jobId} still running after ${timeoutMs}ms`);
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-jobs-"));
  process.env.THREADLE_CONFIG_DIR = dir;
  app = createApp({ projectDir: dir });
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.THREADLE_CONFIG_DIR;
});

beforeEach(() => {
  runCursorAgent.mockReset();
  runClaudeAgent.mockReset();
  runOpencodeAgent.mockReset();
  runCursorAgent.mockImplementation(async (opts: { prompt: string; agent?: string }) => ({
    newSessionId: `mock-${Math.random().toString(36).slice(2, 8)}`,
    provider: "cursor" as const,
    resultText: `[mock:${opts.agent ?? "ask"}] ${String(opts.prompt).slice(0, 80)}`,
  }));
});

describe("server workflow jobs (heavy lifting on the server)", () => {
  it("POST /api/run/workflow creates a job, executes on the server, persists output", async () => {
    const tpl = getWorkflowTemplate("hello-wire")!;
    const g = await importGraph(tpl.graph, { trusted: true });

    const start = await api("POST", "/api/run/workflow", {
      graphId: g.id,
      projectDir: dir,
    });
    expect(start.status).toBe(202);
    const { jobId } = start.json as { jobId: string };
    expect(jobId).toMatch(/^job_/);

    // Immediately visible as a server-owned running (or already-done) job
    const listed = await api("GET", "/api/jobs");
    expect(listed.status).toBe(200);
    const jobsList = listed.json as Array<{ id: string; kind: string; graphId?: string }>;
    expect(jobsList.some((j) => j.id === jobId && j.kind === "workflow" && j.graphId === g.id)).toBe(
      true,
    );

    const finished = await waitJob(jobId);
    expect(finished.status).toBe("done");

    // Graph on disk updated by the server executor — not by a browser runner
    const saved = await readGraph(g.id);
    const out = saved?.nodes.find((n) => n.data.type === "output");
    expect(out?.data.type).toBe("output");
    if (out?.data.type === "output") {
      expect(out.data.content).toContain("Hello from threadle");
    }
    expect(out?.status).toBe("success");

    // Agent-free graph: no CLI spawn
    expect(runCursorAgent).not.toHaveBeenCalled();
    expect(runClaudeAgent).not.toHaveBeenCalled();
    expect(runOpencodeAgent).not.toHaveBeenCalled();

    const logRes = await api("GET", `/api/jobs/${jobId}/logs`);
    expect(logRes.status).toBe(200);
    const { lines } = logRes.json as { lines: Array<{ lane: string; line: string }> };
    expect(lines.some((l) => /detached run (started|finished)/.test(l.line))).toBe(true);

    // Disk log file written by the server job registry
    const diskLogs = await readJobLogs(jobId);
    expect(diskLogs.length).toBeGreaterThan(0);
  });

  it("runs parallel server jobs for different graphs", async () => {
    const a = await importGraph(getWorkflowTemplate("hello-wire")!.graph, { trusted: true });
    const b = await importGraph(getWorkflowTemplate("knot-concat")!.graph, { trusted: true });

    const [ra, rb] = await Promise.all([
      api("POST", "/api/run/workflow", { graphId: a.id, projectDir: dir }),
      api("POST", "/api/run/workflow", { graphId: b.id, projectDir: dir }),
    ]);
    expect(ra.status).toBe(202);
    expect(rb.status).toBe(202);
    const idA = (ra.json as { jobId: string }).jobId;
    const idB = (rb.json as { jobId: string }).jobId;
    expect(idA).not.toBe(idB);

    const [fa, fb] = await Promise.all([waitJob(idA), waitJob(idB)]);
    expect(fa.status).toBe("done");
    expect(fb.status).toBe("done");

    const outA = (await readGraph(a.id))?.nodes.find((n) => n.data.type === "output");
    const outB = (await readGraph(b.id))?.nodes.find((n) => n.data.type === "output");
    expect(outA?.data.type === "output" && outA.data.content).toContain("Hello from threadle");
    expect(outB?.data.type === "output" && outB.data.content).toContain("Alpha findings");
    expect(outB?.data.type === "output" && outB.data.content).toContain("Beta findings");

    expect(runCursorAgent).not.toHaveBeenCalled();
  });

  it("POST /api/run/workflow accepts a partial scope", async () => {
    const g = await importGraph(getWorkflowTemplate("hello-wire")!.graph, { trusted: true });
    const start = await api("POST", "/api/run/workflow", {
      graphId: g.id,
      projectDir: dir,
      scope: ["n-prompt", "n-out"],
    });
    expect(start.status).toBe(202);
    const { jobId } = start.json as { jobId: string };
    const finished = await waitJob(jobId);
    expect(finished.status).toBe("done");
    const saved = await readGraph(g.id);
    const out = saved?.nodes.find((n) => n.data.type === "output");
    expect(out?.data.type === "output" && out.data.content).toContain("Hello from threadle");
  });

  it("POST /api/jobs/start alone does not execute the graph (client shell only)", async () => {
    const g = await importGraph(getWorkflowTemplate("hello-wire")!.graph, { trusted: true });
    const before = await readGraph(g.id);
    const outBefore = before?.nodes.find((n) => n.data.type === "output");
    expect(outBefore?.data.type === "output" ? outBefore.data.content : undefined).toBeUndefined();

    const start = await api("POST", "/api/jobs/start", {
      kind: "workflow",
      label: "client shell",
      graphId: g.id,
    });
    expect(start.status).toBe(202);
    const { jobId } = start.json as { jobId: string };

    // Give the server a moment — nothing should run
    await new Promise((r) => setTimeout(r, 150));
    const after = await readGraph(g.id);
    const outAfter = after?.nodes.find((n) => n.data.type === "output");
    expect(outAfter?.data.type === "output" ? outAfter.data.content : undefined).toBeUndefined();

    // Job stays "running" until the client finishes it — server did not execute
    expect(jobs.get(jobId)?.status).toBe("running");
    const finish = await api("POST", `/api/jobs/${jobId}/finish`, { ok: true });
    expect(finish.status).toBe(200);
    expect(jobs.get(jobId)?.status).toBe("done");
  });

  it("agent workflow job invokes mocked agent on the server path", async () => {
    const g = await withModels(await importGraph(getWorkflowTemplate("one-shot-agent")!.graph, { trusted: true }));
    const start = await api("POST", "/api/run/workflow", {
      graphId: g.id,
      projectDir: dir,
    });
    expect(start.status).toBe(202);
    const { jobId } = start.json as { jobId: string };
    const finished = await waitJob(jobId, 15_000);
    expect(finished.status).toBe("done");
    expect(runCursorAgent).toHaveBeenCalled();
    expect(runClaudeAgent).not.toHaveBeenCalled();

    const saved = await readGraph(g.id);
    const out = saved?.nodes.find((n) => n.data.type === "output");
    expect(out?.data.type === "output" && out.data.content).toMatch(/\[mock:/);
  });

  it("GET /api/jobs/:id resolves finished jobs from history", async () => {
    const g = await importGraph(getWorkflowTemplate("hello-wire")!.graph, { trusted: true });
    const start = await api("POST", "/api/run/workflow", {
      graphId: g.id,
      projectDir: dir,
    });
    const { jobId } = start.json as { jobId: string };
    await waitJob(jobId);

    const got = await api("GET", `/api/jobs/${jobId}`);
    expect(got.status).toBe(200);
    expect(got.json).toMatchObject({ id: jobId, kind: "workflow", status: "done", graphId: g.id });
  });

  it("DELETE /api/jobs/:id cancels a long-running server job", async () => {
    runCursorAgent.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    const g = await withModels(await importGraph(getWorkflowTemplate("one-shot-agent")!.graph, { trusted: true }));
    const start = await api("POST", "/api/run/workflow", {
      graphId: g.id,
      projectDir: dir,
    });
    const { jobId } = start.json as { jobId: string };

    const startWait = Date.now();
    while (Date.now() - startWait < 2000) {
      if (jobs.get(jobId)?.status === "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(jobs.get(jobId)?.status).toBe("running");

    const cancel = await api("DELETE", `/api/jobs/${jobId}`);
    expect(cancel.status).toBe(200);

    const finished = await waitJob(jobId, 5_000);
    expect(finished.status).toBe("cancelled");
  });
});
