import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import type { ContextPayload } from "@threadle/shared";
import { threadleConfigDir } from "../graphs/store.js";
import { jobs } from "../jobs.js";

/**
 * Context lineage: which session a payload was extracted FROM (payload meta,
 * always known) and which session it was injected INTO (recorded from now on
 * in runs/injects.jsonl by the inject route).
 */

export interface LineagePayload {
  hash: string;
  kind: string;
  createdAt: number;
  chars: number;
  /** first meaningful line of the content — what this context is about */
  preview: string;
  source: { provider: string; sessionId: string };
}

/**
 * First line that carries meaning: skip blanks, code fences, transcript role
 * headers ("user — <ts>"), tool-call lines and markdown decoration.
 */
function previewOf(content: string): string {
  for (const raw of content.split("\n").slice(0, 60)) {
    if (/^\s*```/.test(raw)) continue;
    const line = raw
      .replace(/^#+\s*/, "")
      .replace(/^[>*\-–—=\s]+/, "")
      .trim();
    if (line.length < 4) continue;
    if (/^(user|assistant|system|human)\b\s*[—–-]/i.test(line)) continue;
    if (/^tool:/i.test(line) || /^\w+\(\{/.test(line)) continue;
    return line.length > 160 ? `${line.slice(0, 160)}…` : line;
  }
  return "";
}

export interface LineageInject {
  ts: number;
  payloadHash: string;
  mode: string;
  target: { provider: string; sessionId?: string };
  result?: { provider: string; sessionId: string };
}

function injectsFile(): string {
  return path.join(threadleConfigDir(), "runs", "injects.jsonl");
}

export function recordInject(entry: LineageInject): void {
  void fs.promises
    .mkdir(path.dirname(injectsFile()), { recursive: true })
    .then(() =>
      fs.promises.appendFile(injectsFile(), `${JSON.stringify(entry)}\n`, "utf8"),
    )
    .catch(() => undefined); // lineage is best-effort
}

export async function readInjects(): Promise<LineageInject[]> {
  try {
    const raw = await fs.promises.readFile(injectsFile(), "utf8");
    const out: LineageInject[] = [];
    for (const line of raw.split("\n").filter(Boolean)) {
      try {
        out.push(JSON.parse(line) as LineageInject);
      } catch {
        // skip corrupt line
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function readPayloadMetas(): Promise<LineagePayload[]> {
  const base = path.join(threadleConfigDir(), "payloads");
  const out: LineagePayload[] = [];
  let shards: string[] = [];
  try {
    shards = await fs.promises.readdir(base);
  } catch {
    return out;
  }
  for (const shard of shards) {
    if (shard === "blobs") continue;
    let files: string[] = [];
    try {
      files = await fs.promises.readdir(path.join(base, shard));
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const p = JSON.parse(
          await fs.promises.readFile(path.join(base, shard, f), "utf8"),
        ) as ContextPayload;
        out.push({
          hash: f.slice(0, -5),
          kind: p.kind,
          createdAt: p.createdAt,
          chars: p.content?.length ?? 0,
          preview: previewOf(p.content ?? ""),
          source: { provider: p.source.provider, sessionId: p.source.sessionId },
        });
      } catch {
        // skip unreadable payload
      }
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export const lineageRoutes = new Hono();

lineageRoutes.get("/", async (c) => {
  const [payloads, injects, jobList] = await Promise.all([
    readPayloadMetas(),
    readInjects(),
    jobs.listWithHistory(500),
  ]);
  // sessions a threadle run produced or continued — lets the UI badge them
  const runSessions = jobList
    .filter((j) => j.result?.inject?.newSessionId)
    .map((j) => ({
      provider: j.result!.inject!.provider,
      sessionId: j.result!.inject!.newSessionId,
      kind: j.kind,
      label: j.label,
      graphId: j.graphId,
      ts: j.createdAt,
    }));
  return c.json({ payloads, injects, runSessions });
});

/**
 * Record a context handoff that bypasses /api/inject — the workflow runner
 * feeds payload text into agent runs as a prompt, which is still lineage.
 */
lineageRoutes.post("/record", async (c) => {
  const body = (await c.req.json()) as Partial<LineageInject>;
  if (
    typeof body.payloadHash !== "string" ||
    !/^[a-f0-9]{16,64}$/.test(body.payloadHash) ||
    !body.result?.provider ||
    !body.result.sessionId
  ) {
    return c.json({ error: "payloadHash and result{provider,sessionId} required" }, 400);
  }
  recordInject({
    ts: Date.now(),
    payloadHash: body.payloadHash,
    mode: typeof body.mode === "string" ? body.mode.slice(0, 32) : "workflow",
    target: {
      provider: String(body.result.provider),
      sessionId: body.result.sessionId,
    },
    result: {
      provider: String(body.result.provider),
      sessionId: String(body.result.sessionId),
    },
  });
  return c.json({ ok: true }, 201);
});
