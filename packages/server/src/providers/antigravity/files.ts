import type { TouchedFile } from "@threadle/shared";
import { isAbsolutePath } from "@threadle/shared";
import { fileUriToPath } from "./discover.js";
import { readAntigravityLines } from "./jsonl.js";

/**
 * Antigravity 1.2.3 public transcript_full.jsonl is user/planner text only —
 * tool file ops live in opaque conversation DBs. Best-effort: harvest
 * `file://…` links from assistant text.
 */
export async function readAntigravityTouchedFiles(
  filePath: string,
): Promise<TouchedFile[]> {
  const files = new Map<string, TouchedFile>();
  const re = /file:\/\/[^\s\)\]\"'<>]+/g;

  for await (const entry of readAntigravityLines(filePath)) {
    if (entry.type !== "PLANNER_RESPONSE" && entry.type !== "AGENT_RESPONSE") continue;
    if (typeof entry.content !== "string") continue;
    for (const m of entry.content.matchAll(re)) {
      const raw = m[0];
      if (!raw) continue;
      const p = fileUriToPath(raw);
      if (!p || !isAbsolutePath(p)) continue;
      if (!files.has(p)) files.set(p, { path: p, op: "read" });
    }
  }

  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}
