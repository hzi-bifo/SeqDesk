import fs from "fs/promises";
import { constants as fsConstants } from "fs";
import path from "path";
import { db } from "@/lib/db";

/**
 * Where Explore keeps datasets and how long run outputs are kept, as an admin
 * sets them in Settings › Report analysis. The environment still wins
 * (SEQDESK_EXPLORE_DIR, SEQDESK_EXPLORE_PRUNE_AFTER_DAYS) so existing
 * installs keep their values; the page shows which source is in effect.
 */
export interface ExploreStorageSettings {
  /** Absolute dataset root; empty means <data path>/explore. */
  exploreDir: string;
  /** Days after which unused run outputs may be pruned (1–3650). */
  pruneAfterDays: number;
}

export const DEFAULT_EXPLORE_STORAGE_SETTINGS: ExploreStorageSettings = { exploreDir: "", pruneAfterDays: 30 };
const UNSAFE_PATH = /[\x00-\x1f\x7f"'`$\\]/;

export class StorageSettingsError extends Error {}

export function normalizeStorageSettings(raw: unknown): ExploreStorageSettings {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const dir = typeof source.exploreDir === "string" ? source.exploreDir.trim() : "";
  const days = typeof source.pruneAfterDays === "number" && Number.isFinite(source.pruneAfterDays) ? Math.floor(source.pruneAfterDays) : DEFAULT_EXPLORE_STORAGE_SETTINGS.pruneAfterDays;
  return { exploreDir: dir, pruneAfterDays: Math.min(Math.max(days, 1), 3650) };
}

/** Throws a readable error when the values cannot be used; creates the folder when it is missing. */
export async function validateStorageSettings(raw: unknown): Promise<ExploreStorageSettings> {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (source.pruneAfterDays !== undefined && (typeof source.pruneAfterDays !== "number" || !Number.isInteger(source.pruneAfterDays) || source.pruneAfterDays < 1 || source.pruneAfterDays > 3650)) {
    throw new StorageSettingsError("Keep run outputs for a whole number of days between 1 and 3650.");
  }
  const settings = normalizeStorageSettings(raw);
  if (settings.exploreDir) {
    if (!path.isAbsolute(settings.exploreDir) || settings.exploreDir === "/") throw new StorageSettingsError("The Explore folder must be an absolute path below the root.");
    if (UNSAFE_PATH.test(settings.exploreDir)) throw new StorageSettingsError("The Explore folder may not contain quotes, backslashes, $ or control characters.");
    try {
      await fs.mkdir(settings.exploreDir, { recursive: true });
      await fs.access(settings.exploreDir, fsConstants.W_OK);
    } catch (error) {
      throw new StorageSettingsError(`SeqDesk cannot create or write ${settings.exploreDir}: ${error instanceof Error ? error.message : String(error)}`);
    }
    settings.exploreDir = path.resolve(settings.exploreDir);
  }
  return settings;
}

async function readExtra(): Promise<Record<string, unknown>> {
  const stored = await db.siteSettings.findUnique({ where: { id: "singleton" }, select: { extraSettings: true } });
  if (!stored?.extraSettings) return {};
  try {
    return JSON.parse(stored.extraSettings) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function getStoredStorageSettings(): Promise<ExploreStorageSettings> {
  return normalizeStorageSettings((await readExtra()).exploreStorage);
}

export async function saveStorageSettings(raw: unknown): Promise<ExploreStorageSettings> {
  const settings = await validateStorageSettings(raw);
  const extra = await readExtra();
  extra.exploreStorage = settings;
  await db.siteSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", extraSettings: JSON.stringify(extra) },
    update: { extraSettings: JSON.stringify(extra) },
  });
  return settings;
}

/** The values in effect and where each comes from. */
export async function effectiveStorageSettings(): Promise<{ exploreDir: string | null; exploreDirSource: "env" | "settings" | "data-path"; pruneAfterDays: number; pruneAfterDaysSource: "env" | "settings" | "default" }> {
  const stored = await getStoredStorageSettings().catch(() => DEFAULT_EXPLORE_STORAGE_SETTINGS);
  const envDir = process.env.SEQDESK_EXPLORE_DIR?.trim();
  const envDays = Number(process.env.SEQDESK_EXPLORE_PRUNE_AFTER_DAYS);
  const hasEnvDays = Number.isFinite(envDays) && envDays >= 1;
  return {
    exploreDir: envDir ? path.resolve(envDir) : stored.exploreDir || null,
    exploreDirSource: envDir ? "env" : stored.exploreDir ? "settings" : "data-path",
    pruneAfterDays: hasEnvDays ? Math.floor(envDays) : stored.pruneAfterDays,
    pruneAfterDaysSource: hasEnvDays ? "env" : stored.pruneAfterDays !== DEFAULT_EXPLORE_STORAGE_SETTINGS.pruneAfterDays ? "settings" : "default",
  };
}
