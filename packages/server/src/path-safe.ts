import path from "node:path";
import { isPathInside } from "@threadle/shared";

/**
 * Resolve + containment check. Case-insensitive on win32 AND darwin —
 * APFS/HFS+ are case-insensitive by default and do not canonicalize case in
 * realpath, so `/Users/x/.SSH` must compare equal to `/Users/x/.ssh`.
 */
export function pathContained(child: string, root: string): boolean {
  return isPathInside(path.resolve(child), path.resolve(root), {
    caseInsensitive: process.platform === "win32" || process.platform === "darwin",
  });
}

/** Same directory or either nests under the other. */
export function pathSameOrNested(a: string, b: string): boolean {
  return pathContained(a, b) || pathContained(b, a);
}
