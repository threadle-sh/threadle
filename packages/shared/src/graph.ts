import { z } from "zod";
import type { ProviderId, SessionRef } from "./session.js";
import type { ContextConfig, ContextKind } from "./context.js";
import type { KnotStrategy } from "./knot.js";
import type { TripwireAction, TripwireMode } from "./tripwire.js";
import type {
  JudgeMatcher,
  JudgePort,
  JudgeUnmatchedAction,
} from "./judge.js";
import {
  JUDGE_PORTS,
} from "./judge.js";
import { isAgentErrHandle } from "./agent-ports.js";
import {
  BUILTIN_PORT_LIMITS,
  FORBIDDEN_TEXT_PAIRS,
  STRUCTURAL_CONNECTIONS,
  TEXT_SINKS,
  TEXT_SOURCES,
} from "./nodes/index.js";
import { PORT_UNLIMITED } from "./nodes/definition.js";
export type { KnotStrategy } from "./knot.js";
export type { TripwireAction, TripwireMode } from "./tripwire.js";
export type {
  JudgeMatcher,
  JudgeMatcherKind,
  JudgePort,
  JudgeUnmatchedAction,
  JudgeConfig,
  JudgeEvalResult,
} from "./judge.js";
export { PORT_UNLIMITED };

export type NodeType =
  | "agent-def"
  | "session"
  | "subagent-run"
  | "context"
  | "prompt"
  | "output"
  | "prompt-convert"
  | "delay"
  | "data"
  | "approval"
  | "live-handoff"
  | "wait-idle"
  | "iterator"
  | "knot"
  | "tripwire"
  | "judge"
  | "until"
  | "group"
  | "note"
  | "custom"
  | "mcp-tool"
  | "skill"
  | "rules";
export type NodeStatus = "idle" | "queued" | "running" | "success" | "error";

export interface AgentDefNodeData {
  type: "agent-def";
  ref: { provider: ProviderId; name: string; source: string };
  /** model override used when this agent is run (e.g. "opencode/claude-sonnet-5" or "sonnet") */
  model?: string;
  /** canvas title override — recipes use this for roles ("correctness", …) */
  label?: string;
  /** Claude Code: default | acceptEdits | plan | bypassPermissions | … */
  permissionMode?: string;
  /** Codex: read-only | workspace-write | danger-full-access */
  sandbox?: string;
  /** Codex: ask-for-approval mode (e.g. never | on-request | on-failure) */
  askForApproval?: string;
  /**
   * Post-answer harness extras (Muse reminders, Claude hooks/slash skills,
   * Grok subagents, Antigravity slash). When set, overrides Settings
   * `harnessExtras` for this node. Omit to inherit.
   */
  harnessExtras?: boolean;
  /** @deprecated use harnessExtras */
  museReminders?: boolean;
  /**
   * Skip project AGENTS.md / CLAUDE.md / rules — run in an empty bare
   * workspace (+ provider skip flags). Default off (use real project).
   */
  ignoreLocalMarkdown?: boolean;
}

/** Value types flowing along text lanes */
export type ValueType = "text" | "int" | "float" | "bool" | "json";
export const VALUE_TYPES: readonly ValueType[] = ["text", "int", "float", "bool", "json"];

/** Friendly labels for the Data node / prompt type picker */
export const VALUE_TYPE_LABELS: Record<ValueType, string> = {
  text: "string",
  int: "int",
  float: "float",
  bool: "bool",
  json: "json",
};

/** may `from` feed `to`? text accepts anything; int widens to float */
export function valueTypeCompatible(from: ValueType, to: ValueType): boolean {
  if (from === to || to === "text") return true;
  if (from === "int" && to === "float") return true;
  return false;
}

/**
 * Rank for assembling multi-wire agent prompts — lower comes first.
 * Plain Prompt nodes lead, then Text→Prompt converters, then everything else
 * (output, merge, data, …) so an instruction wire stays ahead of context.
 */
export function agentPromptSourceRank(type: NodeType | string | undefined): number {
  if (type === "prompt") return 0;
  if (type === "prompt-convert") return 1;
  return 2;
}

/** Join inbound agent texts with Prompt / Text→Prompt wires first. */
export function joinAgentPromptTexts(
  parts: Array<{ sourceType?: NodeType | string; text?: string }>,
): string {
  return [...parts]
    .sort(
      (a, b) => agentPromptSourceRank(a.sourceType) - agentPromptSourceRank(b.sourceType),
    )
    .map((p) => p.text)
    .filter((t): t is string => !!t)
    .join("\n\n---\n\n");
}

/** parse `text` as `t`; returns an error string or undefined when it conforms */
export function valueTypeError(text: string, t: ValueType): string | undefined {
  const coerced = coerceValue(text, t);
  return "error" in coerced ? coerced.error : undefined;
}

function unwrapJsonFence(text: string): string | undefined {
  const m = text.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/);
  return m ? m[1]!.trim() : undefined;
}

/**
 * Normalize inbound text to a ValueType for the Data node (and similar).
 * Returns a canonical string form, or `{ error }`.
 */
export function coerceValue(
  text: string,
  t: ValueType,
): { value: string } | { error: string } {
  const raw = text.trim();
  switch (t) {
    case "text":
      return { value: text };
    case "int":
      if (!/^[+-]?\d+$/.test(raw)) return { error: `not an int: "${raw.slice(0, 40)}"` };
      return { value: raw };
    case "float": {
      const n = Number(raw);
      if (raw === "" || !Number.isFinite(n)) {
        return { error: `not a float: "${raw.slice(0, 40)}"` };
      }
      return { value: String(n) };
    }
    case "bool": {
      const v = raw.toLowerCase();
      if (v === "true" || v === "1") return { value: "true" };
      if (v === "false" || v === "0") return { value: "false" };
      return { error: `not a bool (true/false/1/0): "${raw.slice(0, 40)}"` };
    }
    case "json": {
      const candidate = unwrapJsonFence(raw) ?? raw;
      try {
        return { value: JSON.stringify(JSON.parse(candidate)) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { error: `not valid JSON: ${msg}` };
      }
    }
  }
}

export interface PromptNodeData {
  type: "prompt";
  text: string;
  label?: string;
  /** the type this prompt emits (default text) */
  valueType?: ValueType;
}

/** How a skill node contributes at run time. */
export type SkillRunMode = "inject" | "invoke";

/** Default CLI for skill invoke when `provider` is omitted. */
export const DEFAULT_SKILL_INVOKE_PROVIDER: ProviderId = "claude-code";

/** Injects a SKILL.md into the text lane, or invokes it via a provider CLI. */
export interface SkillNodeData {
  type: "skill";
  /**
   * Absolute path to SKILL.md when known. Portable graphs may leave this empty
   * and resolve by `name` (+ optional `origin`/`source`) on import/run.
   */
  path?: string;
  name: string;
  source?: string;
  description?: string;
  origin?: "project" | "custom" | "imported" | "global";
  /** false when disable-model-invocation is set (snapshot / live after toggle) */
  autoInvoke?: boolean;
  /**
   * `inject` (default) — paste SKILL.md onto the text lane.
   * `invoke` — run the chosen provider with prompt `/{name}` (+ optional inbound text).
   */
  mode?: SkillRunMode;
  /**
   * Provider used for invoke mode (default Claude). Ignored for inject.
   * Slash-skills are native on Claude + Cursor; other CLIs get the same prompt.
   */
  provider?: ProviderId;
  /** Optional model override for invoke mode. */
  model?: string;
  /** optional canvas title override */
  label?: string;
  /** snapshot at pick time — UI warning only; selected path still injects */
  shadowedBy?: string;
}

export function skillInvokeProvider(data: Pick<SkillNodeData, "provider">): ProviderId {
  return data.provider ?? DEFAULT_SKILL_INVOKE_PROVIDER;
}

/** Injects a rules file (CLAUDE.md, AGENTS.md, .cursor/rules/*, …) into the text lane. */
export interface RulesNodeData {
  type: "rules";
  /** Absolute path when known; portable graphs may resolve by `name` instead. */
  path?: string;
  name: string;
  source?: string;
  label?: string;
}

export type OutputRenderMode = "auto" | "text" | "markdown" | "html" | "svg";

/** Represents the last assistant message of the session wired into it. */
export interface OutputNodeData {
  type: "output";
  /** legacy short snapshot (superseded by content) */
  preview?: string;
  /** full text of the captured message, rendered per renderMode */
  content?: string;
  renderMode?: OutputRenderMode;
  /** persisted node dimensions (the node is resizable) */
  size?: { width: number; height: number };
  /** optional canvas title override */
  label?: string;
}

/** Transforms inbound text into a prompt; "{{input}}" in the template is replaced. */
export interface PromptConvertNodeData {
  type: "prompt-convert";
  template: string;
  /** optional canvas title override */
  label?: string;
}

/** Wall-clock pause on the text lane — agent-free; useful for detached-job demos. */
export interface DelayNodeData {
  type: "delay";
  /** milliseconds to wait (capped at 5 minutes at run time) */
  ms: number;
  label?: string;
}

/**
 * Typed value on the text lane — edit a constant on the card, and/or coerce
 * inbound text to string/int/float/bool/json for the next wire.
 */
export interface DataNodeData {
  type: "data";
  /** emitted (and coerced) value type — default text/string */
  valueType?: ValueType;
  /** literal value typed on the card — used when nothing is wired in */
  value?: string;
  label?: string;
}

export interface SessionNodeData {
  type: "session" | "subagent-run";
  ref: { provider: ProviderId; sessionId: string };
  snapshot?: Partial<Pick<SessionRef, "title" | "agent" | "projectDir">>;
  /** set at load time by the server, not persisted */
  resolved?: boolean;
  /** optional canvas title override */
  label?: string;
}

/** Human-in-the-loop gate: the run pauses here until the text is approved. */
export interface ApprovalNodeData {
  type: "approval";
  label?: string;
}

/**
 * Interactive live handoff: chat with an agent/session until Ready, then
 * distill/excerpt and pass that package downstream (same canvas run).
 */
export interface LiveHandoffNodeData {
  type: "live-handoff";
  label?: string;
  /** Agent to chat with when no inbound session is wired. */
  ref?: { provider: ProviderId; name: string; source: string };
  model?: string;
  /** What Ready materializes for the next node (default distilled-summary). */
  handoffKind?: "distilled-summary" | "transcript-excerpt";
}

/** Splits inbound text into items; the downstream agent runs once per item. */
export interface IteratorNodeData {
  type: "iterator";
  splitMode: "lines" | "blocks" | "json";
  maxItems?: number;
  /**
   * `serial` (default): one session, accumulate context across items.
   * `parallel`: fresh session per item, concurrency bounded by graph ply;
   * pair with a Merge downstream when joining independent answers.
   */
  mode?: "serial" | "parallel";
  /** optional canvas title override */
  label?: string;
}

/**
 * Wait until an inbound session is idle (not running/waiting), then pass through.
 * UI: Wait for idle. On timeout: park / skip / abort.
 */
export interface WaitIdleNodeData {
  type: "wait-idle";
  /** 1s..5m — default 60s */
  timeoutMs?: number;
  onTimeout?: "park" | "skip" | "abort";
  label?: string;
}

/**
 * Explicit merge of multiple inbound text wires (fan-in).
 * `synthesize` builds a merge prompt; pair with an agent/model on the node
 * for an LLM join, otherwise the labeled candidates pass through.
 */
export interface KnotNodeData {
  type: "knot";
  strategy: KnotStrategy;
  /** concat separator (default blank-line ---) */
  separator?: string;
  label?: string;
  /** synthesize only — run a one-shot agent to produce the merge */
  provider?: ProviderId;
  model?: string;
  agent?: string;
}

/**
 * Automatic circuit breaker on a wire (`type: "tripwire"` in graph JSON).
 * Graph-level spendTripwireUsd remains the whole-run ceiling; this node gates a single path.
 */
export interface TripwireNodeData {
  type: "tripwire";
  mode: TripwireMode;
  action: TripwireAction;
  label?: string;
  thresholdUsd?: number;
  thresholdTokens?: number;
  thresholdMs?: number;
  minChars?: number;
  pattern?: string;
  tripOnMatch?: boolean;
  thresholdRetries?: number;
}

/**
 * Labeled multi-out branch on inbound text (`type: "judge"`).
 * UI label: Judge. Out handles: `out:pass` / `out:fail` / `out:unsure`.
 * First matcher wins; unmatched → unsure emit or park.
 * v1 matchers: regex + contains only (no expression language, no LLM).
 * Cycles (fail→fix→back) are not supported — keep fix as a linear arm,
 * or use an Until node for counted re-entry.
 */
export interface JudgeNodeData {
  type: "judge";
  matchers: JudgeMatcher[];
  unmatched: JudgeUnmatchedAction;
  portLabels?: Partial<Record<JudgePort, string>>;
  label?: string;
}

/**
 * Counted re-entry of a subgraph (`type: "until"`).
 * UI label: Until. Out handles: `out:reenter` / `out:exhausted`.
 * Reenter edges are ignored by topo (graph stays a DAG). Hard max iterations
 * (default 3, cap 8). Prefer pairing with a spend ceiling or circuit breaker.
 */
export interface UntilNodeData {
  type: "until";
  /** 1..8 — default 3 */
  maxIterations?: number;
  label?: string;
}

/** Visual frame: groups nodes spatially, never executes. */
export interface GroupNodeData {
  type: "group";
  label: string;
  color?: string;
  size: { width: number; height: number };
  /** saved sub-workflow this frame was extracted to (double-click opens it) */
  graphId?: string;
  /** collapsed: members hidden, frame renders as a compact bar */
  collapsed?: boolean;
}

export interface ContextNodeData {
  type: "context";
  kind: ContextKind;
  payloadHash?: string;
  config: ContextConfig;
  label?: string;
}

/** A named port a custom node declares in its manifest ("inputs"/"outputs"). */
export interface CustomPortDef {
  name: string;
  type: ValueType;
  /** inputs only — an unwired required port blocks the run (default true) */
  required?: boolean;
  /**
   * Max edges on this port (default 1). Use a higher number for fan-in/fan-out
   * ports; omit or 1 for single-wire slots.
   */
  maxConnections?: number;
}

/** widget kinds a custom node param can declare — the ValueTypes plus an options dropdown */
export type ParamType = ValueType | "choice";
export const PARAM_TYPES: readonly ParamType[] = [...VALUE_TYPES, "choice"];

/** An inspector-editable param a custom node declares in its manifest ("params"). */
export interface CustomParamDef {
  name: string;
  type: ParamType;
  label?: string;
  description?: string;
  /** always carried as a string, like workflow params; validated against `type` */
  default?: string;
  /** choice only: the allowed values */
  options?: string[];
  /** int/float only */
  min?: number;
  max?: number;
  /** text only: render a textarea instead of a one-line input */
  multiline?: boolean;
}

/** edge handle ids for named custom-node ports */
export const inHandle = (port: string): string => `in:${port}`;
export const outHandle = (port: string): string => `out:${port}`;
/** the port name behind a handle id, if it is a named-port handle */
export function handlePort(handle: string | null | undefined): string | undefined {
  if (!handle) return undefined;
  if (handle.startsWith("in:")) return handle.slice(3);
  if (handle.startsWith("out:")) return handle.slice(4);
  return undefined;
}

/** validate a param value against its declaration; error string when it doesn't conform */
export function paramValueError(value: string, p: CustomParamDef): string | undefined {
  if (p.type === "choice") {
    return p.options?.includes(value)
      ? undefined
      : `"${value.slice(0, 40)}" is not one of ${(p.options ?? []).join(", ")}`;
  }
  const bad = valueTypeError(value, p.type);
  if (bad) return bad;
  if ((p.type === "int" || p.type === "float") && value.trim() !== "") {
    const n = Number(value);
    if (p.min !== undefined && n < p.min) return `${n} is below min ${p.min}`;
    if (p.max !== undefined && n > p.max) return `${n} is above max ${p.max}`;
  }
  return undefined;
}

/**
 * A user-authored node from ~/.config/threadle/nodes/<name>/node.json.
 * Text in, text out: the server runs the manifest's command with the
 * inbound text on stdin and pipes stdout onward. Manifests may declare
 * named ports (inputs/outputs arrays) and inspector-editable params.
 */
export interface CustomNodeData {
  type: "custom";
  ref: { name: string };
  /** user-set param values (name → string); unset params fall back to the manifest defaults */
  params?: Record<string, string>;
  /** optional canvas title override (falls back to manifest / snapshot label) */
  label?: string;
  /** display snapshot so the node stays legible if the manifest vanishes */
  snapshot?: {
    label?: string;
    glyph?: string;
    description?: string;
    input?: ValueType;
    output?: ValueType;
    inputs?: CustomPortDef[];
    outputs?: CustomPortDef[];
  };
}

/**
 * Call one tool on one discovered MCP server (stdio).
 * Inbound text can map onto `argPort` (default first string-like arg).
 */
export interface McpToolNodeData {
  type: "mcp-tool";
  ref: { server: string };
  tool: string;
  /** optional display name on the canvas / inspector */
  label?: string;
  params?: Record<string, string>;
  /** inbound text fills this tool argument name when set */
  argPort?: string;
  snapshot?: {
    params?: CustomParamDef[];
    inputs?: CustomPortDef[];
    outputs?: CustomPortDef[];
    toolDescription?: string;
    serverLabel?: string;
  };
}

/** Free markdown sticky for annotating a workflow. Never executes, never wires. */
export interface NoteNodeData {
  type: "note";
  text: string;
  color?: string;
  size?: { width: number; height: number };
}

export type GraphNodeData =
  | NoteNodeData
  | CustomNodeData
  | McpToolNodeData
  | AgentDefNodeData
  | SessionNodeData
  | ContextNodeData
  | PromptNodeData
  | SkillNodeData
  | RulesNodeData
  | OutputNodeData
  | PromptConvertNodeData
  | DelayNodeData
  | DataNodeData
  | ApprovalNodeData
  | LiveHandoffNodeData
  | WaitIdleNodeData
  | IteratorNodeData
  | KnotNodeData
  | TripwireNodeData
  | JudgeNodeData
  | UntilNodeData
  | GroupNodeData;

export interface GraphNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  status: NodeStatus;
  lastRunId?: string;
  /** Wall-clock ms for the last completed run of this node (runtime-only). */
  lastDurationMs?: number;
  data: GraphNodeData;
  /** member of a linked sub-workflow frame (frame node id) */
  subOf?: string;
  /** id of the corresponding node in the linked sub-workflow */
  originId?: string;
  /** the runner skips this node entirely */
  muted?: boolean;
  /** the runner passes input straight through without executing */
  bypassed?: boolean;
  /** extra attempts after a failure (0 = fail fast) */
  retry?: number;
  /** on final failure: mark the node errored but keep the run alive */
  continueOnError?: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  data?: { role?: "extract" | "inject" | "instantiate" | "child" | "reenter" };
}

/** graph-level input: fills {{param:name}} in prompts and converter templates */
export interface WorkflowParam {
  name: string;
  type: ValueType;
  default?: string;
  description?: string;
}

/** Runner / budget knobs for a workflow (UI: parallelism + spend ceiling). */
export interface GraphSettings {
  /** max concurrent independent nodes (default 4) */
  ply?: number;
  /** abort the run when tracked spend for this run reaches this USD amount */
  spendTripwireUsd?: number;
}

export interface Graph {
  id: string;
  name: string;
  schemaVersion: 1;
  /**
   * workflow = top-level runnable / open-as-tab
   * subgraph = nestable part (linked frames); set on extract
   */
  kind?: "workflow" | "subgraph";
  nodes: GraphNode[];
  edges: GraphEdge[];
  params?: WorkflowParam[];
  settings?: GraphSettings;
  viewport?: { x: number; y: number; zoom: number };
  createdAt: number;
  updatedAt: number;
  /** Set on untrusted imports; see graphSchema comment. */
  origin?: "imported";
  /** Set by the explicit confirm-import flow; absent = first run refused. */
  confirmedAt?: number;
}

/** Effective graph kind — missing/legacy files count as workflows. */
export function graphKind(g: { kind?: "workflow" | "subgraph" | null }): "workflow" | "subgraph" {
  return g.kind === "subgraph" ? "subgraph" : "workflow";
}

/** replace {{param:name}} placeholders; unknown params are left visible */
export function substituteParams(
  text: string,
  values: Record<string, string> | undefined,
): string {
  if (!values) return text;
  return text.replace(/\{\{param:([a-zA-Z0-9_-]+)\}\}/g, (m, name: string) =>
    name in values ? values[name]! : m,
  );
}

export interface GraphSummary {
  id: string;
  name: string;
  kind: "workflow" | "subgraph";
  nodeCount: number;
  edgeCount: number;
  updatedAt: number;
  createdAt: number;
  /** imported JSON whose execution manifest has not been confirmed yet */
  unconfirmedImport?: boolean;
  /** how many other graphs link a frame to this id (0 = unused as subgraph) */
  usedBy?: number;
}

/**
 * Text-lane producers / consumers, structural pairs, and port limits are
 * derived from `NodeDefinition` — see `./nodes/`.
 */

function pairKey(s: NodeType, t: NodeType): string {
  return `${s}>${t}`;
}

function buildValidConnections(): ReadonlyArray<[NodeType, NodeType]> {
  const seen = new Set<string>();
  const out: [NodeType, NodeType][] = [];
  const add = (s: NodeType, t: NodeType): void => {
    const k = pairKey(s, t);
    if (seen.has(k) || FORBIDDEN_TEXT_PAIRS.has(k)) return;
    seen.add(k);
    out.push([s, t]);
  };
  for (const [s, t] of STRUCTURAL_CONNECTIONS) add(s, t);
  for (const s of TEXT_SOURCES) {
    for (const t of TEXT_SINKS) add(s, t);
  }
  return out;
}

/** Which node-type pairs may be connected (source → target). */
export const VALID_CONNECTIONS: ReadonlyArray<[NodeType, NodeType]> =
  buildValidConnections();

export function isValidConnection(source: NodeType, target: NodeType): boolean {
  return VALID_CONNECTIONS.some(([s, t]) => s === source && t === target);
}

export interface PortCapacityLookup {
  /** custom-node named ports for a graph node id (from live def or snapshot) */
  customPorts?: (nodeId: string) => {
    inputs?: CustomPortDef[];
    outputs?: CustomPortDef[];
  } | undefined;
}

/**
 * Max edges allowed on a node's handle. Named custom ports default to 1;
 * set `maxConnections` in the manifest to raise (or leave default).
 */
export function handleMaxConnections(
  type: NodeType,
  side: "source" | "target",
  handleId?: string | null,
  ports?: { inputs?: CustomPortDef[]; outputs?: CustomPortDef[] },
): number {
  if (handleId === "sub") return PORT_UNLIMITED;

  if (type === "custom" && handleId) {
    if (handleId.startsWith("in:") && side === "target") {
      const name = handleId.slice(3);
      const p = ports?.inputs?.find((x) => x.name === name);
      return Math.max(1, p?.maxConnections ?? 1);
    }
    if (handleId.startsWith("out:") && side === "source") {
      const name = handleId.slice(4);
      const p = ports?.outputs?.find((x) => x.name === name);
      return Math.max(1, p?.maxConnections ?? 1);
    }
  }

  // Judge: each labeled out is a single-capacity port
  if (type === "judge" && side === "source" && handleId?.startsWith("out:")) {
    const name = handleId.slice(4);
    if ((JUDGE_PORTS as readonly string[]).includes(name)) return 1;
  }

  // Agent: optional error branch is single-capacity
  if (type === "agent-def" && side === "source" && isAgentErrHandle(handleId)) {
    return 1;
  }

  // Until: each labeled out is single-capacity
  if (type === "until" && side === "source" && handleId?.startsWith("out:")) {
    const name = handleId.slice(4);
    if (name === "reenter" || name === "exhausted") return 1;
  }

  const limits = BUILTIN_PORT_LIMITS[type] ?? { in: 1, out: 1 };
  return side === "target" ? limits.in : limits.out;
}

export interface EdgeRef {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

function sameHandle(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return (a ?? null) === (b ?? null);
}

/** Count edges already attached to a handle (optionally ignoring one edge id). */
export function countHandleEdges(
  edges: readonly EdgeRef[],
  nodeId: string,
  side: "source" | "target",
  handleId?: string | null,
  ignoreEdgeId?: string,
): number {
  let n = 0;
  for (const e of edges) {
    if (ignoreEdgeId && e.id === ignoreEdgeId) continue;
    if (side === "source") {
      if (e.source === nodeId && sameHandle(e.sourceHandle, handleId)) n += 1;
    } else if (e.target === nodeId && sameHandle(e.targetHandle, handleId)) {
      n += 1;
    }
  }
  return n;
}

/**
 * True when both ends of `conn` still have a free slot (no displace).
 * Pass `ignoreEdgeId` when reconnecting an existing wire.
 * The canvas uses {@link edgesDisplacedByConnection} instead —
 * full single-capacity ports replace existing wires rather than refusing.
 */
export function connectionWithinCapacity(
  edges: readonly EdgeRef[],
  conn: {
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  },
  nodeTypeOf: (id: string) => NodeType | undefined,
  opts?: PortCapacityLookup & { ignoreEdgeId?: string },
): boolean {
  const sType = nodeTypeOf(conn.source);
  const tType = nodeTypeOf(conn.target);
  if (!sType || !tType) return false;

  const sPorts = opts?.customPorts?.(conn.source);
  const tPorts = opts?.customPorts?.(conn.target);
  const sMax = handleMaxConnections(sType, "source", conn.sourceHandle, sPorts);
  const tMax = handleMaxConnections(tType, "target", conn.targetHandle, tPorts);
  if (
    countHandleEdges(edges, conn.source, "source", conn.sourceHandle, opts?.ignoreEdgeId) >=
    sMax
  ) {
    return false;
  }
  if (
    countHandleEdges(edges, conn.target, "target", conn.targetHandle, opts?.ignoreEdgeId) >=
    tMax
  ) {
    return false;
  }
  return true;
}

/**
 * Edge ids to remove so `conn` can attach (replace-when-full).
 * Unlimited handles never displace. On a finite port at capacity, drops the
 * oldest edges on that handle until one slot is free for `conn`.
 */
export function edgesDisplacedByConnection(
  edges: readonly EdgeRef[],
  conn: {
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  },
  nodeTypeOf: (id: string) => NodeType | undefined,
  opts?: PortCapacityLookup & { ignoreEdgeId?: string },
): string[] {
  const sType = nodeTypeOf(conn.source);
  const tType = nodeTypeOf(conn.target);
  if (!sType || !tType) return [];

  const skip = new Set<string>();
  if (opts?.ignoreEdgeId) skip.add(opts.ignoreEdgeId);
  const out: string[] = [];

  function displaceSide(
    nodeId: string,
    side: "source" | "target",
    handleId: string | null | undefined,
    max: number,
  ): void {
    if (!Number.isFinite(max)) return;
    const attached: EdgeRef[] = [];
    for (const e of edges) {
      if (e.id && skip.has(e.id)) continue;
      if (side === "source") {
        if (e.source === nodeId && sameHandle(e.sourceHandle, handleId)) attached.push(e);
      } else if (e.target === nodeId && sameHandle(e.targetHandle, handleId)) {
        attached.push(e);
      }
    }
    const need = attached.length + 1 - max;
    if (need <= 0) return;
    for (let i = 0; i < need; i++) {
      const id = attached[i]?.id;
      if (!id) continue;
      out.push(id);
      skip.add(id);
    }
  }

  const sPorts = opts?.customPorts?.(conn.source);
  const tPorts = opts?.customPorts?.(conn.target);
  displaceSide(
    conn.source,
    "source",
    conn.sourceHandle,
    handleMaxConnections(sType, "source", conn.sourceHandle, sPorts),
  );
  displaceSide(
    conn.target,
    "target",
    conn.targetHandle,
    handleMaxConnections(tType, "target", conn.targetHandle, tPorts),
  );
  return out;
}

/** The kind of value flowing along an edge — used to color-code lanes on the canvas. */
export type EdgeLane = "text" | "session" | "context";

export function edgeLane(source: NodeType, target: NodeType): EdgeLane {
  if (source === "context" || target === "context") return "context";
  if (source === "session" || source === "subagent-run") return "session";
  // agent → session carries the run's session ref; agent → anything else carries its reply text
  if (source === "agent-def" && target === "session") return "session";
  return "text";
}

// ---- zod schemas for persistence validation ----

const positionSchema = z.object({ x: z.number(), y: z.number() });

const customPortSchema = z.object({
  name: z.string(),
  type: z.enum(["text", "int", "float", "bool", "json"]),
  required: z.boolean().optional(),
  maxConnections: z.number().int().positive().max(64).optional(),
});

const customParamSchema = z.object({
  name: z.string(),
  type: z.enum(["text", "int", "float", "bool", "json", "choice"]),
  label: z.string().optional(),
  description: z.string().optional(),
  default: z.string().optional(),
  options: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  multiline: z.boolean().optional(),
});

const nodeDataSchema = z.union([
  z.object({
    type: z.literal("agent-def"),
    ref: z.object({ provider: z.string(), name: z.string(), source: z.string() }),
    model: z.string().optional(),
    label: z.string().optional(),
    // Enums, not free strings: these flow verbatim into agent CLI argv
    // (--permission-mode / --sandbox / --ask-for-approval), and graphs are
    // imported JSON — an unconstrained value here would let a shared workflow
    // choose its own privilege level via arbitrary flag values.
    permissionMode: z
      .enum(["default", "acceptEdits", "plan", "bypassPermissions"])
      .or(z.literal(""))
      .optional(),
    sandbox: z
      .enum(["read-only", "workspace-write", "danger-full-access"])
      .or(z.literal(""))
      .optional(),
    askForApproval: z
      .enum(["never", "on-request", "on-failure", "untrusted"])
      .or(z.literal(""))
      .optional(),
    /** Post-answer extras; omit = inherit Settings. Legacy: museReminders. */
    harnessExtras: z.boolean().optional(),
    museReminders: z.boolean().optional(),
    /** Skip project AGENTS.md / CLAUDE.md / rules (bare workspace). */
    ignoreLocalMarkdown: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("prompt"),
    text: z.string(),
    label: z.string().optional(),
    valueType: z.enum(["text", "int", "float", "bool", "json"]).optional(),
  }),
  z.object({
    type: z.literal("skill"),
    path: z.string().optional().default(""),
    name: z.string(),
    source: z.string().optional(),
    description: z.string().optional(),
    origin: z.enum(["project", "custom", "imported", "global"]).optional(),
    autoInvoke: z.boolean().optional(),
    mode: z.enum(["inject", "invoke"]).optional(),
    provider: z
      .enum([
        "claude-code",
        "opencode",
        "cursor",
        "antigravity",
        "codex",
        "copilot",
        "grok",
        "muse",
      ])
      .optional(),
    model: z.string().optional(),
    shadowedBy: z.string().optional(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("rules"),
    path: z.string().optional().default(""),
    name: z.string(),
    source: z.string().optional(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("output"),
    preview: z.string().optional(),
    content: z.string().optional(),
    renderMode: z.enum(["auto", "text", "markdown", "html", "svg"]).optional(),
    size: z.object({ width: z.number(), height: z.number() }).optional(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("prompt-convert"),
    template: z.string(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("delay"),
    ms: z.number().int().min(0).max(300_000),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("data"),
    valueType: z.enum(["text", "int", "float", "bool", "json"]).optional(),
    value: z.string().optional(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("approval"),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("live-handoff"),
    label: z.string().optional(),
    ref: z
      .object({ provider: z.string(), name: z.string(), source: z.string() })
      .optional(),
    model: z.string().optional(),
    handoffKind: z.enum(["distilled-summary", "transcript-excerpt"]).optional(),
  }),
  z.object({
    type: z.literal("wait-idle"),
    timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
    onTimeout: z.enum(["park", "skip", "abort"]).optional(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("iterator"),
    splitMode: z.enum(["lines", "blocks", "json"]),
    maxItems: z.number().optional(),
    mode: z.enum(["serial", "parallel"]).optional(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("knot"),
    strategy: z.enum(["concat", "first", "majority", "synthesize"]),
    separator: z.string().optional(),
    label: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    agent: z.string().optional(),
  }),
  z.object({
    type: z.literal("tripwire"),
    mode: z.enum(["spend", "tokens", "duration", "content", "retries"]),
    action: z.enum(["abort", "skip", "park"]),
    label: z.string().optional(),
    thresholdUsd: z.number().positive().optional(),
    thresholdTokens: z.number().int().positive().optional(),
    thresholdMs: z.number().int().positive().optional(),
    minChars: z.number().int().nonnegative().optional(),
    pattern: z.string().optional(),
    tripOnMatch: z.boolean().optional(),
    thresholdRetries: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("judge"),
    matchers: z.array(
      z.object({
        id: z.string(),
        port: z.enum(["pass", "fail"]),
        kind: z.enum(["regex", "contains"]),
        pattern: z.string(),
        caseSensitive: z.boolean().optional(),
      }),
    ),
    unmatched: z.enum(["unsure", "park"]),
    portLabels: z
      .object({
        pass: z.string().optional(),
        fail: z.string().optional(),
        unsure: z.string().optional(),
      })
      .optional(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("until"),
    maxIterations: z.number().int().min(1).max(8).optional(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("group"),
    label: z.string(),
    color: z.string().optional(),
    size: z.object({ width: z.number(), height: z.number() }),
    graphId: z.string().optional(),
    collapsed: z.boolean().optional(),
  }),
  z.object({
    type: z.enum(["session", "subagent-run"]),
    ref: z.object({ provider: z.string(), sessionId: z.string() }),
    snapshot: z
      .object({
        title: z.string().optional(),
        agent: z.string().optional(),
        projectDir: z.string().optional(),
      })
      .partial()
      .optional(),
    resolved: z.boolean().optional(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("context"),
    kind: z.enum(["distilled-summary", "transcript-excerpt", "files"]),
    payloadHash: z.string().optional(),
    config: z.record(z.string(), z.unknown()),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("note"),
    text: z.string(),
    color: z.string().optional(),
    size: z.object({ width: z.number(), height: z.number() }).optional(),
  }),
  z.object({
    type: z.literal("custom"),
    ref: z.object({ name: z.string() }),
    params: z.record(z.string(), z.string()).optional(),
    label: z.string().optional(),
    snapshot: z
      .object({
        label: z.string().optional(),
        glyph: z.string().optional(),
        description: z.string().optional(),
        input: z.enum(["text", "int", "float", "bool", "json"]).optional(),
        output: z.enum(["text", "int", "float", "bool", "json"]).optional(),
        inputs: z.array(customPortSchema).optional(),
        outputs: z.array(customPortSchema).optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("mcp-tool"),
    ref: z.object({ server: z.string() }),
    tool: z.string(),
    label: z.string().optional(),
    params: z.record(z.string(), z.string()).optional(),
    argPort: z.string().optional(),
    snapshot: z
      .object({
        params: z.array(customParamSchema).optional(),
        inputs: z.array(customPortSchema).optional(),
        outputs: z.array(customPortSchema).optional(),
        toolDescription: z.string().optional(),
        serverLabel: z.string().optional(),
      })
      .optional(),
  }),
]);

export const graphNodeSchema = z.object({
  id: z.string(),
  type: z.enum([
    "agent-def",
    "session",
    "subagent-run",
    "context",
    "prompt",
    "output",
    "prompt-convert",
    "delay",
    "data",
    "approval",
    "live-handoff",
    "wait-idle",
    "iterator",
    "knot",
    "tripwire",
    "judge",
    "until",
    "group",
    "note",
    "custom",
    "mcp-tool",
    "skill",
    "rules",
  ]),
  position: positionSchema,
  status: z.enum(["idle", "queued", "running", "success", "error"]).default("idle"),
  lastRunId: z.string().optional(),
  lastDurationMs: z.number().nonnegative().optional(),
  data: nodeDataSchema,
  subOf: z.string().optional(),
  originId: z.string().optional(),
  muted: z.boolean().optional(),
  bypassed: z.boolean().optional(),
  retry: z.number().int().min(0).max(10).optional(),
  continueOnError: z.boolean().optional(),
});

export const graphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullish(),
  targetHandle: z.string().nullish(),
  data: z
    .object({
      role: z.enum(["extract", "inject", "instantiate", "child", "reenter"]).optional(),
    })
    .optional(),
});

export const workflowParamSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  type: z.enum(["text", "int", "float", "bool", "json"]),
  default: z.string().optional(),
  description: z.string().optional(),
});

export const graphSettingsSchema = z.object({
  ply: z.number().int().min(1).max(32).optional(),
  spendTripwireUsd: z.number().positive().optional(),
});

/** Graph ids become filenames (`graphs/<id>.json`) — keep them path-inert. */
export const GRAPH_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const graphSchema = z.object({
  id: z.string().regex(GRAPH_ID_RE, "graph id must match [A-Za-z0-9_-]{1,64}"),
  name: z.string(),
  schemaVersion: z.literal(1),
  kind: z.enum(["workflow", "subgraph"]).optional().default("workflow"),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  params: z.array(workflowParamSchema).optional(),
  settings: graphSettingsSchema.optional(),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /**
   * First-run confirmation for imported JSON. `origin:"imported"` is stamped
   * by untrusted importGraph calls; runs are refused until `confirmedAt` is
   * set via the explicit confirm route/flow. These fields exist ONLY here —
   * never add them to portableGraphSchema, or a hostile export could arrive
   * pre-confirmed (portable import strips unknown keys today).
   */
  origin: z.enum(["imported"]).optional(),
  confirmedAt: z.number().optional(),
});

// ---- portable export/import ----

/**
 * Shareable graph JSON. Runtime-only state (status, lastRunId, resolved) is
 * stripped on export and ignored on import; ids/timestamps are regenerated.
 * Machine-local refs (skill/rules paths, session ids, payload hashes) are
 * cleared so the file can travel; skills/rules re-resolve by name on import.
 */
export const portableGraphSchema = z.object({
  $schema: z.literal("threadle/graph@1").optional(),
  name: z.string().min(1),
  kind: z.enum(["workflow", "subgraph"]).optional(),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  params: z.array(workflowParamSchema).optional(),
  settings: graphSettingsSchema.optional(),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
});
export type PortableGraph = z.infer<typeof portableGraphSchema>;

function portableNodeData(data: GraphNode["data"]): GraphNode["data"] {
  const copy = { ...data } as GraphNode["data"] & { resolved?: boolean };
  if ("resolved" in copy) delete copy.resolved;

  switch (copy.type) {
    case "skill":
    case "rules":
      return { ...copy, path: "" };
    case "session":
    case "subagent-run":
      return {
        ...copy,
        ref: { ...copy.ref, sessionId: "" },
        snapshot: copy.snapshot
          ? { title: copy.snapshot.title, agent: copy.snapshot.agent }
          : undefined,
      };
    case "context": {
      const { payloadHash: _ph, ...rest } = copy;
      return rest;
    }
    case "group": {
      const { graphId: _gid, ...rest } = copy;
      return rest;
    }
    case "agent-def": {
      const src = copy.ref.source;
      if (
        src.startsWith("claude:") ||
        src.startsWith("cursor:") ||
        src.startsWith("opencode:")
      ) {
        return copy;
      }
      // Absolute paths aren't portable — keep provider+name, tag as file.
      if (src.includes("/") || src.includes("\\")) {
        return {
          ...copy,
          ref: { ...copy.ref, source: `${copy.ref.provider}:file` },
        };
      }
      return copy;
    }
    case "output":
      return { ...copy, preview: undefined, content: undefined };
    default:
      return copy;
  }
}

/** Strip runtime-only + machine-local state so exported JSON is shareable. */
export function toPortableGraph(g: Graph): PortableGraph {
  const nodes = g.nodes.map((n) => {
    const { lastRunId: _lastRunId, lastDurationMs: _lastDurationMs, ...rest } = n;
    return {
      ...rest,
      status: "idle" as const,
      data: portableNodeData(n.data),
    };
  });
  return {
    $schema: "threadle/graph@1",
    name: g.name,
    kind: g.kind === "subgraph" ? "subgraph" : "workflow",
    nodes,
    edges: g.edges.map((e) => ({ ...e })),
    params: g.params?.map((p) => ({ ...p })),
    settings: g.settings ? { ...g.settings } : undefined,
    viewport: g.viewport,
  } as PortableGraph;
}
