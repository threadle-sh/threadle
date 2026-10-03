import { Hono } from "hono";
import type { InjectRequest } from "@threadle/shared";
import { registry } from "../providers/registry.js";
import { readPayload } from "../context/store.js";
import { bus } from "../events.js";
import { jobs } from "../jobs.js";
import { recordInject } from "./lineage.js";

export const injectRoutes = new Hono();

injectRoutes.post("/", async (c) => {
  const req = (await c.req.json()) as InjectRequest;
  const payload = await readPayload(req.payloadHash);
  if (!payload) return c.json({ error: "payload not found — materialize first" }, 404);

  const { jobId } = jobs.create("inject", req.target.provider, undefined, {
    sessionRef: req.target.sessionId
      ? { provider: req.target.provider, sessionId: req.target.sessionId }
      : undefined,
  });

  void (async () => {
    try {
      bus.publish({
        type: "job.progress",
        jobId,
        message: `injecting into ${req.target.provider} (${req.target.mode})`,
      });
      const provider = registry.get(req.target.provider);
      const result = await provider.inject(req.target, payload, {
        kickoffPrompt: req.kickoffPrompt,
      });
      const done = { type: "job.done", jobId, inject: result } as const;
      jobs.finish(jobId, { status: "done", result: done });
      recordInject({
        ts: Date.now(),
        payloadHash: req.payloadHash,
        mode: req.target.mode,
        target: { provider: req.target.provider, sessionId: req.target.sessionId },
        result: { provider: result.provider, sessionId: result.newSessionId },
      });
      bus.publish(done);
      bus.publish({ type: "sessions.changed", provider: req.target.provider });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jobs.finish(jobId, { status: "error", error: message });
      bus.publish({ type: "job.error", jobId, error: message });
    }
  })();

  return c.json({ jobId }, 202);
});
