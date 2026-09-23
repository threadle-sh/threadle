import type { ProviderId } from "./session.js";

/**
 * Post-answer / background harness extras per provider — things that hold the
 * CLI open after the main answer (Muse reminders, Claude hooks, Grok subagents, …).
 * Only providers with a known skip switch are listed.
 */
export interface HarnessExtrasSpec {
  /** Short rows for the inspector list */
  lanes: readonly string[];
  /** One-line tooltip / note */
  blurb: string;
}

export const PROVIDER_HARNESS_EXTRAS: Partial<Record<ProviderId, HarnessExtrasSpec>> = {
  muse: {
    lanes: [
      "skill-reminder",
      "goal-reminder",
      "verify-reminder",
      "memory-reminder",
      "todo-reminder",
      "scope-reminder",
    ],
    blurb: "Muse post-answer reminder subagents (skill / goal / verify / …).",
  },
  "claude-code": {
    lanes: ["slash skills"],
    blurb: "Claude --disable-slash-commands (skills / slash commands). Avoids --bare, which drops login.",
  },
  grok: {
    lanes: ["subagents"],
    blurb: "Grok --no-subagents (blocks spawned child agents).",
  },
  antigravity: {
    lanes: ["slash skills"],
    blurb: "Antigravity --disable-slash-commands in print mode.",
  },
};

export function providerHasHarnessExtras(provider: ProviderId | string): boolean {
  return Boolean(PROVIDER_HARNESS_EXTRAS[provider as ProviderId]);
}

/** Effective on/off: node override wins, else Settings default. */
export function resolveHarnessExtras(
  nodeValue: boolean | undefined,
  settingsDefault: boolean,
): boolean {
  return nodeValue !== undefined ? nodeValue : settingsDefault;
}

/** Read node field (supports legacy `museReminders`). */
export function nodeHarnessExtrasField(data: {
  harnessExtras?: boolean;
  museReminders?: boolean;
}): boolean | undefined {
  if (data.harnessExtras !== undefined) return data.harnessExtras;
  if (data.museReminders !== undefined) return data.museReminders;
  return undefined;
}

export function setNodeHarnessExtras(
  data: { harnessExtras?: boolean; museReminders?: boolean },
  value: boolean | undefined,
): void {
  if (value === undefined) delete data.harnessExtras;
  else data.harnessExtras = value;
  if ("museReminders" in data) delete data.museReminders;
}
