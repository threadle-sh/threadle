/** Merge — first-class fan-in of multiple inbound text wires (graph JSON type remains `knot`). */

export type KnotStrategy = "concat" | "first" | "majority" | "synthesize";

export const KNOT_STRATEGIES: readonly KnotStrategy[] = [
  "concat",
  "first",
  "majority",
  "synthesize",
] as const;

/**
 * Local merge strategies (no LLM). `synthesize` returns labeled concat
 * suitable as a prompt body — callers that support LLM replace this.
 */
export function mergeKnotTexts(
  texts: string[],
  strategy: KnotStrategy,
  opts?: { separator?: string },
): string {
  const cleaned = texts.map((t) => t.trim()).filter(Boolean);
  if (!cleaned.length) return "";
  if (strategy === "first") return cleaned[0]!;
  if (strategy === "majority") {
    const counts = new Map<string, { n: number; t: string }>();
    for (const t of cleaned) {
      const cur = counts.get(t);
      if (cur) cur.n++;
      else counts.set(t, { n: 1, t });
    }
    return [...counts.values()].sort((a, b) => b.n - a.n || b.t.length - a.t.length)[0]!.t;
  }
  const sep = opts?.separator ?? "\n\n---\n\n";
  if (strategy === "synthesize") {
    return cleaned
      .map((t, i) => `### candidate ${i + 1}\n\n${t}`)
      .join("\n\n")
      .concat(
        "\n\n---\n\nSynthesize the candidates above into one coherent result. Prefer agreement; note conflicts briefly.",
      );
  }
  return cleaned.join(sep);
}
