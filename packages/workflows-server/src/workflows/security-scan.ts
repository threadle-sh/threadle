import type { AgentDefNodeData } from "@threadle/workflows-shared";
import { listGraphs, readGraph } from "../graphs/store.js";

export interface ElevatedAgentNode {
  name: string;
  provider: string;
  setting: string;
  graphId: string;
  graphName: string;
  /** bypassPermissions / danger-full-access */
  elevated: boolean;
}

function agentElevatedSetting(d: AgentDefNodeData): { setting: string; elevated: boolean } | null {
  if (d.permissionMode && d.permissionMode !== "default") {
    return {
      setting: `perm ${d.permissionMode}`,
      elevated: d.permissionMode === "bypassPermissions",
    };
  }
  if (d.sandbox && d.sandbox !== "workspace-write") {
    return {
      setting: `sandbox ${d.sandbox}`,
      elevated: d.sandbox === "danger-full-access",
    };
  }
  if (d.askForApproval && d.askForApproval !== "never") {
    return { setting: `ask ${d.askForApproval}`, elevated: false };
  }
  return null;
}

export async function elevatedAgentNodes(limit = 200): Promise<ElevatedAgentNode[]> {
  const rows: ElevatedAgentNode[] = [];
  const summaries = (await listGraphs()).slice(0, limit);
  await Promise.all(
    summaries.map(async (s) => {
      try {
        const g = await readGraph(s.id);
        if (!g) return;
        for (const n of g.nodes) {
          if (n.data.type !== "agent-def") continue;
          const hit = agentElevatedSetting(n.data);
          if (!hit) continue;
          rows.push({
            name: n.data.label || n.data.ref.name,
            provider: n.data.ref.provider,
            setting: hit.setting,
            graphId: g.id,
            graphName: g.name,
            elevated: hit.elevated,
          });
        }
      } catch {
        // skip unloadable graphs
      }
    }),
  );
  rows.sort((a, b) => a.graphName.localeCompare(b.graphName) || a.name.localeCompare(b.name));
  return rows;
}
