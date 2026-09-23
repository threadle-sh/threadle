/**
 * Providers rarely expose a true system/tools/rules token split. For smoke
 * runs we approximate: baseline ≈ tokensIn − prompt (chars÷4).
 */

export interface TokenBaselineEstimate {
  tokensIn: number;
  promptEst: number;
  baselineEst: number;
  /** What’s left after subtracting the user prompt. */
  baselineNote: string;
}

/** Same rule of thumb Claude / many CLIs use (UTF-8 chars ÷ 4). */
export function estimateCharsToTokens(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.max(1, Math.round(chars / 4));
}

export function estimateTokenBaseline(
  tokensIn: number,
  promptText: string,
  opts?: { ignoreLocalMarkdown?: boolean },
): TokenBaselineEstimate | undefined {
  if (!Number.isFinite(tokensIn) || tokensIn <= 0) return undefined;
  const promptEst = estimateCharsToTokens(promptText.trim().length);
  const baselineEst = Math.max(0, Math.round(tokensIn) - promptEst);
  const baselineNote = opts?.ignoreLocalMarkdown
    ? "system · tools · MCP (local md skipped)"
    : "system · tools · rules · skills · MCP · project md";
  return { tokensIn: Math.round(tokensIn), promptEst, baselineEst, baselineNote };
}

/** Compact “~6.4k” for meta lines. */
export function formatTokCompact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "?";
  if (n < 1000) return String(Math.round(n));
  const k = n / 1000;
  return `${k >= 10 ? k.toFixed(0) : k.toFixed(1)}k`;
}

/** Suffix for run-log `■ … tok` lines. */
export function formatBaselineSuffix(b: TokenBaselineEstimate): string {
  if (b.baselineEst <= 0) return "";
  return `baseline ~${formatTokCompact(b.baselineEst)} (${b.baselineNote})`;
}
