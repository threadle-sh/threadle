/** Wait-for-idle gate — park until a session is not generating. */

import type { SessionStatus } from "./session.js";

export const WAIT_IDLE_TIMEOUT_DEFAULT_MS = 60_000;
export const WAIT_IDLE_TIMEOUT_HARD_CAP_MS = 300_000;
export const WAIT_IDLE_POLL_MS = 1_000;

export const WAIT_IDLE_ON_TIMEOUT = ["park", "skip", "abort"] as const;
export type WaitIdleOnTimeout = (typeof WAIT_IDLE_ON_TIMEOUT)[number];

/** Busy = actively generating or blocked on input — unsafe to inject into. */
export function isSessionBusy(status: SessionStatus | undefined): boolean {
  return status === "running" || status === "waiting";
}

export function clampWaitIdleTimeoutMs(raw: number | undefined): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1_000) return WAIT_IDLE_TIMEOUT_DEFAULT_MS;
  return Math.min(n, WAIT_IDLE_TIMEOUT_HARD_CAP_MS);
}

export type WaitIdleDecision =
  | { kind: "continue" }
  | { kind: "skip" }
  | { kind: "abort" }
  | { kind: "park" };

/** After the poll loop: idle → continue; else apply onTimeout policy. */
export function decideWaitIdle(opts: {
  gotIdle: boolean;
  onTimeout?: WaitIdleOnTimeout;
}): WaitIdleDecision {
  if (opts.gotIdle) return { kind: "continue" };
  const onTimeout = opts.onTimeout ?? "park";
  if (onTimeout === "skip") return { kind: "skip" };
  if (onTimeout === "abort") return { kind: "abort" };
  return { kind: "park" };
}
