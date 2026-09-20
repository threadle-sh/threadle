import matter from "gray-matter";
import type { GraphEdge, GraphNode, InjectResult, NodeStatus, ProviderId } from "@threadle/shared";
import {
  assessDetachedReadiness,
  clearWiredSinkNodes,
  DEFAULT_PLY,
  evaluateJudge,
  evaluateTripwire,
  agentErrWired,
  agentErrorPorts,
  agentSuccessPorts,
  expandFrameEdges,
  judgePortsOutput,
  mapPool,
  mergeKnotTexts,
  plyReady,
  predecessorMap,
  SKIP_DETACHED_TYPES,
  structuralEdges,
  clampUntilMaxIterations,
  untilLoopBody,
  untilPortsOutput,
  advanceUntil,
  substituteParams,
  valueTypeError,
  coerceValue,
  joinAgentPromptTexts,
  clampWaitIdleTimeoutMs,
  isSessionBusy,
  WAIT_IDLE_POLL_MS,
  decideWaitIdle,
  splitIteratorItems,
  iteratorIsParallel,
  SEEDABLE_NODE_TYPES,
  skillInvokeProvider,
  enrichUsageExhaustionError,
  classifyUsageExhaustion,
  claudeExhaustedForModel,
  formatUsageExhaustionMessage,
} from "@threadle/shared";
import { readSubscription } from "../routes/subscription.js";
import { readGraph, saveGraph } from "../graphs/store.js";
import {
  findLatestGraphOutputs,
  mergeJobNodeOutput,
  readJobOutputs,
  type CachedNodeOutput,
  writeJobOutputs,
} from "../jobs.js";
import { registry } from "../providers/registry.js";
import { isKnownProjectDir } from "../readable-paths.js";
import { runClaudeAgent } from "../providers/claude-code/inject.js";
import { runCursorAgent } from "../providers/cursor/inject.js";
import { runAntigravityAgent } from "../providers/antigravity/inject.js";
import { runCodexAgent } from "../providers/codex/inject.js";
import { runCopilotAgent } from "../providers/copilot/inject.js";
import { runGrokAgent } from "../providers/grok/inject.js";
import { runOpencodeAgent } from "../providers/opencode/inject.js";
import { getCustomDef, runCustomDef, LEGACY_PORT } from "../routes/custom-nodes.js";
import { callMcpTool } from "../mcp/client.js";
import { coerceParamsToMcpArgs } from "../mcp/schema.js";
import { materializeContextPayload } from "../context/materialize.js";
import { readPayload } from "../context/store.js";
import { recordInject } from "../routes/lineage.js";
import { formatArtifactInject, readArtifactForNode } from "../routes/rules.js";

/**
 * Headless workflow executor: the same semantics as the canvas runner —
 * prompts, converters, custom nodes, agents, sessions, iterators, gates,
 * frames, mute/bypass and per-node error policy — but running inside the
 * server, so the run survives the browser tab.
 *
 * Deliberate differences from the interactive runner:
 * - approval gates need `approveAll`, otherwise the run refuses to start
 * - result session nodes are not created; node statuses and output
 *   contents are persisted as nodes enter/leave `running` (and at the end)
 * - context → agent handoffs are recorded in lineage (same as interactive)
 *
 * Context nodes: reuse `payloadHash` when present, else extract / distill /
 * files from an inbound session (agent or session node) mid-run.
 */
export interface ExecuteOptions {
  graphId: string;
  params?: Record<string, string>;
  approveAll?: boolean;
  projectDir: string;
  log: (lane: string, line: string) => void;
  signal: AbortSignal;
  /** Fired whenever a node status changes (SSE → open canvases). */
  onNodeStatus?: (nodeId: string, status: NodeStatus) => void;
  /**
   * Partial run: only these node ids execute; others are seeded (like canvas
   * `seedOutput`). Omit / empty = full graph.
   */
  scope?: string[];
  /** Persist successful node outputs under runs/<jobId>/outputs.json. */
  jobId?: string;
  /** Prefer this job's outputs.json when seeding out-of-scope nodes. */
  replayFromJobId?: string;
  /**
   * Skip the imported-graph confirmation gate. ONLY set after the user has
   * explicitly confirmed the execution manifest (CLI prompt / --accept-imported).
   */
  acceptImported?: boolean;
}

interface NodeOutput {
  text?: string;
  items?: string[];
  session?: { provider: ProviderId; sessionId: string };
  /** named-output custom nodes: port → lane value (text carries the primary port) */
  ports?: Record<string, string>;
}

function toCached(out: NodeOutput): CachedNodeOutput {
  return {
    text: out.text,
    items: out.items,
    session: out.session,
    ports: out.ports,
  };
}

function fromCached(c: CachedNodeOutput): NodeOutput {
  return {
    text: c.text,
    items: c.items,
    session: c.session as NodeOutput["session"],
    ports: c.ports,
  };
}

/** the value an edge actually carries: a named source port when wired, else the primary text */
function edgeValue(out: NodeOutput, e: GraphEdge): NodeOutput {
  const port = e.sourceHandle?.startsWith("out:") ? e.sourceHandle.slice(4) : undefined;
  if (port && out.ports) {
    // Named outs: only carry that lane (empty string = intentional miss for multi-out).
    // Do not fall back to primary text — that would fan the winner to every branch.
    if (port in out.ports) return { ...out, text: out.ports[port] };
    return { ...out, text: undefined };
  }
  return out;
}

export async function executeWorkflow(opts: ExecuteOptions): Promise<{
  outputs: number;
  outputTexts: string[];
}> {
  const loaded = await readGraph(opts.graphId);
  if (!loaded) throw new Error(`no workflow with id ${opts.graphId}`);
  const g = loaded;
  const { log } = opts;

  /**
   * cwd for agent/session spawns. `snapshot.projectDir` is normally
   * re-resolved server-side from a live session (known-by-construction) and
   * is STRIPPED on legitimate export — a value the allowlist doesn't know is
   * a tampered import choosing its own cwd (and thereby which
   * `.claude/settings.json` / `.mcp.json` the CLI picks up). Fail loud, no
   * silent fallback.
   */
  const resolveNodeProjectDir = async (
    snapshotDir: string | undefined,
    what: string,
  ): Promise<string> => {
    if (!snapshotDir) return opts.projectDir;
    if (!(await isKnownProjectDir(snapshotDir))) {
      throw new Error(
        `${what}: session project dir "${snapshotDir}" is not a known project directory — reopen the graph to refresh session links, or clear the link`,
      );
    }
    return snapshotDir;
  };

  // Imported JSON never runs before the user has confirmed what it executes.
  // This is the backstop for every entry path (HTTP, triggers, MCP, CLI);
  // the HTTP route additionally returns the manifest with a 428.
  if (g.origin === "imported" && !g.confirmedAt && !opts.acceptImported) {
    throw Object.assign(
      new Error(
        "imported workflow not yet confirmed — open it and review what it executes first",
      ),
      { status: 428, code: "confirmation-required" },
    );
  }

  // ---- graph helpers (ported from the canvas runner) ----
  const nodeById = (id: string): GraphNode | undefined => g.nodes.find((n) => n.id === id);
  const eEdges = expandFrameEdges(g.nodes, g.edges);
  const sEdges = structuralEdges(eEdges);
  const topo = (): GraphNode[] => {
    const incoming = new Map<string, number>(g.nodes.map((n) => [n.id, 0]));
    for (const e of sEdges) incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    const byPos = (a: GraphNode, b: GraphNode) => a.position.y - b.position.y || a.position.x - b.position.x;
    const queue = g.nodes.filter((n) => !incoming.get(n.id)).sort(byPos);
    const order: GraphNode[] = [];
    const seen = new Set<string>();
    while (queue.length) {
      const n = queue.shift()!;
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      order.push(n);
      for (const e of sEdges) {
        if (e.source !== n.id) continue;
        const left = (incoming.get(e.target) ?? 0) - 1;
        incoming.set(e.target, left);
        if (left <= 0) {
          const t = nodeById(e.target);
          if (t && !seen.has(t.id)) {
            queue.push(t);
            queue.sort(byPos);
          }
        }
      }
    }
    return order;
  };

  // ---- params: merge declared defaults with caller values, validate types ----
  const values: Record<string, string> = {};
  for (const p of g.params ?? []) {
    const v = opts.params?.[p.name] ?? p.default ?? "";
    const bad = valueTypeError(v, p.type);
    if (bad) throw new Error(`param "${p.name}" ${bad}`);
    values[p.name] = v;
  }

  // gates up front — refuse before any agent work so the canvas can show a clear modal
  const readiness = assessDetachedReadiness(g);
  const gates = readiness.filter(
    (i) => i.kind === "approval" || i.kind === "live-handoff",
  );
  const blockers = readiness.filter((i) => i.blocking);
  if (blockers.length) {
    const names = blockers.map((i) => i.label).join(", ");
    throw new Error(
      `detached run blocked — fix (or mute) node(s) first: ${names}`,
    );
  }
  if (gates.length && !opts.approveAll) {
    throw new Error(
      `this workflow has ${gates.length} interactive gate(s) (approval / live handoff) — pass approveAll to run it detached`,
    );
  }
  const order = topo();
  if (order.length < g.nodes.length) throw new Error("cycle detected — workflow can never finish");

  const scopeSet =
    opts.scope && opts.scope.length > 0 ? new Set(opts.scope) : undefined;
  const inScope = (id: string): boolean => !scopeSet || scopeSet.has(id);

  // Wipe prior-run Data/Output captures that came in on a wire (scoped).
  if (clearWiredSinkNodes(g, scopeSet)) {
    await saveGraph(g).catch(() => undefined);
  }

  // Prior job cache for seeding out-of-scope / replay nodes.
  let priorOutputs: Record<string, CachedNodeOutput> = {};
  if (scopeSet) {
    if (opts.replayFromJobId) {
      priorOutputs = await readJobOutputs(opts.replayFromJobId);
      if (Object.keys(priorOutputs).length) {
        log("meta", `↻ seeding from job ${opts.replayFromJobId}`);
      }
    } else {
      const found = await findLatestGraphOutputs(opts.graphId, opts.jobId);
      if (found) {
        priorOutputs = found.outputs;
        log("meta", `↻ seeding from prior job ${found.jobId}`);
      }
    }
  }

  const outputs = new Map<string, NodeOutput>();
  const skipped = new Set<string>();
  const untilIter = new Map<string, number>();
  const injectText = new Map<string, string>();
  let pendingReenter:
    | { untilId: string; text: string; targets: string[]; body: string[] }
    | undefined;
  let outputCount = 0;
  const outputTexts: string[] = [];
  const plyLimit = Math.max(1, g.settings?.ply ?? DEFAULT_PLY);
  const spendTripwireUsd = g.settings?.spendTripwireUsd;
  let runSpend = 0;
  let runFailures = 0;
  const runStartedAt = Date.now();

  const persistNodeOutput = (nodeId: string, out: NodeOutput): void => {
    if (!opts.jobId) return;
    void mergeJobNodeOutput(opts.jobId, nodeId, toCached(out));
  };

  const label = (n: GraphNode): string =>
    n.data.type === "agent-def" ? n.data.ref.name
    : n.data.type === "custom" ? n.data.ref.name
    : n.data.type === "mcp-tool" ? (n.data.tool || "mcp-tool")
    : n.data.type === "skill" || n.data.type === "rules" ? n.data.name
    : n.data.type === "knot" ? (n.data.label || `merge (${n.data.strategy})`)
    : n.data.type === "tripwire" ? (n.data.label || `circuit breaker (${n.data.mode})`)
    : n.data.type === "judge" ? (n.data.label || "judge")
    : n.data.type === "until"
      ? (n.data.label || `until (×${clampUntilMaxIterations(n.data.maxIterations)})`)
    : n.data.type;

  /**
   * Seed a node outside the run scope (mirror of GraphEditor `seedOutput`).
   * Prefers prior-job cache; falls back to node data / cheap transforms.
   */
  async function seedOutput(
    node: GraphNode,
    inboundEdges: Array<{ edge: GraphEdge; out: NodeOutput }>,
  ): Promise<void> {
    const cached = priorOutputs[node.id];
    if (cached && (cached.text !== undefined || cached.session || cached.ports || cached.items)) {
      outputs.set(node.id, fromCached(cached));
      log("meta", `↻ reuse ${label(node)} (cached)`);
      return;
    }
    const inbound = inboundEdges.map((i) => i.out);
    const texts = (): string[] => inbound.map((i) => i.text).filter(Boolean) as string[];
    switch (node.data.type) {
      case "prompt":
        outputs.set(node.id, { text: node.data.text });
        break;
      case "skill":
      case "rules": {
        if (!node.data.path && !node.data.name) break;
        try {
          const { artifact, content } = await readArtifactForNode({
            kind: node.data.type,
            name: node.data.name,
            path: node.data.path || undefined,
            origin: node.data.type === "skill" ? node.data.origin : undefined,
            source: node.data.source,
          });
          outputs.set(node.id, {
            text: formatArtifactInject(node.data.type, artifact.name, artifact.source, content),
          });
        } catch {
          // soft-fail — scoped run errors if required
        }
        break;
      }
      case "session":
      case "subagent-run":
        outputs.set(node.id, {
          session: {
            provider: node.data.ref.provider,
            sessionId: node.data.ref.sessionId,
          },
        });
        break;
      case "agent-def": {
        // Prefer linked session tail when we have inbound session; else idle.
        const session = inbound.map((i) => i.session).find(Boolean);
        if (session) {
          const text = await lastAssistantText(session.provider, session.sessionId);
          outputs.set(node.id, { text, session });
        }
        break;
      }
      case "context":
        if (node.data.payloadHash) {
          const payload = await readPayload(node.data.payloadHash);
          if (payload) outputs.set(node.id, { text: payload.content });
        }
        break;
      case "output": {
        const session = inbound.map((i) => i.session).find(Boolean);
        let text: string | undefined = node.data.content ?? node.data.preview;
        if (!text && session) {
          text = await lastAssistantText(session.provider, session.sessionId);
        }
        if (text) outputs.set(node.id, { text, session });
        break;
      }
      case "prompt-convert": {
        const ts = texts();
        if (!ts.length) break;
        const input = ts.join("\n\n");
        const tpl = node.data.template ?? "";
        outputs.set(node.id, {
          text: tpl.includes("{{input}}")
            ? tpl.replaceAll("{{input}}", input)
            : tpl.trim()
              ? `${tpl}\n\n${input}`
              : input,
        });
        break;
      }
      case "delay": {
        const text = texts().join("\n\n");
        if (text) outputs.set(node.id, { text });
        break;
      }
      case "data": {
        const inboundText = texts().join("\n\n");
        const text = inboundText || (node.data.value ?? "");
        if (!text) break;
        const coerced = coerceValue(text, node.data.valueType ?? "text");
        if ("error" in coerced) break;
        node.data.value = coerced.value;
        outputs.set(node.id, { text: coerced.value });
        break;
      }
      case "approval":
      case "tripwire":
      case "live-handoff":
      case "wait-idle": {
        const text = texts().join("\n\n---\n\n");
        const session = inbound.map((i) => i.session).find(Boolean);
        if (text || session) {
          outputs.set(node.id, { text: text || undefined, session });
        }
        break;
      }
      case "knot": {
        const ts = texts();
        if (!ts.length) break;
        outputs.set(node.id, {
          text: mergeKnotTexts(ts, node.data.strategy, { separator: node.data.separator }),
          session: inbound.map((i) => i.session).find(Boolean),
        });
        break;
      }
      case "judge": {
        const text = texts().join("\n\n---\n\n");
        if (!text) break;
        const verdict = evaluateJudge(node.data, text);
        const port = verdict.park ? "unsure" : verdict.port;
        const ports = judgePortsOutput(port, text);
        outputs.set(node.id, {
          text: ports[port],
          session: inbound.map((i) => i.session).find(Boolean),
          ports,
        });
        break;
      }
      case "until": {
        const text = texts().join("\n\n---\n\n");
        if (!text) break;
        const ports = untilPortsOutput("exhausted", text);
        outputs.set(node.id, {
          text,
          session: inbound.map((i) => i.session).find(Boolean),
          ports,
        });
        break;
      }
      case "iterator": {
        const text = texts().join("\n\n");
        if (text) outputs.set(node.id, { text });
        break;
      }
      default: {
        // custom / mcp-tool etc.: only prior cache helps (already checked)
        if (SEEDABLE_NODE_TYPES.has(node.data.type)) break;
        log("meta", `∅ ${label(node)} out of scope — no seed`);
        break;
      }
    }
    if (outputs.has(node.id)) {
      log("meta", `↻ reuse ${label(node)}`);
    }
  }

  const checkSpendTripwire = (): void => {
    if (spendTripwireUsd != null && runSpend >= spendTripwireUsd) {
      throw new Error(
        `$ spend ceiling: $${runSpend.toFixed(2)} ≥ $${spendTripwireUsd} — run stopped`,
      );
    }
  };

  const addSpend = (n: number | undefined): void => {
    if (n == null || !Number.isFinite(n) || n <= 0) return;
    runSpend += n;
    log("meta", `$ spend +$${n.toFixed(4)} (run $${runSpend.toFixed(4)})`);
    checkSpendTripwire();
  };

  /** Paint open canvases mid-run; persist when entering/leaving `running`. */
  const nodeStartedAt = new Map<string, number>();
  async function setStatus(node: GraphNode, status: NodeStatus): Promise<void> {
    const prev = node.status;
    if (prev === status) return;
    if (status === "running") {
      nodeStartedAt.set(node.id, Date.now());
      delete node.lastDurationMs;
    } else if (
      (status === "success" || status === "error") &&
      nodeStartedAt.has(node.id)
    ) {
      node.lastDurationMs = Math.max(0, Date.now() - nodeStartedAt.get(node.id)!);
      nodeStartedAt.delete(node.id);
    }
    node.status = status;
    opts.onNodeStatus?.(node.id, status);
    if (status === "running" || prev === "running") {
      await saveGraph(g).catch(() => undefined);
    }
  }

  async function processNode(node: GraphNode): Promise<void> {
    if (opts.signal.aborted) throw new Error("run cancelled");
    if (SKIP_DETACHED_TYPES.has(node.data.type)) {
      return;
    }

    const inboundEdges = eEdges
      .filter((e) => e.target === node.id)
      .flatMap((e) => {
        const out = outputs.get(e.source);
        return out ? [{ edge: e, out: edgeValue(out, e) }] : [];
      });
    const inbound = inboundEdges.map((i) => i.out);
    const injected = injectText.get(node.id);
    if (injected !== undefined) {
      inbound.push({ text: injected });
      injectText.delete(node.id);
    }

    if (!inScope(node.id)) {
      await seedOutput(node, inboundEdges);
      return;
    }

    if (node.muted) {
      skipped.add(node.id);
      node.status = "idle";
      delete node.lastDurationMs;
      log("meta", `⊘ ${label(node)} muted — skipped`);
      return;
    }
    if (
      !inbound.length &&
      eEdges.some((e) => e.target === node.id && skipped.has(e.source)) &&
      eEdges.filter((e) => e.target === node.id).every((e) => skipped.has(e.source) || !outputs.has(e.source))
    ) {
      skipped.add(node.id);
      node.status = "idle";
      delete node.lastDurationMs;
      log("meta", `∅ ${label(node)} starved (upstream muted/failed) — skipped`);
      return;
    }
    if (node.bypassed) {
      const pass = inbound.find((i) => i.text !== undefined) ?? inbound[0];
      if (pass) {
        outputs.set(node.id, pass);
        persistNodeOutput(node.id, pass);
      }
      node.status = "success";
      node.lastDurationMs = 0;
      log("meta", `⤳ ${label(node)} bypassed`);
      return;
    }

    const texts = (): string[] => inbound.map((i) => i.text).filter(Boolean) as string[];

    const t0 = Date.now();
    const exec = async (): Promise<void> => {
      switch (node.data.type) {
        case "prompt": {
          const text = substituteParams(node.data.text, values);
          const bad = valueTypeError(text, node.data.valueType ?? "text");
          if (bad) throw new Error(`prompt is typed ${node.data.valueType} but ${bad}`);
          outputs.set(node.id, { text });
          node.status = "success";
          break;
        }
        case "skill": {
          if (!node.data.path && !node.data.name) {
            throw new Error("skill node has no artifact selected");
          }
          if (node.data.mode === "invoke") {
            const name = node.data.name.trim();
            if (!name) throw new Error("skill invoke needs a skill name");
            const extra = texts().join("\n\n").trim();
            const provider = skillInvokeProvider(node.data);
            await setStatus(node, "running");
            log("meta", `✦ invoke /${name} via ${provider}`);
            const { runSkillInvoke } = await import("./skill-invoke.js");
            const result = await runSkillInvoke({
              provider,
              skillName: name,
              extra: extra || undefined,
              model: node.data.model,
              projectDir: opts.projectDir,
              onLog: (lane, line) => log(lane, `skill ${name}: ${line}`),
              signal: opts.signal,
            });
            const text = result.resultText?.trim() || "(no result text)";
            outputs.set(node.id, { text });
            node.status = "success";
            break;
          }
          const { artifact, content } = await readArtifactForNode({
            kind: "skill",
            name: node.data.name,
            path: node.data.path || undefined,
            origin: node.data.origin,
            source: node.data.source,
          });
          if (!node.data.path) node.data.path = artifact.path;
          const text = formatArtifactInject("skill", artifact.name, artifact.source, content);
          log("meta", `✦ skill ${artifact.name}: ${content.length} chars`);
          outputs.set(node.id, { text });
          node.status = "success";
          break;
        }
        case "rules": {
          if (!node.data.path && !node.data.name) {
            throw new Error("rules node has no artifact selected");
          }
          const { artifact, content } = await readArtifactForNode({
            kind: "rules",
            name: node.data.name,
            path: node.data.path || undefined,
            source: node.data.source,
          });
          if (!node.data.path) node.data.path = artifact.path;
          const text = formatArtifactInject("rules", artifact.name, artifact.source, content);
          log("meta", `✦ rules ${artifact.name}: ${content.length} chars`);
          outputs.set(node.id, { text });
          node.status = "success";
          break;
        }
        case "prompt-convert": {
          const ts = texts();
          if (!ts.length) {
            node.status = "idle";
            break;
          }
          const input = ts.join("\n\n");
          const tpl = substituteParams(node.data.template ?? "", values);
          const text = tpl.includes("{{input}}")
            ? tpl.replaceAll("{{input}}", input)
            : tpl.trim()
              ? `${tpl}\n\n${input}`
              : input;
          outputs.set(node.id, { text });
          node.status = "success";
          break;
        }
        case "delay": {
          const ts = texts();
          if (!ts.length) {
            node.status = "idle";
            break;
          }
          const ms = Math.min(Math.max(Math.floor(node.data.ms ?? 0), 0), 300_000);
          await setStatus(node, "running");
          log("meta", `◷ delay ${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)}s`);
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(() => {
              opts.signal.removeEventListener("abort", onAbort);
              resolve();
            }, ms);
            const onAbort = (): void => {
              clearTimeout(t);
              reject(new Error("run cancelled"));
            };
            if (opts.signal.aborted) {
              onAbort();
              return;
            }
            opts.signal.addEventListener("abort", onAbort, { once: true });
          });
          outputs.set(node.id, { text: ts.join("\n\n") });
          await setStatus(node, "success");
          break;
        }
        case "data": {
          const ts = texts();
          const raw = ts.length ? ts.join("\n\n") : (node.data.value ?? "");
          if (!raw) {
            node.status = "idle";
            break;
          }
          const vt = node.data.valueType ?? "text";
          const coerced = coerceValue(raw, vt);
          if ("error" in coerced) throw new Error(coerced.error);
          node.data.value = coerced.value;
          log("meta", `◇ data → ${vt}`);
          outputs.set(node.id, { text: coerced.value });
          await setStatus(node, "success");
          break;
        }
        case "knot": {
          const ts = texts();
          if (!ts.length) {
            node.status = "idle";
            break;
          }
          const strategy = node.data.strategy;
          let text = mergeKnotTexts(ts, strategy, { separator: node.data.separator });
          if (strategy === "synthesize" && node.data.model && node.data.provider) {
            await setStatus(node, "running");
            log("meta", `⋈ merge synthesize via ${node.data.provider}/${node.data.model}`);
            const onLog = (lane: string, line: string): void => log(lane, `merge: ${line}`);
            const provider = node.data.provider;
            const prompt = text;
            let result: InjectResult;
            if (provider === "opencode") {
              result = await runOpencodeAgent({
                agent: node.data.agent || "build",
                model: node.data.model,
                prompt,
                projectDir: opts.projectDir,
                onLog,
                signal: opts.signal,
              });
            } else if (provider === "cursor") {
              result = await runCursorAgent({
                agent: node.data.agent || "agent",
                model: node.data.model,
                prompt,
                projectDir: opts.projectDir,
                onLog,
                signal: opts.signal,
              });
            } else if (provider === "antigravity") {
              result = await runAntigravityAgent({
                agent: node.data.agent || "agent",
                model: node.data.model,
                prompt,
                projectDir: opts.projectDir,
                onLog,
                signal: opts.signal,
              });
            } else if (provider === "codex") {
              result = await runCodexAgent({
                agent: node.data.agent || "codex",
                model: node.data.model,
                prompt,
                projectDir: opts.projectDir,
                onLog,
                signal: opts.signal,
              });
            } else if (provider === "copilot") {
              result = await runCopilotAgent({
                agent: node.data.agent || "copilot",
                model: node.data.model,
                prompt,
                projectDir: opts.projectDir,
                onLog,
                signal: opts.signal,
              });
            } else if (provider === "grok") {
              result = await runGrokAgent({
                agent: node.data.agent || "grok",
                model: node.data.model,
                prompt,
                projectDir: opts.projectDir,
                onLog,
                signal: opts.signal,
              });
            } else {
              result = await runClaudeAgent({
                agent: node.data.agent,
                model: node.data.model,
                prompt,
                projectDir: opts.projectDir,
                onLog,
                signal: opts.signal,
              });
            }
            text =
              result.resultText ??
              (await lastAssistantText(result.provider, result.newSessionId)) ??
              text;
          } else if (strategy === "synthesize") {
            log("meta", `⋈ merge synthesize — no model set; passing labeled candidates`);
          } else {
            log("meta", `⋈ merge ${strategy}: ${ts.length} inbound`);
          }
          outputs.set(node.id, { text });
          await setStatus(node, "success");
          break;
        }
        case "tripwire": {
          const ts = texts();
          const text = ts.join("\n\n---\n\n");
          const session = inboundEdges.map((i) => i.out.session).find(Boolean);
          let tokens: number | undefined;
          if (session) {
            const sess = await registry
              .get(session.provider)
              .getSession?.(session.sessionId)
              .catch(() => undefined);
            if (sess) {
              const sum =
                (sess.tokensIn ?? 0) +
                (sess.tokensOut ?? 0) +
                (sess.tokensReasoning ?? 0);
              if (sum > 0) tokens = sum;
            }
          }
          const verdict = evaluateTripwire(node.data, {
            text,
            runSpend,
            runStartedAt,
            runFailures,
            tokens,
          });
          if (!verdict.tripped) {
            log("meta", `‡ circuit breaker ok — ${verdict.reason}`);
            if (!ts.length) {
              node.status = "idle";
              break;
            }
            outputs.set(node.id, {
              text,
              session,
            });
            node.status = "success";
            break;
          }
          log("meta", `‡ circuit breaker — ${verdict.reason} → ${node.data.action}`);
          if (node.data.action === "skip") {
            node.status = "error";
            skipped.add(node.id);
            break;
          }
          if (node.data.action === "park") {
            if (!opts.approveAll) {
              throw new Error(
                `‡ circuit breaker parked: ${verdict.reason} — splice in the UI or pass --approve-all`,
              );
            }
            log("meta", `‡ circuit breaker park auto-passed (approveAll) — ${verdict.reason}`);
            outputs.set(node.id, { text, session });
            node.status = "success";
            break;
          }
          node.status = "error";
          throw new Error(`‡ circuit breaker: ${verdict.reason} — run stopped`);
        }
        case "judge": {
          const ts = texts();
          const text = ts.join("\n\n---\n\n");
          const session = inboundEdges.map((i) => i.out.session).find(Boolean);
          if (!ts.length) {
            node.status = "idle";
            break;
          }
          const verdict = evaluateJudge(node.data, text);
          if (verdict.park) {
            if (!opts.approveAll) {
              throw new Error(
                `? judge parked: ${verdict.reason} — splice in the UI or pass --approve-all`,
              );
            }
            // Detached: park gates auto-pass only when approveAll (same as tripwire park).
            log("meta", `? judge park auto-passed (approveAll) — ${verdict.reason}`);
            const ports = judgePortsOutput("unsure", text);
            outputs.set(node.id, { text, session, ports });
            node.status = "success";
            break;
          }
          log("meta", `? judge → ${verdict.port} — ${verdict.reason}`);
          const ports = judgePortsOutput(verdict.port, text);
          outputs.set(node.id, { text: ports[verdict.port], session, ports });
          node.status = "success";
          break;
        }
        case "until": {
          const ts = texts();
          const text = ts.join("\n\n---\n\n");
          if (!ts.length) {
            node.status = "idle";
            break;
          }
          const max = clampUntilMaxIterations(node.data.maxIterations);
          const iter = untilIter.get(node.id) ?? 0;
          const { targets, body } = untilLoopBody(eEdges, node.id);
          const step = advanceUntil({
            maxIterations: max,
            iterCount: iter,
            hasReenterTargets: targets.length > 0,
          });
          if (step.kind === "reenter") {
            untilIter.set(node.id, step.nextIter);
            log("meta", `↻ until iteration ${step.nextIter}/${max}`);
            const ports = untilPortsOutput("reenter", text);
            outputs.set(node.id, { text: ports.reenter, ports });
            pendingReenter = { untilId: node.id, text, targets, body };
            node.status = "success";
            break;
          }
          if (step.kind === "exhausted-no-wire") {
            log("meta", `↻ until — no reenter wire; emitting exhausted`);
          } else {
            log("meta", `↻ until exhausted after ${max} iteration(s)`);
          }
          const ports = untilPortsOutput("exhausted", text);
          outputs.set(node.id, { text, ports });
          node.status = "success";
          break;
        }
        case "custom": {
          const data = node.data;
          const def = await getCustomDef(data.ref.name);
          if (!def) throw new Error(`custom node "${data.ref.name}" is not installed or is disabled`);
          const ports: Record<string, string[]> = {};
          for (const { edge, out } of inboundEdges) {
            if (out.text === undefined) continue;
            const port = edge.targetHandle?.startsWith("in:")
              ? edge.targetHandle.slice(3)
              : (def.inputs?.[0]?.name ?? LEGACY_PORT);
            (ports[port] ??= []).push(out.text);
          }
          if (!Object.values(ports).some((v) => v.length)) {
            node.status = "idle";
            break;
          }
          await setStatus(node, "running");
          const res = await runCustomDef(def, ports, data.params);
          log("stdout", `⌁ ${def.name}: ${res.text.slice(0, 500)}`);
          log("meta", `⌁ ${def.name} finished in ${res.ms}ms (${res.text.length} chars)`);
          if (res.stderr) log("stderr", `⌁ ${def.name}: ${res.stderr}`);
          outputs.set(node.id, { text: res.text, ports: res.ports });
          await setStatus(node, "success");
          break;
        }
        case "mcp-tool": {
          const data = node.data;
          if (!data.ref.server || !data.tool) {
            throw new Error("MCP tool node needs a server and tool");
          }
          const inboundText = texts().join("\n\n");
          const raw: Record<string, unknown> = { ...(data.params ?? {}) };
          if (data.argPort && inboundText) raw[data.argPort] = inboundText;
          else if (inboundText && !Object.keys(raw).length) {
            // no params declared — pass as generic `input` if schema-free
            raw.input = inboundText;
          }
          const args = coerceParamsToMcpArgs(raw, data.snapshot?.params);
          await setStatus(node, "running");
          const res = await callMcpTool({
            projectDir: opts.projectDir,
            serverId: data.ref.server,
            tool: data.tool,
            args,
            onStderr: (line) => log("stderr", `◈ ${data.ref.server}: ${line}`),
          });
          if (res.isError) throw new Error(res.text);
          log("stdout", `◈ ${data.ref.server}/${data.tool}: ${res.text.slice(0, 500)}`);
          outputs.set(node.id, { text: res.text });
          await setStatus(node, "success");
          break;
        }
        case "iterator": {
          const ts = texts();
          if (!ts.length) {
            node.status = "idle";
            break;
          }
          const text = ts.join("\n\n");
          const split = splitIteratorItems(text, {
            splitMode: node.data.splitMode,
            maxItems: node.data.maxItems,
          });
          if (!split.ok) {
            throw new Error(`iterator: ${split.error}`);
          }
          const items = split.items;
          log(
            "meta",
            `∀ iterator: ${items.length} item(s) (${node.data.splitMode}${iteratorIsParallel(node.data.mode) ? ", parallel" : ""})`,
          );
          outputs.set(node.id, { text, items });
          node.status = "success";
          break;
        }
        case "wait-idle": {
          const session = inboundEdges.map((i) => i.out.session).find(Boolean);
          const ts = texts();
          const text = ts.join("\n\n---\n\n");
          if (!session) {
            throw new Error("wait for idle needs an inbound session");
          }
          const timeoutMs = clampWaitIdleTimeoutMs(node.data.timeoutMs);
          const onTimeout = node.data.onTimeout ?? "park";
          await setStatus(node, "running");
          log(
            "meta",
            `◌ wait for idle: ${session.provider}:${session.sessionId.slice(0, 8)}… (${Math.round(timeoutMs / 1000)}s, on miss ${onTimeout})`,
          );
          const deadline = Date.now() + timeoutMs;
          let gotIdle = false;
          while (Date.now() < deadline) {
            if (opts.signal.aborted) throw new Error("run cancelled");
            const live = await registry.get(session.provider).liveStatuses();
            const st =
              live instanceof Map
                ? live.get(session.sessionId)
                : undefined;
            if (!isSessionBusy(st)) {
              gotIdle = true;
              break;
            }
            await new Promise((r) => setTimeout(r, WAIT_IDLE_POLL_MS));
          }
          if (gotIdle) {
            log("meta", "◌ session idle — continuing");
            outputs.set(node.id, { text: text || undefined, session });
            await setStatus(node, "success");
            break;
          }
          log("meta", `◌ still busy after ${Math.round(timeoutMs / 1000)}s → ${onTimeout}`);
          const decision = decideWaitIdle({ gotIdle: false, onTimeout });
          if (decision.kind === "skip") {
            node.status = "idle";
            break;
          }
          if (decision.kind === "abort") {
            throw new Error("wait for idle timed out");
          }
          // park: detached runs need approveAll
          if (opts.approveAll) {
            log("meta", "◌ wait-idle timed out — approveAll continues");
            outputs.set(node.id, {
              text:
                text ||
                `(session ${session.provider}:${session.sessionId} still busy after timeout)`,
              session,
            });
            await setStatus(node, "success");
            break;
          }
          throw new Error(
            "wait for idle timed out (park needs interactive run or --approve-all)",
          );
        }
        case "approval": {
          const ts = texts();
          if (!ts.length) {
            node.status = "idle";
            break;
          }
          log("meta", `✓ approval gate auto-approved (approveAll)`);
          outputs.set(node.id, { text: ts.join("\n\n") });
          node.status = "success";
          break;
        }
        case "live-handoff": {
          const ts = texts();
          if (!ts.length) {
            node.status = "idle";
            break;
          }
          log("meta", `⇄ live handoff skipped (approveAll) — forwarding inbound text`);
          outputs.set(node.id, {
            text: ts.join("\n\n---\n\n"),
            session: inboundEdges.map((i) => i.out.session).find(Boolean),
          });
          node.status = "success";
          break;
        }
        case "context": {
          const source = inbound.map((i) => i.session).find(Boolean);
          let payload = node.data.payloadHash
            ? await readPayload(node.data.payloadHash)
            : undefined;
          if (!payload && source) {
            await setStatus(node, "running");
            payload = await materializeContextPayload({
              kind: node.data.kind,
              config: node.data.config,
              source,
              projectDir: opts.projectDir,
              onLog: (lane, line) => log(lane, line),
              signal: opts.signal,
            });
            node.data.payloadHash = payload.hash;
          }
          if (payload) {
            outputs.set(node.id, { text: payload.content, session: source });
            await setStatus(node, "success");
            break;
          }
          if (!source) {
            node.status = "idle";
            break;
          }
          throw new Error(
            `context "${node.data.label || node.data.kind || node.id}" payload missing — wire a session source or drag from Library`,
          );
        }
        case "agent-def": {
          const data = node.data;
          const items = inbound.flatMap((i) => i.items ?? []);
          const joined = joinAgentPromptTexts(
            inboundEdges.map(({ edge, out }) => ({
              sourceType: nodeById(edge.source)?.data.type,
              text: out.text,
            })),
          );
          const prompts = items.length ? items : joined ? [joined] : [];
          if (!prompts.length) {
            node.status = "idle";
            break;
          }
          const parallelMap =
            items.length > 0 &&
            inboundEdges.some(({ edge }) => {
              const src = nodeById(edge.source);
              return src?.data.type === "iterator" && src.data.mode === "parallel";
            });
          await setStatus(node, "running");
          if (data.ref.provider === "claude-code") {
            try {
              const sub = await readSubscription();
              const blocked = claudeExhaustedForModel(data.model, sub.usage);
              if (blocked.length) {
                const labels = blocked.map((b) => `${b.label} ${b.utilization}%`).join(", ");
                const msg = formatUsageExhaustionMessage(
                  blocked.some((b) => b.id === "sevenDayOpus")
                    ? "claude-opus-7d"
                    : blocked.some((b) => b.id === "sevenDay")
                      ? "claude-7d"
                      : "claude-5h",
                  labels,
                );
                log("stderr", `! ${msg}`);
                throw new Error(msg);
              }
            } catch (err) {
              if (err instanceof Error && /model usage exhausted/.test(err.message)) throw err;
              // subscription unreadable — continue; CLI will fail if truly blocked
            }
          }
          const linkedEdge = parallelMap
            ? undefined
            : eEdges.find((e) => {
                if (e.source !== node.id) return false;
                const t = nodeById(e.target);
                return t?.data.type === "session";
              });
          const linkedNode = linkedEdge ? nodeById(linkedEdge.target) : undefined;
          const linkedData = linkedNode?.data.type === "session" ? linkedNode.data : undefined;
          const projectDir = await resolveNodeProjectDir(
            linkedData?.snapshot?.projectDir,
            `agent "${label(node)}"`,
          );
          const collected: string[] = new Array(prompts.length);
          let last: InjectResult | undefined;
          const provider = data.ref.provider;

          const runOne = async (
            i: number,
            sessionId: string | undefined,
          ): Promise<InjectResult> => {
            if (opts.signal.aborted) throw new Error("run cancelled");
            if (prompts.length > 1) {
              log(
                "meta",
                `${parallelMap ? "∀∥" : "∀"} ${data.ref.name}: item ${i + 1}/${prompts.length}`,
              );
            }
            const onLog = (lane: string, line: string): void =>
              log(lane, `${data.ref.name}: ${line}`);
            const prompt = prompts[i]!;
            let result: InjectResult;
            if (provider === "opencode") {
              result = await runOpencodeAgent({
                agent: data.ref.name,
                model: data.model,
                prompt,
                projectDir,
                sessionId,
                onLog,
                signal: opts.signal,
              });
            } else if (provider === "cursor") {
              result = await runCursorAgent({
                agent: data.ref.name,
                model: data.model,
                prompt,
                projectDir,
                sessionId,
                onLog,
                signal: opts.signal,
              });
            } else if (provider === "antigravity") {
              result = await runAntigravityAgent({
                agent: data.ref.name,
                model: data.model,
                prompt,
                projectDir,
                sessionId,
                onLog,
                signal: opts.signal,
              });
            } else if (provider === "codex") {
              result = await runCodexAgent({
                agent: data.ref.name,
                model: data.model,
                prompt,
                projectDir,
                sessionId,
                sandbox: data.sandbox,
                askForApproval: data.askForApproval,
                onLog,
                signal: opts.signal,
              });
            } else if (provider === "copilot") {
              result = await runCopilotAgent({
                agent: data.ref.name,
                model: data.model,
                prompt,
                projectDir,
                sessionId,
                onLog,
                signal: opts.signal,
              });
            } else if (provider === "grok") {
              result = await runGrokAgent({
                agent: data.ref.name,
                model: data.model,
                prompt,
                projectDir,
                sessionId,
                onLog,
                signal: opts.signal,
              });
            } else {
              const defs = await registry.get("claude-code").listAgents({ projectDir });
              const def = defs.find((a) => a.name === data.ref.name);
              result = await runClaudeAgent({
                agent: data.ref.name,
                agentSystemPrompt: def?.raw ? matter(def.raw).content.trim() : undefined,
                model: data.model,
                prompt,
                projectDir,
                sessionId,
                permissionMode: data.permissionMode,
                onLog,
                signal: opts.signal,
              });
            }
            const text =
              result.resultText ?? (await lastAssistantText(result.provider, result.newSessionId));
            if (text) collected[i] = text;
            const sess = await registry
              .get(result.provider)
              .getSession?.(result.newSessionId)
              .catch(() => undefined);
            addSpend(sess?.cost ?? sess?.actualCost);
            return result;
          };

          if (parallelMap) {
            log(
              "meta",
              `∀∥ ${data.ref.name}: ${prompts.length} fresh session(s), ply ${plyLimit}`,
            );
            await mapPool(
              prompts.map((_, i) => i),
              plyLimit,
              async (i) => {
                last = await runOne(i, undefined);
              },
            );
          } else {
            let sessionId = linkedData?.ref.sessionId;
            for (let i = 0; i < prompts.length; i++) {
              last = await runOne(i, sessionId);
              sessionId = last.newSessionId;
            }
          }

          const textsOut = collected.filter((t): t is string => Boolean(t));
          outputs.set(node.id, {
            text: textsOut.join("\n\n---\n\n"),
            items: items.length ? textsOut : undefined,
            session: last && { provider: last.provider, sessionId: last.newSessionId },
            ports: agentSuccessPorts(),
          });
          await setStatus(node, "success");
          if (last) recordContextLineage(inboundEdges, nodeById, last);
          break;
        }
        case "session": {
          const data = node.data;
          const ts = texts();
          if (!ts.length) {
            outputs.set(node.id, {
              session: { provider: data.ref.provider, sessionId: data.ref.sessionId },
            });
            node.status = "success";
            break;
          }
          await setStatus(node, "running");
          const ref = data.ref;
          const onLog = (lane: string, line: string): void => log(lane, `session: ${line}`);
          const sessionArgs = {
            agent: data.snapshot?.agent,
            prompt: ts.join("\n\n---\n\n"),
            projectDir: await resolveNodeProjectDir(
              data.snapshot?.projectDir,
              `session "${label(node)}"`,
            ),
            sessionId: ref.sessionId,
            onLog,
            signal: opts.signal,
          };
          const result =
            ref.provider === "opencode"
              ? await runOpencodeAgent(sessionArgs)
              : ref.provider === "cursor"
                ? await runCursorAgent(sessionArgs)
                : ref.provider === "antigravity"
                  ? await runAntigravityAgent(sessionArgs)
                  : ref.provider === "codex"
                    ? await runCodexAgent(sessionArgs)
                    : ref.provider === "copilot"
                      ? await runCopilotAgent(sessionArgs)
                      : ref.provider === "grok"
                        ? await runGrokAgent(sessionArgs)
                        : await runClaudeAgent(sessionArgs);
          outputs.set(node.id, {
            text: result.resultText ?? (await lastAssistantText(result.provider, result.newSessionId)),
            session: { provider: result.provider, sessionId: result.newSessionId },
          });
          await setStatus(node, "success");
          recordContextLineage(inboundEdges, nodeById, result);
          const sess = await registry.get(result.provider).getSession?.(result.newSessionId).catch(() => undefined);
          addSpend(sess?.cost ?? sess?.actualCost);
          break;
        }
        case "output": {
          const src = inbound.find((i) => i.text !== undefined);
          if (!src?.text) {
            node.status = "idle";
            break;
          }
          node.data.content = src.text;
          node.data.preview = src.text.slice(0, 200);
          outputs.set(node.id, { text: src.text });
          node.status = "success";
          outputCount++;
          outputTexts.push(src.text);
          log("stdout", `⇤ output: ${src.text.slice(0, 500)}`);
          break;
        }
      }
    };

    const maxAttempts = 1 + Math.min(node.retry ?? 0, 10);
    for (let attempt = 1; ; attempt++) {
      try {
        await exec();
        break;
      } catch (err) {
        const enriched = enrichUsageExhaustionError(err);
        const msg = enriched.message;
        const usageHit = classifyUsageExhaustion(msg);
        if (usageHit) {
          log("stderr", `! ${usageHit.message}`);
        }
        if (!opts.signal.aborted && attempt < maxAttempts) {
          log("meta", `⟳ ${label(node)} failed (attempt ${attempt}/${maxAttempts}) — retrying: ${msg}`);
          await setStatus(node, "queued");
          await new Promise((r) => setTimeout(r, 800 * attempt));
          continue;
        }
        if (
          node.data.type === "agent-def" &&
          agentErrWired(eEdges, node.id) &&
          !opts.signal.aborted
        ) {
          await setStatus(node, "error");
          runFailures++;
          outputs.set(node.id, { ports: agentErrorPorts(msg) });
          log("meta", `⤵ ${label(node)} failed after ${attempt} attempt(s) — err port: ${msg}`);
          break;
        }
        if (node.continueOnError && !opts.signal.aborted) {
          await setStatus(node, "error");
          skipped.add(node.id);
          runFailures++;
          log("meta", `⤼ ${label(node)} failed after ${attempt} attempt(s) — continuing: ${msg}`);
          break;
        }
        await setStatus(node, "error");
        throw enriched;
      }
    }
    if (node.status === "success" || node.status === "error") {
      // Prefer timing from setStatus (running → done). Fallback for direct status writes.
      if (node.lastDurationMs == null) {
        node.lastDurationMs = Math.max(0, Date.now() - t0);
      }
      if (node.status === "success") {
        const out = outputs.get(node.id);
        if (out) persistNodeOutput(node.id, out);
      }
    } else {
      delete node.lastDurationMs;
    }
  }

  const pending = new Set(order.map((n) => n.id));
  const completed = new Set<string>();
  // skipped upstream counts as resolved for readiness
  const preds = predecessorMap(
    order.map((n) => n.id),
    sEdges,
  );
  if (plyLimit > 1) log("meta", `ǁ parallelism ${plyLimit}`);
  if (spendTripwireUsd != null) log("meta", `$ spend ceiling $${spendTripwireUsd}`);

  while (pending.size) {
    if (opts.signal.aborted) throw new Error("run cancelled");
    const readyIds = plyReady(pending, preds, new Set([...completed, ...skipped]));
    const ready = order.filter((n) => readyIds.includes(n.id));
    if (!ready.length) break;
    for (const n of ready) pending.delete(n.id);
    await mapPool(ready, plyLimit, async (node) => {
      await processNode(node);
      completed.add(node.id);
    });
    if (pendingReenter) {
      const req = pendingReenter;
      pendingReenter = undefined;
      for (const id of req.body) {
        outputs.delete(id);
        completed.delete(id);
        skipped.delete(id);
        pending.add(id);
        const n = nodeById(id);
        if (n) {
          n.status = "queued";
          delete n.lastDurationMs;
        }
      }
      for (const t of req.targets) {
        injectText.set(t, req.text);
      }
    }
    checkSpendTripwire();
  }

  await saveGraph(g).catch(() => undefined);
  if (opts.jobId) {
    const snap: Record<string, CachedNodeOutput> = {};
    for (const [id, out] of outputs) snap[id] = toCached(out);
    await writeJobOutputs(opts.jobId, snap);
  }
  return { outputs: outputCount, outputTexts };
}

async function lastAssistantText(provider: string, sessionId: string): Promise<string | undefined> {
  try {
    const messages = await registry.get(provider).getTranscript(sessionId);
    const lastMsg = messages.filter((m) => m.role === "assistant").at(-1);
    const text = lastMsg?.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    return text || undefined;
  } catch {
    return undefined;
  }
}

/** Same as the canvas runner: context payloads that fed an agent/session are lineage. */
function recordContextLineage(
  inboundEdges: Array<{ edge: GraphEdge }>,
  nodeById: (id: string) => GraphNode | undefined,
  result: InjectResult,
): void {
  for (const { edge } of inboundEdges) {
    const src = nodeById(edge.source);
    if (src?.data.type !== "context" || !src.data.payloadHash) continue;
    recordInject({
      ts: Date.now(),
      payloadHash: src.data.payloadHash,
      mode: "workflow",
      target: { provider: result.provider, sessionId: result.newSessionId },
      result: { provider: result.provider, sessionId: result.newSessionId },
    });
  }
}
