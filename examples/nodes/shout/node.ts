export default class Shout {
  async run(input: string): Promise<string> {
    return input.toUpperCase() + "!!!";
  }
}
