import path from "node:path";
import fs from "node:fs";
import { Hono } from "hono";
import { z } from "zod";
import type { ContextRequest } from "@threadle/shared";
import { registry } from "../providers/registry.js";
import { estimateTokens, renderTranscript } from "../context/extract.js";
import { materializeContextPayload } from "../context/materialize.js";
import { readPayload, storePayload } from "../context/store.js";
import { bus } from "../events.js";
import { jobs } from "../jobs.js";
import { threadleConfigDir } from "../graphs/store.js";
import { readPayloadMetas } from "./lineage.js";
import {
  REFERENCE_TAG,
  SESSION_CONTEXT_CONFIG,
} from "../context/session-context.js";

export const contextRoutes = new Hono();
export const payloadRoutes = new Hono();

/**
 * Runtime shape check for `ContextRequest` bodies — these routes previously
 * cast `c.req.json()` blind, so a malformed body 500'd deep in provider code.
 */
const contextRequestSchema = z.object({
  source: z.object({
    provider: z.string().min(1).max(64),
    sessionId: z.string().min(1).max(512),
  }),
  config: z.record(z.string(), z.unknown()).default({}),
});

async function parseContextRequest(
  c: { req: { json: () => Promise<unknown> } },
): Promise<ContextRequest | undefined> {
  const raw = await c.req.json().catch(() => undefined);
  const parsed = contextRequestSchema.safeParse(raw);
  return parsed.success ? (parsed.data as unknown as ContextRequest) : undefined;
}

function previewOf(content: string): string {
  const line = content
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  const t = (line ?? content).replace(/\s+/g, " ").trim();
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
}

async function sourceTitle(provider: string, sessionId: string): Promise<string | undefined> {
  try {
    const ref = await registry.get(provider).getSession(sessionId);
    return ref?.title;
  } catch {
    return undefined;
  }
}

function tagsFile(): string {
  return path.join(threadleConfigDir(), "payloads", "tags.json");
}

async function readTags(): Promise<Record<string, string[]>> {
  try {
    return JSON.parse(await fs.promises.readFile(tagsFile(), "utf8")) as Record<
      string,
      string[]
    >;
  } catch {
    return {};
  }
}

async function writeTags(all: Record<string, string[]>): Promise<void> {
  await fs.promises.mkdir(path.dirname(tagsFile()), { recursive: true });
  await fs.promises.writeFile(tagsFile(), JSON.stringify(all, null, 2), "utf8");
}

/** Merge tags onto a payload hash (content-addressed payloads may already exist). */
async function mergeTags(hash: string, add: string[]): Promise<string[]> {
  const all = await readTags();
  const cur = all[hash] ?? [];
  const clean = [
    ...new Set(
      [...cur, ...add.map((t) => t.trim()).filter(Boolean)].filter((t) => t.length <= 40),
    ),
  ].slice(0, 20);
  if (clean.length) all[hash] = clean;
  else delete all[hash];
  await writeTags(all);
  return clean;
}

contextRoutes.post("/extract", async (c) => {
  const req = await parseContextRequest(c);
  if (!req) return c.json({ error: "invalid context request" }, 400);
  const payload = await materializeContextPayload({
    kind: "transcript-excerpt",
    config: req.config,
    source: req.source,
    projectDir: process.cwd(),
  });
  return c.json(payload);
});

contextRoutes.post("/files", async (c) => {
  const req = await parseContextRequest(c);
  if (!req) return c.json({ error: "invalid context request" }, 400);
  const payload = await materializeContextPayload({
    kind: "files",
    config: req.config,
    source: req.source,
    projectDir: process.cwd(),
  });
  return c.json(payload);
});

contextRoutes.post("/distill", async (c) => {
  const req = await parseContextRequest(c);
  if (!req) return c.json({ error: "invalid context request" }, 400);
  const { jobId, signal } = jobs.create("distill", req.source.sessionId.slice(0, 16));

  void (async () => {
    try {
      bus.publish({ type: "job.progress", jobId, message: "reading transcript" });
      bus.publish({
        type: "job.progress",
        jobId,
        message: `distilling via ${(req.config as { provider?: string }).provider ?? "claude-code"}`,
      });
      const payload = await materializeContextPayload({
        kind: "distilled-summary",
        config: req.config,
        source: req.source,
        projectDir: process.cwd(),
        onLog: (lane, line) =>
          bus.publish({
            type: "job.log",
            jobId,
            lane,
            line: line.length > 2000 ? `${line.slice(0, 2000)}…` : line,
          }),
        signal,
      });
      const done = { type: "job.done", jobId, payload } as const;
      jobs.finish(jobId, { status: "done", result: done });
      bus.publish(done);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jobs.finish(jobId, { status: "error", error: message });
      bus.publish({ type: "job.error", jobId, error: message });
    }
  })();

  return c.json({ jobId }, 202);
});

/**
 * Snapshot a session's reconstructed context into the payload library,
 * tagged `reference`, so it can seed or be dragged into workflows.
 */
contextRoutes.post("/reference", async (c) => {
  const body = (await c.req.json()) as {
    source?: { provider?: string; sessionId?: string };
  };
  const providerId = body.source?.provider;
  const sessionId = body.source?.sessionId;
  if (!providerId || !sessionId) {
    return c.json({ error: "source.provider and source.sessionId required" }, 400);
  }
  const provider = registry.get(providerId);
  const messages = await provider.getTranscript(sessionId);
  const content = renderTranscript(messages, SESSION_CONTEXT_CONFIG);
  const title = await sourceTitle(providerId, sessionId);
  const payload = await storePayload({
    kind: "transcript-excerpt",
    createdAt: Date.now(),
    source: { provider: providerId as never, sessionId },
    content,
    meta: {
      tokenEstimate: estimateTokens(content),
      sourceTitle: title,
    },
  });
  const tags = await mergeTags(payload.hash, [REFERENCE_TAG]);
  return c.json({
    hash: payload.hash,
    kind: payload.kind,
    preview: previewOf(content) || title || "session context",
    source: payload.source,
    tags,
    chars: content.length,
  });
});

// ---- payload library: list + tags (sidecar file, store objects stay immutable) ----

payloadRoutes.get("/", async (c) => {
  const [metas, tags] = await Promise.all([readPayloadMetas(), readTags()]);
  return c.json(
    metas.map((m) => ({ ...m, tags: tags[m.hash] ?? [] })).reverse(), // newest first
  );
});

payloadRoutes.post("/:hash/tags", async (c) => {
  const hash = c.req.param("hash");
  if (!/^[a-f0-9]{16,64}$/.test(hash)) return c.json({ error: "bad hash" }, 400);
  const body = (await c.req.json()) as { tags?: unknown };
  if (
    !Array.isArray(body.tags) ||
    body.tags.some((t) => typeof t !== "string" || t.length > 40) ||
    body.tags.length > 20
  ) {
    return c.json({ error: "tags must be up to 20 strings of ≤40 chars" }, 400);
  }
  const all = await readTags();
  const clean = [...new Set((body.tags as string[]).map((t) => t.trim()).filter(Boolean))];
  if (clean.length) all[hash] = clean;
  else delete all[hash];
  await writeTags(all);
  return c.json({ ok: true, tags: clean });
});

payloadRoutes.get("/:hash", async (c) => {
  const payload = await readPayload(c.req.param("hash"));
  if (!payload) return c.json({ error: "payload not found" }, 404);
  return c.json(payload);
});
