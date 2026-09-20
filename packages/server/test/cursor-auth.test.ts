import { describe, expect, it } from "vitest";
import { billingFromAbout, planFromTier } from "../src/providers/cursor/auth.js";

describe("cursor auth billing", () => {
  it("maps Pro tier to Cursor Pro subscription", () => {
    const t = planFromTier("Pro");
    expect(t.billing).toBe("subscription");
    expect(t.plan).toBe("Cursor Pro");
    expect(t.subscriptionTier).toBe("Pro");
  });

  it("builds info from about json", () => {
    const info = billingFromAbout({ subscriptionTier: "Business" });
    expect(info.available).toBe(true);
    expect(info.plan).toBe("Cursor Business");
    expect(info.billing).toBe("subscription");
  });

  it("falls back to signed-in without tier", () => {
    const info = billingFromAbout({}, true);
    expect(info.available).toBe(true);
    expect(info.billing).toBe("unknown");
    expect(info.plan).toBe("Cursor (signed in)");
  });
});
