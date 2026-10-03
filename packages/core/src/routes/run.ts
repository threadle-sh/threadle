import { Hono } from "hono";
import matter from "gray-matter";
import type {
  InjectResult,
  ModelInfo,
  RunAgentRequest,
  RunSessionRequest,
} from "@threadle/shared";
import {
  claudeExhaustedForModel,
  enrichUsageExhaustionError,
  estimateTokenBaseline,
  formatUsageExhaustionMessage,
} from "@threadle/shared";
import { isKnownProjectDir } from "../readable-paths.js";
import { ensureBareWorkspace } from "../providers/bare-workspace.js";
import { markPilotSession } from "../pilot-sessions/store.js";
import { bus } from "../events.js";
import { appendJobLog, appLog, jobs, readAppLogs, readJobLogs } from "../jobs.js";
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
import { listMuseModels, runMuseAgent } from "../providers/muse/inject.js";
import { registry } from "../providers/registry.js";
import { readSubscription } from "./subscription.js";
import type { LogSink } from "../providers/stream.js";
import {
  allPilotCases,
  PILOT_PROMPT,
  pilotCasesFor,
} from "../providers/pilot-defaults.js";

const LOG_LINE_MAX = 2000;
const KNOWN_PROVIDERS = new Set([
  "claude-code",
  "opencode",
  "cursor",
  "antigravity",
  "codex",
  "copilot",
  "grok",
  "muse",
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

/** Cheap one-shot smoke plan for Settings → test pilot. */
runRoutes.get("/pilot", async (c) => {
  const extraTests = c.req.query("extra") === "1" || c.req.query("extra") === "true";
  const info = await registry.info();
  const byId = new Map(info.map((p) => [p.id, p]));
  const cases = pilotCasesFor(extraTests).map((def) => {
    const available = byId.get(def.provider)?.available === true;
    return {
      ...def,
      available,
      skipReason: available ? undefined : "CLI not available",
    };
  });
  const extras = allPilotCases().filter((c) => c.extra);
  return c.json({
    prompt: PILOT_PROMPT,
    extraTests,
    harnessExtras: false as const,
    cases,
    /** Catalog of optional cases (for UI copy) even when extraTests is off. */
    extraCaseCount: extras.length,
  });
});

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
  for (const id of await listMuseModels()) {
    models.push({ provider: "muse", id });
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
  if (
    !req.ignoreLocalMarkdown &&
    req.projectDir &&
    !(await isKnownProjectDir(req.projectDir))
  ) {
    return c.json({ error: `projectDir is not a known project directory: ${req.projectDir}` }, 403);
  }
  const projectDir = req.ignoreLocalMarkdown
    ? await ensureBareWorkspace()
    : req.projectDir || process.cwd();

  const { jobId, signal } = jobs.create(
    "run-agent",
    `${req.provider}:${req.agent}`,
    req.graphId,
    req.sessionId
      ? { sessionRef: { provider: req.provider, sessionId: req.sessionId } }
      : undefined,
  );
  void (async () => {
    try {
      bus.publish({
        type: "job.progress",
        jobId,
        message: `running ${req.provider} agent "${req.agent}"${req.model ? ` (${req.model})` : ""}`,
      });

      const onLog = logSinkFor(jobId);
      if (req.ignoreLocalMarkdown) {
        onLog("meta", `bare workspace · ignore local md (${projectDir})`);
      }
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
          ignoreLocalMarkdown: req.ignoreLocalMarkdown,
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
          ignoreLocalMarkdown: req.ignoreLocalMarkdown,
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
          harnessExtras: req.harnessExtras ?? req.museReminders,
          ignoreLocalMarkdown: req.ignoreLocalMarkdown,
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
          ignoreLocalMarkdown: req.ignoreLocalMarkdown,
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
          ignoreLocalMarkdown: req.ignoreLocalMarkdown,
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
          harnessExtras: req.harnessExtras ?? req.museReminders,
          ignoreLocalMarkdown: req.ignoreLocalMarkdown,
        });
      } else if (req.provider === "muse") {
        result = await runMuseAgent({
          agent: req.agent,
          model: req.model,
          prompt: req.prompt,
          projectDir,
          sessionId: req.sessionId,
          onLog,
          signal,
          harnessExtras: req.harnessExtras ?? req.museReminders,
          ignoreLocalMarkdown: req.ignoreLocalMarkdown,
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
          harnessExtras: req.harnessExtras ?? req.museReminders,
          ignoreLocalMarkdown: req.ignoreLocalMarkdown,
        });
      }
      if (req.pilot && result.newSessionId) {
        const inTok = result.usage?.inputTokens;
        const outTok = result.usage?.outputTokens;
        const baseline =
          inTok != null
            ? estimateTokenBaseline(inTok, req.prompt, {
                ignoreLocalMarkdown: req.ignoreLocalMarkdown,
              })
            : undefined;
        await markPilotSession({
          provider: result.provider,
          sessionId: result.newSessionId,
          caseId: req.pilotCaseId,
          tokensIn: inTok,
          tokensOut: outTok,
          promptEst: baseline?.promptEst,
          baselineEst: baseline?.baselineEst,
          baselineNote: baseline?.baselineNote,
          ignoreLocalMarkdown: req.ignoreLocalMarkdown,
        }).catch(() => undefined);
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

  const { jobId, signal } = jobs.create(
    "run-session",
    req.sessionId.slice(0, 16),
    req.graphId,
    { sessionRef: { provider: req.provider, sessionId: req.sessionId } },
  );
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
                    : req.provider === "muse"
                      ? await runMuseAgent(runArgs)
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
  jobs.checkpoint(jobId);
  appendJobLog(jobId, "meta", `workflow run started${label ? `: ${label}` : ""}`);
  return c.json({ jobId }, 202);
});

jobRoutes.post("/app-log", async (c) => {
  const { line } = (await c.req.json()) as { line?: string };
  if (typeof line !== "string" || !line.trim()) return c.json({ error: "line required" }, 400);
  appLog("frontend", line);
  return c.json({ ok: true });
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
