import type { ProviderId } from "@threadle/shared";
import { PROVIDER_HARNESS_EXTRAS } from "@threadle/shared";

export const PILOT_PROMPT = "Reply with exactly the single word: ok";

/** One smoke spawn in the Settings test-pilot matrix */
export interface PilotCaseDef {
  id: string;
  provider: ProviderId;
  /** Short case label (table “case” column) */
  variant: string;
  agent: string;
  model?: string;
  permissionMode?: string;
  sandbox?: string;
  askForApproval?: string;
  /** Override Settings harnessExtras for this spawn */
  harnessExtras?: boolean;
  /** Only run when Settings pilot “extra tests” is on */
  extra?: boolean;
  note?: string;
}

const BASE: Record<
  ProviderId,
  Omit<PilotCaseDef, "id" | "provider" | "variant" | "extra">
> = {
  "claude-code": { agent: "general-purpose", model: "haiku", harnessExtras: false },
  cursor: {
    agent: "ask",
    model: "auto",
    harnessExtras: false,
    note: "ask mode (read-only)",
  },
  antigravity: { agent: "agent", harnessExtras: false },
  codex: { agent: "codex", harnessExtras: false },
  copilot: { agent: "copilot", harnessExtras: false },
  grok: { agent: "grok", model: "grok-4.5", harnessExtras: false },
  muse: { agent: "muse", harnessExtras: false },
  opencode: { agent: "build", harnessExtras: false },
};

const HARNESS_PROVIDERS = Object.keys(PROVIDER_HARNESS_EXTRAS) as ProviderId[];

/** Pair of extras:off / extras:on for every provider with a skip switch */
function harnessExtraCases(): PilotCaseDef[] {
  const out: PilotCaseDef[] = [];
  for (const provider of HARNESS_PROVIDERS) {
    const base = BASE[provider];
    const lanes = PROVIDER_HARNESS_EXTRAS[provider]?.lanes ?? [];
    const laneNote = lanes.join(", ");
    out.push({
      id: `${provider}:extras-off`,
      provider,
      variant: "extras:off",
      agent: base.agent,
      model: base.model,
      harnessExtras: false,
      extra: true,
      note: laneNote ? `skip: ${laneNote}` : "harness extras off",
    });
    out.push({
      id: `${provider}:extras-on`,
      provider,
      variant: "extras:on",
      agent: base.agent,
      model: base.model,
      harnessExtras: true,
      extra: true,
      note: laneNote ? `run: ${laneNote}` : "harness extras on",
    });
  }
  return out;
}

/** Optional flag / mode matrix — toggled on in the pilot UI */
const EXTRA: PilotCaseDef[] = [
  {
    id: "claude-code:permission-plan",
    provider: "claude-code",
    variant: "permission:plan",
    agent: "general-purpose",
    model: "haiku",
    permissionMode: "plan",
    harnessExtras: false,
    extra: true,
    note: "--permission-mode plan",
  },
  {
    id: "claude-code:permission-accept",
    provider: "claude-code",
    variant: "permission:acceptEdits",
    agent: "general-purpose",
    model: "haiku",
    permissionMode: "acceptEdits",
    harnessExtras: false,
    extra: true,
    note: "--permission-mode acceptEdits",
  },
  {
    id: "cursor:agent",
    provider: "cursor",
    variant: "mode:agent",
    agent: "agent",
    model: "auto",
    harnessExtras: false,
    extra: true,
    note: "full agent mode",
  },
  {
    id: "cursor:plan",
    provider: "cursor",
    variant: "mode:plan",
    agent: "plan",
    model: "auto",
    harnessExtras: false,
    extra: true,
    note: "--mode plan",
  },
  {
    id: "antigravity:mode-plan",
    provider: "antigravity",
    variant: "mode:plan",
    agent: "plan",
    harnessExtras: false,
    extra: true,
    note: "--mode plan",
  },
  {
    id: "codex:sandbox-ro",
    provider: "codex",
    variant: "sandbox:read-only",
    agent: "codex",
    sandbox: "read-only",
    askForApproval: "never",
    harnessExtras: false,
    extra: true,
    note: "--sandbox read-only",
  },
  {
    id: "codex:sandbox-full",
    provider: "codex",
    variant: "sandbox:danger-full-access",
    agent: "codex",
    sandbox: "danger-full-access",
    askForApproval: "never",
    harnessExtras: false,
    extra: true,
    note: "--sandbox danger-full-access",
  },
  {
    id: "codex:ask-on-request",
    provider: "codex",
    variant: "ask:on-request",
    agent: "codex",
    sandbox: "workspace-write",
    askForApproval: "on-request",
    harnessExtras: false,
    extra: true,
    note: "sandbox without --approve-for-me",
  },
  ...harnessExtraCases(),
];

function baseCase(provider: ProviderId): PilotCaseDef {
  const b = BASE[provider];
  return {
    id: provider,
    provider,
    variant: "default",
    ...b,
    extra: false,
  };
}

export const PILOT_PROVIDER_IDS = Object.keys(BASE) as ProviderId[];

/** All pilot cases (base + optional extras) */
export function allPilotCases(): PilotCaseDef[] {
  return [...PILOT_PROVIDER_IDS.map(baseCase), ...EXTRA];
}

/** Cases visible for the current extra-tests toggle */
export function pilotCasesFor(extraTests: boolean): PilotCaseDef[] {
  const all = allPilotCases();
  return extraTests ? all : all.filter((c) => !c.extra);
}
