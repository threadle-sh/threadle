/**
 * Detect provider “usage exhausted / pick another model” failures from CLI text.
 * Claude plan windows are 5h + 7d (weekly). Cursor uses monthly model pools —
 * we only infer those from error strings (no remaining-% on disk).
 */

export type UsageExhaustionKind =
  | "claude-5h"
  | "claude-7d"
  | "claude-opus-7d"
  | "cursor-other-models"
  | "cursor-cursor-models"
  | "cursor-slow-pool"
  | "rate-limit"
  | "generic";

export interface UsageExhaustionHit {
  kind: UsageExhaustionKind;
  /** Short label for UI chips */
  label: string;
  /** Full run-log / error line */
  message: string;
}

const PATTERNS: Array<{
  kind: UsageExhaustionKind;
  label: string;
  re: RegExp;
}> = [
  {
    kind: "cursor-other-models",
    label: "Other Models pool",
    re: /other\s+models?\s+usage\s+limit/i,
  },
  {
    kind: "cursor-cursor-models",
    label: "Cursor Models pool",
    re: /cursor\s+models?\s+usage\s+limit/i,
  },
  {
    kind: "cursor-slow-pool",
    label: "slow pool / switch model",
    re: /not available in the slow pool|please switch to auto|switch to auto/i,
  },
  {
    kind: "claude-opus-7d",
    label: "Claude Opus 7d",
    re: /opus.*(limit|quota|exhausted|utilization)|weekly.*opus/i,
  },
  {
    kind: "claude-7d",
    label: "Claude 7d",
    re: /7[- ]?day|weekly\s+(usage|limit|quota)|plan\s+limit.*week/i,
  },
  {
    kind: "claude-5h",
    label: "Claude 5h",
    re: /5[- ]?hour|five[- ]hour/i,
  },
  {
    kind: "rate-limit",
    label: "rate limit",
    re: /rate\s*limit|too many requests|429\b/i,
  },
  {
    kind: "generic",
    label: "usage limit",
    re: /usage\s+limit|quota\s+(exceeded|exhausted)|out of (usage|credits)|limit reached|you've hit your|you have hit your|spend.?limit|insufficient.*(credit|quota)|model.*(unavailable|exhausted)/i,
  },
];

export function classifyUsageExhaustion(raw: string): UsageExhaustionHit | null {
  const text = raw.trim();
  if (!text) return null;
  for (const p of PATTERNS) {
    if (!p.re.test(text)) continue;
    return {
      kind: p.kind,
      label: p.label,
      message: formatUsageExhaustionMessage(p.kind, p.label, text),
    };
  }
  return null;
}

export function formatUsageExhaustionMessage(
  kind: UsageExhaustionKind,
  label: string,
  detail?: string,
): string {
  const tip =
    kind === "cursor-slow-pool" || kind.startsWith("cursor-")
      ? "pick another model on the agent (or Auto / a Cursor Models pool model), or raise Spending"
      : kind.startsWith("claude-")
        ? "pick another model on the agent, or wait until the plan window resets"
        : "pick another model on the agent node";
  const snip = detail
    ?.replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return snip
    ? `model usage exhausted (${label}) — ${tip}. detail: ${snip}`
    : `model usage exhausted (${label}) — ${tip}`;
}

/** Rewrite a provider error so run logs show a clear exhaustion issue. */
export function enrichUsageExhaustionError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  const hit = classifyUsageExhaustion(raw);
  if (!hit) return err instanceof Error ? err : new Error(raw);
  const e = new Error(hit.message);
  (e as Error & { usageExhaustion?: UsageExhaustionHit }).usageExhaustion = hit;
  return e;
}

export interface ClaudeUsageWindowView {
  id: "fiveHour" | "sevenDay" | "sevenDayOpus";
  /** Short chip text */
  label: string;
  utilization: number;
  resetsAt?: string;
  /** True when utilization ≥ 100 */
  exhausted: boolean;
  /** Hot warning band (≥ 90) */
  hot: boolean;
}

export function claudeWindowViews(usage?: {
  fiveHour?: { utilization: number; resetsAt?: string };
  sevenDay?: { utilization: number; resetsAt?: string };
  sevenDayOpus?: { utilization: number; resetsAt?: string };
}): ClaudeUsageWindowView[] {
  if (!usage) return [];
  const out: ClaudeUsageWindowView[] = [];
  const push = (
    id: ClaudeUsageWindowView["id"],
    label: string,
    w?: { utilization: number; resetsAt?: string },
  ): void => {
    if (!w || typeof w.utilization !== "number") return;
    out.push({
      id,
      label,
      utilization: w.utilization,
      resetsAt: w.resetsAt,
      exhausted: w.utilization >= 100,
      hot: w.utilization >= 90,
    });
  };
  push("fiveHour", "Claude 5h", usage.fiveHour);
  push("sevenDay", "Claude 7d", usage.sevenDay);
  push("sevenDayOpus", "Claude Opus 7d", usage.sevenDayOpus);
  return out;
}

/** Windows that should block / warn before a Claude agent run. */
export function claudeExhaustedForModel(
  model: string | undefined,
  usage?: {
    fiveHour?: { utilization: number; resetsAt?: string };
    sevenDay?: { utilization: number; resetsAt?: string };
    sevenDayOpus?: { utilization: number; resetsAt?: string };
  },
): ClaudeUsageWindowView[] {
  const views = claudeWindowViews(usage).filter((v) => v.exhausted);
  if (!views.length) return [];
  const m = (model ?? "").toLowerCase();
  const isOpus = /\bopus\b/.test(m);
  if (isOpus) {
    return views.filter(
      (v) => v.id === "sevenDayOpus" || v.id === "fiveHour" || v.id === "sevenDay",
    );
  }
  // Non-opus: Opus-only window doesn't block sonnet/haiku
  return views.filter((v) => v.id !== "sevenDayOpus");
}
