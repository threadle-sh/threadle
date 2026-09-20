import { computed, onMounted, onUnmounted, ref, type ComputedRef, type Ref } from "vue";

export interface FilterChipMenuState<K extends string = string> {
  x: number;
  y: number;
  key?: K;
}

export interface FilterChipMenuOptions<K extends string> {
  /** All filter keys in display order. */
  keys: () => readonly K[];
  /** Whether a key is currently on. */
  isOn: (key: K) => boolean;
  /** Replace on/off state for every key. */
  setAll: (next: Record<K, boolean>) => void;
  /** Optional count for “only nonempty”. */
  count?: (key: K) => number;
  /** Title for the open menu (glyph + label). */
  labelFor?: (key: K) => string;
  /** Called after any apply that changes state. */
  afterApply?: () => void;
}

function clampMenuPos(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const pad = 8;
  return {
    x: Math.max(pad, Math.min(x, window.innerWidth - w - pad)),
    y: Math.max(pad, Math.min(y, window.innerHeight - h - pad)),
  };
}

export function useFilterChipMenu<K extends string>(opts: FilterChipMenuOptions<K>): {
  menu: Ref<FilterChipMenuState<K> | undefined>;
  menuTitle: ComputedRef<string>;
  openMenu: (e: MouseEvent, seed?: K) => void;
  dismissMenu: () => void;
  applyOnly: () => void;
  applyExcept: () => void;
  applyAdd: () => void;
  applyHide: () => void;
  applyShowAll: () => void;
  applyHideAll: () => void;
  applyInvert: () => void;
  applyNonempty: () => void;
  hasNonempty: ComputedRef<boolean>;
} {
  const menu = ref<FilterChipMenuState<K>>();

  const menuTitle = computed(() => {
    const key = menu.value?.key;
    if (!key) return "filters";
    return opts.labelFor?.(key) ?? key;
  });

  const hasNonempty = computed(() => typeof opts.count === "function");

  function dismissMenu(): void {
    menu.value = undefined;
  }

  function openMenu(e: MouseEvent, seed?: K): void {
    const pos = clampMenuPos(e.clientX, e.clientY, 200, 280);
    menu.value = { x: pos.x, y: pos.y, key: seed };
  }

  function commit(next: Record<K, boolean>): void {
    opts.setAll(next);
    opts.afterApply?.();
    dismissMenu();
  }

  function blank(): Record<K, boolean> {
    const next = {} as Record<K, boolean>;
    for (const k of opts.keys()) next[k] = false;
    return next;
  }

  function applyOnly(): void {
    const key = menu.value?.key;
    if (!key) return;
    const next = blank();
    next[key] = true;
    commit(next);
  }

  function applyExcept(): void {
    const key = menu.value?.key;
    if (!key) return;
    const next = blank();
    for (const k of opts.keys()) next[k] = k !== key;
    commit(next);
  }

  function applyAdd(): void {
    const key = menu.value?.key;
    if (!key) return;
    const next = blank();
    for (const k of opts.keys()) next[k] = opts.isOn(k);
    next[key] = true;
    commit(next);
  }

  function applyHide(): void {
    const key = menu.value?.key;
    if (!key) return;
    const next = blank();
    for (const k of opts.keys()) next[k] = opts.isOn(k);
    next[key] = false;
    commit(next);
  }

  function applyShowAll(): void {
    const next = blank();
    for (const k of opts.keys()) next[k] = true;
    commit(next);
  }

  function applyHideAll(): void {
    commit(blank());
  }

  function applyInvert(): void {
    const next = blank();
    for (const k of opts.keys()) next[k] = !opts.isOn(k);
    commit(next);
  }

  function applyNonempty(): void {
    if (!opts.count) return;
    const next = blank();
    for (const k of opts.keys()) next[k] = opts.count(k) > 0;
    commit(next);
  }

  function onDocMouseDown(e: MouseEvent): void {
    if (!menu.value || e.button !== 0) return;
    const t = e.target as Element | null;
    if (t?.closest?.(".filter-chip-menu")) return;
    dismissMenu();
  }

  function onDocKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") dismissMenu();
  }

  onMounted(() => {
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onDocKeydown);
  });
  onUnmounted(() => {
    document.removeEventListener("mousedown", onDocMouseDown);
    document.removeEventListener("keydown", onDocKeydown);
  });

  return {
    menu,
    menuTitle,
    openMenu,
    dismissMenu,
    applyOnly,
    applyExcept,
    applyAdd,
    applyHide,
    applyShowAll,
    applyHideAll,
    applyInvert,
    applyNonempty,
    hasNonempty,
  };
}
