<template>
  <div class="dash">
    <DashNav :items="navItems" :active="view" @select="onNav" />

    <div class="dash-col">
    <main class="dash-main">
      <!-- ============ sessions + subagent viewer ============ -->
      <SessionsView
        v-if="view === 'sessions'"
        v-model:provider-filter="providerFilter"
        v-model:open-request="sessionOpenRequest"
        @nav="onNav"
        @handoff="onHandoff"
      />

      <!-- ============ rules ============ -->
      <RulesView
        v-else-if="view === 'rules'"
        :rule-groups="ruleGroups"
        :focus="rulesFocus"
        @reload="reloadRuleGroups"
      />

      <!-- ============ skills ============ -->
      <SkillsView
        v-else-if="view === 'skills'"
        :rule-groups="ruleGroups"
        :focus="skillFocus"
        @reload="reloadRuleGroups"
      />

      <!-- ============ services ============ -->
      <ServicesView
        v-else-if="view === 'services'"
        :providers="providers"
        @nav="onNav"
        @set-provider-filter="onSetProviderFilter"
      />

      <!-- ============ meta ============ -->
      <MetaView
        v-else-if="view === 'meta'"
        :graphs="graphs"
        :rule-groups="ruleGroups"
        @nav="onNav"
      />

      <!-- ============ security ============ -->
      <SecurityView v-else-if="view === 'security'" />

      <!-- ============ files ============ -->
      <FilesView v-else-if="view === 'files'" />

      <!-- ============ file activity per session ============ -->
      <ActivityView v-else-if="view === 'activity'" />

      <!-- ============ settings ============ -->
      <SettingsView v-else-if="view === 'settings'" />

      <!-- ============ combined run logs ============ -->


      <!-- ============ usage / statistics ============ -->
      <UsageView v-else-if="view === 'usage'" />

      <!-- ============ full-text search ============ -->
      <SearchView v-else-if="view === 'search'" />

      <!-- ============ payload library ============ -->
      <LibraryView
        v-else-if="view === 'library'"
        @nav="onNav"
        @open-session="onOpenSession"
      />

      <!-- ============ favorites jump list ============ -->
      <FavoritesView
        v-else-if="view === 'favorites'"
        @open-session="onFavoriteSession"
      />


      <!-- ============ agents ============ -->
      <AgentsView
        v-else-if="view === 'agents'"
        :focus="agentFocus"
        :browse="agentBrowseFocus"
        :plugin-focus="pluginFocus"
        @nav="onNav"
        @open-session="onOpenSession"
      />

      <HandoffModal
        v-if="handoffSource"
        :source="{
          provider: handoffSource.provider,
          sessionId: handoffSource.id,
          title: handoffSource.title,
          projectDir: handoffSource.projectDir,
        }"
        @close="handoffSource = undefined"
        @open-session="openHandoffResult"
      />
    </main>
    <StatusBar />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  GraphSummary,
  ProviderInfo,
  SessionRef,
} from "@threadle/shared";
import { api, subscribeEvents } from "@ui/api/client";
import { type SessionFilter } from "@ui/lib/providers";
import { useSessionsStore } from "@ui/stores/sessions";
import { useSettingsStore } from "@ui/stores/settings";
import { useFavoritesStore } from "@ui/stores/favorites";
import HandoffModal from "@/panels/HandoffModal.vue";
import StatusBar from "@ui/panels/StatusBar.vue";
import DashNav from "@ui/panels/DashNav.vue";
import { useNavItems } from "@ui/panels/useNavItems";

import {
  ServicesView,
  SecurityView,
  FilesView,
  ActivityView,
  MetaView,
  LibraryView,
  SearchView,
  RulesView,
  SkillsView,
  SettingsView,
  SessionsView,
  UsageView,
  AgentsView,
  FavoritesView,
} from "@/viewer/dashboard";
import "@ui/theme/chrome.css";

const router = useRouter();
const sessions = useSessionsStore();
const settings = useSettingsStore();
const favorites = useFavoritesStore();
void settings.load();
void favorites.ensureLoaded();


/** Workflow summaries (names for Meta). Empty when workflows are off. */
const graphs = ref<GraphSummary[]>([]);
const providers = ref<ProviderInfo[]>([]);
const loading = ref(true);
type ViewId =
  | "sessions" | "search" | "agents" | "rules" | "skills" | "services" | "usage"
  | "meta" | "security" | "files" | "activity" | "settings" | "library" | "favorites";

const route = useRoute();
const VIEW_IDS: ViewId[] = [
  "sessions", "search", "agents", "rules", "skills", "services", "usage",
  "meta", "security", "files", "activity", "settings", "library", "favorites",
];
function viewFromQuery(): ViewId {
  const q = route.query.view;
  return typeof q === "string" && VIEW_IDS.includes(q as ViewId)
    ? (q as ViewId)
    : "sessions";
}
const view = ref<ViewId>(viewFromQuery());

const skillFocus = computed(() => {
  const s = route.query.skill;
  return typeof s === "string" && s ? s : undefined;
});
const rulesFocus = computed(() => {
  const p = route.query.path;
  if (typeof p === "string" && p) return p;
  const n = route.query.name;
  return typeof n === "string" && n ? n : undefined;
});
const agentFocus = computed(() => {
  const name = route.query.agent;
  if (typeof name !== "string" || !name) return undefined;
  const provider = route.query.provider;
  return {
    name,
    provider: typeof provider === "string" && provider ? provider : undefined,
  };
});
const agentBrowseFocus = computed(() => {
  const b = route.query.browse;
  return typeof b === "string" && b ? b : undefined;
});
const pluginFocus = computed(() => {
  const p = route.query.plugin;
  return typeof p === "string" && p ? p : undefined;
});

function onNav(id: string): void {
  if (id === "lineage") {
    void router.push("/lineage");
    return;
  }
  if (id === "timeline") {
    void router.push("/timeline");
    return;
  }
  if (id === "map") {
    void router.push("/map");
    return;
  }
  view.value = id as ViewId;
  void router.replace({ query: { view: id } });
}

const providerFilter = ref<SessionFilter>("all");
const sessionOpenRequest = ref<{ session: SessionRef; fromAgents?: boolean } | null>(null);
const handoffSource = ref<SessionRef>();

function applySessionDeepLink(): void {
  const provider = route.query.provider;
  const session = route.query.session;
  if (typeof provider !== "string" || typeof session !== "string") return;
  if (!provider || !session) return;
  if (viewFromQuery() !== "sessions") return;
  sessionOpenRequest.value = {
    session: {
      provider,
      id: session,
      projectDir: "",
      updatedAt: Date.now(),
      status: "unknown",
      kind: "session",
      meta: {},
    } as SessionRef,
  };
}

function onSetProviderFilter(id: string): void {
  providerFilter.value = id as SessionFilter;
}

function onOpenSession(s: SessionRef, meta?: { fromAgents?: boolean }): void {
  sessionOpenRequest.value = { session: s, fromAgents: meta?.fromAgents };
}

function onFavoriteSession(payload: { provider: string; id: string }): void {
  view.value = "sessions";
  void router.replace({
    query: { view: "sessions", provider: payload.provider, session: payload.id },
  });
  sessionOpenRequest.value = {
    session: {
      provider: payload.provider,
      id: payload.id,
      projectDir: "",
      updatedAt: Date.now(),
      status: "unknown",
      kind: "session",
      meta: {},
    } as SessionRef,
  };
}

function onHandoff(s: SessionRef): void {
  handoffSource.value = s;
}

function openHandoffResult(provider: string, sessionId: string): void {
  handoffSource.value = undefined;
  void sessions.refresh().then(() => {
    sessionOpenRequest.value = {
      session:
        sessions.find(provider, sessionId) ??
        ({
          provider,
          id: sessionId,
          projectDir: "",
          updatedAt: Date.now(),
          status: "unknown",
          kind: "session",
          meta: {},
        } as SessionRef),
    };
  });
}

watch(
  () => route.query.view,
  () => {
    const next = viewFromQuery();
    if (next !== view.value) view.value = next;
  },
);

watch(
  () => [route.query.view, route.query.provider, route.query.session] as const,
  () => applySessionDeepLink(),
  { immediate: true },
);

const NAV_COUNTS: Record<string, () => string | number> = {
  // While graphs/providers are still loading, return "" so shared cached counts stay visible.
  rules: () =>
    (ruleGroups.value ?? [])
      .flatMap((g) => g.artifacts)
      .filter((a) => a.kind !== "skill").length || "",
  skills: () =>
    (ruleGroups.value ?? [])
      .flatMap((g) => g.artifacts)
      .filter((a) => a.kind === "skill").length || "",
  services: () =>
    providers.value.length
      ? providers.value.filter((p) => p.available).length || ""
      : "",
};

const navItems = useNavItems({ counts: NAV_COUNTS });

const projectCount = computed(() => {
  const dirs = new Set(sessions.sessions.map((s) => s.projectDir || "(unknown)"));
  return dirs.size;
});

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    graphs.value = await api.graphs().catch(() => []);
  } finally {
    loading.value = false;
  }
  if (!sessions.sessions.length) void sessions.refresh();
  void api.providers().then((p) => {
    providers.value = p;
  });
}

let unsubSessionEvents: (() => void) | undefined;

onMounted(() => {
  void refresh();
  unsubSessionEvents = subscribeEvents((ev) => {
    if (ev.type === "live.status") {
      sessions.applyLiveStatuses(ev.statuses);
      return;
    }
    if (ev.type === "sessions.changed") {
      void sessions.refresh();
    }
  });
});

onUnmounted(() => {
  unsubSessionEvents?.();
});

// ---- rules & skills (meta view) ----

interface RuleArtifact {
  path: string;
  name: string;
  kind: "rules" | "agent" | "skill";
  source: string;
  size: number;
  mtime: number;
  description?: string;
  autoInvoke?: boolean;
  origin?: "project" | "custom" | "imported" | "global";
  layer?: number;
  shadowedBy?: string;
}
interface RuleGroup {
  scope: string;
  artifacts: RuleArtifact[];
}

const ruleGroups = ref<RuleGroup[] | undefined>();

watch(
  view,
  (v) => {
    if ((v === "meta" || v === "rules" || v === "skills") && ruleGroups.value === undefined) {
      void reloadRuleGroups();
    }
  },
  { immediate: true },
);

async function reloadRuleGroups(): Promise<void> {
  try {
    ruleGroups.value = (await (await fetch("/api/rules")).json()) as RuleGroup[];
  } catch {
    ruleGroups.value = [];
  }
}
</script>

<style scoped>
.dash {
  height: 100%;
  min-height: 0;
  display: flex;
}
.dash-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.dash-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: scroll; /* always reserve scrollbar so day-filter can't reflow the page */
  scrollbar-gutter: stable;
  padding: 32px 36px 64px;
}
.dash-head-copy {
  flex: 1 1 22rem;
  min-width: 0;
}
.dash-summary {
  margin: 10px 0 0;
}
.dash-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}
.dash-head-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.group-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
</style>
