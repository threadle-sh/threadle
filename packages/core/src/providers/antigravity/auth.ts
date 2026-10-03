import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { antigravityHome } from "./paths.js";

/**
 * Antigravity / agy billing signals — local only.
 *
 * Unlike Codex, public storage does **not** carry a ChatGPT-style plan tier.
 * What we can mirror:
 * - `~/.gemini/settings.json` → `security.auth.selectedType` (e.g. oauth-personal)
 * - `~/.gemini/antigravity-cli/cache/onboarding.json` → consumer vs enterprise
 * - presence of `~/.gemini/oauth_creds.json` (logged in; tokens never returned)
 *
 * Quota / Google One / Gemini Advanced tiers are not on disk.
 */

export interface AntigravityBillingInfo {
  available: boolean;
  /** oauth-personal | vertex-api-key | api-key | unknown */
  authType?: string;
  /** subscription (Google account) | api (API / Vertex key) */
  billing?: "subscription" | "api";
  /** short label for the Statistics plan tile */
  plan?: string;
  /** consumer | enterprise | unknown — from onboarding cache */
  audience?: "consumer" | "enterprise" | "unknown";
  /** true when oauth_creds.json exists */
  loggedIn?: boolean;
}

function geminiHome(): string {
  return process.env.GEMINI_HOME?.trim() || path.join(os.homedir(), ".gemini");
}

function labelFor(authType: string | undefined, audience: AntigravityBillingInfo["audience"]): string | undefined {
  if (authType === "oauth-personal" || (!authType && audience === "consumer")) {
    return audience === "enterprise" ? "Google account (enterprise)" : "Google account (consumer)";
  }
  if (authType === "vertex-api-key") return "Vertex API key";
  if (authType === "api-key" || authType === "gemini-api-key") return "Gemini API key";
  if (audience === "enterprise") return "Enterprise";
  if (audience === "consumer") return "Consumer";
  return undefined;
}

export function billingFromGeminiFiles(opts: {
  selectedType?: string;
  consumerOnboarding?: boolean;
  enterpriseOnboarding?: boolean;
  hasOauthCreds?: boolean;
}): AntigravityBillingInfo {
  const authType = opts.selectedType?.trim() || undefined;
  let audience: AntigravityBillingInfo["audience"] = "unknown";
  if (opts.enterpriseOnboarding) audience = "enterprise";
  else if (opts.consumerOnboarding) audience = "consumer";

  const t = (authType ?? "").toLowerCase();
  let billing: AntigravityBillingInfo["billing"];
  if (t.includes("api-key") || t.includes("vertex") || t === "api") billing = "api";
  else if (t.includes("oauth") || opts.hasOauthCreds || audience === "consumer" || audience === "enterprise") {
    billing = "subscription";
  }

  if (!authType && !opts.hasOauthCreds && audience === "unknown") {
    return { available: false };
  }

  return {
    available: true,
    authType: authType ?? (opts.hasOauthCreds ? "oauth" : undefined),
    billing,
    plan: labelFor(authType, audience),
    audience,
    loggedIn: !!opts.hasOauthCreds,
  };
}

export async function readAntigravityBilling(): Promise<AntigravityBillingInfo> {
  const gemini = geminiHome();
  const agy = antigravityHome();

  let selectedType: string | undefined;
  try {
    const settings = JSON.parse(
      await fs.promises.readFile(path.join(gemini, "settings.json"), "utf8"),
    ) as { security?: { auth?: { selectedType?: string } } };
    selectedType = settings.security?.auth?.selectedType;
  } catch {
    // missing
  }

  let consumerOnboarding: boolean | undefined;
  let enterpriseOnboarding: boolean | undefined;
  try {
    const onboarding = JSON.parse(
      await fs.promises.readFile(path.join(agy, "cache", "onboarding.json"), "utf8"),
    ) as {
      consumerOnboardingComplete?: boolean;
      enterpriseOnboardingComplete?: boolean;
    };
    consumerOnboarding = !!onboarding.consumerOnboardingComplete;
    enterpriseOnboarding = !!onboarding.enterpriseOnboardingComplete;
  } catch {
    // missing
  }

  let hasOauthCreds = false;
  try {
    await fs.promises.access(path.join(gemini, "oauth_creds.json"), fs.constants.R_OK);
    hasOauthCreds = true;
  } catch {
    // not logged in / missing
  }

  return billingFromGeminiFiles({
    selectedType,
    consumerOnboarding,
    enterpriseOnboarding,
    hasOauthCreds,
  });
}
