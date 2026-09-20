import type { PortableGraph } from "@threadle/shared";
import {
  buildComplexPipelinePortable,
  COMPLEX_PIPELINE_ID,
} from "./complex-pipeline.js";

export type ExampleLevel = "beginner" | "intermediate" | "advanced" | "expert";

export interface WorkflowTemplateMeta {
  id: string;
  name: string;
  description: string;
  level: ExampleLevel;
  /** short tags for the examples table */
  teaches: string[];
  graph: PortableGraph;
}

type NodeIn = PortableGraph["nodes"][number];
type EdgeIn = PortableGraph["edges"][number];

function graph(
  name: string,
  nodes: NodeIn[],
  edges: EdgeIn[],
  extra?: Partial<Pick<PortableGraph, "params" | "settings" | "viewport">>,
): PortableGraph {
  return {
    $schema: "threadle/graph@1",
    name,
    kind: "workflow",
    nodes,
    edges,
    viewport: extra?.viewport ?? { x: 0, y: 0, zoom: 0.9 },
    params: extra?.params,
    settings: extra?.settings,
  };
}

function note(
  id: string,
  x: number,
  y: number,
  text: string,
  w = 280,
  h = 100,
): NodeIn {
  return {
    id,
    type: "note",
    position: { x, y },
    status: "idle",
    data: { type: "note", text, size: { width: w, height: h } },
  };
}

/** Beginner — wire text without an agent. */
export const HELLO_WIRE: PortableGraph = graph(
  "Example · Hello wire",
  [
    note(
      "n-note",
      40,
      40,
      "Beginner: a prompt feeds an output. Press ▶ Run — no agent required. Drag a new wire from the right handle to extend the chain.",
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 180 },
      status: "idle",
      data: {
        type: "prompt",
        label: "say hello",
        text: "Hello from threadle — edit this prompt, then run.",
      },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 360, y: 180 },
      status: "idle",
      data: { type: "output", renderMode: "text" },
    },
  ],
  [{ id: "e1", source: "n-prompt", target: "n-out" }],
);

/** Beginner — agent-free ~60s wait for detached jobs / CLI logs. */
export const DETACHED_DELAY: PortableGraph = graph(
  "Example · Detached delay",
  [
    note(
      "n-note",
      40,
      20,
      "Intermediate: no agents — a ◷ Delay waits ~60s. Run with ▶ or ≫ (or `threadle run detached-delay --detach`). While it runs, check the terminal:\n\n  threadle jobs\n  threadle attach <jobId>\n\nClose the browser; reopen the workflow later — the output still appears.",
      420,
      140,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 220 },
      status: "idle",
      data: {
        type: "prompt",
        label: "kickoff",
        text: "Detached delay demo — started. Check threadle jobs / logs in another terminal.",
      },
    },
    {
      id: "n-delay",
      type: "delay",
      position: { x: 360, y: 220 },
      status: "idle",
      data: { type: "delay", ms: 60_000 },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 620, y: 220 },
      status: "idle",
      data: { type: "output", renderMode: "text" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-delay" },
    { id: "e2", source: "n-delay", target: "n-out" },
  ],
);

/** Intermediate — prompt → ◈ MCP tool (echo) → output. Needs local .mcp.json. */
export const HELLO_MCP: PortableGraph = graph(
  "Example · Hello MCP",
  [
    note(
      "n-note",
      40,
      20,
      "Intermediate: canvas as MCP client. Copy examples/mcp/mcp.json.echo.example → repo-root .mcp.json, then ▶ Run. Prompt text fills the echo tool’s `message` arg via argPort.",
      420,
      120,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 200 },
      status: "idle",
      data: {
        type: "prompt",
        label: "message",
        text: "Hello from threadle via MCP",
      },
    },
    {
      id: "n-mcp",
      type: "mcp-tool",
      position: { x: 360, y: 200 },
      status: "idle",
      data: {
        type: "mcp-tool",
        ref: { server: "echo" },
        tool: "echo",
        argPort: "message",
        snapshot: {
          serverLabel: "echo",
          toolDescription: "Return the message unchanged (demo for threadle MCP tool nodes)",
          params: [{ name: "message", type: "text", description: "Text to echo back" }],
        },
      },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 680, y: 200 },
      status: "idle",
      data: { type: "output", renderMode: "text" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-mcp" },
    { id: "e2", source: "n-mcp", target: "n-out" },
  ],
);

/** Intermediate — ◈ MCP tool with inspector params only (no argPort). */
export const HELLO_MCP_PARAMS: PortableGraph = graph(
  "Example · Hello MCP params",
  [
    note(
      "n-note",
      40,
      20,
      "Intermediate: same echo server as Hello MCP, but `message` is set in the inspector — no argPort, no inbound wire. Contrast with hello-mcp (prompt → argPort).",
      440,
      110,
    ),
    {
      id: "n-mcp",
      type: "mcp-tool",
      position: { x: 40, y: 200 },
      status: "idle",
      data: {
        type: "mcp-tool",
        label: "echo (inspector)",
        ref: { server: "echo" },
        tool: "echo",
        params: { message: "Hello from inspector params — no wire" },
        snapshot: {
          serverLabel: "echo",
          toolDescription: "Return the message unchanged (demo for threadle MCP tool nodes)",
          params: [{ name: "message", type: "text", description: "Text to echo back" }],
        },
      },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 360, y: 200 },
      status: "idle",
      data: { type: "output", renderMode: "text" },
    },
  ],
  [{ id: "e1", source: "n-mcp", target: "n-out" }],
);

/** Advanced — MCP echo → convert → agent → output. Needs echo + agent CLI. */
export const MCP_THEN_AGENT: PortableGraph = graph(
  "Example · MCP then agent",
  [
    note(
      "n-note",
      40,
      20,
      "Advanced: ◈ MCP echo returns a tool payload → Text→Prompt wraps it → agent summarizes → output. Needs echo `.mcp.json` plus Cursor ask (or swap). Pick a model on the agent (◇). Swap server/tool for a real MCP.",
      480,
      120,
    ),
    {
      id: "n-mcp",
      type: "mcp-tool",
      position: { x: 40, y: 200 },
      status: "idle",
      data: {
        type: "mcp-tool",
        label: "echo (tool result)",
        ref: { server: "echo" },
        tool: "echo",
        params: {
          message:
            "threadle MCP tool nodes call one discovered MCP server tool from the canvas; inbound text can fill an argPort, and the tool reply continues on the text lane.",
        },
        snapshot: {
          serverLabel: "echo",
          toolDescription: "Return the message unchanged (demo for threadle MCP tool nodes)",
          params: [{ name: "message", type: "text", description: "Text to echo back" }],
        },
      },
    },
    {
      id: "n-convert",
      type: "prompt-convert",
      position: { x: 320, y: 200 },
      status: "idle",
      data: {
        type: "prompt-convert",
        label: "ask to summarize",
        template:
          "Summarize the following MCP tool result in one short sentence:\n\n{{input}}",
      },
    },
    {
      id: "n-agent",
      type: "agent-def",
      position: { x: 620, y: 180 },
      status: "idle",
      data: {
        type: "agent-def",
        label: "summarize",
        ref: {
          provider: "cursor",
          name: "ask",
          source: "cursor:builtin",
        },
      },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 920, y: 200 },
      status: "idle",
      data: { type: "output", renderMode: "markdown" },
    },
  ],
  [
    { id: "e1", source: "n-mcp", target: "n-convert" },
    { id: "e2", source: "n-convert", target: "n-agent" },
    { id: "e3", source: "n-agent", target: "n-out" },
  ],
  { viewport: { x: 0, y: 0, zoom: 0.85 } },
);

/** Beginner — approval gate with splice (edit text before continue). */
export const SPLICE_GATE: PortableGraph = graph(
  "Example · Approval gate",
  [
    note(
      "n-note",
      40,
      40,
      "Beginner: the approval node pauses the run. Edit the text in the dock, then approve — or reject to stop.",
      300,
      90,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 180 },
      status: "idle",
      data: {
        type: "prompt",
        label: "draft",
        text: "Ship notes:\n- fix the flaky test\n- bump the changelog",
      },
    },
    {
      id: "n-gate",
      type: "approval",
      position: { x: 340, y: 180 },
      status: "idle",
      data: { type: "approval", label: "splice & approve" },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 640, y: 180 },
      status: "idle",
      data: { type: "output", renderMode: "markdown" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-gate" },
    { id: "e2", source: "n-gate", target: "n-out" },
  ],
);

/** Beginner — single agent shot (Cursor ask). */
export const ONE_SHOT_AGENT: PortableGraph = graph(
  "Example · One-shot agent",
  [
    note(
      "n-note",
      40,
      40,
      "Beginner: prompt → Cursor ask → output. Swap the agent node for Claude/opencode from the palette. Needs the agent CLI.",
      300,
      90,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 180 },
      status: "idle",
      data: {
        type: "prompt",
        label: "question",
        text: "In one short paragraph: what is a node-graph patchbay for agent sessions?",
      },
    },
    {
      id: "n-agent",
      type: "agent-def",
      position: { x: 360, y: 160 },
      status: "idle",
      data: {
        type: "agent-def",
        ref: { provider: "cursor", name: "ask", source: "cursor:builtin" },
      },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 680, y: 180 },
      status: "idle",
      data: { type: "output", renderMode: "markdown" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-agent", data: { role: "instantiate" } },
    { id: "e2", source: "n-agent", target: "n-out" },
  ],
);

/** Intermediate — knot concat of two branches. */
export const KNOT_CONCAT: PortableGraph = graph(
  "Example · Merge concat",
  [
    note(
      "n-note",
      40,
      20,
      "Intermediate: two independent prompts fan into a ⋈ Merge (concat). No agent — run to see the merge. Try switching join to first / majority.",
      320,
      100,
    ),
    {
      id: "n-a",
      type: "prompt",
      position: { x: 40, y: 160 },
      status: "idle",
      data: { type: "prompt", label: "branch A", text: "Alpha findings:\n- cache hit rate up\n- no new errors" },
    },
    {
      id: "n-b",
      type: "prompt",
      position: { x: 40, y: 320 },
      status: "idle",
      data: { type: "prompt", label: "branch B", text: "Beta findings:\n- latency p95 −12%\n- one flake left" },
    },
    {
      id: "n-knot",
      type: "knot",
      position: { x: 360, y: 220 },
      status: "idle",
      data: { type: "knot", strategy: "concat", label: "merge" },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 640, y: 220 },
      status: "idle",
      data: { type: "output", renderMode: "markdown" },
    },
  ],
  [
    { id: "e1", source: "n-a", target: "n-knot" },
    { id: "e2", source: "n-b", target: "n-knot" },
    { id: "e3", source: "n-knot", target: "n-out" },
  ],
);

/** Intermediate — content circuit breaker that parks for splice. */
export const CONTENT_TRIPWIRE: PortableGraph = graph(
  "Example · Content breaker",
  [
    note(
      "n-note",
      40,
      20,
      "Intermediate: ‡ Circuit breaker (content) trips when the text matches /ERROR/i, then parks for edit. Edit the prompt to remove ERROR and it passes through.",
      340,
      110,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 180 },
      status: "idle",
      data: {
        type: "prompt",
        label: "agent draft",
        text: "Build summary:\nAll green.\nERROR: leftover TODO in auth.ts",
      },
    },
    {
      id: "n-tw",
      type: "tripwire",
      position: { x: 360, y: 160 },
      status: "idle",
      data: {
        type: "tripwire",
        mode: "content",
        action: "park",
        label: "no ERROR",
        pattern: "ERROR",
        tripOnMatch: true,
      },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 660, y: 180 },
      status: "idle",
      data: { type: "output", renderMode: "text" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-tw" },
    { id: "e2", source: "n-tw", target: "n-out" },
  ],
);

/** Intermediate — Judge routes inbound text to labeled outs (pass / fail / unsure). */
export const JUDGE_BRANCH: PortableGraph = graph(
  "Example · Judge branch",
  [
    note(
      "n-note",
      40,
      20,
      "Intermediate: ? Judge evaluates ordered regex/contains matchers; first hit wins. Only the winning out-port carries text — change the prompt to FAIL or shrug to see fail / unsure.",
      380,
      120,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 200 },
      status: "idle",
      data: {
        type: "prompt",
        label: "test report",
        text: "suite PASS — all green",
      },
    },
    {
      id: "n-judge",
      type: "judge",
      position: { x: 340, y: 180 },
      status: "idle",
      data: {
        type: "judge",
        label: "route verdict",
        unmatched: "unsure",
        matchers: [
          {
            id: "m-pass",
            port: "pass",
            kind: "regex",
            pattern: "\\b(pass|ok|success|yes)\\b",
          },
          {
            id: "m-fail",
            port: "fail",
            kind: "regex",
            pattern: "\\b(fail|error|no)\\b",
          },
        ],
      },
    },
    {
      id: "n-pass",
      type: "output",
      position: { x: 640, y: 80 },
      status: "idle",
      data: { type: "output", label: "pass → review", renderMode: "text" },
    },
    {
      id: "n-fail",
      type: "output",
      position: { x: 640, y: 200 },
      status: "idle",
      data: { type: "output", label: "fail → fix", renderMode: "text" },
    },
    {
      id: "n-unsure",
      type: "output",
      position: { x: 640, y: 320 },
      status: "idle",
      data: { type: "output", label: "unsure", renderMode: "text" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-judge" },
    {
      id: "e2",
      source: "n-judge",
      target: "n-pass",
      sourceHandle: "out:pass",
    },
    {
      id: "e3",
      source: "n-judge",
      target: "n-fail",
      sourceHandle: "out:fail",
    },
    {
      id: "e4",
      source: "n-judge",
      target: "n-unsure",
      sourceHandle: "out:unsure",
    },
  ],
);

/** Advanced — invoke a skill via claude -p "/name", then Judge. */
export const SKILL_INVOKE_JUDGE: PortableGraph = graph(
  "Example · Skill invoke + Judge",
  [
    note(
      "n-note",
      40,
      20,
      "Advanced: ✦ Skill in invoke mode runs `/{name}` on a provider CLI (default Claude; click the provider chip to cycle Cursor / opencode / …). Optional inbound text is appended. Wire the result into ? Judge. Toggle ▶/↦ for invoke ↔ inject. Replace the skill name with one installed for that tool.",
      420,
      140,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 220 },
      status: "idle",
      data: {
        type: "prompt",
        label: "extra context",
        text: "Summarize in one short paragraph whether this skill run looks successful.",
      },
    },
    {
      id: "n-skill",
      type: "skill",
      position: { x: 340, y: 200 },
      status: "idle",
      data: {
        type: "skill",
        path: "",
        name: "example-skill",
        mode: "invoke",
        label: "invoke skill",
      },
    },
    {
      id: "n-judge",
      type: "judge",
      position: { x: 620, y: 180 },
      status: "idle",
      data: {
        type: "judge",
        label: "route result",
        unmatched: "unsure",
        matchers: [
          {
            id: "m-pass",
            port: "pass",
            kind: "regex",
            pattern: "\\b(pass|ok|success|done|complete)\\b",
          },
          {
            id: "m-fail",
            port: "fail",
            kind: "regex",
            pattern: "\\b(fail|error|unable|cannot)\\b",
          },
        ],
      },
    },
    {
      id: "n-pass",
      type: "output",
      position: { x: 900, y: 80 },
      status: "idle",
      data: { type: "output", label: "pass", renderMode: "text" },
    },
    {
      id: "n-fail",
      type: "output",
      position: { x: 900, y: 200 },
      status: "idle",
      data: { type: "output", label: "fail", renderMode: "text" },
    },
    {
      id: "n-unsure",
      type: "output",
      position: { x: 900, y: 320 },
      status: "idle",
      data: { type: "output", label: "unsure", renderMode: "text" },
    },
  ],
  [
    { id: "e-p-s", source: "n-prompt", target: "n-skill" },
    { id: "e-s-j", source: "n-skill", target: "n-judge" },
    {
      id: "e-j-pass",
      source: "n-judge",
      target: "n-pass",
      sourceHandle: "out:pass",
    },
    {
      id: "e-j-fail",
      source: "n-judge",
      target: "n-fail",
      sourceHandle: "out:fail",
    },
    {
      id: "e-j-unsure",
      source: "n-judge",
      target: "n-unsure",
      sourceHandle: "out:unsure",
    },
  ],
);

/** Intermediate — Until counted re-entry (agent-free). */
export const UNTIL_REENTER: PortableGraph = graph(
  "Example · Until re-entry",
  [
    note(
      "n-note",
      40,
      20,
      "Intermediate: ↻ Until re-enters the convert up to max times (default 3), then emits on exhausted. Reenter edges are ignored by topo — not a free cycle. Pair with a spend ceiling on agent graphs.",
      400,
      110,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 200 },
      status: "idle",
      data: { type: "prompt", label: "seed", text: "n" },
    },
    {
      id: "n-work",
      type: "prompt-convert",
      position: { x: 300, y: 200 },
      status: "idle",
      data: {
        type: "prompt-convert",
        label: "append tick",
        template: "{{input}}.",
      },
    },
    {
      id: "n-until",
      type: "until",
      position: { x: 560, y: 180 },
      status: "idle",
      data: { type: "until", label: "retry body", maxIterations: 3 },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 820, y: 200 },
      status: "idle",
      data: { type: "output", label: "exhausted", renderMode: "text" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-work" },
    { id: "e2", source: "n-work", target: "n-until" },
    {
      id: "e3",
      source: "n-until",
      target: "n-work",
      sourceHandle: "out:reenter",
      data: { role: "reenter" },
    },
    {
      id: "e4",
      source: "n-until",
      target: "n-out",
      sourceHandle: "out:exhausted",
    },
  ],
  { settings: { spendTripwireUsd: 1 } },
);

/** Advanced — agent out:err fallback arm (needs agent CLI; fail to see err). */
export const AGENT_ERR_FALLBACK: PortableGraph = graph(
  "Example · Agent err fallback",
  [
    note(
      "n-note",
      40,
      20,
      "Advanced: agent happy-path out vs out:err. After retries are exhausted, failure text goes to the err arm (fallback convert → output). Unwired err still aborts (or continueOnError starves). Pick a model on the agent. To demo err: use a bad model id or stop the CLI mid-run.",
      420,
      130,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 220 },
      status: "idle",
      data: {
        type: "prompt",
        label: "task",
        text: "Reply with exactly: ok",
      },
    },
    {
      id: "n-agent",
      type: "agent-def",
      position: { x: 340, y: 200 },
      status: "idle",
      retry: 1,
      data: {
        type: "agent-def",
        ref: { provider: "cursor", name: "ask", source: "cursor:builtin" },
      },
    },
    {
      id: "n-happy",
      type: "output",
      position: { x: 640, y: 120 },
      status: "idle",
      data: { type: "output", label: "happy path", renderMode: "markdown" },
    },
    {
      id: "n-fallback",
      type: "prompt-convert",
      position: { x: 640, y: 280 },
      status: "idle",
      data: {
        type: "prompt-convert",
        label: "wrap err",
        template: "fallback after agent failure:\n\n{{input}}",
      },
    },
    {
      id: "n-err",
      type: "output",
      position: { x: 920, y: 280 },
      status: "idle",
      data: { type: "output", label: "err arm", renderMode: "text" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-agent", data: { role: "instantiate" } },
    { id: "e2", source: "n-agent", target: "n-happy" },
    {
      id: "e3",
      source: "n-agent",
      target: "n-fallback",
      sourceHandle: "out:err",
    },
    { id: "e4", source: "n-fallback", target: "n-err" },
  ],
);

/** Intermediate — spend circuit breaker node + graph ceiling. */
export const SPEND_TRIPWIRE: PortableGraph = graph(
  "Example · Spend ceiling",
  [
    note(
      "n-note",
      40,
      20,
      "Intermediate: graph ≔ spend ceiling ($0.50) is the whole-run limit. The ‡ circuit breaker on the wire uses the same spend counter — abort this branch when hit. Needs a real agent run to accumulate spend.",
      360,
      120,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 200 },
      status: "idle",
      data: {
        type: "prompt",
        label: "task",
        text: "List three safe refactors for this repo in under 80 words.",
      },
    },
    {
      id: "n-agent",
      type: "agent-def",
      position: { x: 340, y: 180 },
      status: "idle",
      data: {
        type: "agent-def",
        ref: { provider: "cursor", name: "ask", source: "cursor:builtin" },
      },
    },
    {
      id: "n-tw",
      type: "tripwire",
      position: { x: 640, y: 180 },
      status: "idle",
      data: {
        type: "tripwire",
        mode: "spend",
        action: "abort",
        label: "branch cap",
        thresholdUsd: 0.25,
      },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 920, y: 200 },
      status: "idle",
      data: { type: "output", renderMode: "markdown" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-agent", data: { role: "instantiate" } },
    { id: "e2", source: "n-agent", target: "n-tw" },
    { id: "e3", source: "n-tw", target: "n-out" },
  ],
  { settings: { spendTripwireUsd: 0.5, ply: 4 } },
);

/**
 * The iconic threadle loop: Plan → Implement → Review.
 * Cursor modes for plan/agent/ask so it runs with one CLI installed.
 */
export const PLAN_IMPLEMENT_REVIEW: PortableGraph = {
  $schema: "threadle/graph@1",
  name: "Starter workflow",
  kind: "workflow",
  params: [
    {
      name: "task",
      type: "text",
      default: "Add a failing unit test for the bug you just found, then fix it.",
      description: "What should the agents plan, build, and review?",
    },
  ],
  viewport: { x: 40, y: 20, zoom: 0.85 },
  nodes: [
    {
      id: "n-task",
      type: "prompt",
      position: { x: 40, y: 180 },
      status: "idle",
      data: {
        type: "prompt",
        label: "task",
        text: "{{param:task}}",
      },
    },
    {
      id: "n-plan",
      type: "agent-def",
      position: { x: 320, y: 160 },
      status: "idle",
      data: {
        type: "agent-def",
        ref: { provider: "cursor", name: "plan", source: "cursor:builtin" },
      },
    },
    {
      id: "n-impl-prompt",
      type: "prompt-convert",
      position: { x: 600, y: 160 },
      status: "idle",
      data: {
        type: "prompt-convert",
        template:
          "Implement the following plan. Prefer a small, reviewable diff.\n\n{{input}}",
      },
    },
    {
      id: "n-impl",
      type: "agent-def",
      position: { x: 880, y: 160 },
      status: "idle",
      data: {
        type: "agent-def",
        ref: { provider: "cursor", name: "agent", source: "cursor:builtin" },
      },
    },
    {
      id: "n-review-prompt",
      type: "prompt-convert",
      position: { x: 1160, y: 80 },
      status: "idle",
      data: {
        type: "prompt-convert",
        template:
          "Review the implementation below. Check correctness, edge cases, tests, and risk. Be concrete — cite files and suggest fixes only when needed.\n\n{{input}}",
      },
    },
    {
      id: "n-review-skill",
      type: "skill",
      position: { x: 1160, y: 280 },
      status: "idle",
      muted: true,
      data: {
        type: "skill",
        path: "",
        name: "review-diff",
        origin: "custom",
        source: "threadle custom",
        description: "Optional — unmute when you have a review-diff skill installed",
      },
    },
    {
      id: "n-gate",
      type: "approval",
      position: { x: 1440, y: 180 },
      status: "idle",
      data: { type: "approval", label: "ship review?" },
    },
    {
      id: "n-review",
      type: "agent-def",
      position: { x: 1720, y: 160 },
      status: "idle",
      data: {
        type: "agent-def",
        ref: { provider: "cursor", name: "ask", source: "cursor:builtin" },
      },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 2000, y: 160 },
      status: "idle",
      data: { type: "output", renderMode: "markdown" },
    },
    {
      id: "n-note",
      type: "note",
      position: { x: 40, y: 40 },
      status: "idle",
      data: {
        type: "note",
        text: "Starter workflow: Cursor plan (read-only) → implement → review. Set {{param:task}}, run with --approve-all for CLI, or confirm the gate in the UI. Unmute the review-diff skill node when that skill is installed.",
        size: { width: 280, height: 110 },
      },
    },
  ],
  edges: [
    { id: "e1", source: "n-task", target: "n-plan", data: { role: "instantiate" } },
    { id: "e2", source: "n-plan", target: "n-impl-prompt" },
    { id: "e3", source: "n-impl-prompt", target: "n-impl", data: { role: "instantiate" } },
    { id: "e4", source: "n-impl", target: "n-review-prompt" },
    { id: "e5", source: "n-review-prompt", target: "n-gate" },
    { id: "e6", source: "n-review-skill", target: "n-gate" },
    { id: "e7", source: "n-gate", target: "n-review", data: { role: "instantiate" } },
    { id: "e8", source: "n-review", target: "n-out" },
  ],
};

/** Advanced — parallel fan-out, majority merge, duration circuit breaker. */
export const PLY_FAN_KNOT: PortableGraph = graph(
  "Example · Parallel fan + majority merge",
  [
    note(
      "n-note",
      40,
      10,
      "Advanced: one prompt fans into two Cursor ask agents (ǁ parallelism=2). ⋈ Merge takes majority; ‡ duration breaker aborts if the run exceeds 3 minutes.",
      380,
      110,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 180 },
      status: "idle",
      data: {
        type: "prompt",
        label: "brief",
        text: "Name the single riskiest assumption in a local-first agent patchbay. One sentence.",
      },
    },
    {
      id: "n-c1",
      type: "prompt-convert",
      position: { x: 320, y: 100 },
      status: "idle",
      data: {
        type: "prompt-convert",
        template: "Answer concisely as reviewer A.\n\n{{input}}",
      },
    },
    {
      id: "n-c2",
      type: "prompt-convert",
      position: { x: 320, y: 280 },
      status: "idle",
      data: {
        type: "prompt-convert",
        template: "Answer concisely as reviewer B.\n\n{{input}}",
      },
    },
    {
      id: "n-a1",
      type: "agent-def",
      position: { x: 600, y: 80 },
      status: "idle",
      data: {
        type: "agent-def",
        ref: { provider: "cursor", name: "ask", source: "cursor:builtin" },
      },
    },
    {
      id: "n-a2",
      type: "agent-def",
      position: { x: 600, y: 260 },
      status: "idle",
      data: {
        type: "agent-def",
        ref: { provider: "cursor", name: "ask", source: "cursor:builtin" },
      },
    },
    {
      id: "n-knot",
      type: "knot",
      position: { x: 900, y: 160 },
      status: "idle",
      data: { type: "knot", strategy: "majority", label: "vote" },
    },
    {
      id: "n-tw",
      type: "tripwire",
      position: { x: 1160, y: 160 },
      status: "idle",
      data: {
        type: "tripwire",
        mode: "duration",
        action: "abort",
        label: "3 min",
        thresholdMs: 180_000,
      },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 1420, y: 180 },
      status: "idle",
      data: { type: "output", renderMode: "markdown" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-c1" },
    { id: "e2", source: "n-prompt", target: "n-c2" },
    { id: "e3", source: "n-c1", target: "n-a1", data: { role: "instantiate" } },
    { id: "e4", source: "n-c2", target: "n-a2", data: { role: "instantiate" } },
    { id: "e5", source: "n-a1", target: "n-knot" },
    { id: "e6", source: "n-a2", target: "n-knot" },
    { id: "e7", source: "n-knot", target: "n-tw" },
    { id: "e8", source: "n-tw", target: "n-out" },
  ],
  { settings: { ply: 2 } },
);

/** Expert — guarded parallel with merge, circuit breakers, splice. */
export const EXPERT_GUARDED_FAN: PortableGraph = graph(
  "Example · Guarded parallel",
  [
    note(
      "n-note",
      40,
      0,
      "Expert: parallelism=2 fan → two asks → concat merge → content breaker (skip branch on ERROR) → approval edit → output. Graph spend ceiling $1. Open ⌀ Graph lint after edits.",
      400,
      120,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 180 },
      status: "idle",
      data: {
        type: "prompt",
        label: "spec",
        text: "{{param:task}}",
      },
    },
    {
      id: "n-c1",
      type: "prompt-convert",
      position: { x: 300, y: 80 },
      status: "idle",
      data: {
        type: "prompt-convert",
        template: "Propose approach A (optimistic).\n\n{{input}}",
      },
    },
    {
      id: "n-c2",
      type: "prompt-convert",
      position: { x: 300, y: 280 },
      status: "idle",
      data: {
        type: "prompt-convert",
        template: "Propose approach B (cautious).\n\n{{input}}",
      },
    },
    {
      id: "n-a1",
      type: "agent-def",
      position: { x: 580, y: 60 },
      status: "idle",
      continueOnError: true,
      data: {
        type: "agent-def",
        ref: { provider: "cursor", name: "ask", source: "cursor:builtin" },
      },
    },
    {
      id: "n-a2",
      type: "agent-def",
      position: { x: 580, y: 260 },
      status: "idle",
      continueOnError: true,
      data: {
        type: "agent-def",
        ref: { provider: "cursor", name: "ask", source: "cursor:builtin" },
      },
    },
    {
      id: "n-knot",
      type: "knot",
      position: { x: 880, y: 160 },
      status: "idle",
      data: { type: "knot", strategy: "concat", label: "combine" },
    },
    {
      id: "n-retry",
      type: "tripwire",
      position: { x: 1140, y: 80 },
      status: "idle",
      data: {
        type: "tripwire",
        mode: "retries",
        action: "abort",
        label: "fuse",
        thresholdRetries: 2,
      },
    },
    {
      id: "n-content",
      type: "tripwire",
      position: { x: 1140, y: 240 },
      status: "idle",
      data: {
        type: "tripwire",
        mode: "content",
        action: "park",
        label: "scrub ERROR",
        pattern: "ERROR",
        tripOnMatch: true,
      },
    },
    {
      id: "n-gate",
      type: "approval",
      position: { x: 1420, y: 160 },
      status: "idle",
      data: { type: "approval", label: "splice final" },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 1700, y: 160 },
      status: "idle",
      data: { type: "output", renderMode: "markdown" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-c1" },
    { id: "e2", source: "n-prompt", target: "n-c2" },
    { id: "e3", source: "n-c1", target: "n-a1", data: { role: "instantiate" } },
    { id: "e4", source: "n-c2", target: "n-a2", data: { role: "instantiate" } },
    { id: "e5", source: "n-a1", target: "n-knot" },
    { id: "e6", source: "n-a2", target: "n-knot" },
    { id: "e7", source: "n-knot", target: "n-retry" },
    { id: "e8", source: "n-retry", target: "n-content" },
    { id: "e9", source: "n-content", target: "n-gate" },
    { id: "e10", source: "n-gate", target: "n-out" },
  ],
  { settings: { ply: 2, spendTripwireUsd: 1 }, viewport: { x: 20, y: 0, zoom: 0.75 } },
);

/** Beginner — workflow params fill {{param:name}}. */
export const PARAM_PROMPT: PortableGraph = graph(
  "Example · Workflow params",
  [
    note(
      "n-note",
      40,
      40,
      "Beginner: open ≔ params, set `topic`, then ▶ Run. {{param:topic}} expands before the prompt executes.",
      320,
      100,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 200 },
      status: "idle",
      data: {
        type: "prompt",
        label: "brief",
        text: "Write two bullet points about: {{param:topic}}",
      },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 400, y: 200 },
      status: "idle",
      data: { type: "output", renderMode: "markdown" },
    },
  ],
  [{ id: "e1", source: "n-prompt", target: "n-out" }],
  {
    params: [
      {
        name: "topic",
        type: "text",
        default: "local-first agent patchbays",
        description: "What the prompt should talk about",
      },
    ],
  },
);

/** Beginner — prompt-convert wraps upstream text. */
export const PROMPT_CONVERT: PortableGraph = graph(
  "Example · Text → Prompt",
  [
    note(
      "n-note",
      40,
      40,
      "Beginner: a converter wraps inbound text with a template. {{input}} is the upstream wire.",
      300,
      90,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 180 },
      status: "idle",
      data: {
        type: "prompt",
        label: "raw notes",
        text: "- cache hits up\n- one flake in auth",
      },
    },
    {
      id: "n-c",
      type: "prompt-convert",
      position: { x: 340, y: 180 },
      status: "idle",
      data: {
        type: "prompt-convert",
        template:
          "Turn these notes into a crisp status update for standup.\n\n{{input}}",
      },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 640, y: 180 },
      status: "idle",
      data: { type: "output", renderMode: "markdown" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-c" },
    { id: "e2", source: "n-c", target: "n-out" },
  ],
);

/** Intermediate — iterator splits lines (text still flows to output). */
export const ITERATOR_LINES: PortableGraph = graph(
  "Example · Iterator lines",
  [
    note(
      "n-note",
      40,
      30,
      "Intermediate: ∀ Iterator splits inbound text into items. Wire an agent after it to run once per item; here we only show the split feeding an output.",
      340,
      110,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 200 },
      status: "idle",
      data: {
        type: "prompt",
        label: "checklist",
        text: "ship changelog\nfix flaky test\nbump deps",
      },
    },
    {
      id: "n-it",
      type: "iterator",
      position: { x: 360, y: 200 },
      status: "idle",
      data: { type: "iterator", splitMode: "lines" },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 640, y: 200 },
      status: "idle",
      data: { type: "output", renderMode: "text" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-it" },
    { id: "e2", source: "n-it", target: "n-out" },
  ],
);

/** Intermediate — knot first-wins. */
export const KNOT_FIRST: PortableGraph = graph(
  "Example · Merge first-wins",
  [
    note(
      "n-note",
      40,
      30,
      "Intermediate: ⋈ Merge set to first — only the first inbound text survives. Swap to majority or concat on the node.",
      320,
      100,
    ),
    {
      id: "n-a",
      type: "prompt",
      position: { x: 40, y: 160 },
      status: "idle",
      data: { type: "prompt", label: "early", text: "First answer arrives." },
    },
    {
      id: "n-b",
      type: "prompt",
      position: { x: 40, y: 300 },
      status: "idle",
      data: { type: "prompt", label: "late", text: "Second answer is ignored." },
    },
    {
      id: "n-knot",
      type: "knot",
      position: { x: 360, y: 220 },
      status: "idle",
      data: { type: "knot", strategy: "first", label: "first wins" },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 640, y: 220 },
      status: "idle",
      data: { type: "output", renderMode: "text" },
    },
  ],
  [
    { id: "e1", source: "n-a", target: "n-knot" },
    { id: "e2", source: "n-b", target: "n-knot" },
    { id: "e3", source: "n-knot", target: "n-out" },
  ],
);

/** Intermediate — mute & bypass teaching graph. */
export const MUTE_BYPASS: PortableGraph = graph(
  "Example · Mute & bypass",
  [
    note(
      "n-note",
      40,
      20,
      "Intermediate: right-click a node → mute (skip) or bypass (pass-through). The left prompt is muted; the converter is bypassed so its template never runs.",
      360,
      110,
    ),
    {
      id: "n-muted",
      type: "prompt",
      position: { x: 40, y: 180 },
      status: "idle",
      muted: true,
      data: { type: "prompt", label: "muted", text: "YOU SHOULD NOT SEE THIS" },
    },
    {
      id: "n-live",
      type: "prompt",
      position: { x: 40, y: 320 },
      status: "idle",
      data: { type: "prompt", label: "live", text: "only this text should reach output" },
    },
    {
      id: "n-c",
      type: "prompt-convert",
      position: { x: 360, y: 280 },
      status: "idle",
      bypassed: true,
      data: {
        type: "prompt-convert",
        template: "WRAPPED {{input}}",
      },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 660, y: 280 },
      status: "idle",
      data: { type: "output", renderMode: "text" },
    },
  ],
  [
    { id: "e0", source: "n-muted", target: "n-c" },
    { id: "e1", source: "n-live", target: "n-c" },
    { id: "e2", source: "n-c", target: "n-out" },
  ],
);

/** Intermediate — min-chars content circuit breaker. */
export const MIN_CHARS_TRIPWIRE: PortableGraph = graph(
  "Example · Min-chars breaker",
  [
    note(
      "n-note",
      40,
      30,
      "Intermediate: ‡ content breaker with min chars — short drafts park for edit. Lengthen the prompt past 40 chars to pass cleanly.",
      340,
      100,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 180 },
      status: "idle",
      data: { type: "prompt", label: "draft", text: "too short" },
    },
    {
      id: "n-tw",
      type: "tripwire",
      position: { x: 340, y: 160 },
      status: "idle",
      data: {
        type: "tripwire",
        mode: "content",
        action: "park",
        label: "≥40 chars",
        minChars: 40,
      },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 640, y: 180 },
      status: "idle",
      data: { type: "output", renderMode: "text" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-tw" },
    { id: "e2", source: "n-tw", target: "n-out" },
  ],
);

/** Advanced — iterator → mocked agent (one shot per line). */
export const ITERATOR_AGENT: PortableGraph = graph(
  "Example · Iterator → agent",
  [
    note(
      "n-note",
      40,
      20,
      "Advanced: ∀ lines feed a Cursor ask once per item. Needs agent CLI; in tests agents are mocked.",
      320,
      90,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 160 },
      status: "idle",
      data: {
        type: "prompt",
        label: "questions",
        text: "What is parallelism?\nWhat is a merge?\nWhat is a circuit breaker?",
      },
    },
    {
      id: "n-it",
      type: "iterator",
      position: { x: 320, y: 160 },
      status: "idle",
      data: { type: "iterator", splitMode: "lines", maxItems: 3 },
    },
    {
      id: "n-agent",
      type: "agent-def",
      position: { x: 560, y: 140 },
      status: "idle",
      data: {
        type: "agent-def",
        ref: { provider: "cursor", name: "ask", source: "cursor:builtin" },
      },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 860, y: 160 },
      status: "idle",
      data: { type: "output", renderMode: "markdown" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-it" },
    { id: "e2", source: "n-it", target: "n-agent", data: { role: "instantiate" } },
    { id: "e3", source: "n-agent", target: "n-out" },
  ],
);

/** Intermediate — wait until a session is idle before continuing. */
export const WAIT_IDLE_GATE: PortableGraph = graph(
  "Example · Wait for idle",
  [
    note(
      "n-note",
      40,
      20,
      "Intermediate: ◌ Wait for idle parks until the inbound session is not generating (running/waiting). Replace the session node with one from your Sessions list, then run. On timeout: park / skip / abort.",
      400,
      110,
    ),
    {
      id: "n-sess",
      type: "session",
      position: { x: 40, y: 200 },
      status: "idle",
      data: {
        type: "session",
        ref: { provider: "cursor", sessionId: "replace-with-live-session" },
        snapshot: { title: "your session" },
        label: "pick a session",
      },
    },
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 340 },
      status: "idle",
      data: {
        type: "prompt",
        label: "payload",
        text: "Safe to inject — session was idle.",
      },
    },
    {
      id: "n-wait",
      type: "wait-idle",
      position: { x: 360, y: 260 },
      status: "idle",
      data: {
        type: "wait-idle",
        timeoutMs: 15_000,
        onTimeout: "park",
        label: "until idle",
      },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 640, y: 260 },
      status: "idle",
      data: { type: "output", renderMode: "text" },
    },
  ],
  [
    { id: "e1", source: "n-sess", target: "n-wait" },
    { id: "e2", source: "n-prompt", target: "n-wait" },
    { id: "e3", source: "n-wait", target: "n-out" },
  ],
);

/** Advanced — parallel iterator map + merge (fresh session per item). */
export const ITERATOR_PARALLEL: PortableGraph = graph(
  "Example · Iterator parallel map",
  [
    note(
      "n-note",
      40,
      20,
      "Advanced: ∀ mode parallel — one fresh Cursor ask per line (ply-bounded), then ⋈ Merge joins answers. Serial iterator reuses one session; parallel does not. Needs agent CLI; tests mock the agent.",
      420,
      110,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 180 },
      status: "idle",
      data: {
        type: "prompt",
        label: "questions",
        text: "What is parallelism?\nWhat is a merge?\nWhat is a circuit breaker?",
      },
    },
    {
      id: "n-it",
      type: "iterator",
      position: { x: 320, y: 180 },
      status: "idle",
      data: {
        type: "iterator",
        splitMode: "lines",
        mode: "parallel",
        maxItems: 3,
      },
    },
    {
      id: "n-agent",
      type: "agent-def",
      position: { x: 560, y: 160 },
      status: "idle",
      data: {
        type: "agent-def",
        ref: { provider: "cursor", name: "ask", source: "cursor:builtin" },
      },
    },
    {
      id: "n-knot",
      type: "knot",
      position: { x: 820, y: 180 },
      status: "idle",
      data: { type: "knot", strategy: "concat", label: "join answers" },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 1080, y: 180 },
      status: "idle",
      data: { type: "output", renderMode: "markdown" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-it" },
    { id: "e2", source: "n-it", target: "n-agent", data: { role: "instantiate" } },
    { id: "e3", source: "n-agent", target: "n-knot" },
    { id: "e4", source: "n-knot", target: "n-out" },
  ],
  { settings: { ply: 2 } },
);

/** Advanced — token circuit breaker skip. */
export const TOKEN_TRIPWIRE: PortableGraph = graph(
  "Example · Token breaker",
  [
    note(
      "n-note",
      40,
      20,
      "Advanced: ‡ tokens mode estimates chars÷4 when no session usage is known. Threshold is deliberately low so this demo trips and skips the branch.",
      360,
      110,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 180 },
      status: "idle",
      data: {
        type: "prompt",
        label: "long",
        text: "This prompt is intentionally verbose so a low token threshold will trip. ".repeat(8),
      },
    },
    {
      id: "n-tw",
      type: "tripwire",
      position: { x: 400, y: 160 },
      status: "idle",
      data: {
        type: "tripwire",
        mode: "tokens",
        action: "skip",
        label: "tok cap",
        thresholdTokens: 50,
      },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 700, y: 180 },
      status: "idle",
      data: { type: "output", renderMode: "text" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-tw" },
    { id: "e2", source: "n-tw", target: "n-out" },
  ],
);

/** Advanced — Cursor drafts, convert frames a brief, Claude continues (cross-tool). */
export const CROSS_TOOL_DISTILL: PortableGraph = graph(
  "Example · Cross-tool distill",
  [
    note(
      "n-note",
      40,
      10,
      "Advanced starter: Cursor ask drafts → ✦ convert frames a handoff brief → Claude continues on another provider. Swap agents from the palette. Costs tokens; needs both CLIs.\n\nFor a real finished session, use recipe `handover-brief` or `second-opinion` instead.",
      480,
      120,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 180 },
      status: "idle",
      data: {
        type: "prompt",
        label: "topic",
        text: "In 5–8 sentences, outline how {{param:topic}} should work in a local-first agent patchbay. Prefer concrete steps over marketing.",
      },
    },
    {
      id: "n-cursor",
      type: "agent-def",
      position: { x: 360, y: 160 },
      status: "idle",
      data: {
        type: "agent-def",
        label: "draft (Cursor)",
        ref: { provider: "cursor", name: "ask", source: "cursor:builtin" },
      },
    },
    {
      id: "n-frame",
      type: "prompt-convert",
      position: { x: 680, y: 160 },
      status: "idle",
      data: {
        type: "prompt-convert",
        template:
          "You are picking up mid-flight from another tool. Here is their draft — distill it into a brief you can act on, then answer the open question at the end.\n\n--- DRAFT FROM CURSOR ---\n\n{{input}}\n\n--- OPEN QUESTION ---\n\nWhat is the single highest-leverage next step for {{param:topic}}?",
      },
    },
    {
      id: "n-claude",
      type: "agent-def",
      position: { x: 1000, y: 160 },
      status: "idle",
      data: {
        type: "agent-def",
        label: "continue (Claude)",
        ref: {
          provider: "claude-code",
          name: "general-purpose",
          source: "claude:builtin",
        },
      },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 1320, y: 180 },
      status: "idle",
      data: { type: "output", renderMode: "markdown" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-cursor", data: { role: "instantiate" } },
    { id: "e2", source: "n-cursor", target: "n-frame" },
    { id: "e3", source: "n-frame", target: "n-claude", data: { role: "instantiate" } },
    { id: "e4", source: "n-claude", target: "n-out" },
  ],
  {
    params: [
      {
        name: "topic",
        type: "text",
        default: "cross-tool context handoff",
        description: "What the draft + handoff should cover",
      },
    ],
  },
);

/**
 * Advanced — autopsy a failed / messy session narrative (sample prompt;
 * swap for ❝ distilled context from a real session when ready).
 */
export const SESSION_AUTOPSY: PortableGraph = graph(
  "Example · Session autopsy",
  [
    note(
      "n-note",
      40,
      0,
      "Advanced starter: autopsy a messy run — what was attempted, what broke, what to do next.\n\nDemo uses a sample narrative in the prompt. For a real session: wire ❯ Session → ❝ Context (distill) → agent — ≫ / CLI extract mid-run, or drop a Library payload.\n\n▶ can pause at ✓; ≫ / CLI need --approve-all.",
      520,
      150,
    ),
    {
      id: "n-prompt",
      type: "prompt",
      position: { x: 40, y: 200 },
      status: "idle",
      data: {
        type: "prompt",
        label: "session narrative (sample)",
        text: "Session tried to fix flaky auth tests. Agent rewrote the mock twice, then chased a red herring in CORS middleware. Never re-ran the failing suite after the second mock change. Left two TODOs in auth.test.ts and an unused helper. Spend felt high for the outcome. User interrupted once with \"stay on the test\".",
      },
    },
    {
      id: "n-frame",
      type: "prompt-convert",
      position: { x: 420, y: 200 },
      status: "idle",
      data: {
        type: "prompt-convert",
        template:
          "Perform a session autopsy focused on {{param:focus}}.\n\nStructure:\n1. What was the stated goal?\n2. What actually happened (facts only)?\n3. Where did it go sideways?\n4. Ranked next actions (smallest first).\n5. What to avoid repeating.\n\nBe blunt; no pep talk.\n\n--- SESSION NOTES ---\n\n{{input}}",
      },
    },
    {
      id: "n-agent",
      type: "agent-def",
      position: { x: 800, y: 180 },
      status: "idle",
      data: {
        type: "agent-def",
        label: "autopsy",
        ref: { provider: "cursor", name: "ask", source: "cursor:builtin" },
      },
    },
    {
      id: "n-tw",
      type: "tripwire",
      position: { x: 1080, y: 180 },
      status: "idle",
      data: {
        type: "tripwire",
        mode: "content",
        action: "park",
        label: "thin autopsy?",
        minChars: 160,
      },
    },
    {
      id: "n-gate",
      type: "approval",
      position: { x: 1340, y: 180 },
      status: "idle",
      data: { type: "approval", label: "keep autopsy?" },
    },
    {
      id: "n-out",
      type: "output",
      position: { x: 1600, y: 200 },
      status: "idle",
      data: { type: "output", renderMode: "markdown" },
    },
  ],
  [
    { id: "e1", source: "n-prompt", target: "n-frame" },
    { id: "e2", source: "n-frame", target: "n-agent", data: { role: "instantiate" } },
    { id: "e3", source: "n-agent", target: "n-tw" },
    { id: "e4", source: "n-tw", target: "n-gate" },
    { id: "e5", source: "n-gate", target: "n-out" },
  ],
  {
    params: [
      {
        name: "focus",
        type: "text",
        default: "wasted motion, unverified claims, and the smallest unblock",
        description: "What the autopsy should emphasize",
      },
    ],
  },
);

const LEVEL_ORDER: Record<ExampleLevel, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
  expert: 3,
};

const ALL_TEMPLATES: WorkflowTemplateMeta[] = [
  {
    id: "hello-wire",
    name: HELLO_WIRE.name,
    description: "Prompt → output. Learn wiring with no agent.",
    level: "beginner",
    teaches: ["prompt", "output", "wires"],
    graph: HELLO_WIRE,
  },
  {
    id: "detached-delay",
    name: DETACHED_DELAY.name,
    description: "Agent-free ~60s delay — watch jobs/logs from the terminal.",
    level: "intermediate",
    teaches: ["delay", "detached", "jobs", "logs"],
    graph: DETACHED_DELAY,
  },
  {
    id: "hello-mcp",
    name: HELLO_MCP.name,
    description: "Prompt → ◈ MCP tool (echo) → output. Needs examples/mcp echo config.",
    level: "intermediate",
    teaches: ["mcp-tool", "stdio"],
    graph: HELLO_MCP,
  },
  {
    id: "hello-mcp-params",
    name: HELLO_MCP_PARAMS.name,
    description: "◈ MCP echo with inspector params (no argPort). Needs echo config.",
    level: "intermediate",
    teaches: ["mcp-tool", "params"],
    graph: HELLO_MCP_PARAMS,
  },
  {
    id: "mcp-then-agent",
    name: MCP_THEN_AGENT.name,
    description: "MCP echo → convert → agent → output. Needs echo + agent CLI; pick a model.",
    level: "advanced",
    teaches: ["mcp-tool", "prompt-convert", "agent"],
    graph: MCP_THEN_AGENT,
  },
  {
    id: "splice-gate",
    name: SPLICE_GATE.name,
    description: "Approval gate with editable text before continue.",
    level: "beginner",
    teaches: ["approval", "edit"],
    graph: SPLICE_GATE,
  },
  {
    id: "one-shot-agent",
    name: ONE_SHOT_AGENT.name,
    description: "Prompt → Cursor ask → output.",
    level: "beginner",
    teaches: ["agent", "run"],
    graph: ONE_SHOT_AGENT,
  },
  {
    id: "param-prompt",
    name: PARAM_PROMPT.name,
    description: "{{param:topic}} expands before the prompt runs.",
    level: "beginner",
    teaches: ["params", "≔"],
    graph: PARAM_PROMPT,
  },
  {
    id: "prompt-convert",
    name: PROMPT_CONVERT.name,
    description: "Wrap inbound text with a converter template.",
    level: "beginner",
    teaches: ["prompt-convert"],
    graph: PROMPT_CONVERT,
  },
  {
    id: "knot-concat",
    name: KNOT_CONCAT.name,
    description: "Two branches into a ⋈ Merge (concat).",
    level: "intermediate",
    teaches: ["merge", "fan-in"],
    graph: KNOT_CONCAT,
  },
  {
    id: "knot-first",
    name: KNOT_FIRST.name,
    description: "⋈ Merge first-wins across two branches.",
    level: "intermediate",
    teaches: ["merge", "first"],
    graph: KNOT_FIRST,
  },
  {
    id: "iterator-lines",
    name: ITERATOR_LINES.name,
    description: "∀ Iterator splits a checklist into lines.",
    level: "intermediate",
    teaches: ["iterator"],
    graph: ITERATOR_LINES,
  },
  {
    id: "mute-bypass",
    name: MUTE_BYPASS.name,
    description: "Mute skips a node; bypass pass-throughs a converter.",
    level: "intermediate",
    teaches: ["mute", "bypass"],
    graph: MUTE_BYPASS,
  },
  {
    id: "content-tripwire",
    name: CONTENT_TRIPWIRE.name,
    description: "‡ Content breaker parks when ERROR matches.",
    level: "intermediate",
    teaches: ["circuit-breaker", "park"],
    graph: CONTENT_TRIPWIRE,
  },
  {
    id: "judge-branch",
    name: JUDGE_BRANCH.name,
    description: "? Judge routes text to pass / fail / unsure outs.",
    level: "intermediate",
    teaches: ["judge", "branch"],
    graph: JUDGE_BRANCH,
  },
  {
    id: "skill-invoke-judge",
    name: SKILL_INVOKE_JUDGE.name,
    description: "✦ Skill invoke (/{name} on any provider) → ? Judge.",
    level: "advanced",
    teaches: ["skill", "invoke", "judge"],
    graph: SKILL_INVOKE_JUDGE,
  },
  {
    id: "until-reenter",
    name: UNTIL_REENTER.name,
    description: "↻ Until counted re-entry (agent-free convert loop).",
    level: "intermediate",
    teaches: ["until", "reenter"],
    graph: UNTIL_REENTER,
  },
  {
    id: "wait-idle-gate",
    name: WAIT_IDLE_GATE.name,
    description: "◌ Wait until a session is idle before continuing.",
    level: "intermediate",
    teaches: ["wait-idle", "session", "park"],
    graph: WAIT_IDLE_GATE,
  },
  {
    id: "agent-err-fallback",
    name: AGENT_ERR_FALLBACK.name,
    description: "Agent out:err → fallback convert when the run fails.",
    level: "advanced",
    teaches: ["agent", "err-port", "fallback"],
    graph: AGENT_ERR_FALLBACK,
  },
  {
    id: "min-chars-tripwire",
    name: MIN_CHARS_TRIPWIRE.name,
    description: "‡ Min-chars park when the draft is too short.",
    level: "intermediate",
    teaches: ["circuit-breaker", "content"],
    graph: MIN_CHARS_TRIPWIRE,
  },
  {
    id: "spend-tripwire",
    name: SPEND_TRIPWIRE.name,
    description: "Branch spend breaker + graph ceiling.",
    level: "intermediate",
    teaches: ["circuit-breaker", "spend", "≔"],
    graph: SPEND_TRIPWIRE,
  },
  {
    id: "iterator-agent",
    name: ITERATOR_AGENT.name,
    description: "∀ lines → Cursor ask once per item.",
    level: "advanced",
    teaches: ["iterator", "agent"],
    graph: ITERATOR_AGENT,
  },
  {
    id: "iterator-parallel",
    name: ITERATOR_PARALLEL.name,
    description: "∀ parallel map → fresh asks + ⋈ Merge (ply-bounded).",
    level: "advanced",
    teaches: ["iterator", "parallel", "merge", "agent"],
    graph: ITERATOR_PARALLEL,
  },
  {
    id: "token-tripwire",
    name: TOKEN_TRIPWIRE.name,
    description: "‡ Token breaker skips an oversized branch.",
    level: "advanced",
    teaches: ["circuit-breaker", "tokens"],
    graph: TOKEN_TRIPWIRE,
  },
  {
    id: "plan-implement-review",
    name: PLAN_IMPLEMENT_REVIEW.name,
    description: "Cursor plan → implement → review (skill + approval).",
    level: "advanced",
    teaches: ["params", "agents", "approval", "skill"],
    graph: PLAN_IMPLEMENT_REVIEW,
  },
  {
    id: "cross-tool-distill",
    name: CROSS_TOOL_DISTILL.name,
    description: "Cursor draft → brief → Claude continue (cross-provider).",
    level: "advanced",
    teaches: ["agents", "convert", "cross-tool", "params"],
    graph: CROSS_TOOL_DISTILL,
  },
  {
    id: "session-autopsy",
    name: SESSION_AUTOPSY.name,
    description: "Autopsy a messy run — causes, waste, next actions + approval.",
    level: "advanced",
    teaches: ["convert", "agent", "circuit-breaker", "approval", "params"],
    graph: SESSION_AUTOPSY,
  },
  {
    id: "ply-fan-knot",
    name: PLY_FAN_KNOT.name,
    description: "ǁ Parallelism=2 parallel asks, majority merge, duration fuse.",
    level: "advanced",
    teaches: ["parallelism", "merge", "circuit-breaker"],
    graph: PLY_FAN_KNOT,
  },
  {
    id: "expert-guarded-fan",
    name: EXPERT_GUARDED_FAN.name,
    description: "Parallel fan, retry fuse, content park, edit, spend ceiling.",
    level: "expert",
    teaches: ["parallelism", "merge", "circuit-breaker", "edit", "params"],
    graph: EXPERT_GUARDED_FAN,
  },
  {
    id: COMPLEX_PIPELINE_ID,
    name: "Example · Complex delay pipeline",
    description:
      "Five linked subgraphs, delays only — intake → normalize → fast∥deep → assemble (~20s).",
    level: "expert",
    teaches: ["subgraph", "delay", "parallelism", "merge", "circuit-breaker", "approval"],
    graph: buildComplexPipelinePortable(),
  },
];

export const WORKFLOW_TEMPLATES: WorkflowTemplateMeta[] = ALL_TEMPLATES.slice().sort(
  (a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level],
);

export function getWorkflowTemplate(id: string): WorkflowTemplateMeta | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.id === id);
}
