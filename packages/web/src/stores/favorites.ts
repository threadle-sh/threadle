import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  favoriteMatchKey,
  type FavoriteCreate,
  type FavoriteEntry,
  type FavoriteKind,
} from "@threadle/shared";
import { api } from "@/api/client";

export type FavoriteAlive = FavoriteEntry & { alive?: boolean };

export const useFavoritesStore = defineStore("favorites", () => {
  const items = ref<FavoriteAlive[]>([]);
  const loaded = ref(false);
  const loading = ref(false);

  const byKey = computed(() => {
    const m = new Map<string, FavoriteAlive>();
    for (const i of items.value) m.set(favoriteMatchKey(i), i);
    return m;
  });

  function isFavorite(input: FavoriteCreate | FavoriteEntry): boolean {
    return byKey.value.has(favoriteMatchKey(input as FavoriteEntry));
  }

  function find(input: FavoriteCreate | FavoriteEntry): FavoriteAlive | undefined {
    return byKey.value.get(favoriteMatchKey(input as FavoriteEntry));
  }

  async function load(opts?: { check?: boolean }): Promise<void> {
    loading.value = true;
    try {
      const res = await api.favorites(opts?.check);
      items.value = res.items;
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  async function ensureLoaded(): Promise<void> {
    if (!loaded.value) await load();
  }

  async function add(input: FavoriteCreate): Promise<FavoriteEntry> {
    const res = await api.addFavorite(input);
    const idx = items.value.findIndex((i) => i.id === res.entry.id);
    if (idx >= 0) items.value[idx] = { ...res.entry, alive: true };
    else items.value = [{ ...res.entry, alive: true }, ...items.value];
    loaded.value = true;
    return res.entry;
  }

  async function remove(id: string): Promise<void> {
    const res = await api.removeFavorite(id);
    items.value = res.items.map((i) => {
      const prev = items.value.find((p) => p.id === i.id);
      return prev?.alive === false ? { ...i, alive: false } : i;
    });
  }

  async function toggle(input: FavoriteCreate): Promise<"added" | "removed"> {
    await ensureLoaded();
    const existing = find(input);
    if (existing) {
      await remove(existing.id);
      return "removed";
    }
    await add(input);
    return "added";
  }

  async function prune(): Promise<number> {
    const res = await api.pruneFavorites();
    items.value = res.items;
    return res.removed;
  }

  function ofKind(kind: FavoriteKind): FavoriteAlive[] {
    return items.value.filter((i) => i.kind === kind);
  }

  return {
    items,
    loaded,
    loading,
    byKey,
    isFavorite,
    find,
    load,
    ensureLoaded,
    add,
    remove,
    toggle,
    prune,
    ofKind,
  };
});
