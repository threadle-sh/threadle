import fs from "node:fs";
import path from "node:path";
import type { AgentDef } from "@threadle/shared";
import { skillsRoot } from "./paths.js";

const BUILTIN: Array<Pick<AgentDef, "name" | "description" | "kind">> = [
  {
    name: "muse",
    description: "Muse Code — Meta Muse Spark coding agent (default)",
    kind: "primary",
  },
];

async function scanSkillMd(dir: string, scope: AgentDef["scope"]): Promise<AgentDef[]> {
  const out: AgentDef[] = [];
  async function walk(d: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    const skillFile = entries.find(
      (e) => e.isFile() && /^skill\.md$/i.test(e.name),
    );
    if (skillFile) {
      const src = path.join(d, skillFile.name);
      let name = path.basename(d);
      let description: string | undefined;
      let raw: string | undefined;
      try {
        raw = await fs.promises.readFile(src, "utf8");
        const fm = /^---\s*\n([\s\S]*?)\n---/.exec(raw);
        if (fm) {
          const nameM = /^name:\s*["']?(.+?)["']?\s*$/m.exec(fm[1]!);
          const descM = /^description:\s*["']?(.+?)["']?\s*$/m.exec(fm[1]!);
          if (nameM) name = nameM[1]!.trim();
          if (descM) description = descM[1]!.trim();
        }
      } catch {
        /* */
      }
      out.push({
        provider: "muse",
        name,
        description,
        source: src,
        scope,
        kind: "skill",
        raw,
      });
      return;
    }
    for (const ent of entries) {
      if (ent.isDirectory() && !ent.name.startsWith(".")) {
        await walk(path.join(d, ent.name));
      }
    }
  }
  await walk(dir);
  return out;
}

export async function listMuseAgents(): Promise<AgentDef[]> {
  const defs: AgentDef[] = BUILTIN.map((b) => ({
    ...b,
    provider: "muse" as const,
    source: "muse:builtin",
    scope: "builtin" as const,
  }));
  const root = skillsRoot();
  for (const [sub, scope] of [
    ["bundled", "builtin"],
    ["user", "user"],
    ["project", "project"],
  ] as const) {
    const dir = path.join(root, sub);
    try {
      await fs.promises.access(dir);
      defs.push(...(await scanSkillMd(dir, scope)));
    } catch {
      /* missing */
    }
  }
  return defs;
}
