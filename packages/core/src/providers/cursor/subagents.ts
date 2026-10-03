import type { SessionRef } from "@threadle/shared";
import type { DiscoveredCursorSession } from "./discover.js";
import { formatCursorUserText, readCursorLines } from "./jsonl.js";

export interface CursorTaskSpawn {
  description?: string;
  prompt: string;
  subagentType?: string;
  toolUseId?: string;
}

/** Strip Cursor wrappers so Task.prompt lines up with the child transcript. */
export function normalizeCursorPrompt(text: string): string {
  return formatCursorUserText(text).replace(/\s+/g, " ").trim();
}

export async function extractTaskSpawns(transcriptPath: string): Promise<CursorTaskSpawn[]> {
  const out: CursorTaskSpawn[] = [];
  for await (const entry of readCursorLines(transcriptPath)) {
    if (entry.role !== "assistant") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== "tool_use" || block.name !== "Task") continue;
      const input = (block.input ?? {}) as {
        prompt?: unknown;
        description?: unknown;
        subagent_type?: unknown;
      };
      if (typeof input.prompt !== "string" || !input.prompt.trim()) continue;
      out.push({
        prompt: input.prompt,
        description: typeof input.description === "string" ? input.description : undefined,
        subagentType:
          typeof input.subagent_type === "string" ? input.subagent_type : undefined,
        toolUseId: typeof block.id === "string" ? block.id : undefined,
      });
    }
  }
  return out;
}

export async function firstUserPrompt(transcriptPath: string): Promise<string | undefined> {
  for await (const entry of readCursorLines(transcriptPath)) {
    if (entry.role !== "user") continue;
    const content = entry.message?.content;
    const parts: string[] = [];
    if (typeof content === "string") {
      if (content.trim()) parts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string" && block.text) {
          parts.push(block.text);
        }
      }
    }
    if (parts.length) return parts.join("\n");
  }
  return undefined;
}

/**
 * Cursor Task subagents write a sibling transcript UUID (no parent_id on disk).
 * Link them by matching Task.input.prompt to the child's first user message.
 * Mutates `sessions` in place.
 */
export async function linkTaskChildren(
  sessions: DiscoveredCursorSession[],
): Promise<void> {
  const bySlug = new Map<string, DiscoveredCursorSession[]>();
  for (const s of sessions) {
    if (!bySlug.has(s.projectSlug)) bySlug.set(s.projectSlug, []);
    bySlug.get(s.projectSlug)!.push(s);
  }

  for (const group of bySlug.values()) {
    if (group.length < 2) continue;

    const firstPrompt = new Map<string, string>();
    await Promise.all(
      group.map(async (s) => {
        try {
          const raw = await firstUserPrompt(s.transcriptPath);
          if (raw) firstPrompt.set(s.ref.id, normalizeCursorPrompt(raw));
        } catch {
          // unreadable
        }
      }),
    );

    const byPrompt = new Map<string, DiscoveredCursorSession>();
    for (const s of group) {
      const p = firstPrompt.get(s.ref.id);
      if (p && !byPrompt.has(p)) byPrompt.set(p, s);
    }

    const claimed = new Set<string>();
    for (const parent of group) {
      let tasks: CursorTaskSpawn[];
      try {
        tasks = await extractTaskSpawns(parent.transcriptPath);
      } catch {
        continue;
      }
      if (!tasks.length) continue;

      for (const task of tasks) {
        const key = normalizeCursorPrompt(task.prompt);
        if (!key) continue;
        const child = byPrompt.get(key);
        if (!child || child.ref.id === parent.ref.id) continue;
        if (claimed.has(child.ref.id)) continue;

        claimed.add(child.ref.id);
        child.ref.parentId = parent.ref.id;
        child.ref.kind = "subagent-run";
        child.ref.agent = task.subagentType ?? child.ref.agent;
        if (task.description) child.ref.title = task.description;
        child.ref.meta = {
          ...child.ref.meta,
          toolUseId: task.toolUseId,
          linkedVia: "task-prompt",
        };
      }
    }
  }
}

export function childrenOf(
  sessions: DiscoveredCursorSession[],
  sessionId: string,
): SessionRef[] {
  return sessions
    .map((d) => d.ref)
    .filter((r) => r.parentId === sessionId && r.kind === "subagent-run")
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}
