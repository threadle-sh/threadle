/**
 * Example workflows + executor behaviors with mocked agent CLIs.
 * No real provider calls — zero spend / API cost.
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
import type { Graph, PortableGraph } from "@threadle/shared";

const runCursorAgent = vi.fn();
const runClaudeAgent = vi.fn();
const runOpencodeAgent = vi.fn();
const getSession = vi.fn();
const liveStatuses = vi.fn();
const recordInject = vi.fn();

vi.mock("../src/providers/cursor/inject.js", () => ({
  runCursorAgent: (...args: unknown[]) => runCursorAgent(...args),
}));
vi.mock("../src/providers/claude-code/inject.js", () => ({
  runClaudeAgent: (...args: unknown[]) => runClaudeAgent(...args),
}));
vi.mock("../src/providers/opencode/inject.js", () => ({
  runOpencodeAgent: (...args: unknown[]) => runOpencodeAgent(...args),
}));
vi.mock("../src/routes/lineage.js", () => ({
  recordInject: (...args: unknown[]) => recordInject(...args),
}));
vi.mock("../src/providers/registry.js", () => ({
  registry: {
    get: () => ({
      getSession: (...args: unknown[]) => getSession(...args),
      getTranscript: async () => [],
      listAgents: async () => [],
      listSessions: async () => [],
      available: async () => true,
      version: async () => undefined,
      liveStatuses: (...args: unknown[]) => liveStatuses(...args),
    }),
  },
}));

import { executeWorkflow } from "../src/workflows/executor.js";
import { importGraph, readGraph, saveGraph } from "../src/graphs/store.js";
import {
  WORKFLOW_TEMPLATES,
  getWorkflowTemplate,
} from "../src/templates/workflows.js";

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-ex-"));
  process.env.THREADLE_CONFIG_DIR = dir;
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.THREADLE_CONFIG_DIR;
});

beforeEach(() => {
  runCursorAgent.mockReset();
  runClaudeAgent.mockReset();
  runOpencodeAgent.mockReset();
  getSession.mockReset();
  liveStatuses.mockReset();
  recordInject.mockReset();

  runCursorAgent.mockImplementation(async (opts: { prompt: string; agent?: string }) => ({
    newSessionId: `mock-cursor-${Math.random().toString(36).slice(2, 8)}`,
    provider: "cursor" as const,
    resultText: `[mock:${opts.agent ?? "ask"}] ${String(opts.prompt).slice(0, 120)}`,
  }));
  runClaudeAgent.mockImplementation(async (opts: { prompt: string }) => ({
    newSessionId: "mock-claude",
    provider: "claude-code" as const,
    resultText: `[mock:claude] ${String(opts.prompt).slice(0, 80)}`,
  }));
  runOpencodeAgent.mockImplementation(async (opts: { prompt: string }) => ({
    newSessionId: "mock-oc",
    provider: "opencode" as const,
    resultText: `[mock:oc] ${String(opts.prompt).slice(0, 80)}`,
  }));
  // no session cost → spend tripwires stay quiet unless a test overrides
  getSession.mockResolvedValue(undefined);
  liveStatuses.mockResolvedValue(new Map());
});

function outputText(g: Graph): string | undefined {
  const out = g.nodes.find((n) => n.data.type === "output");
  return out?.data.type === "output" ? out.data.content : undefined;
}

async function runPortable(
  pg: PortableGraph,
  opts: { approveAll?: boolean; params?: Record<string, string> } = {},
): Promise<{ graph: Graph; logLines: string[]; outputs: number }> {
  const imported = await importGraph(structuredClone(pg), { trusted: true });
  // Detached readiness requires a model on every agent-def.
  for (const n of imported.nodes) {
    if (n.data.type === "agent-def" && !n.data.model) {
      n.data.model = "mock-model";
    }
  }
  await saveGraph(imported);

  const logLines: string[] = [];
  const result = await executeWorkflow({
    graphId: imported.id,
    projectDir: dir,
    approveAll: opts.approveAll ?? true,
    params: opts.params,
    log: (_lane, line) => logLines.push(line),
    signal: AbortSignal.timeout(30_000),
  });
  const graph = (await readGraph(imported.id))!;
  return { graph, logLines, outputs: result.outputs };
}

function portable(
  name: string,
  nodes: PortableGraph["nodes"],
  edges: PortableGraph["edges"],
  extra?: Partial<Pick<PortableGraph, "params" | "settings">>,
): PortableGraph {
  return {
    $schema: "threadle/graph@1",
    name,
    kind: "workflow",
    nodes,
    edges,
    params: extra?.params,
    settings: extra?.settings,
  };
}

describe("importGraph preserves settings", () => {
  it("keeps ply and spendTripwireUsd", async () => {
    const g = await importGraph(
      portable(
        "settings-keep",
        [
          {
            id: "p",
            type: "prompt",
            position: { x: 0, y: 0 },
            status: "idle",
            data: { type: "prompt", text: "x" },
          },
        ],
        [],
        { settings: { ply: 2, spendTripwireUsd: 1.5 } },
      ),
    );
    expect(g.settings).toEqual({ ply: 2, spendTripwireUsd: 1.5 });
  });
});

describe("example workflows (mocked agents)", () => {
  it("registers every template id", () => {
    const ids = WORKFLOW_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "hello-wire",
        "detached-delay",
        "hello-mcp",
        "hello-mcp-params",
        "mcp-then-agent",
        "splice-gate",
        "one-shot-agent",
        "param-prompt",
        "prompt-convert",
        "knot-concat",
        "knot-first",
        "iterator-lines",
        "mute-bypass",
        "content-tripwire",
        "judge-branch",
        "skill-invoke-judge",
        "until-reenter",
        "wait-idle-gate",
        "agent-err-fallback",
        "min-chars-tripwire",
        "spend-tripwire",
        "iterator-agent",
        "iterator-parallel",
        "token-tripwire",
        "plan-implement-review",
        "ply-fan-knot",
        "expert-guarded-fan",
        "complex-delay-pipeline",
        "cross-tool-distill",
        "session-autopsy",
      ]),
    );
    expect(WORKFLOW_TEMPLATES.length).toBeGreaterThanOrEqual(20);
  });

  it("hello-wire: prompt → output, no agents", async () => {
    const tpl = getWorkflowTemplate("hello-wire")!;
    const { graph, outputs } = await runPortable(tpl.graph);
    expect(outputs).toBe(1);
    expect(outputText(graph)).toContain("Hello from threadle");
    expect(runCursorAgent).not.toHaveBeenCalled();
  });

  it("hello-mcp: prompt → mcp-tool → output (mocked client)", async () => {
    const client = await import("../src/mcp/client.js");
    const spy = vi.spyOn(client, "callMcpTool").mockImplementation(async (opts) => {
      opts.onStderr?.("threadle-echo MCP server on stdio");
      return {
        text: String(opts.args?.message ?? opts.args?.input ?? "echo"),
        isError: false,
        stderr: "threadle-echo MCP server on stdio",
      };
    });
    try {
      const tpl = getWorkflowTemplate("hello-mcp")!;
      expect(tpl.level).toBe("intermediate");
      expect(tpl.graph.nodes.some((n) => n.data.type === "mcp-tool")).toBe(true);
      const { graph, outputs, logLines } = await runPortable(tpl.graph);
      expect(outputs).toBe(1);
      expect(outputText(graph)).toBe("Hello from threadle via MCP");
      expect(spy).toHaveBeenCalled();
      expect(logLines.some((l) => l.includes("threadle-echo"))).toBe(true);
      expect(runCursorAgent).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("hello-mcp-params: inspector params → mcp-tool → output (mocked)", async () => {
    const client = await import("../src/mcp/client.js");
    const spy = vi.spyOn(client, "callMcpTool").mockImplementation(async (opts) => ({
      text: String(opts.args?.message ?? "echo"),
      isError: false,
    }));
    try {
      const tpl = getWorkflowTemplate("hello-mcp-params")!;
      expect(tpl.level).toBe("intermediate");
      const mcp = tpl.graph.nodes.find((n) => n.data.type === "mcp-tool");
      expect(mcp?.data.type === "mcp-tool" && mcp.data.argPort).toBeFalsy();
      expect(mcp?.data.type === "mcp-tool" && mcp.data.params?.message).toContain("inspector");
      const { graph, outputs } = await runPortable(tpl.graph);
      expect(outputs).toBe(1);
      expect(outputText(graph)).toContain("inspector params");
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: "echo",
          tool: "echo",
          args: expect.objectContaining({ message: "Hello from inspector params — no wire" }),
        }),
      );
      expect(runCursorAgent).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("mcp-then-agent: mcp echo → convert → mocked cursor ask", async () => {
    const client = await import("../src/mcp/client.js");
    const spy = vi.spyOn(client, "callMcpTool").mockImplementation(async (opts) => ({
      text: String(opts.args?.message ?? "echo"),
      isError: false,
    }));
    try {
      const tpl = getWorkflowTemplate("mcp-then-agent")!;
      expect(tpl.level).toBe("advanced");
      expect(tpl.graph.nodes.some((n) => n.data.type === "prompt-convert")).toBe(true);
      const { graph, outputs } = await runPortable(tpl.graph);
      expect(outputs).toBe(1);
      expect(spy).toHaveBeenCalled();
      expect(runCursorAgent).toHaveBeenCalled();
      const prompt = runCursorAgent.mock.calls[0]?.[0]?.prompt as string;
      expect(prompt).toContain("Summarize the following MCP tool result");
      expect(prompt).toContain("threadle MCP tool nodes");
      expect(outputText(graph).length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("detached-delay: prompt → delay → output, no agents (shortened)", async () => {
    const tpl = getWorkflowTemplate("detached-delay")!;
    const g = structuredClone(tpl.graph);
    const delay = g.nodes.find((n) => n.data.type === "delay");
    expect(delay?.data.type).toBe("delay");
    if (delay?.data.type === "delay") delay.data.ms = 30;
    const { graph, outputs, logLines } = await runPortable(g);
    expect(outputs).toBe(1);
    expect(outputText(graph)).toContain("Detached delay demo");
    expect(logLines.some((l) => l.includes("delay"))).toBe(true);
    expect(runCursorAgent).not.toHaveBeenCalled();
  });

  it("splice-gate: approval auto-passes with approveAll", async () => {
    const tpl = getWorkflowTemplate("splice-gate")!;
    const { graph, logLines, outputs } = await runPortable(tpl.graph);
    expect(outputs).toBe(1);
    expect(logLines.some((l) => l.includes("auto-approved"))).toBe(true);
    expect(outputText(graph)).toContain("Ship notes");
  });

  it("splice-gate: refuses without approveAll", async () => {
    const tpl = getWorkflowTemplate("splice-gate")!;
    await expect(runPortable(tpl.graph, { approveAll: false })).rejects.toThrow(
      /approveAll/,
    );
    expect(runCursorAgent).not.toHaveBeenCalled();
  });

  it("knot-concat: merges both branches", async () => {
    const tpl = getWorkflowTemplate("knot-concat")!;
    const { graph, outputs } = await runPortable(tpl.graph);
    expect(outputs).toBe(1);
    const text = outputText(graph) ?? "";
    expect(text).toContain("Alpha findings");
    expect(text).toContain("Beta findings");
    expect(runCursorAgent).not.toHaveBeenCalled();
  });

  it("content-tripwire: parks on ERROR then auto-passes with approveAll", async () => {
    const tpl = getWorkflowTemplate("content-tripwire")!;
    const { graph, logLines, outputs } = await runPortable(tpl.graph);
    expect(outputs).toBe(1);
    expect(logLines.some((l) => l.includes("circuit breaker") && l.includes("park"))).toBe(
      true,
    );
    expect(outputText(graph)).toContain("ERROR");
  });

  it("content-tripwire: park without approveAll fails", async () => {
    const tpl = getWorkflowTemplate("content-tripwire")!;
    await expect(runPortable(tpl.graph, { approveAll: false })).rejects.toThrow(/parked/i);
  });

  it("judge-branch: routes PASS to the pass arm only", async () => {
    const tpl = getWorkflowTemplate("judge-branch")!;
    const { graph, outputs, logLines } = await runPortable(tpl.graph);
    expect(outputs).toBe(1);
    expect(logLines.some((l) => l.includes("judge") && l.includes("pass"))).toBe(true);
    const pass = graph.nodes.find((n) => n.id === "n-pass");
    const fail = graph.nodes.find((n) => n.id === "n-fail");
    const unsure = graph.nodes.find((n) => n.id === "n-unsure");
    expect(pass?.data.type === "output" && pass.data.content).toContain("PASS");
    expect(fail?.data.type === "output" && fail.data.content).toBeFalsy();
    expect(unsure?.data.type === "output" && unsure.data.content).toBeFalsy();
  });

  it("skill-invoke-judge: claude -p /name then Judge pass", async () => {
    runClaudeAgent.mockImplementation(async (opts: { prompt: string }) => ({
      newSessionId: "mock-skill-sess",
      provider: "claude-code",
      resultText: "skill run complete — all PASS",
      promptSeen: opts.prompt,
    }));
    const tpl = getWorkflowTemplate("skill-invoke-judge")!;
    const { graph, outputs, logLines } = await runPortable(tpl.graph);
    expect(outputs).toBe(1);
    expect(runClaudeAgent).toHaveBeenCalled();
    const call = runClaudeAgent.mock.calls[0]![0] as { prompt: string };
    expect(call.prompt).toMatch(/^\/example-skill/);
    expect(call.prompt).toContain("Summarize");
    expect(logLines.some((l) => l.includes("invoke /example-skill"))).toBe(true);
    const pass = graph.nodes.find((n) => n.id === "n-pass");
    expect(pass?.data.type === "output" && pass.data.content).toMatch(/PASS/);
  });

  it("skill invoke dispatches cursor when provider=cursor", async () => {
    runCursorAgent.mockImplementation(async () => ({
      newSessionId: "mock-cur-skill",
      provider: "cursor" as const,
      resultText: "cursor skill PASS",
    }));
    const tpl = structuredClone(getWorkflowTemplate("skill-invoke-judge")!.graph);
    const skill = tpl.nodes.find((n) => n.data.type === "skill");
    if (skill?.data.type === "skill") {
      skill.data.provider = "cursor";
      skill.data.mode = "invoke";
    }
    const { logLines } = await runPortable(tpl);
    expect(runCursorAgent).toHaveBeenCalled();
    expect(runClaudeAgent).not.toHaveBeenCalled();
    expect(logLines.some((l) => l.includes("via cursor"))).toBe(true);
  });

  it("until-reenter: loops convert then emits exhausted", async () => {
    const tpl = getWorkflowTemplate("until-reenter")!;
    const { graph, outputs, logLines } = await runPortable(tpl.graph);
    expect(outputs).toBe(1);
    expect(logLines.filter((l) => l.includes("until iteration")).length).toBe(3);
    expect(logLines.some((l) => l.includes("exhausted"))).toBe(true);
    expect(outputText(graph)).toMatch(/n\.+/);
  });

  it("agent-err-fallback: out:err arm runs when agent fails", async () => {
    runCursorAgent.mockRejectedValue(new Error("boom on purpose"));
    const tpl = getWorkflowTemplate("agent-err-fallback")!;
    const { graph, outputs, logLines } = await runPortable(tpl.graph);
    expect(outputs).toBe(1);
    expect(runCursorAgent).toHaveBeenCalled();
    expect(logLines.some((l) => l.includes("err port"))).toBe(true);
    expect(graph.nodes.find((n) => n.id === "n-agent")?.status).toBe("error");
    const happy = graph.nodes.find((n) => n.id === "n-happy");
    const errOut = graph.nodes.find((n) => n.id === "n-err");
    expect(happy?.data.type === "output" && happy.data.content).toBeFalsy();
    expect(errOut?.data.type === "output" && errOut.data.content).toMatch(
      /fallback after agent failure/i,
    );
    expect(errOut?.data.type === "output" && errOut.data.content).toMatch(/boom on purpose/);
  });

  it("one-shot-agent: uses mocked cursor, no real CLI", async () => {
    const tpl = getWorkflowTemplate("one-shot-agent")!;
    const { graph, outputs } = await runPortable(tpl.graph);
    expect(outputs).toBe(1);
    expect(runCursorAgent).toHaveBeenCalledTimes(1);
    expect(runClaudeAgent).not.toHaveBeenCalled();
    expect(outputText(graph)).toMatch(/\[mock:ask\]/);
  });

  it("spend-tripwire: agent mock + branch tripwire without cost", async () => {
    const tpl = getWorkflowTemplate("spend-tripwire")!;
    const { graph, outputs } = await runPortable(tpl.graph);
    expect(outputs).toBe(1);
    expect(runCursorAgent).toHaveBeenCalledTimes(1);
    expect(graph.settings?.spendTripwireUsd).toBe(0.5);
    expect(outputText(graph)).toMatch(/\[mock:/);
  });

  it("ply-fan-knot: two parallel mocked asks then majority knot", async () => {
    const tpl = getWorkflowTemplate("ply-fan-knot")!;
    const { graph, logLines, outputs } = await runPortable(tpl.graph);
    expect(outputs).toBe(1);
    expect(runCursorAgent).toHaveBeenCalledTimes(2);
    expect(logLines.some((l) => l.includes("parallelism"))).toBe(true);
    expect(graph.settings?.ply).toBe(2);
    expect(outputText(graph)).toBeTruthy();
  });

  it("plan-implement-review: mocked plan→agent→ask spine", async () => {
    const tpl = getWorkflowTemplate("plan-implement-review")!;
    const { graph, outputs } = await runPortable(tpl.graph, {
      params: { task: "mock task for tests" },
    });
    expect(outputs).toBe(1);
    expect(runCursorAgent).toHaveBeenCalled();
    // plan + agent + ask
    expect(runCursorAgent.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(outputText(graph)).toMatch(/\[mock:/);
  });

  it("cross-tool-distill: cursor then claude mocks", async () => {
    const tpl = getWorkflowTemplate("cross-tool-distill")!;
    const { graph, outputs } = await runPortable(tpl.graph, {
      params: { topic: "mock handoff" },
    });
    expect(outputs).toBe(1);
    expect(runCursorAgent).toHaveBeenCalledTimes(1);
    expect(runClaudeAgent).toHaveBeenCalledTimes(1);
    expect(outputText(graph)).toMatch(/\[mock:/);
  });

  it("session-autopsy: mocked ask + auto-approved gate", async () => {
    const tpl = getWorkflowTemplate("session-autopsy")!;
    const { graph, outputs, logLines } = await runPortable(tpl.graph, {
      params: { focus: "waste" },
    });
    expect(outputs).toBe(1);
    expect(runCursorAgent).toHaveBeenCalledTimes(1);
    expect(logLines.some((l) => l.includes("auto-approved"))).toBe(true);
    expect(outputText(graph)).toMatch(/\[mock:/);
  });

  it("expert-guarded-fan: ply fan with mocks and gates", async () => {
    const tpl = getWorkflowTemplate("expert-guarded-fan")!;
    const { graph, outputs } = await runPortable(tpl.graph);
    expect(outputs).toBe(1);
    expect(runCursorAgent).toHaveBeenCalledTimes(2);
    expect(graph.settings?.ply).toBe(2);
    expect(graph.settings?.spendTripwireUsd).toBe(1);
  });

  it("param-prompt expands {{param:topic}}", async () => {
    const tpl = getWorkflowTemplate("param-prompt")!;
    const { graph, outputs } = await runPortable(tpl.graph, {
      params: { topic: "mocked topic" },
    });
    expect(outputs).toBe(1);
    expect(outputText(graph)).toContain("mocked topic");
  });

  it("prompt-convert wraps inbound text", async () => {
    const tpl = getWorkflowTemplate("prompt-convert")!;
    const { graph, outputs } = await runPortable(tpl.graph);
    expect(outputs).toBe(1);
    expect(outputText(graph)).toContain("standup");
    expect(outputText(graph)).toContain("cache hits");
  });

  it("knot-first keeps only the first branch", async () => {
    const tpl = getWorkflowTemplate("knot-first")!;
    const { graph, outputs } = await runPortable(tpl.graph);
    expect(outputs).toBe(1);
    expect(outputText(graph)).toContain("First answer");
    expect(outputText(graph)).not.toContain("ignored");
  });

  it("mute-bypass skips muted and bypasses convert", async () => {
    const tpl = getWorkflowTemplate("mute-bypass")!;
    const { graph, outputs } = await runPortable(tpl.graph);
    expect(outputs).toBe(1);
    expect(outputText(graph)).toContain("only this text");
    expect(outputText(graph)).not.toContain("YOU SHOULD NOT SEE");
    expect(outputText(graph)).not.toContain("WRAPPED");
  });

  it("token-tripwire skips oversized branch", async () => {
    const tpl = getWorkflowTemplate("token-tripwire")!;
    const { graph, outputs } = await runPortable(tpl.graph);
    expect(outputs).toBe(0);
    expect(graph.nodes.find((n) => n.data.type === "tripwire")?.status).toBe("error");
  });

  it("iterator-agent runs mocked ask once per line", async () => {
    const tpl = getWorkflowTemplate("iterator-agent")!;
    const { outputs } = await runPortable(tpl.graph);
    expect(outputs).toBe(1);
    expect(runCursorAgent).toHaveBeenCalledTimes(3);
  });

  it("wait-idle-gate passes when session is already idle", async () => {
    const tpl = getWorkflowTemplate("wait-idle-gate")!;
    const { graph, outputs, logLines } = await runPortable(tpl.graph);
    expect(outputs).toBe(1);
    expect(outputText(graph)).toContain("Safe to inject");
    expect(logLines.some((l) => l.includes("session idle"))).toBe(true);
    expect(runCursorAgent).not.toHaveBeenCalled();
  });

  it("wait-idle skip on timeout when session stays busy", async () => {
    liveStatuses.mockResolvedValue(
      new Map([["replace-with-live-session", "running"]]),
    );
    const tpl = getWorkflowTemplate("wait-idle-gate")!;
    const pg = structuredClone(tpl.graph);
    const wait = pg.nodes.find((n) => n.data.type === "wait-idle");
    if (wait?.data.type === "wait-idle") {
      wait.data.timeoutMs = 1000;
      wait.data.onTimeout = "skip";
    }
    const { outputs, logLines } = await runPortable(pg);
    expect(outputs).toBe(0);
    expect(logLines.some((l) => /still busy.*skip/i.test(l))).toBe(true);
  });

  it("iterator-parallel runs fresh sessions (no sessionId reuse) then merge", async () => {
    const tpl = getWorkflowTemplate("iterator-parallel")!;
    const { outputs, logLines } = await runPortable(tpl.graph);
    expect(outputs).toBe(1);
    expect(runCursorAgent).toHaveBeenCalledTimes(3);
    for (const call of runCursorAgent.mock.calls) {
      const opts = call[0] as { sessionId?: string };
      expect(opts.sessionId).toBeUndefined();
    }
    expect(logLines.some((l) => l.includes("∀∥") || l.includes("parallel"))).toBe(true);
  });
});

describe("executor tripwire actions", () => {
  it("abort stops the run", async () => {
    await expect(
      runPortable(
        portable(
          "tw-abort",
          [
            {
              id: "p",
              type: "prompt",
              position: { x: 0, y: 0 },
              status: "idle",
              data: { type: "prompt", text: "boom ERROR here" },
            },
            {
              id: "tw",
              type: "tripwire",
              position: { x: 1, y: 0 },
              status: "idle",
              data: {
                type: "tripwire",
                mode: "content",
                action: "abort",
                pattern: "ERROR",
                tripOnMatch: true,
              },
            },
            {
              id: "o",
              type: "output",
              position: { x: 2, y: 0 },
              status: "idle",
              data: { type: "output" },
            },
          ],
          [
            { id: "e1", source: "p", target: "tw" },
            { id: "e2", source: "tw", target: "o" },
          ],
        ),
      ),
    ).rejects.toThrow(/circuit breaker/);
  });

  it("skip starves downstream output", async () => {
    const { graph, outputs } = await runPortable(
      portable(
        "tw-skip",
        [
          {
            id: "p",
            type: "prompt",
            position: { x: 0, y: 0 },
            status: "idle",
            data: { type: "prompt", text: "ERROR" },
          },
          {
            id: "tw",
            type: "tripwire",
            position: { x: 1, y: 0 },
            status: "idle",
            data: {
              type: "tripwire",
              mode: "content",
              action: "skip",
              pattern: "ERROR",
              tripOnMatch: true,
            },
          },
          {
            id: "o",
            type: "output",
            position: { x: 2, y: 0 },
            status: "idle",
            data: { type: "output" },
          },
        ],
        [
          { id: "e1", source: "p", target: "tw" },
          { id: "e2", source: "tw", target: "o" },
        ],
      ),
    );
    expect(outputs).toBe(0);
    const tw = graph.nodes.find((n) => n.id === "tw");
    expect(tw?.status).toBe("error");
    const out = graph.nodes.find((n) => n.id === "o");
    expect(out?.data.type === "output" && out.data.content).toBeFalsy();
  });

  it("graph spend ceiling aborts after mocked agent cost", async () => {
    getSession.mockResolvedValue({
      provider: "cursor",
      id: "s1",
      projectDir: dir,
      updatedAt: Date.now(),
      status: "idle",
      kind: "session",
      cost: 0.5,
      actualCost: 0.5,
    });
    await expect(
      runPortable(
        portable(
          "spend-ceil",
          [
            {
              id: "p",
              type: "prompt",
              position: { x: 0, y: 0 },
              status: "idle",
              data: { type: "prompt", text: "hi" },
            },
            {
              id: "a",
              type: "agent-def",
              position: { x: 1, y: 0 },
              status: "idle",
              data: {
                type: "agent-def",
                ref: { provider: "cursor", name: "ask", source: "cursor:builtin" },
                model: "mock",
              },
            },
            {
              id: "o",
              type: "output",
              position: { x: 2, y: 0 },
              status: "idle",
              data: { type: "output" },
            },
          ],
          [
            { id: "e1", source: "p", target: "a", data: { role: "instantiate" } },
            { id: "e2", source: "a", target: "o" },
          ],
          { settings: { spendTripwireUsd: 0.25 } },
        ),
      ),
    ).rejects.toThrow(/spend ceiling/);
    expect(runCursorAgent).toHaveBeenCalled();
  });
});

describe("executor judge routing", () => {
  it("routes pass arm only", async () => {
    const { graph, outputs } = await runPortable(
      portable(
        "judge-pass",
        [
          {
            id: "p",
            type: "prompt",
            position: { x: 0, y: 0 },
            status: "idle",
            data: { type: "prompt", text: "suite PASS" },
          },
          {
            id: "j",
            type: "judge",
            position: { x: 1, y: 0 },
            status: "idle",
            data: {
              type: "judge",
              matchers: [
                {
                  id: "m1",
                  port: "pass",
                  kind: "contains",
                  pattern: "PASS",
                },
                {
                  id: "m2",
                  port: "fail",
                  kind: "contains",
                  pattern: "FAIL",
                },
              ],
              unmatched: "unsure",
            },
          },
          {
            id: "op",
            type: "output",
            position: { x: 2, y: 0 },
            status: "idle",
            data: { type: "output" },
          },
          {
            id: "of",
            type: "output",
            position: { x: 2, y: 40 },
            status: "idle",
            data: { type: "output" },
          },
        ],
        [
          { id: "e1", source: "p", target: "j" },
          { id: "e2", source: "j", target: "op", sourceHandle: "out:pass" },
          { id: "e3", source: "j", target: "of", sourceHandle: "out:fail" },
        ],
      ),
    );
    expect(outputs).toBe(1);
    const passOut = graph.nodes.find((n) => n.id === "op");
    const failOut = graph.nodes.find((n) => n.id === "of");
    expect(passOut?.data.type === "output" && passOut.data.content).toContain("PASS");
    expect(failOut?.data.type === "output" && failOut.data.content).toBeFalsy();
    expect(graph.nodes.find((n) => n.id === "j")?.status).toBe("success");
  });

  it("unmatched unsure fills unsure arm", async () => {
    const { graph, outputs } = await runPortable(
      portable(
        "judge-unsure",
        [
          {
            id: "p",
            type: "prompt",
            position: { x: 0, y: 0 },
            status: "idle",
            data: { type: "prompt", text: "maybe later" },
          },
          {
            id: "j",
            type: "judge",
            position: { x: 1, y: 0 },
            status: "idle",
            data: {
              type: "judge",
              matchers: [
                { id: "m1", port: "pass", kind: "contains", pattern: "YES" },
              ],
              unmatched: "unsure",
            },
          },
          {
            id: "ou",
            type: "output",
            position: { x: 2, y: 0 },
            status: "idle",
            data: { type: "output" },
          },
        ],
        [
          { id: "e1", source: "p", target: "j" },
          { id: "e2", source: "j", target: "ou", sourceHandle: "out:unsure" },
        ],
      ),
    );
    expect(outputs).toBe(1);
    const ou = graph.nodes.find((n) => n.id === "ou");
    expect(ou?.data.type === "output" && ou.data.content).toContain("maybe later");
  });
});

describe("executor mute / bypass / iterator / convert", () => {
  it("muted prompt skips; bypassed convert passes input through", async () => {
    const { graph, outputs } = await runPortable(
      portable(
        "mute-bypass",
        [
          {
            id: "p",
            type: "prompt",
            position: { x: 0, y: 0 },
            status: "idle",
            muted: true,
            data: { type: "prompt", text: "secret" },
          },
          {
            id: "p2",
            type: "prompt",
            position: { x: 0, y: 40 },
            status: "idle",
            data: { type: "prompt", text: "visible" },
          },
          {
            id: "c",
            type: "prompt-convert",
            position: { x: 1, y: 40 },
            status: "idle",
            bypassed: true,
            data: { type: "prompt-convert", template: "WRAP {{input}}" },
          },
          {
            id: "o",
            type: "output",
            position: { x: 2, y: 40 },
            status: "idle",
            data: { type: "output" },
          },
        ],
        [
          { id: "e0", source: "p", target: "c" },
          { id: "e1", source: "p2", target: "c" },
          { id: "e2", source: "c", target: "o" },
        ],
      ),
    );
    expect(outputs).toBe(1);
    // bypassed convert forwards inbound text without applying template
    expect(outputText(graph)).toContain("visible");
    expect(outputText(graph)).not.toContain("WRAP");
    expect(outputText(graph)).not.toContain("secret");
  });

  it("iterator splits lines for a mocked agent fan-out", async () => {
    const { outputs } = await runPortable(
      portable(
        "iter",
        [
          {
            id: "p",
            type: "prompt",
            position: { x: 0, y: 0 },
            status: "idle",
            data: { type: "prompt", text: "one\ntwo\nthree" },
          },
          {
            id: "it",
            type: "iterator",
            position: { x: 1, y: 0 },
            status: "idle",
            data: { type: "iterator", splitMode: "lines" },
          },
          {
            id: "a",
            type: "agent-def",
            position: { x: 2, y: 0 },
            status: "idle",
            data: {
              type: "agent-def",
              ref: { provider: "cursor", name: "ask", source: "cursor:builtin" },
              model: "mock",
            },
          },
          {
            id: "o",
            type: "output",
            position: { x: 3, y: 0 },
            status: "idle",
            data: { type: "output" },
          },
        ],
        [
          { id: "e1", source: "p", target: "it" },
          { id: "e2", source: "it", target: "a", data: { role: "instantiate" } },
          { id: "e3", source: "a", target: "o" },
        ],
      ),
    );
    expect(outputs).toBe(1);
    expect(runCursorAgent).toHaveBeenCalledTimes(3);
  });

  it("continueOnError lets the run finish after a mocked agent throw", async () => {
    runCursorAgent
      .mockRejectedValueOnce(new Error("simulated agent failure"))
      .mockImplementation(async (opts: { prompt: string; agent?: string }) => ({
        newSessionId: "ok",
        provider: "cursor" as const,
        resultText: `ok:${opts.prompt}`,
      }));

    const { outputs, graph } = await runPortable(
      portable(
        "coe",
        [
          {
            id: "p",
            type: "prompt",
            position: { x: 0, y: 0 },
            status: "idle",
            data: { type: "prompt", text: "task" },
          },
          {
            id: "a1",
            type: "agent-def",
            position: { x: 1, y: 0 },
            status: "idle",
            continueOnError: true,
            data: {
              type: "agent-def",
              ref: { provider: "cursor", name: "ask", source: "cursor:builtin" },
              model: "mock",
            },
          },
          {
            id: "p2",
            type: "prompt",
            position: { x: 0, y: 80 },
            status: "idle",
            data: { type: "prompt", text: "fallback ok" },
          },
          {
            id: "o",
            type: "output",
            position: { x: 2, y: 80 },
            status: "idle",
            data: { type: "output" },
          },
        ],
        [
          { id: "e1", source: "p", target: "a1", data: { role: "instantiate" } },
          { id: "e2", source: "p2", target: "o" },
        ],
      ),
    );
    expect(outputs).toBe(1);
    expect(graph.nodes.find((n) => n.id === "a1")?.status).toBe("error");
    expect(outputText(graph)).toContain("fallback ok");
  });

  it("agent out:err routes failure text to the err arm", async () => {
    runCursorAgent.mockRejectedValueOnce(new Error("boom on purpose"));

    const { outputs, graph, logLines } = await runPortable(
      portable(
        "agent-err",
        [
          {
            id: "p",
            type: "prompt",
            position: { x: 0, y: 0 },
            status: "idle",
            data: { type: "prompt", text: "do work" },
          },
          {
            id: "a",
            type: "agent-def",
            position: { x: 1, y: 0 },
            status: "idle",
            data: {
              type: "agent-def",
              ref: { provider: "cursor", name: "ask", source: "cursor:builtin" },
              model: "mock",
            },
          },
          {
            id: "oh",
            type: "output",
            position: { x: 2, y: 0 },
            status: "idle",
            data: { type: "output", label: "happy" },
          },
          {
            id: "oe",
            type: "output",
            position: { x: 2, y: 80 },
            status: "idle",
            data: { type: "output", label: "err" },
          },
        ],
        [
          { id: "e1", source: "p", target: "a", data: { role: "instantiate" } },
          { id: "e2", source: "a", target: "oh" },
          { id: "e3", source: "a", target: "oe", sourceHandle: "out:err" },
        ],
      ),
    );
    expect(outputs).toBe(1);
    expect(logLines.some((l) => l.includes("err port"))).toBe(true);
    const happy = graph.nodes.find((n) => n.id === "oh");
    const errOut = graph.nodes.find((n) => n.id === "oe");
    expect(happy?.data.type === "output" && happy.data.content).toBeFalsy();
    expect(errOut?.data.type === "output" && errOut.data.content).toContain("boom");
    expect(graph.nodes.find((n) => n.id === "a")?.status).toBe("error");
  });
});
