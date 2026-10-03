import type { AgentDef } from "@threadle/shared";

const BUILTIN: Array<Pick<AgentDef, "name" | "description" | "kind">> = [
  {
    name: "grok",
    description: "Grok Build — full coding agent (default)",
    kind: "primary",
  },
];

export async function listGrokAgents(): Promise<AgentDef[]> {
  return BUILTIN.map((b) => ({
    ...b,
    provider: "grok" as const,
    source: "grok:builtin",
    scope: "builtin" as const,
  }));
}
