/** Split markdown into ## sections; emit a JSON array for iterator json mode. */
export default class SplitMd {
  async run(input: string): Promise<string> {
    const text = input.replace(/\r\n/g, "\n").trim();
    if (!text) return "[]";

    const parts = text.split(/\n(?=##\s)/);
    const chunks = parts
      .map((p) => p.trim())
      .filter(Boolean);

    // No ## headings — one chunk (whole doc) so iterator still gets something.
    return JSON.stringify(chunks);
  }
}
