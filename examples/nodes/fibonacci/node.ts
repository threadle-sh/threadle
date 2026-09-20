export default class Fibonacci {
  async run(input: string): Promise<string> {
    const n = Math.min(Number.parseInt(input.trim(), 10), 90);
    const seq: bigint[] = [];
    let [a, b] = [0n, 1n];
    for (let i = 0; i < n; i++) {
      seq.push(a);
      [a, b] = [b, a + b];
    }
    return seq.join(", ");
  }
}
