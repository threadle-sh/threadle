import type { SessionRef } from "@threadle/shared";

/**
 * Viewer → workflows seams. The workflows server builds the graph
 * (POST /api/graphs/seed); the viewer only sends plain refs and gets an id.
 */
async function seed(body: unknown): Promise<string> {
  const res = await fetch("/api/graphs/seed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !out.id) {
    throw new Error(
      res.status === 404 ? "workflows are disabled on this server" : (out.error ?? `${res.status} ${res.statusText}`),
    );
  }
  return out.id;
}

/**
 * Seed an editable workflow from real sessions: each session becomes a node,
 * its subagent runs hang beneath it on child wires. Returns the new graph id.
 */
export async function sessionsToWorkflow(name: string, sessions: SessionRef[]): Promise<string> {
  return seed({
    kind: "sessions",
    name,
    sessions: sessions.map((s) => ({
      provider: s.provider,
      id: s.id,
      kind: s.kind,
      title: s.title,
      agent: s.agent,
      projectDir: s.projectDir,
    })),
  });
}

/** Seed a workflow with an agent + prompt pair, ready to wire and run. */
export async function agentToWorkflow(a: {
  provider: string;
  name: string;
  source: string;
  model?: string;
}): Promise<string> {
  return seed({ kind: "agent", provider: a.provider, name: a.name, source: a.source, model: a.model });
}

/** Seed a workflow with one pre-materialized context node from a library payload. */
export async function payloadToWorkflow(payload: {
  hash: string;
  kind: string;
  preview: string;
}): Promise<string> {
  return seed({ kind: "payload", hash: payload.hash, payloadKind: payload.kind, preview: payload.preview });
}

/**
 * Snapshot a session's reconstructed context into the library (tag: `reference`)
 * and seed a new workflow with that context node ready to wire.
 */
export async function referenceContextToWorkflow(
  provider: string,
  sessionId: string,
): Promise<{ graphId: string; hash: string; tags: string[] }> {
  const res = await fetch("/api/context/reference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: { provider, sessionId } }),
  });
  const body = (await res.json()) as {
    error?: string;
    hash?: string;
    kind?: string;
    preview?: string;
    tags?: string[];
  };
  if (!res.ok || !body.hash || !body.kind) {
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  const graphId = await payloadToWorkflow({
    hash: body.hash,
    kind: body.kind,
    preview: body.preview || "session context",
  });
  return { graphId, hash: body.hash, tags: body.tags ?? ["reference"] };
}

/** Save session context to the library with the `reference` tag (no new workflow). */
export async function referenceContextToLibrary(
  provider: string,
  sessionId: string,
): Promise<{ hash: string; tags: string[]; preview: string }> {
  const res = await fetch("/api/context/reference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: { provider, sessionId } }),
  });
  const body = (await res.json()) as {
    error?: string;
    hash?: string;
    preview?: string;
    tags?: string[];
  };
  if (!res.ok || !body.hash) {
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return {
    hash: body.hash,
    tags: body.tags ?? ["reference"],
    preview: body.preview || "session context",
  };
}

export async function downloadUrl(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}
