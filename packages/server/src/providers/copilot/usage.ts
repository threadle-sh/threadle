import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
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

export type CopilotTokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

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

function pickNum(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * Parse Copilot `--usage-output-file` JSON (shape churns; accept common keys).
 */
export function parseCopilotUsageFile(raw: string): CopilotTokenUsage | undefined {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const candidates: Record<string, unknown>[] = [];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const root = data as Record<string, unknown>;
    candidates.push(root);
    for (const key of ["usage", "totals", "session", "statistics", "stats"]) {
      const nested = root[key];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        candidates.push(nested as Record<string, unknown>);
      }
    }
  }
  for (const c of candidates) {
    const inputTokens = pickNum(
      c,
      "input_tokens",
      "inputTokens",
      "prompt_tokens",
      "promptTokens",
    );
    const outputTokens = pickNum(
      c,
      "output_tokens",
      "outputTokens",
      "completion_tokens",
      "completionTokens",
    );
    if (inputTokens != null || outputTokens != null) {
      if (!(inputTokens || outputTokens)) continue;
      return { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 };
    }
  }
  return undefined;
}

/** Sum token columns for a session id from assistant_usage_events. */
export function sessionTokensFromDb(sessionId: string): CopilotTokenUsage | undefined {
  const db = openDb();
  if (!db) return undefined;
  try {
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(input_tokens), 0) AS tokensIn,
           COALESCE(SUM(output_tokens), 0) AS tokensOut
         FROM assistant_usage_events WHERE session_id = ?`,
      )
      .get(sessionId) as { tokensIn?: number; tokensOut?: number } | undefined;
    if (!row) return undefined;
    const inputTokens = Number(row.tokensIn) || 0;
    const outputTokens = Number(row.tokensOut) || 0;
    if (!inputTokens && !outputTokens) return undefined;
    return { inputTokens, outputTokens };
  } catch {
    return undefined;
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

/** Brief settle + DB lookup for tokens written after a CLI exit. */
export async function waitSessionTokensFromDb(
  sessionId: string,
  attempts = 4,
  delayMs = 150,
): Promise<CopilotTokenUsage | undefined> {
  for (let i = 0; i < attempts; i++) {
    const u = sessionTokensFromDb(sessionId);
    if (u) return u;
    if (i + 1 < attempts) {
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  return undefined;
}

/** Create a temp path for `--usage-output-file`. */
export function copilotUsageTempPath(): string {
  return path.join(os.tmpdir(), `threadle-copilot-usage-${randomUUID()}.json`);
}

export function readCopilotUsageFile(filePath: string): CopilotTokenUsage | undefined {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return parseCopilotUsageFile(raw);
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
