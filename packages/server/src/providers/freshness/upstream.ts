/**
 * Watch public npm packages / GitHub releases for agent CLIs threadle
 * injects into. This is a *version* signal, not a schema scraper —
 * undocumented transcript formats still need a human + a fixture.
 */

export interface UpstreamSeen {
  npm?: string;
  github?: string;
}

export interface UpstreamEntry {
  id: string;
  label: string;
  /** npm package name, if the CLI publishes one */
  npm?: string;
  /** GitHub `owner/repo` for releases/latest */
  github?: string;
  /** Last versions a human confirmed the adapters still match */
  seen: UpstreamSeen;
}

export const UPSTREAM_CATALOG: readonly UpstreamEntry[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    npm: "@anthropic-ai/claude-code",
    github: "anthropics/claude-code",
    seen: { npm: "2.1.278", github: "v2.1.278" },
  },
  {
    id: "opencode",
    label: "opencode",
    npm: "opencode-ai",
    github: "anomalyco/opencode",
    seen: { npm: "1.18.31", github: "v1.18.31" },
  },
  {
    id: "codex",
    label: "Codex CLI",
    npm: "@openai/codex",
    github: "openai/codex",
    seen: { npm: "0.155.1", github: "rust-v0.155.1" },
  },
  {
    id: "copilot",
    label: "GitHub Copilot CLI",
    npm: "@github/copilot",
    github: "github/copilot-cli",
    seen: { npm: "1.0.86", github: "v1.0.86" },
  },
];

export interface UpstreamRow {
  id: string;
  label: string;
  channel: "npm" | "github";
  seen: string;
  latest: string | undefined;
  newer: boolean;
  skipped: boolean;
  detail: string;
}

export interface UpstreamFetch {
  (url: string, headers?: Record<string, string>): Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>;
}

const defaultFetch: UpstreamFetch = async (url, headers) => {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  return {
    ok: res.ok,
    status: res.status,
    json: () => res.json() as Promise<unknown>,
  };
};

function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "threadle-upstream-watch",
  };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function latestNpm(
  pkg: string,
  fetchImpl: UpstreamFetch,
): Promise<string | undefined> {
  const url = `https://registry.npmjs.org/${pkg.replace("/", "%2F")}/latest`;
  const res = await fetchImpl(url, { Accept: "application/json" });
  if (!res.ok) return undefined;
  const body = (await res.json()) as { version?: unknown };
  return typeof body.version === "string" ? body.version : undefined;
}

async function latestGithub(
  repo: string,
  fetchImpl: UpstreamFetch,
): Promise<string | undefined> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const res = await fetchImpl(url, githubHeaders());
  if (!res.ok) return undefined;
  const body = (await res.json()) as { tag_name?: unknown };
  return typeof body.tag_name === "string" ? body.tag_name : undefined;
}

function row(
  entry: UpstreamEntry,
  channel: "npm" | "github",
  seen: string | undefined,
  latest: string | undefined,
  fetchFailed: boolean,
): UpstreamRow {
  if (fetchFailed || !latest) {
    return {
      id: `${entry.id}:${channel}`,
      label: entry.label,
      channel,
      seen: seen ?? "",
      latest,
      newer: false,
      skipped: true,
      detail: `could not fetch ${channel} for ${entry.label}`,
    };
  }
  const pinned = seen ?? "";
  const newer = pinned.length > 0 && latest !== pinned;
  return {
    id: `${entry.id}:${channel}`,
    label: entry.label,
    channel,
    seen: pinned,
    latest,
    newer,
    skipped: false,
    detail: newer
      ? `${entry.label} ${channel} ${pinned || "(unpinned)"} → ${latest} — review inject.ts / fixtures, then bump seen in upstream.ts`
      : `${entry.label} ${channel} ${latest} (matches pin)`,
  };
}

/** Compare catalog pins to live npm / GitHub latest. */
export async function probeUpstream(
  catalog: readonly UpstreamEntry[] = UPSTREAM_CATALOG,
  fetchImpl: UpstreamFetch = defaultFetch,
): Promise<UpstreamRow[]> {
  const out: UpstreamRow[] = [];
  for (const entry of catalog) {
    if (entry.npm) {
      try {
        const latest = await latestNpm(entry.npm, fetchImpl);
        out.push(row(entry, "npm", entry.seen.npm, latest, !latest));
      } catch (err) {
        out.push(
          row(entry, "npm", entry.seen.npm, undefined, true),
        );
        void err;
      }
    }
    if (entry.github) {
      try {
        const latest = await latestGithub(entry.github, fetchImpl);
        out.push(row(entry, "github", entry.seen.github, latest, !latest));
      } catch {
        out.push(row(entry, "github", entry.seen.github, undefined, true));
      }
    }
  }
  return out;
}

export function formatUpstreamReport(rows: UpstreamRow[]): string {
  const lines = ["threadle upstream watch", ""];
  for (const r of rows) {
    const mark = r.skipped ? "··" : r.newer ? "!!" : "ok";
    lines.push(`  ${mark}  ${r.id.padEnd(28)}  ${r.detail}`);
  }
  const drifted = rows.filter((r) => r.newer);
  lines.push("");
  if (drifted.length) {
    lines.push(`· ${drifted.length} channel(s) ahead of the pin — see CONTRIBUTING.md (upstream CLIs)`);
  } else {
    lines.push("· pins match latest (or fetch skipped)");
  }
  return lines.join("\n");
}

export function upstreamHasDrift(rows: UpstreamRow[]): boolean {
  return rows.some((r) => r.newer);
}
