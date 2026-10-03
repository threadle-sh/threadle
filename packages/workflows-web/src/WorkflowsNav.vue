<template>
  <DashNav
    :items="items"
    :sections="SECTIONS"
    :active="active"
    brand="workflows"
    :compact="compact"
    :state-key="stateKey"
    :default-collapsed="defaultCollapsed"
    @select="onSelect"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import DashNav from "@ui/panels/DashNav.vue";
import type { NavItem, NavSection } from "@ui/panels/nav-items";
import { api } from "@wf/api/client";

/**
 * Sidebar of the workflows app — its own sections, not the viewer's. The
 * viewer is a separate app; "Viewer" opens it in its own tab.
 */
const props = defineProps<{
  active?: "workflows" | "runs" | "logs" | "nodes";
  compact?: boolean;
  stateKey?: string;
  defaultCollapsed?: boolean;
  /** live count override from the page (e.g. the list already has graphs loaded) */
  workflowCount?: number | "";
}>();

const SECTIONS: NavSection[] = [
  {
    id: "build",
    label: "Workflows",
    items: [
      { id: "workflows", glyph: "⌗", label: "Workflows" },
      { id: "runs", glyph: "◷", label: "Runs" },
      { id: "logs", glyph: "≣", label: "Logs" },
      { id: "nodes", glyph: "⚙", label: "Nodes" },
    ],
  },
  {
    id: "out",
    label: "Viewer",
    items: [{ id: "viewer", glyph: "❯", label: "Viewer ↗", app: "viewer" }],
  },
];

const router = useRouter();
const graphCount = ref<number | "">("");
const running = ref<number | "">("");
let timer: ReturnType<typeof setInterval> | undefined;

async function refreshCounts(): Promise<void> {
  try {
    const g = await api.graphs();
    graphCount.value = g.filter((x) => !/^(Example|Recipe)\s*·/i.test(x.name)).length || "";
  } catch {
    /* keep prior */
  }
  try {
    const jobs = await api.jobs();
    running.value = jobs.filter((j) => j.status === "running").length || "";
  } catch {
    /* keep prior */
  }
}

onMounted(() => {
  void refreshCounts();
  timer = setInterval(() => void refreshCounts(), 10_000);
});
onUnmounted(() => clearInterval(timer));

const items = computed<NavItem[]>(() => [
  { id: "workflows", glyph: "⌗", label: "Workflows", count: props.workflowCount ?? graphCount.value },
  { id: "runs", glyph: "◷", label: "Runs", count: running.value },
  { id: "logs", glyph: "≣", label: "Logs" },
  { id: "nodes", glyph: "⚙", label: "Nodes" },
  { id: "viewer", glyph: "❯", label: "Viewer ↗", app: "viewer" },
]);

function onSelect(id: string): void {
  void router.push(id === "workflows" ? "/addon/workflows" : `/addon/workflows/${id}`);
}
</script>
