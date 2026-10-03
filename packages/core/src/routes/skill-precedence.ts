/**
 * Skill name collision precedence.
 * Lower layer wins. Project-repo skills always beat threadle libraries and global agent homes.
 */

export type SkillOrigin = "project" | "custom" | "imported" | "global";

/** Stable layer scores — lower = higher priority. */
export const SKILL_LAYER = {
  projectAgent: 10,
  projectThreadleCustom: 20,
  projectThreadleImported: 30,
  threadleCustom: 40,
  threadleImported: 50,
  globalAgent: 60,
} as const;

export interface SkillPrecedenceFields {
  origin: SkillOrigin;
  layer: number;
  /** Path of the higher-priority skill that hides this one (same name). */
  shadowedBy?: string;
}

/** Infer origin/layer from the scanner's source label. */
export function skillMetaFromSource(source: string, scope: string): SkillPrecedenceFields {
  const isProject = scope !== "global";
  if (source.includes(".threadle/skills/custom") || source === "threadle custom") {
    return {
      origin: "custom",
      layer: isProject ? SKILL_LAYER.projectThreadleCustom : SKILL_LAYER.threadleCustom,
    };
  }
  if (source.includes(".threadle/skills/imported") || source === "threadle imported") {
    return {
      origin: "imported",
      layer: isProject ? SKILL_LAYER.projectThreadleImported : SKILL_LAYER.threadleImported,
    };
  }
  if (source.startsWith("threadle/") || source.startsWith("~/.config/threadle/skills/custom")) {
    return { origin: "custom", layer: SKILL_LAYER.threadleCustom };
  }
  if (source.startsWith("~/.config/threadle/skills/imported")) {
    return { origin: "imported", layer: SKILL_LAYER.threadleImported };
  }
  if (isProject) {
    return { origin: "project", layer: SKILL_LAYER.projectAgent };
  }
  return { origin: "global", layer: SKILL_LAYER.globalAgent };
}

export function applySkillPrecedence<
  T extends { name: string; path: string; kind: string; layer?: number; shadowedBy?: string },
>(artifacts: T[]): T[] {
  const skills = artifacts.filter((a) => a.kind === "skill");
  const byName = new Map<string, T[]>();
  for (const s of skills) {
    const list = byName.get(s.name) ?? [];
    list.push(s);
    byName.set(s.name, list);
  }
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.layer ?? 99) - (b.layer ?? 99) || a.path.localeCompare(b.path));
    const winner = list[0]!;
    for (let i = 1; i < list.length; i++) {
      list[i]!.shadowedBy = winner.path;
    }
  }
  return artifacts;
}
