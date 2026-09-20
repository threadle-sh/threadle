/** Pull the first JSON value out of messy agent / markdown text. */
export default class ExtractJson {
  async run(input: string): Promise<string> {
    const fenced = input.match(/```(?:json|JSON)?\s*\n([\s\S]*?)```/);
    if (fenced?.[1]) {
      const body = fenced[1].trim();
      JSON.parse(body);
      return body;
    }
    const start = (() => {
      const o = input.indexOf("{");
      const a = input.indexOf("[");
      if (o < 0) return a;
      if (a < 0) return o;
      return Math.min(o, a);
    })();
    if (start < 0) throw new Error("extract-json: no JSON object/array found");

    const slice = input.slice(start);
    const stack: string[] = [];
    let inStr = false;
    let esc = false;
    for (let i = 0; i < slice.length; i++) {
      const ch = slice[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === "{" || ch === "[") {
        stack.push(ch);
        continue;
      }
      if (ch === "}" || ch === "]") {
        const open = stack.pop();
        if (
          (ch === "}" && open !== "{") ||
          (ch === "]" && open !== "[") ||
          open === undefined
        ) {
          throw new Error("extract-json: mismatched brackets");
        }
        if (stack.length === 0) {
          const candidate = slice.slice(0, i + 1);
          JSON.parse(candidate);
          return candidate;
        }
      }
    }
    throw new Error("extract-json: found opener but could not parse JSON");
  }
}
