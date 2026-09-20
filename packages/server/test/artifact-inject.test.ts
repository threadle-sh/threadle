import { describe, expect, it } from "vitest";
import { formatArtifactInject } from "../src/routes/rules.js";

describe("formatArtifactInject", () => {
  it("wraps skill content with a provenance header", () => {
    const out = formatArtifactInject("skill", "review-pr", ".claude/skills", "Do the review.");
    expect(out).toContain("# Skill: review-pr (.claude/skills)");
    expect(out).toContain("Do the review.");
  });

  it("wraps rules content", () => {
    const out = formatArtifactInject("rules", "CLAUDE.md", "CLAUDE.md", "# Project\n\nBe careful.");
    expect(out.startsWith("# Rules: CLAUDE.md")).toBe(true);
    expect(out).toContain("Be careful.");
  });
});
