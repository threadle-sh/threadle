import { useSettingsStore } from "@/stores/settings";

/**
 * Desktop (Web Notification API) alerts for run lifecycle events, gated by the
 * user's notification settings and only fired while the tab is hidden. Pure —
 * no graph/canvas state; reads the settings store directly.
 */
export function useDesktopNotifications(): {
  ensureNotifyPermission: () => void;
  notifyRunFinished: (ok: boolean, label: string) => void;
  notifyNeedsYou: (kind: "approval" | "handoff") => void;
} {
  const settings = useSettingsStore();

  function ensureNotifyPermission(): void {
    if (!settings.notifyAny) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "default") return;
    void Notification.requestPermission().catch(() => undefined);
  }

  function desktopNotify(
    kind: "runFinished" | "approval" | "handoff",
    title: string,
    body: string,
  ): void {
    if (!settings.notifyAllows(kind)) return;
    if (typeof document === "undefined" || !document.hidden) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      new Notification(title, { body, silent: true });
    } catch {
      // ignore
    }
  }

  function notifyRunFinished(ok: boolean, label: string): void {
    desktopNotify(
      "runFinished",
      ok ? "threadle · run finished" : "threadle · run failed",
      label,
    );
  }

  function notifyNeedsYou(kind: "approval" | "handoff"): void {
    desktopNotify(
      kind,
      "threadle · needs you",
      kind === "approval" ? "approval gate — splice to continue" : "live handoff waiting",
    );
  }

  return { ensureNotifyPermission, notifyRunFinished, notifyNeedsYou };
}
