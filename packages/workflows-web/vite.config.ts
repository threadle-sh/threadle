import path from "node:path";
import { threadleApp } from "../ui/vite.app";

// Workflows editor app — `threadle-workflows` (:4571), dev on :5174.
export default threadleApp({
  dir: import.meta.dirname,
  port: 5174,
  outDir: "web-dist-workflows",
  alias: { "@wf": path.resolve(import.meta.dirname, "src") },
});
