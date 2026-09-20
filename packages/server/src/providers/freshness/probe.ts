import fs from "node:fs";
import { execa } from "execa";
import { agentBin } from "../cursor/agent-bin.js";
import { agyBin } from "../antigravity/agy-bin.js";
import { codexBin } from "../codex/paths.js";
import { copilotBin } from "../copilot/paths.js";
import { grokBin } from "../grok/paths.js";
import { INJECT_FLAG_PROBES, type InjectFlagProbe } from "./inject-flags.js";

export interface FlagProbeResult {
  id: string;
  /** true when binary missing (skipped) or flag found */
  ok: boolean;
  skipped: boolean;
  detail: string;
}

async function which(cmd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execa(process.platform === "win32" ? "where" : "which", [cmd], {
      timeout: 5_000,
      reject: false,
    });
    const line = stdout.trim().split("\n")[0]?.trim();
    return line || undefined;
  } catch {
    return undefined;
  }
}

async function resolveBin(kind: InjectFlagProbe["bin"]): Promise<string | undefined> {
  switch (kind) {
    case "claude":
      return which("claude");
    case "opencode":
      return which("opencode");
    case "cursor-agent": {
      const preferred = agentBin();
      try {
        await fs.promises.access(preferred, fs.constants.F_OK);
        return preferred;
      } catch {
        const named = await which("cursor-agent");
        if (named) return named;
        return undefined;
      }
    }
    case "agy": {
      const preferred = agyBin();
      try {
        await fs.promises.access(preferred, fs.constants.F_OK);
        return preferred;
      } catch {
        return which("agy");
      }
    }
    case "codex": {
      try {
        const preferred = codexBin();
        await fs.promises.access(preferred, fs.constants.F_OK);
        return preferred;
      } catch {
        return which("codex");
      }
    }
    case "copilot": {
      try {
        const preferred = copilotBin();
        await fs.promises.access(preferred, fs.constants.F_OK);
        return preferred;
      } catch {
        return which("copilot");
      }
    }
    case "grok": {
      try {
        const preferred = grokBin();
        await fs.promises.access(preferred, fs.constants.F_OK);
        return preferred;
      } catch {
        return which("grok");
      }
    }
    default:
      return undefined;
  }
}

const helpCache = new Map<string, string>();

async function helpText(bin: string, helpArgs?: string[]): Promise<string> {
  const cacheKey = `${bin}\0${(helpArgs ?? []).join("\0")}`;
  const cached = helpCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let text = "";
  const attempts = helpArgs?.length
    ? [helpArgs]
    : ([["--help"], ["-h"], ["help"]] as string[][]);

  for (const args of attempts) {
    try {
      const { stdout, stderr } = await execa(bin, args, {
        timeout: 12_000,
        reject: false,
      });
      text = `${stdout}\n${stderr}`;
      if (text.trim().length > 40) break;
    } catch {
      /* try next */
    }
  }
  helpCache.set(cacheKey, text);
  return text;
}

function labelFor(p: InjectFlagProbe): string {
  return p.match[0] ?? p.id;
}

/**
 * When the CLI binary exists, require inject-critical tokens in help output.
 * Missing binaries are skipped (not failures) — local installs vary.
 */
export async function probeInjectFlags(
  probes: InjectFlagProbe[] = INJECT_FLAG_PROBES,
): Promise<FlagProbeResult[]> {
  helpCache.clear();
  const out: FlagProbeResult[] = [];
  const binByKind = new Map<InjectFlagProbe["bin"], string | undefined>();

  for (const p of probes) {
    if (!binByKind.has(p.bin)) {
      binByKind.set(p.bin, await resolveBin(p.bin));
    }
    const bin = binByKind.get(p.bin);
    if (!bin) {
      out.push({
        id: `flag:${p.id}`,
        ok: true,
        skipped: true,
        detail: `${p.bin} not installed — skip (${p.why})`,
      });
      continue;
    }
    const help = await helpText(bin, p.helpArgs);
    const hit = p.match.find((m) => help.includes(m));
    const scope = p.helpArgs?.length ? `${p.helpArgs.join(" ")}` : "help";
    out.push({
      id: `flag:${p.id}`,
      ok: Boolean(hit),
      skipped: false,
      detail: hit
        ? `${bin} ${scope} mentions ${hit}`
        : `${bin} ${scope} missing ${labelFor(p)} (${p.why}) — upstream CLI may have renamed a flag we use for inject`,
    });
  }
  return out;
}
