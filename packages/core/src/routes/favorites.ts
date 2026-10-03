import { Hono } from "hono";
import { favoriteCreateSchema } from "@threadle/shared";
import {
  addFavorite,
  listFavoritesAlive,
  pruneMissingFavorites,
  readFavorites,
  removeFavorite,
} from "../favorites/store.js";

export const favoriteRoutes = new Hono();

favoriteRoutes.get("/", async (c) => {
  const check = c.req.query("check") === "1" || c.req.query("check") === "true";
  if (check) {
    return c.json({ items: await listFavoritesAlive() });
  }
  const index = await readFavorites();
  return c.json({ items: index.items });
});

favoriteRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = favoriteCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid favorite" }, 400);
  }
  const result = await addFavorite(parsed.data);
  return c.json(result, result.created ? 201 : 200);
});

favoriteRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "missing id" }, 400);
  const index = await removeFavorite(id);
  return c.json({ items: index.items });
});

favoriteRoutes.post("/prune", async (c) => {
  const result = await pruneMissingFavorites();
  return c.json({ items: result.index.items, removed: result.removed });
});
