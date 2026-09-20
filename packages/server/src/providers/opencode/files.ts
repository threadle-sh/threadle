import type { FileOp, TouchedFile } from "@threadle/shared";
import { query, type MessageRow, type PartRow } from "./db.js";

const OP_STRENGTH: Record<FileOp, number> = {
  write: 5,
  create: 5,
  edit: 4,
  patch: 3,
  delete: 3,
  read: 1,
};

export async function readOpencodeTouchedFiles(
  sessionId: string,
): Promise<TouchedFile[]> {
  const files = new Map<string, TouchedFile>();
  const record = (p: string, op: FileOp) => {
    const existing = files.get(p);
    if (!existing || OP_STRENGTH[op] >= OP_STRENGTH[existing.op]) {
      files.set(p, { path: p, op });
    }
  };

  const [messages, parts] = await Promise.all([
    query<MessageRow>("SELECT id, data FROM message WHERE session_id = ?", [
      sessionId,
    ]),
    query<PartRow>("SELECT message_id, data FROM part WHERE session_id = ?", [
      sessionId,
    ]),
  ]);

  const stats = new Map<
    string,
    { additions: number; deletions: number; hunks: string[] }
  >();
  const HUNK_RE = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/g;

  // session-level diff summaries live on user messages
  for (const row of messages) {
    try {
      const data = JSON.parse(row.data) as {
        summary?: {
          diffs?: Array<{
            file?: string;
            status?: string;
            patch?: string;
            additions?: number;
            deletions?: number;
          }>;
        };
      };
      for (const diff of data.summary?.diffs ?? []) {
        if (!diff.file) continue;
        record(diff.file, diff.status === "added" ? "create" : "patch");
        if (!stats.has(diff.file)) {
          stats.set(diff.file, { additions: 0, deletions: 0, hunks: [] });
        }
        const st = stats.get(diff.file)!;
        st.additions += diff.additions ?? 0;
        st.deletions += diff.deletions ?? 0;
        if (typeof diff.patch === "string" && st.hunks.length < 8) {
          for (const m of diff.patch.matchAll(HUNK_RE)) {
            if (st.hunks.length >= 8) break;
            const start = Number(m[1]);
            const count = m[2] ? Number(m[2]) : 1;
            st.hunks.push(count > 1 ? `+${start}\u2013${start + count - 1}` : `+${start}`);
          }
        }
      }
    } catch {
      // skip
    }
  }

  for (const row of parts) {
    try {
      const data = JSON.parse(row.data) as {
        type?: string;
        tool?: string;
        files?: unknown;
        state?: { input?: { filePath?: unknown; file_path?: unknown } };
      };
      if (data.type === "patch") {
        const list = Array.isArray(data.files)
          ? data.files.map(String)
          : data.files && typeof data.files === "object"
            ? Object.keys(data.files)
            : [];
        for (const p of list) record(p, "patch");
      } else if (data.type === "tool") {
        const tool = (data.tool ?? "").toLowerCase();
        const input = data.state?.input;
        const p = input?.filePath ?? input?.file_path;
        if (typeof p === "string" && p) {
          if (tool.includes("write")) record(p, "write");
          else if (tool.includes("edit")) record(p, "edit");
          else if (tool.includes("read")) record(p, "read");
        }
      }
    } catch {
      // skip
    }
  }

  for (const [path, st] of stats) {
    const f = files.get(path);
    if (!f) continue;
    if (st.additions || st.deletions) {
      f.additions = st.additions;
      f.deletions = st.deletions;
    }
    if (st.hunks.length) f.hunks = st.hunks;
  }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}
