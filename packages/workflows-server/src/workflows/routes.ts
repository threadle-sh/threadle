import { Hono } from "hono";
import { isAbsolutePath } from "@threadle/shared";
import { summarizeGraphExecution } from "@threadle/workflows-shared";
import { bus } from "@threadle/core/events.js";
import { appendJobLog, jobs } from "@threadle/core/jobs.js";
import { isKnownProjectDir } from "@threadle/core/readable-paths.js";
import { readGraph } from "../graphs/store.js";
import { executeWorkflow } from "./executor.js";
import {
  findLatestGraphOutputs,
  mergeJobNodeOutput,
  readJobOutputs,
  writeJobOutputs,
  type CachedNodeOutput,
} from "./outputs.js";

const LOG_LINE_MAX = 2000;

/** Mounted at /api/run (before core run routes). */
export const workflowRunRoutes = new Hono();

/** Mounted at /api/jobs (before core job routes): per-job node output cache. */
export const workflowJobRoutes = new Hono();

/**
 * Detached (server-side) workflow run: survives the browser tab. Strictly
 * validated — ids and param names are pattern-checked, values size-capped;
 * nothing here ever reaches a shell.
 */
workflowRunRoutes.post("/workflow", async (c) => {
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
  // other threadle processes (viewer ↔ editor app) see it in Runs while live
  jobs.checkpoint(jobId);
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

/** Latest successful workflow outputs for a graph (replay seed). Mounted before core /api/jobs/:id routes. */
workflowJobRoutes.get("/outputs/latest", async (c) => {
  const graphId = c.req.query("graphId");
  if (!graphId || !/^[A-Za-z0-9_-]{1,64}$/.test(graphId)) {
    return c.json({ error: "graphId required" }, 400);
  }
  const found = await findLatestGraphOutputs(graphId);
  if (!found) return c.json({ jobId: null, outputs: {} });
  return c.json(found);
});

/** Snapshot or merge cached node outputs for a client-driven (canvas) run. */
workflowJobRoutes.get("/:id/outputs", async (c) => {
  const id = c.req.param("id");
  return c.json(await readJobOutputs(id));
});

workflowJobRoutes.post("/:id/outputs", async (c) => {
  const id = c.req.param("id");
  const job = jobs.get(id);
  if (!job) return c.json({ error: "job not found" }, 404);
  const body = (await c.req.json()) as {
    nodeId?: string;
    output?: CachedNodeOutput;
    outputs?: Record<string, CachedNodeOutput>;
  };
  if (body.outputs && typeof body.outputs === "object" && !Array.isArray(body.outputs)) {
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
