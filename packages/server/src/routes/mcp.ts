import { Hono } from "hono";
import {
  discoverMcpServers,
  threadleMcpDir,
  threadleMcpRegistryPath,
} from "../mcp/discover.js";
import { toPublicMcpServerRow } from "../mcp/public.js";
import {
  callMcpTool,
  listMcpTools,
} from "../mcp/client.js";
import { defaultProjectDir } from "./agents.js";
import { readSettings } from "./settings.js";
import { isKnownProjectDir } from "../readable-paths.js";

export const mcpRoutes = new Hono();

/**
 * Resolve the discovery dir for a request. A caller-supplied dir must be a
 * known project dir — discovery reads `.mcp.json` from it (and ancestors) and
 * `/servers/:id/tools` will SPAWN whatever command those files name, so an
 * arbitrary dir here is arbitrary code execution.
 */
async function projectDirOf(
  c: { req: { query: (k: string) => string | undefined } },
  bodyDir?: string,
): Promise<string> {
  const requested = bodyDir || c.req.query("dir") || c.req.query("projectDir");
  if (requested) {
    if (!(await isKnownProjectDir(requested))) {
      throw new HttpDirError(`dir is not a known project directory: ${requested}`);
    }
    return requested;
  }
  return defaultProjectDir || process.cwd();
}

class HttpDirError extends Error {}

mcpRoutes.get("/servers", async (c) => {
  const settings = await readSettings();
  let dir: string;
  try {
    dir = await projectDirOf(c);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 403);
  }
  const all = await discoverMcpServers(dir);
  const disabled = new Set(settings.mcpDisabledServers ?? []);
  return c.json({
    servers: all.map((s) => toPublicMcpServerRow(s, { disabled: disabled.has(s.id) })),
    mcpClientEnabled: settings.mcpClientEnabled !== false,
    mcpDisabledServers: settings.mcpDisabledServers ?? [],
    registryPath: threadleMcpRegistryPath(),
    registryDir: threadleMcpDir(),
  });
});

mcpRoutes.get("/servers/:id/tools", async (c) => {
  const id = c.req.param("id");
  let dir: string;
  try {
    dir = await projectDirOf(c);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 403);
  }
  try {
    const { server, tools, stderr } = await listMcpTools(dir, id);
    const row = toPublicMcpServerRow(server);
    return c.json({
      server: {
        id: row.id,
        label: row.label,
        source: row.source,
        transport: row.transport,
        command: row.command,
        args: row.args,
        cwd: row.cwd,
        url: row.url,
        envKeys: row.envKeys,
        headerKeys: row.headerKeys,
        threadle: row.threadle,
      },
      tools,
      stderr: stderr || undefined,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

mcpRoutes.post("/call", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    server?: string;
    tool?: string;
    args?: Record<string, unknown>;
    params?: Record<string, string>;
    dir?: string;
    projectDir?: string;
  };
  if (!body.server || !body.tool) {
    return c.json({ error: "server and tool are required" }, 400);
  }
  const args: Record<string, unknown> = { ...(body.args ?? {}) };
  if (body.params) {
    for (const [k, v] of Object.entries(body.params)) {
      if (!(k in args)) args[k] = v;
    }
  }
  let dir: string;
  try {
    dir = await projectDirOf(c, body.dir || body.projectDir);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 403);
  }
  try {
    const res = await callMcpTool({
      projectDir: dir,
      serverId: body.server,
      tool: body.tool,
      args,
    });
    if (res.isError) return c.json({ error: res.text, output: res.text, stderr: res.stderr }, 400);
    return c.json({ output: res.text, stderr: res.stderr || undefined });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});
