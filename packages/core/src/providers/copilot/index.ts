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
import { listCopilotAgents } from "./agents.js";
import {
  childrenOf,
  dbAvailable,
  discoverSessions,
  getSessionRow,
  listSessionFiles,
  liveStatuses,
} from "./discover.js";
import { injectCopilot } from "./inject.js";
import { copilotBin, copilotHome } from "./paths.js";
import { readCopilotTranscript } from "./transcript.js";
import { enrichSessionTokens } from "./usage.js";

export class CopilotProvider implements SessionProvider {
  readonly id = "copilot" as const;
  #version: string | undefined;

  async available(): Promise<boolean> {
    if (dbAvailable()) return true;
    try {
      await fs.promises.access(copilotHome());
      return true;
    } catch {
      try {
        await execa(copilotBin(), ["--version"], { timeout: 8_000 });
        return true;
      } catch {
        return false;
      }
    }
  }

  async version(): Promise<string | undefined> {
    if (this.#version) return this.#version;
    try {
      const { stdout } = await execa(copilotBin(), ["--version"], { timeout: 10_000 });
      const line = stdout.trim().split("\n")[0]?.trim();
      // "GitHub Copilot CLI 1.0.86" → prefer the semver tail
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
      const enriched = enrichSessionTokens(r);
      enriched.status = live.get(r.id) ?? "idle";
      return enriched;
    });
  }

  async listChildren(sessionId: string): Promise<SessionRef[]> {
    return childrenOf(sessionId);
  }

  async getSession(sessionId: string): Promise<SessionRef | undefined> {
    const ref = await getSessionRow(sessionId);
    if (!ref) return undefined;
    const enriched = enrichSessionTokens(ref);
    const live = await liveStatuses();
    enriched.status = live.get(sessionId) ?? "idle";
    return enriched;
  }

  async getTranscript(sessionId: string): Promise<NormalizedMessage[]> {
    return readCopilotTranscript(sessionId);
  }

  async getTouchedFiles(sessionId: string): Promise<TouchedFile[]> {
    return listSessionFiles(sessionId);
  }

  async listAgents(_opts?: { projectDir?: string }): Promise<AgentDef[]> {
    return listCopilotAgents();
  }

  async inject(
    target: InjectTarget,
    payload: ContextPayload,
    opts: InjectOptions,
  ): Promise<InjectResult> {
    return injectCopilot(target, payload, opts.kickoffPrompt);
  }

  async liveStatuses(): Promise<Map<string, SessionStatus>> {
    return liveStatuses();
  }
}
