import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { claudeWindowViews, type ClaudeUsageWindowView } from "@threadle/shared";
import {
  readAntigravityBilling,
  type AntigravityBillingInfo,
} from "../providers/antigravity/auth.js";
import { readCodexBilling, type CodexBillingInfo } from "../providers/codex/auth.js";
import { readCursorBilling, type CursorBillingInfo } from "../providers/cursor/auth.js";

/**
 * Claude subscription info, read passively from ~/.claude.json — the state
 * file Claude Code maintains itself (plan tier from the OAuth account,
 * usage-window utilization cached from its /usage calls). threadle never phones
 * home for this; it only mirrors what the CLI already stored locally.
 * Deliberately omitted: email address and referral data.
 *
 * Codex plan / billing is mirrored from ~/.codex/auth.json (auth_mode + ChatGPT
 * plan claims inside the local JWT). Antigravity auth *mode* (Google OAuth
 * consumer vs API/Vertex) comes from ~/.gemini/settings.json + onboarding
 * cache — no Gemini Advanced / Google One tier is stored on disk. Cursor plan
 * comes from `agent about --format json` (`subscriptionTier`).
 * Tokens and email never leave the server process.
 */

interface UsageWindow {
  utilization?: number;
  resets_at?: string | null;
}

interface ClaudeStateFile {
  oauthAccount?: {
    billingType?: string;
    organizationType?: string;
    organizationRateLimitTier?: string;
    userRateLimitTier?: string;
    subscriptionCreatedAt?: string;
    hasExtraUsageEnabled?: boolean;
  };
  cachedUsageUtilization?: {
    fetchedAtMs?: number;
    utilization?: {
      five_hour?: UsageWindow | null;
      seven_day?: UsageWindow | null;
      seven_day_opus?: UsageWindow | null;
      extra_usage?: { is_enabled?: boolean } | null;
    };
  };
}

export interface SubscriptionInfo {
  available: boolean;
  /** human plan name, e.g. "Claude Max 5×" */
  plan?: string;
  /** raw tier id, e.g. "default_claude_max_5x" */
  tier?: string;
  billingType?: string;
  subscriptionSince?: string;
  extraUsageEnabled?: boolean;
  usage?: {
    fetchedAtMs?: number;
    fiveHour?: { utilization: number; resetsAt?: string };
    sevenDay?: { utilization: number; resetsAt?: string };
    sevenDayOpus?: { utilization: number; resetsAt?: string };
  };
  /** Codex ChatGPT / API billing from ~/.codex/auth.json */
  codex?: CodexBillingInfo;
  /** Antigravity auth mode from ~/.gemini (no paid-tier claim on disk) */
  antigravity?: AntigravityBillingInfo;
  /** Cursor subscription tier from `agent about` */
  cursor?: CursorBillingInfo;
  /**
   * Claude plan windows that are hot (≥90%) or exhausted (≥100%).
   * Cursor / Grok / etc. do not expose remaining % on disk — only CLI errors.
   */
  claudeWindows?: ClaudeUsageWindowView[];
  note?: string;
}

/** "default_claude_max_5x" + "claude_max" → "Claude Max 5×" */
function planName(orgType?: string, tier?: string): string | undefined {
  const base =
    orgType === "claude_max"
      ? "Claude Max"
      : orgType === "claude_pro"
        ? "Claude Pro"
        : orgType === "claude_enterprise"
          ? "Claude Enterprise"
          : orgType === "claude_team"
            ? "Claude Team"
            : orgType;
  if (!base) return undefined;
  const mult = tier?.match(/_(\d+)x$/)?.[1];
  return mult ? `${base} ${mult}×` : base;
}

function window(w?: UsageWindow | null): { utilization: number; resetsAt?: string } | undefined {
  if (!w || typeof w.utilization !== "number") return undefined;
  return { utilization: w.utilization, resetsAt: w.resets_at ?? undefined };
}

export async function readSubscription(): Promise<SubscriptionInfo> {
  const [codex, antigravity, cursor] = await Promise.all([
    readCodexBilling(),
    readAntigravityBilling(),
    readCursorBilling(),
  ]);
  const extras = {
    codex: codex.available ? codex : undefined,
    antigravity: antigravity.available ? antigravity : undefined,
    cursor: cursor.available ? cursor : undefined,
  };

  let state: ClaudeStateFile;
  try {
    state = JSON.parse(
      await fs.promises.readFile(path.join(os.homedir(), ".claude.json"), "utf8"),
    ) as ClaudeStateFile;
  } catch {
    return { available: false, ...extras };
  }
  const acct = state.oauthAccount;
  if (!acct) {
    return { available: false, ...extras };
  }
  const util = state.cachedUsageUtilization?.utilization;
  const usage = util
    ? {
        fetchedAtMs: state.cachedUsageUtilization?.fetchedAtMs,
        fiveHour: window(util.five_hour),
        sevenDay: window(util.seven_day),
        sevenDayOpus: window(util.seven_day_opus),
      }
    : undefined;
  const claudeWindows = claudeWindowViews(usage);
  return {
    available: true,
    plan: planName(acct.organizationType, acct.userRateLimitTier ?? acct.organizationRateLimitTier),
    tier: acct.userRateLimitTier ?? acct.organizationRateLimitTier,
    billingType: acct.billingType,
    subscriptionSince: acct.subscriptionCreatedAt,
    extraUsageEnabled: acct.hasExtraUsageEnabled,
    usage,
    claudeWindows,
    note:
      "Claude plan limits are 5h + 7d (weekly) windows from ~/.claude.json. Cursor model pools are monthly (Spending dashboard) — not mirrored here.",
    ...extras,
  };
}

export const subscriptionRoutes = new Hono();

subscriptionRoutes.get("/", async (c) => c.json(await readSubscription()));
