/** Iterator split — shared by canvas + server runners. */

export type IteratorSplitMode = "lines" | "blocks" | "json";

export type SplitIteratorResult =
  | { ok: true; items: string[] }
  | { ok: false; error: string };

/**
 * Split inbound text into iterator items.
 * Bad JSON arrays fail hard (both runners must agree).
 */
export function splitIteratorItems(
  text: string,
  opts: { splitMode: IteratorSplitMode; maxItems?: number },
): SplitIteratorResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, items: [] };

  let items: string[];
  if (opts.splitMode === "json") {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        return { ok: false, error: "input is not a JSON array" };
      }
      items = parsed.map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
    } catch {
      return { ok: false, error: "input is not a JSON array" };
    }
  } else if (opts.splitMode === "blocks") {
    items = trimmed.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  } else {
    items = trimmed.split("\n").map((s) => s.trim()).filter(Boolean);
  }

  const max = opts.maxItems;
  if (typeof max === "number" && Number.isFinite(max) && max > 0) {
    items = items.slice(0, Math.floor(max));
  }
  return { ok: true, items };
}

export function iteratorIsParallel(mode: string | undefined): boolean {
  return mode === "parallel";
}
