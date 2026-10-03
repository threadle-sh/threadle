import { createApp } from "vue";
import { createPinia } from "pinia";
import type { RouteLocationNormalized, RouteRecordRaw, Router } from "vue-router";
import App from "./App.vue";
import "./theme/theme.css";
import { applyAppearance, readStoredAppearance } from "./theme/appearance";
import { useSessionsStore } from "./stores/sessions";

/**
 * Route records for paths owned by the OTHER app (viewer ↔ workflows editor).
 * A router.push / router-link to one of them opens that app (its own port,
 * its own tab) via `open`; landing on one at boot falls back to `home`.
 */
export function foreignRoutes(
  paths: string[],
  home: string,
  open: (fullPath: string) => void,
): RouteRecordRaw[] {
  return paths.map((path) => ({
    path,
    component: { render: () => null },
    beforeEnter: (to: RouteLocationNormalized, from: RouteLocationNormalized) => {
      if (from.matched.length === 0) return { path: home };
      open(to.fullPath);
      return false;
    },
  }));
}

/** Shared bootstrap for both entries (viewer index.html, workflows.html). */
export function bootApp(router: Router): void {
  applyAppearance(readStoredAppearance());

  const pinia = createPinia();
  createApp(App).use(pinia).use(router).mount("#app");

  // Provider chips hydrate from localStorage + a fast /api/providers call — don't
  // wait for the heavier sessions list.
  useSessionsStore(pinia).ensureHydrated();

  // frontend errors land in the combined Logs view (kind "app" · frontend)
  let appLogBudget = 30;
  function reportAppError(line: string): void {
    if (appLogBudget-- <= 0) return;
    void fetch("/api/jobs/app-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line: line.slice(0, 2000) }),
    }).catch(() => undefined);
  }
  window.addEventListener("error", (e) =>
    reportAppError(`[error] ${e.message} (${e.filename}:${e.lineno})`),
  );
  window.addEventListener("unhandledrejection", (e) =>
    reportAppError(`[unhandledrejection] ${String(e.reason).slice(0, 500)}`),
  );
}
