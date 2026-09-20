import type { Directive, DirectiveBinding } from "vue";

const MIN_PX = 48;
const STORE_PREFIX = "threadle:cols:";

type GridState = {
  key: string;
  defaults: string[];
  cols: string[];
};

const stateByEl = new WeakMap<HTMLElement, GridState>();

function load(key: string, defaults: string[]): string[] {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    if (!raw) return [...defaults];
    const parsed = JSON.parse(raw) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length === defaults.length &&
      parsed.every((x) => typeof x === "string")
    ) {
      return parsed as string[];
    }
  } catch {
    /* ignore */
  }
  return [...defaults];
}

function save(key: string, cols: string[]): void {
  try {
    localStorage.setItem(STORE_PREFIX + key, JSON.stringify(cols));
  } catch {
    /* ignore */
  }
}

function applyCols(el: HTMLElement, cols: string[]): void {
  el.style.setProperty("--cols", cols.join(" "));
}

function ensureHandles(el: HTMLElement): void {
  const header = el.querySelector(".stat-cols, .wf-cols") as HTMLElement | null;
  if (!header) return;
  const state = stateByEl.get(el);
  if (!state) return;

  [...header.children].forEach((cell, i) => {
    const host = cell as HTMLElement;
    if (host.querySelector(":scope > .col-resizer")) return;
    // skip trailing empty action columns with no label (still allow resize)
    const handle = document.createElement("i");
    handle.className = "col-resizer";
    handle.title = "Drag to resize column";
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      beginResize(el, i, e as MouseEvent);
    });
    if (getComputedStyle(host).position === "static") {
      host.style.position = "relative";
    }
    host.appendChild(handle);
  });
}

function beginResize(el: HTMLElement, index: number, e: MouseEvent): void {
  const state = stateByEl.get(el);
  if (!state) return;
  const header = el.querySelector(".stat-cols, .wf-cols") as HTMLElement | null;
  if (!header) return;
  const cell = header.children[index] as HTMLElement | undefined;
  if (!cell) return;

  const startX = e.clientX;
  const startW = cell.getBoundingClientRect().width;

  const onMove = (ev: MouseEvent): void => {
    const w = Math.max(MIN_PX, Math.round(startW + (ev.clientX - startX)));
    const next = [...state.cols];
    next[index] = `${w}px`;
    state.cols = next;
    applyCols(el, next);
  };
  const onUp = (): void => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.classList.remove("col-resizing");
    save(state.key, state.cols);
  };
  document.body.classList.add("col-resizing");
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function bind(el: HTMLElement, binding: DirectiveBinding<string | undefined>): void {
  const defaults = (el.dataset.cols ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!defaults.length) return;
  const key = binding.value || el.dataset.colKey || "anon";
  const cols = load(key, defaults);
  stateByEl.set(el, { key, defaults, cols });
  applyCols(el, cols);
  ensureHandles(el);
}

/** Make a CSS-grid table's columns draggable via handles on the header row. */
export const vColResize: Directive<HTMLElement, string | undefined> = {
  mounted(el, binding) {
    bind(el, binding);
  },
  updated(el, binding) {
    // Vue may recreate header cells (sort arrows); re-attach handles.
    if (!stateByEl.has(el)) bind(el, binding);
    else ensureHandles(el);
  },
  unmounted(el) {
    stateByEl.delete(el);
  },
};
