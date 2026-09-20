export default class ExtractUrls {
  async run(input: string): Promise<string> {
    const urls = input.match(/https?:\/\/[^\s)\]}>"']+/g) ?? [];
    return [...new Set(urls)].join("\n");
  }
}
