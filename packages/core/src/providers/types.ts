import type {
  AgentDef,
  ContextPayload,
  InjectResult,
  InjectTarget,
  NormalizedMessage,
  ProviderId,
  SessionRef,
  SessionStatus,
  TouchedFile,
} from "@threadle/shared";

export interface ListSessionsOptions {
  projectDir?: string;
}

export interface InjectOptions {
  kickoffPrompt?: string;
}

export interface SessionProvider {
  readonly id: ProviderId;
  available(): Promise<boolean>;
  version(): Promise<string | undefined>;
  listSessions(opts?: ListSessionsOptions): Promise<SessionRef[]>;
  listChildren(sessionId: string): Promise<SessionRef[]>;
  getSession(sessionId: string): Promise<SessionRef | undefined>;
  getTranscript(sessionId: string): Promise<NormalizedMessage[]>;
  /** full history including abandoned branches; falls back to getTranscript */
  getTranscriptFull?(sessionId: string): Promise<NormalizedMessage[]>;
  getTouchedFiles(sessionId: string): Promise<TouchedFile[]>;
  listAgents(opts?: { projectDir?: string }): Promise<AgentDef[]>;
  inject(
    target: InjectTarget,
    payload: ContextPayload,
    opts: InjectOptions,
  ): Promise<InjectResult>;
  liveStatuses(): Promise<Map<string, SessionStatus>>;
}
