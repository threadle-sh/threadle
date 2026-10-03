import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { AgentDef } from "@threadle/shared";
import { claudeHome } from "./discover.js";

async function readAgentDir(
  dir: string,
  scope: AgentDef["scope"],
): Promise<AgentDef[]> {
  let files: string[];
  try {
    files = await fs.promises.readdir(dir);
  } catch {
    return [];
  }
  const out: AgentDef[] = [];
  for (const name of files) {
    if (!name.endsWith(".md")) continue;
    const source = path.join(dir, name);
    try {
      const raw = await fs.promises.readFile(source, "utf8");
      const parsed = matter(raw);
      const fm = parsed.data as Record<string, unknown>;
      out.push({
        provider: "claude-code",
        name:
          typeof fm.name === "string" && fm.name
            ? fm.name
            : name.slice(0, -".md".length),
        description:
          typeof fm.description === "string" ? fm.description : undefined,
        model: typeof fm.model === "string" ? fm.model : undefined,
        source,
        scope,
        kind: "subagent",
        raw,
      });
    } catch {
      // unreadable/invalid agent file — skip
    }
  }
  return out;
}

/** Agent types built into the claude CLI (available without any .md definition). */
const BUILTIN_CLAUDE_AGENTS: Array<Pick<AgentDef, "name" | "description">> = [
  {
    name: "general-purpose",
    description: "researches complex questions and executes multi-step tasks",
  },
  { name: "Explore", description: "read-only codebase exploration and search" },
  { name: "Plan", description: "designs implementation plans" },
];

export async function listClaudeAgents(projectDir?: string): Promise<AgentDef[]> {
  const dirs: Array<[string, AgentDef["scope"]]> = [
    [path.join(claudeHome(), "agents"), "user"],
  ];
  if (projectDir) {
    dirs.unshift([path.join(projectDir, ".claude", "agents"), "project"]);
  }
  const lists = await Promise.all(dirs.map(([d, s]) => readAgentDir(d, s)));
  const builtins: AgentDef[] = BUILTIN_CLAUDE_AGENTS.map((b) => ({
    ...b,
    provider: "claude-code" as const,
    source: "claude:builtin",
    scope: "builtin" as const,
    kind: "built-in",
  }));
  return [...lists.flat(), ...builtins];
}
