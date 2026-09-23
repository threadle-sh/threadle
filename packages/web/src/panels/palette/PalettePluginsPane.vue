<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { dragSkill, type PaletteSkillDragRow } from "@/lib/paletteDrag";
import { providerLabel } from "@/lib/providers";

interface PluginChild {
  kind: string;
  name: string;
  description?: string;
  path?: string;
}

interface PluginEntry {
  provider: string;
  id: string;
  name: string;
  version?: string;
  description?: string;
  origin: { kind: string; path: string; marketplaceId?: string };
  state: string;
  children: PluginChild[];
}

const props = defineProps<{
  filter: string;
}>();

const items = ref<PluginEntry[] | undefined>(undefined);
const expanded = ref<Set<string>>(new Set());

async function load(): Promise<void> {
  try {
    const res = await fetch("/api/plugins");
    items.value = (await res.json()) as PluginEntry[];
  } catch {
    items.value = [];
  }
}

onMounted(() => {
  void load();
});

function keyOf(e: PluginEntry): string {
  return `${e.provider}:${e.id}`;
}

function toggle(e: PluginEntry): void {
  const k = keyOf(e);
  const next = new Set(expanded.value);
  if (next.has(k)) next.delete(k);
  else next.add(k);
  expanded.value = next;
}

const filtered = computed(() => {
  const q = props.filter.trim().toLowerCase();
  return (items.value ?? []).filter((e) => {
    if (!q) return true;
    const hay = [
      e.name,
      e.id,
      e.provider,
      e.version ?? "",
      e.description ?? "",
      ...e.children.map((c) => c.name),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
});

function skillRow(e: PluginEntry, c: PluginChild): PaletteSkillDragRow | null {
  if (c.kind !== "skill" || !c.path) return null;
  return {
    path: c.path,
    name: c.name,
    source: `${e.name}${e.version ? `@${e.version}` : ""}`,
    description: c.description ?? e.description,
    origin: "global",
  };
}

const ready = computed(() => items.value !== undefined);
</script>

<template>
  <section class="pal-section">
    <p v-if="!ready" class="pal-empty">loading…</p>
    <p v-else-if="!filtered.length" class="pal-empty">no plugins found</p>
    <div v-else>
      <div v-for="e in filtered" :key="keyOf(e)" class="pal-plugin">
        <button
          type="button"
          class="pal-item pal-plugin-head"
          :title="e.description || e.origin.path"
          @click="toggle(e)"
        >
          <span class="pal-icon pal-plugin-icon">▣</span>
          <div class="pal-item-body">
            <div class="pal-item-title mono">{{ e.name }}</div>
            <div class="pal-item-sub">
              {{ providerLabel(e.provider)
              }}{{ e.version ? ` · ${e.version}` : "" }} · {{ e.state }}
            </div>
          </div>
          <span class="pal-plugin-chevron mono">{{
            expanded.has(keyOf(e)) ? "▾" : "▸"
          }}</span>
        </button>
        <div v-if="expanded.has(keyOf(e))" class="pal-plugin-kids">
          <template v-for="(c, i) in e.children" :key="i">
            <div
              v-if="skillRow(e, c)"
              class="pal-item pal-plugin-kid"
              draggable="true"
              :title="c.description || c.path"
              @dragstart="dragSkill($event, skillRow(e, c)!)"
            >
              <span
                class="pal-icon"
                style="background: var(--accent); color: var(--accent-fg)"
                >✦</span
              >
              <div class="pal-item-body">
                <div class="pal-item-title mono">{{ c.name }}</div>
                <div class="pal-item-sub">skill · drag to canvas</div>
              </div>
            </div>
            <div
              v-else
              class="pal-item pal-plugin-kid pal-plugin-kid-static"
              :title="c.description || c.path"
            >
              <span class="pal-icon pal-plugin-icon-dim">{{
                c.kind === "agent" ? "⟨/⟩" : c.kind === "mcp" ? "◈" : "›"
              }}</span>
              <div class="pal-item-body">
                <div class="pal-item-title mono">{{ c.name }}</div>
                <div class="pal-item-sub">{{ c.kind }}</div>
              </div>
            </div>
          </template>
          <p v-if="!e.children.length" class="pal-empty pal-plugin-empty">
            no skills / agents
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pal-plugin {
  margin-bottom: 2px;
}
.pal-plugin-head {
  width: 100%;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}
.pal-plugin-icon {
  background: color-mix(in srgb, var(--text-dim) 22%, transparent);
  color: var(--text);
}
.pal-plugin-icon-dim {
  background: transparent;
  color: var(--text-dim);
  border: 1px solid var(--border);
}
.pal-plugin-chevron {
  color: var(--text-faint);
  font-size: var(--fs-xs);
  flex-shrink: 0;
  margin-left: auto;
  padding-right: 4px;
}
.pal-plugin-kids {
  padding-left: 10px;
  margin: 0 0 6px;
  border-left: 1px solid var(--border);
  margin-left: 14px;
}
.pal-plugin-kid-static {
  opacity: 0.72;
  cursor: default;
}
.pal-plugin-empty {
  padding-left: 8px;
}
</style>
