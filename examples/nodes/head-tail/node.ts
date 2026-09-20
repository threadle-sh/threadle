/**
 * Demonstrates params + named ports: ctx.params carries the widget values
 * (always strings), ctx.inputs the named input ports, and returning an
 * object fills the declared output ports.
 */
export default class HeadTail {
  async run(
    _raw: string,
    ctx: { params: Record<string, string>; inputs?: Record<string, string> },
  ): Promise<{ head: string; tail: string }> {
    const n = Math.max(1, parseInt(ctx.params.n ?? "1", 10) || 1);
    let lines = (ctx.inputs?.text ?? "").split("\n");
    if (!/^(true|1)$/i.test(ctx.params["keep-blank"] ?? "")) {
      lines = lines.filter((l) => l.trim() !== "");
    }
    return { head: lines.slice(0, n).join("\n"), tail: lines.slice(n).join("\n") };
  }
}
