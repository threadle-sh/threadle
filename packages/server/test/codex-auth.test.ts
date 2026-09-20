import { describe, expect, it } from "vitest";
import { billingFromAuth, decodeJwtPayload } from "../src/providers/codex/auth.js";

function fakeJwt(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `hdr.${body}.sig`;
}

describe("codex auth billing", () => {
  it("decodes jwt payload", () => {
    const p = decodeJwtPayload(fakeJwt({ hello: "world" }));
    expect(p).toEqual({ hello: "world" });
  });

  it("reads ChatGPT Plus from id_token claims", () => {
    const id = fakeJwt({
      "https://api.openai.com/auth": {
        chatgpt_plan_type: "plus",
        chatgpt_subscription_active_until: "2026-09-25T09:38:32+00:00",
      },
    });
    const info = billingFromAuth({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: { id_token: id },
    });
    expect(info.available).toBe(true);
    expect(info.authMode).toBe("chatgpt");
    expect(info.billing).toBe("subscription");
    expect(info.plan).toBe("ChatGPT Plus");
    expect(info.planType).toBe("plus");
    expect(info.subscriptionUntil).toBe("2026-09-25T09:38:32+00:00");
  });

  it("treats API key auth as pay-per-token", () => {
    const info = billingFromAuth({
      auth_mode: "api",
      OPENAI_API_KEY: "sk-test",
    });
    expect(info.available).toBe(true);
    expect(info.billing).toBe("api");
    expect(info.plan).toBeUndefined();
  });
});
