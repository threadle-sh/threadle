import { describe, expect, it } from "vitest";
import { billingFromGeminiFiles } from "../src/providers/antigravity/auth.js";

describe("antigravity auth billing", () => {
  it("maps oauth-personal + consumer onboarding to subscription", () => {
    const info = billingFromGeminiFiles({
      selectedType: "oauth-personal",
      consumerOnboarding: true,
      enterpriseOnboarding: false,
      hasOauthCreds: true,
    });
    expect(info.available).toBe(true);
    expect(info.billing).toBe("subscription");
    expect(info.audience).toBe("consumer");
    expect(info.plan).toBe("Google account (consumer)");
    expect(info.loggedIn).toBe(true);
  });

  it("maps vertex-api-key to api billing", () => {
    const info = billingFromGeminiFiles({
      selectedType: "vertex-api-key",
      hasOauthCreds: false,
    });
    expect(info.billing).toBe("api");
    expect(info.plan).toBe("Vertex API key");
  });

  it("returns unavailable when nothing on disk", () => {
    expect(billingFromGeminiFiles({}).available).toBe(false);
  });
});
