/**
 * Human-readable inventory of what a graph will EXECUTE when run — the body
 * of the first-run confirmation for imported workflows (server 428 payload,
 * CLI printout, web modal). Unlike `assessDetachedReadiness`, this includes
 * muted/bypassed nodes (they can be unmuted after confirming) and reports
 * privilege-relevant fields (permission mode, sandbox, cwd, params).
 */
import type { Graph } from "./graph.js";

export interface ManifestItem {
  nodeId: string;
  label: string;
  /** what kind of execution this is */
  kind:
    | "agent"
    | "custom-node"
    | "mcp-tool"
    | "skill-invoke"
    | "session"
    | "live-handoff"
    | "synthesize"
    | "linked-graph";
  /** one-line description of what runs */
  detail: string;
  /** privilege-relevant extras, already stringified for display */
  flags?: string[];
  muted?: boolean;
}

function pushFlag(flags: string[], name: string, value: string | undefined): void {
  if (value) flags.push(`${name}: ${value}`);
}

export function summarizeGraphExecution(g: Graph): ManifestItem[] {
  const out: ManifestItem[] = [];
  for (const n of g.nodes) {
    const d = n.data;
    const muted = n.muted || n.bypassed ? true : undefined;
    const base = { nodeId: n.id, muted };
    switch (d.type) {
      case "agent-def": {
        const flags: string[] = [];
        pushFlag(flags, "permission", d.permissionMode);
        pushFlag(flags, "sandbox", d.sandbox);
        pushFlag(flags, "approval", d.askForApproval);
        pushFlag(flags, "model", d.model);
        out.push({
          ...base,
          label: d.label || d.ref.name,
          kind: "agent",
          detail: `runs the ${d.ref.provider} agent CLI (“${d.ref.name}”)`,
          flags: flags.length ? flags : undefined,
        });
        break;
      }
      case "custom": {
        const params = Object.entries(d.params ?? {})
          .map(([k, v]) => `${k}=${String(v).slice(0, 80)}`)
          .join(", ");
        out.push({
          ...base,
          label: d.label || d.ref.name,
          kind: "custom-node",
          detail: `executes the locally installed custom node “${d.ref.name}”`,
          flags: params ? [`params: ${params}`] : undefined,
        });
        break;
      }
      case "mcp-tool":
        out.push({
          ...base,
          label: d.label || d.tool || d.ref.server || "mcp-tool",
          kind: "mcp-tool",
          detail: `calls MCP tool “${d.tool ?? "?"}” on server “${d.ref.server}”`,
        });
        break;
      case "skill":
        if (d.mode === "invoke") {
          out.push({
            ...base,
            label: d.label || d.name || "skill",
            kind: "skill-invoke",
            detail: `invokes skill “${d.name ?? "?"}” via ${d.provider ?? "claude-code"}`,
            flags: d.model ? [`model: ${d.model}`] : undefined,
          });
        }
        break;
      case "session":
        out.push({
          ...base,
          label: d.label || d.snapshot?.title || d.ref.sessionId.slice(0, 8) || "session",
          kind: "session",
          detail: `continues a ${d.ref.provider} session`,
          flags: d.snapshot?.projectDir ? [`cwd: ${d.snapshot.projectDir}`] : undefined,
        });
        break;
      case "live-handoff":
        out.push({
          ...base,
          label: d.label || d.ref?.name || "live handoff",
          kind: "live-handoff",
          detail: `live handoff to a ${d.ref?.provider ?? "?"} agent`,
        });
        break;
      case "knot":
        if (d.provider) {
          out.push({
            ...base,
            label: d.label || "knot",
            kind: "synthesize",
            detail: `synthesizes via ${d.provider}${d.model ? ` (${d.model})` : ""}`,
          });
        }
        break;
      case "group":
        if (d.graphId) {
          out.push({
            ...base,
            label: d.label || "linked sub-workflow",
            kind: "linked-graph",
            detail: `runs the linked local workflow “${d.graphId}” — review it separately`,
          });
        }
        break;
      default:
        break;
    }
  }
  return out;
}
