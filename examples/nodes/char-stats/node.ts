export default class TextStats {
  async run(input: string): Promise<string> {
    return JSON.stringify(
      {
        chars: input.length,
        words: (input.trim().match(/\S+/g) ?? []).length,
        lines: input === "" ? 0 : input.split("\n").length,
      },
      null,
      2,
    );
  }
}
