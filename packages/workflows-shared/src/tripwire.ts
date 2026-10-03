/** Circuit breaker — automatic limit on a wire (graph JSON type remains `tripwire`). */

export type TripwireMode = "spend" | "tokens" | "duration" | "content" | "retries";
export type TripwireAction = "abort" | "skip" | "park";

export const TRIPWIRE_MODES: readonly TripwireMode[] = [
  "spend",
  "tokens",
  "duration",
  "content",
  "retries",
] as const;

export const TRIPWIRE_ACTIONS: readonly TripwireAction[] = [
  "abort",
  "skip",
  "park",
] as const;

export interface TripwireConfig {
  mode: TripwireMode;
  action: TripwireAction;
  /** spend — USD */
  thresholdUsd?: number;
  /** tokens — in+out (or estimated) */
  thresholdTokens?: number;
  /** duration — wall-clock ms since run start */
  thresholdMs?: number;
  /** content — minimum inbound text length */
  minChars?: number;
  /** content — JS regex source; see tripOnMatch */
  pattern?: string;
  /** content — trip when pattern matches (default: trip when it does not) */
  tripOnMatch?: boolean;
  /** retries — trip when run failure count (continueOnError) ≥ this */
  thresholdRetries?: number;
}

export interface TripwireEvalCtx {
  text: string;
  runSpend: number;
  runStartedAt: number;
  runFailures: number;
  /** known token total from inbound session(s); else chars÷4 estimate */
  tokens?: number;
  now?: number;
}

export interface TripwireEvalResult {
  tripped: boolean;
  reason: string;
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Pure predicate: should this tripwire fire for the current run context?
 * Does not apply the action — callers abort / skip / park.
 */
export function evaluateTripwire(
  cfg: TripwireConfig,
  ctx: TripwireEvalCtx,
): TripwireEvalResult {
  const now = ctx.now ?? Date.now();
  switch (cfg.mode) {
    case "spend": {
      const lim = cfg.thresholdUsd;
      if (lim == null || !(lim > 0)) {
        return { tripped: false, reason: "spend breaker has no threshold" };
      }
      if (ctx.runSpend >= lim) {
        return {
          tripped: true,
          reason: `spend $${ctx.runSpend.toFixed(4)} ≥ $${lim}`,
        };
      }
      return {
        tripped: false,
        reason: `spend $${ctx.runSpend.toFixed(4)} < $${lim}`,
      };
    }
    case "tokens": {
      const lim = cfg.thresholdTokens;
      if (lim == null || !(lim > 0)) {
        return { tripped: false, reason: "token breaker has no threshold" };
      }
      const toks = ctx.tokens ?? estimateTokens(ctx.text);
      if (toks >= lim) {
        return { tripped: true, reason: `tokens ${toks} ≥ ${lim}` };
      }
      return { tripped: false, reason: `tokens ${toks} < ${lim}` };
    }
    case "duration": {
      const lim = cfg.thresholdMs;
      if (lim == null || !(lim > 0)) {
        return { tripped: false, reason: "duration breaker has no threshold" };
      }
      const elapsed = Math.max(0, now - ctx.runStartedAt);
      if (elapsed >= lim) {
        return {
          tripped: true,
          reason: `duration ${(elapsed / 1000).toFixed(1)}s ≥ ${(lim / 1000).toFixed(1)}s`,
        };
      }
      return {
        tripped: false,
        reason: `duration ${(elapsed / 1000).toFixed(1)}s < ${(lim / 1000).toFixed(1)}s`,
      };
    }
    case "content": {
      const text = ctx.text ?? "";
      if (cfg.minChars != null && cfg.minChars > 0 && text.trim().length < cfg.minChars) {
        return {
          tripped: true,
          reason: `content ${text.trim().length} chars < min ${cfg.minChars}`,
        };
      }
      if (cfg.pattern) {
        let re: RegExp;
        try {
          re = new RegExp(cfg.pattern, "m");
        } catch {
          return { tripped: true, reason: `invalid pattern /${cfg.pattern}/` };
        }
        const matched = re.test(text);
        const onMatch = cfg.tripOnMatch === true;
        if (onMatch ? matched : !matched) {
          return {
            tripped: true,
            reason: onMatch
              ? `content matched /${cfg.pattern}/`
              : `content did not match /${cfg.pattern}/`,
          };
        }
      }
      if (cfg.minChars == null && !cfg.pattern) {
        if (!text.trim()) {
          return { tripped: true, reason: "content empty" };
        }
      }
      return { tripped: false, reason: "content ok" };
    }
    case "retries": {
      const lim = cfg.thresholdRetries;
      if (lim == null || !(lim > 0)) {
        return { tripped: false, reason: "retry fuse has no threshold" };
      }
      if (ctx.runFailures >= lim) {
        return {
          tripped: true,
          reason: `failures ${ctx.runFailures} ≥ ${lim}`,
        };
      }
      return {
        tripped: false,
        reason: `failures ${ctx.runFailures} < ${lim}`,
      };
    }
    default:
      return { tripped: false, reason: "unknown mode" };
  }
}
