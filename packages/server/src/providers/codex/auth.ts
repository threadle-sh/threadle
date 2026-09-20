import fs from "node:fs";
import path from "node:path";
import { codexHome } from "./paths.js";

/**
 * Codex billing / plan — read passively from `~/.codex/auth.json`.
 * ChatGPT-login installs store plan claims inside the JWT `id_token`
 * (`https://api.openai.com/auth.chatgpt_plan_type`). API-key installs set
 * `auth_mode` / `OPENAI_API_KEY`. We decode the JWT payload locally only —
 * never verify with OpenAI, never return tokens or email.
 */

export interface CodexBillingInfo {
  available: boolean;
  /** chatgpt | api | unknown */
  authMode?: "chatgpt" | "api" | "unknown";
  /** subscription (ChatGPT plan) | api (pay-per-token) */
  billing?: "subscription" | "api";
  /** e.g. ChatGPT Plus */
  plan?: string;
  /** raw claim, e.g. plus */
  planType?: string;
  /** ISO until date when present on the JWT */
  subscriptionUntil?: string;
}

interface CodexAuthFile {
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
  tokens?: { id_token?: string };
}

const AUTH_CLAIM = "https://api.openai.com/auth";

function planLabel(planType?: string): string | undefined {
  if (!planType) return undefined;
  const t = planType.toLowerCase();
  if (t === "plus") return "ChatGPT Plus";
  if (t === "pro") return "ChatGPT Pro";
  if (t === "free" || t === "freeplan") return "ChatGPT Free";
  if (t === "team") return "ChatGPT Team";
  if (t === "enterprise") return "ChatGPT Enterprise";
  if (t === "business") return "ChatGPT Business";
  return `ChatGPT ${planType}`;
}

/** Decode JWT payload without verifying the signature (local mirror only). */
export function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return undefined;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const json = Buffer.from(b64 + pad, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function billingFromAuth(raw: CodexAuthFile): CodexBillingInfo {
  const modeRaw = (raw.auth_mode ?? "").toLowerCase();
  const hasApiKey = typeof raw.OPENAI_API_KEY === "string" && raw.OPENAI_API_KEY.trim().length > 0;

  let authMode: CodexBillingInfo["authMode"] = "unknown";
  if (modeRaw === "chatgpt" || modeRaw === "openai") authMode = "chatgpt";
  else if (modeRaw === "api" || modeRaw === "apikey" || modeRaw === "api_key" || hasApiKey) {
    authMode = "api";
  }

  let planType: string | undefined;
  let subscriptionUntil: string | undefined;
  const idToken = raw.tokens?.id_token;
  if (typeof idToken === "string" && idToken.includes(".")) {
    const payload = decodeJwtPayload(idToken);
    const auth = payload?.[AUTH_CLAIM];
    if (auth && typeof auth === "object") {
      const a = auth as Record<string, unknown>;
      if (typeof a.chatgpt_plan_type === "string") planType = a.chatgpt_plan_type;
      if (typeof a.chatgpt_subscription_active_until === "string") {
        subscriptionUntil = a.chatgpt_subscription_active_until;
      }
    }
  }

  // Prefer explicit chatgpt login; API key alone is pay-per-token.
  let billing: CodexBillingInfo["billing"];
  if (authMode === "chatgpt" || planType) billing = "subscription";
  else if (authMode === "api" || hasApiKey) billing = "api";

  if (!billing && !planType && authMode === "unknown") {
    return { available: false };
  }

  return {
    available: true,
    authMode,
    billing,
    plan: planLabel(planType),
    planType,
    subscriptionUntil,
  };
}

export async function readCodexBilling(): Promise<CodexBillingInfo> {
  try {
    const raw = JSON.parse(
      await fs.promises.readFile(path.join(codexHome(), "auth.json"), "utf8"),
    ) as CodexAuthFile;
    return billingFromAuth(raw);
  } catch {
    return { available: false };
  }
}
