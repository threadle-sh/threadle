import type { Connection } from "@vue-flow/core";
import {
  isValidConnection as isValidPair,
  valueTypeCompatible,
  type CustomPortDef,
  type GraphNode,
  type NodeType,
  type ValueType,
} from "@threadle/shared";

/** Minimal custom-node shape needed for port type resolution. */
export interface ConnectionCustomDef {
  name: string;
  input?: ValueType;
  output?: ValueType;
  inputs?: CustomPortDef[];
  outputs?: CustomPortDef[];
}

export interface ConnectionRulesOptions {
  nodeById: (id: string) => GraphNode | undefined;
  findCustomDef: (name: string) => ConnectionCustomDef | undefined;
}

export function useConnectionRules(opts: ConnectionRulesOptions): {
  isLinkedFrame: (id: string) => boolean;
  emittedType: (id: string, handle?: string | null) => ValueType;
  expectedType: (id: string, handle?: string | null) => ValueType;
  customPortsFor: (
    nodeId: string,
  ) => { inputs?: CustomPortDef[]; outputs?: CustomPortDef[] } | undefined;
  checkConnection: (conn: Connection) => boolean;
  checkConnectionTypes: (conn: Connection) => boolean;
} {
  function nodeType(id: string): NodeType | undefined {
    return opts.nodeById(id)?.type;
  }

  function isLinkedFrame(id: string): boolean {
    const n = opts.nodeById(id);
    return n?.data.type === "group" && !!n.data.graphId;
  }

  /** the value type a node emits on the text lane (or a named out: handle), if it declares one */
  function emittedType(id: string, handle?: string | null): ValueType {
    const n = opts.nodeById(id);
    if (!n) return "text";
    if (n.data.type === "prompt") return n.data.valueType ?? "text";
    if (n.data.type === "data") return n.data.valueType ?? "text";
    if (n.data.type === "custom") {
      const data = n.data;
      const def = opts.findCustomDef(data.ref.name);
      const outs = def?.outputs ?? data.snapshot?.outputs;
      if (outs?.length) {
        const port = handle?.startsWith("out:") ? handle.slice(4) : undefined;
        return (port ? outs.find((p) => p.name === port) : outs[0])?.type ?? "text";
      }
      return def?.output ?? data.snapshot?.output ?? "text";
    }
    return "text";
  }

  /** the value type a node expects on its input (or a named in: handle), if it declares one */
  function expectedType(id: string, handle?: string | null): ValueType {
    const n = opts.nodeById(id);
    if (!n) return "text";
    // Data's valueType is the *coerce target*, not a hard wire filter — see checkConnectionTypes
    if (n.data.type === "data") return n.data.valueType ?? "text";
    if (n.data.type === "custom") {
      const data = n.data;
      const def = opts.findCustomDef(data.ref.name);
      const ins = def?.inputs ?? data.snapshot?.inputs;
      if (ins?.length) {
        const port = handle?.startsWith("in:") ? handle.slice(3) : undefined;
        return (port ? ins.find((p) => p.name === port) : ins[0])?.type ?? "text";
      }
      return def?.input ?? data.snapshot?.input ?? "text";
    }
    return "text";
  }

  function customPortsFor(nodeId: string):
    | { inputs?: CustomPortDef[]; outputs?: CustomPortDef[] }
    | undefined {
    const n = opts.nodeById(nodeId);
    if (!n || n.data.type !== "custom") return undefined;
    const data = n.data;
    const live = opts.findCustomDef(data.ref.name);
    return {
      inputs: live?.inputs ?? data.snapshot?.inputs,
      outputs: live?.outputs ?? data.snapshot?.outputs,
    };
  }

  /** Vue Flow `is-valid-connection` — types only; full ports displace on commit. */
  function checkConnection(conn: Connection): boolean {
    return checkConnectionTypes(conn);
  }

  function checkConnectionTypes(conn: Connection): boolean {
    const s = nodeType(conn.source);
    const t = nodeType(conn.target);
    if (!s || !t) return false;
    // linked sub-workflow frames accept/emit text: wiring resolves to their
    // entry/exit nodes at run time
    if (isLinkedFrame(conn.source) || isLinkedFrame(conn.target)) return true;
    if (!isValidPair(s, t)) return false;
    // Data coerces whatever arrives to its valueType at run — any text-lane
    // writer (custom/json, agents, prompts, …) may feed it.
    if (t === "data") return true;
    // Typed ports: a declared output must fit a declared input
    if (
      !valueTypeCompatible(
        emittedType(conn.source, conn.sourceHandle),
        expectedType(conn.target, conn.targetHandle),
      )
    ) {
      return false;
    }
    return true;
  }

  return {
    isLinkedFrame,
    emittedType,
    expectedType,
    customPortsFor,
    checkConnection,
    checkConnectionTypes,
  };
}
