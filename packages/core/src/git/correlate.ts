/**
 * Correlate a git commit with agent sessions (touched files + time + branch).
 * Pure scoring — no I/O. Callers supply commit meta + session snapshots.
 *
 * Intentionally conservative: a session must share at least one real file path
 * with the commit. Branch/time alone never list a candidate (too noisy on main).
 */

export interface GitCommitMeta {
  hash: string;
  /** Commit author/committer time in ms epoch. */
  commitTs: number;
  subject?: string;
  branch?: string;
  /** Paths relative to repo root (as `git show --name-only`). */
  files: string[];
}

export interface SessionCandidateInput {
  provider: string;
  sessionId: string;
  title?: string;
  projectDir: string;
  updatedAt: number;
  createdAt?: number;
  gitBranch?: string;
  /** Absolute or relative touched paths from provider parsers. */
  touchedFiles: string[];
}

export interface PossibleSessionMatch {
  provider: string;
  sessionId: string;
  title?: string;
  projectDir: string;
  updatedAt: number;
  score: number;
  matchReasons: string[];
  /** Absolute/relative paths that overlapped the commit (capped). */
  overlapFiles: string[];
  label: "possible";
}

export interface CorrelateOpts {
  /** Half-window around commitTs for session updatedAt (default 6h). */
  timeWindowMs?: number;
}

function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function pathTail(p: string): string {
  const n = normPath(p);
  const parts = n.split("/");
  return parts[parts.length - 1] ?? n;
}

/**
 * Strong overlap only: exact relative path, or session path ending in
 * `/<commit-relative-path>`. Basename-only hits (theme.css ↔ any theme.css)
 * are ignored — they flood the list on shared UI files.
 */
function filesOverlap(
  commitFiles: string[],
  touched: string[],
): { count: number; samples: string[] } {
  if (!commitFiles.length || !touched.length) return { count: 0, samples: [] };
  const commitRels = commitFiles.map(normPath).filter(Boolean);
  const samples: string[] = [];
  let count = 0;
  for (const t of touched) {
    const n = normPath(t);
    const hit = commitRels.some(
      (c) => n === c || n.endsWith("/" + c) || (c.includes("/") && n.endsWith(c)),
    );
    if (hit) {
      count += 1;
      if (samples.length < 12) samples.push(t);
    }
  }
  return { count, samples };
}

/**
 * Rank sessions that *might* relate to a commit. Always label "possible".
 */
export function correlateCommitSessions(
  commit: GitCommitMeta,
  sessions: SessionCandidateInput[],
  opts: CorrelateOpts = {},
): PossibleSessionMatch[] {
  const window = opts.timeWindowMs ?? 6 * 60 * 60 * 1000;
  const out: PossibleSessionMatch[] = [];

  for (const s of sessions) {
    const reasons: string[] = [];
    let score = 0;

    const overlap = filesOverlap(commit.files, s.touchedFiles);
    // File overlap is required — without it, branch/time spam every session on main.
    if (overlap.count <= 0) continue;

    score += Math.min(50, overlap.count * 10);
    reasons.push(
      `touched ${overlap.count} file(s) also in commit` +
        (overlap.samples.length
          ? ` (${overlap.samples.map(pathTail).join(", ")})`
          : ""),
    );

    const t = s.updatedAt;
    if (commit.commitTs > 0 && t > 0) {
      const delta = Math.abs(t - commit.commitTs);
      if (delta <= window) {
        const proximity = 1 - delta / window;
        score += Math.round(30 * proximity);
        const hours = (delta / 3_600_000).toFixed(1);
        reasons.push(`session updated within ${hours}h of commit`);
      }
    }

    if (
      commit.branch &&
      s.gitBranch &&
      commit.branch.replace(/^refs\/heads\//, "") ===
        s.gitBranch.replace(/^refs\/heads\//, "")
    ) {
      score += 20;
      reasons.push(`meta.gitBranch matches ${s.gitBranch}`);
    }

    out.push({
      provider: s.provider,
      sessionId: s.sessionId,
      title: s.title,
      projectDir: s.projectDir,
      updatedAt: s.updatedAt,
      score,
      matchReasons: reasons,
      overlapFiles: overlap.samples,
      label: "possible",
    });
  }

  out.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
  return out;
}
