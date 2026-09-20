import { onUnmounted, ref } from "vue";

/**
 * Drag-to-resize for bottom-docked panels (grip on the panel's top edge).
 * Height is persisted per storageKey.
 */
export function useVerticalResize(
  storageKey: string,
  initial: number,
  min: number,
  max: number,
) {
  const stored = Number(localStorage.getItem(storageKey));
  const height = ref(
    Number.isFinite(stored) && stored >= min && stored <= max ? stored : initial,
  );

  let startY = 0;
  let startHeight = 0;

  function clampMax(): number {
    if (typeof window === "undefined") return max;
    return Math.min(max, Math.floor(window.innerHeight * 0.7));
  }

  function onMove(e: MouseEvent): void {
    // bottom-docked: dragging up grows it
    const delta = startY - e.clientY;
    height.value = Math.min(clampMax(), Math.max(min, startHeight + delta));
  }

  function onUp(): void {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    localStorage.setItem(storageKey, String(height.value));
  }

  function startDrag(e: MouseEvent): void {
    startY = e.clientY;
    startHeight = height.value;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }

  onUnmounted(onUp);

  /** snap back to the default height (double-click on the grip) */
  function resetHeight(): void {
    height.value = initial;
    localStorage.setItem(storageKey, String(initial));
  }

  return { height, startDrag, resetHeight };
}
