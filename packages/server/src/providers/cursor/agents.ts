import type { AgentDef } from "@threadle/shared";

/**
 * Cursor has no `.md` agent definitions like Claude. The agent CLI exposes
 * execution modes instead — surface those as builtin agents so the palette /
 * Agents view / handoff target list can pick plan vs ask vs full agent.
 */
const BUILTIN_CURSOR_AGENTS: Array<
  Pick<AgentDef, "name" | "description" | "kind">
> = [
  {
    name: "agent",
    description: "full Cursor Agent — edit, shell, and tools (default mode)",
    kind: "primary",
  },
  {
    name: "plan",
    description: "read-only planning — analyze and propose plans, no edits (`agent --mode plan`)",
    kind: "built-in",
  },
  {
    name: "ask",
    description: "Q&A / explanations — read-only (`agent --mode ask`)",
    kind: "built-in",
  },
];

export async function listCursorAgents(): Promise<AgentDef[]> {
  return BUILTIN_CURSOR_AGENTS.map((b) => ({
    ...b,
    provider: "cursor" as const,
    source: "cursor:builtin",
    scope: "builtin" as const,
  }));
}
