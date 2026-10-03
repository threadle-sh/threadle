import type { DiscoveredMcpServer } from "./discover.js";
import { looksLikeThreadleMcp } from "./discover.js";

/**
 * Public API row for an MCP server — env/header *keys* only, never values.
 */
export function toPublicMcpServerRow(
  s: DiscoveredMcpServer,
  opts?: { disabled?: boolean },
): {
  id: string;
  label: string;
  source: string;
  transport: string;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  envKeys?: string[];
  headerKeys?: string[];
  threadle: boolean;
  disabled: boolean;
} {
  return {
    id: s.id,
    label: s.label,
    source: s.source,
    transport: s.transport,
    command: s.command || undefined,
    args: s.args.length ? s.args : undefined,
    cwd: s.cwd,
    url: s.url,
    envKeys: s.env ? Object.keys(s.env).sort() : undefined,
    headerKeys: s.headers ? Object.keys(s.headers).sort() : undefined,
    threadle: looksLikeThreadleMcp(s),
    disabled: opts?.disabled === true,
  };
}
