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
import { listCodexAgents } from "./agents.js";
import {
  childrenOf,
  discoverSessions,
  findTranscriptPath,
  liveStatuses,
} from "./discover.js";
import { readCodexTouchedFiles } from "./files.js";
import { injectCodex } from "./inject.js";
import { readCodexTranscript } from "./jsonl.js";
import { codexBin, codexHome } from "./paths.js";

export class CodexProvider implements SessionProvider {
  readonly id = "codex" as const;
  #version: string | undefined;

  async available(): Promise<boolean> {
    try {
      await fs.promises.access(codexHome());
      return true;
    } catch {
      try {
        await execa(codexBin(), ["--version"], { timeout: 8_000 });
        return true;
      } catch {
        return false;
      }
    }
  }

  async version(): Promise<string | undefined> {
    if (this.#version) return this.#version;
    try {
      const { stdout } = await execa(codexBin(), ["--version"], { timeout: 10_000 });
      this.#version = stdout.trim().split("\n")[0]?.trim();
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
    return childrenOf(await discoverSessions(), sessionId);
  }

  async getSession(sessionId: string): Promise<SessionRef | undefined> {
    const all = await discoverSessions();
    return all.find((d) => d.ref.id === sessionId)?.ref;
  }

  async getTranscript(sessionId: string): Promise<NormalizedMessage[]> {
    const p = await findTranscriptPath(sessionId);
    if (!p) throw new Error(`transcript not found for ${sessionId}`);
    return readCodexTranscript(p);
  }

  async getTouchedFiles(sessionId: string): Promise<TouchedFile[]> {
    const p = await findTranscriptPath(sessionId);
    if (!p) throw new Error(`transcript not found for ${sessionId}`);
    return readCodexTouchedFiles(p);
  }

  async listAgents(_opts?: { projectDir?: string }): Promise<AgentDef[]> {
    return listCodexAgents();
  }

  async inject(
    target: InjectTarget,
    payload: ContextPayload,
    opts: InjectOptions,
  ): Promise<InjectResult> {
    return injectCodex(target, payload, opts.kickoffPrompt);
  }

  async liveStatuses(): Promise<Map<string, SessionStatus>> {
    return liveStatuses();
  }
}
