import type { ProviderId } from "@threadle/shared";

export const PROVIDER_IDS: ProviderId[] = [
  "antigravity",
  "claude-code",
  "codex",
  "copilot",
  "cursor",
  "grok",
  "muse",
  "opencode",
];

export const SESSION_FILTERS = ["all", ...PROVIDER_IDS] as const;
export type SessionFilter = (typeof SESSION_FILTERS)[number];

export const SEARCH_FILTERS = ["all", ...PROVIDER_IDS, "payload"] as const;
export type SearchFilter = (typeof SEARCH_FILTERS)[number];

/**
 * Providers that are connected on this machine and/or appear in session rows.
 * Used to hide filter chips for tools the user doesn't have.
 */
export function knownProviderIds(
  providers: Array<{ id: string; available?: boolean }>,
  sessionProviders: Iterable<string> = [],
): string[] {
  const set = new Set<string>();
  for (const p of providers) {
    if (p.available) set.add(p.id);
  }
  for (const id of sessionProviders) {
    if (id) set.add(id);
  }
  return [...set];
}

/** Alpha-ordered session filters limited to providers that are present. */
export function sessionFiltersFor(present: Iterable<string>): SessionFilter[] {
  const set = new Set(present);
  return SESSION_FILTERS.filter((f) => f === "all" || set.has(f));
}

/** Search filters: present providers (alpha) + always-on "payloads". */
export function searchFiltersFor(present: Iterable<string>): SearchFilter[] {
  const set = new Set(present);
  return SEARCH_FILTERS.filter((f) => f === "all" || f === "payload" || set.has(f));
}

const LABELS: Record<ProviderId, string> = {
  "claude-code": "Claude",
  opencode: "opencode",
  cursor: "Cursor",
  antigravity: "Antigravity",
  codex: "Codex",
  copilot: "Copilot",
  grok: "Grok Build",
  muse: "Muse Code",
};

const SHORT: Record<ProviderId, string> = {
  "claude-code": "claude",
  opencode: "opencode",
  cursor: "cursor",
  antigravity: "agy",
  codex: "codex",
  copilot: "copilot",
  grok: "grok",
  muse: "muse",
};

/** CSS custom property names under :root / theme.css */
export const PROVIDER_CSS_VAR: Record<ProviderId, string> = {
  "claude-code": "--claude",
  opencode: "--opencode",
  cursor: "--cursor",
  antigravity: "--antigravity",
  codex: "--codex",
  copilot: "--copilot",
  grok: "--grok",
  muse: "--muse",
};

/** Built-in hex colors (match theme.css provider chips). */
export const DEFAULT_PROVIDER_HEX: Record<ProviderId, string> = {
  "claude-code": "#c4845e",
  opencode: "#3aaca0",
  cursor: "#7d92dc",
  antigravity: "#c9a84a",
  codex: "#5faf82",
  copilot: "#d489a8",
  grok: "#9b87c9",
  muse: "#568ab8",
};

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalize to #rrggbb lowercase, or undefined if invalid. */
export function normalizeProviderHex(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (!HEX_RE.test(t)) return undefined;
  if (t.length === 4) {
    const r = t[1]!;
    const g = t[2]!;
    const b = t[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return t.toLowerCase();
}

let activeHex: Record<ProviderId, string> = { ...DEFAULT_PROVIDER_HEX };

/**
 * Apply provider color overrides to :root CSS vars + in-memory hex map.
 * Pass empty/undefined to restore theme.css defaults (removes inline props).
 */
export function applyProviderColors(
  overrides?: Partial<Record<string, string>> | null,
): void {
  activeHex = { ...DEFAULT_PROVIDER_HEX };
  if (typeof document === "undefined") {
    if (overrides) {
      for (const id of PROVIDER_IDS) {
        const hex = normalizeProviderHex(overrides[id]);
        if (hex) activeHex[id] = hex;
      }
    }
    return;
  }
  const root = document.documentElement;
  for (const id of PROVIDER_IDS) {
    const cssVar = PROVIDER_CSS_VAR[id];
    const hex = normalizeProviderHex(overrides?.[id]);
    if (hex && hex !== DEFAULT_PROVIDER_HEX[id]) {
      activeHex[id] = hex;
      root.style.setProperty(cssVar, hex);
    } else {
      root.style.removeProperty(cssVar);
    }
  }
}

/** Parse persisted map; only known providers + valid hex kept. */
export function parseProviderColorOverrides(
  raw: unknown,
): Partial<Record<ProviderId, string>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<Record<ProviderId, string>> = {};
  for (const id of PROVIDER_IDS) {
    const hex = normalizeProviderHex((raw as Record<string, unknown>)[id]);
    if (hex && hex !== DEFAULT_PROVIDER_HEX[id]) out[id] = hex;
  }
  return out;
}

export function providerLabel(id: string): string {
  return LABELS[id as ProviderId] ?? id;
}

/** Longer name for Services / storage rows. */
export function providerServiceName(id: string): string {
  if (id === "claude-code") return "claude code";
  if (id === "cursor") return "cursor agent";
  if (id === "antigravity") return "antigravity (agy)";
  if (id === "codex") return "codex (openai)";
  if (id === "copilot") return "github copilot";
  if (id === "grok") return "grok build";
  if (id === "muse") return "muse code";
  return id;
}

export function providerShort(id: string): string {
  return SHORT[id as ProviderId] ?? id;
}

/** CSS color for UI (respects Settings overrides via CSS vars). */
export function providerColor(provider: string): string {
  if (provider === "threadle") return "var(--threadle)";
  const v = PROVIDER_CSS_VAR[provider as ProviderId];
  return v ? `var(${v})` : "var(--text-faint)";
}

/** Resolved hex for canvas / SVG (respects Settings overrides). */
export function providerColorHex(provider: string): string {
  return activeHex[provider as ProviderId] ?? "#888888";
}

/** Prefer a different provider than `from` when picking a handoff target. */
export function defaultHandoffTarget(from: string): ProviderId {
  if (from === "claude-code") return "cursor";
  if (from === "cursor") return "opencode";
  if (from === "opencode") return "antigravity";
  if (from === "antigravity") return "codex";
  if (from === "codex") return "copilot";
  if (from === "copilot") return "grok";
  if (from === "grok") return "muse";
  if (from === "muse") return "claude-code";
  return "claude-code";
}
