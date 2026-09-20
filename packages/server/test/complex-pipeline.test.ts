import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { portableGraphSchema, type Graph } from "@threadle/shared";
import {
  buildComplexPipelinePortable,
  COMPLEX_PIPELINE_ID,
  COMPLEX_PIPELINE_SUBGRAPHS,
  seedComplexDelayPipeline,
} from "../src/templates/complex-pipeline.js";
import { getWorkflowTemplate } from "../src/templates/workflows.js";
import { importGraph, listGraphs, readGraph, saveGraph } from "../src/graphs/store.js";
import { executeWorkflow } from "../src/workflows/executor.js";

function outputText(g: Graph): string | undefined {
  const out = g.nodes.find((n) => n.data.type === "output");
  return out?.data.type === "output" ? out.data.content : undefined;
}

describe("complex-delay-pipeline", () => {
  let prevConfig: string | undefined;
  let tmp: string;

  beforeEach(() => {
    prevConfig = process.env.THREADLE_CONFIG_DIR;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-cp-"));
    process.env.THREADLE_CONFIG_DIR = tmp;
  });

  afterEach(() => {
    if (prevConfig === undefined) delete process.env.THREADLE_CONFIG_DIR;
    else process.env.THREADLE_CONFIG_DIR = prevConfig;
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("ships five subgraphs + a valid portable parent", () => {
    expect(COMPLEX_PIPELINE_SUBGRAPHS).toHaveLength(5);
    const portable = buildComplexPipelinePortable();
    expect(portableGraphSchema.safeParse(portable).success).toBe(true);
    const frames = portable.nodes.filter(
      (n) => n.data.type === "group" && !!n.data.graphId,
    );
    expect(frames).toHaveLength(5);
    expect(getWorkflowTemplate(COMPLEX_PIPELINE_ID)?.level).toBe("expert");
  });

  it("seed creates linked parent + 5 subgraphs", async () => {
    const parent = await seedComplexDelayPipeline();
    expect(parent.kind).toBe("workflow");
    const frames = parent.nodes.filter(
      (n) => n.data.type === "group" && !!n.data.graphId,
    );
    expect(frames).toHaveLength(5);
    for (const f of frames) {
      if (f.data.type !== "group" || !f.data.graphId) continue;
      const sg = await readGraph(f.data.graphId);
      expect(sg?.kind).toBe("subgraph");
      expect(sg!.nodes.length).toBeGreaterThan(0);
    }
    const all = await listGraphs();
    expect(all.filter((g) => g.kind === "subgraph").length).toBeGreaterThanOrEqual(5);
  });

  it("runs end-to-end with short delays (no agents)", async () => {
    const portable = buildComplexPipelinePortable();
    for (const n of portable.nodes) {
      if (n.data.type === "delay") n.data.ms = 15;
    }
    const imported = await importGraph(portable, { trusted: true });
    await saveGraph(imported);
    await executeWorkflow({
      graphId: imported.id,
      params: { topic: "demo topic", runId: "t1" },
      approveAll: true,
      projectDir: tmp,
      log: () => {},
      signal: new AbortController().signal,
    });
    const done = (await readGraph(imported.id))!;
    const text = outputText(done) ?? "";
    expect(done.nodes.find((n) => n.data.type === "output")?.status).toBe("success");
    expect(text).toMatch(/demo topic/i);
    expect(text).toMatch(/Fast lane/i);
    expect(text).toMatch(/Deep lane/i);
    expect(text).toMatch(/assembled at t1/);
    expect(text).toMatch(/seal:\*\* ok|seal.*ok/i);
  });
});
