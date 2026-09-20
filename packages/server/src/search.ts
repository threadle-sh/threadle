import fs from "node:fs";
import path from "node:path";
import type { ContextPayload } from "@threadle/shared";
import { registry } from "./providers/registry.js";
import { threadleConfigDir } from "./graphs/store.js";

export interface SearchHit {
  docType: "message" | "payload";
  provider: string;
  sessionId: string; // payload hash for payloads
  role?: string;
  ts?: number;
  snippet: string;
  /** message id for jumping into the transcript (message hits only) */
  messageId?: string;
  /** payloads: kind + source session */
  extra?: { kind?: string; sourceProvider?: string; sourceSessionId?: string };
}

type Db = import("node:sqlite").DatabaseSync;

let db: Db | null | undefined;

function openDb(): Db | null {
  if (db !== undefined) return db;
  try {
    const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
    fs.mkdirSync(threadleConfigDir(), { recursive: true });
    const d = new sqlite.DatabaseSync(path.join(threadleConfigDir(), "search.db"));
    d.exec(`
      CREATE TABLE IF NOT EXISTS indexed (
        provider TEXT NOT NULL,
        session_id TEXT NOT NULL,
        stamp REAL NOT NULL,
        PRIMARY KEY (provider, session_id)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
        text,
        provider UNINDEXED,
        session_id UNINDEXED,
        doc_type UNINDEXED,
        role UNINDEXED,
        ts UNINDEXED,
        extra UNINDEXED
      );
    `);
    db = d;
  } catch (err) {
    console.warn(`threadle: search index unavailable (${String(err)})`);
    db = null;
  }
  return db;
}

/** Empty the search index in place (the file stays open; sessions reindex lazily). */
export function clearIndex(): void {
  const d = openDb();
  if (!d) return;
  d.exec("DELETE FROM fts; DELETE FROM indexed; VACUUM;");
}

const TEXT_CAP = 32_000;

async function reindexSession(
  d: Db,
  provider: string,
  sessionId: string,
  stamp: number,
): Promise<void> {
  const p = registry.get(provider);
  const messages = await (p.getTranscriptFull ?? p.getTranscript)
    .call(p, sessionId)
    .catch(() => []);
  d.exec("BEGIN");
  try {
    d.prepare(
      "DELETE FROM fts WHERE provider = ? AND session_id = ? AND doc_type = 'message'",
    ).run(provider, sessionId);
    const ins = d.prepare(
      "INSERT INTO fts (text, provider, session_id, doc_type, role, ts, extra) VALUES (?, ?, ?, 'message', ?, ?, ?)",
    );
    for (const m of messages) {
      const text = m.parts
        .filter((pt) => (pt.type === "text" || pt.type === "thinking") && pt.text)
        .map((pt) => pt.text)
        .join("\n")
        .slice(0, TEXT_CAP);
      if (!text.trim()) continue;
      ins.run(
        text,
        provider,
        sessionId,
        m.role,
        m.timestamp ?? null,
        JSON.stringify({ messageId: m.id }),
      );
    }
    d.prepare(
      "INSERT INTO indexed (provider, session_id, stamp) VALUES (?, ?, ?) " +
        "ON CONFLICT(provider, session_id) DO UPDATE SET stamp = excluded.stamp",
    ).run(provider, sessionId, stamp);
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

async function indexPayloads(d: Db): Promise<void> {
  const base = path.join(threadleConfigDir(), "payloads");
  let shards: string[] = [];
  try {
    shards = await fs.promises.readdir(base);
  } catch {
    return;
  }
  const stamps = new Map<string, number>(
    (
      d.prepare("SELECT session_id, stamp FROM indexed WHERE provider = 'payload'").all() as Array<{
        session_id: string;
        stamp: number;
      }>
    ).map((r) => [r.session_id, r.stamp]),
  );
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
      const hash = f.slice(0, -5);
      const full = path.join(base, shard, f);
      try {
        const st = await fs.promises.stat(full);
        if (stamps.get(hash) === st.mtimeMs) continue;
        const payload = JSON.parse(await fs.promises.readFile(full, "utf8")) as ContextPayload;
        d.prepare(
          "DELETE FROM fts WHERE provider = 'payload' AND session_id = ?",
        ).run(hash);
        d.prepare(
          "INSERT INTO fts (text, provider, session_id, doc_type, role, ts, extra) VALUES (?, 'payload', ?, 'payload', NULL, ?, ?)",
        ).run(
          payload.content.slice(0, TEXT_CAP),
          hash,
          payload.createdAt,
          JSON.stringify({
            kind: payload.kind,
            sourceProvider: payload.source.provider,
            sourceSessionId: payload.source.sessionId,
          }),
        );
        d.prepare(
          "INSERT INTO indexed (provider, session_id, stamp) VALUES ('payload', ?, ?) " +
            "ON CONFLICT(provider, session_id) DO UPDATE SET stamp = excluded.stamp",
        ).run(hash, st.mtimeMs);
      } catch {
        // skip unreadable payload
      }
    }
  }
}

/** Bring the index up to date: sessions whose stamp changed, plus payloads. */
export async function refreshIndex(): Promise<void> {
  const d = openDb();
  if (!d) return;
  const stamps = new Map<string, number>(
    (
      d.prepare("SELECT provider, session_id, stamp FROM indexed WHERE provider != 'payload'").all() as Array<{
        provider: string;
        session_id: string;
        stamp: number;
      }>
    ).map((r) => [`${r.provider}:${r.session_id}`, r.stamp]),
  );
  for (const p of registry.providers.values()) {
    try {
      if (!(await p.available())) continue;
      for (const s of await p.listSessions()) {
        const stamp = s.updatedAt;
        if (stamps.get(`${p.id}:${s.id}`) === stamp) continue;
        await reindexSession(d, p.id, s.id, stamp).catch(() => undefined);
      }
    } catch {
      // provider offline
    }
  }
  await indexPayloads(d);
}

export interface SearchFilters {
  /** claude-code | opencode | payload */
  provider?: string;
  /** user | assistant */
  role?: string;
  /** message | payload */
  docType?: string;
}

/** FTS query with prefix matching per token; returns ranked hits with snippets. */
export async function search(
  query: string,
  limit = 40,
  filters: SearchFilters = {},
): Promise<SearchHit[]> {
  const d = openDb();
  if (!d) return [];
  await refreshIndex();
  const tokens = query
    .split(/\s+/)
    .map((t) => t.replace(/"/g, "").trim())
    .filter(Boolean)
    .map((t) => `"${t}"*`);
  if (!tokens.length) return [];
  const conds = ["fts MATCH ?"];
  const params: Array<string | number> = [tokens.join(" ")];
  if (filters.provider) {
    conds.push("provider = ?");
    params.push(filters.provider);
  }
  if (filters.docType) {
    conds.push("doc_type = ?");
    params.push(filters.docType);
  }
  if (filters.role) {
    conds.push("role = ?");
    params.push(filters.role);
  }
  params.push(limit);
  const rows = d
    .prepare(
      "SELECT snippet(fts, 0, '⟪', '⟫', '…', 14) AS snip, provider, session_id, doc_type, role, ts, extra " +
        `FROM fts WHERE ${conds.join(" AND ")} ORDER BY rank LIMIT ?`,
    )
    .all(...params) as Array<{
    snip: string;
    provider: string;
    session_id: string;
    doc_type: "message" | "payload";
    role: string | null;
    ts: number | null;
    extra: string | null;
  }>;
  return rows.map((r) => {
    const extra = r.extra
      ? (JSON.parse(r.extra) as {
          messageId?: string;
          kind?: string;
          sourceProvider?: string;
          sourceSessionId?: string;
        })
      : undefined;
    return {
      docType: r.doc_type,
      provider: r.provider,
      sessionId: r.session_id,
      role: r.role ?? undefined,
      ts: r.ts ?? undefined,
      snippet: r.snip,
      messageId: extra?.messageId,
      extra:
        r.doc_type === "payload"
          ? {
              kind: extra?.kind,
              sourceProvider: extra?.sourceProvider,
              sourceSessionId: extra?.sourceSessionId,
            }
          : undefined,
    };
  });
}
