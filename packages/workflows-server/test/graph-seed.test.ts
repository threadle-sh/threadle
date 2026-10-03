import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@threadle/core/providers/registry.js", () => {
  const provider = {
    listChildren: async (id: string) =>
      id === "s1"
        ? [{ provider: "claude-code", id: "s1/agent-a", kind: "subagent-run", projectDir: "/p", updatedAt: 0, status: "idle" }]
        : [],
  };
  return { registry: { providers: new Map([["claude-code", provider]]), get: () => provider } };
});

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-seed-"));
  process.env.THREADLE_CONFIG_DIR = dir;
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.THREADLE_CONFIG_DIR;
});

describe("POST /api/graphs/seed", () => {
  it("builds a sessions workflow with subagent child wires", async () => {
    const { graphRoutes } = await import("../src/routes/graphs.js");
    const { readGraph } = await import("../src/graphs/store.js");
    const res = await graphRoutes.request("/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "sessions",
        name: "from viewer",
        sessions: [{ provider: "claude-code", id: "s1", kind: "session", projectDir: "/p" }],
      }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const g = await readGraph(id);
    expect(g?.name).toBe("from viewer");
    expect(g?.nodes.map((n) => n.type)).toEqual(["session", "subagent-run"]);
    expect(g?.edges[0]).toMatchObject({ source: "n-s0", target: "n-s0-c0", sourceHandle: "sub" });
  });

  it("seeds agent and payload workflows", async () => {
    const { graphRoutes } = await import("../src/routes/graphs.js");
    const { readGraph } = await import("../src/graphs/store.js");
    const post = (body: unknown) =>
      graphRoutes.request("/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const a = (await (await post({ kind: "agent", provider: "claude-code", name: "Plan", source: "builtin" })).json()) as { id: string };
    expect((await readGraph(a.id))?.nodes.map((n) => n.type)).toEqual(["prompt", "agent-def"]);
    const p = (await (await post({ kind: "payload", hash: "abc", payloadKind: "transcript-excerpt", preview: "ctx" })).json()) as { id: string };
    expect((await readGraph(p.id))?.nodes[0]?.data).toMatchObject({ type: "context", payloadHash: "abc" });
  });

  it("rejects unknown providers and kinds", async () => {
    const { graphRoutes } = await import("../src/routes/graphs.js");
    const bad = await graphRoutes.request("/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "sessions", name: "x", sessions: [{ provider: "nope", id: "1" }] }),
    });
    expect(bad.status).toBe(400);
    const odd = await graphRoutes.request("/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "magic" }),
    });
    expect(odd.status).toBe(400);
    const kind = await graphRoutes.request("/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "payload", hash: "a", payloadKind: "session", preview: "" }),
    });
    expect(kind.status).toBe(400);
  });
});
