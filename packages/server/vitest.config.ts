import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // CLI spawn + fixture walks routinely exceed the 5s default under load.
    testTimeout: 15_000,
    hookTimeout: 20_000,
  },
});
