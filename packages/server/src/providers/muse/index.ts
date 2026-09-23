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
import { listMuseAgents } from "./agents.js";
import {
  childrenOf,
  discoverSessions,
  getSessionRow,
  listSessionFiles,
  liveStatuses,
} from "./discover.js";
import { injectMuse } from "./inject.js";
import { museBin, museConfigHome, museShare, sessionsRootAvailable } from "./paths.js";
import { readMuseTranscript } from "./transcript.js";

export class MuseProvider implements SessionProvider {
  readonly id = "muse" as const;
  #version: string | undefined;

  async available(): Promise<boolean> {
    if (sessionsRootAvailable()) return true;
    try {
      await fs.promises.access(museShare());
      return true;
    } catch {
      try {
        await fs.promises.access(museConfigHome());
        return true;
      } catch {
        try {
          await execa(museBin(), ["--version"], { timeout: 8_000 });
          return true;
        } catch {
          return false;
        }
      }
    }
  }

  async version(): Promise<string | undefined> {
    if (this.#version) return this.#version;
    try {
      const { stdout } = await execa(museBin(), ["--version"], { timeout: 10_000 });
      const line = stdout.trim().split("\n")[0]?.trim();
      // "Muse Code 1.3.0 (1.3.0-R3401.1)"
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
    const kids = await childrenOf(sessionId);
    const live = await liveStatuses();
    return kids.map((r) => {
      r.status = live.get(r.id) ?? "idle";
      return r;
    });
  }

  async getSession(sessionId: string): Promise<SessionRef | undefined> {
    const ref = await getSessionRow(sessionId);
    if (!ref) return undefined;
    const live = await liveStatuses();
    ref.status = live.get(sessionId) ?? "idle";
    return ref;
  }

  async getTranscript(sessionId: string): Promise<NormalizedMessage[]> {
    return readMuseTranscript(sessionId);
  }

  async getTouchedFiles(sessionId: string): Promise<TouchedFile[]> {
    return listSessionFiles(sessionId);
  }

  async listAgents(_opts?: { projectDir?: string }): Promise<AgentDef[]> {
    return listMuseAgents();
  }

  async inject(
    target: InjectTarget,
    payload: ContextPayload,
    opts: InjectOptions,
  ): Promise<InjectResult> {
    return injectMuse(target, payload, opts.kickoffPrompt);
  }

  async liveStatuses(): Promise<Map<string, SessionStatus>> {
    return liveStatuses();
  }
}
