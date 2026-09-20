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
import { agyBin } from "./agy-bin.js";
import { listAntigravityAgents } from "./agents.js";
import {
  childrenOf,
  discoverSessions,
  findTranscriptPath,
  liveStatuses,
} from "./discover.js";
import { readAntigravityTouchedFiles } from "./files.js";
import { injectAntigravity } from "./inject.js";
import { readAntigravityTranscript } from "./jsonl.js";
import { antigravityHome } from "./paths.js";

export class AntigravityProvider implements SessionProvider {
  readonly id = "antigravity" as const;
  #version: string | undefined;

  async available(): Promise<boolean> {
    try {
      await fs.promises.access(antigravityHome());
      return true;
    } catch {
      try {
        await execa(agyBin(), ["--version"], { timeout: 8_000 });
        return true;
      } catch {
        return false;
      }
    }
  }

  async version(): Promise<string | undefined> {
    if (this.#version) return this.#version;
    try {
      const { stdout } = await execa(agyBin(), ["--version"], { timeout: 10_000 });
      this.#version = stdout.trim().split("\n")[0]?.trim();
    } catch {
      this.#version = undefined;
    }
    return this.#version;
  }

  async listSessions(opts?: ListSessionsOptions): Promise<SessionRef[]> {
    const all = await discoverSessions();
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
    return readAntigravityTranscript(path);
  }

  async getTouchedFiles(sessionId: string): Promise<TouchedFile[]> {
    const path = await findTranscriptPath(sessionId);
    if (!path) throw new Error(`transcript not found for ${sessionId}`);
    return readAntigravityTouchedFiles(path);
  }

  async listAgents(opts?: { projectDir?: string }): Promise<AgentDef[]> {
    return listAntigravityAgents(opts);
  }

  async inject(
    target: InjectTarget,
    payload: ContextPayload,
    opts: InjectOptions,
  ): Promise<InjectResult> {
    return injectAntigravity(target, payload, opts.kickoffPrompt);
  }

  async liveStatuses(): Promise<Map<string, SessionStatus>> {
    return liveStatuses();
  }
}
