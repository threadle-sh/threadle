import { describe, expect, it } from "vitest";
import {
  coerceValue,
  connectionWithinCapacity,
  edgesDisplacedByConnection,
  graphSchema,
  handleMaxConnections,
  isValidConnection,
  joinAgentPromptTexts,
  portableGraphSchema,
  PORT_UNLIMITED,
  toPortableGraph,
  type Graph,
  type NodeType,
} from "@threadle/shared";

const validGraph: Graph = {
  id: "g1",
  name: "test",
  schemaVersion: 1,
  nodes: [
    {
      id: "n1",
      type: "session",
      position: { x: 0, y: 0 },
      status: "success",
      lastRunId: "job_x",
      data: {
        type: "session",
        ref: { provider: "opencode", sessionId: "ses_x" },
        resolved: true,
      },
    },
    {
      id: "n2",
      type: "prompt",
      position: { x: 10, y: 10 },
      status: "idle",
      data: { type: "prompt", text: "hi" },
    },
  ],
  edges: [{ id: "e1", source: "n2", target: "n1", data: { role: "child" } }],
  createdAt: 1,
  updatedAt: 2,
};

describe("graph schema", () => {
  it("accepts a valid graph", () => {
    expect(graphSchema.safeParse(validGraph).success).toBe(true);
  });

  it("rejects unknown node types and bad edges", () => {
    const bad = structuredClone(validGraph) as unknown as Record<string, unknown>;
    (bad.nodes as Array<{ type: string }>)[0]!.type = "banana";
    expect(graphSchema.safeParse(bad).success).toBe(false);
    expect(graphSchema.safeParse({ ...validGraph, edges: [{ id: "e" }] }).success).toBe(false);
  });

  it("strips runtime state on portable export and validates round-trip", () => {
    const portable = toPortableGraph(validGraph);
    expect(portable.$schema).toBe("threadle/graph@1");
    expect(portable.nodes[0]!.status).toBe("idle");
    expect("lastRunId" in portable.nodes[0]!).toBe(false);
    expect((portable.nodes[0]!.data as { resolved?: boolean }).resolved).toBeUndefined();
    expect(portableGraphSchema.safeParse(portable).success).toBe(true);
  });

  it("clears machine-local refs and keeps params on portable export", () => {
    const g: Graph = {
      ...validGraph,
      kind: "workflow",
      params: [{ name: "task", type: "text", default: "hi" }],
      nodes: [
        {
          id: "s1",
          type: "skill",
          position: { x: 0, y: 0 },
          status: "idle",
          data: {
            type: "skill",
            path: "/Users/me/.config/threadle/skills/custom/review-diff/SKILL.md",
            name: "review-diff",
            origin: "custom",
            source: "threadle custom",
          },
        },
        {
          id: "a1",
          type: "agent-def",
          position: { x: 10, y: 0 },
          status: "idle",
          data: {
            type: "agent-def",
            ref: {
              provider: "claude-code",
              name: "Explore",
              source: "/Users/me/.claude/agents/Explore.md",
            },
          },
        },
        {
          id: "c1",
          type: "context",
          position: { x: 20, y: 0 },
          status: "idle",
          data: {
            type: "context",
            kind: "distilled-summary",
            payloadHash: "deadbeef",
            config: {},
          },
        },
      ],
      edges: [],
    };
    const portable = toPortableGraph(g);
    expect(portable.kind).toBe("workflow");
    expect(portable.params).toEqual([{ name: "task", type: "text", default: "hi" }]);
    const skill = portable.nodes.find((n) => n.id === "s1")!.data;
    expect(skill).toMatchObject({ type: "skill", name: "review-diff", path: "" });
    const agent = portable.nodes.find((n) => n.id === "a1")!.data;
    expect(agent).toMatchObject({
      type: "agent-def",
      ref: { provider: "claude-code", name: "Explore", source: "claude-code:file" },
    });
    const ctx = portable.nodes.find((n) => n.id === "c1")!.data;
    expect(ctx).toMatchObject({ type: "context" });
    expect("payloadHash" in ctx).toBe(false);
    expect(portableGraphSchema.safeParse(portable).success).toBe(true);
  });

  it("defaults missing kind to workflow and preserves subgraph", () => {
    expect(graphSchema.safeParse({ ...validGraph }).success).toBe(true);
    expect(graphSchema.parse({ ...validGraph }).kind).toBe("workflow");
    const sub = graphSchema.parse({ ...validGraph, kind: "subgraph" });
    expect(sub.kind).toBe("subgraph");
    expect(toPortableGraph(sub as Graph).kind).toBe("subgraph");
  });
});

describe("connection rules", () => {
  it("allows the documented pairs and rejects others", () => {
    expect(isValidConnection("prompt", "agent-def")).toBe(true);
    expect(isValidConnection("agent-def", "prompt-convert")).toBe(true);
    expect(isValidConnection("session", "subagent-run")).toBe(true);
    expect(isValidConnection("output", "prompt-convert")).toBe(true);
    expect(isValidConnection("prompt", "live-handoff")).toBe(true);
    expect(isValidConnection("live-handoff", "agent-def")).toBe(true);
    expect(isValidConnection("prompt", "output")).toBe(true);
    expect(isValidConnection("context", "context")).toBe(false);
  });

  it("covers starter + text-lane parity (convert, gates, custom, session text)", () => {
    // starter Plan → Implement uses agent-def → prompt-convert
    expect(isValidConnection("agent-def", "prompt-convert")).toBe(true);
    expect(isValidConnection("prompt-convert", "prompt-convert")).toBe(true);

    // approval ↔ live-handoff
    expect(isValidConnection("approval", "live-handoff")).toBe(true);
    expect(isValidConnection("live-handoff", "approval")).toBe(true);

    // iterator → output
    expect(isValidConnection("iterator", "output")).toBe(true);

    // session / subagent reply text into converters, iterators, custom, agents
    for (const src of ["session", "subagent-run"] as const) {
      for (const tgt of ["prompt-convert", "iterator", "custom", "agent-def", "approval", "live-handoff", "wait-idle", "output"] as const) {
        expect(isValidConnection(src, tgt)).toBe(true);
      }
    }

    // custom / mcp-tool are full text citizens
    expect(isValidConnection("custom", "agent-def")).toBe(true);
    expect(isValidConnection("custom", "session")).toBe(true);
    expect(isValidConnection("prompt", "custom")).toBe(true);
    expect(isValidConnection("custom", "custom")).toBe(true);
    expect(isValidConnection("prompt", "mcp-tool")).toBe(true);
    expect(isValidConnection("mcp-tool", "output")).toBe(true);
    expect(isValidConnection("mcp-tool", "agent-def")).toBe(true);

    // knot + tripwire + judge are text citizens
    expect(isValidConnection("prompt", "knot")).toBe(true);
    expect(isValidConnection("knot", "output")).toBe(true);
    expect(isValidConnection("prompt", "tripwire")).toBe(true);
    expect(isValidConnection("tripwire", "output")).toBe(true);
    expect(isValidConnection("agent-def", "tripwire")).toBe(true);
    expect(isValidConnection("knot", "tripwire")).toBe(true);
    expect(isValidConnection("prompt", "judge")).toBe(true);
    expect(isValidConnection("judge", "output")).toBe(true);
    expect(isValidConnection("agent-def", "judge")).toBe(true);
    expect(isValidConnection("prompt", "wait-idle")).toBe(true);
    expect(isValidConnection("wait-idle", "output")).toBe(true);
    expect(isValidConnection("session", "wait-idle")).toBe(true);
    expect(isValidConnection("prompt", "delay")).toBe(true);
    expect(isValidConnection("delay", "output")).toBe(true);
    expect(isValidConnection("delay", "prompt-convert")).toBe(true);
    expect(isValidConnection("data", "prompt-convert")).toBe(true);
    expect(isValidConnection("prompt", "data")).toBe(true);

    // Data is a typed coerce sink — every text-lane writer may feed it
    for (const src of [
      "custom",
      "prompt",
      "output",
      "prompt-convert",
      "delay",
      "data",
      "approval",
      "live-handoff",
      "wait-idle",
      "iterator",
      "knot",
      "tripwire",
      "judge",
      "agent-def",
      "session",
      "subagent-run",
    ] as const) {
      expect(isValidConnection(src, "data")).toBe(true);
    }

    // annotations never wire via the matrix
    expect(isValidConnection("note", "agent-def")).toBe(false);
    expect(isValidConnection("group", "session")).toBe(false);
    expect(isValidConnection("prompt", "note")).toBe(false);

    // structural context / session lanes
    expect(isValidConnection("session", "context")).toBe(true);
    expect(isValidConnection("agent-def", "context")).toBe(true);
    expect(isValidConnection("context", "session")).toBe(true);

    // rules/context stay non-terminal; skill may wire to output when invoke
    expect(isValidConnection("skill", "output")).toBe(true);
    expect(isValidConnection("prompt", "skill")).toBe(true);
    expect(isValidConnection("rules", "output")).toBe(false);
    expect(isValidConnection("context", "output")).toBe(false);
  });

  it("enforces port capacity (delay 1/1, knot multi-in, custom maxConnections)", () => {
    expect(handleMaxConnections("delay", "target")).toBe(1);
    expect(handleMaxConnections("delay", "source")).toBe(1);
    expect(handleMaxConnections("knot", "target")).toBe(PORT_UNLIMITED);
    expect(handleMaxConnections("knot", "source")).toBe(1);
    expect(handleMaxConnections("judge", "target")).toBe(1);
    expect(handleMaxConnections("judge", "source", "out:pass")).toBe(1);
    expect(handleMaxConnections("judge", "source", "out:fail")).toBe(1);
    expect(handleMaxConnections("judge", "source", "out:unsure")).toBe(1);
    expect(handleMaxConnections("agent-def", "source", "out:err")).toBe(1);
    expect(handleMaxConnections("prompt", "source")).toBe(PORT_UNLIMITED);
    expect(handleMaxConnections("agent-def", "target")).toBe(PORT_UNLIMITED);
    expect(handleMaxConnections("output", "target")).toBe(1);
    expect(handleMaxConnections("output", "source")).toBe(PORT_UNLIMITED);
    expect(
      handleMaxConnections("custom", "target", "in:parts", {
        inputs: [{ name: "parts", type: "text", maxConnections: 4 }],
      }),
    ).toBe(4);
    expect(
      handleMaxConnections("custom", "target", "in:text", {
        inputs: [{ name: "text", type: "text" }],
      }),
    ).toBe(1);

    const edges = [
      { id: "e1", source: "a", target: "d", sourceHandle: null, targetHandle: null },
    ];
    const types: Record<string, NodeType> = {
      a: "prompt",
      b: "prompt",
      d: "delay",
      k: "knot",
      c: "custom",
    };
    const nodeTypeOf = (id: string) => types[id];

    // delay already has one inbound — no free slot without displace
    expect(
      connectionWithinCapacity(
        edges,
        { source: "b", target: "d", sourceHandle: null, targetHandle: null },
        nodeTypeOf,
      ),
    ).toBe(false);
    // new wire displaces the existing one on a full 1-in port
    expect(
      edgesDisplacedByConnection(
        edges,
        { source: "b", target: "d", sourceHandle: null, targetHandle: null },
        nodeTypeOf,
      ),
    ).toEqual(["e1"]);

    // knot accepts many inbounds — nothing to displace
    expect(
      connectionWithinCapacity(
        [{ id: "e1", source: "a", target: "k" }],
        { source: "b", target: "k" },
        nodeTypeOf,
      ),
    ).toBe(true);
    expect(
      edgesDisplacedByConnection(
        [{ id: "e1", source: "a", target: "k" }],
        { source: "b", target: "k" },
        nodeTypeOf,
      ),
    ).toEqual([]);

    // agent-def also accepts many inbounds (prompt + output / convert)
    types.ag = "agent-def";
    expect(
      connectionWithinCapacity(
        [{ id: "e1", source: "a", target: "ag" }],
        { source: "b", target: "ag" },
        nodeTypeOf,
      ),
    ).toBe(true);
    expect(
      edgesDisplacedByConnection(
        [{ id: "e1", source: "a", target: "ag" }],
        { source: "b", target: "ag" },
        nodeTypeOf,
      ),
    ).toEqual([]);

    // custom port with maxConnections: 2 — already full → drop oldest
    const customEdges = [
      { id: "e1", source: "a", target: "c", targetHandle: "in:parts" },
      { id: "e2", source: "b", target: "c", targetHandle: "in:parts" },
    ];
    expect(
      connectionWithinCapacity(
        customEdges,
        { source: "a", target: "c", targetHandle: "in:parts" },
        nodeTypeOf,
        {
          customPorts: () => ({
            inputs: [{ name: "parts", type: "text", maxConnections: 2 }],
          }),
        },
      ),
    ).toBe(false);
    expect(
      edgesDisplacedByConnection(
        customEdges,
        { source: "a", target: "c", targetHandle: "in:parts" },
        nodeTypeOf,
        {
          customPorts: () => ({
            inputs: [{ name: "parts", type: "text", maxConnections: 2 }],
          }),
        },
      ),
    ).toEqual(["e1"]);
  });

  it("joins agent inbound texts with prompt wires first", () => {
    expect(
      joinAgentPromptTexts([
        { sourceType: "output", text: "joke body" },
        { sourceType: "prompt", text: "What do you think?" },
        { sourceType: "prompt-convert", text: "wrapped" },
      ]),
    ).toBe("What do you think?\n\n---\n\nwrapped\n\n---\n\njoke body");
    expect(
      joinAgentPromptTexts([
        { sourceType: "output", text: "ctx" },
        { sourceType: "prompt", text: "ask" },
      ]),
    ).toBe("ask\n\n---\n\nctx");
  });

  it("accepts live-handoff node data", () => {
    const g: Graph = {
      ...validGraph,
      nodes: [
        ...validGraph.nodes,
        {
          id: "lh1",
          type: "live-handoff",
          position: { x: 20, y: 20 },
          status: "idle",
          data: {
            type: "live-handoff",
            handoffKind: "distilled-summary",
            ref: { provider: "claude-code", name: "default", source: "" },
          },
        },
      ],
    };
    expect(graphSchema.safeParse(g).success).toBe(true);
  });

  it("accepts knot, tripwire, and judge node data + settings", () => {
    const g: Graph = {
      ...validGraph,
      settings: { ply: 2, spendTripwireUsd: 1 },
      nodes: [
        {
          id: "k1",
          type: "knot",
          position: { x: 0, y: 0 },
          status: "idle",
          data: { type: "knot", strategy: "majority" },
        },
        {
          id: "t1",
          type: "tripwire",
          position: { x: 1, y: 0 },
          status: "idle",
          data: {
            type: "tripwire",
            mode: "content",
            action: "park",
            pattern: "ERROR",
            tripOnMatch: true,
          },
        },
        {
          id: "j1",
          type: "judge",
          position: { x: 2, y: 0 },
          status: "idle",
          data: {
            type: "judge",
            matchers: [
              { id: "m1", port: "pass", kind: "contains", pattern: "ok" },
            ],
            unmatched: "unsure",
          },
        },
      ],
      edges: [
        { id: "e1", source: "k1", target: "t1" },
        { id: "e2", source: "t1", target: "j1" },
      ],
    };
    expect(graphSchema.safeParse(g).success).toBe(true);
    expect(portableGraphSchema.safeParse(toPortableGraph(g)).success).toBe(true);
  });
});

describe("coerceValue", () => {
  it("normalizes each value type", () => {
    expect(coerceValue("  hi  ", "text")).toEqual({ value: "  hi  " });
    expect(coerceValue("42", "int")).toEqual({ value: "42" });
    expect(coerceValue("3.5", "float")).toEqual({ value: "3.5" });
    expect(coerceValue("1", "bool")).toEqual({ value: "true" });
    expect(coerceValue('{"a":1}', "json")).toEqual({ value: '{"a":1}' });
    expect(coerceValue("```json\n{\"a\":1}\n```", "json")).toEqual({ value: '{"a":1}' });
  });

  it("rejects bad shapes", () => {
    expect(coerceValue("3.5", "int")).toMatchObject({ error: expect.stringMatching(/int/) });
    expect(coerceValue("nope", "json")).toMatchObject({ error: expect.stringMatching(/JSON/) });
  });
});
