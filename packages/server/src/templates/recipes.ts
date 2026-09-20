import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePortableGraphImport, type PortableGraph } from "@threadle/shared";

export interface RecipeNeeds {
  model: boolean;
  dir: boolean;
  session: boolean;
}

export interface RecipeMeta {
  id: string;
  name: string;
  /** What you get when it finishes. */
  outcome: string;
  needs: RecipeNeeds;
  agents: number | string;
  params: string[];
  note?: string;
  graph: PortableGraph;
}

interface CatalogEntry {
  id: string;
  file: string;
  outcome: string;
  needs: RecipeNeeds;
  agents: number | string;
  params: string[];
  note?: string;
}

interface CatalogFile {
  recipes: CatalogEntry[];
}

function candidateDirs(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(process.cwd(), "examples/recipes"),
    path.resolve(process.cwd(), "../../examples/recipes"),
    path.resolve(here, "../../../../examples/recipes"),
    path.resolve(here, "../../../../../examples/recipes"),
  ];
}

function findRecipesDir(): string | null {
  for (const dir of candidateDirs()) {
    if (fs.existsSync(path.join(dir, "catalog.json"))) return dir;
  }
  return null;
}

function loadAll(): RecipeMeta[] {
  const dir = findRecipesDir();
  if (!dir) return [];

  const raw = JSON.parse(fs.readFileSync(path.join(dir, "catalog.json"), "utf8")) as CatalogFile;
  const out: RecipeMeta[] = [];

  for (const entry of raw.recipes ?? []) {
    const filePath = path.join(dir, entry.file);
    if (!fs.existsSync(filePath)) continue;
    const graphRaw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const parsed = validatePortableGraphImport(graphRaw);
    if (!parsed.ok) {
      console.warn(`[recipes] skip ${entry.id}: ${parsed.error}`);
      continue;
    }
    out.push({
      id: entry.id,
      name: parsed.data.name,
      outcome: entry.outcome,
      needs: entry.needs,
      agents: entry.agents,
      params: entry.params ?? [],
      note: entry.note,
      graph: parsed.data,
    });
  }

  return out;
}

let cached: RecipeMeta[] | null = null;

/** Bundled job recipes from examples/recipes/ (empty if the catalog is missing). */
export function listRecipes(): RecipeMeta[] {
  if (!cached) cached = loadAll();
  return cached;
}

export function getRecipe(id: string): RecipeMeta | undefined {
  return listRecipes().find((r) => r.id === id);
}

/** Invalidate cache (tests). */
export function resetRecipeCache(): void {
  cached = null;
}
