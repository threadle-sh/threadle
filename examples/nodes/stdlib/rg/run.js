/**
 * Spawn rg; print matching file paths (one per line).
 * `dir` must be an absolute path — custom nodes do not receive projectDir.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const stdinText = Buffer.concat(chunks).toString("utf8").trim();
  const params = JSON.parse(process.env.THREADLE_PARAMS ?? "{}");
  const pattern = ((params.pattern || "").trim() || stdinText || ".")
    .split("\n")[0];
  const dir = (params.dir || "").trim();
  const glob = (params.glob || "").trim();

  if (!dir || !path.isAbsolute(dir)) {
    process.stderr.write(
      "rg: set param `dir` to an absolute project path (custom nodes have no projectDir)\n",
    );
    process.exit(1);
  }

  const args = ["--files-with-matches", "--color", "never", "-e", pattern];
  if (glob) args.push("--glob", glob);
  args.push(dir);

  const res = spawnSync("rg", args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });

  if (res.error) {
    process.stderr.write(
      res.error.code === "ENOENT"
        ? "rg: not found on PATH — install ripgrep\n"
        : `rg: ${res.error.message}\n`,
    );
    process.exit(1);
  }
  if (res.status !== 0 && res.status !== 1) {
    process.stderr.write(res.stderr || `rg exited ${res.status}\n`);
    process.exit(res.status ?? 1);
  }
  process.stdout.write(res.stdout || "");
});
