/**
 * Executor-level containment of workflow-supplied `snapshot.projectDir`:
 * a session node whose snapshot names a directory outside the known project
 * roots must FAIL LOUDLY before any provider CLI is spawned — legitimate
 * exports never carry the field (it's stripped), and live sessions re-resolve
 * to known dirs, so an unknown value here is a tampered import choosing its
 * own cwd. Includes a positive control: a known dir still runs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const runCursorAgent = vi.fn();
vi.mock("../src/providers/cursor/inject.js", () => ({
  runCursorAgent: (...args: unknown[]) => runCursorAgent(...args),
}));
vi.mock("../src/routes/lineage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/routes/lineage.js")>();
  return { ...actual, recordInject: vi.fn() };
});
// Hermetic isKnownProjectDir: no real provider scans — the only known root
// is defaultProjectDir (process.cwd() in this test).
vi.mock("../src/providers/registry.js", () => ({
  registry: {
    providers: new Map(),
    get: () => ({
      getSession: async () => undefined,
      getTranscript: async () => [],
      listAgents: async () => [],
      listSessions: async () => [],
      available: async () => true,
      liveStatuses: async () => [],
    }),
  },
}));
vi.mock("../src/watch.js", () => ({ startWatchers: () => undefined }));

import { executeWorkflow } from "../src/workflows/executor.js";
import { saveGraph, deleteGraph } from "../src/graphs/store.js";
import type { Graph } from "@threadle/shared";

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-exec-dir-"));
  process.env.THREADLE_CONFIG_DIR = dir;
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.THREADLE_CONFIG_DIR;
});

beforeEach(() => {
  runCursorAgent.mockReset();
  runCursorAgent.mockResolvedValue({
    newSessionId: "mock-session",
    provider: "cursor",
    resultText: "ok",
  });
});

/** prompt → cursor session node with the given snapshot.projectDir. */
function sessionGraph(id: string, projectDir: string | undefined): Graph {
  const now = Date.now();
  return {
    id,
    name: `exec-dir-${id}`,
    schemaVersion: 1,
    kind: "workflow",
    nodes: [
      {
        id: "p1",
        type: "prompt",
        position: { x: 0, y: 0 },
        status: "idle",
        data: { type: "prompt", text: "hello" },
      },
      {
        id: "s1",
        type: "session",
        position: { x: 240, y: 0 },
        status: "idle",
        data: {
          type: "session",
          ref: { provider: "cursor", sessionId: "abc123" },
          snapshot: { title: "t", ...(projectDir ? { projectDir } : {}) },
        },
      },
    ],
    edges: [{ id: "e1", source: "p1", target: "s1" }],
    createdAt: now,
    updatedAt: now,
  } as Graph;
}

const noop = (): void => undefined;

describe("executor snapshot.projectDir containment", () => {
  it("fails the run on an unknown (tampered) snapshot.projectDir, before any spawn", async () => {
    const g = await saveGraph(sessionGraph("execdirbad", "/private/var/empty"));
    try {
      await expect(
        executeWorkflow({
          graphId: g.id,
          projectDir: process.cwd(),
          log: noop,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/not a known project directory/);
      expect(runCursorAgent).not.toHaveBeenCalled();
    } finally {
      await deleteGraph(g.id);
    }
  });

  it("runs with a known snapshot.projectDir and passes it as the cwd (positive control)", async () => {
    const known = process.cwd();
    const g = await saveGraph(sessionGraph("execdirok", known));
    try {
      const res = await executeWorkflow({
        graphId: g.id,
        projectDir: "/some/other/default",
        log: noop,
        signal: new AbortController().signal,
      });
      expect(res).toBeTruthy();
      expect(runCursorAgent).toHaveBeenCalledTimes(1);
      const args = runCursorAgent.mock.calls[0]![0] as { projectDir: string };
      expect(path.resolve(args.projectDir)).toBe(path.resolve(known));
    } finally {
      await deleteGraph(g.id);
    }
  });

  it("falls back to opts.projectDir when no snapshot dir is present", async () => {
    const g = await saveGraph(sessionGraph("execdirnone", undefined));
    try {
      await executeWorkflow({
        graphId: g.id,
        projectDir: process.cwd(),
        log: noop,
        signal: new AbortController().signal,
      });
      expect(runCursorAgent).toHaveBeenCalledTimes(1);
      const args = runCursorAgent.mock.calls[0]![0] as { projectDir: string };
      expect(path.resolve(args.projectDir)).toBe(path.resolve(process.cwd()));
    } finally {
      await deleteGraph(g.id);
    }
  });
});
