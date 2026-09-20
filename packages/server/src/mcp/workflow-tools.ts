import path from "node:path";
import { assessDetachedReadiness, type WorkflowParam } from "@threadle/shared";
import { listGraphs, readGraph } from "../graphs/store.js";
import { isKnownProjectDir } from "../readable-paths.js";
import { executeWorkflow } from "../workflows/executor.js";
import { readSettings } from "../routes/settings.js";
import {
  coerceToolArgsToParams,
  graphIdFromToolName,
  paramsToZodShape,
  toolNameForGraphId,
} from "./schema.js";

export interface WorkflowToolMeta {
  name: string;
  title: string;
  description: string;
  graphId: string;
  params: WorkflowParam[];
  inputSchema: ReturnType<typeof paramsToZodShape>;
}

function mcpDepth(): number {
  const raw = process.env.THREADLE_MCP_DEPTH?.trim();
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function mcpCallStack(): string[] {
  const raw = process.env.THREADLE_MCP_STACK?.trim();
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function assertMcpInvokeAllowed(graphId: string): void {
  if (mcpDepth() >= 1) {
    throw new Error(
      "MCP recursion refused — THREADLE_MCP_DEPTH ≥ 1 (workflow tools cannot nest)",
    );
  }
  if (mcpCallStack().includes(graphId)) {
    throw new Error(`MCP re-entry refused for graph ${graphId}`);
  }
}

/** List saved top-level workflows as MCP tool descriptors (skip subgraphs). */
export async function listWorkflowTools(): Promise<WorkflowToolMeta[]> {
  const settings = await readSettings();
  const allow = settings.mcpPublishAllowlist;
  // null = all; [] / missing = none (default deny)
  if (allow !== null && allow !== undefined) {
    if (allow.length === 0) return [];
  }
  const allowSet = allow === null || allow === undefined ? null : new Set(allow);

  const summaries = await listGraphs();
  const out: WorkflowToolMeta[] = [];
  for (const s of summaries) {
    if (s.kind === "subgraph") continue;
    if (allowSet && !allowSet.has(s.id)) continue;
    const g = await readGraph(s.id);
    if (!g) continue;
    if (g.kind === "subgraph") continue;
    const params = g.params ?? [];
    out.push({
      name: toolNameForGraphId(g.id),
      title: g.name,
      description: g.params?.length
        ? `Run workflow "${g.name}" (${g.id}) with typed params`
        : `Run workflow "${g.name}" (${g.id})`,
      graphId: g.id,
      params,
      inputSchema: paramsToZodShape(params),
    });
  }
  return out;
}

export async function invokeWorkflowTool(opts: {
  toolName: string;
  args: Record<string, unknown>;
  projectDir?: string;
}): Promise<{ text: string; outputTexts: string[]; outputs: number }> {
  const graphId = graphIdFromToolName(opts.toolName);
  if (!graphId) throw new Error(`unknown tool "${opts.toolName}"`);

  assertMcpInvokeAllowed(graphId);

  const settings = await readSettings();
  const allow = settings.mcpPublishAllowlist;
  if (allow === null || allow === undefined) {
    // publish-all opt-in
  } else if (!allow.includes(graphId)) {
    throw new Error(
      allow.length === 0
        ? `no workflows published — add graph ids under Settings → MCP publish allowlist`
        : `workflow "${graphId}" is not on the MCP publish allowlist`,
    );
  }

  const g = await readGraph(graphId);
  if (!g) throw new Error(`no workflow with id ${graphId}`);
  if (g.kind === "subgraph") throw new Error(`"${graphId}" is a subgraph — not exposed as an MCP tool`);

  const readiness = assessDetachedReadiness(g);
  const gates = readiness.filter(
    (i) => i.kind === "approval" || i.kind === "live-handoff",
  );
  const blockers = readiness.filter(
    (i) => i.blocking && i.kind !== "approval" && i.kind !== "live-handoff",
  );
  if (blockers.length) {
    throw new Error(
      `workflow not ready: ${blockers.map((b) => b.message ?? b.label).join("; ")}`,
    );
  }
  // Park / splice — MCP must not auto-pass human gates. Run from the UI with splice instead.
  if (gates.length) {
    throw new Error(
      `workflow has ${gates.length} interactive gate(s) (approval / live handoff) — ` +
        `run it in the threadle UI with splice; MCP will not auto-approve`,
    );
  }

  const params = coerceToolArgsToParams(opts.args, g.params);
  const projectDir = path.resolve(opts.projectDir ?? process.cwd());
  // Same containment rule as the HTTP run surfaces — the cwd decides which
  // .claude/settings.json / .mcp.json the spawned agent CLIs trust.
  if (opts.projectDir && !(await isKnownProjectDir(projectDir))) {
    throw new Error(`projectDir is not a known project directory: ${projectDir}`);
  }
  const depth = mcpDepth();
  const stack = [...mcpCallStack(), graphId];

  const prevDepth = process.env.THREADLE_MCP_DEPTH;
  const prevStack = process.env.THREADLE_MCP_STACK;
  process.env.THREADLE_MCP_DEPTH = String(depth + 1);
  process.env.THREADLE_MCP_STACK = stack.join(",");

  const ac = new AbortController();
  try {
    const res = await executeWorkflow({
      graphId,
      params,
      approveAll: false,
      projectDir,
      signal: ac.signal,
      log: (lane, line) => {
        // stdout is MCP protocol — always stderr
        console.error(`[mcp:${graphId}] ${lane} ${line}`);
      },
    });
    const text =
      res.outputTexts.length > 0
        ? res.outputTexts.join("\n\n---\n\n")
        : `(workflow "${g.name}" finished with ${res.outputs} output node(s), no text)`;
    return { text, outputTexts: res.outputTexts, outputs: res.outputs };
  } finally {
    if (prevDepth === undefined) delete process.env.THREADLE_MCP_DEPTH;
    else process.env.THREADLE_MCP_DEPTH = prevDepth;
    if (prevStack === undefined) delete process.env.THREADLE_MCP_STACK;
    else process.env.THREADLE_MCP_STACK = prevStack;
  }
}
