import type { LogSink } from "./stream.js";
import { PROVIDER_HARNESS_EXTRAS, type ProviderId } from "@threadle/shared";

/**
 * Resolve whether post-answer harness extras should run for a provider spawn.
 * Node/API override wins; otherwise Settings `harnessExtras` (legacy `museReminders`).
 * Default false.
 */
export async function resolveRunHarnessExtras(override?: boolean): Promise<boolean> {
  if (override !== undefined) return override;
  try {
    const { readSettings } = await import("../routes/settings.js");
    const s = await readSettings();
    return s.harnessExtras === true || s.museReminders === true;
  } catch {
    return false;
  }
}

/**
 * Emit one meta header + a line per harness lane (run / skipped) into the run log.
 */
export function logHarnessExtrasLanes(
  onLog: LogSink | undefined,
  provider: ProviderId | string,
  enabled: boolean,
): void {
  if (!onLog) return;
  const spec = PROVIDER_HARNESS_EXTRAS[provider as ProviderId];
  if (!spec?.lanes.length) {
    onLog("meta", enabled ? "extras on" : "extras off");
    return;
  }
  onLog(
    "meta",
    enabled
      ? `extras on · ${spec.lanes.length} lane${spec.lanes.length === 1 ? "" : "s"}`
      : `extras off · ${spec.lanes.length} lane${spec.lanes.length === 1 ? "" : "s"} skipped`,
  );
  for (const name of spec.lanes) {
    onLog("meta", enabled ? `· ${name} · run` : `⊘ ${name} · skipped`);
  }
}
