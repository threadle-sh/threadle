import { atlasSessionKey } from "@threadle/shared";
import { graphKind, type Graph } from "@threadle/workflows-shared";
import type { AtlasGraphScan } from "@threadle/core/atlas/build.js";
import { listGraphs, readGraph } from "../graphs/store.js";

function sessionKeysFromGraph(g: Graph): string[] {
  const keys: string[] = [];
  for (const n of g.nodes) {
    if (n.data.type !== "session" && n.data.type !== "subagent-run") continue;
    const ref = n.data.ref;
    if (ref?.provider && ref.sessionId) {
      keys.push(atlasSessionKey(ref.provider, ref.sessionId));
    }
  }
  return keys;
}

/** Workflows reduced to what the project atlas shows (core asks via the port). */
export async function scanGraphsForAtlas(): Promise<AtlasGraphScan[]> {
  const summaries = await listGraphs();
  const out: AtlasGraphScan[] = [];
  for (const s of summaries) {
    try {
      const g = await readGraph(s.id);
      if (!g) continue;
      out.push({
        id: g.id,
        name: g.name,
        kind: graphKind(g),
        nodeCount: g.nodes.length,
        updatedAt: g.updatedAt,
        sessionKeys: sessionKeysFromGraph(g),
      });
    } catch {
      // skip unreadable / invalid graphs
    }
  }
  return out;
}
