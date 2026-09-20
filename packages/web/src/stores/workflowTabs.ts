import { defineStore } from "pinia";
import { computed, ref } from "vue";

const STORAGE_KEY = "threadle.openWorkflows";

type StoredTabs = { ids: string[]; names: Record<string, string> };

function readStored(): StoredTabs {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as unknown;
    // legacy: bare id array
    if (Array.isArray(raw)) {
      return {
        ids: raw.filter((id): id is string => typeof id === "string" && id.length > 0),
        names: {},
      };
    }
    if (raw && typeof raw === "object") {
      const o = raw as { ids?: unknown; names?: unknown };
      const ids = Array.isArray(o.ids)
        ? o.ids.filter((id): id is string => typeof id === "string" && id.length > 0)
        : [];
      const names: Record<string, string> = {};
      if (o.names && typeof o.names === "object") {
        for (const [k, v] of Object.entries(o.names as Record<string, unknown>)) {
          if (typeof v === "string" && v.trim()) names[k] = v;
        }
      }
      return { ids, names };
    }
  } catch {
    /* ignore */
  }
  return { ids: [], names: {} };
}

/**
 * Open workflow tabs: which graph ids are open in the editor.
 * The active tab is the route (`/graph/:id`); this store tracks the set + display titles.
 */
export const useWorkflowTabsStore = defineStore("workflowTabs", () => {
  const stored = readStored();
  const openIds = ref<string[]>(stored.ids);
  const names = ref<Record<string, string>>(stored.names);

  const openCount = computed(() => openIds.value.length);

  function persist(): void {
    const kept: Record<string, string> = {};
    for (const id of openIds.value) {
      const n = names.value[id];
      if (n) kept[id] = n;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ids: openIds.value, names: kept }));
  }

  function ensureOpen(id: string, name?: string): void {
    if (!openIds.value.includes(id)) {
      openIds.value = [...openIds.value, id];
    }
    if (name?.trim()) names.value = { ...names.value, [id]: name.trim() };
    persist();
  }

  function setName(id: string, name: string): void {
    const n = name.trim();
    if (!n || names.value[id] === n) return;
    names.value = { ...names.value, [id]: n };
    if (openIds.value.includes(id)) persist();
  }

  function close(id: string): string | undefined {
    const idx = openIds.value.indexOf(id);
    if (idx < 0) return undefined;
    const next = openIds.value.filter((x) => x !== id);
    openIds.value = next;
    const { [id]: _drop, ...rest } = names.value;
    names.value = rest;
    persist();
    // Prefer neighbor tab when closing the active one.
    return next[Math.min(idx, next.length - 1)];
  }

  function closeAll(): void {
    openIds.value = [];
    names.value = {};
    persist();
  }

  /** Move `id` so it lands at `toIndex` in the current open list (before removal). */
  function move(id: string, toIndex: number): void {
    const from = openIds.value.indexOf(id);
    if (from < 0) return;
    const next = openIds.value.slice();
    next.splice(from, 1);
    let idx = toIndex;
    if (from < toIndex) idx -= 1;
    idx = Math.max(0, Math.min(next.length, idx));
    next.splice(idx, 0, id);
    if (next.every((v, i) => v === openIds.value[i])) return;
    openIds.value = next;
    persist();
  }

  function label(id: string): string {
    return names.value[id] || id;
  }

  return {
    openIds,
    names,
    openCount,
    ensureOpen,
    setName,
    close,
    closeAll,
    move,
    label,
  };
});
