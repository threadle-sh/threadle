import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/workflows-bin.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  noExternal: [/^@threadle\//],
  external: ["node:sqlite"],
});
