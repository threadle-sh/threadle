import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-proj-"));
  process.env.THREADLE_CONFIG_DIR = dir;
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.THREADLE_CONFIG_DIR;
});

beforeEach(() => {
  fs.rmSync(path.join(dir, "projects.json"), { force: true });
});

describe("projects store", () => {
  it("creates, updates, and deletes projects", async () => {
    const {
      createProject,
      updateProject,
      deleteProject,
      listProjects,
      getProject,
    } = await import("../src/projects/store.js");

    const a = await createProject({
      name: "threadle",
      dirs: [path.join(dir, "app")],
      workflowIds: ["starter"],
    });
    expect(a.id).toMatch(/^proj_/);
    expect(a.dirs).toHaveLength(1);
    expect(a.workflowIds).toEqual(["starter"]);

    const listed = await listProjects();
    expect(listed).toHaveLength(1);

    const updated = await updateProject(a.id, {
      name: "threadle suite",
      dirs: [path.join(dir, "app"), path.join(dir, "marketing")],
      workflowIds: ["starter", "other"],
      pinned: true,
    });
    expect(updated.name).toBe("threadle suite");
    expect(updated.dirs).toHaveLength(2);
    expect(updated.pinned).toBe(true);

    expect(await getProject(a.id)).not.toBeNull();
    expect(await deleteProject(a.id)).toBe(true);
    expect(await getProject(a.id)).toBeNull();
    expect(await listProjects()).toHaveLength(0);
  });

  it("rejects dirs claimed by another project", async () => {
    const { createProject, ProjectStoreError } = await import(
      "../src/projects/store.js"
    );
    const shared = path.join(dir, "shared-repo");
    await createProject({ name: "one", dirs: [shared] });
    await expect(createProject({ name: "two", dirs: [shared] })).rejects.toBeInstanceOf(
      ProjectStoreError,
    );
  });

  it("dedupes dirs and sorts pinned first", async () => {
    const { createProject, updateProject, listProjects } = await import(
      "../src/projects/store.js"
    );
    const p1 = await createProject({
      name: "plain",
      dirs: [path.join(dir, "a")],
    });
    const p2 = await createProject({
      name: "pinned",
      dirs: [path.join(dir, "b")],
    });
    await updateProject(p2.id, { pinned: true });
    const dup = path.join(dir, "a");
    await updateProject(p1.id, { dirs: [dup, dup, path.join(dir, "c")] });
    const again = await listProjects();
    expect(again[0]!.id).toBe(p2.id);
    expect(again.find((p) => p.id === p1.id)!.dirs).toHaveLength(2);
  });
});
