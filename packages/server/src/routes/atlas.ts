import { Hono } from "hono";
import {
  atlasSessionKey,
  graphKind,
  type AgentDef,
  type Graph,
  type SessionRef,
} from "@threadle/shared";
import { registry } from "../providers/registry.js";
import { listGraphs, readGraph } from "../graphs/store.js";
import { jobs } from "../jobs.js";
import { readInjects, readPayloadMetas } from "./lineage.js";
import { projectArtifacts } from "./rules.js";
import { buildAtlasDocument, type AtlasGraphScan, type AtlasJobLink } from "../atlas/build.js";

export const atlasRoutes = new Hono();

async function listProjectSessions(dir: string): Promise<SessionRef[]> {
  const lists = await Promise.all(
    [...registry.providers.values()].map(async (p) => {
      try {
        if (!(await p.available())) return [];
        return await p.listSessions({ projectDir: dir });
      } catch (err) {
        console.warn(`threadle: atlas listSessions failed for ${p.id}: ${String(err)}`);
        return [];
      }
    }),
  );
  return lists.flat();
}

async function listProjectAgents(dir: string): Promise<AgentDef[]> {
  const lists = await Promise.all(
    [...registry.providers.values()].map(async (p) => {
      try {
        if (!(await p.available())) return [];
        return await p.listAgents({ projectDir: dir });
      } catch (err) {
        console.warn(`threadle: atlas listAgents failed for ${p.id}: ${String(err)}`);
        return [];
      }
    }),
  );
  return lists.flat();
}

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

async function scanGraphs(): Promise<AtlasGraphScan[]> {
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

/**
 * GET /api/atlas?dir=/abs/path
 * Project-scoped summary graph: sessions, contexts, workflows, agents, rules, skills.
 */
atlasRoutes.get("/", async (c) => {
  const dir = c.req.query("dir")?.trim();
  if (!dir) return c.json({ error: "dir query required" }, 400);

  const [sessions, payloads, injects, graphs, jobList, agents, artifacts] =
    await Promise.all([
      listProjectSessions(dir),
      readPayloadMetas(),
      readInjects(),
      scanGraphs(),
      jobs.listWithHistory(500),
      listProjectAgents(dir),
      projectArtifacts(dir),
    ]);

  const jobLinks: AtlasJobLink[] = jobList.map((j) => {
    const inj = j.result?.inject;
    return {
      graphId: j.graphId,
      sessionKey: inj
        ? atlasSessionKey(inj.provider, inj.newSessionId)
        : undefined,
    };
  });

  const doc = buildAtlasDocument({
    dir,
    sessions,
    payloads,
    injects,
    graphs,
    jobs: jobLinks,
    agents,
    artifacts: artifacts.map((a) => ({
      path: a.path,
      name: a.name,
      kind: a.kind,
      source: a.source,
      size: a.size,
      mtime: a.mtime,
      description: a.description,
    })),
  });

  return c.json(doc);
});
