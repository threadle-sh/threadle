import { onUnmounted, ref } from "vue";

/**
 * Drag-to-resize for right-docked panels (grip on the panel's left edge).
 * Width is persisted per storageKey.
 */
export function useHorizontalResize(
  storageKey: string,
  initial: number,
  min: number,
  max: number,
  dock: "left" | "right" = "right",
) {
  const stored = Number(localStorage.getItem(storageKey));
  const width = ref(
    Number.isFinite(stored) && stored >= min && stored <= max ? stored : initial,
  );

  let startX = 0;
  let startWidth = 0;

  function onMove(e: MouseEvent): void {
    // right-docked: dragging left grows it; left-docked: dragging right grows it
    const delta = dock === "right" ? startX - e.clientX : e.clientX - startX;
    width.value = Math.min(max, Math.max(min, startWidth + delta));
  }

  function onUp(): void {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    localStorage.setItem(storageKey, String(width.value));
  }

  function startDrag(e: MouseEvent): void {
    startX = e.clientX;
    startWidth = width.value;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }

  onUnmounted(onUp);

  /** snap back to the default width (double-click on the grip) */
  function resetWidth(): void {
    width.value = initial;
    localStorage.setItem(storageKey, String(initial));
  }

  return { width, startDrag, resetWidth };
}
