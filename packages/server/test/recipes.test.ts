import { describe, expect, it } from "vitest";
import { portableGraphSchema } from "@threadle/shared";
import { getRecipe, listRecipes, resetRecipeCache } from "../src/templates/recipes.js";

describe("recipes catalog", () => {
  it("loads all catalog entries as valid portable graphs", () => {
    resetRecipeCache();
    const recipes = listRecipes();
    expect(recipes.length).toBeGreaterThanOrEqual(5);

    const ids = recipes.map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "diff-review-panel",
        "second-opinion",
        "handover-brief",
        "test-triage",
        "repo-brief",
      ]),
    );

    for (const r of recipes) {
      const again = portableGraphSchema.safeParse(r.graph);
      expect(again.success, r.id).toBe(true);
      expect(r.outcome.length).toBeGreaterThan(8);
      expect(r.graph.name.toLowerCase()).toContain("recipe");
    }
  });

  it("getRecipe resolves by id", () => {
    resetRecipeCache();
    expect(getRecipe("repo-brief")?.needs.dir).toBe(true);
    expect(getRecipe("handover-brief")?.needs.model).toBe(false);
    expect(getRecipe("handover-brief")?.needs.session).toBe(true);
    expect(getRecipe("nope")).toBeUndefined();
  });
});
