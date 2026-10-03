import type { GraphSummary } from "@threadle/shared";
import type { AtlasGraphScan } from "./atlas/build.js";

/**
 * What core (viewer side) may ask of the optional workflows package. The
 * composition root registers an implementation when workflows are mounted;
 * without one, core behaves as if no workflows exist.
 */
export interface WorkflowsPort {
  listGraphs(): Promise<GraphSummary[]>;
  graphExists(id: string): Promise<boolean>;
  /** workflows reduced to what the project atlas shows */
  atlasGraphs(): Promise<AtlasGraphScan[]>;
  /** bundled workflow templates (threadle check) */
  templateCount(): number;
  /** in-flight custom-node processes (internals view) */
  activeCustomRuns(): number;
}

const NONE: WorkflowsPort = {
  listGraphs: async () => [],
  graphExists: async () => false,
  atlasGraphs: async () => [],
  templateCount: () => 0,
  activeCustomRuns: () => 0,
};

let port: WorkflowsPort | undefined;

export function registerWorkflowsPort(impl: WorkflowsPort): void {
  port = impl;
}

export function workflowsPort(): WorkflowsPort {
  return port ?? NONE;
}

/** True when a workflows package registered itself (UI hides Workflows otherwise). */
export function workflowsEnabled(): boolean {
  return port !== undefined;
}
