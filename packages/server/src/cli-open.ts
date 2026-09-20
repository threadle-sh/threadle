/**
 * Build deep-link paths for `threadle open` against the local UI.
 * Paths match packages/web/src/router.ts + GraphList `?view=` tabs.
 */

/** Dashboard tabs under `/?view=…` (GraphList VIEW_IDS). */
export const OPEN_VIEWS = [
  "workflows",
  "runs",
  "logs",
  "sessions",
  "search",
  "agents",
  "rules",
  "skills",
  "services",
  "usage",
  "meta",
  "security",
  "files",
  "activity",
  "settings",
  "library",
] as const;

export type OpenView = (typeof OPEN_VIEWS)[number];

/** Standalone routes (not `?view=`). */
export const OPEN_ROUTES = ["map", "timeline", "lineage", "diff"] as const;

const VIEW_ALIASES: Record<string, OpenView | (typeof OPEN_ROUTES)[number] | "home"> = {
  ui: "home",
  home: "home",
  dash: "home",
  dashboard: "home",
  statistics: "usage",
  stats: "usage",
  graph: "workflows",
  graphs: "workflows",
  workflow: "workflows",
  skill: "skills",
  rule: "rules",
  agent: "agents",
  session: "sessions",
  job: "runs",
  jobs: "runs",
  run: "runs",
  atlas: "map",
};

export interface OpenTarget {
  /** Path + query relative to server origin, e.g. `/?view=skills&skill=foo`. */
  path: string;
  /** Short label for the CLI confirmation line. */
  label: string;
}

function isView(s: string): s is OpenView {
  return (OPEN_VIEWS as readonly string[]).includes(s);
}

function isRoute(s: string): s is (typeof OPEN_ROUTES)[number] {
  return (OPEN_ROUTES as readonly string[]).includes(s);
}

/** Parse `provider:sessionId` or return undefined. */
export function parseProviderSession(
  raw: string,
): { provider: string; sessionId: string } | undefined {
  const i = raw.indexOf(":");
  if (i <= 0 || i === raw.length - 1) return undefined;
  const provider = raw.slice(0, i).trim();
  const sessionId = raw.slice(i + 1).trim();
  if (!provider || !sessionId) return undefined;
  return { provider, sessionId };
}

/**
 * Resolve `threadle open …` positionals (after the `open` command) into a UI path.
 * Does not hit the network — callers may rewrite workflow names → ids first.
 */
export function resolveOpenTarget(args: string[]): OpenTarget {
  const raw = args.map((a) => a.trim()).filter(Boolean);
  if (!raw.length) {
    return { path: "/", label: "home" };
  }

  const head = raw[0]!.toLowerCase();
  const aliased = VIEW_ALIASES[head] ?? head;

  if (aliased === "home") {
    return { path: "/", label: "home" };
  }

  // threadle open workflow|graph <id>  ·  workflows|graphs [id]
  if (head === "workflow" || head === "graph" || head === "workflows" || head === "graphs") {
    const id = raw[1];
    if (!id) return { path: "/?view=workflows", label: "workflows" };
    return { path: `/graph/${encodeURIComponent(id)}`, label: `workflow ${id}` };
  }

  // threadle open session <provider> <id> | session <provider:id>
  if (head === "session" || head === "blueprint") {
    let provider: string | undefined;
    let sessionId: string | undefined;
    if (raw[1] && raw[2]) {
      provider = raw[1];
      sessionId = raw.slice(2).join("/");
    } else if (raw[1]) {
      const parsed = parseProviderSession(raw[1]);
      if (parsed) {
        provider = parsed.provider;
        sessionId = parsed.sessionId;
      }
    }
    if (provider && sessionId) {
      const path = `/blueprint/${encodeURIComponent(provider)}/${sessionId
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`;
      return {
        path,
        label: `session ${provider}:${sessionId}`,
      };
    }
    return { path: "/?view=sessions", label: "sessions" };
  }

  // threadle open skill <name>
  if (head === "skill" || head === "skills") {
    const name = raw[1];
    if (!name) return { path: "/?view=skills", label: "skills" };
    return {
      path: `/?view=skills&skill=${encodeURIComponent(name)}`,
      label: `skill ${name}`,
    };
  }

  // threadle open rules [name]
  if (head === "rule" || head === "rules") {
    const name = raw[1];
    if (!name) return { path: "/?view=rules", label: "rules" };
    return {
      path: `/?view=rules&name=${encodeURIComponent(name)}`,
      label: `rules ${name}`,
    };
  }

  // threadle open run|job <id>
  if (head === "run" || head === "job" || head === "runs" || head === "jobs") {
    const id = raw[1];
    if (!id) return { path: "/?view=runs", label: "runs" };
    return {
      path: `/?view=runs&job=${encodeURIComponent(id)}`,
      label: `run ${id}`,
    };
  }

  // threadle open search [query]
  if (head === "search") {
    const query = raw.slice(1).join(" ").trim();
    if (!query) return { path: "/?view=search", label: "search" };
    return {
      path: `/?view=search&q=${encodeURIComponent(query)}`,
      label: `search ${query}`,
    };
  }

  // threadle open agent <name> → agents tab (optional filter later)
  if (head === "agent" || head === "agents") {
    const name = raw[1];
    if (!name) return { path: "/?view=agents", label: "agents" };
    return {
      path: `/?view=agents&agent=${encodeURIComponent(name)}`,
      label: `agent ${name}`,
    };
  }

  if (isRoute(aliased)) {
    return { path: `/${aliased}`, label: aliased };
  }

  if (isView(aliased)) {
    return { path: `/?view=${aliased}`, label: aliased };
  }

  // Bare graph id / name heuristic: look like an 8-char id or path-ish → /graph/:id
  if (raw.length === 1 && /^[a-f0-9]{8}$/i.test(raw[0]!)) {
    return { path: `/graph/${raw[0]}`, label: `workflow ${raw[0]}` };
  }

  throw new Error(
    `unknown open target "${raw.join(" ")}" — try: workflows | sessions | skills | rules | ` +
      `workflow <id> | session <provider> <id> | skill <name> | map | timeline | lineage`,
  );
}

export function openUrl(base: string, target: OpenTarget): string {
  return `${base.replace(/\/$/, "")}${target.path}`;
}
