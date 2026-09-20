import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { agentBin } from "./agent-bin.js";
import { cursorHome } from "./paths.js";

/**
 * Cursor billing / plan — prefer `agent about --format json` (`subscriptionTier`),
 * which is what the CLI prints as "Subscription Tier". Fallback: logged-in
 * signal from `~/.cursor/cli-config.json` authInfo (no tier). Email / tokens
 * never leave this module.
 */

export interface CursorBillingInfo {
  available: boolean;
  /** subscription (Pro/Business/…) | api (API-key runs) | unknown */
  billing?: "subscription" | "api" | "unknown";
  /** e.g. Cursor Pro */
  plan?: string;
  /** raw CLI field, e.g. Pro */
  subscriptionTier?: string;
  loggedIn?: boolean;
}

interface AboutJson {
  subscriptionTier?: string;
  userEmail?: string;
}

interface CliConfigAuth {
  authInfo?: { email?: string; userId?: number; authId?: string };
}

const TIER_LABELS: Record<string, string> = {
  free: "Cursor Free",
  hobby: "Cursor Hobby",
  pro: "Cursor Pro",
  pro_plus: "Cursor Pro+",
  "pro+": "Cursor Pro+",
  business: "Cursor Business",
  teams: "Cursor Teams",
  team: "Cursor Team",
  ultra: "Cursor Ultra",
  enterprise: "Cursor Enterprise",
};

export function planFromTier(tier: string | undefined): {
  plan?: string;
  billing: CursorBillingInfo["billing"];
  subscriptionTier?: string;
} {
  const raw = tier?.trim();
  if (!raw) return { billing: "unknown" };
  const key = raw.toLowerCase().replace(/\s+/g, "_");
  const plan = TIER_LABELS[key] ?? (raw.toLowerCase().startsWith("cursor") ? raw : `Cursor ${raw}`);
  // Free/hobby still subscription-product; API-key auth is a separate mode we
  // rarely see via `about`. Treat known tiers as subscription.
  return { plan, billing: "subscription", subscriptionTier: raw };
}

export function billingFromAbout(about: AboutJson, loggedInHint?: boolean): CursorBillingInfo {
  const fromTier = planFromTier(about.subscriptionTier);
  if (fromTier.subscriptionTier) {
    return {
      available: true,
      ...fromTier,
      loggedIn: true,
    };
  }
  if (loggedInHint || about.userEmail) {
    return {
      available: true,
      billing: "unknown",
      loggedIn: true,
      plan: "Cursor (signed in)",
    };
  }
  return { available: false };
}

async function readCliLoggedIn(): Promise<boolean> {
  try {
    const raw = JSON.parse(
      await fs.promises.readFile(path.join(cursorHome(), "cli-config.json"), "utf8"),
    ) as CliConfigAuth;
    return !!(raw.authInfo?.userId || raw.authInfo?.authId || raw.authInfo?.email);
  } catch {
    return false;
  }
}

let cache: { at: number; info: CursorBillingInfo } | undefined;
const CACHE_TTL_MS = 60_000;

export function invalidateCursorBillingCache(): void {
  cache = undefined;
}

export async function readCursorBilling(force = false): Promise<CursorBillingInfo> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.info;

  const loggedIn = await readCliLoggedIn();
  let info: CursorBillingInfo = loggedIn
    ? { available: true, billing: "unknown", loggedIn: true, plan: "Cursor (signed in)" }
    : { available: false };

  try {
    const { stdout, exitCode } = await execa(agentBin(), ["about", "--format", "json"], {
      timeout: 12_000,
      reject: false,
      env: { ...process.env, NO_OPEN_BROWSER: "1" },
    });
    if (exitCode === 0 && stdout.trim()) {
      const about = JSON.parse(stdout) as AboutJson;
      info = billingFromAbout(about, loggedIn);
    }
  } catch {
    // CLI missing / timed out — keep cli-config fallback
  }

  cache = { at: Date.now(), info };
  return info;
}
