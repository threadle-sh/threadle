import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";
import "@vue-flow/minimap/dist/style.css";
import "@vue-flow/node-resizer/dist/style.css";
import "./theme/theme.css";
import { applyAppearance, readStoredAppearance } from "./theme/appearance";
import { useSessionsStore } from "./stores/sessions";

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
