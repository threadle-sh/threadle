import type { Graph } from "./graph.js";
import { assessWorkflowReadiness } from "./workflow.js";

/** Issue found before a detached (≫) workflow run. */
export interface DetachedIssue {
  kind:
    | "approval"
    | "live-handoff"
    | "context"
    | "frame"
    | "artifact"
    | "model"
    | "wiring"
    | "agent"
    | "custom";
  nodeId: string;
  label: string;
  /** true → refuse to start until fixed; false → needs explicit confirm */
  blocking: boolean;
  message?: string;
}

function nodeLabel(n: Graph["nodes"][number]): string {
  const d = n.data;
  if (d.type === "agent-def") return d.label || d.ref.name;
  if (d.type === "custom") return d.label || d.ref.name;
  if (d.type === "mcp-tool") return d.label || d.tool || d.ref.server || "mcp-tool";
  if (d.type === "session") return d.label || d.snapshot?.title || d.ref.sessionId.slice(0, 8);
  if (d.type === "context") return d.label || d.kind || "context";
  if (d.type === "approval") return d.label || "approval gate";
  if (d.type === "live-handoff") return d.label || d.ref?.name || "live handoff";
  if (d.type === "prompt") return d.label || "prompt";
  if (d.type === "skill") return d.label || d.name || "skill";
  if (d.type === "rules") return d.label || d.name || "rules";
  return d.type;
}

/**
 * Preflight for headless runs: structural readiness + interactive gates that
 * need an explicit approve-all confirm.
 */
export function assessDetachedReadiness(g: Graph): DetachedIssue[] {
  const issues: DetachedIssue[] = [];

  for (const w of assessWorkflowReadiness(g)) {
    if (w.kind === "frame") {
      issues.push({
        kind: "frame",
        nodeId: w.nodeId,
        label: w.message,
        blocking: true,
        message: w.message,
      });
      continue;
    }
    const kind: DetachedIssue["kind"] =
      w.kind === "model"
        ? "model"
        : w.kind === "wiring"
          ? "wiring"
          : w.kind === "custom"
            ? "custom"
            : w.kind === "live-handoff"
              ? "live-handoff"
              : w.kind === "artifact"
                ? "artifact"
                : w.kind === "context"
                  ? "context"
                  : "agent";
    issues.push({
      kind,
      nodeId: w.nodeId,
      label: w.label,
      blocking: true,
      message: w.message,
    });
  }

  for (const n of g.nodes) {
    if (n.muted || n.bypassed) continue;
    if (n.data.type === "approval") {
      issues.push({
        kind: "approval",
        nodeId: n.id,
        label: nodeLabel(n),
        blocking: false,
      });
    } else if (n.data.type === "live-handoff") {
      const structural = issues.some(
        (i) => i.nodeId === n.id && i.blocking && (i.kind === "live-handoff" || i.kind === "model"),
      );
      if (!structural) {
        issues.push({
          kind: "live-handoff",
          nodeId: n.id,
          label: nodeLabel(n),
          blocking: false,
        });
      }
    }
    // Unmaterialized context is fine when a session source is wired —
    // the executor extract/distill/files mid-run (same as canvas ▶).
  }

  return issues;
}

/** Keep only issues on nodes in `scope` (plus graph-level `frame`). */
export function filterDetachedIssuesForScope(
  issues: DetachedIssue[],
  scope?: Iterable<string>,
): DetachedIssue[] {
  if (!scope) return issues;
  const ids = scope instanceof Set ? scope : new Set(scope);
  if (!ids.size) return issues;
  return issues.filter((i) => i.nodeId === "frame" || ids.has(i.nodeId));
}
