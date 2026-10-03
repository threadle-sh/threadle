import os from "node:os";
import path from "node:path";

/** Antigravity CLI data root (`agy` / Jetski). */
export function antigravityHome(): string {
  return (
    process.env.ANTIGRAVITY_HOME?.trim() ||
    process.env.JETSKI_APP_DATA_DIR?.trim() ||
    path.join(os.homedir(), ".gemini", "antigravity-cli")
  );
}

export function brainDir(): string {
  return path.join(antigravityHome(), "brain");
}

export function conversationsDir(): string {
  return path.join(antigravityHome(), "conversations");
}

export function summariesDbPath(): string {
  return path.join(antigravityHome(), "conversation_summaries.db");
}

export function historyPath(): string {
  return path.join(antigravityHome(), "history.jsonl");
}

export function lastConversationsPath(): string {
  return path.join(antigravityHome(), "cache", "last_conversations.json");
}

export function transcriptFullPath(conversationId: string): string {
  return path.join(
    brainDir(),
    conversationId,
    ".system_generated",
    "logs",
    "transcript_full.jsonl",
  );
}

export function transcriptPath(conversationId: string): string {
  return path.join(
    brainDir(),
    conversationId,
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );
}
