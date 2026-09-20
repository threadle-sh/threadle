import { Hono } from "hono";
import type { NormalizedMessage, SessionRef, TouchedFile } from "@threadle/shared";
import { isAbsolutePath } from "@threadle/shared";
import { registry } from "../providers/registry.js";
import { renderTranscript } from "../context/extract.js";

const RENDER_CFG = {
  kind: "transcript-excerpt" as const,
  roles: ["user", "assistant"] as Array<"user" | "assistant">,
  includeThinking: true,
  includeToolCalls: "full" as const,
};

export interface SessionDump {
  meta?: SessionRef;
  contextMarkdown: string;
  reasoning: Array<{ ts?: number; text: string }>;
  files: TouchedFile[];
}

export async function dumpSession(
  providerId: string,
  sid: string,
): Promise<SessionDump> {
  const p = registry.get(providerId);
  const [ref, messages, files] = await Promise.all([
    p.getSession(sid).catch(() => undefined),
    p.getTranscript(sid).catch(() => [] as NormalizedMessage[]),
    p.getTouchedFiles(sid).catch(() => [] as TouchedFile[]),
  ]);
  const reasoning: Array<{ ts?: number; text: string }> = [];
  for (const m of messages) {
    for (const part of m.parts) {
      if (part.type === "thinking" && part.text) {
        reasoning.push({ ts: m.timestamp, text: part.text });
      }
    }
  }
  return { meta: ref, contextMarkdown: renderTranscript(messages, RENDER_CFG), reasoning, files };
}

async function fetchBlueprint(origin: string, providerId: string, sid: string) {
  try {
    const res = await fetch(
      `${origin}/api/sessions/${providerId}/blueprint/${sid}`,
    );
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

export async function buildSessionBundle(
  origin: string,
  providerId: string,
  sid: string,
) {
  const p = registry.get(providerId);
  const children = await p.listChildren(sid).catch(() => [] as SessionRef[]);
  return {
    $schema: "threadle/session-bundle@1",
    exportedAt: new Date().toISOString(),
    provider: providerId,
    sessionId: sid,
    blueprint: await fetchBlueprint(origin, providerId, sid),
    session: await dumpSession(providerId, sid),
    subagents: Object.fromEntries(
      await Promise.all(
        children.map(async (child) => [
          child.id,
          await dumpSession(providerId, child.id),
        ]),
      ),
    ),
  };
}

export const bundleRoutes = new Hono();

/** Everything every session of one project produced, as one JSON bundle. */
bundleRoutes.get("/project", async (c) => {
  const dir = c.req.query("dir");
  if (!dir || !isAbsolutePath(dir)) {
    return c.json({ error: "absolute ?dir= required" }, 400);
  }
  const origin = new URL(c.req.url).origin;

  const sessions: SessionRef[] = [];
  for (const p of registry.providers.values()) {
    try {
      if (!(await p.available())) continue;
      sessions.push(...(await p.listSessions({ projectDir: dir })));
    } catch {
      // provider offline
    }
  }

  const bundles = await Promise.all(
    sessions.map((s) => buildSessionBundle(origin, s.provider, s.id)),
  );

  const name = dir.split("/").filter(Boolean).pop() ?? "project";
  c.header("Content-Type", "application/json; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="threadle-project-${name.replace(/[^\w.-]/g, "_")}.json"`,
  );
  return c.body(
    JSON.stringify(
      {
        $schema: "threadle/project-bundle@1",
        exportedAt: new Date().toISOString(),
        projectDir: dir,
        sessionCount: sessions.length,
        sessions: bundles,
      },
      null,
      2,
    ),
  );
});
