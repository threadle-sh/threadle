import fs from "node:fs";
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
import { sameProjectDir } from "../../paths.js";
import type {
  InjectOptions,
  ListSessionsOptions,
  SessionProvider,
} from "../types.js";
import { agentBin } from "./agent-bin.js";
import { listCursorAgents } from "./agents.js";
import {
  discoverSessions,
  findTranscriptPath,
  liveStatuses,
} from "./discover.js";
import { readCursorTouchedFiles } from "./files.js";
import { mergeCursorPlanFiles } from "./plan.js";
import { injectCursor } from "./inject.js";
import { readCursorTranscript } from "./jsonl.js";
import { projectsDir } from "./paths.js";
import { childrenOf } from "./subagents.js";

export class CursorProvider implements SessionProvider {
  readonly id = "cursor" as const;
  #version: string | undefined;

  async available(): Promise<boolean> {
    try {
      await fs.promises.access(projectsDir());
      return true;
    } catch {
      // also treat CLI-present as available even with empty storage
      try {
        await execa(agentBin(), ["--version"], { timeout: 8_000 });
        return true;
      } catch {
        return false;
      }
    }
  }

  async version(): Promise<string | undefined> {
    if (this.#version) return this.#version;
    try {
      const { stdout } = await execa(agentBin(), ["--version"], { timeout: 10_000 });
      this.#version = stdout.trim().split("\n")[0]?.trim();
    } catch {
      this.#version = undefined;
    }
    return this.#version;
  }

  async listSessions(opts?: ListSessionsOptions): Promise<SessionRef[]> {
    const all = await discoverSessions();
    // Task children surface via listChildren — hide from the top-level list
    let refs = all.map((d) => d.ref).filter((r) => r.kind !== "subagent-run" && !r.parentId);
    if (opts?.projectDir) {
      refs = refs.filter((r) => sameProjectDir(r.projectDir, opts.projectDir));
    }
    return refs;
  }

  async listChildren(sessionId: string): Promise<SessionRef[]> {
    return childrenOf(await discoverSessions(), sessionId);
  }

  async getSession(sessionId: string): Promise<SessionRef | undefined> {
    const all = await discoverSessions();
    return all.find((d) => d.ref.id === sessionId)?.ref;
  }

  async getTranscript(sessionId: string): Promise<NormalizedMessage[]> {
    const path = await findTranscriptPath(sessionId);
    if (!path) throw new Error(`transcript not found for ${sessionId}`);
    return readCursorTranscript(path);
  }

  async getTouchedFiles(sessionId: string): Promise<TouchedFile[]> {
    const path = await findTranscriptPath(sessionId);
    if (!path) throw new Error(`transcript not found for ${sessionId}`);
    const files = await readCursorTouchedFiles(path);
    return mergeCursorPlanFiles(sessionId, files);
  }

  async listAgents(_opts?: { projectDir?: string }): Promise<AgentDef[]> {
    return listCursorAgents();
  }

  async inject(
    target: InjectTarget,
    payload: ContextPayload,
    opts: InjectOptions,
  ): Promise<InjectResult> {
    return injectCursor(target, payload, opts.kickoffPrompt);
  }

  async liveStatuses(): Promise<Map<string, SessionStatus>> {
    return liveStatuses();
  }
}
