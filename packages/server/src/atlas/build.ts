import {
  atlasAgentNodeId,
  atlasArtifactNodeId,
  atlasContextNodeId,
  atlasDocumentSchema,
  atlasHubNodeId,
  atlasProjectId,
  atlasSessionKey,
  atlasSessionNodeId,
  atlasWorkflowNodeId,
  type AtlasDocument,
  type AtlasEdge,
  type AtlasHubId,
  type AgentDef,
  type SessionRef,
} from "@threadle/shared";

export interface AtlasPayloadMeta {
  hash: string;
  kind: string;
  createdAt: number;
  chars: number;
  preview: string;
  source: { provider: string; sessionId: string };
}

export interface AtlasInjectMeta {
  ts: number;
  payloadHash: string;
  mode: string;
  target: { provider: string; sessionId?: string };
  result?: { provider: string; sessionId: string };
}

export interface AtlasGraphScan {
  id: string;
  name: string;
  kind?: string;
  nodeCount: number;
  updatedAt: number;
  /** session keys referenced by session / subagent-run nodes */
  sessionKeys: string[];
}

export interface AtlasJobLink {
  graphId?: string;
  /** session produced/continued by the job, when known */
  sessionKey?: string;
}

export interface AtlasArtifactMeta {
  path: string;
  name: string;
  kind: "rules" | "agent" | "skill";
  source: string;
  size: number;
  mtime: number;
  description?: string;
}

export interface BuildAtlasInput {
  dir: string;
  sessions: SessionRef[];
  payloads: AtlasPayloadMeta[];
  injects: AtlasInjectMeta[];
  graphs: AtlasGraphScan[];
  /** jobs that may link a graphId to a project session */
  jobs: AtlasJobLink[];
  agents: AgentDef[];
  artifacts: AtlasArtifactMeta[];
}

function sessionKeySet(sessions: SessionRef[]): Set<string> {
  const keys = new Set<string>();
  for (const s of sessions) keys.add(atlasSessionKey(s.provider, s.id));
  return keys;
}

/**
 * Pure atlas document builder — filters + wires layers for a project dir.
 * Callers fetch raw data; this keeps filtering testable without providers.
 */
export function buildAtlasDocument(input: BuildAtlasInput): AtlasDocument {
  const keys = sessionKeySet(input.sessions);
  const childrenByParent = new Map<string, number>();
  for (const s of input.sessions) {
    if (!s.parentId) continue;
    // parent may be same provider (typical) — match by id within provider
    const parentKey = atlasSessionKey(s.provider, s.parentId);
    childrenByParent.set(parentKey, (childrenByParent.get(parentKey) ?? 0) + 1);
  }

  // Contexts that touch this project's sessions (source extract or inject target).
  // Prefer provider:session keys; fall back to session id alone so a provider
  // string mismatch still attaches extracts to the project map.
  const sessionIdsInProject = new Set(input.sessions.map((s) => s.id));
  const contextByHash = new Map<string, AtlasPayloadMeta>();
  for (const p of input.payloads) {
    const srcKey = atlasSessionKey(p.source.provider, p.source.sessionId);
    if (keys.has(srcKey) || sessionIdsInProject.has(p.source.sessionId)) {
      contextByHash.set(p.hash, p);
    }
  }

  const injectsForProject: AtlasInjectMeta[] = [];
  for (const inj of input.injects) {
    const targetId = inj.result?.sessionId ?? inj.target.sessionId;
    const targetProv = inj.result?.provider ?? inj.target.provider;
    const targetInProject =
      !!targetId && keys.has(atlasSessionKey(targetProv, targetId));
    const payloadInProject = contextByHash.has(inj.payloadHash);
    if (!targetInProject && !payloadInProject) continue;
    injectsForProject.push(inj);
    if (targetInProject && !payloadInProject) {
      const meta = input.payloads.find((p) => p.hash === inj.payloadHash);
      if (meta) contextByHash.set(meta.hash, meta);
    }
  }

  const contextsDedup = [...contextByHash.values()].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  const contextHashes = new Set(contextsDedup.map((c) => c.hash));

  const contextOut = new Map<string, number>();
  const contextIn = new Map<string, number>();
  for (const c of contextsDedup) {
    const k = atlasSessionKey(c.source.provider, c.source.sessionId);
    contextOut.set(k, (contextOut.get(k) ?? 0) + 1);
  }
  for (const inj of injectsForProject) {
    const sid = inj.result?.sessionId ?? inj.target.sessionId;
    const prov = inj.result?.provider ?? inj.target.provider;
    if (!sid) continue;
    const k = atlasSessionKey(prov, sid);
    if (!keys.has(k)) continue;
    contextIn.set(k, (contextIn.get(k) ?? 0) + 1);
  }

  const sessions = input.sessions
    .map((s) => {
      const k = atlasSessionKey(s.provider, s.id);
      return {
        id: s.id,
        provider: s.provider,
        parentId: s.parentId,
        title: s.title,
        agent: s.agent,
        model: s.model,
        status: s.status,
        kind: s.kind,
        updatedAt: s.updatedAt,
        messageCount: s.messageCount,
        tokensIn: s.tokensIn,
        tokensOut: s.tokensOut,
        childCount: childrenByParent.get(k) ?? 0,
        contextOutCount: contextOut.get(k) ?? 0,
        contextInCount: contextIn.get(k) ?? 0,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);

  // Workflows: graph references a project session, or a job linked graph+session
  const workflowIds = new Set<string>();
  const workflows: AtlasDocument["layers"]["workflows"] = [];
  for (const g of input.graphs) {
    const hit = g.sessionKeys.filter((k) => keys.has(k));
    if (!hit.length) continue;
    workflowIds.add(g.id);
    workflows.push({
      id: g.id,
      name: g.name,
      kind: g.kind,
      nodeCount: g.nodeCount,
      updatedAt: g.updatedAt,
      sessionKeys: hit,
    });
  }
  for (const job of input.jobs) {
    if (!job.graphId || !job.sessionKey || !keys.has(job.sessionKey)) continue;
    if (workflowIds.has(job.graphId)) {
      const existing = workflows.find((w) => w.id === job.graphId);
      if (existing && !existing.sessionKeys.includes(job.sessionKey)) {
        existing.sessionKeys.push(job.sessionKey);
      }
      continue;
    }
    const g = input.graphs.find((x) => x.id === job.graphId);
    if (!g) continue;
    workflowIds.add(g.id);
    workflows.push({
      id: g.id,
      name: g.name,
      kind: g.kind,
      nodeCount: g.nodeCount,
      updatedAt: g.updatedAt,
      sessionKeys: [job.sessionKey],
    });
  }
  workflows.sort((a, b) => b.updatedAt - a.updatedAt);

  const agents = input.agents.map((a) => ({
    provider: a.provider,
    name: a.name,
    description: a.description,
    source: a.source,
    scope: a.scope,
    kind: a.kind,
    model: a.model,
  }));

  const rules = input.artifacts
    .filter((a) => a.kind === "rules" || a.kind === "agent")
    .map((a) => ({
      path: a.path,
      name: a.name,
      kind: a.kind,
      source: a.source,
      size: a.size,
      mtime: a.mtime,
      description: a.description,
    }));
  const skills = input.artifacts
    .filter((a) => a.kind === "skill")
    .map((a) => ({
      path: a.path,
      name: a.name,
      kind: a.kind as "skill",
      source: a.source,
      size: a.size,
      mtime: a.mtime,
      description: a.description,
    }));

  const edges: AtlasEdge[] = [];
  const projectId = atlasProjectId();
  const hubs: AtlasHubId[] = [
    "sessions",
    "contexts",
    "workflows",
    "agents",
    "rules",
    "skills",
  ];
  for (const hub of hubs) {
    edges.push({
      id: `e-project-${hub}`,
      kind: "project-has",
      source: projectId,
      target: atlasHubNodeId(hub),
    });
  }

  for (const s of sessions) {
    const nid = atlasSessionNodeId(s.provider, s.id);
    edges.push({
      id: `e-hub-sess-${s.provider}-${s.id}`,
      kind: "hub-child",
      source: atlasHubNodeId("sessions"),
      target: nid,
    });
    if (s.parentId) {
      const parentNid = atlasSessionNodeId(s.provider, s.parentId);
      // only wire if parent is in this project
      if (keys.has(atlasSessionKey(s.provider, s.parentId))) {
        edges.push({
          id: `e-child-${s.provider}-${s.id}`,
          kind: "session-child",
          source: parentNid,
          target: nid,
          label: "sub",
        });
      }
    }
  }

  for (const c of contextsDedup) {
    const cid = atlasContextNodeId(c.hash);
    edges.push({
      id: `e-hub-ctx-${c.hash}`,
      kind: "hub-child",
      source: atlasHubNodeId("contexts"),
      target: cid,
    });
    const srcKey = atlasSessionKey(c.source.provider, c.source.sessionId);
    if (keys.has(srcKey)) {
      edges.push({
        id: `e-ctx-from-${c.hash}`,
        kind: "context-from",
        source: atlasSessionNodeId(c.source.provider, c.source.sessionId),
        target: cid,
        label: "extract",
      });
    }
  }

  for (const inj of injectsForProject) {
    const sid = inj.result?.sessionId ?? inj.target.sessionId;
    const prov = inj.result?.provider ?? inj.target.provider;
    if (!sid || !contextHashes.has(inj.payloadHash)) continue;
    if (!keys.has(atlasSessionKey(prov, sid))) continue;
    edges.push({
      id: `e-ctx-inj-${inj.payloadHash}-${prov}-${sid}-${inj.ts}`,
      kind: "context-inject",
      source: atlasContextNodeId(inj.payloadHash),
      target: atlasSessionNodeId(prov, sid),
      label: inj.mode,
    });
  }

  for (const w of workflows) {
    const wid = atlasWorkflowNodeId(w.id);
    edges.push({
      id: `e-hub-wf-${w.id}`,
      kind: "hub-child",
      source: atlasHubNodeId("workflows"),
      target: wid,
    });
    for (const sk of w.sessionKeys) {
      const [provider, ...rest] = sk.split(":");
      const sessionId = rest.join(":");
      if (!provider || !sessionId || !keys.has(sk)) continue;
      edges.push({
        id: `e-wf-${w.id}-${sk}`,
        kind: "graph-uses-session",
        source: wid,
        target: atlasSessionNodeId(provider, sessionId),
        label: "uses",
      });
    }
  }

  for (const a of agents) {
    edges.push({
      id: `e-hub-agent-${a.provider}-${a.name}`,
      kind: "hub-child",
      source: atlasHubNodeId("agents"),
      target: atlasAgentNodeId(a.provider, a.name),
    });
  }

  // Session → agent when the session's agent name matches a known def
  const agentByKey = new Map<string, (typeof agents)[number]>();
  for (const a of agents) {
    agentByKey.set(`${a.provider}:${a.name.toLowerCase()}`, a);
    // also index by name alone for cross-provider soft match
    if (!agentByKey.has(`*:${a.name.toLowerCase()}`)) {
      agentByKey.set(`*:${a.name.toLowerCase()}`, a);
    }
  }
  for (const s of sessions) {
    if (!s.agent?.trim()) continue;
    const name = s.agent.trim().toLowerCase();
    const hit =
      agentByKey.get(`${s.provider}:${name}`) ?? agentByKey.get(`*:${name}`);
    if (!hit) continue;
    edges.push({
      id: `e-sess-agent-${s.provider}-${s.id}-${hit.provider}-${hit.name}`,
      kind: "session-uses-agent",
      source: atlasSessionNodeId(s.provider, s.id),
      target: atlasAgentNodeId(hit.provider, hit.name),
      label: "agent",
    });
  }

  for (const r of rules) {
    edges.push({
      id: `e-hub-rules-${r.path}`,
      kind: "hub-child",
      source: atlasHubNodeId("rules"),
      target: atlasArtifactNodeId(r.path),
    });
  }
  for (const sk of skills) {
    edges.push({
      id: `e-hub-skill-${sk.path}`,
      kind: "hub-child",
      source: atlasHubNodeId("skills"),
      target: atlasArtifactNodeId(sk.path),
    });
  }

  const doc = {
    dir: input.dir,
    layers: {
      sessions,
      contexts: contextsDedup,
      workflows,
      agents,
      rules,
      skills,
    },
    edges,
  };
  return atlasDocumentSchema.parse(doc);
}
