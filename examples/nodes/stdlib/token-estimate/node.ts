/** chars÷N token estimate — pairs with a tokens circuit breaker. */
export default class TokenEstimate {
  async run(
    input: string,
    ctx: { params: Record<string, string> },
  ): Promise<string> {
    const div = Math.max(1, Number(ctx.params.divisor ?? 4) || 4);
    const chars = input.length;
    const tokens = Math.ceil(chars / div);
    return String(tokens);
  }
}
