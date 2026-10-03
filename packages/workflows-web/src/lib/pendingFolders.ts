/** sessionStorage key for folder path handoff on newly created empty drafts. */
export function pendingFoldersKey(graphId: string): string {
  return `threadle:pending-folders:${graphId}`;
}

export function readPendingFolders(graphId: string): string[] | undefined {
  try {
    const raw = sessionStorage.getItem(pendingFoldersKey(graphId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function writePendingFolders(graphId: string, folders: string[]): void {
  try {
    sessionStorage.setItem(pendingFoldersKey(graphId), JSON.stringify(folders));
  } catch {
    /* ignore */
  }
}

export function clearPendingFoldersStorage(graphId: string): void {
  try {
    sessionStorage.removeItem(pendingFoldersKey(graphId));
  } catch {
    /* ignore */
  }
}
