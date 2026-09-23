import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { execa } from "execa";
import { isAbsolutePath } from "@threadle/shared";
import { threadleConfigDir } from "../graphs/store.js";
import { isReadablePath } from "../readable-paths.js";
import { appLog } from "../jobs.js";

export interface NotifySettings {
  /** Master switch — when false, no desktop notifications. Default true. */
  enabled: boolean;
  /** Run finished / failed (background tab). Default true. */
  runFinished: boolean;
  /** Approval gate waiting for splice. Default true. */
  approval: boolean;
  /** Live handoff waiting. Default true. */
  handoff: boolean;
}

export type NotifyKind = keyof Omit<NotifySettings, "enabled">;

export const DEFAULT_NOTIFY: NotifySettings = {
  enabled: true,
  runFinished: true,
  approval: true,
  handoff: true,
};

export interface ThreadleSettings {
  editor: {
    /** url-scheme editors open client-side; "command" runs `command <path>` server-side */
    mode: "vscode" | "vscode-insiders" | "cursor" | "zed" | "command";
    /** shell-less command for mode=command, e.g. "emacsclient -n", "gvim", "subl" */
    command?: string;
  };
  /**
   * How Claude Code is billed: "subscription" (Pro/Max — actual spend is $0,
   * the tracked list price is hypothetical) or "api" (an API key pays list
   * price, so actual spend = tracked cost). Default: subscription.
   */
  claudeBilling?: "subscription" | "api";
  /** Show the Examples table under Workflows. Default: true. */
  showExamples?: boolean;
  /**
   * Desktop notifications (background tab). Prefer `notifications`;
   * `desktopNotify` is a legacy master switch still honored on read.
   */
  desktopNotify?: boolean;
  notifications?: Partial<NotifySettings>;
  /** UI color scheme: follow OS, or force light/dark. Default: system. */
  appearance?: "system" | "light" | "dark";
  /**
   * Optional provider accent overrides (`#rrggbb`). Omitted keys keep theme defaults.
   * Known ids: antigravity, claude-code, codex, copilot, cursor, grok, muse, opencode.
   */
  providerColors?: Partial<Record<string, string>>;
  /** When false, canvas MCP client discovery/calls are disabled. Default true. */
  mcpClientEnabled?: boolean;
  /** Server ids hidden from the MCP client (discovery + call). */
  mcpDisabledServers?: string[];
  /**
   * Graph ids published by `threadle mcp` as `wf_*` tools.
   * Empty array (default) = none. `null` = all saved workflows (opt-in).
   */
  mcpPublishAllowlist?: string[] | null;
  /**
   * Post-answer harness extras (Muse reminders, Claude hooks/slash skills,
   * Grok subagents, Antigravity slash skills). When false, inject passes each
   * provider's skip switches. Default false — workflows care about wall time.
   * Legacy key `museReminders` is still read.
   */
  harnessExtras?: boolean;
  /** @deprecated use harnessExtras */
  museReminders?: boolean;
}

const DEFAULTS: ThreadleSettings = {
  editor: { mode: "vscode" },
  claudeBilling: "subscription",
  showExamples: true,
  notifications: { ...DEFAULT_NOTIFY },
  appearance: "system",
  mcpClientEnabled: true,
  mcpDisabledServers: [],
  mcpPublishAllowlist: [],
  harnessExtras: false,
};

function settingsFile(): string {
  return path.join(threadleConfigDir(), "settings.json");
}

function parseAppearance(v: unknown): "system" | "light" | "dark" {
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function parseStringIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
}

function parsePublishAllowlist(v: unknown): string[] | null {
  // Explicit null = publish all (opt-in). Missing → default [].
  if (v === null) return null;
  if (v === undefined) return [];
  if (!Array.isArray(v)) return [];
  return parseStringIds(v);
}

const PROVIDER_COLOR_IDS = [
  "antigravity",
  "claude-code",
  "codex",
  "copilot",
  "cursor",
  "grok",
  "muse",
  "opencode",
] as const;

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function normalizeHex(raw: unknown): string | undefined {
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

function parseProviderColors(v: unknown): Partial<Record<string, string>> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Partial<Record<string, string>> = {};
  for (const id of PROVIDER_COLOR_IDS) {
    const hex = normalizeHex((v as Record<string, unknown>)[id]);
    if (hex) out[id] = hex;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Normalize notify prefs; migrates legacy `desktopNotify: false` → enabled off. */
export function parseNotifySettings(
  raw: Partial<ThreadleSettings> | undefined,
): NotifySettings {
  const n = raw?.notifications ?? {};
  const legacyOff = raw?.desktopNotify === false;
  return {
    enabled: legacyOff ? false : bool(n.enabled, true),
    runFinished: bool(n.runFinished, true),
    approval: bool(n.approval, true),
    handoff: bool(n.handoff, true),
  };
}

/**
 * Normalize an untrusted settings object into the canonical shape. Shared by
 * disk reads AND backup restore — restored `settings.json` bytes must pass
 * through here so they cannot smuggle fields the PUT validator would reject.
 */
export function normalizeSettings(raw: Partial<ThreadleSettings>): ThreadleSettings {
  const mode = raw.editor?.mode;
  const editorMode = ["vscode", "vscode-insiders", "cursor", "zed", "command"].includes(
    mode as string,
  )
    ? (mode as ThreadleSettings["editor"]["mode"])
    : DEFAULTS.editor.mode;
  return {
    editor: {
      mode: editorMode,
      command: raw.editor?.command?.trim() || undefined,
    },
    claudeBilling: raw.claudeBilling === "api" ? "api" : "subscription",
    showExamples: raw.showExamples !== false,
    notifications: parseNotifySettings(raw),
    appearance: parseAppearance(raw.appearance),
    providerColors: parseProviderColors(raw.providerColors),
    mcpClientEnabled: raw.mcpClientEnabled !== false,
    mcpDisabledServers: parseStringIds(raw.mcpDisabledServers),
    mcpPublishAllowlist: parsePublishAllowlist(raw.mcpPublishAllowlist),
    harnessExtras: raw.harnessExtras === true || raw.museReminders === true,
  };
}

export async function readSettings(): Promise<ThreadleSettings> {
  try {
    const raw = JSON.parse(
      await fs.promises.readFile(settingsFile(), "utf8"),
    ) as Partial<ThreadleSettings>;
    return normalizeSettings(raw);
  } catch {
    return {
      ...DEFAULTS,
      notifications: { ...DEFAULT_NOTIFY },
      mcpDisabledServers: [],
      mcpPublishAllowlist: [],
      harnessExtras: false,
    };
  }
}

/**
 * Editor binaries `open` may spawn. `editor.command` is client-writable and
 * also arrives via backup restore, so argv[0] must be recognizably an editor —
 * bare name or absolute path, but the basename has to be on this list. This
 * blocks `sh -c …`, `node -e …`, `osascript …` style escalation while keeping
 * every editor we know of working (wrapper scripts: name them like an editor).
 */
const EDITOR_BINS = new Set([
  "code",
  "code-insiders",
  "codium",
  "cursor",
  "zed",
  "subl",
  "sublime_text",
  "mate",
  "bbedit",
  "vim",
  "nvim",
  "gvim",
  "mvim",
  "emacs",
  "emacsclient",
  "hx",
  "kak",
  "micro",
  "idea",
  "webstorm",
  "open",
]);

export async function validateEditorCommand(
  command: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [bin] = command.trim().split(/\s+/);
  if (!bin) return { ok: false, error: "empty editor command" };
  const base = path.basename(bin);
  if (!EDITOR_BINS.has(base)) {
    return {
      ok: false,
      error: `"${base}" is not a recognized editor binary — allowed: ${[...EDITOR_BINS].join(", ")}`,
    };
  }
  if (bin !== base) {
    // path form — must be absolute and actually executable
    if (!isAbsolutePath(bin)) {
      return { ok: false, error: "editor command paths must be absolute" };
    }
    try {
      const st = await fs.promises.stat(bin);
      if (!st.isFile()) throw new Error("not a file");
      await fs.promises.access(bin, fs.constants.X_OK);
    } catch {
      return { ok: false, error: `editor binary not found or not executable: ${bin}` };
    }
  }
  return { ok: true };
}

export const settingsRoutes = new Hono();

settingsRoutes.get("/", async (c) => c.json(await readSettings()));

settingsRoutes.put("/", async (c) => {
  const body = (await c.req.json()) as ThreadleSettings;
  const mode = body.editor?.mode;
  if (!["vscode", "vscode-insiders", "cursor", "zed", "command"].includes(mode)) {
    return c.json({ error: "invalid editor mode" }, 400);
  }
  const editorCommand = body.editor?.command?.trim();
  if (mode === "command" && editorCommand) {
    const check = await validateEditorCommand(editorCommand);
    if (!check.ok) return c.json({ error: check.error }, 400);
  }
  const notifications = parseNotifySettings(body);
  const providerColors = parseProviderColors(body.providerColors);
  const next: ThreadleSettings = {
    editor: { mode, command: body.editor.command?.trim() || undefined },
    claudeBilling: body.claudeBilling === "api" ? "api" : "subscription",
    showExamples: body.showExamples !== false,
    notifications,
    appearance: parseAppearance(body.appearance),
    providerColors,
    mcpClientEnabled: body.mcpClientEnabled !== false,
    mcpDisabledServers: parseStringIds(body.mcpDisabledServers),
    mcpPublishAllowlist: parsePublishAllowlist(body.mcpPublishAllowlist),
    harnessExtras: body.harnessExtras === true || body.museReminders === true,
  };
  await fs.promises.mkdir(threadleConfigDir(), { recursive: true });
  await fs.promises.writeFile(settingsFile(), JSON.stringify(next, null, 2), "utf8");
  return c.json(next);
});

export const openRoutes = new Hono();

/** Open a file/folder with the configured command editor (mode=command only). */
openRoutes.post("/", async (c) => {
  const { path: target } = (await c.req.json()) as { path?: string };
  if (!target || typeof target !== "string" || !isAbsolutePath(target)) {
    return c.json({ error: "absolute path required" }, 400);
  }
  if (!(await isReadablePath(target))) {
    appLog("server", "open denied — path not in allowed roots");
    return c.json({ error: "path not in allowed roots" }, 403);
  }
  const settings = await readSettings();
  if (settings.editor.mode !== "command") {
    return c.json({ error: "editor mode is not 'command'" }, 400);
  }
  const command = settings.editor.command;
  if (!command) return c.json({ error: "no editor command configured" }, 400);

  // Validate at the SINK too — settings.json can arrive by backup restore or
  // hand edit without ever passing the PUT validator.
  const check = await validateEditorCommand(command);
  if (!check.ok) {
    appLog("server", `open denied — ${check.error}`);
    return c.json({ error: check.error }, 400);
  }

  const [bin, ...args] = command.split(/\s+/);
  if (!bin) return c.json({ error: "invalid editor command" }, 400);
  try {
    const child = execa(bin, [...args, target], {
      detached: true,
      stdio: "ignore",
      cleanup: false,
    });
    child.unref();
    return c.json({ ok: true });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
