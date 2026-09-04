import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";

export interface CurationEntry {
  name: string;
  note?: string;
  refs?: string[];
}

export interface CurationListRecord {
  listId: string;
  label: string;
  role: "pathogen" | "flora" | "artifact";
  site: string | null;
  tier: string | null;
  color: string | null;
  entries: CurationEntry[];
  version: number;
  updatedAt: string;
}

export interface CurationSeedFile {
  seedId: string;
  label: string;
  description?: string;
  lists: Array<Omit<CurationListRecord, "version" | "updatedAt"> & { help?: string }>;
}

export const CURATION_ROLES = ["pathogen", "flora", "artifact"] as const;

function parseEntries(raw: string): CurationEntry[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => (typeof entry === "string" ? { name: entry } : entry && typeof entry === "object" ? (entry as CurationEntry) : null))
      .filter((entry): entry is CurationEntry => Boolean(entry && typeof entry.name === "string" && entry.name.trim()))
      .map((entry) => ({ name: entry.name.trim(), note: entry.note, refs: entry.refs }));
  } catch {
    return [];
  }
}

export async function listCurationLists(targetKey: string): Promise<CurationListRecord[]> {
  const lists = await db.exploreCurationList.findMany({ where: { targetKey }, orderBy: { listId: "asc" } });
  return lists.map((list) => ({
    listId: list.listId,
    label: list.label,
    role: list.role as CurationListRecord["role"],
    site: list.site,
    tier: list.tier,
    color: list.color,
    entries: parseEntries(list.entries),
    version: list.version,
    updatedAt: list.updatedAt.toISOString(),
  }));
}

/** Plain name lists as the runner and the views consume them. */
export async function listCurationForViews(targetKey: string) {
  const lists = await listCurationLists(targetKey);
  return lists.map((list) => ({
    listId: list.listId,
    label: list.label,
    role: list.role,
    site: list.site,
    tier: list.tier,
    color: list.color,
    entries: list.entries.map((entry) => entry.name),
  }));
}

export interface UpsertCurationListInput {
  listId: string;
  label: string;
  role: CurationListRecord["role"];
  site?: string | null;
  tier?: string | null;
  color?: string | null;
  entries: CurationEntry[];
}

export function validateCurationList(input: UpsertCurationListInput): string | null {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.listId)) return "listId must be lowercase letters, digits, dashes or underscores";
  if (!input.label.trim()) return "label is required";
  if (!CURATION_ROLES.includes(input.role)) return "role must be pathogen, flora or artifact";
  if (input.color && !/^#[0-9a-fA-F]{6}$/.test(input.color)) return "color must be a hex value like #aa3322";
  if (input.entries.length > 5000) return "too many entries";
  return null;
}

/** Bumping the version invalidates every cached view of the scope. */
export async function upsertCurationList(targetKey: string, input: UpsertCurationListInput): Promise<void> {
  const problem = validateCurationList(input);
  if (problem) throw new Error(problem);
  const entries = JSON.stringify(input.entries.map((entry) => ({ name: entry.name.trim(), ...(entry.note ? { note: entry.note } : {}), ...(entry.refs?.length ? { refs: entry.refs } : {}) })));
  await db.exploreCurationList.upsert({
    where: { targetKey_listId: { targetKey, listId: input.listId } },
    update: { label: input.label.trim(), role: input.role, site: input.site ?? null, tier: input.tier ?? null, color: input.color ?? null, entries, version: { increment: 1 } },
    create: { targetKey, listId: input.listId, label: input.label.trim(), role: input.role, site: input.site ?? null, tier: input.tier ?? null, color: input.color ?? null, entries },
  });
}

export async function deleteCurationList(targetKey: string, listId: string): Promise<boolean> {
  const result = await db.exploreCurationList.deleteMany({ where: { targetKey, listId } });
  return result.count > 0;
}

export function getCurationSeedsDir(): string {
  return path.join(process.cwd(), "explore", "curation");
}

export async function listCurationSeeds(): Promise<Array<Pick<CurationSeedFile, "seedId" | "label" | "description"> & { listCount: number }>> {
  const dir = getCurationSeedsDir();
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(dir)).filter((entry) => entry.endsWith(".json"));
  } catch {
    return [];
  }
  const seeds = [];
  for (const entry of entries) {
    try {
      const seed = JSON.parse(await fs.readFile(path.join(dir, entry), "utf8")) as CurationSeedFile;
      if (seed.seedId && Array.isArray(seed.lists)) {
        seeds.push({ seedId: seed.seedId, label: seed.label, description: seed.description, listCount: seed.lists.length });
      }
    } catch {
      // skip unreadable seed files
    }
  }
  return seeds;
}

/** Copy a shipped seed into a scope. Existing lists with the same id are replaced. */
export async function applyCurationSeed(targetKey: string, seedId: string): Promise<number> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(seedId)) throw new Error("Invalid seed id");
  const file = path.join(getCurationSeedsDir(), `${seedId}.json`);
  const seed = JSON.parse(await fs.readFile(file, "utf8")) as CurationSeedFile;
  let count = 0;
  for (const list of seed.lists) {
    await upsertCurationList(targetKey, {
      listId: list.listId,
      label: list.label,
      role: list.role,
      site: list.site,
      tier: list.tier,
      color: list.color,
      entries: list.entries,
    });
    count += 1;
  }
  return count;
}
