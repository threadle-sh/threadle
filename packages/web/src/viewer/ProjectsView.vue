<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, type ProjectMemberDto, type ProjectRollupDto } from "@/api/client";
import DashNav from "@/panels/DashNav.vue";
import { useNavItems } from "@/panels/useNavItems";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";

const router = useRouter();
const route = useRoute();
const navItems = useNavItems();

const loading = ref(true);
const busy = ref(false);
const error = ref("");
const projects = ref<ProjectRollupDto[]>([]);
const unassigned = ref<ProjectMemberDto[]>([]);
const detail = ref<ProjectRollupDto | null>(null);

const newName = ref("");
const editName = ref("");
const editNotes = ref("");
const graphPick = ref("");
const graphOptions = ref<Array<{ id: string; name: string }>>([]);

const projectId = computed(() => {
  const id = route.params.id;
  return typeof id === "string" && id ? id : "";
});

function onNav(id: string): void {
  if (id === "projects") return void router.push("/projects");
  if (id === "lineage") return void router.push("/lineage");
  if (id === "timeline") return void router.push("/timeline");
  if (id === "map") return void router.push("/map");
  void router.push({ path: "/", query: { view: id } });
}

function shortPath(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  if (parts.length <= 2) return dir;
  return `…/${parts.slice(-2).join("/")}`;
}

function fmtWhen(ts: number): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

async function loadGallery(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const body = await api.projects();
    projects.value = body.projects;
    unassigned.value = body.unassigned;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "failed to load projects";
  } finally {
    loading.value = false;
  }
}

async function loadDetail(id: string): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const [p, graphs] = await Promise.all([api.project(id), api.graphs()]);
    detail.value = p;
    editName.value = p.name;
    editNotes.value = p.notes ?? "";
    graphOptions.value = graphs
      .filter((g) => !/^(Example|Recipe)\s*·/i.test(g.name))
      .map((g) => ({ id: g.id, name: g.name }));
    // keep gallery counts fresh in background
    void api.projects().then((body) => {
      projects.value = body.projects;
      unassigned.value = body.unassigned;
    });
  } catch (e) {
    detail.value = null;
    error.value = e instanceof Error ? e.message : "project not found";
  } finally {
    loading.value = false;
  }
}

async function refresh(): Promise<void> {
  if (projectId.value) await loadDetail(projectId.value);
  else await loadGallery();
}

onMounted(() => void refresh());
watch(projectId, () => void refresh());

function openProject(id: string): void {
  void router.push(`/projects/${encodeURIComponent(id)}`);
}

async function createProject(): Promise<void> {
  const name = newName.value.trim();
  if (!name || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const p = await api.createProject({ name });
    newName.value = "";
    openProject(p.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "create failed";
  } finally {
    busy.value = false;
  }
}

async function createFromDir(dir: string): Promise<void> {
  if (busy.value) return;
  const name = pathBasename(dir);
  busy.value = true;
  error.value = "";
  try {
    const p = await api.createProject({ name, dirs: [dir] });
    openProject(p.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "create failed";
  } finally {
    busy.value = false;
  }
}

function pathBasename(dir: string): string {
  return dir.split("/").filter(Boolean).pop() || dir;
}

async function saveMeta(): Promise<void> {
  if (!detail.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    detail.value = await api.patchProject(detail.value.id, {
      name: editName.value.trim() || detail.value.name,
      notes: editNotes.value,
      pinned: detail.value.pinned,
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : "save failed";
  } finally {
    busy.value = false;
  }
}

async function togglePin(): Promise<void> {
  if (!detail.value || busy.value) return;
  busy.value = true;
  try {
    detail.value = await api.patchProject(detail.value.id, {
      pinned: !detail.value.pinned,
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : "pin failed";
  } finally {
    busy.value = false;
  }
}

async function addDir(dir: string): Promise<void> {
  if (!detail.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    detail.value = await api.patchProject(detail.value.id, {
      dirs: [...detail.value.dirs, dir],
    });
    const body = await api.projects();
    unassigned.value = body.unassigned;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "add repo failed";
  } finally {
    busy.value = false;
  }
}

async function removeDir(dir: string): Promise<void> {
  if (!detail.value || busy.value) return;
  busy.value = true;
  try {
    detail.value = await api.patchProject(detail.value.id, {
      dirs: detail.value.dirs.filter((d) => d !== dir),
    });
    const body = await api.projects();
    unassigned.value = body.unassigned;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "remove failed";
  } finally {
    busy.value = false;
  }
}

async function addWorkflow(): Promise<void> {
  if (!detail.value || !graphPick.value || busy.value) return;
  if (detail.value.workflowIds.includes(graphPick.value)) return;
  busy.value = true;
  try {
    detail.value = await api.patchProject(detail.value.id, {
      workflowIds: [...detail.value.workflowIds, graphPick.value],
    });
    graphPick.value = "";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "attach failed";
  } finally {
    busy.value = false;
  }
}

async function removeWorkflow(id: string): Promise<void> {
  if (!detail.value || busy.value) return;
  busy.value = true;
  try {
    detail.value = await api.patchProject(detail.value.id, {
      workflowIds: detail.value.workflowIds.filter((w) => w !== id),
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : "detach failed";
  } finally {
    busy.value = false;
  }
}

async function destroyProject(): Promise<void> {
  if (!detail.value || busy.value) return;
  if (!confirm(`Delete project “${detail.value.name}”? Repos stay on disk.`)) return;
  busy.value = true;
  try {
    await api.deleteProject(detail.value.id);
    void router.push("/projects");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "delete failed";
  } finally {
    busy.value = false;
  }
}

function openSessions(dirs: string[]): void {
  const dir = dirs[0];
  void router.push({
    path: "/",
    query: dir
      ? { view: "sessions", projectDir: dir }
      : { view: "sessions" },
  });
}

function openMap(dir: string): void {
  void router.push({ path: "/map", query: { dir } });
}

function openWorkflow(id: string): void {
  void router.push(`/graph/${encodeURIComponent(id)}`);
}

const availableGraphs = computed(() => {
  const taken = new Set(detail.value?.workflowIds ?? []);
  return graphOptions.value.filter((g) => !taken.has(g.id));
});
</script>

<template>
  <div class="proj-page">
    <DashNav :items="navItems" active="projects" @select="onNav" />
    <div class="proj-main dash-load-host">
      <GraphLoadingOverlay :loading="loading" label="Loading projects" />

      <!-- Gallery -->
      <template v-if="!projectId">
        <header class="dash-head">
          <h1 class="dash-title">Projects</h1>
          <div class="view-controls proj-new">
            <input
              v-model="newName"
              class="threadle-input"
              placeholder="New project name…"
              spellcheck="false"
              @keydown.enter="createProject"
            />
            <button
              type="button"
              class="threadle-btn"
              :disabled="busy || !newName.trim()"
              @click="createProject"
            >
              New
            </button>
          </div>
        </header>

        <p v-if="error" class="proj-err mono">{{ error }}</p>

        <div v-if="!loading && !projects.length" class="proj-empty">
          <p class="stat-note">
            Group related repos into a project, then attach workflows.
          </p>
        </div>

        <div v-else class="proj-grid">
          <button
            v-for="p in projects"
            :key="p.id"
            type="button"
            class="proj-card"
            @click="openProject(p.id)"
          >
            <div class="proj-card-top">
              <span class="proj-card-name">{{ p.name }}</span>
              <span v-if="p.pinned" class="proj-pin mono" title="Pinned">★</span>
            </div>
            <div class="proj-card-meta mono">
              <span>{{ p.dirs.length }} repo{{ p.dirs.length === 1 ? "" : "s" }}</span>
              <span>{{ p.workflowIds.length }} wf</span>
              <span v-if="p.liveCount" class="proj-live">● {{ p.liveCount }}</span>
              <span v-else>{{ p.sessionCount }} sess</span>
            </div>
            <div class="proj-card-foot mono">{{ fmtWhen(p.lastActivity) }}</div>
          </button>
        </div>

        <section v-if="unassigned.length" class="proj-unassigned">
          <div class="sess-group-head">
            <span class="micro-label sess-group-name">Unassigned</span>
            <span class="sess-group-spacer" />
            <span class="sess-meta mono">{{ unassigned.length }}</span>
          </div>
          <div
            v-for="u in unassigned"
            :key="u.dir"
            class="proj-un-row"
          >
            <div class="proj-un-main">
              <span class="proj-un-name" :title="u.dir">{{ u.basename }}</span>
              <span class="mono proj-un-path" :title="u.dir">{{ shortPath(u.dir) }}</span>
            </div>
            <div class="proj-un-actions">
              <span class="mono proj-dim">{{ u.sessionCount }} sess</span>
              <button
                type="button"
                class="vsc-btn"
                :disabled="busy"
                @click="createFromDir(u.dir)"
              >
                New project
              </button>
            </div>
          </div>
        </section>
      </template>

      <!-- Detail -->
      <template v-else-if="detail">
        <header class="dash-head">
          <div class="proj-title-row">
            <button type="button" class="map-back" title="Back" @click="router.push('/projects')">
              ←
            </button>
            <input
              v-model="editName"
              class="threadle-input proj-name-input"
              spellcheck="false"
              @keydown.enter="saveMeta"
              @blur="saveMeta"
            />
            <button
              type="button"
              class="vsc-btn"
              :class="{ active: detail.pinned }"
              :title="detail.pinned ? 'Unpin' : 'Pin'"
              @click="togglePin"
            >
              ★
            </button>
          </div>
          <div class="view-controls">
            <button
              type="button"
              class="threadle-btn"
              :disabled="!detail.dirs.length"
              @click="openSessions(detail.dirs)"
            >
              Sessions
            </button>
            <button
              type="button"
              class="vsc-btn danger"
              :disabled="busy"
              @click="destroyProject"
            >
              Delete
            </button>
          </div>
        </header>

        <p v-if="error" class="proj-err mono">{{ error }}</p>

        <div class="proj-detail-meta">
          <textarea
            v-model="editNotes"
            class="threadle-input proj-notes"
            rows="2"
            placeholder="Notes…"
            spellcheck="false"
            @blur="saveMeta"
          />
          <div class="proj-card-meta mono">
            <span>{{ detail.sessionCount }} sess</span>
            <span v-if="detail.liveCount" class="proj-live">● {{ detail.liveCount }} live</span>
            <span>{{ fmtWhen(detail.lastActivity) }}</span>
          </div>
        </div>

        <section class="proj-section">
          <div class="sess-group-head">
            <span class="micro-label sess-group-name">Repos</span>
            <span class="sess-group-spacer" />
            <span class="sess-meta mono">{{ detail.members.length }}</span>
          </div>
          <div v-if="!detail.members.length" class="stat-note">
            Add a workspace from Unassigned below.
          </div>
          <div
            v-for="m in detail.members"
            :key="m.dir"
            class="proj-member"
          >
            <div class="proj-un-main">
              <span class="proj-un-name" :title="m.dir">{{ m.basename }}</span>
              <span class="mono proj-un-path" :title="m.dir">{{ shortPath(m.dir) }}</span>
            </div>
            <div class="proj-un-actions">
              <span class="mono proj-dim">{{ m.sessionCount }}</span>
              <button type="button" class="vsc-btn" @click="openMap(m.dir)">Map</button>
              <button type="button" class="vsc-btn" @click="openSessions([m.dir])">Sessions</button>
              <button
                type="button"
                class="vsc-btn"
                :disabled="busy"
                @click="removeDir(m.dir)"
              >
                Remove
              </button>
            </div>
          </div>
          <div v-if="unassigned.length" class="proj-add-block">
            <span class="micro-label">Add unassigned</span>
            <div class="proj-add-list">
              <button
                v-for="u in unassigned"
                :key="u.dir"
                type="button"
                class="vsc-btn"
                :title="u.dir"
                :disabled="busy"
                @click="addDir(u.dir)"
              >
                + {{ u.basename }}
              </button>
            </div>
          </div>
        </section>

        <section class="proj-section">
          <div class="sess-group-head">
            <span class="micro-label sess-group-name">Workflows</span>
            <span class="sess-group-spacer" />
            <span class="sess-meta mono">{{ detail.workflows.length }}</span>
          </div>
          <div v-if="!detail.workflows.length" class="stat-note">
            Attach workflows that belong to this body of work.
          </div>
          <div
            v-for="w in detail.workflows"
            :key="w.id"
            class="proj-member"
          >
            <button
              type="button"
              class="proj-wf-link"
              :class="{ missing: w.missing }"
              @click="openWorkflow(w.id)"
            >
              {{ w.name }}
            </button>
            <button
              type="button"
              class="vsc-btn"
              :disabled="busy"
              @click="removeWorkflow(w.id)"
            >
              Detach
            </button>
          </div>
          <div v-if="availableGraphs.length" class="proj-add-block proj-wf-add">
            <select v-model="graphPick" class="threadle-input">
              <option value="">Attach workflow…</option>
              <option v-for="g in availableGraphs" :key="g.id" :value="g.id">
                {{ g.name }}
              </option>
            </select>
            <button
              type="button"
              class="threadle-btn"
              :disabled="busy || !graphPick"
              @click="addWorkflow"
            >
              Attach
            </button>
          </div>
        </section>
      </template>

      <p v-else-if="!loading && error" class="proj-err mono">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.proj-page {
  display: flex;
  height: 100%;
  min-height: 0;
  background: var(--bg);
  color: var(--fg);
}
.proj-main {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 1rem 1.25rem 2rem;
}
.proj-title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  flex: 1;
}
.map-back {
  background: transparent;
  border: none;
  color: var(--fg-muted);
  cursor: pointer;
  font: inherit;
  padding: 0.2rem 0.35rem;
}
.proj-name-input {
  flex: 1;
  min-width: 0;
  font-size: 1.1rem;
  font-weight: 600;
}
.proj-new {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}
.proj-new .threadle-input {
  min-width: 12rem;
}
.proj-err {
  color: var(--danger, #c44);
  margin: 0.5rem 0;
  font-size: 0.75rem;
}
.proj-empty {
  margin-top: 2rem;
}
.proj-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: 0.75rem;
  margin-top: 0.75rem;
}
.proj-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  text-align: left;
  padding: 0.85rem 0.9rem;
  border: 1px solid var(--border);
  background: var(--bg-elevated, var(--bg));
  color: inherit;
  cursor: pointer;
  border-radius: 2px;
  min-height: 5.5rem;
}
.proj-card:hover {
  border-color: var(--fg-muted);
}
.proj-card-top {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  min-width: 0;
}
.proj-card-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.proj-pin {
  color: var(--fg-muted);
  font-size: 0.7rem;
}
.proj-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  font-size: 0.7rem;
  color: var(--fg-muted);
}
.proj-card-foot {
  margin-top: auto;
  font-size: 0.65rem;
  color: var(--fg-dim, var(--fg-muted));
}
.proj-live {
  color: var(--fg);
}
.proj-unassigned,
.proj-section {
  margin-top: 1.5rem;
}
.proj-un-row,
.proj-member {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--border);
  min-width: 0;
}
.proj-un-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.proj-un-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.proj-un-path {
  font-size: 0.7rem;
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.proj-un-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}
.proj-dim {
  font-size: 0.7rem;
  color: var(--fg-muted);
  min-width: 3.5rem;
  text-align: right;
}
.proj-detail-meta {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0.75rem 0 0.25rem;
}
.proj-notes {
  width: 100%;
  resize: vertical;
  min-height: 2.5rem;
}
.proj-add-block {
  margin-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.proj-add-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.proj-wf-add {
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}
.proj-wf-add .threadle-input {
  min-width: 12rem;
  flex: 1;
}
.proj-wf-link {
  flex: 1;
  min-width: 0;
  text-align: left;
  background: transparent;
  border: none;
  color: var(--fg);
  cursor: pointer;
  font: inherit;
  padding: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.proj-wf-link.missing {
  color: var(--fg-muted);
  font-style: italic;
}
.vsc-btn.danger {
  color: var(--danger, #c44);
}
.vsc-btn.active {
  color: var(--fg);
}
</style>
