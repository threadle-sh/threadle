import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import {
  applyAppearance,
  isAppearance,
  readStoredAppearance,
  type Appearance,
} from "@/theme/appearance";
import {
  applyProviderColors,
  DEFAULT_PROVIDER_HEX,
  normalizeProviderHex,
  parseProviderColorOverrides,
  PROVIDER_IDS,
} from "@/lib/providers";
import { editorFileUri, type ProviderId } from "@threadle/shared";

export type EditorMode = "vscode" | "vscode-insiders" | "cursor" | "zed" | "command";

const SCHEMES: Record<Exclude<EditorMode, "command">, string> = {
  vscode: "vscode",
  "vscode-insiders": "vscode-insiders",
  cursor: "cursor",
  zed: "zed",
};

const LABELS: Record<Exclude<EditorMode, "command">, string> = {
  vscode: "code",
  "vscode-insiders": "code",
  cursor: "cursor",
  zed: "zed",
};

export type ClaudeBilling = "subscription" | "api";

export interface NotifySettings {
  enabled: boolean;
  runFinished: boolean;
  approval: boolean;
  handoff: boolean;
}

export type NotifyKind = keyof Omit<NotifySettings, "enabled">;

export const DEFAULT_NOTIFY: NotifySettings = {
  enabled: true,
  runFinished: true,
  approval: true,
  handoff: true,
};

function parseNotify(raw: {
  desktopNotify?: boolean;
  notifications?: Partial<NotifySettings>;
}): NotifySettings {
  const n = raw.notifications ?? {};
  const legacyOff = raw.desktopNotify === false;
  return {
    enabled: legacyOff ? false : n.enabled !== false,
    runFinished: n.runFinished !== false,
    approval: n.approval !== false,
    handoff: n.handoff !== false,
  };
}

export const useSettingsStore = defineStore("settings", () => {
  const mode = ref<EditorMode>("vscode");
  const command = ref("");
  const claudeBilling = ref<ClaudeBilling>("subscription");
  const showExamples = ref(true);
  const mcpClientEnabled = ref(true);
  const mcpDisabledServers = ref<string[]>([]);
  const mcpPublishAllowlist = ref<string[] | null>([]);
  const notifications = reactive<NotifySettings>({ ...DEFAULT_NOTIFY });
  const appearance = ref<Appearance>(readStoredAppearance());
  /** Only non-default overrides are stored. */
  const providerColors = ref<Partial<Record<ProviderId, string>>>({});
  const loaded = ref(false);
  const saving = ref(false);

  /** True when master is on and the specific kind is enabled. */
  function notifyAllows(kind: NotifyKind): boolean {
    return notifications.enabled && notifications[kind];
  }

  /** Any notify kind still on — used to decide whether to request permission. */
  const notifyAny = computed(
    () =>
      notifications.enabled &&
      (notifications.runFinished || notifications.approval || notifications.handoff),
  );

  const providerColorsCustomized = computed(() =>
    PROVIDER_IDS.some((id) => Boolean(providerColors.value[id])),
  );

  /** Effective hex for Settings color inputs (override or default). */
  function providerColorValue(id: ProviderId): string {
    return providerColors.value[id] ?? DEFAULT_PROVIDER_HEX[id];
  }

  async function load(): Promise<void> {
    if (loaded.value) return;
    try {
      const res = await fetch("/api/settings");
      const s = (await res.json()) as {
        editor?: { mode?: EditorMode; command?: string };
        claudeBilling?: ClaudeBilling;
        showExamples?: boolean;
        desktopNotify?: boolean;
        notifications?: Partial<NotifySettings>;
        appearance?: Appearance;
        providerColors?: Partial<Record<string, string>>;
        mcpClientEnabled?: boolean;
        mcpDisabledServers?: string[];
        mcpPublishAllowlist?: string[] | null;
      };
      if (s.editor?.mode) mode.value = s.editor.mode;
      command.value = s.editor?.command ?? "";
      claudeBilling.value = s.claudeBilling === "api" ? "api" : "subscription";
      showExamples.value = s.showExamples !== false;
      mcpClientEnabled.value = s.mcpClientEnabled !== false;
      mcpDisabledServers.value = Array.isArray(s.mcpDisabledServers) ? s.mcpDisabledServers : [];
      mcpPublishAllowlist.value =
        s.mcpPublishAllowlist === null
          ? null
          : Array.isArray(s.mcpPublishAllowlist)
            ? s.mcpPublishAllowlist
            : [];
      Object.assign(notifications, parseNotify(s));
      if (isAppearance(s.appearance)) {
        appearance.value = s.appearance;
        applyAppearance(s.appearance);
      }
      providerColors.value = parseProviderColorOverrides(s.providerColors);
      applyProviderColors(providerColors.value);
    } catch {
      // defaults stand
      applyProviderColors({});
    } finally {
      loaded.value = true;
    }
  }

  async function save(): Promise<void> {
    saving.value = true;
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editor: { mode: mode.value, command: command.value || undefined },
          claudeBilling: claudeBilling.value,
          showExamples: showExamples.value,
          mcpClientEnabled: mcpClientEnabled.value,
          mcpDisabledServers: mcpDisabledServers.value,
          mcpPublishAllowlist: mcpPublishAllowlist.value,
          notifications: { ...notifications },
          appearance: appearance.value,
          providerColors: Object.keys(providerColors.value).length
            ? providerColors.value
            : undefined,
        }),
      });
    } finally {
      saving.value = false;
    }
  }

  async function setAppearance(next: Appearance): Promise<void> {
    if (appearance.value === next) return;
    appearance.value = next;
    applyAppearance(next);
    await save();
  }

  async function setProviderColor(id: ProviderId, raw: string): Promise<void> {
    const hex = normalizeProviderHex(raw);
    if (!hex) return;
    const next = { ...providerColors.value };
    if (hex === DEFAULT_PROVIDER_HEX[id]) delete next[id];
    else next[id] = hex;
    providerColors.value = next;
    applyProviderColors(next);
    await save();
  }

  async function resetProviderColors(): Promise<void> {
    if (!providerColorsCustomized.value) return;
    providerColors.value = {};
    applyProviderColors({});
    await save();
  }

  const editorLabel = computed(() =>
    mode.value === "command"
      ? (command.value.split(/\s+/)[0]?.split("/").pop() ?? "open")
      : LABELS[mode.value],
  );

  function openPath(path: string): void {
    if (mode.value === "command") {
      void fetch("/api/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
    } else {
      window.location.href = editorFileUri(SCHEMES[mode.value], path);
    }
  }

  return {
    mode,
    command,
    claudeBilling,
    showExamples,
    mcpClientEnabled,
    mcpDisabledServers,
    mcpPublishAllowlist,
    notifications,
    notifyAny,
    notifyAllows,
    appearance,
    providerColors,
    providerColorsCustomized,
    providerColorValue,
    setProviderColor,
    resetProviderColors,
    loaded,
    saving,
    load,
    save,
    setAppearance,
    editorLabel,
    openPath,
  };
});
