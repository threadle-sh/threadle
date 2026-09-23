import fs from "node:fs";
import path from "node:path";
import { readCodexTranscript } from "./jsonl.js";
import { sessionsDir } from "./paths.js";

export interface CodexUsage {
  tokensIn: number;
  tokensOut: number;
  tokensReasoning?: number;
  /** CLI token_usage_record / token_count, or chars÷4 fallback. */
  source: "cli" | "estimate";
}

type TokenBag = {
  input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
};

function fromBag(
  bag: TokenBag | undefined,
  source: "cli",
): CodexUsage | undefined {
  if (!bag) return undefined;
  const tokensIn = typeof bag.input_tokens === "number" ? bag.input_tokens : undefined;
  const tokensOut = typeof bag.output_tokens === "number" ? bag.output_tokens : undefined;
  if (tokensIn == null && tokensOut == null) return undefined;
  const reasoning =
    typeof bag.reasoning_output_tokens === "number" && bag.reasoning_output_tokens > 0
      ? bag.reasoning_output_tokens
      : undefined;
  return {
    tokensIn: tokensIn ?? 0,
    tokensOut: tokensOut ?? 0,
    tokensReasoning: reasoning,
    source,
  };
}

/**
 * Parse one Codex JSONL / `--json` event for authoritative usage.
 * Prefers `token_usage_record`, then `token_count` last/total bags.
 */
export function parseCodexUsageFromEvent(
  evt: Record<string, unknown>,
): CodexUsage | undefined {
  if (evt.type === "token_usage_record") {
    const payload =
      evt.payload && typeof evt.payload === "object" && !Array.isArray(evt.payload)
        ? (evt.payload as Record<string, unknown>)
        : undefined;
    const usage = payload?.usage;
    if (usage && typeof usage === "object" && !Array.isArray(usage)) {
      return fromBag(usage as TokenBag, "cli");
    }
  }

  if (evt.type === "event_msg") {
    const payload =
      evt.payload && typeof evt.payload === "object" && !Array.isArray(evt.payload)
        ? (evt.payload as Record<string, unknown>)
        : undefined;
    if (payload?.type === "token_count") {
      const info =
        payload.info && typeof payload.info === "object" && !Array.isArray(payload.info)
          ? (payload.info as Record<string, unknown>)
          : undefined;
      return (
        fromBag(info?.last_token_usage as TokenBag | undefined, "cli") ??
        fromBag(info?.total_token_usage as TokenBag | undefined, "cli")
      );
    }
  }

  // Some exec streams nest usage on item / top-level usage bags.
  if (evt.usage && typeof evt.usage === "object" && !Array.isArray(evt.usage)) {
    const u = fromBag(evt.usage as TokenBag, "cli");
    if (u) return u;
  }

  return undefined;
}

/** Scan newline-delimited JSON (stdout or rollout) for the latest CLI usage. */
export function findCodexUsageInJsonl(text: string): CodexUsage | undefined {
  let last: CodexUsage | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      const u = parseCodexUsageFromEvent(evt);
      if (u) last = u;
    } catch {
      // skip
    }
  }
  return last;
}

/** Walk recent session day dirs for a rollout matching `sessionId`. */
export async function findCodexUsageFromRollout(
  sessionId: string,
): Promise<CodexUsage | undefined> {
  const root = sessionsDir();
  let years: string[];
  try {
    years = await fs.promises.readdir(root);
  } catch {
    return undefined;
  }
  // Newest years/months/days first.
  years.sort((a, b) => b.localeCompare(a));
  for (const y of years.slice(0, 2)) {
    const yDir = path.join(root, y);
    let months: string[];
    try {
      months = await fs.promises.readdir(yDir);
    } catch {
      continue;
    }
    months.sort((a, b) => b.localeCompare(a));
    for (const m of months.slice(0, 3)) {
      const mDir = path.join(yDir, m);
      let days: string[];
      try {
        days = await fs.promises.readdir(mDir);
      } catch {
        continue;
      }
      days.sort((a, b) => b.localeCompare(a));
      for (const d of days.slice(0, 7)) {
        const dDir = path.join(mDir, d);
        let files: string[];
        try {
          files = await fs.promises.readdir(dDir);
        } catch {
          continue;
        }
        const hit = files.find((f) => f.includes(sessionId) && f.endsWith(".jsonl"));
        if (!hit) continue;
        try {
          const raw = await fs.promises.readFile(path.join(dDir, hit), "utf8");
          const u = findCodexUsageInJsonl(raw);
          if (u) return u;
        } catch {
          /* skip */
        }
      }
    }
  }
  return undefined;
}

/**
 * Rough token estimate from normalized transcript text (and thinking blocks).
 * Same chars÷4 rule of thumb as Cursor / Antigravity when CLI usage is missing.
 */
export async function estimateUsageFromTranscript(
  filePath: string,
): Promise<CodexUsage | undefined> {
  let inChars = 0;
  let outChars = 0;
  let thinkChars = 0;
  try {
    const msgs = await readCodexTranscript(filePath);
    for (const m of msgs) {
      for (const p of m.parts) {
        if (p.type === "thinking") {
          thinkChars += p.text?.length ?? 0;
          continue;
        }
        if (p.type === "text") {
          const n = p.text?.length ?? 0;
          if (m.role === "user") inChars += n;
          else outChars += n;
          continue;
        }
        if (p.type === "tool_use") {
          const input =
            typeof p.toolInput === "string"
              ? p.toolInput
              : p.toolInput !== undefined
                ? JSON.stringify(p.toolInput)
                : "";
          outChars += (p.toolName?.length ?? 0) + input.length;
          continue;
        }
        if (p.type === "tool_result") {
          outChars += p.text?.length ?? 0;
        }
      }
    }
  } catch {
    return undefined;
  }
  if (!inChars && !outChars && !thinkChars) return undefined;
  return {
    tokensIn: Math.max(0, Math.ceil(inChars / 4)),
    tokensOut: Math.max(0, Math.ceil(outChars / 4)),
    tokensReasoning: thinkChars ? Math.max(0, Math.ceil(thinkChars / 4)) : undefined,
    source: "estimate",
  };
}

export async function resolveCodexUsage(
  transcriptPath: string,
): Promise<CodexUsage | undefined> {
  try {
    const raw = await fs.promises.readFile(transcriptPath, "utf8");
    const cli = findCodexUsageInJsonl(raw);
    if (cli) return cli;
  } catch {
    /* missing */
  }
  return estimateUsageFromTranscript(transcriptPath);
}
