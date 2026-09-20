import type { GraphEdge, GraphNode } from "@threadle/shared";

export interface GraphClipboardOptions {
  /** Currently selected Vue Flow node ids (frame members expanded by the composable). */
  getSelectedNodeIds: () => string[];
  hasGraph: () => boolean;
  getNodes: () => GraphNode[];
  getEdges: () => GraphEdge[];
  addNode: (node: GraphNode) => void;
  addEdge: (edge: GraphEdge) => void;
  rebuildCanvas: () => void;
}

export function useGraphClipboard(opts: GraphClipboardOptions): {
  hasClipboard: () => boolean;
  copySelection: () => void;
  pasteClipboard: () => void;
  duplicateSelection: () => void;
} {
  let clipboard: { nodes: GraphNode[]; edges: GraphEdge[] } | undefined;
  let pasteCount = 0;

  function hasClipboard(): boolean {
    return !!clipboard;
  }

  function copySelection(): void {
    const sel = new Set(opts.getSelectedNodeIds());
    if (!sel.size || !opts.hasGraph()) return;
    const nodes = opts.getNodes();
    // a selected frame implies its members
    for (const n of nodes) {
      if (n.subOf && sel.has(n.subOf)) sel.add(n.id);
    }
    clipboard = {
      nodes: nodes
        .filter((n) => sel.has(n.id))
        .map((n) => JSON.parse(JSON.stringify(n)) as GraphNode),
      edges: opts
        .getEdges()
        .filter((e) => sel.has(e.source) && sel.has(e.target))
        .map((e) => JSON.parse(JSON.stringify(e)) as GraphEdge),
    };
    pasteCount = 0;
  }

  function pasteClipboard(): void {
    if (!clipboard || !opts.hasGraph()) return;
    pasteCount += 1;
    const off = 40 * pasteCount;
    const idMap = new Map<string, string>();
    const fresh: GraphNode[] = clipboard.nodes.map((n) => {
      const id = crypto.randomUUID().slice(0, 8);
      idMap.set(n.id, id);
      return {
        ...(JSON.parse(JSON.stringify(n)) as GraphNode),
        id,
        position: { x: n.position.x + off, y: n.position.y + off },
        status: "idle",
        lastRunId: undefined,
      };
    });
    for (const n of fresh) {
      // remap frame membership; drop it if the frame wasn't part of the copy
      if (n.subOf) n.subOf = idMap.get(n.subOf);
      if (!n.subOf) delete n.subOf;
      opts.addNode(n);
    }
    for (const e of clipboard.edges) {
      opts.addEdge({
        ...(JSON.parse(JSON.stringify(e)) as GraphEdge),
        id: crypto.randomUUID().slice(0, 8),
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
      });
    }
    opts.rebuildCanvas();
  }

  function duplicateSelection(): void {
    copySelection();
    pasteClipboard();
    clipboard = undefined;
  }

  return {
    hasClipboard,
    copySelection,
    pasteClipboard,
    duplicateSelection,
  };
}
