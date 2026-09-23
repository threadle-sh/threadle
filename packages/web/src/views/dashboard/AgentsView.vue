<template>
  <div class="agent-chrome">
    <header class="dash-head">
      <div>
        <h1 class="dash-title">Agents</h1>
      </div>
      <div class="view-controls">
        <ProviderFilterChips
          v-model="agentProviderF"
          :options="agentProviders"
        />
      </div>
    </header>
    <div class="dash-toolbar agent-toolbar">
      <input
        v-model="agentFilter"
        class="threadle-input dash-search"
        :placeholder="
          agentBrowse === 'defs'
            ? 'Filter agents…'
            : agentBrowse === 'memory'
              ? 'Filter memory…'
              : agentBrowse === 'plugins'
                ? 'Filter plugins…'
                : 'Filter runs…'
        "
        spellcheck="false"
      />
      <div class="chip-row">
        <button
          class="filter-chip"
          :class="{ active: agentBrowse === 'defs' }"
          title="Agent definitions"
          @click="setAgentBrowse('defs')"
        >
          defs{{ sessions.agents.length ? ` · ${sessions.agents.length}` : "" }}
        </button>
        <button
          class="filter-chip"
          :class="{ active: agentBrowse === 'runs' }"
          title="Every session tagged with an agent definition"
          @click="setAgentBrowse('runs')"
        >
          instances{{ agentInstances.total ? ` · ${agentInstances.total}` : "" }}
        </button>
        <button
          class="filter-chip"
          :class="{ active: agentBrowse === 'subs' }"
          title="Only nested runs — Claude subagents, opencode children, Cursor Task tools, Antigravity children"
          @click="setAgentBrowse('subs')"
        >
          subagents{{ agentInstances.subs ? ` · ${agentInstances.subs}` : "" }}
        </button>
        <button
          class="filter-chip"
          :class="{ active: agentBrowse === 'live', 'chip-live': agentInstances.live }"
          title="Instances generating right now"
          @click="setAgentBrowse('live')"
        >
          live{{ agentInstances.live ? ` · ${agentInstances.live}` : "" }}
        </button>
        <button
          class="filter-chip"
          :class="{ active: agentBrowse === 'memory' }"
          title="Auto-memory (Claude · Grok · Codex)"
          @click="setAgentBrowse('memory')"
        >
          memory{{ memoryCount != null ? ` · ${memoryCount}` : "" }}
        </button>
        <button
          class="filter-chip"
          :class="{ active: agentBrowse === 'plugins' }"
          title="Installed / marketplace plugin packs"
          @click="setAgentBrowse('plugins')"
        >
          plugins{{ pluginsCount != null ? ` · ${pluginsCount}` : "" }}
        </button>
      </div>
    </div>
  </div>

        <!-- memory: list + icicle -->
        <div v-if="agentBrowse === 'memory'" class="lib-flex">
          <MemoryBrowser
            class="mem-browser-host"
            :filter="agentFilter"
            :provider-filter="agentProviderF"
            @loaded="memoryCount = $event"
          />
        </div>

        <!-- plugins: packs + children -->
        <div v-else-if="agentBrowse === 'plugins'" class="lib-flex">
          <PluginsBrowser
            class="mem-browser-host"
            :filter="agentFilter"
            :provider-filter="agentProviderF"
            :focus-key="pluginFocus"
            @loaded="pluginsCount = $event"
          />
        </div>

        <!-- runs / subagents / live: table + in-place detail -->
        <div v-else-if="agentBrowse !== 'defs'" class="lib-flex">
          <div class="agent-main">
            <div
              class="stat-table cols-inst"
              v-col-resize="'inst-v4'"
              data-cols="120px minmax(0,1fr) 90px 64px 64px 88px 18px"
            >
              <div class="stat-cols micro-label">
                <span class="th" @click="sortBy('inst', 'agent')">agent{{ arrow('inst', 'agent') }}</span
                ><span class="th" @click="sortBy('inst', 'title')">run{{ arrow('inst', 'title') }}</span
                ><span class="th" @click="sortBy('inst', 'project')">project{{ arrow('inst', 'project') }}</span
                ><span class="th" @click="sortBy('inst', 'in')">tok in{{ arrow('inst', 'in') }}</span
                ><span class="th" @click="sortBy('inst', 'out')">tok out{{ arrow('inst', 'out') }}</span
                ><span class="th" @click="sortBy('inst', 'last')">updated{{ arrow('inst', 'last') }}</span
                ><span></span>
              </div>
              <div
                v-for="s in sortedInstances"
                :key="s.provider + s.id"
                class="stat-row inst-row"
                :class="{ picked: pickedRun && pickedRun.provider === s.provider && pickedRun.id === s.id }"
                @click="selectRun(s)"
                @contextmenu.prevent.stop="openRunCtx($event, s)"
              >
                <span class="stat-name mono">
                  <span class="prov-dot" :style="{ background: providerColor(s.provider) }" />
                  {{ s.agent }}
                  <span v-if="isSubRun(s)" class="inst-sub micro-label">sub</span>
                </span>
                <span class="stat-name inst-title" :title="s.title ?? s.id">{{ s.title ?? shortId(s.id) }}</span>
                <span class="stat-val inst-proj mono" :title="s.projectDir">{{ s.projectDir?.split("/").pop() ?? "—" }}</span>
                <span class="stat-val">{{ s.tokensIn != null ? fmtTokens(s.tokensIn, { estimate: isTokenEstimate(s.meta) }) : "—" }}</span>
                <span class="stat-val">{{ s.tokensOut != null ? fmtTokens(s.tokensOut, { estimate: isTokenEstimate(s.meta) }) : "—" }}</span>
                <span
                  class="stat-val inst-updated"
                  :title="s.updatedAt ? new Date(s.updatedAt).toLocaleString() : undefined"
                >{{ relativeTime(s.updatedAt) }}</span>
                <span class="inst-status">
                  <span class="status-dot" :class="s.status" :title="s.status" />
                </span>
              </div>
              <p v-if="!sortedInstances.length" class="stat-note inst-empty">
                {{
                  agentBrowse === "live"
                    ? "no live instances right now"
                    : agentBrowse === "subs"
                      ? "no subagent runs match"
                      : "no instances match"
                }}
              </p>
            </div>
            <p class="stat-note inst-note">
              Instances are sessions tagged with an agent. Subagents are nested runs inside a
              parent session. Claude interactive chats usually have no agent tag (so they stay
              in Sessions); opencode tags every session.
            </p>
          </div>

          <aside v-if="pickedRun" class="lib-aside">
            <div class="lib-aside-head">
              <div class="sess-detail-titles">
                <span class="lib-aside-title mono">{{ pickedRun.title ?? shortId(pickedRun.id) }}</span>
                <div class="sess-detail-meta mono">
                  <SessionLivePill :status="pickedRunLiveStatus" />
                  <span v-if="isSubRun(pickedRun)" class="inst-sub micro-label">sub</span>
                  <span v-if="pickedRun.agent" class="sess-detail-agent">⟨/⟩ {{ pickedRun.agent }}</span>
                </div>
              </div>
              <DetailExpandControls
                @expand="runDetailExpanded = true"
                @close="closePickedRun"
              />
            </div>
            <div class="sess-detail-actions">
              <button class="vsc-btn" title="Open in Sessions" @click="openRunInSessions(pickedRun)">
                ❯ sessions
              </button>
              <button
                class="vsc-btn"
                title="View the interactive message transcript in a floating window"
                @click="fileViewers.openTranscript(pickedRun.provider, pickedRun.id)"
              >
                ≡ transcript
              </button>
              <button
                class="vsc-btn"
                @click="router.push(`/blueprint/${pickedRun.provider}/${pickedRun.id}`)"
              >
                ⌗ blueprint
              </button>
              <button
                v-if="pickedRun.parentId"
                class="vsc-btn"
                title="Open parent session"
                @click="openRunParent(pickedRun)"
              >
                ↑ parent
              </button>
            </div>
            <SessionInfoPanel
              :provider="pickedRun.provider"
              :session-id="pickedRun.id"
              :seed="pickedRun"
              @open-parent="openRunParent(pickedRun)"
            />
          </aside>
          <aside v-else class="lib-aside lib-aside-empty">
            <p class="stat-note">Select a run to inspect it here.</p>
          </aside>

          <DetailExpandModal
            :open="!!pickedRun && runDetailExpanded"
            :label="pickedRun?.title ?? (pickedRun ? shortId(pickedRun.id) : 'Run')"
            @close="runDetailExpanded = false"
          >
            <template v-if="pickedRun">
              <div class="lib-aside-head">
                <div class="sess-detail-titles">
                  <span class="lib-aside-title mono">{{ pickedRun.title ?? shortId(pickedRun.id) }}</span>
                  <div class="sess-detail-meta mono">
                    <SessionLivePill :status="pickedRunLiveStatus" />
                    <span v-if="isSubRun(pickedRun)" class="inst-sub micro-label">sub</span>
                    <span v-if="pickedRun.agent" class="sess-detail-agent">⟨/⟩ {{ pickedRun.agent }}</span>
                  </div>
                </div>
                <DetailExpandControls hide-expand @close="runDetailExpanded = false" />
              </div>
              <SessionInfoPanel
                :provider="pickedRun.provider"
                :session-id="pickedRun.id"
                :seed="pickedRun"
                @open-parent="openRunParent(pickedRun)"
              />
            </template>
          </DetailExpandModal>
        </div>

        <div v-else class="lib-flex">
          <div class="agent-main">
            <div v-for="pg in agentGroups" :key="pg.provider" class="agent-provider">
              <div class="agent-provider-head">
                <span class="prov-dot" :style="{ background: providerColor(pg.provider) }" />
                <span class="agent-provider-name">{{ pg.label }}</span>
              </div>
              <div v-for="kg in pg.kinds" :key="kg.kind" class="agent-kind">
                <div class="micro-label agent-kind-name">{{ kg.kind }}</div>
                <div class="agent-grid">
                  <div
                    v-for="a in kg.agents"
                    :key="a.name"
                    class="agent-card"
                    :class="{ picked: agentPicked?.provider === a.provider && agentPicked?.name === a.name }"
                    @click="pickAgent(a)"
                    @contextmenu.prevent.stop="openDefCtx($event, a)"
                  >
                    <div class="agent-card-head">
                      <span class="agent-glyph">⟨/⟩</span>
                      <span class="agent-name mono">{{ a.name }}</span>
                      <span v-if="a.model" class="threadle-chip mono agent-model-chip">{{ a.model.split("/").pop() }}</span>
                    </div>
                    <p class="agent-desc">{{ a.description ?? "—" }}</p>
                    <div class="agent-card-foot mono">
                      <span class="micro-label">{{ a.scope }}</span>
                      <span v-if="agentUsage(a).live" class="agent-live">● {{ agentUsage(a).live }} live</span>
                      <span
                        class="agent-usage"
                        :class="{ never: !agentUsage(a).count }"
                      >
                        {{ agentUsage(a).count
                          ? `${agentUsage(a).count} instance${agentUsage(a).count === 1 ? "" : "s"} · ${agentUsage(a).last}`
                          : "never instantiated" }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <aside v-if="agentPicked" class="lib-aside">
            <div class="lib-aside-head">
              <span class="lib-aside-title mono">⟨/⟩ {{ agentPicked.name }}</span>
              <DetailExpandControls
                @expand="agentDetailExpanded = true"
                @close="closeAgentPicked"
              />
            </div>
            <div class="run-kv mono">
              <span class="run-key">provider</span><span class="run-val">{{ agentPicked.provider }}</span>
              <span class="run-key">kind</span><span class="run-val">{{ agentPicked.kind ?? "—" }}</span>
              <span class="run-key">scope</span><span class="run-val">{{ agentPicked.scope }}</span>
              <span class="run-key">model</span><span class="run-val">{{ agentPicked.model ?? "session default" }}</span>
              <span class="run-key">source</span><span class="run-val">{{ agentPicked.source }}</span>
              <span class="run-key">used</span
              ><span class="run-val">
                {{ agentUsage(agentPicked).count
                  ? `${agentUsage(agentPicked).count} sessions · last ${agentUsage(agentPicked).last} · ${fmtTokens(agentUsage(agentPicked).tokensOut)} tok out`
                  : "never" }}
              </span>
            </div>
            <div class="sess-detail-actions">
              <button class="vsc-btn" title="New workflow: prompt wired into this agent" @click="useAgentInWorkflow">
                → use in workflow
              </button>
              <button
                class="vsc-btn"
                title="Show this agent's instances"
                @click="browseAgentRuns(agentPicked)"
              >
                ❯ instances
              </button>
              <button
                v-if="isAbsolutePath(agentPicked.source)"
                class="vsc-btn"
                @click="settings.openPath(agentPicked.source)"
              >
                ✎ {{ settings.editorLabel }}
              </button>
            </div>
            <template v-if="agentUsage(agentPicked).recent.length">
              <div class="micro-label">
                recent ({{ agentUsage(agentPicked).count
                }}<template v-if="agentUsage(agentPicked).live"> · {{ agentUsage(agentPicked).live }} live</template>)
              </div>
              <div class="lin-injlist">
                <button
                  v-for="r in agentUsage(agentPicked).recent"
                  :key="r.provider + r.id"
                  class="lin-inj mono"
                  @click="jumpToRun(r)"
                  @contextmenu.prevent.stop="openRunCtx($event, r)"
                >
                  <i class="inst-dot" :class="{ live: isSessionLive(r.status) }" />
                  <span v-if="isSubRun(r)" class="inst-sub micro-label">sub</span>
                  {{ r.title ?? shortId(r.id) }} <em>{{ relativeTime(r.updatedAt) }}</em>
                </button>
              </div>
            </template>
            <template v-if="agentPicked.raw">
              <div class="micro-label">system prompt / definition</div>
              <pre class="lin-content mono">{{ agentPicked.raw.slice(0, 12000) }}</pre>
            </template>
            <p v-else class="stat-note">no prompt body recorded for this agent</p>
          </aside>

          <DetailExpandModal
            :open="!!agentPicked && agentDetailExpanded"
            :label="agentPicked ? `⟨/⟩ ${agentPicked.name}` : 'Agent'"
            @close="agentDetailExpanded = false"
          >
            <template v-if="agentPicked">
              <div class="lib-aside-head">
                <span class="lib-aside-title mono">⟨/⟩ {{ agentPicked.name }}</span>
                <DetailExpandControls hide-expand @close="agentDetailExpanded = false" />
              </div>
              <div class="run-kv mono">
                <span class="run-key">provider</span><span class="run-val">{{ agentPicked.provider }}</span>
                <span class="run-key">kind</span><span class="run-val">{{ agentPicked.kind ?? "—" }}</span>
                <span class="run-key">scope</span><span class="run-val">{{ agentPicked.scope }}</span>
                <span class="run-key">model</span><span class="run-val">{{ agentPicked.model ?? "session default" }}</span>
                <span class="run-key">source</span><span class="run-val">{{ agentPicked.source }}</span>
                <span class="run-key">used</span
                ><span class="run-val">
                  {{ agentUsage(agentPicked).count
                    ? `${agentUsage(agentPicked).count} sessions · last ${agentUsage(agentPicked).last} · ${fmtTokens(agentUsage(agentPicked).tokensOut)} tok out`
                    : "never" }}
                </span>
              </div>
              <div class="sess-detail-actions">
                <button class="vsc-btn" title="New workflow: prompt wired into this agent" @click="useAgentInWorkflow">
                  → use in workflow
                </button>
                <button
                  class="vsc-btn"
                  title="Show this agent's instances"
                  @click="browseAgentRuns(agentPicked)"
                >
                  ❯ instances
                </button>
                <button
                  v-if="isAbsolutePath(agentPicked.source)"
                  class="vsc-btn"
                  @click="settings.openPath(agentPicked.source)"
                >
                  ✎ {{ settings.editorLabel }}
                </button>
              </div>
              <template v-if="agentUsage(agentPicked).recent.length">
                <div class="micro-label">
                  recent ({{ agentUsage(agentPicked).count
                  }}<template v-if="agentUsage(agentPicked).live"> · {{ agentUsage(agentPicked).live }} live</template>)
                </div>
                <div class="lin-injlist">
                  <button
                    v-for="r in agentUsage(agentPicked).recent"
                    :key="r.provider + r.id"
                    class="lin-inj mono"
                    @click="jumpToRun(r)"
                    @contextmenu.prevent.stop="openRunCtx($event, r)"
                  >
                    <i class="inst-dot" :class="{ live: isSessionLive(r.status) }" />
                    <span v-if="isSubRun(r)" class="inst-sub micro-label">sub</span>
                    {{ r.title ?? shortId(r.id) }} <em>{{ relativeTime(r.updatedAt) }}</em>
                  </button>
                </div>
              </template>
              <template v-if="agentPicked.raw">
                <div class="micro-label">system prompt / definition</div>
                <pre class="lin-content mono">{{ agentPicked.raw.slice(0, 12000) }}</pre>
              </template>
              <p v-else class="stat-note">no prompt body recorded for this agent</p>
            </template>
          </DetailExpandModal>
        </div>

  <Teleport to="body">
    <div
      v-if="runCtx"
      class="menu-pop wf-folder-ctx"
      :style="{ left: runCtx.x + 'px', top: runCtx.y + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
      <button type="button" class="menu-item" @click="menuAction(() => selectRun(runCtx!.session))">
        <span class="menu-glyph">↗</span> Details
      </button>
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => fileViewers.openTranscript(runCtx!.session.provider, runCtx!.session.id))"
      >
        <span class="menu-glyph">≡</span> Transcript
      </button>
      <button
        type="button"
        class="menu-item"
        @click="
          menuAction(() =>
            router.push(`/blueprint/${runCtx!.session.provider}/${runCtx!.session.id}`),
          )
        "
      >
        <span class="menu-glyph">⌗</span> Blueprint
      </button>
      <button
        type="button"
        class="menu-item"
        @click="
          menuAction(() =>
            router.push(`/growth/${runCtx!.session.provider}/${runCtx!.session.id}`),
          )
        "
      >
        <span class="menu-glyph"><GrowthMark /></span> Growth
      </button>
      <button
        type="button"
        class="menu-item"
        @click="
          menuAction(() =>
            router.push({
              path: '/lineage',
              query: { focus: `${runCtx!.session.provider}:${runCtx!.session.id}` },
            }),
          )
        "
      >
        <span class="menu-glyph">⇄</span> Lineage
      </button>
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => openRunInSessions(runCtx!.session))"
      >
        <span class="menu-glyph">❯</span> Sessions view
      </button>
      <button
        v-if="runCtx.session.parentId"
        type="button"
        class="menu-item"
        @click="menuAction(() => openRunParent(runCtx!.session))"
      >
        <span class="menu-glyph">↑</span> Parent
      </button>
      <button type="button" class="menu-item" @click="menuAction(() => toggleRunFavorite(runCtx!.session))">
        <span class="menu-glyph">{{ isRunFavorite(runCtx.session) ? "☆" : "★" }}</span>
        {{ isRunFavorite(runCtx.session) ? "Remove from favorites" : "Add to favorites" }}
      </button>
    </div>

    <div
      v-if="defCtx"
      class="menu-pop wf-folder-ctx"
      :style="{ left: defCtx.x + 'px', top: defCtx.y + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
      <button type="button" class="menu-item" @click="menuAction(() => pickAgent(defCtx!.agent))">
        <span class="menu-glyph">↗</span> Details
      </button>
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => browseAgentRuns(defCtx!.agent))"
      >
        <span class="menu-glyph">❯</span> Instances
      </button>
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => useAgentInWorkflowFor(defCtx!.agent))"
      >
        <span class="menu-glyph">→</span> Use in workflow
      </button>
      <button
        v-if="isAbsolutePath(defCtx.agent.source)"
        type="button"
        class="menu-item"
        @click="menuAction(() => settings.openPath(defCtx!.agent.source))"
      >
        <span class="menu-glyph">✎</span> {{ settings.editorLabel }}
      </button>
      <button type="button" class="menu-item" @click="menuAction(() => copyAgentName(defCtx!.agent))">
        <span class="menu-glyph">❐</span> Copy name
      </button>
    </div>
  </Teleport>

</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { AgentDef, SessionRef } from "@threadle/shared";
import { isAbsolutePath, isSessionLive } from "@threadle/shared";
import { relativeTime, shortId, fmtTokens, isTokenEstimate } from "@/lib/format";
import {
  PROVIDER_IDS,
  providerColor,
  providerLabel,
  type SessionFilter,
} from "@/lib/providers";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { useFileViewersStore } from "@/stores/fileViewers";
import { useFavoritesStore } from "@/stores/favorites";
import { agentToWorkflow } from "@/lib/convert";
import { vColResize } from "@/lib/colResize";
import ProviderFilterChips from "@/components/ProviderFilterChips.vue";
import SessionInfoPanel from "@/panels/SessionInfoPanel.vue";
import SessionLivePill from "@/panels/SessionLivePill.vue";
import GrowthMark from "@/panels/GrowthMark.vue";
import MemoryBrowser from "@/panels/MemoryBrowser.vue";
import PluginsBrowser from "@/panels/PluginsBrowser.vue";
import DetailExpandControls from "@/panels/DetailExpandControls.vue";
import DetailExpandModal from "@/panels/DetailExpandModal.vue";
import "./chrome.css";

const props = defineProps<{
  /** Deep-link: agent name (+ optional provider) from `?agent=` / `?provider=`. */
  focus?: { name: string; provider?: string };
  /** Deep-link: `?browse=memory` / `?browse=plugins` etc. */
  browse?: string;
  /** Deep-link: `?plugin=provider:id` when browsing plugins. */
  pluginFocus?: string;
}>();

const emit = defineEmits<{
  nav: [id: string];
  "open-session": [session: SessionRef, meta?: { fromAgents?: boolean }];
}>();

const router = useRouter();
const sessions = useSessionsStore();
const settings = useSettingsStore();
const fileViewers = useFileViewersStore();
const favorites = useFavoritesStore();
void favorites.ensureLoaded();

const runCtx = ref<{ x: number; y: number; session: SessionRef }>();
const defCtx = ref<{ x: number; y: number; agent: AgentDef }>();
let ctxIgnoreClick = false;


const sorts = reactive<Record<string, { key: string; dir: 1 | -1 }>>({
  inst: { key: "last", dir: -1 },
});

function sortBy(table: string, key: string): void {
  const cur = sorts[table];
  if (cur && cur.key === key) cur.dir = (cur.dir * -1) as 1 | -1;
  else sorts[table] = { key, dir: -1 };
}

function arrow(table: string, key: string): string {
  const cur = sorts[table];
  if (!cur || cur.key !== key) return "";
  return cur.dir === -1 ? " ▾" : " ▴";
}

const agentFilter = ref("");
const agentPicked = ref<AgentDef>();
const agentDetailExpanded = ref(false);

function closeAgentPicked(): void {
  agentPicked.value = undefined;
  agentDetailExpanded.value = false;
}

function pickAgent(a: AgentDef): void {
  const same =
    agentPicked.value?.name === a.name && agentPicked.value?.provider === a.provider;
  agentPicked.value = same ? undefined : a;
  agentDetailExpanded.value = false;
}

watch(
  () => [props.focus, sessions.agents] as const,
  ([focus]) => {
    if (!focus?.name) return;
    const name = focus.name.toLowerCase();
    const hit =
      (focus.provider
        ? sessions.agents.find(
            (a) =>
              a.provider === focus.provider && a.name.toLowerCase() === name,
          )
        : undefined) ??
      sessions.agents.find((a) => a.name.toLowerCase() === name);
    if (hit) agentPicked.value = hit;
  },
  { immediate: true },
);

/** usage of an agent across sessions AND subagent runs (matched by agent name + provider) */
function agentUsage(a: AgentDef): {
  count: number;
  live: number;
  last: string;
  tokensOut: number;
  recent: SessionRef[];
} {
  const runs = instanceSource.value.filter(
    (s) =>
      s.provider === a.provider &&
      s.agent?.toLowerCase() === a.name.toLowerCase(),
  );
  const recent = [...runs].sort((x, y) => y.updatedAt - x.updatedAt).slice(0, 5);
  return {
    count: runs.length,
    live: runs.filter((s) => isSessionLive(s.status)).length,
    last: runs.length ? relativeTime(Math.max(...runs.map((s) => s.updatedAt))) : "",
    tokensOut: runs.reduce((acc, s) => acc + (s.tokensOut ?? 0), 0),
    recent,
  };
}

/**
 * every session spawned from an agent definition = one instance of that agent.
 * The server aggregate also includes claude-code subagent runs, which never
 * appear in the main session list; fall back to the store until it loads.
 */
const instancesAll = ref<SessionRef[] | null>(null);

async function loadInstances(): Promise<void> {
  try {
    instancesAll.value = (await (
      await fetch("/api/sessions/instances")
    ).json()) as SessionRef[];
  } catch {
    // server unreachable — keep the store-derived fallback
  }
}

const instanceSource = computed<SessionRef[]>(
  () => instancesAll.value ?? sessions.sessions.filter((s) => s.agent),
);

const agentInstances = computed(() => ({
  total: instanceSource.value.length,
  live: instanceSource.value.filter((s) => isSessionLive(s.status)).length,
  subs: instanceSource.value.filter((s) => isSubRun(s)).length,
}));

/** Exclusive Agents browse modes — tiles are radios, not toggles. */
type AgentBrowse = "defs" | "runs" | "subs" | "live" | "memory" | "plugins";
const agentBrowse = ref<AgentBrowse>("defs");
const pickedRun = ref<SessionRef>();
const runDetailExpanded = ref(false);
const memoryCount = ref<number | null>(null);
const pluginsCount = ref<number | null>(null);

function closePickedRun(): void {
  pickedRun.value = undefined;
  runDetailExpanded.value = false;
}

const BROWSE_MODES: AgentBrowse[] = [
  "defs",
  "runs",
  "subs",
  "live",
  "memory",
  "plugins",
];

function browseFromProp(raw?: string): AgentBrowse | undefined {
  if (!raw) return undefined;
  return BROWSE_MODES.includes(raw as AgentBrowse) ? (raw as AgentBrowse) : undefined;
}

watch(
  () => props.browse,
  (b) => {
    const mode = browseFromProp(b);
    if (mode && mode !== agentBrowse.value) setAgentBrowse(mode);
  },
  { immediate: true },
);

const pickedRunLiveStatus = computed(() => {
  const p = pickedRun.value;
  if (!p) return undefined;
  return sessions.find(p.provider, p.id)?.status ?? p.status;
});
function isSubRun(s: SessionRef): boolean {
  return s.kind === "subagent-run" || !!s.parentId;
}

function setAgentBrowse(mode: AgentBrowse): void {
  agentBrowse.value = mode;
  if (mode === "defs") {
    pickedRun.value = undefined;
  } else if (mode === "memory" || mode === "plugins") {
    pickedRun.value = undefined;
    agentPicked.value = undefined;
  } else {
    agentPicked.value = undefined;
  }
  const cur = router.currentRoute.value.query;
  const nextBrowse = mode === "defs" ? undefined : mode;
  const curBrowse = typeof cur.browse === "string" ? cur.browse : undefined;
  if (curBrowse === nextBrowse && cur.view === "agents") return;
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(cur)) {
    if (typeof v === "string") q[k] = v;
  }
  q.view = "agents";
  if (nextBrowse) q.browse = nextBrowse;
  else delete q.browse;
  void router.replace({ query: q });
}

function selectRun(s: SessionRef): void {
  const same = pickedRun.value?.provider === s.provider && pickedRun.value?.id === s.id;
  pickedRun.value = same ? undefined : s;
  runDetailExpanded.value = false;
}

function jumpToRun(s: SessionRef): void {
  setAgentBrowse(isSubRun(s) ? "subs" : "runs");
  pickedRun.value = s;
  runDetailExpanded.value = false;
  agentFilter.value = s.agent ?? "";
}

function browseAgentRuns(a: AgentDef): void {
  agentFilter.value = a.name;
  agentProviderF.value = a.provider;
  setAgentBrowse("runs");
}


function openRunInSessions(s: SessionRef): void {
  emit("open-session", s, { fromAgents: true });
  emit("nav", "sessions");
}

function openRunParent(child: SessionRef): void {
  if (!child.parentId) return;
  const parent =
    sessions.sessions.find(
      (p) => p.provider === child.provider && p.id === child.parentId,
    ) ??
    instanceSource.value.find(
      (p) => p.provider === child.provider && p.id === child.parentId,
    );
  if (parent) {
    // stay in Agents: show parent in the runs aside
    setAgentBrowse("runs");
    pickedRun.value = parent;
    return;
  }
  pickedRun.value = {
    provider: child.provider,
    id: child.parentId,
    projectDir: child.projectDir,
    updatedAt: child.updatedAt,
    status: "unknown",
    kind: "session",
  };
}


onMounted(() => {
  sessions.ensureHydrated();
  void loadInstances();
  void prefetchMemoryCount();
  void prefetchPluginsCount();
  document.addEventListener("click", dismissCtx);
  document.addEventListener("contextmenu", dismissCtx);
});
onUnmounted(() => {
  document.removeEventListener("click", dismissCtx);
  document.removeEventListener("contextmenu", dismissCtx);
});

async function prefetchMemoryCount(): Promise<void> {
  try {
    const res = await fetch("/api/memory");
    const data = (await res.json()) as unknown[];
    memoryCount.value = Array.isArray(data) ? data.length : 0;
  } catch {
    memoryCount.value = 0;
  }
}

async function prefetchPluginsCount(): Promise<void> {
  try {
    const res = await fetch("/api/plugins");
    const data = (await res.json()) as unknown[];
    pluginsCount.value = Array.isArray(data) ? data.length : 0;
  } catch {
    pluginsCount.value = 0;
  }
}

const INST_SEL: Record<string, (s: SessionRef) => number | string> = {
  agent: (s) => s.agent ?? "",
  title: (s) => s.title ?? s.id,
  project: (s) => s.projectDir ?? "",
  in: (s) => s.tokensIn ?? 0,
  out: (s) => s.tokensOut ?? 0,
  last: (s) => s.updatedAt,
};

const sortedInstances = computed(() => {
  const q = agentFilter.value.toLowerCase();
  let rows = instanceSource.value.filter((s) => {
    if (!s.agent) return false;
    if (agentProviderF.value !== "all" && s.provider !== agentProviderF.value) return false;
    if (agentBrowse.value === "live" && !isSessionLive(s.status)) return false;
    if (agentBrowse.value === "subs" && !isSubRun(s)) return false;
    if (
      q &&
      !s.agent.toLowerCase().includes(q) &&
      !(s.title ?? "").toLowerCase().includes(q) &&
      !(s.projectDir ?? "").toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });
  const sort = sorts.inst ?? { key: "last", dir: -1 };
  const sel = INST_SEL[sort.key] ?? ((s: SessionRef) => s.updatedAt);
  rows = [...rows].sort((a, b) => {
    const x = sel(a);
    const y = sel(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
  return rows;
});

async function useAgentInWorkflow(): Promise<void> {
  const a = agentPicked.value;
  if (!a) return;
  await useAgentInWorkflowFor(a);
}

async function useAgentInWorkflowFor(a: AgentDef): Promise<void> {
  const id = await agentToWorkflow(a);
  void router.push(`/graph/${id}`);
}

function placeCtxMenu(e: MouseEvent): { x: number; y: number } {
  const pad = 8;
  const mw = 220;
  const mh = 300;
  return {
    x: Math.min(e.clientX, window.innerWidth - mw - pad),
    y: Math.min(e.clientY, window.innerHeight - mh - pad),
  };
}

function openRunCtx(e: MouseEvent, s: SessionRef): void {
  defCtx.value = undefined;
  ctxIgnoreClick = true;
  runCtx.value = { ...placeCtxMenu(e), session: s };
  requestAnimationFrame(() => {
    ctxIgnoreClick = false;
  });
}

function openDefCtx(e: MouseEvent, a: AgentDef): void {
  runCtx.value = undefined;
  ctxIgnoreClick = true;
  defCtx.value = { ...placeCtxMenu(e), agent: a };
  requestAnimationFrame(() => {
    ctxIgnoreClick = false;
  });
}

function menuAction(fn: () => unknown): void {
  try {
    void fn();
  } finally {
    runCtx.value = undefined;
    defCtx.value = undefined;
  }
}

function dismissCtx(e: MouseEvent): void {
  if (ctxIgnoreClick || e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (!t.closest?.(".wf-folder-ctx")) {
    runCtx.value = undefined;
    defCtx.value = undefined;
  }
}

function sessionFavoriteInput(s: SessionRef) {
  return {
    kind: "session" as const,
    provider: s.provider,
    sessionId: s.id,
    label: s.title ?? undefined,
  };
}

function isRunFavorite(s: SessionRef): boolean {
  return favorites.isFavorite(sessionFavoriteInput(s));
}

function toggleRunFavorite(s: SessionRef): void {
  void favorites.toggle(sessionFavoriteInput(s));
}

async function copyAgentName(a: AgentDef): Promise<void> {
  try {
    await navigator.clipboard.writeText(a.name);
  } catch {
    // ignore
  }
}

const PROVIDER_LABELS: Record<string, string> = Object.fromEntries(
  PROVIDER_IDS.map((id) => [id, providerLabel(id)]),
);

// providerColor imported from @/lib/providers

const agentProviderF = ref<SessionFilter>("all");

/** Store chips — available immediately from cache / /api/providers. */
const agentProviders = computed(() => sessions.sessionFilterChips);
watch(agentProviders, (chips) => {
  if (!chips.includes(agentProviderF.value)) agentProviderF.value = "all";
});

const agentGroups = computed(() => {
  const providers = new Map<string, Map<string, AgentDef[]>>();
  const q = agentFilter.value.toLowerCase();
  for (const a of sessions.agents) {
    if (agentProviderF.value !== "all" && a.provider !== agentProviderF.value) continue;
    if (q && !a.name.toLowerCase().includes(q) && !a.description?.toLowerCase().includes(q)) {
      continue;
    }
    if (!providers.has(a.provider)) providers.set(a.provider, new Map());
    const kinds = providers.get(a.provider)!;
    const kind = a.kind ?? a.scope;
    if (!kinds.has(kind)) kinds.set(kind, []);
    kinds.get(kind)!.push(a);
  }
  return [...providers.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, kinds]) => ({
      provider,
      label: PROVIDER_LABELS[provider] ?? provider,
      kinds: [...kinds.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([kind, agents]) => ({
          kind: kind === "subagent" ? "agent types" : kind,
          agents: agents.sort((x, y) => x.name.localeCompare(y.name)),
        })),
    }));
});

</script>

<style scoped>
.agent-chrome {
  margin: -32px -36px 24px;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.agent-toolbar {
  gap: 10px;
  padding-bottom: 16px;
  margin-bottom: 0;
}
.agent-toolbar .filter-chip.chip-live {
  color: var(--status-running);
}
.agent-toolbar .filter-chip.chip-live.active {
  border-color: var(--status-running);
}
.inst-empty {
  padding: 14px 16px;
}
.inst-sub {
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  padding: 0 4px;
}
.lin-injlist {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lin-inj {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: var(--fs-xs);
  padding: 6px 9px;
  cursor: pointer;
}
.lin-inj:hover {
  border-color: var(--border-strong);
  color: var(--text);
}
.lin-inj em {
  font-style: normal;
  color: var(--text-faint);
  margin-left: auto;
  flex-shrink: 0;
}
.stat-num-live {
  color: var(--status-running);
  font-size: var(--fs-md);
}
.agent-live {
  color: var(--status-running);
  font-size: var(--fs-2xs);
  white-space: nowrap;
}
.inst-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-faint);
  flex-shrink: 0;
}
.inst-dot.live {
  background: var(--status-running);
  animation: inst-pulse 1.6s ease-in-out infinite;
}
@keyframes inst-pulse {
  50% { opacity: 0.35; }
}
.agent-provider {
  margin-bottom: 28px;
}
.agent-provider-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.agent-provider-name {
  font-size: var(--fs-lg);
  font-weight: 600;
}
.agent-kind {
  margin-bottom: 14px;
}
.agent-kind-name {
  padding-bottom: 8px;
}
.agent-main {
  flex: 1;
  min-width: 0;
}
.agent-card {
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
.agent-card:hover:not(.picked) {
  background: var(--hover-overlay);
}
.agent-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}
.agent-usage {
  font-size: var(--fs-2xs);
  color: var(--status-running);
}
.agent-usage.never {
  color: var(--text-faint);
}
.agent-model-chip {
  margin-left: auto;
  font-size: var(--fs-2xs);
}

.lib-flex {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.mem-browser-host {
  flex: 1;
  min-width: 0;
  width: 100%;
}
.lib-aside {
  width: 340px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel-bg);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: calc(100vh - 160px);
  overflow: auto;
  position: sticky;
  top: 12px;
  align-self: flex-start;
}
.lib-aside-empty {
  justify-content: center;
  align-items: center;
  min-height: 160px;
}
.lib-aside-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.lib-aside-title {
  font-size: var(--fs-sm);
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lin-content {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--node-bg);
  font-size: var(--fs-2xs);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow: auto;
}

</style>
