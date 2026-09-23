import type { ProviderId, ProviderInfo } from "@threadle/shared";
import type { SessionProvider } from "./types.js";
import { AntigravityProvider } from "./antigravity/index.js";
import { ClaudeCodeProvider } from "./claude-code/index.js";
import { CodexProvider } from "./codex/index.js";
import { CopilotProvider } from "./copilot/index.js";
import { CursorProvider } from "./cursor/index.js";
import { GrokProvider } from "./grok/index.js";
import { MuseProvider } from "./muse/index.js";
import { OpencodeProvider } from "./opencode/index.js";

export class ProviderRegistry {
  readonly providers: Map<ProviderId, SessionProvider>;

  constructor() {
    this.providers = new Map<ProviderId, SessionProvider>([
      ["claude-code", new ClaudeCodeProvider()],
      ["opencode", new OpencodeProvider()],
      ["cursor", new CursorProvider()],
      ["antigravity", new AntigravityProvider()],
      ["codex", new CodexProvider()],
      ["copilot", new CopilotProvider()],
      ["grok", new GrokProvider()],
      ["muse", new MuseProvider()],
    ]);
  }

  get(id: string): SessionProvider {
    const p = this.providers.get(id as ProviderId);
    if (!p) {
      const err = new Error(`unknown provider: ${id}`) as Error & { status: number };
      err.status = 400;
      throw err;
    }
    return p;
  }

  async info(): Promise<ProviderInfo[]> {
    return Promise.all(
      [...this.providers.values()].map(async (p) => ({
        id: p.id,
        available: await p.available(),
        version: await p.version(),
      })),
    );
  }
}

export const registry = new ProviderRegistry();
