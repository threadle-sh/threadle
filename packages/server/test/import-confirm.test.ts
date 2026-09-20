/**
 * First-run confirmation gate for imported workflow JSON:
 * import → run is refused (428 + manifest) until POST /:id/confirm-import;
 * trusted built-ins (templates/recipes) never need confirmation; tampered
 * confirmation fields in portable JSON are stripped on import.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { summarizeGraphExecution, type Graph, type PortableGraph } from "@threadle/shared";
import { createApp } from "../src/server.js";

let dir: string;
let app: ReturnType<typeof createApp>;

const HOST = { Host: "127.0.0.1:4570" };

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

/** prompt → output; no agents, runs instantly. */
const PORTABLE: PortableGraph = {
  $schema: "threadle/graph@1",
  name: "imported-fixture",
  schemaVersion: 1,
  kind: "workflow",
  nodes: [
    {
      id: "p1",
      type: "prompt",
      position: { x: 0, y: 0 },
      data: { type: "prompt", text: "hello" },
    },
    {
      id: "o1",
      type: "output",
      position: { x: 200, y: 0 },
      data: { type: "output" },
    },
  ],
  edges: [{ id: "e1", source: "p1", target: "o1" }],
} as unknown as PortableGraph;

async function waitJobDone(jobId: string, timeoutMs = 8000): Promise<{ status: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { status, json } = await api("GET", `/api/jobs/${jobId}`);
    if (status === 200) {
      const job = json as { status: string };
      if (job.status !== "running") return job;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("job still running");
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-import-confirm-"));
  process.env.THREADLE_CONFIG_DIR = dir;
  app = createApp({ projectDir: dir });
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.THREADLE_CONFIG_DIR;
});

describe("imported workflow first-run gate", () => {
  it("refuses to run an unconfirmed import (428 + manifest), runs after confirm", async () => {
    const imp = await api("POST", "/api/graphs/import", PORTABLE);
    expect(imp.status).toBe(201);
    const g = imp.json as Graph;
    expect(g.origin).toBe("imported");
    expect(g.confirmedAt).toBeUndefined();

    const refused = await api("POST", "/api/run/workflow", { graphId: g.id });
    expect(refused.status).toBe(428);
    const body = refused.json as { code?: string; manifest?: unknown[] };
    expect(body.code).toBe("confirmation-required");
    expect(Array.isArray(body.manifest)).toBe(true);

    const confirmed = await api("POST", `/api/graphs/${g.id}/confirm-import`);
    expect(confirmed.status).toBe(200);
    expect((confirmed.json as Graph).confirmedAt).toBeTypeOf("number");

    const run = await api("POST", "/api/run/workflow", { graphId: g.id });
    expect(run.status).toBe(202);
    const { jobId } = run.json as { jobId: string };
    const job = await waitJobDone(jobId);
    expect(job.status).toBe("done");
  });

  it("confirm-import is idempotent and a no-op on non-imported graphs", async () => {
    const tpl = await api("POST", "/api/graphs/templates/hello-wire");
    expect(tpl.status).toBe(201);
    const g = tpl.json as Graph;
    expect(g.origin).toBeUndefined();
    const res = await api("POST", `/api/graphs/${g.id}/confirm-import`);
    expect(res.status).toBe(200);
    expect((res.json as Graph).confirmedAt).toBeUndefined();
  });

  it("template imports are trusted — no confirmation needed to run", async () => {
    const tpl = await api("POST", "/api/graphs/templates/hello-wire");
    expect(tpl.status).toBe(201);
    const g = tpl.json as Graph;
    const run = await api("POST", "/api/run/workflow", { graphId: g.id });
    expect(run.status).toBe(202);
    await waitJobDone((run.json as { jobId: string }).jobId);
  });

  it("strips smuggled origin/confirmedAt from portable JSON", async () => {
    const tampered = {
      ...PORTABLE,
      name: "tampered",
      origin: "builtin",
      confirmedAt: 1,
    };
    const imp = await api("POST", "/api/graphs/import", tampered);
    expect(imp.status).toBe(201);
    const g = imp.json as Graph;
    expect(g.origin).toBe("imported"); // stamped by importGraph, not the JSON
    expect(g.confirmedAt).toBeUndefined();
  });
});

describe("summarizeGraphExecution", () => {
  it("inventories executing node kinds with privilege flags", () => {
    const g = {
      nodes: [
        {
          id: "a",
          muted: false,
          data: {
            type: "agent-def",
            ref: { provider: "codex", name: "codex", source: "builtin" },
            sandbox: "danger-full-access",
            model: "gpt-x",
          },
        },
        {
          id: "c",
          muted: true,
          data: { type: "custom", ref: { name: "test-run" }, params: { argv: "rm -rf /" } },
        },
        {
          id: "m",
          data: { type: "mcp-tool", ref: { server: "fs" }, tool: "read_file" },
        },
        { id: "p", data: { type: "prompt", text: "hi" } },
      ],
    } as never;
    const items = summarizeGraphExecution(g);
    expect(items.map((i) => i.kind)).toEqual(["agent", "custom-node", "mcp-tool"]);
    expect(items[0]!.flags).toContain("sandbox: danger-full-access");
    expect(items[1]!.muted).toBe(true);
    expect(items[1]!.flags?.[0]).toContain("argv=rm -rf /");
    expect(items[2]!.detail).toContain("read_file");
  });
});
