#!/usr/bin/env node
/**
 * `threadle-workflows` — the workflows editor + runner as its own entry point
 * (same server and state as `threadle`; opens /workflows instead of the viewer).
 */
process.argv.splice(2, 0, "--editor");
await import("./cli.js");
