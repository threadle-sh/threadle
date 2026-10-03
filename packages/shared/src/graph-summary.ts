/** Run status of one graph node (also carried by the `job.node` server event). */
export type NodeStatus = "idle" | "queued" | "running" | "success" | "error";

/** Saved workflow as listed by the API (no nodes / edges). */
export interface GraphSummary {
  id: string;
  name: string;
  kind: "workflow" | "subgraph";
  nodeCount: number;
  edgeCount: number;
  updatedAt: number;
  createdAt: number;
  /** imported JSON whose execution manifest has not been confirmed yet */
  unconfirmedImport?: boolean;
  /** how many other graphs link a frame to this id (0 = unused as subgraph) */
  usedBy?: number;
}
