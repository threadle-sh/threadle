/** Portable replacement for `sort -u` — works on Windows without GNU coreutils. */
export default class SortUnique {
  async run(input: string): Promise<string> {
    const lines = input.split(/\r?\n/);
    const uniq = [...new Set(lines)];
    uniq.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return uniq.join("\n");
  }
}
