/**
 * CLI inventory endpoints the list commands call (providers, graphs, health, …).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/providers/opencode/inject.js", () => ({
  runOpencodeAgent: vi.fn(),
  listOpencodeModels: async () => ["opencode/mock"],
  shutdownManagedServer: () => undefined,
}));
vi.mock("../src/providers/cursor/inject.js", () => ({
  runCursorAgent: vi.fn(),
  listCursorModels: async () => ["cursor-mock"],
}));
vi.mock("../src/providers/antigravity/inject.js", () => ({
  runAntigravityAgent: vi.fn(),
  listAntigravityModels: async () => ["agy-mock"],
}));
vi.mock("../src/providers/codex/inject.js", () => ({
  runCodexAgent: vi.fn(),
  listCodexModels: async () => ["codex-mock"],
}));
vi.mock("../src/providers/copilot/inject.js", () => ({
  runCopilotAgent: vi.fn(),
  listCopilotModels: async () => ["copilot-mock"],
}));
vi.mock("../src/providers/grok/inject.js", () => ({
  runGrokAgent: vi.fn(),
  listGrokModels: async () => ["grok-mock"],
}));
vi.mock("../src/providers/claude-code/inject.js", () => ({
  runClaudeAgent: vi.fn(),
}));
vi.mock("../src/watch.js", () => ({
  startWatchers: () => undefined,
}));
vi.mock("../src/providers/registry.js", () => ({
  registry: {
    info: async () => [
      { id: "cursor", available: true, version: "test" },
      { id: "claude-code", available: false },
    ],
    providers: new Map([
      [
        "cursor",
        {
          id: "cursor",
          available: async () => true,
          listAgents: async () => [
            {
              provider: "cursor",
              name: "ask",
              source: "cursor:builtin",
              scope: "builtin",
            },
          ],
          listSessions: async () => [
            {
              provider: "cursor",
              id: "ses_1",
              title: "Demo",
              projectDir: "/tmp",
              updatedAt: Date.now(),
            },
          ],
          getSession: async () => undefined,
          getTranscript: async () => [],
          liveStatuses: async () => [],
          version: async () => "test",
        },
      ],
    ]),
    get: () => ({
      available: async () => true,
      listAgents: async () => [],
      listSessions: async () => [],
      getSession: async () => undefined,
      getTranscript: async () => [],
      liveStatuses: async () => [],
    }),
  },
}));

import { createApp } from "../src/server.js";
import { importGraph } from "../src/graphs/store.js";
import { getWorkflowTemplate } from "../src/templates/workflows.js";

let dir: string;
let app: ReturnType<typeof createApp>;
const HOST = { Host: "127.0.0.1:4570" };

async function get(url: string): Promise<{ status: number; json: unknown }> {
  const res = await app.request(url, { headers: HOST });
  return { status: res.status, json: await res.json().catch(() => undefined) };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-cli-list-"));
  process.env.THREADLE_CONFIG_DIR = dir;
  app = createApp({ projectDir: dir });
  await importGraph(getWorkflowTemplate("hello-wire")!.graph);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.THREADLE_CONFIG_DIR;
});

describe("CLI inventory APIs", () => {
  it("health + process for services", async () => {
    const health = await get("/api/health");
    expect(health.status).toBe(200);
    expect(health.json).toMatchObject({ ok: true, projectDir: dir });

    const proc = await get("/api/internals/process");
    expect(proc.status).toBe(200);
    expect(proc.json).toMatchObject({
      pid: expect.any(Number),
      runningJobs: expect.any(Number),
    });
  });

  it("providers / agents / sessions / graphs / models / templates", async () => {
    const providers = await get("/api/providers");
    expect(providers.status).toBe(200);
    expect(providers.json).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "cursor", available: true })]),
    );

    const agents = await get("/api/agents");
    expect(agents.status).toBe(200);
    expect(agents.json).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "ask", provider: "cursor" })]),
    );

    const sessions = await get("/api/sessions");
    expect(sessions.status).toBe(200);
    expect(sessions.json).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "ses_1", title: "Demo" })]),
    );

    const graphs = await get("/api/graphs");
    expect(graphs.status).toBe(200);
    expect((graphs.json as unknown[]).length).toBeGreaterThan(0);

    const models = await get("/api/models");
    expect(models.status).toBe(200);
    expect(Array.isArray(models.json)).toBe(true);

    const templates = await get("/api/graphs/templates");
    expect(templates.status).toBe(200);
    expect(templates.json).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "hello-wire" })]),
    );

    const recipes = await get("/api/graphs/recipes");
    expect(recipes.status).toBe(200);
    expect(recipes.json).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "repo-brief" })]),
    );

    const nodes = await get("/api/custom-nodes");
    expect(nodes.status).toBe(200);
    expect(Array.isArray(nodes.json)).toBe(true);
  });
});
