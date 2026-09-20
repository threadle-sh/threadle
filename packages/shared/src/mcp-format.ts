/**
 * Pure MCP client UI helpers (details markdown + connection probe summary).
 * Kept free of fetch / Pinia so server vitest can cover them.
 */

export interface McpServerInfoRow {
  id: string;
  label: string;
  source: string;
  transport?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  envKeys?: string[];
  headerKeys?: string[];
  threadle?: boolean;
  disabled?: boolean;
}

export interface McpToolInfoRow {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpProbeResult {
  ok: boolean;
  ms: number;
  toolCount: number;
  selectedToolOk?: boolean;
  deepOk?: boolean;
  deepTool?: string;
  deepPreview?: string;
  error?: string;
  stderr?: string;
}

/** Prefer these for a post-handshake “is the backend alive?” probe. */
export const MCP_DEEP_PROBE_TOOLS = ["list-databases", "list-connections"] as const;

export function pickMcpDeepProbeTool(toolNames: Iterable<string>): string | undefined {
  const set = toolNames instanceof Set ? toolNames : new Set(toolNames);
  return MCP_DEEP_PROBE_TOOLS.find((n) => set.has(n));
}

/** Args for a deep probe tool (safe metadata only). */
export function mcpDeepProbeArgs(toolName: string): Record<string, unknown> {
  if (toolName === "list-databases") return { connectionId: "preconfigured" };
  return {};
}

/**
 * Combine handshake + optional deep-call outcomes into a probe result
 * (caller supplies elapsed `ms`).
 */
export function summarizeMcpProbe(opts: {
  ms: number;
  toolNames: string[];
  selectedTool?: string;
  deepTool?: string;
  deepOk?: boolean;
  deepPreview?: string;
  deepError?: string;
  stderr?: string;
  listError?: string;
}): McpProbeResult {
  if (opts.listError) {
    return {
      ok: false,
      ms: opts.ms,
      toolCount: 0,
      error: opts.listError,
      stderr: opts.stderr,
    };
  }
  const names = new Set(opts.toolNames);
  const selected = opts.selectedTool?.trim();
  const selectedToolOk = selected ? names.has(selected) : undefined;
  const deepOk = opts.deepOk;
  const handshakeOk = selectedToolOk !== false;
  const ok = handshakeOk && deepOk !== false;
  return {
    ok,
    ms: opts.ms,
    toolCount: opts.toolNames.length,
    selectedToolOk,
    deepOk,
    deepTool: opts.deepTool,
    deepPreview: opts.deepPreview,
    error: !ok
      ? selectedToolOk === false
        ? `tool "${selected}" not on server`
        : opts.deepError
      : undefined,
    stderr: opts.stderr,
  };
}

export function formatMcpProbeLine(r: McpProbeResult): string {
  if (!r.ok) {
    return `✕ check failed · ${r.ms}ms${r.error ? ` — ${r.error}` : ""}`;
  }
  const bits = [`✓ connected · ${r.ms}ms · ${r.toolCount} tool${r.toolCount === 1 ? "" : "s"}`];
  if (r.selectedToolOk === true) bits.push("tool ok");
  if (r.deepOk === true && r.deepTool) bits.push(`${r.deepTool} ok`);
  return bits.join(" · ");
}

function codeFence(lang: string, body: string): string {
  const safe = body.replace(/```/g, "``\\`");
  return `\`\`\`${lang}\n${safe}\n\`\`\``;
}

/** Build a markdown dump of one MCP server + its tools (for the floating viewer). */
export function formatMcpInfoMarkdown(opts: {
  server: McpServerInfoRow;
  tools: McpToolInfoRow[];
  selectedTool?: string;
  projectDir?: string;
  registryPath?: string;
  stderr?: string;
  error?: string;
}): string {
  const { server: s, tools, selectedTool, projectDir, registryPath, stderr, error } = opts;
  const lines: string[] = [];
  lines.push(`# ◈ MCP · ${s.id}`);
  lines.push("");
  if (error) {
    lines.push(`**Error:** ${error}`);
    lines.push("");
  }
  lines.push("## Connection");
  lines.push("");
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| id | \`${s.id}\` |`);
  lines.push(`| label | ${s.label || "—"} |`);
  lines.push(`| transport | \`${s.transport ?? "—"}\` |`);
  lines.push(`| source | \`${s.source}\` |`);
  if (s.threadle) lines.push(`| threadle mcp | yes |`);
  if (s.disabled) lines.push(`| disabled | yes (Settings) |`);
  if (s.command) {
    const argv = [s.command, ...(s.args ?? [])].join(" ");
    lines.push(`| command | \`${argv}\` |`);
  }
  if (s.cwd) lines.push(`| cwd | \`${s.cwd}\` |`);
  if (s.url) lines.push(`| url | \`${s.url}\` |`);
  if (s.envKeys?.length) {
    lines.push(`| env keys | ${s.envKeys.map((k) => `\`${k}\``).join(", ")} |`);
  }
  if (s.headerKeys?.length) {
    lines.push(`| header keys | ${s.headerKeys.map((k) => `\`${k}\``).join(", ")} |`);
  }
  if (projectDir) lines.push(`| discovery dir | \`${projectDir}\` |`);
  if (registryPath) lines.push(`| threadle registry | \`${registryPath}\` |`);
  lines.push("");
  lines.push(
    "_Env / header **values** are omitted — they may hold tokens. See the config file under **source**._",
  );
  lines.push("");

  lines.push(`## Tools (${tools.length})`);
  lines.push("");
  if (!tools.length) {
    lines.push("_No tools returned — server may still be starting, or the client is disabled._");
    lines.push("");
  } else {
    for (const t of tools) {
      const mark = selectedTool && t.name === selectedTool ? " ← selected" : "";
      lines.push(`### \`${t.name}\`${mark}`);
      lines.push("");
      if (t.description) {
        lines.push(t.description.trim());
        lines.push("");
      }
      if (t.inputSchema && Object.keys(t.inputSchema).length) {
        lines.push("**inputSchema**");
        lines.push("");
        lines.push(codeFence("json", JSON.stringify(t.inputSchema, null, 2)));
        lines.push("");
      }
    }
  }

  if (stderr?.trim()) {
    lines.push("## Spawn stderr");
    lines.push("");
    lines.push(codeFence("text", stderr.trim()));
    lines.push("");
  }

  return lines.join("\n");
}
