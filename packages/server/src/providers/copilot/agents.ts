import type { AgentDef } from "@threadle/shared";

const BUILTIN: Array<Pick<AgentDef, "name" | "description" | "kind">> = [
  {
    name: "copilot",
    description: "GitHub Copilot CLI — full coding agent (default)",
    kind: "primary",
  },
];

export async function listCopilotAgents(): Promise<AgentDef[]> {
  return BUILTIN.map((b) => ({
    ...b,
    provider: "copilot" as const,
    source: "copilot:builtin",
    scope: "builtin" as const,
  }));
}
