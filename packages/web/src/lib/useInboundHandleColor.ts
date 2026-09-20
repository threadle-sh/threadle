import { computed, toValue, type MaybeRefOrGetter } from "vue";
import {
  handleMaxConnections,
  type CustomPortDef,
} from "@threadle/shared";
import { useGraphStore } from "@/stores/graph";
import { useCustomNodes } from "@/stores/custom-nodes";
import { wireColorForSource, WIRE_NEUTRAL } from "@/lib/wireColors";

function sameHandle(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return (a ?? null) === (b ?? null);
}

/**
 * Border color for an input connector: matches the single inbound wire's
 * source color. Multi-capacity ports (and empty ports) stay neutral/white.
 */
export function useInboundHandleColor(
  nodeId: MaybeRefOrGetter<string>,
  handleId?: MaybeRefOrGetter<string | null | undefined>,
) {
  const store = useGraphStore();
  const customNodes = useCustomNodes();

  return computed(() => {
    const id = toValue(nodeId);
    const hid = toValue(handleId) ?? null;
    const n = store.nodeById(id);
    if (!n) return WIRE_NEUTRAL;

    let ports: { inputs?: CustomPortDef[]; outputs?: CustomPortDef[] } | undefined;
    const data = n.data;
    if (data.type === "custom") {
      const live = customNodes.defs.find((d) => d.name === data.ref.name);
      ports = {
        inputs: live?.inputs ?? data.snapshot?.inputs,
        outputs: live?.outputs ?? data.snapshot?.outputs,
      };
    }

    const max = handleMaxConnections(data.type, "target", hid, ports);
    if (!Number.isFinite(max) || max > 1) {
      return WIRE_NEUTRAL;
    }

    const inbound = (store.graph?.edges ?? []).filter(
      (e) => e.target === id && sameHandle(e.targetHandle, hid),
    );
    if (inbound.length !== 1) return WIRE_NEUTRAL;

    const src = store.nodeById(inbound[0]!.source);
    if (!src) return WIRE_NEUTRAL;
    return wireColorForSource(src.data);
  });
}
