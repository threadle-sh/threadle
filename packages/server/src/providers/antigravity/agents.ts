import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentDef } from "@threadle/shared";

/**
 * Antigravity modes surface as builtin agents (like Cursor). Project agents
 * live under `{workspace}/.agents/agents/<name>/` when present.
 */
const BUILTIN: Array<Pick<AgentDef, "name" | "description" | "kind">> = [
  {
    name: "agent",
    description: "full Antigravity agent — edit, shell, and tools (default)",
    kind: "primary",
  },
  {
    name: "plan",
    description: "planning mode — analyze and propose plans (`agy --mode plan`)",
    kind: "built-in",
  },
  {
    name: "accept-edits",
    description: "auto-accept edits mode (`agy --mode accept-edits`)",
    kind: "built-in",
  },
];

async function listDirAgents(
  root: string,
  scope: "project" | "user",
): Promise<AgentDef[]> {
  const out: AgentDef[] = [];
  let names: string[];
  try {
    names = await fs.promises.readdir(root);
  } catch {
    return out;
  }
  for (const name of names) {
    const dir = path.join(root, name);
    try {
      const st = await fs.promises.stat(dir);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    let description: string | undefined;
    for (const candidate of ["AGENT.md", "agent.md", "README.md"]) {
      try {
        const text = await fs.promises.readFile(path.join(dir, candidate), "utf8");
        description = text.trim().slice(0, 240) || undefined;
        break;
      } catch {
        // try next
      }
    }
    out.push({
      provider: "antigravity",
      name,
      description,
      source: `antigravity:${scope}:${dir}`,
      scope,
      kind: "custom",
    });
  }
  return out;
}

export async function listAntigravityAgents(opts?: {
  projectDir?: string;
}): Promise<AgentDef[]> {
  const builtins = BUILTIN.map((b) => ({
    ...b,
    provider: "antigravity" as const,
    source: "antigravity:builtin",
    scope: "builtin" as const,
  }));

  const custom: AgentDef[] = [];
  if (opts?.projectDir) {
    custom.push(
      ...(await listDirAgents(path.join(opts.projectDir, ".agents", "agents"), "project")),
    );
  }
  custom.push(
    ...(await listDirAgents(path.join(os.homedir(), ".agents", "agents"), "user")),
  );

  return [...builtins, ...custom];
}
