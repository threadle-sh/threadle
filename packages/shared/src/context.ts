import type { ProviderId } from "./session.js";

export type ContextKind = "distilled-summary" | "transcript-excerpt" | "files";

export interface ExtractConfig {
  kind: "transcript-excerpt";
  roles: Array<"user" | "assistant">;
  includeThinking: boolean;
  includeToolCalls: "none" | "names" | "full";
  range?: [number, number];
  maxChars?: number;
}

export interface DistillConfig {
  kind: "distilled-summary";
  /** Which CLI runs the distill transform (default claude-code). */
  provider?: ProviderId;
  model?: string;
  extraInstructions?: string;
}

export interface FilesConfig {
  kind: "files";
  snapshotContents: boolean;
}

export type ContextConfig = ExtractConfig | DistillConfig | FilesConfig;

export const DEFAULT_EXTRACT_CONFIG: ExtractConfig = {
  kind: "transcript-excerpt",
  roles: ["user", "assistant"],
  includeThinking: false,
  includeToolCalls: "names",
};

export const DEFAULT_DISTILL_CONFIG: DistillConfig = {
  kind: "distilled-summary",
};

export const DEFAULT_FILES_CONFIG: FilesConfig = {
  kind: "files",
  snapshotContents: false,
};

export function defaultConfigFor(kind: ContextKind): ContextConfig {
  switch (kind) {
    case "transcript-excerpt":
      return { ...DEFAULT_EXTRACT_CONFIG };
    case "distilled-summary":
      return { ...DEFAULT_DISTILL_CONFIG };
    case "files":
      return { ...DEFAULT_FILES_CONFIG };
  }
}

export interface ContextPayload {
  hash: string;
  kind: ContextKind;
  createdAt: number;
  source: { provider: ProviderId; sessionId: string };
  content: string;
  meta: {
    model?: string;
    messageRange?: [number, number];
    tokenEstimate?: number;
    sourceTitle?: string;
  };
}
