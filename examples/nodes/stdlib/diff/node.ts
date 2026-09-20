/**
 * Minimal unified diff of two text ports (no external `diff` binary).
 * Enough to feed a Judge on "empty vs changed".
 */
function unifiedDiff(a: string, b: string, context: number): string {
  const aLines = a.replace(/\r\n/g, "\n").split("\n");
  const bLines = b.replace(/\r\n/g, "\n").split("\n");
  // Myers-ish via LCS DP for small texts (agent drafts)
  const n = aLines.length;
  const m = bLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        aLines[i] === bLines[j]
          ? (dp[i + 1]![j + 1]! + 1)
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  type Op = { t: "eq" | "del" | "add"; line: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      ops.push({ t: "eq", line: aLines[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ t: "del", line: aLines[i]! });
      i++;
    } else {
      ops.push({ t: "add", line: bLines[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ t: "del", line: aLines[i++]! });
  while (j < m) ops.push({ t: "add", line: bLines[j++]! });

  if (ops.every((o) => o.t === "eq")) {
    return "";
  }

  const out: string[] = ["--- a", "+++ b"];
  // Emit with context windows around change hunks
  const changeIdx = ops
    .map((o, idx) => (o.t !== "eq" ? idx : -1))
    .filter((idx) => idx >= 0);
  const keep = new Set<number>();
  for (const idx of changeIdx) {
    for (
      let k = Math.max(0, idx - context);
      k <= Math.min(ops.length - 1, idx + context);
      k++
    ) {
      keep.add(k);
    }
  }
  const lineNoAt: { a: number; b: number }[] = [];
  {
    let aa = 1;
    let bb = 1;
    for (const o of ops) {
      lineNoAt.push({ a: aa, b: bb });
      if (o.t === "eq") {
        aa++;
        bb++;
      } else if (o.t === "del") aa++;
      else bb++;
    }
  }
  let idx = 0;
  while (idx < ops.length) {
    if (!keep.has(idx)) {
      idx++;
      continue;
    }
    let end = idx;
    while (end + 1 < ops.length && keep.has(end + 1)) end++;
    const hunk = ops.slice(idx, end + 1);
    const startA = lineNoAt[idx]!.a;
    const startB = lineNoAt[idx]!.b;
    let countA = 0;
    let countB = 0;
    for (const o of hunk) {
      if (o.t === "eq") {
        countA++;
        countB++;
      } else if (o.t === "del") countA++;
      else countB++;
    }
    out.push(`@@ -${startA},${countA} +${startB},${countB} @@`);
    for (const o of hunk) {
      if (o.t === "eq") out.push(` ${o.line}`);
      else if (o.t === "del") out.push(`-${o.line}`);
      else out.push(`+${o.line}`);
    }
    idx = end + 1;
  }

  return out.join("\n");
}

export default class Diff {
  async run(
    _raw: string,
    ctx: { params: Record<string, string>; inputs?: Record<string, string> },
  ): Promise<{ diff: string }> {
    const a = ctx.inputs?.a ?? "";
    const b = ctx.inputs?.b ?? "";
    const context = Math.max(
      0,
      Math.min(20, parseInt(ctx.params.context ?? "3", 10) || 3),
    );
    return { diff: unifiedDiff(a, b, context) };
  }
}
