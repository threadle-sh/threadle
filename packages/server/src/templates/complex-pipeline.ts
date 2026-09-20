import crypto from "node:crypto";
import type { Graph, GraphEdge, GraphNode, PortableGraph } from "@threadle/shared";

export const COMPLEX_PIPELINE_ID = "complex-delay-pipeline";

type NodeIn = PortableGraph["nodes"][number];
type EdgeIn = PortableGraph["edges"][number];

function note(
  id: string,
  x: number,
  y: number,
  text: string,
  w = 360,
  h = 120,
): NodeIn {
  return {
    id,
    type: "note",
    position: { x, y },
    status: "idle",
    data: { type: "note", text, size: { width: w, height: h } },
  };
}

/** One subgraph stage — prompt/convert + delays only (no agents). */
function stageGraph(
  name: string,
  nodes: NodeIn[],
  edges: EdgeIn[],
): PortableGraph {
  return {
    $schema: "threadle/graph@1",
    name,
    kind: "subgraph",
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** 1 · Intake — stamp the kickoff, wait. */
export const SG_INTAKE = stageGraph(
  "Sub · Intake",
  [
    {
      id: "in-tag",
      type: "prompt-convert",
      position: { x: 40, y: 40 },
      status: "idle",
      data: {
        type: "prompt-convert",
        template: "## Intake\n\nTopic received:\n\n{{input}}\n\n_status: queued for normalize_",
      },
    },
    {
      id: "in-d1",
      type: "delay",
      position: { x: 320, y: 40 },
      status: "idle",
      data: { type: "delay", ms: 2_000, label: "settle 2s" },
    },
    {
      id: "in-mark",
      type: "prompt-convert",
      position: { x: 600, y: 40 },
      status: "idle",
      data: {
        type: "prompt-convert",
        template: "{{input}}\n\n[intake ✓]",
      },
    },
    {
      id: "in-d2",
      type: "delay",
      position: { x: 880, y: 40 },
      status: "idle",
      data: { type: "delay", ms: 1_500, label: "hand-off 1.5s" },
    },
  ],
  [
    { id: "e1", source: "in-tag", target: "in-d1" },
    { id: "e2", source: "in-d1", target: "in-mark" },
    { id: "e3", source: "in-mark", target: "in-d2" },
  ],
);

/** 2 · Normalize — reshape text, another pause. */
export const SG_NORMALIZE = stageGraph(
  "Sub · Normalize",
  [
    {
      id: "nm-shape",
      type: "prompt-convert",
      position: { x: 40, y: 40 },
      status: "idle",
      data: {
        type: "prompt-convert",
        template:
          "NORMALIZE\n---------\n{{input}}\n---------\nchecksum: {{param:runId}}\nready: true",
      },
    },
    {
      id: "nm-d1",
      type: "delay",
      position: { x: 320, y: 40 },
      status: "idle",
      data: { type: "delay", ms: 2_000, label: "normalize 2s" },
    },
    {
      id: "nm-stamp",
      type: "prompt-convert",
      position: { x: 600, y: 40 },
      status: "idle",
      data: {
        type: "prompt-convert",
        template: "{{input}}\n\n[normalize ✓]",
      },
    },
  ],
  [
    { id: "e1", source: "nm-shape", target: "nm-d1" },
    { id: "e2", source: "nm-d1", target: "nm-stamp" },
  ],
);

/** 3 · Fast lane — short path. */
export const SG_FAST = stageGraph(
  "Sub · Fast lane",
  [
    {
      id: "fa-tag",
      type: "prompt-convert",
      position: { x: 40, y: 40 },
      status: "idle",
      data: {
        type: "prompt-convert",
        template: "### Fast lane\n\n{{input}}\n\n_latency: low_",
      },
    },
    {
      id: "fa-d1",
      type: "delay",
      position: { x: 320, y: 40 },
      status: "idle",
      data: { type: "delay", ms: 3_000, label: "fast 3s" },
    },
  ],
  [
    { id: "e1", source: "fa-tag", target: "fa-d1" },
  ],
);

/** 4 · Deep lane — longer simulated work. */
export const SG_DEEP = stageGraph(
  "Sub · Deep lane",
  [
    {
      id: "dp-tag",
      type: "prompt-convert",
      position: { x: 40, y: 40 },
      status: "idle",
      data: {
        type: "prompt-convert",
        template: "### Deep lane\n\n{{input}}\n\n_latency: high · digging…_",
      },
    },
    {
      id: "dp-d1",
      type: "delay",
      position: { x: 320, y: 40 },
      status: "idle",
      data: { type: "delay", ms: 4_000, label: "deep 4s" },
    },
    {
      id: "dp-more",
      type: "prompt-convert",
      position: { x: 600, y: 40 },
      status: "idle",
      data: {
        type: "prompt-convert",
        template: "{{input}}\n\nfindings: simulated deep scan complete",
      },
    },
    {
      id: "dp-d2",
      type: "delay",
      position: { x: 880, y: 40 },
      status: "idle",
      data: { type: "delay", ms: 2_500, label: "wrap 2.5s" },
    },
  ],
  [
    { id: "e1", source: "dp-tag", target: "dp-d1" },
    { id: "e2", source: "dp-d1", target: "dp-more" },
    { id: "e3", source: "dp-more", target: "dp-d2" },
  ],
);

/** 5 · Assemble — merge result into a final packet. */
export const SG_ASSEMBLE = stageGraph(
  "Sub · Assemble",
  [
    {
      id: "as-pack",
      type: "prompt-convert",
      position: { x: 40, y: 40 },
      status: "idle",
      data: {
        type: "prompt-convert",
        template:
          "# Pipeline result\n\n{{input}}\n\n---\nassembled at {{param:runId}} · topic={{param:topic}}",
      },
    },
    {
      id: "as-d1",
      type: "delay",
      position: { x: 320, y: 40 },
      status: "idle",
      data: { type: "delay", ms: 2_000, label: "assemble 2s" },
    },
    {
      id: "as-seal",
      type: "prompt-convert",
      position: { x: 600, y: 40 },
      status: "idle",
      data: {
        type: "prompt-convert",
        template: "{{input}}\n\n**seal:** ok",
      },
    },
    {
      id: "as-d2",
      type: "delay",
      position: { x: 880, y: 40 },
      status: "idle",
      data: { type: "delay", ms: 1_000, label: "seal 1s" },
    },
  ],
  [
    { id: "e1", source: "as-pack", target: "as-d1" },
    { id: "e2", source: "as-d1", target: "as-seal" },
    { id: "e3", source: "as-seal", target: "as-d2" },
  ],
);

export const COMPLEX_PIPELINE_SUBGRAPHS: PortableGraph[] = [
  SG_INTAKE,
  SG_NORMALIZE,
  SG_FAST,
  SG_DEEP,
  SG_ASSEMBLE,
];

function newId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * Embed a saved subgraph into a parent: linked group frame + inlined members
 * (same shape the canvas `importSubgraph` produces).
 */
function embed(
  sg: Graph,
  at: { x: number; y: number },
  frameId: string,
): { frame: GraphNode; members: GraphNode[]; edges: GraphEdge[] } {
  const inner = sg.nodes.filter((n) => n.data.type !== "group" && n.data.type !== "note");
  const minX = Math.min(...inner.map((n) => n.position.x));
  const minY = Math.min(...inner.map((n) => n.position.y));
  const idMap = new Map<string, string>();
  const members: GraphNode[] = inner.map((n) => {
    const id = newId();
    idMap.set(n.id, id);
    return {
      id,
      type: n.type,
      position: {
        x: at.x + (n.position.x - minX),
        y: at.y + (n.position.y - minY),
      },
      status: "idle" as const,
      data: structuredClone(n.data),
      subOf: frameId,
      originId: n.id,
    };
  });
  const maxX = Math.max(...members.map((n) => n.position.x)) + 220;
  const maxY = Math.max(...members.map((n) => n.position.y)) + 90;
  const PAD = 40;
  const frame: GraphNode = {
    id: frameId,
    type: "group",
    position: { x: at.x - PAD, y: at.y - PAD - 12 },
    status: "idle",
    data: {
      type: "group",
      label: sg.name.replace(/^Sub\s*·\s*/i, ""),
      color: "blue",
      size: {
        width: Math.max(280, maxX - at.x + PAD * 2),
        height: Math.max(140, maxY - at.y + PAD * 2 + 12),
      },
      graphId: sg.id,
    },
  };
  const edges: GraphEdge[] = sg.edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({
      id: newId(),
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
      data: e.data,
    }));
  return { frame, members, edges };
}

async function materializeSubgraph(portable: PortableGraph): Promise<Graph> {
  const { createGraph, saveGraph } = await import("../graphs/store.js");
  const g = await createGraph(portable.name, { kind: "subgraph" });
  g.kind = "subgraph";
  g.nodes = portable.nodes.map((n) => ({
    ...structuredClone(n),
    status: "idle" as const,
  })) as GraphNode[];
  g.edges = portable.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    data: e.data,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
  }));
  g.viewport = portable.viewport;
  g.params = portable.params?.map((p) => ({ ...p }));
  return saveGraph(g);
}

/**
 * Create 5 linked subgraphs + parent workflow. Returns the parent.
 * Used by **Workflows → examples → use** for `complex-delay-pipeline`.
 */
export async function seedComplexDelayPipeline(): Promise<Graph> {
  const { createGraph, saveGraph } = await import("../graphs/store.js");
  const seeded = await Promise.all(
    COMPLEX_PIPELINE_SUBGRAPHS.map((sg) => materializeSubgraph(sg)),
  );
  const [intake, normalize, fast, deep, assemble] = seeded;
  if (!intake || !normalize || !fast || !deep || !assemble) {
    throw new Error("failed to materialize complex-pipeline subgraphs");
  }

  const parent = await createGraph("Example · Complex delay pipeline", {
    kind: "workflow",
  });
  parent.kind = "workflow";
  parent.params = [
    {
      name: "topic",
      type: "text",
      default: "ship the subgraph demo",
      description: "What the pipeline pretends to process",
    },
    {
      name: "runId",
      type: "text",
      default: "run-local",
      description: "Stamp written into normalize / assemble",
    },
  ];
  parent.settings = { ply: 2 };
  parent.viewport = { x: 0, y: 40, zoom: 0.55 };

  const fIntake = newId();
  const fNorm = newId();
  const fFast = newId();
  const fDeep = newId();
  const fAsm = newId();

  // Generous spacing — 4-node chains are ~1200px wide after arrange
  const COL = 1280;
  const ROW = 280;
  const e1 = embed(intake, { x: 360, y: 280 }, fIntake);
  const e2 = embed(normalize, { x: 360 + COL, y: 280 }, fNorm);
  const e3 = embed(fast, { x: 360 + COL * 2, y: 120 }, fFast);
  const e4 = embed(deep, { x: 360 + COL * 2, y: 120 + ROW }, fDeep);
  const e5 = embed(assemble, { x: 360 + COL * 3 + 200, y: 280 }, fAsm);

  const kickId = newId();
  const knotId = newId();
  const twId = newId();
  const gateId = newId();
  const outId = newId();
  const noteId = newId();

  parent.nodes = [
    {
      id: noteId,
      type: "note",
      position: { x: 40, y: 40 },
      status: "idle",
      data: {
        type: "note",
        text:
          "COMPLEX DELAY PIPELINE — no agents.\n\n" +
          "Five linked subgraphs: Intake → Normalize → Fast∥Deep → Assemble.\n" +
          "Delays simulate work (~20s wall with parallelism=2). Open any ▦ frame to edit the subgraph.\n\n" +
          "Right-click → ⊡ cleanup arrangement if frames look stacked.\n" +
          "Run: ▶ or `threadle run complex-delay-pipeline --approve-all`",
        size: { width: 480, height: 180 },
      },
    },
    {
      id: kickId,
      type: "prompt",
      position: { x: 80, y: 320 },
      status: "idle",
      data: {
        type: "prompt",
        label: "kickoff",
        text: "Pipeline topic: {{param:topic}}",
      },
    },
    e1.frame,
    ...e1.members,
    e2.frame,
    ...e2.members,
    e3.frame,
    ...e3.members,
    e4.frame,
    ...e4.members,
    {
      id: knotId,
      type: "knot",
      position: { x: 360 + COL * 3, y: 320 },
      status: "idle",
      data: { type: "knot", strategy: "concat", label: "join lanes" },
    },
    e5.frame,
    ...e5.members,
    {
      id: twId,
      type: "tripwire",
      position: { x: 360 + COL * 4 + 200, y: 320 },
      status: "idle",
      data: {
        type: "tripwire",
        mode: "content",
        action: "park",
        label: "thin packet?",
        minChars: 40,
      },
    },
    {
      id: gateId,
      type: "approval",
      position: { x: 360 + COL * 4 + 480, y: 320 },
      status: "idle",
      data: { type: "approval", label: "accept packet?" },
    },
    {
      id: outId,
      type: "output",
      position: { x: 360 + COL * 4 + 760, y: 320 },
      status: "idle",
      data: { type: "output", renderMode: "markdown" },
    },
  ];

  parent.edges = [
    { id: newId(), source: kickId, target: fIntake },
    { id: newId(), source: fIntake, target: fNorm },
    { id: newId(), source: fNorm, target: fFast },
    { id: newId(), source: fNorm, target: fDeep },
    { id: newId(), source: fFast, target: knotId },
    { id: newId(), source: fDeep, target: knotId },
    { id: newId(), source: knotId, target: fAsm },
    { id: newId(), source: fAsm, target: twId },
    { id: newId(), source: twId, target: gateId },
    { id: newId(), source: gateId, target: outId },
    ...e1.edges,
    ...e2.edges,
    ...e3.edges,
    ...e4.edges,
    ...e5.edges,
  ];

  return saveGraph(parent);
}

/**
 * Flattened portable parent for CLI `threadle run complex-delay-pipeline`
 * (members inlined; graphIds are placeholders so frame wires still expand).
 */
export function buildComplexPipelinePortable(): PortableGraph {
  // Deterministic ids so the portable file is stable across builds.
  const ids = {
    note: "n-note",
    kick: "n-kick",
    fIn: "f-intake",
    fNm: "f-normalize",
    fFa: "f-fast",
    fDp: "f-deep",
    knot: "n-knot",
    fAs: "f-assemble",
    tw: "n-tw",
    gate: "n-gate",
    out: "n-out",
  };

  function inline(
    sg: PortableGraph,
    frameId: string,
    at: { x: number; y: number },
    linkToken: string,
  ): { nodes: NodeIn[]; edges: EdgeIn[] } {
    const inner = sg.nodes.filter((n) => n.data.type !== "group" && n.data.type !== "note");
    const minX = Math.min(...inner.map((n) => n.position.x));
    const minY = Math.min(...inner.map((n) => n.position.y));
    const idMap = new Map<string, string>();
    const members: NodeIn[] = inner.map((n) => {
      const id = `${frameId}:${n.id}`;
      idMap.set(n.id, id);
      return {
        id,
        type: n.type,
        position: {
          x: at.x + (n.position.x - minX),
          y: at.y + (n.position.y - minY),
        },
        status: "idle" as const,
        data: structuredClone(n.data),
        subOf: frameId,
        originId: n.id,
      };
    });
    const maxX = Math.max(...members.map((n) => n.position.x)) + 220;
    const maxY = Math.max(...members.map((n) => n.position.y)) + 90;
    const PAD = 40;
    const frame: NodeIn = {
      id: frameId,
      type: "group",
      position: { x: at.x - PAD, y: at.y - PAD - 12 },
      status: "idle",
      data: {
        type: "group",
        label: sg.name.replace(/^Sub\s*·\s*/i, ""),
        color: "blue",
        size: {
          width: Math.max(280, maxX - at.x + PAD * 2),
          height: Math.max(140, maxY - at.y + PAD * 2 + 12),
        },
        // Placeholder so expandFrameEdges treats this as a linked frame.
        graphId: linkToken,
      },
    };
    const edges: EdgeIn[] = sg.edges
      .filter((e) => idMap.has(e.source) && idMap.has(e.target))
      .map((e, i) => ({
        id: `${frameId}-e${i}`,
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
      }));
    return { nodes: [frame, ...members], edges };
  }

  const COL = 1280;
  const ROW = 280;
  const a = inline(SG_INTAKE, ids.fIn, { x: 360, y: 280 }, "sg:intake");
  const b = inline(SG_NORMALIZE, ids.fNm, { x: 360 + COL, y: 280 }, "sg:normalize");
  const c = inline(SG_FAST, ids.fFa, { x: 360 + COL * 2, y: 120 }, "sg:fast");
  const d = inline(SG_DEEP, ids.fDp, { x: 360 + COL * 2, y: 120 + ROW }, "sg:deep");
  const e = inline(SG_ASSEMBLE, ids.fAs, { x: 360 + COL * 3 + 200, y: 280 }, "sg:assemble");

  return {
    $schema: "threadle/graph@1",
    name: "Example · Complex delay pipeline",
    kind: "workflow",
    params: [
      {
        name: "topic",
        type: "text",
        default: "ship the subgraph demo",
        description: "What the pipeline pretends to process",
      },
      {
        name: "runId",
        type: "text",
        default: "run-local",
        description: "Stamp written into normalize / assemble",
      },
    ],
    settings: { ply: 2 },
    viewport: { x: 0, y: 40, zoom: 0.45 },
    nodes: [
      note(
        ids.note,
        40,
        40,
        "COMPLEX DELAY PIPELINE — no agents.\n\n" +
          "Five subgraphs: Intake → Normalize → Fast∥Deep → Assemble.\n" +
          "In the app: right-click → ⊡ cleanup arrangement if frames look stacked.\n\n" +
          "~20s wall clock with parallelism=2. Pass --approve-all for the final gate.",
        480,
        160,
      ),
      {
        id: ids.kick,
        type: "prompt",
        position: { x: 80, y: 320 },
        status: "idle",
        data: {
          type: "prompt",
          label: "kickoff",
          text: "Pipeline topic: {{param:topic}}",
        },
      },
      ...a.nodes,
      ...b.nodes,
      ...c.nodes,
      ...d.nodes,
      {
        id: ids.knot,
        type: "knot",
        position: { x: 360 + COL * 3, y: 320 },
        status: "idle",
        data: { type: "knot", strategy: "concat", label: "join lanes" },
      },
      ...e.nodes,
      {
        id: ids.tw,
        type: "tripwire",
        position: { x: 360 + COL * 4 + 200, y: 320 },
        status: "idle",
        data: {
          type: "tripwire",
          mode: "content",
          action: "park",
          label: "thin packet?",
          minChars: 40,
        },
      },
      {
        id: ids.gate,
        type: "approval",
        position: { x: 360 + COL * 4 + 480, y: 320 },
        status: "idle",
        data: { type: "approval", label: "accept packet?" },
      },
      {
        id: ids.out,
        type: "output",
        position: { x: 360 + COL * 4 + 760, y: 320 },
        status: "idle",
        data: { type: "output", renderMode: "markdown" },
      },
    ],
    edges: [
      { id: "e-kick", source: ids.kick, target: ids.fIn },
      { id: "e-in-nm", source: ids.fIn, target: ids.fNm },
      { id: "e-nm-fa", source: ids.fNm, target: ids.fFa },
      { id: "e-nm-dp", source: ids.fNm, target: ids.fDp },
      { id: "e-fa-k", source: ids.fFa, target: ids.knot },
      { id: "e-dp-k", source: ids.fDp, target: ids.knot },
      { id: "e-k-as", source: ids.knot, target: ids.fAs },
      { id: "e-as-tw", source: ids.fAs, target: ids.tw },
      { id: "e-tw-g", source: ids.tw, target: ids.gate },
      { id: "e-g-out", source: ids.gate, target: ids.out },
      ...a.edges,
      ...b.edges,
      ...c.edges,
      ...d.edges,
      ...e.edges,
    ],
  };
}
