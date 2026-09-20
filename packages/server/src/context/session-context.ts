import type { ExtractConfig } from "@threadle/shared";

/** Same render shape as GET /api/sessions/:provider/context/:id */
export const SESSION_CONTEXT_CONFIG: ExtractConfig = {
  kind: "transcript-excerpt",
  roles: ["user", "assistant"],
  includeThinking: true,
  includeToolCalls: "full",
};

/** Library tag applied when a session context is copied for reuse in workflows. */
export const REFERENCE_TAG = "reference";
