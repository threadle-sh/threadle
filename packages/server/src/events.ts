import { EventEmitter } from "node:events";
import type { ServerEvent } from "@threadle/shared";

class EventBus extends EventEmitter {
  publish(event: ServerEvent): void {
    this.emit("event", event);
  }

  subscribe(handler: (event: ServerEvent) => void): () => void {
    this.on("event", handler);
    return () => this.off("event", handler);
  }
}

export const bus = new EventBus();
// One listener per SSE client; the Node default (10) would warn on the 11th
// tab. High ceiling, not unlimited — a runaway subscriber bug should still
// surface as a warning eventually.
bus.setMaxListeners(100);

let jobCounter = 0;

export function newJobId(): string {
  jobCounter += 1;
  return `job_${Date.now().toString(36)}_${jobCounter}`;
}
