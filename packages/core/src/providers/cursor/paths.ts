import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

export function cursorHome(): string {
  return process.env.CURSOR_CONFIG_DIR ?? path.join(os.homedir(), ".cursor");
}

export function projectsDir(): string {
  return path.join(cursorHome(), "projects");
}

export function chatsDir(): string {
  return path.join(cursorHome(), "chats");
}

/** Cursor hashes the absolute cwd with md5 for the chats/<hash>/ layout. */
export function chatHash(cwd: string): string {
  return crypto.createHash("md5").update(cwd).digest("hex");
}

/**
 * Best-effort reverse of a project slug like `Users-you-Projects-my-app`.
 * Authoritative cwd comes from chats meta when available.
 */
export function deslugProjectDir(slug: string): string {
  return `/${slug.replace(/-/g, "/")}`;
}

export function transcriptPath(projectSlug: string, sessionId: string): string {
  return path.join(
    projectsDir(),
    projectSlug,
    "agent-transcripts",
    sessionId,
    `${sessionId}.jsonl`,
  );
}
