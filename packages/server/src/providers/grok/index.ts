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
import { listGrokAgents } from "./agents.js";
import {
  childrenOf,
  discoverSessions,
  getSessionRow,
  listSessionFiles,
  liveStatuses,
  sessionsRootAvailable,
} from "./discover.js";
import { injectGrok } from "./inject.js";
import { grokBin, grokHome } from "./paths.js";
import { readGrokTranscript } from "./transcript.js";

export class GrokProvider implements SessionProvider {
  readonly id = "grok" as const;
  #version: string | undefined;

  async available(): Promise<boolean> {
    if (sessionsRootAvailable()) return true;
    try {
      await fs.promises.access(grokHome());
      return true;
    } catch {
      try {
        await execa(grokBin(), ["--version"], { timeout: 8_000 });
        return true;
      } catch {
        return false;
      }
    }
  }

  async version(): Promise<string | undefined> {
    if (this.#version) return this.#version;
    try {
      const { stdout } = await execa(grokBin(), ["--version"], { timeout: 10_000 });
      const line = stdout.trim().split("\n")[0]?.trim();
      // "grok 1.0.34 (3736acbc8658) [stable]"
      const m = /(\d+\.\d+\.\d+)/.exec(line ?? "");
      this.#version = m?.[1] ?? line;
    } catch {
      this.#version = undefined;
    }
    return this.#version;
  }

  async listSessions(opts?: ListSessionsOptions): Promise<SessionRef[]> {
    let refs = await discoverSessions();
    if (opts?.projectDir) {
      refs = refs.filter((r) => sameProjectDir(r.projectDir, opts.projectDir));
    }
    const live = await liveStatuses();
    return refs.map((r) => {
      r.status = live.get(r.id) ?? "idle";
      return r;
    });
  }

  async listChildren(sessionId: string): Promise<SessionRef[]> {
    return childrenOf(sessionId);
  }

  async getSession(sessionId: string): Promise<SessionRef | undefined> {
    const ref = await getSessionRow(sessionId);
    if (!ref) return undefined;
    const live = await liveStatuses();
    ref.status = live.get(sessionId) ?? "idle";
    return ref;
  }

  async getTranscript(sessionId: string): Promise<NormalizedMessage[]> {
    return readGrokTranscript(sessionId);
  }

  async getTouchedFiles(sessionId: string): Promise<TouchedFile[]> {
    return listSessionFiles(sessionId);
  }

  async listAgents(_opts?: { projectDir?: string }): Promise<AgentDef[]> {
    return listGrokAgents();
  }

  async inject(
    target: InjectTarget,
    payload: ContextPayload,
    opts: InjectOptions,
  ): Promise<InjectResult> {
    return injectGrok(target, payload, opts.kickoffPrompt);
  }

  async liveStatuses(): Promise<Map<string, SessionStatus>> {
    return liveStatuses();
  }
}
