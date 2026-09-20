export default class SumNumbers {
  async run(input: string): Promise<string> {
    let total = 0;
    const walk = (v: unknown): void => {
      if (typeof v === "number") total += v;
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(JSON.parse(input));
    return String(total);
  }
}
