import { execa } from "execa";
import type {
  AgentDef,
  ContextPayload,
  InjectResult,
  InjectTarget,
  NormalizedMessage,
  SessionRef,
  SessionStatus,
  TouchedFile,
} from "@threadle/shared";
import type {
  InjectOptions,
  ListSessionsOptions,
  SessionProvider,
} from "../types.js";
import { sameProjectDir } from "../../paths.js";
import { dbAvailable, query, type SessionRow } from "./db.js";
import { readOpencodeTranscript } from "./normalize.js";
import { readOpencodeTouchedFiles } from "./files.js";
import { injectOpencode, serverGet } from "./inject.js";

function rowToRef(row: SessionRow): SessionRef {
  let model: string | undefined;
  if (row.model) {
    try {
      const m = JSON.parse(row.model) as { id?: string; providerID?: string };
      model = m.id ? (m.providerID ? `${m.providerID}/${m.id}` : m.id) : undefined;
    } catch {
      model = row.model;
    }
  }
  return {
    provider: "opencode",
    id: row.id,
    parentId: row.parent_id ?? undefined,
    projectDir: row.directory ?? "",
    title: row.title ?? row.slug ?? undefined,
    agent: row.agent ?? undefined,
    model,
    createdAt: row.time_created ?? undefined,
    updatedAt: row.time_updated ?? row.time_created ?? 0,
    status: "unknown",
    kind: row.parent_id ? "subagent-run" : "session",
    tokensIn: row.tokens_input ?? undefined,
    tokensOut: row.tokens_output ?? undefined,
    tokensReasoning: row.tokens_reasoning ?? undefined,
    tokensCacheRead: row.tokens_cache_read ?? undefined,
    tokensCacheWrite: row.tokens_cache_write ?? undefined,
    cost: row.cost ?? undefined,
    // opencode records what its own API keys were billed — that IS the spend
    actualCost: row.cost ?? undefined,
    meta: {
      slug: row.slug,
      cliVersion: row.version ?? undefined,
      shareUrl: row.share_url ?? undefined,
      diffAdditions: row.summary_additions ?? undefined,
      diffDeletions: row.summary_deletions ?? undefined,
      diffFiles: row.summary_files ?? undefined,
    },
  };
}

const SESSION_SELECT =
  "SELECT id, slug, title, directory, parent_id, agent, model, cost, version, share_url, summary_additions, summary_deletions, summary_files, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated FROM session";

export class OpencodeProvider implements SessionProvider {
  readonly id = "opencode" as const;
  #version: string | undefined;

  async available(): Promise<boolean> {
    return dbAvailable();
  }

  async version(): Promise<string | undefined> {
    if (this.#version) return this.#version;
    try {
      const { stdout } = await execa("opencode", ["--version"], { timeout: 10_000 });
      this.#version = stdout.trim();
    } catch {
      this.#version = undefined;
    }
    return this.#version;
  }

  async listSessions(opts?: ListSessionsOptions): Promise<SessionRef[]> {
    const sql = `${SESSION_SELECT} WHERE parent_id IS NULL ORDER BY time_updated DESC`;
    const rows = await query<SessionRow>(sql, []);
    const live = await this.liveStatuses();
    let refs = rows.map((r) => {
      const ref = rowToRef(r);
      ref.status = live.get(ref.id) ?? "idle";
      return ref;
    });
    if (opts?.projectDir) {
      refs = refs.filter((r) => sameProjectDir(r.projectDir, opts.projectDir));
    }
    return refs;
  }

  async listChildren(sessionId: string): Promise<SessionRef[]> {
    const rows = await query<SessionRow>(
      `${SESSION_SELECT} WHERE parent_id = ? ORDER BY time_created ASC`,
      [sessionId],
    );
    return rows.map(rowToRef);
  }

  async getSession(sessionId: string): Promise<SessionRef | undefined> {
    const rows = await query<SessionRow>(`${SESSION_SELECT} WHERE id = ?`, [
      sessionId,
    ]);
    return rows[0] ? rowToRef(rows[0]) : undefined;
  }

  async getTranscript(sessionId: string): Promise<NormalizedMessage[]> {
    return readOpencodeTranscript(sessionId);
  }

  async getTouchedFiles(sessionId: string): Promise<TouchedFile[]> {
    return readOpencodeTouchedFiles(sessionId);
  }

  async listAgents(): Promise<AgentDef[]> {
    // preferred: the serve API returns full definitions (description, prompt)
    try {
      const list = await serverGet<
        Array<{
          name?: string;
          description?: string;
          mode?: string;
          prompt?: string;
          builtIn?: boolean;
        }>
      >("/agent");
      const agents = list
        .filter((a) => typeof a.name === "string")
        .map((a) => ({
          provider: "opencode" as const,
          name: a.name!,
          description: a.description || (a.mode ? `${a.mode} agent` : undefined),
          source: "opencode:config",
          scope: "builtin" as const,
          kind: a.mode ?? "agent",
          raw: a.prompt || undefined,
        }));
      if (agents.length) return agents;
    } catch {
      // serve unavailable — fall through to CLI parsing
    }
    try {
      const { stdout } = await execa("opencode", ["agent", "list"], {
        timeout: 30_000,
      });
      const agents: AgentDef[] = [];
      for (const line of stdout.split("\n")) {
        const m = /^([\w][\w-]*)\s+\((\w+)\)\s*$/.exec(line);
        if (m && m[1]) {
          agents.push({
            provider: "opencode",
            name: m[1],
            description: m[2] === "primary" ? "primary agent" : `${m[2]} agent`,
            source: "opencode:config",
            scope: "builtin",
            kind: m[2],
          });
        }
      }
      return agents;
    } catch {
      return [];
    }
  }

  async inject(
    target: InjectTarget,
    payload: ContextPayload,
    opts: InjectOptions,
  ): Promise<InjectResult> {
    return injectOpencode(target, payload, opts.kickoffPrompt);
  }

  async liveStatuses(): Promise<Map<string, SessionStatus>> {
    // heuristic: a session whose row changed in the last 45s is being driven right now
    const out = new Map<string, SessionStatus>();
    try {
      const rows = await query<{ id: string }>(
        "SELECT id FROM session WHERE time_updated > ?",
        [Date.now() - 45_000],
      );
      for (const r of rows) out.set(r.id, "running");
    } catch {
      // heuristic only
    }
    return out;
  }
}
