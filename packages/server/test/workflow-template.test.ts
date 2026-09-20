import { describe, expect, it } from "vitest";
import { portableGraphSchema } from "@threadle/shared";
import {
  PLAN_IMPLEMENT_REVIEW,
  WORKFLOW_TEMPLATES,
  getWorkflowTemplate,
} from "../src/templates/workflows.js";

describe("workflow examples / templates", () => {
  it("every template is valid portable graph JSON", () => {
    for (const t of WORKFLOW_TEMPLATES) {
      const parsed = portableGraphSchema.safeParse(t.graph);
      expect(parsed.success, `${t.id}: ${JSON.stringify(parsed.error?.issues?.[0])}`).toBe(
        true,
      );
    }
  });

  it("covers beginner → expert and is loadable by id", () => {
    const levels = new Set(WORKFLOW_TEMPLATES.map((t) => t.level));
    expect(levels.has("beginner")).toBe(true);
    expect(levels.has("intermediate")).toBe(true);
    expect(levels.has("advanced")).toBe(true);
    expect(levels.has("expert")).toBe(true);
    expect(WORKFLOW_TEMPLATES.length).toBeGreaterThanOrEqual(16);
    expect(WORKFLOW_TEMPLATES[0]?.id).toBe("hello-wire");
    expect(getWorkflowTemplate("hello-wire")?.graph.name).toContain("Hello");
    expect(getWorkflowTemplate("plan-implement-review")?.graph.name).toBe("Starter workflow");
  });

  it("starter declares task param and plan→implement→review spine", () => {
    expect(PLAN_IMPLEMENT_REVIEW.params?.[0]?.name).toBe("task");
    const types = PLAN_IMPLEMENT_REVIEW.nodes.map((n) => n.data.type);
    expect(types).toContain("agent-def");
    expect(types).toContain("approval");
    expect(types).toContain("output");
    const agents = PLAN_IMPLEMENT_REVIEW.nodes
      .filter((n) => n.data.type === "agent-def")
      .map((n) => (n.data.type === "agent-def" ? n.data.ref.name : ""));
    expect(agents).toEqual(expect.arrayContaining(["plan", "agent", "ask"]));
  });

  it("merge, circuit breaker, and judge examples exist", () => {
    const knot = getWorkflowTemplate("knot-concat");
    expect(knot?.teaches).toContain("merge");
    expect(knot?.graph.nodes.some((n) => n.data.type === "knot")).toBe(true);
    const tw = getWorkflowTemplate("content-tripwire");
    expect(tw?.teaches).toContain("circuit-breaker");
    expect(tw?.graph.nodes.some((n) => n.data.type === "tripwire")).toBe(true);
    const judge = getWorkflowTemplate("judge-branch");
    expect(judge?.teaches).toContain("judge");
    expect(judge?.graph.nodes.some((n) => n.data.type === "judge")).toBe(true);
    expect(
      judge?.graph.edges.some((e) => e.sourceHandle === "out:pass"),
    ).toBe(true);
    const until = getWorkflowTemplate("until-reenter");
    expect(until?.teaches).toContain("until");
    expect(until?.graph.nodes.some((n) => n.data.type === "until")).toBe(true);
    expect(
      until?.graph.edges.some((e) => e.sourceHandle === "out:reenter"),
    ).toBe(true);
    const waitIdle = getWorkflowTemplate("wait-idle-gate");
    expect(waitIdle?.teaches).toContain("wait-idle");
    expect(waitIdle?.graph.nodes.some((n) => n.data.type === "wait-idle")).toBe(true);
    const iterPar = getWorkflowTemplate("iterator-parallel");
    expect(iterPar?.teaches).toContain("parallel");
    expect(
      iterPar?.graph.nodes.some(
        (n) => n.data.type === "iterator" && n.data.mode === "parallel",
      ),
    ).toBe(true);
    expect(iterPar?.graph.nodes.some((n) => n.data.type === "knot")).toBe(true);
    const errFb = getWorkflowTemplate("agent-err-fallback");
    expect(errFb?.teaches).toContain("err-port");
    expect(
      errFb?.graph.edges.some((e) => e.sourceHandle === "out:err"),
    ).toBe(true);
  });
});
