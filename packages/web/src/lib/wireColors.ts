import type { GraphNodeData } from "@threadle/shared";
import { wireColorForType } from "@threadle/shared";
import { providerColor } from "@/lib/providers";

/** CSS color for a node's outbound wire (by type / provider). */
export function wireColorForSource(data: GraphNodeData): string {
  const c = wireColorForType(data.type);
  if (c === "provider") {
    if (
      data.type === "session" ||
      data.type === "subagent-run" ||
      data.type === "agent-def"
    ) {
      return providerColor(data.ref.provider);
    }
    return "var(--accent)";
  }
  return c;
}

/** Neutral port color — unused or multi-in connectors. */
export const WIRE_NEUTRAL = "var(--accent)";
