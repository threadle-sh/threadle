import type { SessionRef } from "@threadle/shared";
import { sessionStoreDbPath } from "./paths.js";

type SqliteDb = import("node:sqlite").DatabaseSync;

interface UsageAgg {
  tokensIn: number;
  tokensOut: number;
  tokensReasoning: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  model?: string;
}

function openDb(): SqliteDb | undefined {
  try {
    const sqlite = process.getBuiltinModule(
      "node:sqlite",
    ) as typeof import("node:sqlite");
    return new sqlite.DatabaseSync(sessionStoreDbPath(), { readOnly: true });
  } catch {
    return undefined;
  }
}

/** Sum token columns from assistant_usage_events onto a SessionRef. */
export function enrichSessionTokens(ref: SessionRef): SessionRef {
  const db = openDb();
  if (!db) return ref;
  try {
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(input_tokens), 0) AS tokensIn,
           COALESCE(SUM(output_tokens), 0) AS tokensOut,
           COALESCE(SUM(reasoning_tokens), 0) AS tokensReasoning,
           COALESCE(SUM(cache_read_tokens), 0) AS tokensCacheRead,
           COALESCE(SUM(cache_write_tokens), 0) AS tokensCacheWrite,
           (SELECT model FROM assistant_usage_events
              WHERE session_id = ? ORDER BY id DESC LIMIT 1) AS model
         FROM assistant_usage_events WHERE session_id = ?`,
      )
      .get(ref.id, ref.id) as unknown as UsageAgg | undefined;
    if (!row) return ref;
    const tokensIn = Number(row.tokensIn) || 0;
    const tokensOut = Number(row.tokensOut) || 0;
    const tokensReasoning = Number(row.tokensReasoning) || 0;
    const tokensCacheRead = Number(row.tokensCacheRead) || 0;
    const tokensCacheWrite = Number(row.tokensCacheWrite) || 0;
    if (
      tokensIn + tokensOut + tokensReasoning + tokensCacheRead + tokensCacheWrite ===
      0
    ) {
      return row.model ? { ...ref, model: row.model } : ref;
    }
    return {
      ...ref,
      model: row.model || ref.model,
      tokensIn: tokensIn || undefined,
      tokensOut: tokensOut || undefined,
      tokensReasoning: tokensReasoning || undefined,
      tokensCacheRead: tokensCacheRead || undefined,
      tokensCacheWrite: tokensCacheWrite || undefined,
    };
  } catch {
    return ref;
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}
