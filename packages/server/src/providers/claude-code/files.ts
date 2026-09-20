import fs from "node:fs";
import { LruMap } from "../../lru.js";
import type { FileOp, TouchedFile } from "@threadle/shared";
import { readLines } from "./jsonl.js";

const OP_STRENGTH: Record<FileOp, number> = {
  write: 5,
  create: 5,
  edit: 4,
  patch: 3,
  delete: 3,
  read: 1,
};

const WRITE_TOOLS: Record<string, FileOp> = {
  Write: "write",
  Edit: "edit",
  NotebookEdit: "edit",
  Read: "read",
  ExitPlanMode: "write",
};

export async function readTouchedFiles(filePath: string): Promise<TouchedFile[]> {
  const files = new Map<string, TouchedFile>();

  const record = (path: string, op: FileOp, ts?: number) => {
    const existing = files.get(path);
    if (!existing || OP_STRENGTH[op] >= OP_STRENGTH[existing.op]) {
      files.set(path, { ...existing, path, op, lastSeenAt: ts ?? existing?.lastSeenAt });
    } else if (ts && (!existing.lastSeenAt || ts > existing.lastSeenAt)) {
      existing.lastSeenAt = ts;
    }
  };

  const lines = (text: string) => text.split("\n").length;

  const addStats = (path: string, add: number, del: number, bytes: number) => {
    const f = files.get(path);
    if (!f) return;
    f.additions = (f.additions ?? 0) + add;
    f.deletions = (f.deletions ?? 0) + del;
    f.bytes = (f.bytes ?? 0) + bytes;
  };

  for await (const entry of readLines(filePath)) {
    const ts = entry.timestamp ? Date.parse(entry.timestamp) : undefined;

    // authoritative for edits: file-history snapshots track backed-up files
    if (
      entry.type === "file-history-snapshot" ||
      entry.type === "file-history-delta"
    ) {
      const snapshot = (entry as Record<string, unknown>).snapshot as
        | { trackedFileBackups?: Record<string, unknown> }
        | undefined;
      for (const p of Object.keys(snapshot?.trackedFileBackups ?? {})) {
        record(p, "edit", ts);
      }
      continue;
    }

    if (entry.type === "assistant" && Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content as Array<Record<string, unknown>>) {
        if (block.type !== "tool_use") continue;
        const name = typeof block.name === "string" ? block.name : "";
        const op = WRITE_TOOLS[name];
        if (!op) continue;
        const input = block.input as
          | {
              file_path?: unknown;
              notebook_path?: unknown;
              planFilePath?: unknown;
              content?: unknown;
              old_string?: unknown;
              new_string?: unknown;
              new_source?: unknown;
            }
          | undefined;
        const p =
          (typeof input?.file_path === "string" && input.file_path) ||
          (typeof input?.notebook_path === "string" && input.notebook_path) ||
          (typeof input?.planFilePath === "string" && input.planFilePath);
        if (typeof p === "string" && p) {
          record(p, op, ts);
          if (name === "Write" && typeof input?.content === "string") {
            addStats(p, lines(input.content), 0, input.content.length);
          } else if (
            name === "Edit" &&
            typeof input?.old_string === "string" &&
            typeof input?.new_string === "string"
          ) {
            addStats(
              p,
              lines(input.new_string),
              lines(input.old_string),
              input.new_string.length,
            );
          } else if (name === "NotebookEdit" && typeof input?.new_source === "string") {
            addStats(p, lines(input.new_source), 0, input.new_source.length);
          }
        }
      }
    }
  }

  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

// LRU — TouchedFile[] carries hunk strings (the fattest per-session payload);
// unbounded path-keyed retention adds up over days of new sessions.
const touchedCache = new LruMap<
  string,
  { mtimeMs: number; size: number; files: TouchedFile[] }
>(100);

/** mtime-cached variant — safe because transcripts are append-only. */
export async function readTouchedFilesCached(
  filePath: string,
): Promise<TouchedFile[]> {
  const stat = await fs.promises.stat(filePath);
  const hit = touchedCache.get(filePath);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
    return hit.files;
  }
  const files = await readTouchedFiles(filePath);
  touchedCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, files });
  return files;
}
