export type ProviderId =
  | "claude-code"
  | "opencode"
  | "cursor"
  | "antigravity"
  | "codex"
  | "copilot"
  | "grok"
  | "muse";

export type SessionStatus = "idle" | "live" | "running" | "waiting" | "unknown";
export type SessionKind = "session" | "subagent-run";

/** Process is up (open terminal / generating / waiting for input). */
export function isSessionLive(status: SessionStatus | undefined): boolean {
  return status === "live" || status === "running" || status === "waiting";
}

export interface SessionRef {
  provider: ProviderId;
  id: string;
  parentId?: string;
  projectDir: string;
  title?: string;
  agent?: string;
  model?: string;
  createdAt?: number;
  updatedAt: number;
  status: SessionStatus;
  kind: SessionKind;
  messageCount?: number;
  tokensIn?: number;
  tokensOut?: number;
  tokensReasoning?: number;
  tokensCacheRead?: number;
  tokensCacheWrite?: number;
  /** tracked cost: list-price value of the tokens (what the API would bill) */
  cost?: number;
  /** actual spend: what was really paid — 0 for subscription-billed sessions */
  actualCost?: number;
  meta?: Record<string, unknown>;
}

export type ContentPartType =
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "patch"
  | "attachment"
  | "other";

export interface ContentPart {
  type: ContentPartType;
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  toolUseId?: string;
  isError?: boolean;
}

export interface NormalizedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: ContentPart[];
  timestamp?: number;
  synthetic?: boolean;
  tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  cost?: number;
}

export type FileOp = "read" | "write" | "edit" | "create" | "delete" | "patch";

export interface TouchedFile {
  path: string;
  op: FileOp;
  lastSeenAt?: number;
  /** line churn, summed across the session's edits of this file */
  additions?: number;
  deletions?: number;
  /** bytes written (Write/Edit payload sizes; approximate) */
  bytes?: number;
  /** edited line ranges like "+120–134" (available when patch hunks exist) */
  hunks?: string[];
}

export interface AgentDef {
  provider: ProviderId;
  name: string;
  description?: string;
  source: string;
  scope: "project" | "user" | "builtin";
  /** agent type used for palette sub-grouping (opencode: primary/subagent; claude: subagent) */
  kind?: string;
  model?: string;
  raw?: string;
}

export interface ProviderInfo {
  id: ProviderId;
  available: boolean;
  version?: string;
  storage?: { path: string; bytes: number; files: number };
}
