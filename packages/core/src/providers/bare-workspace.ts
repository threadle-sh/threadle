import fs from "node:fs";
import path from "node:path";
import { threadleConfigDir } from "../paths.js";

/**
 * Empty cwd for smoke / pilot runs that must not ingest project AGENTS.md,
 * CLAUDE.md, .cursor/rules, etc. Created once under the threadle config dir
 */
export async function ensureBareWorkspace(): Promise<string> {
  const dir = path.join(threadleConfigDir(), "pilot-bare");
  await fs.promises.mkdir(dir, { recursive: true });
  // Keep it empty — no AGENTS.md / CLAUDE.md / .cursor / .git
  return dir;
}
