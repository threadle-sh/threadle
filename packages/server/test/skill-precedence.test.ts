import { describe, expect, it } from "vitest";
import {
  applySkillPrecedence,
  skillMetaFromSource,
  SKILL_LAYER,
} from "../src/routes/skill-precedence.js";

describe("skill precedence", () => {
  it("ranks project agent above threadle custom/imported and global", () => {
    expect(skillMetaFromSource(".claude/skills", "/proj").layer).toBe(SKILL_LAYER.projectAgent);
    expect(skillMetaFromSource(".threadle/skills/custom", "/proj").layer).toBe(
      SKILL_LAYER.projectThreadleCustom,
    );
    expect(skillMetaFromSource("~/.config/threadle/skills/custom", "global").layer).toBe(
      SKILL_LAYER.threadleCustom,
    );
    expect(skillMetaFromSource("~/.config/threadle/skills/imported", "global").layer).toBe(
      SKILL_LAYER.threadleImported,
    );
    expect(skillMetaFromSource("~/.claude/skills", "global").layer).toBe(SKILL_LAYER.globalAgent);
  });

  it("shadows lower-layer skills with the same name", () => {
    const arts = applySkillPrecedence([
      {
        name: "review",
        path: "/home/.config/threadle/skills/imported/review/SKILL.md",
        kind: "skill",
        layer: SKILL_LAYER.threadleImported,
      },
      {
        name: "review",
        path: "/proj/.claude/skills/review/SKILL.md",
        kind: "skill",
        layer: SKILL_LAYER.projectAgent,
      },
      {
        name: "review",
        path: "/home/.config/threadle/skills/custom/review/SKILL.md",
        kind: "skill",
        layer: SKILL_LAYER.threadleCustom,
      },
      { name: "other", path: "/x", kind: "skill", layer: SKILL_LAYER.threadleCustom },
    ]);
    const project = arts.find((a) => a.path.includes("/proj/"))!;
    const custom = arts.find((a) => a.path.includes("/custom/"))!;
    const imported = arts.find((a) => a.path.includes("/imported/"))!;
    expect(project.shadowedBy).toBeUndefined();
    expect(custom.shadowedBy).toBe(project.path);
    expect(imported.shadowedBy).toBe(project.path);
    expect(arts.find((a) => a.name === "other")!.shadowedBy).toBeUndefined();
  });
});
