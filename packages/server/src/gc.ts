import fs from "node:fs";
import path from "node:path";
import { threadleConfigDir } from "./graphs/store.js";

const TMP_MAX_AGE_MS = 72 * 60 * 60 * 1000;

/** Best-effort cleanup of inject/agent temp files older than 72h. */
export async function gcTmpFiles(): Promise<void> {
  const dir = path.join(threadleConfigDir(), "tmp");
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - TMP_MAX_AGE_MS;
  for (const name of names) {
    const p = path.join(dir, name);
    try {
      const st = await fs.promises.stat(p);
      if (st.isFile() && st.mtimeMs < cutoff) await fs.promises.rm(p);
    } catch {
      // ignore
    }
  }
}
