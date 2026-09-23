import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  recordsFromLine,
  microsToMs,
  discoverSessions,
  childrenOf,
} from "../src/providers/muse/discover.js";
import { MuseProvider } from "../src/providers/muse/index.js";
import { readMuseTranscript } from "../src/providers/muse/transcript.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SHARE = path.join(HERE, "fixtures/providers/muse");
const SESSION_ID = "01a0ce3e-daea-76f0-99fc-d53076374955";
const CHILD_ID = "39e5d5fc-1c2e-4acc-a294-741942f8fbbf";
const FIXTURE = path.join(FIXTURE_SHARE, "sessions", SESSION_ID, "session.jsonl");

describe("muse provider parsers", () => {
  it("microsToMs converts muse microsecond timestamps", () => {
    expect(microsToMs(1790167312697077)).toBe(1790167312697);
    expect(microsToMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it("recordsFromLine yields outer + nested record_json children", () => {
    const line = JSON.stringify({
      retained_frame: "session_permission_transaction",
      children: [
        {
          child_index: 0,
          record_json: JSON.stringify({
            payload_type: "runtime.session.metadata",
            payload: { record: { workspace_root: "/tmp/proj" } },
          }),
        },
      ],
    });
    const recs = [...recordsFromLine(line)];
    expect(recs.length).toBe(2);
    expect(recs[1]?.payload_type).toBe("runtime.session.metadata");
  });

  it("fixture session.jsonl contains user + assistant payload types", () => {
    expect(fs.existsSync(FIXTURE)).toBe(true);
    const raw = fs.readFileSync(FIXTURE, "utf8");
    expect(raw).toContain("runtime.user_intent.accepted");
    expect(raw).toContain("assistant_message_committed");
    expect(raw).toContain("muse-spark");
  });
});

describe("muse provider discovery", () => {
  const prev = process.env.MUSE_DATA_DIR;

  afterEach(() => {
    if (prev === undefined) delete process.env.MUSE_DATA_DIR;
    else process.env.MUSE_DATA_DIR = prev;
  });

  it("discovers fixture session and reads transcript", async () => {
    process.env.MUSE_DATA_DIR = FIXTURE_SHARE;
    const refs = await discoverSessions();
    expect(refs.length).toBe(1);
    expect(refs[0]?.id).toBe(SESSION_ID);
    expect(refs[0]?.provider).toBe("muse");
    expect(refs[0]?.model).toMatch(/muse-spark/);

    const msgs = await readMuseTranscript(SESSION_ID);
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    expect(msgs.some((m) => m.role === "user")).toBe(true);
    expect(msgs.some((m) => m.role === "assistant")).toBe(true);
  });
});

describe("muse session lineage", () => {
  const prev = process.env.MUSE_DATA_DIR;

  afterEach(() => {
    if (prev === undefined) delete process.env.MUSE_DATA_DIR;
    else process.env.MUSE_DATA_DIR = prev;
  });

  it("lists subagent children under the parent and hides them from top-level", async () => {
    process.env.MUSE_DATA_DIR = FIXTURE_SHARE;
    const provider = new MuseProvider();
    const top = await provider.listSessions();
    expect(top.map((s) => s.id)).toEqual([SESSION_ID]);
    expect(top.every((s) => !s.parentId)).toBe(true);

    const children = await provider.listChildren(SESSION_ID);
    expect(children).toHaveLength(1);
    expect(children[0]!.id).toBe(CHILD_ID);
    expect(children[0]!.parentId).toBe(SESSION_ID);
    expect(children[0]!.kind).toBe("subagent-run");
    expect(children[0]!.provider).toBe("muse");
  });

  it("reads child transcript via parent→child lineage", async () => {
    process.env.MUSE_DATA_DIR = FIXTURE_SHARE;
    await discoverSessions();
    const kids = await childrenOf(SESSION_ID);
    expect(kids[0]?.id).toBe(CHILD_ID);

    const msgs = await readMuseTranscript(CHILD_ID);
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    expect(msgs.some((m) => m.parts.some((p) => p.text?.includes("explore the muse")))).toBe(
      true,
    );
    expect(msgs.some((m) => m.parts.some((p) => p.text?.includes("child reply")))).toBe(true);
  });

  it("sets tokenSource transcript and actualCost 0 when MSP usage is present", async () => {
    process.env.MUSE_DATA_DIR = FIXTURE_SHARE;
    const refs = await discoverSessions();
    const hit = refs.find((r) => r.id === SESSION_ID);
    expect(hit?.actualCost).toBe(0);
    expect(hit?.tokensIn).toBeGreaterThan(0);
    expect(hit?.meta?.tokenSource).toBe("transcript");
  });
});

describe("muse model soft catalog", () => {
  it("parseMuseSparkIds extracts spark ids from help text", async () => {
    const { parseMuseSparkIds } = await import("../src/providers/muse/inject.js");
    expect(parseMuseSparkIds("use --model muse-spark-1.3 or muse-spark-1.2")).toEqual([
      "muse-spark-1.3",
      "muse-spark-1.2",
    ]);
    expect(parseMuseSparkIds("no models here")).toEqual([]);
  });

  it("listMuseModels honors MUSE_MODELS override", async () => {
    const prev = process.env.MUSE_MODELS;
    process.env.MUSE_MODELS = "muse-spark-lab, muse-spark-other";
    try {
      const { listMuseModels } = await import("../src/providers/muse/inject.js");
      expect(await listMuseModels()).toEqual(["muse-spark-lab", "muse-spark-other"]);
    } finally {
      if (prev === undefined) delete process.env.MUSE_MODELS;
      else process.env.MUSE_MODELS = prev;
    }
  });
});

describe("muse jsonl ingest", () => {
  it("reads session id from stream.id and terminal text", async () => {
    const { ingestMuseJsonLine, createMuseIngestState } = await import(
      "../src/providers/muse/inject.js"
    );
    const state = createMuseIngestState(1_000);
    const logs1 = ingestMuseJsonLine(
      JSON.stringify({
        stream: { kind: "session", id: "01a0ce79-7535-7d92-bca9-b68e3bcf5a01" },
        payload_type: "run.output.delta",
        payload: { text: "Hello" },
      }),
      state,
    );
    expect(state.sessionId).toBe("01a0ce79-7535-7d92-bca9-b68e3bcf5a01");
    expect(logs1.some(([lane]) => lane === "text")).toBe(true);
    expect(logs1.some(([lane, t]) => lane === "meta" && t.includes("first answer"))).toBe(true);
    const logs2 = ingestMuseJsonLine(
      JSON.stringify({
        stream: { kind: "session", id: "01a0ce79-7535-7d92-bca9-b68e3bcf5a01" },
        payload_type: "run.terminal.completed",
        payload: { text: "Hello, world." },
      }),
      state,
    );
    expect(state.resultText).toBe("Hello, world.");
    expect(logs2.some(([lane, t]) => lane === "meta" && t.startsWith("■"))).toBe(true);
  });

  it("surfaces spawn/timing meta from exec --json fixture", async () => {
    const {
      ingestMuseJsonLine,
      createMuseIngestState,
      museExecEnv,
    } = await import("../src/providers/muse/inject.js");
    const { formatDuration } = await import("../src/providers/run-metrics.js");
    expect(formatDuration(4500)).toBe("4.5s");

    const off = museExecEnv(false);
    expect(off.MUSE_EXPERIMENTAL_SKILL_REMINDER).toBe("0");
    expect(off.MUSE_EXPERIMENTAL_VERIFY_REMINDER).toBe("0");
    const on = museExecEnv(true);
    expect(on.MUSE_EXPERIMENTAL_SKILL_REMINDER).toBeUndefined();

    const fixture = path.join(HERE, "fixtures/providers/muse/exec/pong.jsonl");
    expect(fs.existsSync(fixture)).toBe(true);
    const state = createMuseIngestState();
    const all: Array<[string, string]> = [];
    for (const line of fs.readFileSync(fixture, "utf8").split("\n")) {
      if (!line.trim()) continue;
      all.push(...ingestMuseJsonLine(line, state));
    }
    expect(state.deltas.join("")).toContain("pong");
    expect(state.resultText).toBe("pong");
    expect(state.modelId).toMatch(/muse-spark/);
    expect(state.spawnNames).toEqual(
      expect.arrayContaining(["skill-reminder", "verify-reminder"]),
    );
    const metas = all.filter(([lane]) => lane === "meta").map(([, t]) => t);
    expect(metas.some((t) => t.includes("spawn skill-reminder"))).toBe(true);
    expect(metas.some((t) => t.includes("spawn verify-reminder"))).toBe(true);
    expect(metas.some((t) => t.startsWith("■") && t.includes("spawns"))).toBe(true);
    expect(metas.some((t) => t.includes("first answer"))).toBe(true);
    // Reminder spawns stay meta-only; non-reminder tasks get a tool lane.
    const tools = all.filter(([lane]) => lane === "tool").map(([, t]) => t);
    expect(tools.some((t) => /reminder/i.test(t))).toBe(false);
  });

  it("emits tool lane for non-reminder task spawn", async () => {
    const { ingestMuseJsonLine, createMuseIngestState } = await import(
      "../src/providers/muse/inject.js"
    );
    const state = createMuseIngestState(1_000);
    const taskId = "task-shell-1";
    ingestMuseJsonLine(
      JSON.stringify({
        payload_type: "task.lifecycle.proposed",
        payload: {
          task_id: taskId,
          event: { kind: "proposed", task_id: taskId, task_kind: "tool.shell" },
        },
      }),
      state,
    );
    const logs = ingestMuseJsonLine(
      JSON.stringify({
        payload_type: "task.lifecycle.started",
        payload: {
          task_id: taskId,
          event: { kind: "started", task_id: taskId },
        },
      }),
      state,
    );
    expect(logs.some(([lane, t]) => lane === "meta" && t.includes("spawn"))).toBe(true);
    expect(logs.some(([lane]) => lane === "tool")).toBe(true);
    expect(logs.some(([lane, t]) => lane === "tool" && /reminder/i.test(t))).toBe(false);
  });

  it("accumulates tokens from runtime.session model_completed usage", async () => {
    const { ingestMuseJsonLine, createMuseIngestState, museRunSummary } = await import(
      "../src/providers/muse/inject.js"
    );
    const state = createMuseIngestState(1_000);
    ingestMuseJsonLine(
      JSON.stringify({
        stream: { kind: "session", id: "sess-1" },
        payload_type: "runtime.session",
        payload: {
          kind: "run",
          event: {
            kind: "model_completed",
            usage: { input_tokens: 100, output_tokens: 12 },
            model: "muse-spark-1.3",
          },
        },
      }),
      state,
    );
    expect(state.tokensIn).toBe(100);
    expect(state.tokensOut).toBe(12);
    expect(state.modelId).toBe("muse-spark-1.3");
    expect(museRunSummary(state, 1_500)).toMatch(/100→12 tok/);
  });
});
