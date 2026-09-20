import { Hono } from "hono";
import { registry } from "../providers/registry.js";

/** Fallback when the UI doesn't pass ?projectDir= — set at server startup. */
export let defaultProjectDir: string | undefined;
export function setDefaultProjectDir(dir: string): void {
  defaultProjectDir = dir;
}

export const agentRoutes = new Hono();

agentRoutes.get("/", async (c) => {
  const projectDir = c.req.query("projectDir") || defaultProjectDir;
  const lists = await Promise.all(
    [...registry.providers.values()].map(async (p) => {
      try {
        if (!(await p.available())) return [];
        return await p.listAgents({ projectDir });
      } catch (err) {
        console.warn(`threadle: listAgents failed for ${p.id}: ${String(err)}`);
        return [];
      }
    }),
  );
  return c.json(lists.flat());
});
