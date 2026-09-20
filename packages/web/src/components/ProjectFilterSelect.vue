<template>
  <span class="proj-switch">
    <button
      type="button"
      class="proj-dd threadle-input"
      :title="title"
      :aria-expanded="open"
      @click.stop="toggle"
    >
      <span class="mono proj-dd-label" :title="selectedTitle">{{ selectedLabel }}</span>
      <span class="proj-dd-caret" aria-hidden="true">▾</span>
    </button>
    <div
      v-if="open"
      class="proj-pop"
      role="listbox"
      @click.stop
    >
      <input
        ref="searchInput"
        v-model="filter"
        class="threadle-input proj-pop-search"
        placeholder="Filter projects…"
        spellcheck="false"
        @keydown.esc.stop="close"
      />
      <div class="proj-pop-list">
        <button
          type="button"
          class="proj-pop-item"
          :class="{ active: modelValue === 'all' }"
          role="option"
          :aria-selected="modelValue === 'all'"
          @click="pick('all')"
        >
          <span class="proj-pop-name">{{ allLabel }}</span>
        </button>
        <button
          v-for="opt in filtered"
          :key="opt.dir"
          type="button"
          class="proj-pop-item"
          :class="{ active: modelValue === opt.dir }"
          role="option"
          :aria-selected="modelValue === opt.dir"
          :title="opt.dir"
          @click="pick(opt.dir)"
        >
          <span class="proj-pop-name">{{ opt.label }}</span>
          <span v-if="opt.meta" class="proj-pop-meta mono">{{ opt.meta }}</span>
        </button>
        <div v-if="!filtered.length" class="proj-pop-empty mono">
          no projects match
        </div>
      </div>
    </div>
  </span>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

export interface ProjectFilterOption {
  dir: string;
  label: string;
  meta?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: ProjectFilterOption[];
    allLabel?: string;
    title?: string;
  }>(),
  {
    allLabel: "all projects",
    title: "Filter by project",
  },
);

const emit = defineEmits<{
  "update:modelValue": [v: string];
}>();

const open = ref(false);
const filter = ref("");
const searchInput = ref<HTMLInputElement | null>(null);

const selectedLabel = computed(() => {
  if (props.modelValue === "all") return props.allLabel;
  return (
    props.options.find((o) => o.dir === props.modelValue)?.label ??
    props.modelValue.split("/").filter(Boolean).pop() ??
    props.modelValue
  );
});

const selectedTitle = computed(() =>
  props.modelValue === "all" ? props.allLabel : props.modelValue,
);

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return props.options;
  return props.options.filter(
    (o) =>
      o.label.toLowerCase().includes(q) ||
      o.dir.toLowerCase().includes(q) ||
      (o.meta?.toLowerCase().includes(q) ?? false),
  );
});

function close(): void {
  open.value = false;
  filter.value = "";
}

function toggle(): void {
  if (open.value) {
    close();
    return;
  }
  open.value = true;
  filter.value = "";
  void nextTick(() => searchInput.value?.focus());
}

function pick(dir: string): void {
  emit("update:modelValue", dir);
  close();
}

function onDocPointer(ev: MouseEvent): void {
  if (!open.value) return;
  const t = ev.target;
  if (!(t instanceof Element)) return;
  if (t.closest(".proj-switch")) return;
  close();
}

watch(open, (v) => {
  if (v) {
    document.addEventListener("mousedown", onDocPointer);
  } else {
    document.removeEventListener("mousedown", onDocPointer);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocPointer);
});
</script>

<style scoped>
.proj-switch {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}
.proj-dd {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: min(200px, 28vw);
  height: 30px;
  padding: 4px 10px;
  font-size: var(--fs-sm);
  cursor: pointer;
  text-align: left;
}
.proj-dd:hover {
  border-color: var(--border-strong);
}
.proj-dd[aria-expanded="true"] {
  border-color: var(--border-strong);
}
.proj-dd-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.proj-dd-caret {
  flex-shrink: 0;
  color: var(--text-faint);
  font-size: var(--fs-2xs);
  line-height: 1;
}
.proj-pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: auto;
  z-index: 40;
  width: min(420px, 70vw);
  min-width: max(100%, 240px);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.proj-pop-search {
  width: 100%;
  height: 30px;
  padding: 4px 10px;
  font-size: var(--fs-sm);
}
.proj-pop-list {
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.proj-pop-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  margin: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.proj-pop-item:hover {
  background: var(--hover-overlay);
}
.proj-pop-item.active {
  background: var(--panel-bg-raised);
}
.proj-pop-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
}
.proj-pop-meta {
  flex-shrink: 0;
  color: var(--text-faint);
  font-size: var(--fs-2xs);
  white-space: nowrap;
}
.proj-pop-empty {
  padding: 10px 8px;
  color: var(--text-faint);
  font-size: var(--fs-xs);
}
</style>
