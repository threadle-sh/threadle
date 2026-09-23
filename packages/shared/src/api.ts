import type { ProviderId, SessionRef } from "./session.js";
import type { ContextConfig, ContextPayload } from "./context.js";
import type { NodeStatus } from "./graph.js";

export interface SourceRef {
  provider: ProviderId;
  sessionId: string;
}

export interface ContextRequest {
  source: SourceRef;
  config: ContextConfig;
}

export type InjectMode =
  | "new-session"
  | "resume-fork"
  | "continue"
  | "synthetic";

export interface InjectTarget {
  provider: ProviderId;
  mode: InjectMode;
  sessionId?: string;
  projectDir: string;
  agent?: string;
  model?: string;
}

export interface InjectRequest {
  payloadHash: string;
  target: InjectTarget;
  kickoffPrompt?: string;
}

export interface InjectResult {
  newSessionId: string;
  provider: ProviderId;
  resultText?: string;
  /** Optional first-turn usage (when the CLI reports it). */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface DistillJobAccepted {
  jobId: string;
}

export interface RunAgentRequest {
  provider: ProviderId;
  agent: string;
  model?: string;
  prompt: string;
  projectDir: string;
  /** continue this existing session instead of starting a fresh one */
  sessionId?: string;
  /** the workflow (graph) that launched this run, for lineage/back-links */
  graphId?: string;
  /** Claude Code permission mode override */
  permissionMode?: string;
  /** Codex sandbox mode */
  sandbox?: string;
  /** Codex ask-for-approval mode */
  askForApproval?: string;
  /** Override Settings harnessExtras for this spawn (provider-specific skips). */
  harnessExtras?: boolean;
  /** @deprecated use harnessExtras */
  museReminders?: boolean;
  /**
   * Skip project AGENTS.md / CLAUDE.md / rules: run in an empty bare workspace
   * (+ provider flags where available). Useful for cheap smoke / test-pilot.
   */
  ignoreLocalMarkdown?: boolean;
  /** Mark the resulting session as a Settings test-pilot smoke run. */
  pilot?: boolean;
  /** Optional pilot case id recorded with the mark (e.g. muse:extras-off). */
  pilotCaseId?: string;
}

export interface RunSessionRequest {
  provider: ProviderId;
  sessionId: string;
  prompt: string;
  projectDir: string;
  model?: string;
  /** keep the session's persona when known (opencode --agent / claude builtins) */
  agent?: string;
  /** the workflow (graph) that launched this run, for lineage/back-links */
  graphId?: string;
}

export interface ModelInfo {
  provider: ProviderId;
  id: string;
}

/** SSE event names and payloads pushed on /api/events */
export type ServerEvent =
  | { type: "sessions.changed"; provider: ProviderId }
  | { type: "live.status"; statuses: Array<Pick<SessionRef, "provider" | "id" | "status">> }
  | { type: "job.progress"; jobId: string; message: string }
  | {
      type: "job.log";
      jobId: string;
      /** stream lane: assistant text, reasoning, tool call, raw process, or run metrics */
      lane: "text" | "thinking" | "tool" | "raw" | "meta";
      line: string;
    }
  | { type: "job.done"; jobId: string; payload?: ContextPayload; inject?: InjectResult }
  | { type: "job.error"; jobId: string; error: string }
  /** Mid-run node status from a detached workflow (active border, canvas paint). */
  | { type: "job.node"; jobId: string; graphId: string; nodeId: string; status: NodeStatus };
