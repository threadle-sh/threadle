/** Shared helpers for path context-menu actions (open / copy). */

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Fetch text body for a local path via the preview API (capped). */
export async function fetchFileText(filePath: string): Promise<string> {
  const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
  const body = (await res.json()) as { error?: string; content?: string };
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body.content ?? "";
}
