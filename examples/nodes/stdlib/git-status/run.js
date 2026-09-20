const { spawnSync } = require("node:child_process");
const path = require("node:path");

const params = JSON.parse(process.env.THREADLE_PARAMS ?? "{}");
const dir = (params.dir || "").trim();

if (!dir || !path.isAbsolute(dir)) {
  process.stderr.write(
    "git-status: set param `dir` to an absolute git working tree path\n",
  );
  process.exit(1);
}

const res = spawnSync("git", ["-C", dir, "status", "--short"], {
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
});

if (res.error) {
  process.stderr.write(
    res.error.code === "ENOENT"
      ? "git-status: git not found on PATH\n"
      : `git-status: ${res.error.message}\n`,
  );
  process.exit(1);
}
if (res.status !== 0) {
  process.stderr.write(res.stderr || `git status exited ${res.status}\n`);
  process.exit(res.status ?? 1);
}
process.stdout.write(res.stdout || "");
