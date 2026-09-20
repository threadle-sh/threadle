import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bundledPricingPath } from "../src/routes/pricing.js";

describe("bundled models pricing", () => {
  it("resolves a readable snapshot with anthropic models", () => {
    const p = bundledPricingPath();
    expect(fs.existsSync(p), `missing ${p}`).toBe(true);
    const db = JSON.parse(fs.readFileSync(p, "utf8")) as {
      anthropic?: { models?: Record<string, unknown> };
    };
    expect(db.anthropic?.models && Object.keys(db.anthropic.models).length > 0).toBe(true);
    // Prefer the package data/ path over accidental src-relative misses
    expect(path.basename(path.dirname(p))).toBe("data");
  });
});
