import fs from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";
import {
  MixsChecklist,
  MixsConfig,
  MixsSnapshots,
  MIXS_SETTINGS_KEY,
  MIXS_SNAPSHOTS_KEY,
  MIXS_SNAPSHOT_LIMIT,
} from "@/types/mixs-checklist";

// Dedicated env override so it does not collide with SEQDESK_API_URL (which the
// sequencing-tech registry already repurposes as a full endpoint URL).
const DEFAULT_REMOTE_MIXS_SYNC_URL =
  process.env.SEQDESK_MIXS_SYNC_URL ||
  "https://www.seqdesk.com/api/registry/mixs";

const MIXS_DIR = path.join(process.cwd(), "data", "field-templates", "mixs-full");
const INDEX_PATH = path.join(MIXS_DIR, "_index.json");

export function getDefaultMixsSyncUrl(): string {
  return DEFAULT_REMOTE_MIXS_SYNC_URL;
}

// ---------------------------------------------------------------------------
// Baseline (committed JSON files) — the offline fallback / first-boot source.
// ---------------------------------------------------------------------------

let baselineCache: MixsConfig | null = null;

function readBaselineVersion(): number {
  try {
    const raw = fs.readFileSync(INDEX_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    const v = parseInt(String(parsed.version ?? 0), 10);
    return Number.isFinite(v) && v > 0 ? v : 1;
  } catch {
    return 1;
  }
}

/** Load every committed checklist file. Excludes files starting with "_". */
export function loadBaselineChecklists(): MixsChecklist[] {
  if (!fs.existsSync(MIXS_DIR)) {
    console.warn("MIxS templates directory not found:", MIXS_DIR);
    return [];
  }

  const files = fs
    .readdirSync(MIXS_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"));

  const checklists: MixsChecklist[] = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(MIXS_DIR, file), "utf-8");
      const checklist = JSON.parse(content) as MixsChecklist;
      checklists.push({ available: true, ...checklist });
    } catch (error) {
      console.error(`Error loading MIxS checklist ${file}:`, error);
    }
  }
  return checklists;
}

/**
 * Legacy flat MIxS field-group templates that live directly under
 * data/field-templates (e.g. "MIxS Core", "MIxS Sequencing"). These are NOT
 * part of the versioned environment-package registry, but the order wizard and
 * form builder still reference them by name, so the templates endpoint keeps
 * serving them alongside the registry checklists.
 */
export function loadLegacyMixsTemplates(): MixsChecklist[] {
  const dir = path.join(process.cwd(), "data", "field-templates");
  if (!fs.existsSync(dir)) return [];

  const templates: MixsChecklist[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".json") || entry.name.startsWith("_")) continue;
    try {
      const content = fs.readFileSync(path.join(dir, entry.name), "utf-8");
      const parsed = JSON.parse(content) as MixsChecklist;
      if (parsed.category === "mixs") {
        templates.push({ available: true, ...parsed });
      }
    } catch (error) {
      console.error(`Error loading legacy MIxS template ${entry.name}:`, error);
    }
  }
  return templates;
}

/** Build the baseline config from the committed files. */
export function loadBaselineConfig(): MixsConfig {
  if (baselineCache) return baselineCache;
  baselineCache = {
    version: readBaselineVersion(),
    checklists: loadBaselineChecklists(),
    deprecated: [],
    syncUrl: DEFAULT_REMOTE_MIXS_SYNC_URL,
  };
  return baselineCache;
}

// ---------------------------------------------------------------------------
// Normalization / parsing.
// ---------------------------------------------------------------------------

export function normalizeMixsConfig(
  raw: Partial<MixsConfig> | null | undefined,
  defaults: MixsConfig = loadBaselineConfig()
): MixsConfig {
  if (!raw || typeof raw !== "object") {
    return { ...defaults };
  }
  return {
    ...defaults,
    ...raw,
    version: parseInt(String(raw.version ?? defaults.version ?? 0), 10) || defaults.version || 1,
    checklists: Array.isArray(raw.checklists) ? raw.checklists : defaults.checklists,
    deprecated: Array.isArray(raw.deprecated) ? raw.deprecated : [],
    syncUrl: typeof raw.syncUrl === "string" && raw.syncUrl.trim()
      ? raw.syncUrl
      : defaults.syncUrl ?? DEFAULT_REMOTE_MIXS_SYNC_URL,
  };
}

export function parseMixsConfig(configJson: unknown): MixsConfig {
  const defaults = loadBaselineConfig();
  if (!configJson) return defaults;
  try {
    const parsed =
      typeof configJson === "string" ? JSON.parse(configJson) : configJson;
    return normalizeMixsConfig(parsed as Partial<MixsConfig>, defaults);
  } catch {
    return defaults;
  }
}

export function normalizeSyncUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function resolveSyncUrl(
  config?: MixsConfig | null,
  override?: unknown
): string {
  return (
    normalizeSyncUrl(override) ||
    normalizeSyncUrl(config?.syncUrl) ||
    DEFAULT_REMOTE_MIXS_SYNC_URL
  );
}

// ---------------------------------------------------------------------------
// extraSettings read/write helpers (SiteSettings singleton row).
// ---------------------------------------------------------------------------

type DbLike = Pick<PrismaClient, "siteSettings">;

async function readExtraSettings(db: DbLike): Promise<Record<string, string>> {
  const settings = await db.siteSettings.findUnique({ where: { id: "singleton" } });
  const raw = settings?.extraSettings as string | null | undefined;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeExtraSettings(
  db: DbLike,
  extraSettings: Record<string, string>
): Promise<void> {
  const serialized = JSON.stringify(extraSettings);
  await db.siteSettings.upsert({
    where: { id: "singleton" },
    update: { extraSettings: serialized },
    create: { id: "singleton", extraSettings: serialized },
  });
}

/**
 * Read the active MIxS config from the DB, falling back to the committed
 * baseline when nothing has been synced yet.
 */
export async function getActiveMixsConfig(db: DbLike): Promise<MixsConfig> {
  const extra = await readExtraSettings(db);
  const stored = extra[MIXS_SETTINGS_KEY] ?? null;
  if (!stored) return loadBaselineConfig();
  return parseMixsConfig(stored);
}

/** Persist the active MIxS config. */
export async function saveActiveMixsConfig(
  db: DbLike,
  config: MixsConfig
): Promise<void> {
  const extra = await readExtraSettings(db);
  extra[MIXS_SETTINGS_KEY] = JSON.stringify(config);
  await writeExtraSettings(db, extra);
}

// ---------------------------------------------------------------------------
// Version snapshots — stored under a separate key so the active read path
// never pulls historical field definitions.
// ---------------------------------------------------------------------------

async function readSnapshots(db: DbLike): Promise<MixsSnapshots> {
  const extra = await readExtraSettings(db);
  const stored = extra[MIXS_SNAPSHOTS_KEY] ?? null;
  if (!stored) return {};
  try {
    return JSON.parse(stored) as MixsSnapshots;
  } catch {
    return {};
  }
}

/**
 * Snapshot the given config's checklists under its version, keeping only the
 * most recent MIXS_SNAPSHOT_LIMIT versions. Call this with the OUTGOING config
 * just before applying an update, so older studies can still resolve their
 * pinned definitions.
 */
export async function snapshotMixsConfig(
  db: DbLike,
  config: MixsConfig
): Promise<void> {
  if (!config?.version) return;
  const extra = await readExtraSettings(db);
  let snapshots: MixsSnapshots = {};
  try {
    snapshots = extra[MIXS_SNAPSHOTS_KEY]
      ? (JSON.parse(extra[MIXS_SNAPSHOTS_KEY]) as MixsSnapshots)
      : {};
  } catch {
    snapshots = {};
  }

  snapshots[String(config.version)] = [
    ...config.checklists,
    ...(config.deprecated ?? []),
  ];

  // Retain only the newest N versions.
  const versions = Object.keys(snapshots)
    .map((v) => parseInt(v, 10))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => b - a);
  const keep = new Set(versions.slice(0, MIXS_SNAPSHOT_LIMIT).map(String));
  for (const key of Object.keys(snapshots)) {
    if (!keep.has(key)) delete snapshots[key];
  }

  extra[MIXS_SNAPSHOTS_KEY] = JSON.stringify(snapshots);
  await writeExtraSettings(db, extra);
}

function findChecklist(
  checklists: MixsChecklist[],
  { accession, name }: { accession?: string | null; name?: string | null }
): MixsChecklist | undefined {
  if (accession) {
    const byAccession = checklists.find((c) => c.accession === accession);
    if (byAccession) return byAccession;
  }
  if (name) {
    const term = name.toLowerCase();
    return checklists.find((c) => c.name.toLowerCase().includes(term));
  }
  return undefined;
}

/**
 * Resolve a checklist for a study, honoring its pinned version when supplied.
 * Resolution order:
 *   1. snapshot for the pinned version (exact historical definition)
 *   2. active checklists (current)
 *   3. deprecated checklists (removed upstream but retained)
 *   4. baseline files
 */
export async function getChecklistForStudy(
  db: DbLike,
  query: { accession?: string | null; name?: string | null; version?: number | null }
): Promise<MixsChecklist | undefined> {
  if (query.version) {
    const snapshots = await readSnapshots(db);
    const snapshot = snapshots[String(query.version)];
    if (snapshot) {
      const hit = findChecklist(snapshot, query);
      if (hit) return hit;
    }
  }

  const config = await getActiveMixsConfig(db);
  const active = findChecklist(config.checklists, query);
  if (active) return active;

  const deprecated = findChecklist(config.deprecated ?? [], query);
  if (deprecated) return deprecated;

  return findChecklist(loadBaselineChecklists(), query);
}
