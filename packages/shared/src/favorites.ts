import { z } from "zod";

/** Bookmarked jump targets (not Library payloads). */
export type FavoriteKind =
  | "workflow"
  | "session"
  | "payload"
  | "skill"
  | "rules"
  | "file";

export interface FavoriteEntryBase {
  id: string;
  createdAt: number;
  /** Cached display title for missing/offline rows. */
  label?: string;
}

export type FavoriteEntry =
  | (FavoriteEntryBase & { kind: "workflow"; graphId: string })
  | (FavoriteEntryBase & {
      kind: "session";
      provider: string;
      sessionId: string;
    })
  | (FavoriteEntryBase & { kind: "payload"; hash: string; provider?: string })
  | (FavoriteEntryBase & { kind: "skill"; path: string; provider?: string })
  | (FavoriteEntryBase & { kind: "rules"; path: string; provider?: string })
  | (FavoriteEntryBase & { kind: "file"; path: string; provider?: string });

export interface FavoritesIndex {
  schemaVersion: 1;
  items: FavoriteEntry[];
}

export const favoriteKindSchema = z.enum([
  "workflow",
  "session",
  "payload",
  "skill",
  "rules",
  "file",
]);

const favoriteBase = {
  id: z.string().min(1).max(64),
  createdAt: z.number(),
  label: z.string().max(240).optional(),
};

export const favoriteEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    ...favoriteBase,
    kind: z.literal("workflow"),
    graphId: z.string().min(1).max(128),
  }),
  z.object({
    ...favoriteBase,
    kind: z.literal("session"),
    provider: z.string().min(1).max(64),
    sessionId: z.string().min(1).max(256),
  }),
  z.object({
    ...favoriteBase,
    kind: z.literal("payload"),
    hash: z.string().min(1).max(128),
    provider: z.string().min(1).max(64).optional(),
  }),
  z.object({
    ...favoriteBase,
    kind: z.literal("skill"),
    path: z.string().min(1).max(2048),
    provider: z.string().min(1).max(64).optional(),
  }),
  z.object({
    ...favoriteBase,
    kind: z.literal("rules"),
    path: z.string().min(1).max(2048),
    provider: z.string().min(1).max(64).optional(),
  }),
  z.object({
    ...favoriteBase,
    kind: z.literal("file"),
    path: z.string().min(1).max(2048),
    provider: z.string().min(1).max(64).optional(),
  }),
]);

export const favoritesIndexSchema = z.object({
  schemaVersion: z.literal(1),
  items: z.array(favoriteEntrySchema),
});

/** Body for POST /api/favorites — identity fields without id/createdAt. */
export const favoriteCreateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("workflow"),
    graphId: z.string().min(1).max(128),
    label: z.string().max(240).optional(),
  }),
  z.object({
    kind: z.literal("session"),
    provider: z.string().min(1).max(64),
    sessionId: z.string().min(1).max(256),
    label: z.string().max(240).optional(),
  }),
  z.object({
    kind: z.literal("payload"),
    hash: z.string().min(1).max(128),
    label: z.string().max(240).optional(),
    provider: z.string().min(1).max(64).optional(),
  }),
  z.object({
    kind: z.literal("skill"),
    path: z.string().min(1).max(2048),
    label: z.string().max(240).optional(),
    provider: z.string().min(1).max(64).optional(),
  }),
  z.object({
    kind: z.literal("rules"),
    path: z.string().min(1).max(2048),
    label: z.string().max(240).optional(),
    provider: z.string().min(1).max(64).optional(),
  }),
  z.object({
    kind: z.literal("file"),
    path: z.string().min(1).max(2048),
    label: z.string().max(240).optional(),
    provider: z.string().min(1).max(64).optional(),
  }),
]);

export type FavoriteCreate = z.infer<typeof favoriteCreateSchema>;

export function emptyFavoritesIndex(): FavoritesIndex {
  return { schemaVersion: 1, items: [] };
}

/** Stable dedupe key for a favorite identity. */
export function favoriteMatchKey(
  entry: Pick<FavoriteEntry, "kind"> &
    Partial<
      Pick<
        Extract<FavoriteEntry, { kind: "session" }>,
        "provider" | "sessionId"
      > &
        Pick<Extract<FavoriteEntry, { kind: "workflow" }>, "graphId"> &
        Pick<Extract<FavoriteEntry, { kind: "payload" }>, "hash"> &
        Pick<Extract<FavoriteEntry, { kind: "skill" }>, "path">
    >,
): string {
  switch (entry.kind) {
    case "workflow":
      return `workflow:${entry.graphId ?? ""}`;
    case "session":
      return `session:${entry.provider ?? ""}:${entry.sessionId ?? ""}`;
    case "payload":
      return `payload:${entry.hash ?? ""}`;
    case "skill":
    case "rules":
    case "file":
      return `${entry.kind}:${entry.path ?? ""}`;
    default:
      return entry.kind;
  }
}

export const FAVORITE_KIND_LABEL: Record<FavoriteKind, string> = {
  workflow: "Workflows",
  session: "Sessions",
  payload: "Library",
  skill: "Skills",
  rules: "Rules",
  file: "Files",
};
