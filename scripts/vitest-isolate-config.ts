/**
 * Vitest setup for the server packages: never touch the real
 * ~/.config/threadle. Each test file gets a throwaway config dir unless it
 * sets THREADLE_CONFIG_DIR itself (many do, for their own fixtures).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-test-config-"));
process.env.THREADLE_CONFIG_DIR = dir;

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
