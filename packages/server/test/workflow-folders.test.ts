import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-folders-"));
  process.env.THREADLE_CONFIG_DIR = dir;
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.THREADLE_CONFIG_DIR;
});

beforeEach(() => {
  fs.rmSync(path.join(dir, "workflow-folders.json"), { force: true });
});

describe("workflow folders", () => {
  it("creates nested folders and places graphs", async () => {
    const {
      createFolder,
      placeGraph,
      readFolderIndex,
      moveFolder,
      deleteFolder,
      renameFolder,
    } = await import("../src/graphs/folders.js");

    let idx = await createFolder("evals");
    const evals = idx.folders[0]!;
    expect(evals.name).toBe("evals");
    expect(evals.parentId).toBeNull();

    idx = await createFolder("nightly", evals.id);
    const nightly = idx.folders.find((f) => f.name === "nightly")!;
    expect(nightly.parentId).toBe(evals.id);

    idx = await placeGraph("g1", nightly.id);
    expect(idx.placements.g1).toBe(nightly.id);

    idx = await renameFolder(evals.id, "evaluation");
    expect(idx.folders.find((f) => f.id === evals.id)?.name).toBe("evaluation");

    // move nightly to root
    idx = await moveFolder(nightly.id, null);
    expect(idx.folders.find((f) => f.id === nightly.id)?.parentId).toBeNull();

    // delete root nightly → g1 goes to root
    idx = await deleteFolder(nightly.id);
    expect(idx.folders.some((f) => f.id === nightly.id)).toBe(false);
    expect(idx.placements.g1).toBeUndefined();

    // place into evals then delete evals → promote
    idx = await placeGraph("g1", evals.id);
    idx = await createFolder("child", evals.id);
    const child = idx.folders.find((f) => f.name === "child")!;
    idx = await deleteFolder(evals.id);
    expect(idx.folders.find((f) => f.id === child.id)?.parentId).toBeNull();
    expect(idx.placements.g1).toBeUndefined();

    expect(await readFolderIndex()).toMatchObject({ schemaVersion: 1 });
  });

  it("rejects cyclic folder moves", async () => {
    const { createFolder, moveFolder } = await import("../src/graphs/folders.js");
    let idx = await createFolder("a");
    const a = idx.folders[0]!;
    idx = await createFolder("b", a.id);
    const b = idx.folders.find((f) => f.name === "b")!;
    await expect(moveFolder(a.id, b.id)).rejects.toMatchObject({ status: 400 });
  });

  it("ensures nested folder paths (find-or-create)", async () => {
    const { ensureFolderPath, placeGraph, readFolderIndex } = await import(
      "../src/graphs/folders.js"
    );
    let res = await ensureFolderPath(["foo", "bar"]);
    expect(res.folderId).toBeTruthy();
    const bar = res.index.folders.find((f) => f.id === res.folderId)!;
    expect(bar.name).toBe("bar");
    const foo = res.index.folders.find((f) => f.id === bar.parentId)!;
    expect(foo.name).toBe("foo");
    expect(foo.parentId).toBeNull();

    // second call reuses the same folders
    const again = await ensureFolderPath(["foo", "bar"]);
    expect(again.folderId).toBe(res.folderId);
    expect(again.index.folders.filter((f) => f.name === "foo")).toHaveLength(1);

    await placeGraph("workflow-123", again.folderId);
    const idx = await readFolderIndex();
    expect(idx.placements["workflow-123"]).toBe(again.folderId);
  });
});

describe("parseWorkflowPath", () => {
  it("splits foo/bar/workflow-123", async () => {
    const { parseWorkflowPath, formatWorkflowPath, folderNamesForGraph } = await import(
      "@threadle/shared"
    );
    expect(parseWorkflowPath("foo/bar/workflow-123")).toEqual({
      folders: ["foo", "bar"],
      name: "workflow-123",
      hasPath: true,
    });
    expect(parseWorkflowPath("foo / bar / workflow-123")).toEqual({
      folders: ["foo", "bar"],
      name: "workflow-123",
      hasPath: true,
    });
    expect(parseWorkflowPath("just-a-name")).toEqual({
      folders: [],
      name: "just-a-name",
      hasPath: false,
    });
    expect(formatWorkflowPath(["foo", "bar"], "workflow-123")).toBe(
      "foo / bar / workflow-123",
    );
    expect(
      folderNamesForGraph(
        {
          schemaVersion: 1,
          folders: [
            { id: "1", name: "foo", parentId: null, createdAt: 0, updatedAt: 0 },
            { id: "2", name: "bar", parentId: "1", createdAt: 0, updatedAt: 0 },
          ],
          placements: { g: "2" },
        },
        "g",
      ),
    ).toEqual(["foo", "bar"]);
  });
});
