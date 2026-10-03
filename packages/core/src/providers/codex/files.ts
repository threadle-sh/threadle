import type { FileOp, TouchedFile } from "@threadle/shared";
import { isAbsolutePath } from "@threadle/shared";
import { readCodexLines } from "./jsonl.js";

const OP_STRENGTH: Record<FileOp, number> = {
  write: 5,
  create: 5,
  edit: 4,
  patch: 3,
  delete: 3,
  read: 1,
};

const NAME_OPS: Record<string, FileOp> = {
  read_file: "read",
  Read: "read",
  write_file: "write",
  Write: "write",
  apply_patch: "patch",
  ApplyPatch: "patch",
  shell: "edit",
  Shell: "edit",
  exec: "edit",
  delete_file: "delete",
  Delete: "delete",
};

function filePathFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  for (const key of ["path", "file_path", "filePath", "target", "filename"]) {
    const v = obj[key];
      if (typeof v === "string" && isAbsolutePath(v)) return v;
  }
  return undefined;
}

function parseArgs(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function readCodexTouchedFiles(filePath: string): Promise<TouchedFile[]> {
  const files = new Map<string, TouchedFile>();

  const record = (p: string, op: FileOp) => {
    const existing = files.get(p);
    if (!existing || OP_STRENGTH[op] >= OP_STRENGTH[existing.op]) {
      files.set(p, { ...existing, path: p, op });
    }
  };

  for await (const entry of readCodexLines(filePath)) {
    const payload =
      entry.type === "response_item" && entry.payload && typeof entry.payload === "object"
        ? entry.payload
        : entry.type === "function_call"
          ? (entry as Record<string, unknown>)
          : undefined;
    if (!payload) continue;
    const t = typeof payload.type === "string" ? payload.type : "";
    if (t !== "function_call" && t !== "custom_tool_call" && t !== "tool_call") continue;
    const name = typeof payload.name === "string" ? payload.name : "";
    const op = NAME_OPS[name];
    if (!op) continue;
    const input = parseArgs(payload.arguments ?? payload.input);
    const p = filePathFromInput(input);
    if (p) record(p, op);
  }

  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}
