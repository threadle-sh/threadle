/** Judge — labeled multi-out branch on inbound text (graph JSON `type: "judge"`). */

export const JUDGE_PORTS = ["pass", "fail", "unsure"] as const;
export type JudgePort = (typeof JUDGE_PORTS)[number];

export type JudgeMatcherKind = "regex" | "contains";
export type JudgeUnmatchedAction = "unsure" | "park";

export const JUDGE_MATCHER_KINDS: readonly JudgeMatcherKind[] = [
  "regex",
  "contains",
] as const;

export const JUDGE_UNMATCHED_ACTIONS: readonly JudgeUnmatchedAction[] = [
  "unsure",
  "park",
] as const;

export interface JudgeMatcher {
  /** Stable id for list keys / edits */
  id: string;
  /** Out-port this matcher routes to (not `unsure` — that is the unmatched default). */
  port: "pass" | "fail";
  kind: JudgeMatcherKind;
  /** Regex source, or literal substring for `contains` */
  pattern: string;
  /** Default false (case-insensitive). Applies to both `contains` and `regex`. */
  caseSensitive?: boolean;
}

export interface JudgeConfig {
  matchers: JudgeMatcher[];
  /** When no matcher hits — emit on `unsure`, or park like an approval gate */
  unmatched: JudgeUnmatchedAction;
  /** Optional display labels for the three out-ports */
  portLabels?: Partial<Record<JudgePort, string>>;
}

export interface JudgeEvalResult {
  port: JudgePort;
  reason: string;
  /** true when no matcher hit and unmatched === park */
  park: boolean;
}

function defaultLabel(port: JudgePort): string {
  return port;
}

export function judgePortLabel(cfg: Pick<JudgeConfig, "portLabels">, port: JudgePort): string {
  const custom = cfg.portLabels?.[port]?.trim();
  return custom || defaultLabel(port);
}

/**
 * First-hit matcher wins. No match → `unsure` (emit) or park (caller waits).
 * Invalid regex counts as a non-hit (skipped) so a bad pattern does not abort the run.
 */
export function evaluateJudge(cfg: JudgeConfig, text: string): JudgeEvalResult {
  const body = text ?? "";
  for (const m of cfg.matchers ?? []) {
    if (!m.pattern?.trim()) continue;
    if (m.port !== "pass" && m.port !== "fail") continue;
    if (m.kind === "contains") {
      const hay = m.caseSensitive ? body : body.toLowerCase();
      const needle = m.caseSensitive ? m.pattern : m.pattern.toLowerCase();
      if (hay.includes(needle)) {
        return {
          port: m.port,
          reason: `contains "${m.pattern}" → ${m.port}`,
          park: false,
        };
      }
      continue;
    }
    // regex — `im` by default (case-insensitive); `caseSensitive` → `m` only
    let re: RegExp;
    try {
      re = new RegExp(m.pattern, m.caseSensitive ? "m" : "im");
    } catch {
      continue;
    }
    if (re.test(body)) {
      return {
        port: m.port,
        reason: `/${m.pattern}/ → ${m.port}`,
        park: false,
      };
    }
  }
  const unmatched = cfg.unmatched === "park" ? "park" : "unsure";
  if (unmatched === "park") {
    return {
      port: "unsure",
      reason: "no matcher hit → park",
      park: true,
    };
  }
  return {
    port: "unsure",
    reason: "no matcher hit → unsure",
    park: false,
  };
}

/** Build the ports map: winner carries text; other labeled outs stay empty. */
export function judgePortsOutput(
  winner: JudgePort,
  text: string,
): Record<JudgePort, string> {
  return {
    pass: winner === "pass" ? text : "",
    fail: winner === "fail" ? text : "",
    unsure: winner === "unsure" ? text : "",
  };
}

export function defaultJudgeMatchers(): JudgeMatcher[] {
  return [
    {
      id: "m-pass",
      port: "pass",
      kind: "regex",
      pattern: "\\b(pass|ok|success|yes)\\b",
    },
    {
      id: "m-fail",
      port: "fail",
      kind: "regex",
      pattern: "\\b(fail|error|no)\\b",
    },
  ];
}
