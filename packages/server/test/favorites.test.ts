import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-fav-"));
  process.env.THREADLE_CONFIG_DIR = dir;
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.THREADLE_CONFIG_DIR;
});

beforeEach(() => {
  fs.rmSync(path.join(dir, "favorites.json"), { force: true });
});

describe("favorites store", () => {
  it("adds, dedupes, and removes entries", async () => {
    const { addFavorite, readFavorites, removeFavorite } = await import(
      "../src/favorites/store.js"
    );

    const a = await addFavorite({
      kind: "workflow",
      graphId: "g1",
      label: "Demo",
    });
    expect(a.created).toBe(true);
    expect(a.entry.kind).toBe("workflow");
    expect(a.entry.label).toBe("Demo");

    const again = await addFavorite({
      kind: "workflow",
      graphId: "g1",
      label: "Other",
    });
    expect(again.created).toBe(false);
    expect(again.entry.id).toBe(a.entry.id);

    let idx = await readFavorites();
    expect(idx.items).toHaveLength(1);

    idx = await removeFavorite(a.entry.id);
    expect(idx.items).toHaveLength(0);
  });

  it("marks missing path targets and prunes them", async () => {
    const { addFavorite, listFavoritesAlive, pruneMissingFavorites } =
      await import("../src/favorites/store.js");

    const missing = path.join(dir, "no-such-skill.md");
    await addFavorite({
      kind: "skill",
      path: missing,
      label: "gone",
    });

    const alive = await listFavoritesAlive();
    expect(alive).toHaveLength(1);
    expect(alive[0]!.alive).toBe(false);

    const pruned = await pruneMissingFavorites();
    expect(pruned.removed).toBe(1);
    expect(pruned.index.items).toHaveLength(0);
  });
});
