/**
 * Best-effort context window: model-id hint, then bumped to the smallest
 * standard window that fits the observed peak (the peak never lies).
 */
export function estimateContextWindow(model: string | undefined, peak: number): number {
  const m = (model ?? "").toLowerCase();
  let win = 200_000;
  if (m.includes("[1m]") || m.includes("gemini") || /\b1m\b/.test(m)) win = 1_000_000;
  if (peak > win) {
    win =
      [500_000, 1_000_000, 2_000_000, 10_000_000].find((std) => std >= peak) ?? peak;
  }
  return win;
}
