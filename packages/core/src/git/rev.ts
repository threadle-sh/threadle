import { execa } from "execa";
import path from "node:path";

/** True when the OS could not spawn `git` (missing binary / not on PATH). */
export function isGitMissing(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException & {
    shortMessage?: string;
    originalMessage?: string;
    stderr?: string;
  };
  if (e?.code === "ENOENT") return true;
  const msg = [e?.message, e?.shortMessage, e?.originalMessage, e?.stderr]
    .filter(Boolean)
    .join("\n");
  return (
    /\bENOENT\b/.test(msg) ||
    /spawn\s+git\b/i.test(msg) ||
    /git: (command )?not found/i.test(msg) ||
    /'git' is not recognized/i.test(msg)
  );
}

export type CommitResolve =
  | { sha: string; matchedBy: "rev" }
  | { sha: string; matchedBy: "message"; matchCount: number; subject: string };

/**
 * Resolve a user-supplied rev to a commit SHA, or throw a short Error
 * (no raw execa / git stderr dump).
 */
export async function resolveCommitSha(dir: string, rev: string): Promise<string> {
  const r = await resolveCommitQuery(dir, rev);
  return r.sha;
}

/**
 * Resolve sha / branch / HEAD, or fall back to a fixed-string commit-message search
 * (newest match wins when several subjects hit).
 */
export async function resolveCommitQuery(dir: string, query: string): Promise<CommitResolve> {
  const cwd = path.resolve(dir);
  const trimmed = query.trim();
  if (!trimmed) throw new Error("commit / rev is empty");
  if (/[\0\n\r]/.test(trimmed)) throw new Error("commit / rev has invalid characters");

  const asRev = await tryResolveRev(cwd, trimmed);
  if (asRev) return { sha: asRev, matchedBy: "rev" };

  const byMsg = await searchByCommitMessage(cwd, trimmed);
  if (byMsg) return byMsg;

  throw new Error(`no commit matches rev or message: ${trimmed}`);
}

async function tryResolveRev(cwd: string, rev: string): Promise<string | null> {
  try {
    const { stdout } = await execa(
      "git",
      ["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`],
      { cwd, timeout: 10_000 },
    );
    const sha = stdout.trim();
    if (!/^[0-9a-f]{7,64}$/i.test(sha)) return null;
    return sha;
  } catch (err) {
    if (isGitMissing(err)) {
      throw new Error("git is not installed (or not on PATH)");
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/not a git repository/i.test(msg)) {
      throw new Error(`not a git repository: ${cwd}`);
    }
    return null;
  }
}

async function searchByCommitMessage(
  cwd: string,
  needle: string,
): Promise<Extract<CommitResolve, { matchedBy: "message" }> | null> {
  // Avoid dumping half the history for 1–2 char typos.
  if (needle.length < 3) return null;
  try {
    const { stdout } = await execa(
      "git",
      [
        "log",
        "--all",
        "--fixed-strings",
        "--regexp-ignore-case",
        `--grep=${needle}`,
        "-n",
        "25",
        "--format=%H%x00%s",
      ],
      { cwd, timeout: 20_000 },
    );
    const rows = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const i = l.indexOf("\0");
        if (i < 0) return { sha: l, subject: "" };
        return { sha: l.slice(0, i), subject: l.slice(i + 1) };
      })
      .filter((r) => /^[0-9a-f]{7,64}$/i.test(r.sha));
    if (!rows.length) return null;
    const top = rows[0]!;
    return {
      sha: top.sha,
      matchedBy: "message",
      matchCount: rows.length,
      subject: top.subject,
    };
  } catch (err) {
    if (isGitMissing(err)) {
      throw new Error("git is not installed (or not on PATH)");
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/not a git repository/i.test(msg)) {
      throw new Error(`not a git repository: ${cwd}`);
    }
    return null;
  }
}
