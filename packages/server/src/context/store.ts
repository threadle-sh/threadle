import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ContextKind, ContextPayload, ProviderId } from "@threadle/shared";
import { threadleConfigDir } from "../graphs/store.js";

function payloadsDir(): string {
  return path.join(threadleConfigDir(), "payloads");
}

export function hashPayload(input: {
  kind: ContextKind;
  source: { provider: ProviderId; sessionId: string };
  content: string;
}): string {
  return crypto
    .createHash("sha256")
    .update(input.kind)
    .update("\0")
    .update(input.source.provider)
    .update("\0")
    .update(input.source.sessionId)
    .update("\0")
    .update(input.content)
    .digest("hex");
}

export async function storePayload(
  payload: Omit<ContextPayload, "hash">,
): Promise<ContextPayload> {
  const hash = hashPayload(payload);
  const dir = path.join(payloadsDir(), hash.slice(0, 2));
  await fs.promises.mkdir(dir, { recursive: true });
  const full: ContextPayload = { ...payload, hash };
  const file = path.join(dir, `${hash}.json`);
  try {
    await fs.promises.access(file);
    // content-addressed: identical payload already stored
  } catch {
    const tmp = `${file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(full, null, 2), "utf8");
    await fs.promises.rename(tmp, file);
    // sidecar .md for humans browsing ~/.config/threadle/payloads
    if (payload.kind !== "files") {
      await fs.promises.writeFile(
        path.join(dir, `${hash}.md`),
        payload.content,
        "utf8",
      );
    }
  }
  return full;
}

export async function readPayload(hash: string): Promise<ContextPayload | undefined> {
  if (!/^[0-9a-f]{64}$/.test(hash)) return undefined;
  const file = path.join(payloadsDir(), hash.slice(0, 2), `${hash}.json`);
  try {
    return JSON.parse(await fs.promises.readFile(file, "utf8")) as ContextPayload;
  } catch {
    return undefined;
  }
}
