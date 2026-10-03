import path from "node:path";
import { threadleApp } from "../ui/vite.app";

// Viewer app — `threadle` (:4570), dev on :5173.
export default threadleApp({
  dir: import.meta.dirname,
  port: 5173,
  outDir: "web-dist",
  alias: { "@": path.resolve(import.meta.dirname, "src") },
});
