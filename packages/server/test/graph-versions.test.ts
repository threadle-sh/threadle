import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-versions-"));
  process.env.THREADLE_CONFIG_DIR = dir;
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.THREADLE_CONFIG_DIR;
});

function sampleGraph(id: string, name: string, text: string) {
  return {
    id,
    name,
    schemaVersion: 1 as const,
    kind: "workflow" as const,
    nodes: [
      {
        id: "n1",
        type: "prompt" as const,
        position: { x: 0, y: 0 },
        status: "idle" as const,
        data: { type: "prompt" as const, text },
      },
    ],
    edges: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("graph version history", () => {
  it("snapshots previous content on save and restores", async () => {
    const {
      saveGraph,
      readGraph,
      listGraphVersions,
      readGraphVersion,
      restoreGraphVersion,
    } = await import("../src/graphs/store.js");

    const g = sampleGraph("ver1", "V1", "first");
    await saveGraph(g);
    expect(await listGraphVersions("ver1")).toHaveLength(0);

    await saveGraph({ ...g, name: "V2", nodes: [{ ...g.nodes[0]!, data: { type: "prompt", text: "second" } }] });
    const versions = await listGraphVersions("ver1");
    expect(versions.length).toBe(1);
    const snap = await readGraphVersion("ver1", versions[0]!.ts);
    expect(snap?.name).toBe("V1");
    expect(snap?.nodes[0]?.data.type === "prompt" && snap.nodes[0].data.text).toBe("first");

    await saveGraph({
      ...g,
      name: "V3",
      nodes: [{ ...g.nodes[0]!, data: { type: "prompt", text: "third" } }],
    });
    expect((await listGraphVersions("ver1")).length).toBe(2);

    const restored = await restoreGraphVersion("ver1", versions[0]!.ts);
    expect(restored?.name).toBe("V1");
    const current = await readGraph("ver1");
    expect(current?.name).toBe("V1");
    // restore itself snapshots V3 first
    expect((await listGraphVersions("ver1")).length).toBeGreaterThanOrEqual(2);
  });

  it("caps versions at 30", async () => {
    const { saveGraph, listGraphVersions, versionStamp } = await import(
      "../src/graphs/store.js"
    );
    const g = sampleGraph("cap30", "Cap", "n");
    await saveGraph(g);
    // Seed many version files directly to avoid slow sequential saves with same-ms stamps
    const vdir = path.join(dir, "graphs", "versions", "cap30");
    fs.mkdirSync(vdir, { recursive: true });
    for (let i = 0; i < 35; i++) {
      const stamp = `2020-01-01T00-00-${String(i).padStart(2, "0")}.000Z`;
      fs.writeFileSync(
        path.join(vdir, `${stamp}.json`),
        JSON.stringify(sampleGraph("cap30", `n${i}`, `t${i}`)),
      );
    }
    // Trigger trim via another save
    await saveGraph({ ...g, name: "Cap2", nodes: [{ ...g.nodes[0]!, data: { type: "prompt", text: "x" } }] });
    const versions = await listGraphVersions("cap30");
    expect(versions.length).toBeLessThanOrEqual(30);
    expect(versionStamp()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
