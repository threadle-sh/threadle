import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  emptyFavoritesIndex,
  favoriteMatchKey,
  favoritesIndexSchema,
  type FavoriteCreate,
  type FavoriteEntry,
  type FavoritesIndex,
} from "@threadle/shared";
import { threadleConfigDir } from "../paths.js";
import { registry } from "../providers/registry.js";
import type { ProviderId } from "@threadle/shared";

function favoritesFile(): string {
  return path.join(threadleConfigDir(), "favorites.json");
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.promises.writeFile(tmp, content, "utf8");
  await fs.promises.rename(tmp, file);
}

function newId(): string {
  return crypto.randomBytes(4).toString("hex");
}

export async function readFavorites(): Promise<FavoritesIndex> {
  try {
    const raw = await fs.promises.readFile(favoritesFile(), "utf8");
    const parsed = favoritesIndexSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data as FavoritesIndex;
  } catch {
    // missing or corrupt — start empty
  }
  return emptyFavoritesIndex();
}

async function writeFavorites(index: FavoritesIndex): Promise<FavoritesIndex> {
  await fs.promises.mkdir(path.dirname(favoritesFile()), { recursive: true });
  await atomicWrite(favoritesFile(), JSON.stringify(index, null, 2));
  return index;
}

function toEntry(input: FavoriteCreate): FavoriteEntry {
  const base = { id: newId(), createdAt: Date.now(), label: input.label };
  switch (input.kind) {
    case "workflow":
      return { ...base, kind: "workflow", graphId: input.graphId };
    case "session":
      return {
        ...base,
        kind: "session",
        provider: input.provider,
        sessionId: input.sessionId,
      };
    case "payload":
      return { ...base, kind: "payload", hash: input.hash, provider: input.provider };
    case "skill":
      return { ...base, kind: "skill", path: input.path, provider: input.provider };
    case "rules":
      return { ...base, kind: "rules", path: input.path, provider: input.provider };
    case "file":
      return { ...base, kind: "file", path: input.path, provider: input.provider };
  }
}

export async function addFavorite(input: FavoriteCreate): Promise<{
  index: FavoritesIndex;
  entry: FavoriteEntry;
  created: boolean;
}> {
  const index = await readFavorites();
  const key = favoriteMatchKey(input as FavoriteEntry);
  const existing = index.items.find((i) => favoriteMatchKey(i) === key);
  if (existing) {
    return { index, entry: existing, created: false };
  }
  const entry = toEntry(input);
  const next = await writeFavorites({
    schemaVersion: 1,
    items: [entry, ...index.items],
  });
  return { index: next, entry, created: true };
}

export async function removeFavorite(id: string): Promise<FavoritesIndex> {
  const index = await readFavorites();
  return writeFavorites({
    schemaVersion: 1,
    items: index.items.filter((i) => i.id !== id),
  });
}

export async function targetAlive(entry: FavoriteEntry): Promise<boolean> {
  switch (entry.kind) {
    case "workflow": {
      const { readGraph } = await import("../graphs/store.js");
      return !!(await readGraph(entry.graphId));
    }
    case "session": {
      const p = registry.providers.get(entry.provider as ProviderId);
      if (!p) return false;
      try {
        const ref = await p.getSession(entry.sessionId);
        return !!ref;
      } catch {
        return false;
      }
    }
    case "payload": {
      const { readPayload } = await import("../context/store.js");
      return !!(await readPayload(entry.hash));
    }
    case "skill":
    case "rules":
    case "file":
      try {
        await fs.promises.access(entry.path);
        return true;
      } catch {
        return false;
      }
  }
}

export async function listFavoritesAlive(): Promise<
  Array<FavoriteEntry & { alive: boolean }>
> {
  const index = await readFavorites();
  return Promise.all(
    index.items.map(async (item) => ({
      ...item,
      alive: await targetAlive(item),
    })),
  );
}

export async function pruneMissingFavorites(): Promise<{
  index: FavoritesIndex;
  removed: number;
}> {
  const alive = await listFavoritesAlive();
  const kept = alive.filter((i) => i.alive).map(({ alive: _a, ...rest }) => rest);
  const removed = alive.length - kept.length;
  if (removed === 0) {
    return { index: await readFavorites(), removed: 0 };
  }
  const index = await writeFavorites({ schemaVersion: 1, items: kept });
  return { index, removed };
}
