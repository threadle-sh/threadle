import type { FileOp, TouchedFile } from "@threadle/shared";
import { readCursorLines } from "./jsonl.js";

const OP_STRENGTH: Record<FileOp, number> = {
  write: 5,
  create: 5,
  edit: 4,
  patch: 3,
  delete: 3,
  read: 1,
};

const TOOL_OPS: Record<string, FileOp> = {
  Read: "read",
  Write: "write",
  StrReplace: "edit",
  Delete: "delete",
  EditNotebook: "edit",
};

function filePathFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  for (const key of ["path", "file_path", "filePath", "target_notebook", "notebook_path"]) {
    const v = obj[key];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

export async function readCursorTouchedFiles(filePath: string): Promise<TouchedFile[]> {
  const files = new Map<string, TouchedFile>();

  const record = (path: string, op: FileOp) => {
    const existing = files.get(path);
    if (!existing || OP_STRENGTH[op] >= OP_STRENGTH[existing.op]) {
      files.set(path, { ...existing, path, op });
    }
  };

  for await (const entry of readCursorLines(filePath)) {
    if (entry.role !== "assistant") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== "tool_use") continue;
      const name = typeof block.name === "string" ? block.name : "";
      const op = TOOL_OPS[name];
      if (!op) continue;
      const p = filePathFromInput(block.input);
      if (p) record(p, op);

      // line churn heuristics for Write / StrReplace
      if (p && block.input && typeof block.input === "object") {
        const input = block.input as Record<string, unknown>;
        const f = files.get(p);
        if (!f) continue;
        if (name === "Write" && typeof input.contents === "string") {
          const lines = input.contents.split("\n").length;
          f.additions = (f.additions ?? 0) + lines;
          f.bytes = (f.bytes ?? 0) + input.contents.length;
        } else if (
          name === "StrReplace" &&
          typeof input.old_string === "string" &&
          typeof input.new_string === "string"
        ) {
          f.additions = (f.additions ?? 0) + input.new_string.split("\n").length;
          f.deletions = (f.deletions ?? 0) + input.old_string.split("\n").length;
          f.bytes = (f.bytes ?? 0) + input.new_string.length;
        }
      }
    }
  }

  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}
