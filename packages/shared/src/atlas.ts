import { z } from "zod";

/** Layer hubs under a project root. */
export const atlasHubIdSchema = z.enum([
  "sessions",
  "contexts",
  "workflows",
  "agents",
  "rules",
  "skills",
]);
export type AtlasHubId = z.infer<typeof atlasHubIdSchema>;

export const atlasEdgeKindSchema = z.enum([
  "project-has",
  "hub-child",
  "session-child",
  "context-from",
  "context-inject",
  "graph-uses-session",
  "session-uses-agent",
]);
export type AtlasEdgeKind = z.infer<typeof atlasEdgeKindSchema>;

export const atlasSessionSummarySchema = z.object({
  id: z.string(),
  provider: z.string(),
  parentId: z.string().optional(),
  title: z.string().optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
  status: z.string(),
  kind: z.enum(["session", "subagent-run"]),
  updatedAt: z.number(),
  messageCount: z.number().optional(),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
  /** child sessions (subagents) counted in this project */
  childCount: z.number().int().nonnegative().default(0),
  /** contexts extracted from this session */
  contextOutCount: z.number().int().nonnegative().default(0),
  /** contexts injected into this session */
  contextInCount: z.number().int().nonnegative().default(0),
});
export type AtlasSessionSummary = z.infer<typeof atlasSessionSummarySchema>;

export const atlasContextSummarySchema = z.object({
  hash: z.string(),
  kind: z.string(),
  createdAt: z.number(),
  chars: z.number(),
  preview: z.string(),
  source: z.object({ provider: z.string(), sessionId: z.string() }),
});
export type AtlasContextSummary = z.infer<typeof atlasContextSummarySchema>;

export const atlasWorkflowSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string().optional(),
  nodeCount: z.number().int().nonnegative(),
  updatedAt: z.number(),
  /** session keys (`provider:id`) this graph references */
  sessionKeys: z.array(z.string()).default([]),
});
export type AtlasWorkflowSummary = z.infer<typeof atlasWorkflowSummarySchema>;

export const atlasAgentSummarySchema = z.object({
  provider: z.string(),
  name: z.string(),
  description: z.string().optional(),
  source: z.string(),
  scope: z.enum(["project", "user", "builtin"]),
  kind: z.string().optional(),
  model: z.string().optional(),
});
export type AtlasAgentSummary = z.infer<typeof atlasAgentSummarySchema>;

export const atlasArtifactSummarySchema = z.object({
  path: z.string(),
  name: z.string(),
  kind: z.enum(["rules", "agent", "skill"]),
  source: z.string(),
  size: z.number(),
  mtime: z.number(),
  description: z.string().optional(),
});
export type AtlasArtifactSummary = z.infer<typeof atlasArtifactSummarySchema>;

export const atlasEdgeSchema = z.object({
  id: z.string(),
  kind: atlasEdgeKindSchema,
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
});
export type AtlasEdge = z.infer<typeof atlasEdgeSchema>;

export const atlasLayersSchema = z.object({
  sessions: z.array(atlasSessionSummarySchema),
  contexts: z.array(atlasContextSummarySchema),
  workflows: z.array(atlasWorkflowSummarySchema),
  agents: z.array(atlasAgentSummarySchema),
  rules: z.array(atlasArtifactSummarySchema),
  skills: z.array(atlasArtifactSummarySchema),
});
export type AtlasLayers = z.infer<typeof atlasLayersSchema>;

export const atlasDocumentSchema = z.object({
  dir: z.string(),
  layers: atlasLayersSchema,
  edges: z.array(atlasEdgeSchema),
});
export type AtlasDocument = z.infer<typeof atlasDocumentSchema>;

/** Stable node id helpers shared by server + UI. */
export function atlasProjectId(): string {
  return "project";
}
export function atlasHubNodeId(hub: AtlasHubId): string {
  return `hub:${hub}`;
}
export function atlasSessionNodeId(provider: string, id: string): string {
  return `session:${provider}:${id}`;
}
export function atlasContextNodeId(hash: string): string {
  return `context:${hash}`;
}
export function atlasWorkflowNodeId(id: string): string {
  return `workflow:${id}`;
}
export function atlasAgentNodeId(provider: string, name: string): string {
  return `agent:${provider}:${name}`;
}
export function atlasArtifactNodeId(path: string): string {
  return `artifact:${path}`;
}
export function atlasSessionKey(provider: string, id: string): string {
  return `${provider}:${id}`;
}
