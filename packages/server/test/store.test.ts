import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-store-"));
  process.env.THREADLE_CONFIG_DIR = dir;
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.THREADLE_CONFIG_DIR;
});

describe("payload store", () => {
  it("content-addresses payloads and dedups identical content", async () => {
    const { storePayload, readPayload, hashPayload } = await import(
      "../src/context/store.js"
    );
    const input = {
      kind: "transcript-excerpt" as const,
      createdAt: 1,
      source: { provider: "opencode" as const, sessionId: "ses_a" },
      content: "hello world",
      meta: {},
    };
    const a = await storePayload(input);
    const b = await storePayload({ ...input, createdAt: 999 });
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe(hashPayload(input));
    const read = await readPayload(a.hash);
    expect(read?.content).toBe("hello world");
    expect(await readPayload("nope")).toBeUndefined();
  });
});

describe("graph store error statuses", () => {
  it("rejects invalid graphs with a 400-class status", async () => {
    const { saveGraph } = await import("../src/graphs/store.js");
    await expect(
      saveGraph({ id: "x", name: "", schemaVersion: 2 } as never),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("empty graphs are not persisted", () => {
  it("createGraph stays ephemeral until nodes are saved", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { createGraph, saveGraph, readGraph, listGraphs, deleteGraph } =
      await import("../src/graphs/store.js");

    const created = await createGraph("Scratch", { kind: "workflow" });
    const file = path.join(dir, "graphs", `${created.id}.json`);
    expect(fs.existsSync(file)).toBe(false);
    expect(await readGraph(created.id)).toMatchObject({ id: created.id, name: "Scratch" });
    expect((await listGraphs()).some((g) => g.id === created.id)).toBe(false);

    created.nodes = [
      {
        id: "n1",
        type: "prompt",
        position: { x: 0, y: 0 },
        status: "idle",
        data: { type: "prompt", text: "hi" },
      },
    ];
    const saved = await saveGraph(created);
    expect(fs.existsSync(file)).toBe(true);
    expect(saved.nodes).toHaveLength(1);
    expect((await listGraphs()).some((g) => g.id === created.id)).toBe(true);

    saved.nodes = [];
    await saveGraph(saved);
    expect(fs.existsSync(file)).toBe(false);
    expect(await readGraph(created.id)).toMatchObject({ id: created.id, nodes: [] });
    expect((await listGraphs()).some((g) => g.id === created.id)).toBe(false);

    await deleteGraph(created.id);
  });

  it("listGraphs purges empty files left on disk", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { listGraphs, readGraph } = await import("../src/graphs/store.js");

    const graphsPath = path.join(dir, "graphs");
    fs.mkdirSync(graphsPath, { recursive: true });
    const id = "emptyold";
    fs.writeFileSync(
      path.join(graphsPath, `${id}.json`),
      JSON.stringify({
        id,
        name: "Orphan empty",
        schemaVersion: 1,
        kind: "workflow",
        nodes: [],
        edges: [],
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await listGraphs();
    expect(fs.existsSync(path.join(graphsPath, `${id}.json`))).toBe(false);
    expect(await readGraph(id)).toBeUndefined();
  });
});
