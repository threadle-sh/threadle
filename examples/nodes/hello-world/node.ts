/**
 * Minimal custom node — import via Settings → custom nodes → ⇣ Import
 * with the absolute path to this folder.
 */
export default class HelloWorld {
  async run(input: string): Promise<string> {
    const name = input.trim();
    return name ? `Hello, ${name}!` : "Hello, world!";
  }
}
