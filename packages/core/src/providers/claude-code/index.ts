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
import {
  discoverSessions,
  findTranscriptPath,
  liveStatuses,
  projectsDir,
} from "./discover.js";
import { findSubagentTranscript, listSubagentRuns } from "./subagents.js";
import { listClaudeAgents } from "./agents.js";
import { readAllMessages, readThread } from "./thread.js";
import { readTouchedFilesCached } from "./files.js";
import { injectClaude } from "./inject.js";

export class ClaudeCodeProvider implements SessionProvider {
  readonly id = "claude-code" as const;
  #version: string | undefined;

  async available(): Promise<boolean> {
    try {
      await fs.promises.access(projectsDir());
      return true;
    } catch {
      return false;
    }
  }

  async version(): Promise<string | undefined> {
    if (this.#version) return this.#version;
    try {
      const { stdout } = await execa("claude", ["--version"], { timeout: 10_000 });
      this.#version = stdout.trim();
    } catch {
      this.#version = undefined;
    }
    return this.#version;
  }

  async listSessions(opts?: ListSessionsOptions): Promise<SessionRef[]> {
    const all = await discoverSessions();
    let refs = all.map((d) => d.ref);
    if (opts?.projectDir) {
      refs = refs.filter((r) => sameProjectDir(r.projectDir, opts.projectDir));
    }
    return refs;
  }

  async listChildren(sessionId: string): Promise<SessionRef[]> {
    return listSubagentRuns(sessionId);
  }

  async getSession(sessionId: string): Promise<SessionRef | undefined> {
    // subagent-run ids are composite: "<sessionId>/agent-<hex>"
    if (sessionId.includes("/")) {
      const parentId = sessionId.split("/")[0]!;
      const children = await listSubagentRuns(parentId);
      return children.find((c) => c.id === sessionId);
    }
    const all = await discoverSessions();
    return all.find((d) => d.ref.id === sessionId)?.ref;
  }

  async getTranscript(sessionId: string): Promise<NormalizedMessage[]> {
    const path = await this.resolveTranscript(sessionId);
    if (!path) throw new Error(`transcript not found for ${sessionId}`);
    return readThread(path);
  }

  async getTranscriptFull(sessionId: string): Promise<NormalizedMessage[]> {
    const path = await this.resolveTranscript(sessionId);
    if (!path) throw new Error(`transcript not found for ${sessionId}`);
    return readAllMessages(path);
  }

  async getTouchedFiles(sessionId: string): Promise<TouchedFile[]> {
    const path = await this.resolveTranscript(sessionId);
    if (!path) throw new Error(`transcript not found for ${sessionId}`);
    return readTouchedFilesCached(path);
  }

  /** subagent-run ids are composite: "<sessionId>/agent-<hex>" */
  private async resolveTranscript(id: string): Promise<string | undefined> {
    return id.includes("/") ? findSubagentTranscript(id) : findTranscriptPath(id);
  }

  async listAgents(opts?: { projectDir?: string }): Promise<AgentDef[]> {
    return listClaudeAgents(opts?.projectDir);
  }

  async inject(
    target: InjectTarget,
    payload: ContextPayload,
    opts: InjectOptions,
  ): Promise<InjectResult> {
    return injectClaude(target, payload, opts.kickoffPrompt);
  }

  async liveStatuses(): Promise<Map<string, SessionStatus>> {
    return liveStatuses();
  }

  /** exposed for transcript/files modules */
  async transcriptPath(sessionId: string): Promise<string | undefined> {
    return findTranscriptPath(sessionId);
  }
}
