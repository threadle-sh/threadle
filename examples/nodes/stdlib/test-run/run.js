/**
 * Run a space-split argv in an absolute dir; prefix output with ok:/err:.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const stdinText = Buffer.concat(chunks).toString("utf8");
  const params = JSON.parse(process.env.THREADLE_PARAMS ?? "{}");
  const argvStr = (params.argv || "npm test").trim();
  const dir = (params.dir || "").trim();

  if (!dir || !path.isAbsolute(dir)) {
    process.stderr.write(
      "test-run: set param `dir` to an absolute working directory\n",
    );
    process.exit(1);
  }

  const argv = argvStr.split(/\s+/).filter(Boolean);
  if (!argv.length) {
    process.stderr.write("test-run: empty argv\n");
    process.exit(1);
  }

  const [bin, ...args] = argv;
  const res = spawnSync(bin, args, {
    cwd: dir,
    input: stdinText,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    env: process.env,
  });

  if (res.error && res.error.code === "ENOENT") {
    process.stderr.write(`test-run: command not found: ${bin}\n`);
    process.exit(1);
  }

  const body = [res.stdout, res.stderr].filter(Boolean).join("\n").trim();
  const ok = (res.status ?? 1) === 0;
  const prefix = ok ? "ok" : "err";
  process.stdout.write(
    `${prefix}: exit ${res.status ?? "?"}${body ? `\n\n${body}` : ""}`,
  );
  process.exit(0);
});
