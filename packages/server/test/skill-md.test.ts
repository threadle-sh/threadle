import { describe, expect, it } from "vitest";
import {
  parseSkillFrontmatter,
  setFrontmatterField,
  skillAutoInvoke,
  skillNameFromContent,
} from "../src/routes/skill-md.js";

describe("skill-md frontmatter", () => {
  it("parses flat fields and body", () => {
    const raw = `---
name: review-pr
description: Review a pull request
disable-model-invocation: true
---

# review-pr

Do the review.
`;
    const p = parseSkillFrontmatter(raw);
    expect(p.hasFm).toBe(true);
    expect(p.fields.name).toBe("review-pr");
    expect(p.fields.description).toBe("Review a pull request");
    expect(skillAutoInvoke(p.fields)).toBe(false);
    expect(p.body.trimStart()).toMatch(/^# review-pr/);
  });

  it("treats missing disable flag as auto-invoke", () => {
    const p = parseSkillFrontmatter(`---
name: x
description: y
---

body
`);
    expect(skillAutoInvoke(p.fields)).toBe(true);
  });

  it("sets and clears disable-model-invocation", () => {
    const base = `---
name: x
description: y
---

# x
`;
    const off = setFrontmatterField(base, "disable-model-invocation", true);
    expect(off).toContain("disable-model-invocation: true");
    expect(skillAutoInvoke(parseSkillFrontmatter(off).fields)).toBe(false);

    const on = setFrontmatterField(off, "disable-model-invocation", null);
    expect(on).not.toContain("disable-model-invocation");
    expect(skillAutoInvoke(parseSkillFrontmatter(on).fields)).toBe(true);
  });

  it("creates frontmatter when missing", () => {
    const next = setFrontmatterField("# bare\n", "name", "bare-skill");
    expect(next.startsWith("---\n")).toBe(true);
    expect(parseSkillFrontmatter(next).fields.name).toBe("bare-skill");
  });

  it("extracts kebab name from content", () => {
    expect(
      skillNameFromContent(`---
name: my-cool-skill
description: hi
---
`),
    ).toBe("my-cool-skill");
    expect(skillNameFromContent("# no fm", "fallback-name")).toBe("fallback-name");
    expect(skillNameFromContent("# no fm", "Bad Name")).toBeUndefined();
  });
});
