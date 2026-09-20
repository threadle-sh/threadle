/**
 * Spawn jq with filter/raw from THREADLE_PARAMS. Fail loudly if jq is missing.
 */
const { spawnSync } = require("node:child_process");

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const input = Buffer.concat(chunks).toString("utf8");
  const params = JSON.parse(process.env.THREADLE_PARAMS ?? "{}");
  const filter = (params.filter || ".").trim() || ".";
  const raw = /^(true|1)$/i.test(String(params.raw ?? ""));

  const args = raw ? ["-r", "-c", filter] : ["-c", filter];
  const res = spawnSync("jq", args, {
    input,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });

  if (res.error) {
    process.stderr.write(
      res.error.code === "ENOENT"
        ? "jq: not found on PATH — install jq (https://jqlang.github.io/jq/)\n"
        : `jq: ${res.error.message}\n`,
    );
    process.exit(1);
  }
  if (res.status !== 0) {
    process.stderr.write(res.stderr || `jq exited ${res.status}\n`);
    process.exit(res.status ?? 1);
  }
  process.stdout.write(res.stdout);
});
