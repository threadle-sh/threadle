import type { Graph, GraphEdge, NodeType } from "./graph.js";
import { expandFrameEdges, frameBoundaryWarnings } from "./frames.js";
import { EMITS_TEXT, REQUIRES_INPUT } from "./nodes/index.js";
import { agentErrWired } from "./agent-ports.js";
import { structuralEdges } from "./until.js";

/** Pre-run / pre-detached issue on a workflow graph. */
export interface WorkflowIssue {
  kind:
    | "wiring"
    | "model"
    | "context"
    | "artifact"
    | "agent"
    | "live-handoff"
    | "custom"
    | "frame";
  nodeId: string;
  label: string;
  message: string;
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
  if (d.type === "wait-idle") return d.label || "wait for idle";
  if (d.type === "prompt") return d.label || "prompt";
  if (d.type === "skill") return d.label || d.name || "skill";
  if (d.type === "rules") return d.label || d.name || "rules";
  if (d.type === "knot") return d.label || `merge (${d.strategy})`;
  if (d.type === "tripwire") return d.label || `circuit breaker (${d.mode})`;
  if (d.type === "judge") return d.label || "judge";
  if (d.type === "iterator") {
    const mode = d.mode === "parallel" ? "parallel" : "serial";
    return d.label || `iterator (${mode})`;
  }
  if (d.type === "until") {
    const n = d.maxIterations ?? 3;
    return d.label || `until (×${n})`;
  }
  if (d.type === "delay") {
    const sec = Math.round((d.ms ?? 0) / 1000);
    return d.label || `delay (${sec}s)`;
  }
  if (d.type === "data") {
    return d.label || `data (${d.valueType ?? "text"})`;
  }
  return d.type;
}

function hasSessionInbound(
  g: Graph,
  edges: GraphEdge[],
  nodeId: string,
): boolean {
  return edges.some((e) => {
    if (e.target !== nodeId) return false;
    const src = g.nodes.find((x) => x.id === e.source);
    const t = src?.data.type;
    // agent-def / live-handoff emit a session at run time
    return (
      t === "session" ||
      t === "subagent-run" ||
      t === "agent-def" ||
      t === "live-handoff"
    );
  });
}

export interface AssessWorkflowOpts {
  /** Effective edges (frame-expanded). Defaults to expandFrameEdges(g). */
  edges?: GraphEdge[];
  /** Partial run scope — only validate these nodes. */
  scope?: Set<string>;
  /**
   * Optional lookup for custom-node required inputs by def name.
   * When omitted, uses snapshot.inputs on the node.
   */
  customInputs?: (
    name: string,
  ) => Array<{ name: string; required?: boolean }> | undefined;
}

/**
 * Preflight: catch missing models, unwired inputs, and
 * unusable context before a run starts.
 */
export function assessWorkflowReadiness(
  g: Graph,
  opts: AssessWorkflowOpts = {},
): WorkflowIssue[] {
  const edges = opts.edges ?? expandFrameEdges(g.nodes, g.edges);
  const scope = opts.scope;
  const issues: WorkflowIssue[] = [];

  for (const n of g.nodes) {
    if (n.muted || n.bypassed) continue;
    if (scope && !scope.has(n.id)) continue;
    const label = nodeLabel(n);
    const t = n.data.type;

    if (t === "agent-def" && !n.data.model?.trim()) {
      issues.push({
        kind: "model",
        nodeId: n.id,
        label,
        message: "model not set — pick one in the inspector",
      });
    }

    if (t === "live-handoff" && !n.data.ref && !hasSessionInbound(g, edges, n.id)) {
      issues.push({
        kind: "live-handoff",
        nodeId: n.id,
        label,
        message: "needs an agent on the node or an inbound session",
      });
    }

    if (t === "context") {
      if (!n.data.payloadHash && !hasSessionInbound(g, edges, n.id)) {
        issues.push({
          kind: "context",
          nodeId: n.id,
          label,
          message: "wire a session source or materialize first",
        });
      }
      continue;
    }

    if ((t === "skill" || t === "rules") && !n.data.path && !n.data.name) {
      issues.push({
        kind: "artifact",
        nodeId: n.id,
        label,
        message: "pick a skill/rules file",
      });
      continue;
    }

    if (t === "mcp-tool") {
      const data = n.data;
      if (!data.ref.server || !data.tool) {
        issues.push({
          kind: "custom",
          nodeId: n.id,
          label,
          message: "MCP server and tool must be selected",
        });
      }
    }

    if (!REQUIRES_INPUT.has(t)) continue;

    const wired = edges.filter((e) => e.target === n.id);
    if (!wired.length) {
      issues.push({
        kind: "wiring",
        nodeId: n.id,
        label,
        message: "required input not wired",
      });
      continue;
    }

    if (t === "custom") {
      const data = n.data;
      const ins = opts.customInputs?.(data.ref.name) ?? data.snapshot?.inputs;
      if (ins?.length) {
        const fed = new Set(
          wired.map((e) =>
            e.targetHandle?.startsWith("in:")
              ? e.targetHandle.slice(3)
              : ins[0]!.name,
          ),
        );
        for (const p of ins) {
          if (p.required !== false && !fed.has(p.name)) {
            issues.push({
              kind: "custom",
              nodeId: n.id,
              label,
              message: `required port "${p.name}" not wired`,
            });
          }
        }
      }
    }
  }

  for (const w of frameBoundaryWarnings(g.nodes, g.edges)) {
    issues.push({
      kind: "frame",
      nodeId: "frame",
      label: "frame",
      message: w,
    });
  }

  return issues;
}

/** Always-on graph hygiene (Graph lint). */
export type LooseEndKind =
  | "dangling"
  | "unwired"
  | "unreachable"
  | "unused-param"
  | "muted"
  | "hint";

export interface LooseEnd {
  kind: LooseEndKind;
  nodeId?: string;
  label: string;
  message: string;
}

/**
 * Soft lints for the canvas — dangling outputs, unused params, muted nodes,
 * unreachable nodes, plus the hard wiring issues from assessWorkflowReadiness.
 */
export function assessLooseEnds(g: Graph, opts: AssessWorkflowOpts = {}): LooseEnd[] {
  const edges = opts.edges ?? expandFrameEdges(g.nodes, g.edges);
  const ends: LooseEnd[] = [];

  // hard wiring / model issues → surface as unwired
  for (const i of assessWorkflowReadiness(g, { ...opts, edges })) {
    if (i.kind === "wiring" || i.kind === "custom") {
      ends.push({
        kind: "unwired",
        nodeId: i.nodeId,
        label: i.label,
        message: i.message,
      });
    }
  }

  const reachable = new Set<string>();
  const struct = structuralEdges(edges);
  const incoming = new Map<string, number>(g.nodes.map((n) => [n.id, 0]));
  for (const e of struct) incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  const queue = g.nodes.filter((n) => !incoming.get(n.id)).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const e of struct) {
      if (e.source !== id) continue;
      const left = (incoming.get(e.target) ?? 0) - 1;
      incoming.set(e.target, left);
      if (left <= 0) queue.push(e.target);
    }
  }

  for (const n of g.nodes) {
    if (n.data.type === "note" || n.data.type === "group") continue;
    const label = nodeLabel(n);

    if (n.muted) {
      ends.push({
        kind: "muted",
        nodeId: n.id,
        label,
        message: "muted — skipped on run",
      });
    }

    if (!reachable.has(n.id)) {
      ends.push({
        kind: "unreachable",
        nodeId: n.id,
        label,
        message: "unreachable (cycle or disconnected from sources)",
      });
    }

    if (
      !n.muted &&
      EMITS_TEXT.has(n.data.type) &&
      n.data.type !== "output" &&
      !edges.some((e) => e.source === n.id)
    ) {
      ends.push({
        kind: "dangling",
        nodeId: n.id,
        label,
        message: "no outbound wire — output is dropped",
      });
    }

    if (!n.muted && n.data.type === "judge") {
      const hasFailMatcher = (n.data.matchers ?? []).some(
        (m) => m.port === "fail" && !!m.pattern?.trim(),
      );
      const hasFailOut = edges.some(
        (e) => e.source === n.id && e.sourceHandle === "out:fail",
      );
      if (hasFailMatcher && !hasFailOut) {
        ends.push({
          kind: "hint",
          nodeId: n.id,
          label,
          message: "fail matchers set but out:fail is unwired",
        });
      }
    }

    if (
      !n.muted &&
      n.data.type === "agent-def" &&
      n.continueOnError &&
      !agentErrWired(edges, n.id)
    ) {
      ends.push({
        kind: "hint",
        nodeId: n.id,
        label,
        message:
          "on error: continue starves the happy path — wire out:err for a fallback arm",
      });
    }

    if (!n.muted && n.data.type === "until") {
      const hasReenter = edges.some(
        (e) => e.source === n.id && (e.sourceHandle === "out:reenter" || e.sourceHandle === "reenter"),
      );
      if (!hasReenter) {
        ends.push({
          kind: "hint",
          nodeId: n.id,
          label,
          message: "out:reenter unwired — Until needs a back-edge into the loop body",
        });
      }
      const hasBreaker =
        g.settings?.spendTripwireUsd != null ||
        g.nodes.some((x) => !x.muted && x.data.type === "tripwire");
      if (!hasBreaker) {
        ends.push({
          kind: "hint",
          nodeId: n.id,
          label,
          message:
            "Until without a spend ceiling or circuit breaker — add one before unattended runs",
        });
      }
    }

    if (!n.muted && n.data.type === "wait-idle" && !hasSessionInbound(g, edges, n.id)) {
      ends.push({
        kind: "hint",
        nodeId: n.id,
        label,
        message: "no inbound session — wire a session (or agent that emits one)",
      });
    }

    if (!n.muted && n.data.type === "iterator" && n.data.mode === "parallel") {
      const knotReachable = g.nodes.some((x) => {
        if (x.muted || x.data.type !== "knot") return false;
        const seen = new Set<string>();
        const q = [n.id];
        while (q.length) {
          const id = q.shift()!;
          if (seen.has(id)) continue;
          seen.add(id);
          if (id === x.id) return true;
          for (const e of edges) {
            if (e.source === id) q.push(e.target);
          }
        }
        return false;
      });
      if (!knotReachable) {
        ends.push({
          kind: "hint",
          nodeId: n.id,
          label,
          message:
            "parallel iterator without a Merge downstream — add ⋈ to join independent answers",
        });
      }
    }
  }

  for (const p of g.params ?? []) {
    const needle = `{{param:${p.name}}}`;
    const used = g.nodes.some((n) => {
      const d = n.data;
      if (d.type === "prompt") return d.text.includes(needle);
      if (d.type === "prompt-convert") return d.template.includes(needle);
      return false;
    });
    if (!used) {
      ends.push({
        kind: "unused-param",
        label: p.name,
        message: `parameter never referenced as ${needle}`,
      });
    }
  }

  return ends;
}

/**
 * Wipe captured values on Data / Output nodes that are fed by a wire
 * (someone's output connector). Constant Data cards with no inbound stay put.
 * Returns true if anything changed.
 */
export function clearWiredSinkNodes(g: Graph, scope?: Set<string>): boolean {
  const fed = new Set(
    expandFrameEdges(g.nodes, g.edges)
      .filter((e) => e.data?.role !== "child")
      .map((e) => e.target),
  );
  let changed = false;
  for (const n of g.nodes) {
    if (scope && !scope.has(n.id)) continue;
    if (!fed.has(n.id)) continue;
    if (n.data.type === "output") {
      if (n.data.content !== undefined || n.data.preview !== undefined) {
        n.data.content = undefined;
        n.data.preview = undefined;
        changed = true;
      }
    } else if (n.data.type === "data") {
      if (n.data.value !== undefined) {
        n.data.value = undefined;
        changed = true;
      }
    }
  }
  return changed;
}
