import type { AgentDef } from "@threadle/shared";

const BUILTIN: Array<Pick<AgentDef, "name" | "description" | "kind">> = [
  {
    name: "codex",
    description: "OpenAI Codex CLI — full coding agent (default)",
    kind: "primary",
  },
];

export async function listCodexAgents(): Promise<AgentDef[]> {
  return BUILTIN.map((b) => ({
    ...b,
    provider: "codex" as const,
    source: "codex:builtin",
    scope: "builtin" as const,
  }));
}
