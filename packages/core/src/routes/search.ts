import { Hono } from "hono";
import { search } from "../search.js";

export const searchRoutes = new Hono();

const PROVIDERS = new Set([
  "claude-code",
  "opencode",
  "cursor",
  "antigravity",
  "codex",
  "copilot",
  "grok",
  "muse",
  "payload",
]);
const ROLES = new Set(["user", "assistant"]);
const DOC_TYPES = new Set(["message", "payload"]);

searchRoutes.get("/", async (c) => {
  const q = c.req.query("q")?.trim();
  if (!q) return c.json({ results: [] });
  const limit = Math.min(100, Number(c.req.query("limit") ?? 40));
  const provider = c.req.query("provider");
  const role = c.req.query("role");
  const docType = c.req.query("doctype");
  const results = await search(q, limit, {
    provider: provider && PROVIDERS.has(provider) ? provider : undefined,
    role: role && ROLES.has(role) ? role : undefined,
    docType: docType && DOC_TYPES.has(docType) ? docType : undefined,
  });
  return c.json({ results });
});
