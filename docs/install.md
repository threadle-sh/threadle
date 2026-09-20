# Install

## Curl (no npm) — macOS / Linux

```sh
curl -fsSL https://threadle.sh/install.sh | bash
threadle
```

[`scripts/install.sh`](../scripts/install.sh) downloads a platform archive from GitHub Releases, verifies `SHA256SUMS`, extracts to `~/.local/share/threadle`, and symlinks `~/.local/bin/threadle`.

Requires **macOS or Linux** (arm64 / x64). Bundled Node 26 — no system Node or npm needed. Pin with `THREADLE_VERSION=1.0.2`. Other env knobs: `THREADLE_INSTALL_DIR`, `THREADLE_BIN_DIR`, `THREADLE_REPO`, `THREADLE_PLATFORM`.

## Windows / any OS with Node ≥ 22.12

```sh
npx threadle
# from a clone:
git clone https://github.com/threadle-sh/threadle && cd threadle
npm install && npm run build && npm start
```

Config root defaults to `%USERPROFILE%\.config\threadle` (override with `THREADLE_CONFIG_DIR`). Provider homes follow each tool’s Windows layout under your user profile (`%USERPROFILE%\.claude`, `.cursor`, …) unless you set `CLAUDE_CONFIG_DIR` / `CURSOR_CONFIG_DIR` / `CODEX_HOME` / etc.

There is no curl-portable / `install.ps1` yet — use `npx` or a clone.

## WSL

Install **threadle and your agent CLIs inside the same WSL distro** for a Linux-identical setup (including the curl installer). That process only sees agent storage under the WSL home (`~/.claude`, …).

Native Windows threadle only sees native Windows agent homes. Cross-boundary discovery (`\\wsl$\…`, Windows Cursor from a WSL server) is **not supported**.

## Archive layout (portable)

```
threadle-<version>-<platform>/
  bin/threadle          # wrapper → bundled node + app/dist/cli.js
  node/                 # official Node.js binary tree
  app/
    dist/               # tsup CLI bundle
    web-dist/           # Vite UI
    package.json
    node_modules/       # production deps only
```

Platforms: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`.

## Uninstall

```sh
rm -rf ~/.local/share/threadle ~/.local/bin/threadle   # portable install
rm -rf ~/.config/threadle                              # optional: workflows, runs, library
```

npm installs remove with `npm uninstall -g threadle` (or just stop using `npx`). Agent storage is never touched — your sessions stay exactly where they were.

## Maintainers

| Command | Purpose |
|---|---|
| `npm run pack:portable` | Pack current host platform + `.tar.gz` + `.sha256` |
| `npm run pack:portable:smoke` | Pack + run `--help` / `templates` / `check` |
| `npm run release:artifacts` | Pack all four platforms + combined `SHA256SUMS` |
| Tag `X.Y.Z` or `vX.Y.Z` (must match `packages/server/package.json`) | [`.github/workflows/release.yml`](../.github/workflows/release.yml) uploads release assets + publishes npm |

Point `https://threadle.sh/install.sh` at the raw script on `main` (or a CDN copy of [`scripts/install.sh`](../scripts/install.sh)).
