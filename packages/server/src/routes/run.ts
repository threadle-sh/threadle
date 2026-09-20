import { Hono } from "hono";
import matter from "gray-matter";
import type { InjectResult, ModelInfo, RunAgentRequest, RunSessionRequest } from "@threadle/shared";
import {
  claudeExhaustedForModel,
  enrichUsageExhaustionError,
  formatUsageExhaustionMessage,
  isAbsolutePath,
  summarizeGraphExecution,
} from "@threadle/shared";
import { isKnownProjectDir } from "../readable-paths.js";
import { bus } from "../events.js";
import { appendJobLog, appLog, jobs, mergeJobNodeOutput, readAppLogs, readJobLogs, readJobOutputs, findLatestGraphOutputs, type CachedNodeOutput } from "../jobs.js";
import {
  listOpencodeModels,
  runOpencodeAgent,
} from "../providers/opencode/inject.js";
import { runClaudeAgent } from "../providers/claude-code/inject.js";
import { listCursorModels, runCursorAgent } from "../providers/cursor/inject.js";
import {
  listAntigravityModels,
  runAntigravityAgent,
} from "../providers/antigravity/inject.js";
import { listCodexModels, runCodexAgent } from "../providers/codex/inject.js";
import { listCopilotModels, runCopilotAgent } from "../providers/copilot/inject.js";
import { listGrokModels, runGrokAgent } from "../providers/grok/inject.js";
import { registry } from "../providers/registry.js";
import { executeWorkflow } from "../workflows/executor.js";
import { readGraph } from "../graphs/store.js";
import { readSubscription } from "./subscription.js";
import type { LogSink } from "../providers/stream.js";

const LOG_LINE_MAX = 2000;
const KNOWN_PROVIDERS = new Set([
  "claude-code",
  "opencode",
  "cursor",
  "antigravity",
  "codex",
  "copilot",
  "grok",
]);

function logSinkFor(jobId: string): LogSink {
  return (lane, line) => {
    const capped = line.length > LOG_LINE_MAX ? `${line.slice(0, LOG_LINE_MAX)}…` : line;
    bus.publish({ type: "job.log", jobId, lane, line: capped });
    appendJobLog(jobId, lane, capped); // persisted for the Runs view
  };
}

export const runRoutes = new Hono();
export const modelRoutes = new Hono();

// aliases the claude CLI accepts for --model, plus room for full ids via free text
const CLAUDE_MODELS = ["sonnet", "opus", "haiku", "claude-fable-5", "claude-opus-5", "claude-sonnet-5"];

modelRoutes.get("/", async (c) => {
  const models: ModelInfo[] = CLAUDE_MODELS.map((id) => ({
    provider: "claude-code" as const,
    id,
  }));
  for (const id of await listOpencodeModels()) {
    models.push({ provider: "opencode", id });
  }
  for (const id of await listCursorModels()) {
    models.push({ provider: "cursor", id });
  }
  for (const id of await listAntigravityModels()) {
    models.push({ provider: "antigravity", id });
  }
  for (const id of await listCodexModels()) {
    models.push({ provider: "codex", id });
  }
  for (const id of await listCopilotModels()) {
    models.push({ provider: "copilot", id });
  }
  for (const id of await listGrokModels()) {
    models.push({ provider: "grok", id });
  }
  return c.json(models);
});

runRoutes.post("/agent", async (c) => {
  const req = (await c.req.json()) as RunAgentRequest;
  if (!req.agent || !req.prompt?.trim()) {
    return c.json({ error: "agent and prompt are required" }, 400);
  }
  if (!KNOWN_PROVIDERS.has(req.provider)) {
    return c.json({ error: `unknown provider: ${String(req.provider)}` }, 400);
  }
  if (req.projectDir && !(await isKnownProjectDir(req.projectDir))) {
    return c.json({ error: `projectDir is not a known project directory: ${req.projectDir}` }, 403);
  }
  const projectDir = req.projectDir || process.cwd();

  const { jobId, signal } = jobs.create("run-agent", `${req.provider}:${req.agent}`, req.graphId);
  void (async () => {
    try {
      bus.publish({
        type: "job.progress",
        jobId,
        message: `running ${req.provider} agent "${req.agent}"${req.model ? ` (${req.model})` : ""}`,
      });

      const onLog = logSinkFor(jobId);
      if (req.provider === "claude-code") {
        try {
          const sub = await readSubscription();
          const blocked = claudeExhaustedForModel(req.model, sub.usage);
          if (blocked.length) {
            const labels = blocked.map((b) => `${b.label} ${b.utilization}%`).join(", ");
            const msg = formatUsageExhaustionMessage(
              blocked.some((b) => b.id === "sevenDayOpus")
                ? "claude-opus-7d"
                : blocked.some((b) => b.id === "sevenDay")
                  ? "claude-7d"
                  : "claude-5h",
              labels,
            );
            onLog("raw", `! ${msg}`);
            throw new Error(msg);
          }
        } catch (err) {
          if (err instanceof Error && /model usage exhausted/.test(err.message)) throw err;
        }
      }
      let result: InjectResult;
      if (req.provider === "opencode") {
        result = await runOpencodeAgent({
          agent: req.agent,
          model: req.model,
          prompt: req.prompt,
          projectDir,
          sessionId: req.sessionId,
          onLog,
          signal,
        });
      } else if (req.provider === "cursor") {
        result = await runCursorAgent({
          agent: req.agent,
          model: req.model,
          prompt: req.prompt,
          projectDir,
          sessionId: req.sessionId,
          onLog,
          signal,
        });
      } else if (req.provider === "antigravity") {
        result = await runAntigravityAgent({
          agent: req.agent,
          model: req.model,
          prompt: req.prompt,
          projectDir,
          sessionId: req.sessionId,
          onLog,
          signal,
        });
      } else if (req.provider === "codex") {
        result = await runCodexAgent({
          agent: req.agent,
          model: req.model,
          prompt: req.prompt,
          projectDir,
          sessionId: req.sessionId,
          sandbox: req.sandbox,
          askForApproval: req.askForApproval,
          onLog,
          signal,
        });
      } else if (req.provider === "copilot") {
        result = await runCopilotAgent({
          agent: req.agent,
          model: req.model,
          prompt: req.prompt,
          projectDir,
          sessionId: req.sessionId,
          onLog,
          signal,
        });
      } else if (req.provider === "grok") {
        result = await runGrokAgent({
          agent: req.agent,
          model: req.model,
          prompt: req.prompt,
          projectDir,
          sessionId: req.sessionId,
          onLog,
          signal,
        });
      } else {
        // .md-defined agents run with their body as appended system prompt
        const defs = await registry
          .get("claude-code")
          .listAgents({ projectDir });
        const def = defs.find((a) => a.name === req.agent);
        result = await runClaudeAgent({
          agent: req.agent,
          agentSystemPrompt: def?.raw ? matter(def.raw).content.trim() : undefined,
          model: req.model,
          prompt: req.prompt,
          projectDir,
          sessionId: req.sessionId,
          permissionMode: req.permissionMode,
          onLog,
          signal,
        });
      }
      const done = { type: "job.done", jobId, inject: result } as const;
      jobs.finish(jobId, { status: "done", result: done });
      bus.publish(done);
      bus.publish({ type: "sessions.changed", provider: req.provider });
    } catch (err) {
      const message = enrichUsageExhaustionError(err).message;
      jobs.finish(jobId, { status: "error", error: message });
      bus.publish({ type: "job.error", jobId, error: message });
    }
  })();

  return c.json({ jobId }, 202);
});

/** Continue an existing session with a plain message (prompt wired into a session node). */
runRoutes.post("/session", async (c) => {
  const req = (await c.req.json()) as RunSessionRequest;
  if (!req.sessionId || !req.prompt?.trim()) {
    return c.json({ error: "sessionId and prompt are required" }, 400);
  }
  if (!KNOWN_PROVIDERS.has(req.provider)) {
    return c.json({ error: `unknown provider: ${String(req.provider)}` }, 400);
  }
  if (req.projectDir && !(await isKnownProjectDir(req.projectDir))) {
    return c.json({ error: `projectDir is not a known project directory: ${req.projectDir}` }, 403);
  }
  const projectDir = req.projectDir || process.cwd();

  const { jobId, signal } = jobs.create("run-session", req.sessionId.slice(0, 16), req.graphId);
  void (async () => {
    try {
      bus.publish({
        type: "job.progress",
        jobId,
        message: `continuing ${req.provider} session ${req.sessionId.slice(0, 12)}…`,
      });
      const onLog = logSinkFor(jobId);
      const runArgs = {
        agent: req.agent,
        model: req.model,
        prompt: req.prompt,
        projectDir,
        sessionId: req.sessionId,
        onLog,
        signal,
      };
      const result: InjectResult =
        req.provider === "opencode"
          ? await runOpencodeAgent(runArgs)
          : req.provider === "cursor"
            ? await runCursorAgent(runArgs)
            : req.provider === "antigravity"
              ? await runAntigravityAgent(runArgs)
              : req.provider === "codex"
                ? await runCodexAgent(runArgs)
                : req.provider === "copilot"
                  ? await runCopilotAgent(runArgs)
                  : req.provider === "grok"
                    ? await runGrokAgent(runArgs)
                    : await runClaudeAgent(runArgs);
      const done = { type: "job.done", jobId, inject: result } as const;
      jobs.finish(jobId, { status: "done", result: done });
      bus.publish(done);
      bus.publish({ type: "sessions.changed", provider: req.provider });
    } catch (err) {
      const message = enrichUsageExhaustionError(err).message;
      jobs.finish(jobId, { status: "error", error: message });
      bus.publish({ type: "job.error", jobId, error: message });
    }
  })();

  return c.json({ jobId }, 202);
});
/**
 * Detached (server-side) workflow run: survives the browser tab. Strictly
 * validated — ids and param names are pattern-checked, values size-capped;
 * nothing here ever reaches a shell.
 */
runRoutes.post("/workflow", async (c) => {
  const body = (await c.req.json()) as {
    graphId?: string;
    params?: Record<string, unknown>;
    approveAll?: boolean;
    projectDir?: string;
    scope?: unknown;
    replayFromJobId?: string;
  };
  if (typeof body.graphId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(body.graphId)) {
    return c.json({ error: "invalid graphId" }, 400);
  }
  const params: Record<string, string> = {};
  if (body.params !== undefined) {
    if (typeof body.params !== "object" || body.params === null || Array.isArray(body.params)) {
      return c.json({ error: "params must be an object" }, 400);
    }
    const entries = Object.entries(body.params);
    if (entries.length > 50) return c.json({ error: "too many params (max 50)" }, 400);
    for (const [k, v] of entries) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(k)) return c.json({ error: `invalid param name "${k}"` }, 400);
      if (typeof v !== "string" || v.length > 100_000) {
        return c.json({ error: `param "${k}" must be a string under 100k chars` }, 400);
      }
      params[k] = v;
    }
  }
  let scope: string[] | undefined;
  if (body.scope !== undefined) {
    if (!Array.isArray(body.scope) || body.scope.length > 500) {
      return c.json({ error: "scope must be an array of node ids (max 500)" }, 400);
    }
    scope = [];
    for (const id of body.scope) {
      if (typeof id !== "string" || id.length > 128 || !/^[A-Za-z0-9_.-]+$/.test(id)) {
        return c.json({ error: "invalid scope node id" }, 400);
      }
      scope.push(id);
    }
  }
  const replayFromJobId =
    typeof body.replayFromJobId === "string" && /^job_[a-z0-9]+_\d+$/.test(body.replayFromJobId)
      ? body.replayFromJobId
      : undefined;
  const g = await readGraph(body.graphId);
  if (!g) return c.json({ error: "workflow not found" }, 404);

  // Imported JSON: no execution before the user confirms the manifest.
  // 428 carries the manifest so the UI can render the confirmation dialog.
  if (g.origin === "imported" && !g.confirmedAt) {
    return c.json(
      {
        error: "imported workflow not yet confirmed — review what it executes first",
        code: "confirmation-required",
        manifest: summarizeGraphExecution(g),
      },
      428,
    );
  }

  // Caller-chosen cwd controls which .claude/settings.json / .mcp.json the
  // agent CLIs pick up — only accept directories the user works in.
  if (typeof body.projectDir === "string" && !(await isKnownProjectDir(body.projectDir))) {
    return c.json({ error: `projectDir is not a known project directory: ${body.projectDir}` }, 403);
  }

  const { jobId, signal } = jobs.create(
    "workflow",
    `${g.name}${scope ? " (partial)" : ""} (detached)`,
    g.id,
  );
  const onLog = (lane: string, line: string): void => {
    const capped = line.length > LOG_LINE_MAX ? `${line.slice(0, LOG_LINE_MAX)}…` : line;
    bus.publish({ type: "job.log", jobId, lane: lane as "raw", line: capped });
    appendJobLog(jobId, lane, capped);
  };
  onLog("meta", `detached run started: ${g.name}${scope ? ` (scope ${scope.length})` : ""}`);
  void (async () => {
    try {
      const res = await executeWorkflow({
        graphId: g.id,
        params,
        approveAll: body.approveAll === true,
        projectDir: typeof body.projectDir === "string" && isAbsolutePath(body.projectDir)
          ? body.projectDir
          : process.cwd(),
        log: onLog,
        signal,
        scope,
        jobId,
        replayFromJobId,
        onNodeStatus: (nodeId, status) => {
          bus.publish({ type: "job.node", jobId, graphId: g.id, nodeId, status });
        },
      });
      onLog("meta", `detached run finished (${res.outputs} output node(s) updated)`);
      const done = { type: "job.done", jobId } as const;
      jobs.finish(jobId, { status: "done", result: done });
      bus.publish(done);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onLog("stderr", `detached run failed: ${message}`);
      jobs.finish(jobId, { status: "error", error: message });
      bus.publish({ type: "job.error", jobId, error: message });
    }
  })();
  return c.json({ jobId }, 202);
});

export const jobRoutes = new Hono();

jobRoutes.get("/", async (c) => c.json(await jobs.listWithHistory()));

/**
 * Client-driven job lifecycle: the editor's runner registers each workflow
 * run as a job, mirrors its narration here, and closes it — so workflow
 * runs appear in Runs and the combined Logs view like everything else.
 */
jobRoutes.post("/start", async (c) => {
  const { kind, label, graphId } = (await c.req.json()) as {
    kind?: string;
    label?: string;
    graphId?: string;
  };
  if (kind !== "workflow") return c.json({ error: "only workflow jobs can be client-started" }, 400);
  const { jobId } = jobs.create("workflow", label?.slice(0, 120), graphId, {
    clientDriven: true,
  });
  appendJobLog(jobId, "meta", `workflow run started${label ? `: ${label}` : ""}`);
  return c.json({ jobId }, 202);
});

jobRoutes.post("/app-log", async (c) => {
  const { line } = (await c.req.json()) as { line?: string };
  if (typeof line !== "string" || !line.trim()) return c.json({ error: "line required" }, 400);
  appLog("frontend", line);
  return c.json({ ok: true });
});

/** Latest successful workflow outputs for a graph (replay seed). Before /:id routes. */
jobRoutes.get("/outputs/latest", async (c) => {
  const graphId = c.req.query("graphId");
  if (!graphId || !/^[A-Za-z0-9_-]{1,64}$/.test(graphId)) {
    return c.json({ error: "graphId required" }, 400);
  }
  const found = await findLatestGraphOutputs(graphId);
  if (!found) return c.json({ jobId: null, outputs: {} });
  return c.json(found);
});

/**
 * Heartbeat for client-driven runs. A quiet agent node can run >10 min with
 * zero log lines or output merges — without this, the abandoned-job reaper
 * would kill a perfectly healthy run whose tab is still open.
 */
jobRoutes.post("/:id/touch", async (c) => {
  const id = c.req.param("id");
  if (!jobs.get(id)) return c.json({ error: "job not found" }, 404);
  jobs.touch(id);
  return c.json({ ok: true });
});

jobRoutes.post("/:id/log", async (c) => {
  const id = c.req.param("id");
  if (!jobs.get(id)) return c.json({ error: "job not found" }, 404);
  const { lane, line } = (await c.req.json()) as { lane?: string; line?: string };
  if (typeof line !== "string") return c.json({ error: "line required" }, 400);
  appendJobLog(id, (lane ?? "raw").slice(0, 20), line.slice(0, 8000));
  return c.json({ ok: true });
});

jobRoutes.post("/:id/finish", async (c) => {
  const id = c.req.param("id");
  const job = jobs.get(id);
  if (!job) return c.json({ error: "job not found" }, 404);
  if (job.kind !== "workflow") return c.json({ error: "only workflow jobs can be client-finished" }, 400);
  const { ok, error } = (await c.req.json()) as { ok?: boolean; error?: string };
  appendJobLog(id, "meta", ok ? "workflow run finished" : `workflow run failed: ${error ?? "unknown"}`);
  jobs.finish(
    id,
    ok
      ? { status: "done", result: { type: "job.done", jobId: id } }
      : { status: "error", error: (error ?? "failed").slice(0, 500) },
  );
  return c.json({ ok: true });
});

/** Snapshot or merge cached node outputs for a client-driven (canvas) run. */
jobRoutes.get("/:id/outputs", async (c) => {
  const id = c.req.param("id");
  return c.json(await readJobOutputs(id));
});

jobRoutes.post("/:id/outputs", async (c) => {
  const id = c.req.param("id");
  const job = jobs.get(id);
  if (!job) return c.json({ error: "job not found" }, 404);
  const body = (await c.req.json()) as {
    nodeId?: string;
    output?: CachedNodeOutput;
    outputs?: Record<string, CachedNodeOutput>;
  };
  if (body.outputs && typeof body.outputs === "object" && !Array.isArray(body.outputs)) {
    const { writeJobOutputs } = await import("../jobs.js");
    jobs.touch(id);
    const cur = await readJobOutputs(id);
    await writeJobOutputs(id, { ...cur, ...body.outputs });
    return c.json({ ok: true });
  }
  if (typeof body.nodeId === "string" && body.output && typeof body.output === "object") {
    await mergeJobNodeOutput(id, body.nodeId, body.output);
    return c.json({ ok: true });
  }
  return c.json({ error: "nodeId+output or outputs required" }, 400);
});

/** every job's log lines, merged and time-sorted — feeds the Logs view */
jobRoutes.get("/logs/all", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 8000), 20000);
  const recent = (await jobs.listWithHistory(400)).slice(0, 300);
  const merged: Array<{
    ts: number;
    lane: string;
    line: string;
    jobId: string;
    kind: string;
    label?: string;
    graphId?: string;
    status: string;
  }> = [];
  await Promise.all(
    recent.map(async (j) => {
      for (const l of await readJobLogs(j.id, 2000)) {
        merged.push({
          ...l,
          jobId: j.id,
          kind: j.kind,
          label: j.label,
          graphId: j.graphId,
          status: j.status,
        });
      }
    }),
  );
  for (const l of await readAppLogs(2000)) {
    merged.push({
      ...l,
      jobId: "app",
      kind: "app",
      label: l.lane === "server" ? "threadle server" : "frontend",
      status: "—",
    });
  }
  merged.sort((a, b) => a.ts - b.ts);
  return c.json(merged.slice(-limit));
});
jobRoutes.get("/:id/logs", async (c) =>
  c.json({ lines: await readJobLogs(c.req.param("id")) }),
);
jobRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const live = jobs.get(id);
  if (live) return c.json(live);
  const hist = (await jobs.listWithHistory(1000)).find((j) => j.id === id);
  if (!hist) return c.json({ error: "job not found" }, 404);
  return c.json(hist);
});
jobRoutes.delete("/:id", (c) => {
  const ok = jobs.cancel(c.req.param("id"));
  if (!ok) return c.json({ error: "job not found or not running" }, 404);
  bus.publish({
    type: "job.error",
    jobId: c.req.param("id"),
    error: "cancelled by user",
  });
  return c.json({ ok: true });
});
