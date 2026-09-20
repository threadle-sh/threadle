import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { bus } from "../events.js";

export const eventRoutes = new Hono();

/**
 * Per-client write budget. A stalled-but-open socket (laptop lid closed,
 * half-open TCP) makes every write pend forever inside the stream — without
 * a cap the queue retains every event in memory for days. Under pressure we
 * shed the 2s `live.status` heartbeat first (the next one supersedes it),
 * and past the hard cap we drop the client entirely; the browser's
 * EventSource reconnects with a fresh stream when it wakes.
 */
const DROP_ABOVE = 100;
const CLOSE_ABOVE = 1000;
/** A keep-alive ping that hasn't settled in this long = dead client. */
const PING_SETTLE_MS = 60_000;

eventRoutes.get("/", (c) =>
  streamSSE(c, async (stream) => {
    let id = 0;
    let open = true;
    let pending = 0;
    let unsubscribe = (): void => undefined;

    const shutdown = (): void => {
      if (!open) return;
      open = false;
      unsubscribe();
      void stream.close();
    };

    unsubscribe = bus.subscribe((event) => {
      if (!open) return;
      if (pending >= CLOSE_ABOVE) {
        shutdown();
        return;
      }
      if (pending >= DROP_ABOVE && event.type === "live.status") return;
      pending += 1;
      stream
        .writeSSE({ data: JSON.stringify(event), id: String(++id) })
        .catch(() => undefined)
        .finally(() => {
          pending -= 1;
        });
    });

    stream.onAbort(() => {
      open = false;
      unsubscribe();
    });

    // keep-alive comments so proxies don't kill the stream — and the one
    // write we WAIT on: a ping that never settles means the abort event is
    // never coming (half-open socket), so we tear down ourselves.
    while (open) {
      await stream.sleep(15_000);
      if (!open) break;
      let settled = false;
      const ping = stream
        .write(": ping\n\n")
        .catch(() => undefined)
        .finally(() => {
          settled = true;
        });
      await Promise.race([ping, stream.sleep(PING_SETTLE_MS)]);
      if (!settled) {
        shutdown();
        break;
      }
    }
  }),
);
