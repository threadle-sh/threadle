<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { providerShort } from "@/lib/providers";

const props = defineProps<{
  modelValue: string;
  /** Filter ids in display order (e.g. sessionFiltersFor result). */
  options: readonly string[];
  /** Override chip label; defaults: all → all, payload → payloads, else providerShort. */
  labelFor?: (id: string) => string;
}>();

const emit = defineEmits<{
  "update:modelValue": [v: string];
}>();

const root = ref<HTMLElement>();
const measureEl = ref<HTMLElement>();
const moreBtn = ref<HTMLElement>();
const visibleIds = ref<string[]>([...props.options]);
const overflowIds = ref<string[]>([]);
const menuOpen = ref(false);
const menuPos = ref({ x: 0, y: 0 });

const GAP = 4;

function chipLabel(id: string): string {
  if (props.labelFor) return props.labelFor(id);
  if (id === "all") return "all";
  if (id === "payload") return "payloads";
  return providerShort(id);
}

function chipProviderAttr(id: string): string | undefined {
  if (id === "all" || id === "payload") return undefined;
  return id;
}

function select(id: string): void {
  emit("update:modelValue", id);
  menuOpen.value = false;
}

function computeFit(
  options: readonly string[],
  selected: string,
  widths: Map<string, number>,
  moreW: number,
  available: number,
): { visible: string[]; overflow: string[] } {
  if (!options.length) return { visible: [], overflow: [] };

  const total =
    options.reduce((s, id) => s + (widths.get(id) ?? 0), 0) +
    GAP * Math.max(0, options.length - 1);
  // +1px tolerance for subpixel rounding so we don't +N when everything fits.
  if (total <= available + 1 || available <= 0) {
    return { visible: [...options], overflow: [] };
  }

  const mustShow: string[] = [];
  if (options.includes("all")) mustShow.push("all");
  if (selected !== "all" && options.includes(selected) && !mustShow.includes(selected)) {
    mustShow.push(selected);
  }

  const others = options.filter((id) => !mustShow.includes(id));
  const budget = Math.max(0, available - moreW - GAP);

  const chosen = new Set<string>();
  let used = 0;

  for (const id of mustShow) {
    const w = widths.get(id) ?? 0;
    if (chosen.size) used += GAP;
    used += w;
    chosen.add(id);
  }

  // If pinned chips alone exceed budget, still show them (overflow handles the rest).
  const overflow: string[] = [];
  for (const id of others) {
    const w = widths.get(id) ?? 0;
    const need = (chosen.size ? GAP : 0) + w;
    if (used + need <= budget) {
      used += need;
      chosen.add(id);
    } else {
      overflow.push(id);
    }
  }

  if (!overflow.length) {
    return { visible: [...options], overflow: [] };
  }

  return {
    visible: options.filter((id) => chosen.has(id)),
    overflow,
  };
}

/** Min gap between the view title and the leftmost filter chip. */
const TITLE_GAP = 20;

/**
 * Space chips may occupy before colliding with the view title.
 * Same-row headers: title.right → trailing controls.
 * Toolbars below the title: full row minus trailing siblings.
 */
function availableWidth(rootEl: HTMLElement): number {
  const row =
    rootEl.closest(
      ".dash-head, .map-head, .lin-head, .tl-head, .tl-toolbar, .lin-toolbar, .dash-toolbar",
    ) ?? rootEl.parentElement;
  if (!row) return Math.max(0, rootEl.clientWidth);

  const title =
    (row.classList.contains("dash-toolbar") ||
    row.classList.contains("tl-toolbar") ||
    row.classList.contains("lin-toolbar")
      ? row.parentElement
      : row
    )?.querySelector<HTMLElement>(
      ".dash-title, .map-title, .tl-title, .lin-title, h1",
    ) ?? null;

  // Trailing controls after the chip cluster (● active, sort, search, …).
  let reserved = 0;
  let el: HTMLElement | null = rootEl;
  while (el && el !== row) {
    const parent: HTMLElement | null = el.parentElement;
    if (!parent) break;
    const g =
      parseFloat(getComputedStyle(parent).columnGap || getComputedStyle(parent).gap || "0") || 0;
    let after = false;
    for (const sib of Array.from(parent.children)) {
      if (sib === el) {
        after = true;
        continue;
      }
      if (!after || !(sib instanceof HTMLElement)) continue;
      reserved += sib.getBoundingClientRect().width + g;
    }
    el = parent;
  }

  const rowRect = row.getBoundingClientRect();
  const rightBound = rowRect.right - reserved;

  // Same row as title → stop before the title. Otherwise use the full row.
  let leftBound = rowRect.left;
  if (title) {
    const titleRect = title.getBoundingClientRect();
    const sameRow =
      Math.abs(titleRect.top - rowRect.top) < titleRect.height ||
      row.contains(title);
    if (sameRow) {
      leftBound = Math.max(leftBound, titleRect.right + TITLE_GAP);
    }
  }

  return Math.max(0, rightBound - leftBound);
}

function recompute(): void {
  const rootEl = root.value;
  const measure = measureEl.value;
  if (!rootEl || !measure) return;

  const options = props.options;
  const chipNodes = measure.querySelectorAll<HTMLElement>("[data-measure-id]");
  const widths = new Map<string, number>();
  for (const el of chipNodes) {
    const id = el.dataset.measureId;
    if (!id) continue;
    widths.set(id, el.getBoundingClientRect().width);
  }
  const moreNode = measure.querySelector<HTMLElement>("[data-measure-more]");
  const moreW = moreNode?.getBoundingClientRect().width ?? 36;
  const available = availableWidth(rootEl);

  const { visible, overflow } = computeFit(
    options,
    props.modelValue,
    widths,
    moreW,
    available,
  );
  visibleIds.value = visible;
  overflowIds.value = overflow;
  if (!overflow.length) menuOpen.value = false;
}

let ro: ResizeObserver | undefined;
const onWinResize = (): void => {
  recompute();
};

onMounted(() => {
  void nextTick(() => {
    recompute();
    requestAnimationFrame(() => recompute());
  });
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => recompute());
    if (root.value) ro.observe(root.value);
    if (root.value?.parentElement) ro.observe(root.value.parentElement);
    const row = root.value?.closest(
      ".dash-head, .map-head, .lin-head, .tl-head, .tl-toolbar, .lin-toolbar, .dash-toolbar",
    );
    if (row) ro.observe(row);
    const titleHost =
      row?.classList.contains("dash-toolbar") ||
      row?.classList.contains("tl-toolbar") ||
      row?.classList.contains("lin-toolbar")
        ? row.parentElement
        : row;
    const title = titleHost?.querySelector(
      ".dash-title, .map-title, .tl-title, .lin-title, h1",
    );
    if (title) ro.observe(title);
  }
  window.addEventListener("resize", onWinResize);
  document.addEventListener("pointerdown", onDocPointer, true);
  document.addEventListener("keydown", onDocKey);
});

onUnmounted(() => {
  ro?.disconnect();
  window.removeEventListener("resize", onWinResize);
  document.removeEventListener("pointerdown", onDocPointer, true);
  document.removeEventListener("keydown", onDocKey);
});

watch(
  () => [props.options, props.modelValue] as const,
  async () => {
    await nextTick();
    recompute();
  },
  { deep: true },
);

function onDocPointer(e: PointerEvent): void {
  if (!menuOpen.value) return;
  const t = e.target as Node | null;
  if (moreBtn.value?.contains(t)) return;
  const menu = document.querySelector(".pfc-menu");
  if (menu?.contains(t)) return;
  menuOpen.value = false;
}

function onDocKey(e: KeyboardEvent): void {
  if (e.key === "Escape") menuOpen.value = false;
}

function toggleMenu(e: MouseEvent): void {
  if (!overflowIds.value.length) return;
  if (menuOpen.value) {
    menuOpen.value = false;
    return;
  }
  const btn = e.currentTarget as HTMLElement;
  const r = btn.getBoundingClientRect();
  const menuW = 180;
  const pad = 8;
  let x = r.left;
  let y = r.bottom + 4;
  x = Math.max(pad, Math.min(x, window.innerWidth - menuW - pad));
  y = Math.max(pad, Math.min(y, window.innerHeight - 200 - pad));
  menuPos.value = { x, y };
  menuOpen.value = true;
}

const measureMoreLabel = computed(() => `+${Math.max(1, props.options.length)}`);
</script>

<template>
  <div ref="root" class="provider-filter-chips chip-row">
    <!-- Invisible measure row: full option set + max +N width -->
    <div ref="measureEl" class="pfc-measure" aria-hidden="true">
      <button
        v-for="id in options"
        :key="'m-' + id"
        type="button"
        class="filter-chip"
        :data-measure-id="id"
        :data-provider="chipProviderAttr(id)"
        tabindex="-1"
      >
        {{ chipLabel(id) }}
      </button>
      <button type="button" class="filter-chip" data-measure-more tabindex="-1">
        {{ measureMoreLabel }}
      </button>
    </div>

    <button
      v-for="id in visibleIds"
      :key="id"
      type="button"
      class="filter-chip"
      :data-provider="chipProviderAttr(id)"
      :class="{ active: modelValue === id }"
      @click="select(id)"
    >
      {{ chipLabel(id) }}
    </button>

    <button
      v-if="overflowIds.length"
      ref="moreBtn"
      type="button"
      class="filter-chip pfc-more"
      :class="{ active: menuOpen || overflowIds.includes(modelValue) }"
      :title="`${overflowIds.length} more providers`"
      @click="toggleMenu"
    >
      +{{ overflowIds.length }}
    </button>

    <Teleport to="body">
      <div
        v-if="menuOpen && overflowIds.length"
        class="filter-chip-menu pfc-menu"
        :style="{ left: menuPos.x + 'px', top: menuPos.y + 'px' }"
        @click.stop
      >
        <div class="filter-chip-menu-title mono">more providers</div>
        <button
          v-for="id in overflowIds"
          :key="'o-' + id"
          type="button"
          class="filter-chip-menu-item pfc-menu-item"
          :data-provider="chipProviderAttr(id)"
          :class="{ active: modelValue === id }"
          @click="select(id)"
        >
          <span v-if="chipProviderAttr(id)" class="pfc-dot" />
          {{ chipLabel(id) }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.provider-filter-chips {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  flex-wrap: nowrap;
  overflow: hidden;
  justify-content: flex-end;
}
.pfc-measure {
  position: absolute;
  left: -9999px;
  top: 0;
  visibility: hidden;
  pointer-events: none;
  display: flex;
  gap: 4px;
  white-space: nowrap;
}
.pfc-more {
  flex-shrink: 0;
}
.pfc-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pfc-menu-item.active {
  background: var(--accent-soft);
  font-weight: 600;
}
.pfc-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--chip-prov, var(--text-faint));
}
/* Menu items inherit data-provider → --chip-prov from theme.css filter-chip rules;
   those only target .filter-chip — set --chip-prov here for the dot. */
.pfc-menu-item[data-provider="claude-code"] { --chip-prov: var(--claude); }
.pfc-menu-item[data-provider="opencode"] { --chip-prov: var(--opencode); }
.pfc-menu-item[data-provider="cursor"] { --chip-prov: var(--cursor); }
.pfc-menu-item[data-provider="antigravity"] { --chip-prov: var(--antigravity); }
.pfc-menu-item[data-provider="codex"] { --chip-prov: var(--codex); }
.pfc-menu-item[data-provider="copilot"] { --chip-prov: var(--copilot); }
.pfc-menu-item[data-provider="grok"] { --chip-prov: var(--grok); }
.pfc-menu-item[data-provider="threadle"] { --chip-prov: var(--threadle); }
</style>
