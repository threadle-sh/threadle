import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  coerceParamsToMcpArgs,
  coerceToolArgsToParams,
  graphIdFromToolName,
  paramsToZodSchema,
  toolNameForGraphId,
  valueToStringParam,
} from "../src/mcp/schema.js";
import { assertMcpInvokeAllowed } from "../src/mcp/workflow-tools.js";
import { buildMcpClientEnv } from "../src/mcp/client.js";
import {
  CHILD_ENV_ALLOWLIST,
  allowlistedProcessEnv,
  childProcessEnv,
} from "../src/safe-env.js";
import { _test as mcpDiscover, discoverMcpServers } from "../src/mcp/discover.js";
import { isAbsolutePath, editorFileUri, pathBasename } from "@threadle/shared";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("platform paths", () => {
  it("detects unix and windows absolute paths", () => {
    expect(isAbsolutePath("/Users/a")).toBe(true);
    expect(isAbsolutePath("C:\\Users\\a")).toBe(true);
    expect(isAbsolutePath("C:/Users/a")).toBe(true);
    expect(isAbsolutePath("\\\\server\\share")).toBe(true);
    expect(isAbsolutePath("relative/path")).toBe(false);
    expect(isAbsolutePath("")).toBe(false);
  });

  it("builds editor URIs with a leading slash for Windows drives", () => {
    expect(editorFileUri("vscode", "/tmp/x.ts")).toBe("vscode://file/tmp/x.ts");
    expect(editorFileUri("cursor", "C:\\Users\\a\\f.ts")).toBe("cursor://file/C:/Users/a/f.ts");
  });

  it("pathBasename handles both separators", () => {
    expect(pathBasename("/a/b/c.txt")).toBe("c.txt");
    expect(pathBasename("C:\\a\\b\\c.txt")).toBe("c.txt");
  });
});

describe("MCP workflow schema", () => {
  it("maps params to zod and coerces args to strings", () => {
    const schema = paramsToZodSchema([
      { name: "task", type: "text", description: "what to do" },
      { name: "n", type: "int" },
      { name: "ok", type: "bool" },
      { name: "cfg", type: "json" },
    ]);
    const parsed = schema.safeParse({ task: "hi", n: 3, ok: true, cfg: { a: 1 } });
    expect(parsed.success).toBe(true);

    const params = coerceToolArgsToParams(
      { task: "hi", n: 3, ok: true, cfg: { a: 1 } },
      [
        { name: "task", type: "text" },
        { name: "n", type: "int" },
        { name: "ok", type: "bool" },
        { name: "cfg", type: "json" },
      ],
    );
    expect(params).toEqual({
      task: "hi",
      n: "3",
      ok: "true",
      cfg: '{"a":1}',
    });
  });

  it("tool name round-trips graph id", () => {
    expect(toolNameForGraphId("starter")).toBe("wf_starter");
    expect(graphIdFromToolName("wf_starter")).toBe("starter");
    expect(graphIdFromToolName("other")).toBeUndefined();
  });

  it("valueToStringParam covers types", () => {
    expect(valueToStringParam(false, "bool")).toBe("false");
    expect(valueToStringParam({ x: 1 }, "json")).toBe('{"x":1}');
    expect(valueToStringParam(1.5, "float")).toBe("1.5");
  });

  it("coerceParamsToMcpArgs parses inspector strings for tool schemas", () => {
    const args = coerceParamsToMcpArgs(
      {
        connectionId: "preconfigured",
        database: "test",
        collection: "userprofiles",
        filter: '{"email":"demo@example.com"}',
        limit: "1",
        skipEmpty: "",
      },
      [
        { name: "connectionId", type: "text" },
        { name: "database", type: "text" },
        { name: "collection", type: "text" },
        { name: "filter", type: "json" },
        { name: "limit", type: "int" },
        { name: "skipEmpty", type: "json" },
      ],
    );
    expect(args).toEqual({
      connectionId: "preconfigured",
      database: "test",
      collection: "userprofiles",
      filter: { email: "demo@example.com" },
      limit: 1,
    });
  });
});

describe("MCP recursion guards", () => {
  const envKeys = ["THREADLE_MCP_DEPTH", "THREADLE_MCP_STACK"] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of envKeys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("allows first call", () => {
    expect(() => assertMcpInvokeAllowed("abc")).not.toThrow();
  });

  it("refuses when depth ≥ 1", () => {
    process.env.THREADLE_MCP_DEPTH = "1";
    expect(() => assertMcpInvokeAllowed("abc")).toThrow(/recursion/i);
  });

  it("refuses same graphId re-entry via stack", () => {
    process.env.THREADLE_MCP_STACK = "abc,def";
    expect(() => assertMcpInvokeAllowed("abc")).toThrow(/re-entry/i);
  });
});

describe("child process env allowlist", () => {
  const probe = "THREADLE_TEST_SECRET_KEY";
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[probe];
    process.env[probe] = "should-not-leak";
    process.env.PATH = process.env.PATH ?? "/usr/bin";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[probe];
    else process.env[probe] = saved;
  });

  it("allowlistedProcessEnv omits secrets", () => {
    const env = allowlistedProcessEnv();
    expect(env[probe]).toBeUndefined();
    expect(env.PATH).toBe(process.env.PATH);
    for (const k of CHILD_ENV_ALLOWLIST) {
      if (process.env[k] !== undefined) expect(env[k]).toBe(process.env[k]);
    }
  });

  it("childProcessEnv merges explicit extras on top", () => {
    const env = childProcessEnv({ MY_TOKEN: "from-mcp-json" });
    expect(env.MY_TOKEN).toBe("from-mcp-json");
    expect(env[probe]).toBeUndefined();
  });

  it("MCP client env matches custom-node allowlist + server.env", () => {
    const env = buildMcpClientEnv({ API_KEY: "declared" });
    expect(env.API_KEY).toBe("declared");
    expect(env[probe]).toBeUndefined();
    expect(env.PATH).toBe(process.env.PATH);
  });
});

describe("MCP discovery", () => {
  it("parses JSON mcpServers including HTTP remotes", () => {
    const servers = mcpDiscover.parseMcpServersObject(
      {
        mcpServers: {
          local: { command: "npx", args: ["-y", "echo"] },
          remote: { url: "https://example.com/mcp", transport: "streamable-http" },
          legacySse: { serverUrl: "https://example.com/sse", type: "sse" },
          off: { command: "x", enabled: false },
        },
      },
      "/tmp/test.mcp.json",
      "/tmp",
    );
    expect(servers.map((s) => s.id).sort()).toEqual(["legacySse", "local", "remote"]);
    expect(servers.find((s) => s.id === "local")?.transport).toBe("stdio");
    expect(servers.find((s) => s.id === "remote")).toMatchObject({
      transport: "streamable-http",
      url: "https://example.com/mcp",
    });
    expect(servers.find((s) => s.id === "legacySse")?.transport).toBe("sse");
  });

  it("parses Codex TOML mcp_servers", () => {
    const servers = mcpDiscover.parseCodexMcpToml(
      `
[mcp_servers.docs]
command = "npx"
args = ["-y", "docs-mcp"]
env = { "TOKEN" = "abc" }

[mcp_servers.httpish]
url = "https://example.com"
command = "ignored"
`,
      "/tmp/config.toml",
    );
    expect(servers.map((s) => s.id).sort()).toEqual(["docs", "httpish"]);
    expect(servers.find((s) => s.id === "docs")).toMatchObject({
      transport: "stdio",
      command: "npx",
      args: ["-y", "docs-mcp"],
      env: { TOKEN: "abc" },
    });
    expect(servers.find((s) => s.id === "httpish")?.transport).toBe("streamable-http");
  });

  it("parses alternate JSON shapes (servers / mcp.servers)", () => {
    const a = mcpDiscover.parseMcpServersObject(
      { servers: { a: { command: "node", args: ["a.mjs"] } } },
      "/tmp/a.json",
    );
    expect(a.map((s) => s.id)).toEqual(["a"]);
    const b = mcpDiscover.parseMcpServersObject(
      { mcp: { servers: { b: { command: "node", args: ["b.mjs"] } } } },
      "/tmp/b.json",
    );
    expect(b.map((s) => s.id)).toEqual(["b"]);
  });

  it("walks up to git root for project .mcp.json", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "threadle-mcp-walk-"));
    const nested = path.join(root, "packages", "server");
    await fs.promises.mkdir(nested, { recursive: true });
    await fs.promises.mkdir(path.join(root, ".git")); // marker
    await fs.promises.writeFile(
      path.join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { rooty: { command: "node", args: ["r.mjs"] } } }),
    );

    try {
      const servers = await discoverMcpServers(nested);
      expect(servers.map((s) => s.id)).toContain("rooty");
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it("discovers Antigravity mcp_config.json and project .mcp.json", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "threadle-mcp-"));
    const project = path.join(root, "proj");
    await fs.promises.mkdir(project, { recursive: true });
    await fs.promises.mkdir(path.join(root, ".gemini", "config"), { recursive: true });
    await fs.promises.writeFile(
      path.join(project, ".mcp.json"),
      JSON.stringify({ mcpServers: { echo: { command: "node", args: ["echo.mjs"] } } }),
    );
    await fs.promises.writeFile(
      path.join(root, ".gemini", "config", "mcp_config.json"),
      JSON.stringify({ mcpServers: { agy: { command: "agy-helper", args: [] } } }),
    );

    const prevHome = process.env.HOME;
    const prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = root;
    process.env.USERPROFILE = root;

    try {
      const servers = await discoverMcpServers(project);
      const ids = servers.map((s) => s.id).sort();
      expect(ids).toEqual(["agy", "echo"]);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevUserProfile;
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it("reads ~/.config/threadle/mcp/servers.json registry", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "threadle-mcp-reg-"));
    const project = path.join(root, "proj");
    const cfg = path.join(root, "cfg");
    await fs.promises.mkdir(project, { recursive: true });
    await fs.promises.mkdir(path.join(cfg, "mcp"), { recursive: true });
    await fs.promises.writeFile(
      path.join(cfg, "mcp", "servers.json"),
      JSON.stringify({
        mcpServers: {
          remote: { url: "https://example.com/mcp" },
          local: { command: "node", args: ["x.mjs"] },
        },
      }),
    );

    const prev = process.env.THREADLE_CONFIG_DIR;
    process.env.THREADLE_CONFIG_DIR = cfg;
    try {
      const servers = await discoverMcpServers(project);
      expect(servers.map((s) => s.id).sort()).toEqual(["local", "remote"]);
      expect(servers.find((s) => s.id === "remote")?.transport).toBe("streamable-http");
      expect(servers.find((s) => s.id === "local")?.source).toContain("servers.json");
    } finally {
      if (prev === undefined) delete process.env.THREADLE_CONFIG_DIR;
      else process.env.THREADLE_CONFIG_DIR = prev;
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});

describe("MCP client settings gates", () => {
  it("filterMcpServersForClient honors disable list and master switch", async () => {
    const { filterMcpServersForClient } = await import("../src/mcp/client.js");
    const sample = [
      {
        id: "a",
        label: "a",
        source: "/tmp",
        transport: "stdio" as const,
        command: "node",
        args: [],
      },
      {
        id: "b",
        label: "b",
        source: "/tmp",
        transport: "stdio" as const,
        command: "node",
        args: [],
      },
    ];

    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "threadle-mcp-set-"));
    const prev = process.env.THREADLE_CONFIG_DIR;
    process.env.THREADLE_CONFIG_DIR = root;
    try {
      await fs.promises.writeFile(
        path.join(root, "settings.json"),
        JSON.stringify({
          editor: { mode: "vscode" },
          mcpClientEnabled: true,
          mcpDisabledServers: ["b"],
        }),
      );
      const filtered = await filterMcpServersForClient(sample);
      expect(filtered.map((s) => s.id)).toEqual(["a"]);

      await fs.promises.writeFile(
        path.join(root, "settings.json"),
        JSON.stringify({
          editor: { mode: "vscode" },
          mcpClientEnabled: false,
          mcpDisabledServers: [],
        }),
      );
      expect(await filterMcpServersForClient(sample)).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.THREADLE_CONFIG_DIR;
      else process.env.THREADLE_CONFIG_DIR = prev;
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it("listWorkflowTools publishes none by default", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "threadle-mcp-deny-"));
    const prev = process.env.THREADLE_CONFIG_DIR;
    process.env.THREADLE_CONFIG_DIR = root;
    try {
      await fs.promises.mkdir(path.join(root, "graphs"), { recursive: true });
      // no settings.json → default empty allowlist
      const { listWorkflowTools } = await import("../src/mcp/workflow-tools.js");
      const tools = await listWorkflowTools();
      expect(tools).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.THREADLE_CONFIG_DIR;
      else process.env.THREADLE_CONFIG_DIR = prev;
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it("listWorkflowTools respects publish allowlist", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "threadle-mcp-allow-"));
    const prev = process.env.THREADLE_CONFIG_DIR;
    process.env.THREADLE_CONFIG_DIR = root;
    try {
      await fs.promises.mkdir(path.join(root, "graphs"), { recursive: true });
      // empty library — allowlist path still runs without throwing
      await fs.promises.writeFile(
        path.join(root, "settings.json"),
        JSON.stringify({
          editor: { mode: "vscode" },
          mcpPublishAllowlist: ["only-this"],
        }),
      );
      const { listWorkflowTools } = await import("../src/mcp/workflow-tools.js");
      const tools = await listWorkflowTools();
      expect(tools.every((t) => t.graphId === "only-this")).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.THREADLE_CONFIG_DIR;
      else process.env.THREADLE_CONFIG_DIR = prev;
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});

describe("MCP client stderr capture", () => {
  it("returns child stderr from the echo demo server", async () => {
    const { callMcpTool } = await import("../src/mcp/client.js");
    const repo = path.resolve(path.join(import.meta.dirname, "../../.."));
    const echo = path.join(repo, "examples/mcp/echo-server.mjs");
    const project = await fs.promises.mkdtemp(path.join(os.tmpdir(), "threadle-mcp-echo-"));
    await fs.promises.writeFile(
      path.join(project, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          echo: { command: "npx", args: ["tsx", echo] },
        },
      }),
    );
    const lines: string[] = [];
    try {
      const res = await callMcpTool({
        projectDir: project,
        serverId: "echo",
        tool: "echo",
        args: { message: "ping" },
        onStderr: (line) => lines.push(line),
      });
      expect(res.text).toBe("ping");
      expect(res.isError).toBeFalsy();
      const combined = [res.stderr, ...lines].join("\n");
      expect(combined).toMatch(/threadle-echo/i);
    } finally {
      await fs.promises.rm(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 30_000);
});

describe("MCP public API rows", () => {
  it("exposes env/header keys but never values", async () => {
    const { toPublicMcpServerRow } = await import("../src/mcp/public.js");
    const row = toPublicMcpServerRow(
      {
        id: "mongodb",
        label: "mongodb",
        source: "/tmp/servers.json",
        transport: "stdio",
        command: "npx",
        args: ["-y", "mongodb-mcp-server"],
        env: { MDB_MCP_CONNECTION_STRING: "mongodb://secret@127.0.0.1:27017" },
        headers: { Authorization: "Bearer secret" },
      },
      { disabled: true },
    );
    expect(row.envKeys).toEqual(["MDB_MCP_CONNECTION_STRING"]);
    expect(row.headerKeys).toEqual(["Authorization"]);
    expect(JSON.stringify(row)).not.toMatch(/secret|Bearer|27017/);
    expect(row.disabled).toBe(true);
    expect(row.command).toBe("npx");
  });
});

describe("MCP details / probe formatters", () => {
  it("formatMcpInfoMarkdown includes connection + selected tool schema", async () => {
    const { formatMcpInfoMarkdown } = await import("@threadle/shared");
    const md = formatMcpInfoMarkdown({
      server: {
        id: "mongodb",
        label: "mongodb",
        source: "/tmp/servers.json",
        transport: "stdio",
        command: "npx",
        args: ["-y", "mongodb-mcp-server"],
        envKeys: ["MDB_MCP_CONNECTION_STRING"],
      },
      tools: [
        {
          name: "find",
          description: "Run a find query",
          inputSchema: {
            type: "object",
            properties: { database: { type: "string" } },
            required: ["database"],
          },
        },
        { name: "list-databases" },
      ],
      selectedTool: "find",
      projectDir: "/tmp/proj",
    });
    expect(md).toContain("# ◈ MCP · mongodb");
    expect(md).toContain("MDB_MCP_CONNECTION_STRING");
    expect(md).toContain("### `find` ← selected");
    expect(md).toContain('"database"');
    expect(md).toContain("values** are omitted");
    expect(md).not.toMatch(/mongodb:\/\//);
  });

  it("pickMcpDeepProbeTool prefers list-databases", async () => {
    const { pickMcpDeepProbeTool, mcpDeepProbeArgs } = await import("@threadle/shared");
    expect(pickMcpDeepProbeTool(["find", "list-databases"])).toBe("list-databases");
    expect(pickMcpDeepProbeTool(["list-connections"])).toBe("list-connections");
    expect(pickMcpDeepProbeTool(["find"])).toBeUndefined();
    expect(mcpDeepProbeArgs("list-databases")).toEqual({ connectionId: "preconfigured" });
    expect(mcpDeepProbeArgs("list-connections")).toEqual({});
  });

  it("summarizeMcpProbe + formatMcpProbeLine cover ok / missing tool / deep fail", async () => {
    const { summarizeMcpProbe, formatMcpProbeLine } = await import("@threadle/shared");

    const ok = summarizeMcpProbe({
      ms: 120,
      toolNames: ["find", "list-databases"],
      selectedTool: "find",
      deepTool: "list-databases",
      deepOk: true,
      deepPreview: "Found 2 databases",
    });
    expect(ok.ok).toBe(true);
    expect(formatMcpProbeLine(ok)).toBe(
      "✓ connected · 120ms · 2 tools · tool ok · list-databases ok",
    );

    const missing = summarizeMcpProbe({
      ms: 10,
      toolNames: ["find"],
      selectedTool: "aggregate",
    });
    expect(missing.ok).toBe(false);
    expect(formatMcpProbeLine(missing)).toMatch(/tool "aggregate" not on server/);

    const deepFail = summarizeMcpProbe({
      ms: 50,
      toolNames: ["list-databases"],
      deepTool: "list-databases",
      deepOk: false,
      deepError: "ECONNREFUSED",
    });
    expect(deepFail.ok).toBe(false);
    expect(formatMcpProbeLine(deepFail)).toMatch(/ECONNREFUSED/);

    const listFail = summarizeMcpProbe({
      ms: 5,
      toolNames: [],
      listError: "MCP client is disabled",
    });
    expect(listFail.ok).toBe(false);
    expect(listFail.toolCount).toBe(0);
  });
});
