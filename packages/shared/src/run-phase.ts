/** Coarse live phase for pilot / canvas while an agent job is running. */
export type RunPhase =
  | "starting"
  | "thinking"
  | "tool"
  | "answering"
  | "extra"
  | "done"
  | "error";

export interface RunPhaseLog {
  lane: string;
  line: string;
}

export interface DerivedRunPhase {
  phase: RunPhase;
  /** Short UI label, e.g. `tool · Read` */
  label: string;
}

const PHASE_LABEL: Record<RunPhase, string> = {
  starting: "starting",
  thinking: "thinking",
  tool: "tool",
  answering: "answering",
  extra: "extra",
  done: "done",
  error: "error",
};

function toolLabel(line: string): string {
  // Prefer `name` from `name: detail` (toolSummary); else first token.
  const colon = line.indexOf(":");
  const name =
    colon > 0
      ? line.slice(0, colon).trim()
      : line.trim().split(/\s/)[0]?.trim() || line.trim();
  const short = name.length > 28 ? `${name.slice(0, 28)}…` : name;
  return short ? `tool · ${short}` : "tool";
}

function classifyLine(lane: string, line: string): RunPhase | undefined {
  const text = line.trim();
  const lower = text.toLowerCase();

  if (lane === "raw") {
    if (/^✗|error|fail|traceback|exception/i.test(text)) return "error";
    return undefined;
  }

  if (lane === "meta") {
    if (/^■/.test(text) || /\b■\b/.test(text)) return "done";
    if (/^✗|error|fail/i.test(text)) return "error";
    if (/spawn |extras |harness extras|⊘ |reminders /i.test(text)) return "extra";
    if (/first answer|run started|lifecycle|model |opening |configured/i.test(text)) {
      return "starting";
    }
    return undefined;
  }

  if (lane === "thinking") return "thinking";
  if (lane === "tool") return "tool";
  if (lane === "text") return "answering";

  // Unknown lanes: treat as answering if it looks like content.
  if (text && !lower.startsWith("▶")) return "answering";
  return undefined;
}

/**
 * Derive the current run phase from the latest meaningful job.log lines.
 * Prefers the most recent classifiable lane; falls back to `starting`.
 */
export function deriveRunPhase(logs: readonly RunPhaseLog[]): DerivedRunPhase {
  if (!logs.length) {
    return { phase: "starting", label: PHASE_LABEL.starting };
  }

  for (let i = logs.length - 1; i >= 0; i--) {
    const { lane, line } = logs[i]!;
    const phase = classifyLine(lane, line);
    if (!phase) continue;
    if (phase === "tool") {
      return { phase, label: toolLabel(line) };
    }
    return { phase, label: PHASE_LABEL[phase] };
  }

  return { phase: "starting", label: PHASE_LABEL.starting };
}
