const { spawnSync } = require("node:child_process");
const path = require("node:path");

const params = JSON.parse(process.env.THREADLE_PARAMS ?? "{}");
const dir = (params.dir || "").trim();
const pathspec = (params.pathspec || "").trim();
const staged = /^(true|1)$/i.test(String(params.staged ?? ""));

if (!dir || !path.isAbsolute(dir)) {
  process.stderr.write(
    "git-diff: set param `dir` to an absolute git working tree path\n",
  );
  process.exit(1);
}

const args = ["-C", dir, "diff"];
if (staged) args.push("--cached");
if (pathspec) args.push("--", pathspec);

const res = spawnSync("git", args, {
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
});

if (res.error) {
  process.stderr.write(
    res.error.code === "ENOENT"
      ? "git-diff: git not found on PATH\n"
      : `git-diff: ${res.error.message}\n`,
  );
  process.exit(1);
}
if (res.status !== 0) {
  process.stderr.write(res.stderr || `git diff exited ${res.status}\n`);
  process.exit(res.status ?? 1);
}
process.stdout.write(res.stdout || "");
