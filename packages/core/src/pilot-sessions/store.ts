import fs from "node:fs";
import path from "node:path";
import { threadleConfigDir } from "../paths.js";

export interface PilotSessionEntry {
  provider: string;
  sessionId: string;
  markedAt: number;
  caseId?: string;
  tokensIn?: number;
  tokensOut?: number;
  promptEst?: number;
  baselineEst?: number;
  baselineNote?: string;
  ignoreLocalMarkdown?: boolean;
}

interface PilotSessionsFile {
  version: 1;
  entries: PilotSessionEntry[];
}

function storePath(): string {
  return path.join(threadleConfigDir(), "pilot-sessions.json");
}

export function pilotSessionKey(provider: string, sessionId: string): string {
  return `${provider}:${sessionId}`;
}

async function readFile(): Promise<PilotSessionsFile> {
  try {
    const raw = JSON.parse(
      await fs.promises.readFile(storePath(), "utf8"),
    ) as PilotSessionsFile;
    if (raw?.version === 1 && Array.isArray(raw.entries)) return raw;
  } catch {
    // missing / corrupt -> empty
  }
  return { version: 1, entries: [] };
}

async function writeFile(data: PilotSessionsFile): Promise<void> {
  await fs.promises.mkdir(threadleConfigDir(), { recursive: true });
  await fs.promises.writeFile(storePath(), JSON.stringify(data, null, 2), "utf8");
}

export async function markPilotSession(opts: {
  provider: string;
  sessionId: string;
  caseId?: string;
  tokensIn?: number;
  tokensOut?: number;
  promptEst?: number;
  baselineEst?: number;
  baselineNote?: string;
  ignoreLocalMarkdown?: boolean;
}): Promise<PilotSessionEntry> {
  const data = await readFile();
  const key = pilotSessionKey(opts.provider, opts.sessionId);
  const existing = data.entries.find(
    (e) => pilotSessionKey(e.provider, e.sessionId) === key,
  );
  if (existing) {
    if (opts.caseId && !existing.caseId) existing.caseId = opts.caseId;
    if (opts.tokensIn != null) existing.tokensIn = opts.tokensIn;
    if (opts.tokensOut != null) existing.tokensOut = opts.tokensOut;
    if (opts.promptEst != null) existing.promptEst = opts.promptEst;
    if (opts.baselineEst != null) existing.baselineEst = opts.baselineEst;
    if (opts.baselineNote) existing.baselineNote = opts.baselineNote;
    if (opts.ignoreLocalMarkdown != null) {
      existing.ignoreLocalMarkdown = opts.ignoreLocalMarkdown;
    }
    await writeFile(data);
    return existing;
  }
  const entry: PilotSessionEntry = {
    provider: opts.provider,
    sessionId: opts.sessionId,
    markedAt: Date.now(),
    caseId: opts.caseId,
    tokensIn: opts.tokensIn,
    tokensOut: opts.tokensOut,
    promptEst: opts.promptEst,
    baselineEst: opts.baselineEst,
    baselineNote: opts.baselineNote,
    ignoreLocalMarkdown: opts.ignoreLocalMarkdown,
  };
  data.entries.unshift(entry);
  if (data.entries.length > 2000) data.entries.length = 2000;
  await writeFile(data);
  return entry;
}

export async function readPilotSessionMap(): Promise<Map<string, PilotSessionEntry>> {
  const data = await readFile();
  return new Map(
    data.entries.map((e) => [pilotSessionKey(e.provider, e.sessionId), e] as const),
  );
}

export async function readPilotSessionKeys(): Promise<Set<string>> {
  return new Set((await readPilotSessionMap()).keys());
}

export async function listPilotSessions(): Promise<PilotSessionEntry[]> {
  return (await readFile()).entries;
}
