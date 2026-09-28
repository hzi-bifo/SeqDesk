import { MatrixProfileAccumulator, PROFILE_VERSION, readProfile } from "@/lib/explore/table-profile";
import fs from "fs/promises";
import path from "path";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { computeCacheToken } from "./cache-token";
import { computeContentHash, parseJsonObject, parseRoles, parseSchema } from "./schema";
import { resolveExploreStorage, sanitizeSegment } from "./storage";
import { fileStorageOf, INDEX_EVERY, readRowsFromFile, shareIdenticalData } from "./table-store";
import { parseTargetKey } from "./target-key";
import type {
  ExploreCell,
  ExploreDatasetDetail,
  ExploreDatasetKind,
  ExploreDatasetSummary,
  ExploreProvenance,
  ExploreRoleMap,
  ExploreRowData,
  ExploreRowRecord,
  ExploreSchema,
  ExploreSensitivity,
} from "./types";

const ROW_BATCH_SIZE = 1000;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 2000;

type DatasetWithVersion = Prisma.ExploreDatasetGetPayload<{
  include: { versions: { orderBy: { number: "desc" }; take: 1 } };
}>;

function toIso(value: Date | null | undefined): string {
  return (value ?? new Date(0)).toISOString();
}

function currentVersionOf(dataset: DatasetWithVersion) {
  const current =
    dataset.versions.find((version) => version.id === dataset.currentVersionId) ??
    dataset.versions[0] ??
    null;
  return current;
}

function profileSummary(provenance: unknown) {
  const profile = readProfile(provenance);
  return profile ? { verdict: profile.verdict, sentence: profile.sentence, why: profile.why } : null;
}

export function serializeDatasetSummary(dataset: DatasetWithVersion): ExploreDatasetSummary {
  const current = currentVersionOf(dataset);
  return {
    id: dataset.id,
    targetKey: dataset.targetKey,
    kind: dataset.kind as ExploreDatasetKind,
    tableKind: dataset.tableKind,
    name: dataset.name,
    description: dataset.description,
    sensitivity: dataset.sensitivity as ExploreSensitivity,
    roles: parseRoles(dataset.roles),
    schema: parseSchema(current?.schema),
    currentVersion: current
      ? {
          id: current.id,
          number: current.number,
          rowCount: current.rowCount,
          contentHash: current.contentHash,
          createdAt: toIso(current.createdAt),
          profile: profileSummary(current.provenance),
          rows: fileStorageOf(current.provenance) ? "file" : "database",
        }
      : null,
    createdAt: toIso(dataset.createdAt),
    updatedAt: toIso(dataset.updatedAt),
  };
}

export async function listDatasets(targetKey: string, options: { lean?: boolean } = {}): Promise<ExploreDatasetSummary[]> {
  const all = await db.exploreDataset.findMany({
    where: { targetKey },
    include: { versions: { orderBy: { number: "desc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
  });
  // A table whose import is still running has a placeholder version (0 rows, hash "pending"): it is not listed until
  // the import has finished, so nobody picks an empty table into a recipe and a stopped import leaves nothing behind.
  const datasets = all.filter((dataset) => dataset.versions[0]?.contentHash !== "pending");
  // Tables made before the provenance check existed get it once, a few per listing.
  let budget = 5;
  for (const dataset of datasets) {
    const current = dataset.versions[0];
    if (!current || budget <= 0 || current.rowCount > PROFILE_MAX_ROWS || profileChecked(current.provenance)) continue;
    budget -= 1;
    current.provenance = await ensureVersionProfile(current.id) ?? current.provenance;
  }
  // Lean: the column count instead of every column (a 10,000-column table is a megabyte of schema).
  return datasets.map((dataset) => {
    const summary = serializeDatasetSummary(dataset);
    return options.lean ? { ...summary, columnCount: summary.schema?.columns.length ?? 0, schema: { columns: [] } } : summary;
  });
}

function profileChecked(provenance: string | null): boolean {
  const parsed = parseJsonObject(provenance);
  // Made with the current rules: a finding of this version, or "not a matrix" under this version.
  return Boolean(parsed && (readProfile(parsed) || parsed.profileChecked === PROFILE_VERSION));
}

const PROFILE_MAX_ROWS = 200_000;

/**
 * Profile a version's number columns if that has not been done yet and keep the finding in its provenance
 * (additive: the JSON gains `profile` or `profileChecked`). Returns the updated provenance JSON, or null.
 */
export async function ensureVersionProfile(versionId: string): Promise<string | null> {
  const version = await db.exploreDatasetVersion.findUnique({ where: { id: versionId }, select: { schema: true, provenance: true, rowCount: true } });
  if (!version) return null;
  if (profileChecked(version.provenance)) return version.provenance;
  const provenance = parseJsonObject(version.provenance) ?? {};
  const columns = parseSchema(version.schema).columns;
  let profile = null;
  if (columns.filter((column) => column.type === "number").length >= 2) {
    // One pass over pages of rows: memory is a page, not the table.
    const accumulator = new MatrixProfileAccumulator(columns.map((column) => column.key));
    let cursor: string | null = null;
    do {
      const page = await fetchDatasetRows(versionId, { cursor, limit: MAX_PAGE_SIZE });
      for (const row of page.rows) accumulator.add(row.data);
      cursor = page.nextCursor;
    } while (cursor);
    profile = accumulator.finish(columns);
  }
  const { profile: _old, profileChecked: _checked, ...rest } = provenance;
  const next = JSON.stringify(profile ? { ...rest, profile } : { ...rest, profileChecked: PROFILE_VERSION });
  await db.exploreDatasetVersion.update({ where: { id: versionId }, data: { provenance: next } });
  return next;
}

export async function getDatasetRecord(id: string) {
  return db.exploreDataset.findUnique({
    where: { id },
    include: { versions: { orderBy: { number: "desc" }, take: 1 } },
  });
}

export async function getDatasetDetail(id: string): Promise<ExploreDatasetDetail | null> {
  const dataset = await db.exploreDataset.findUnique({
    where: { id },
    include: {
      versions: { orderBy: { number: "desc" } },
      _count: { select: { edits: true } },
    },
  });
  if (!dataset) return null;
  const current =
    dataset.versions.find((version) => version.id === dataset.currentVersionId) ??
    dataset.versions[0] ??
    null;
  const summary = serializeDatasetSummary({
    ...dataset,
    versions: current ? [current] : [],
  });
  return {
    ...summary,
    schema: parseSchema(current?.schema),
    provenance: current ? (parseJsonObject(current.provenance) as unknown as ExploreProvenance | null) : null,
    sourceConfig: parseJsonObject(dataset.sourceConfig),
    versions: dataset.versions.map((version) => ({
      id: version.id,
      number: version.number,
      rowCount: version.rowCount,
      contentHash: version.contentHash,
      buildSource: version.buildSource,
      createdAt: toIso(version.createdAt),
    })),
    editCount: dataset._count.edits,
  };
}

export interface CreateDatasetInput {
  targetKey: string;
  kind: ExploreDatasetKind;
  tableKind?: string | null;
  name: string;
  description?: string | null;
  sensitivity?: ExploreSensitivity;
  roles?: ExploreRoleMap;
  sourceConfig?: Record<string, unknown> | null;
  sourceFileId?: string | null;
  createdById: string;
}

/**
 * A name no other imported table of the study has: "counts" when free, else "counts (2)", "counts (3)", ...
 * Two tables called the same are indistinguishable in every picker and list, so an import never makes one
 * (it keeps the earlier table as it is; the person can rename either).
 */
export async function freeImportName(targetKey: string, wanted: string): Promise<string> {
  const base = wanted.trim() || "Untitled dataset";
  const taken = new Set((await db.exploreDataset.findMany({ where: { targetKey, kind: "external" }, select: { name: true } })).map((row) => row.name.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base.slice(0, Math.max(1, 200 - String(n).length - 3))} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export async function createDataset(input: CreateDatasetInput) {
  return db.exploreDataset.create({
    data: {
      targetKey: input.targetKey,
      kind: input.kind,
      tableKind: input.tableKind ?? null,
      name: input.name.trim() || "Untitled dataset",
      description: input.description ?? null,
      sensitivity: input.sensitivity ?? "standard",
      roles: input.roles ? JSON.stringify(input.roles) : null,
      sourceConfig: input.sourceConfig ? JSON.stringify(input.sourceConfig) : null,
      sourceFileId: input.sourceFileId ?? null,
      createdById: input.createdById,
    },
  });
}

export async function updateDatasetRoles(id: string, roles: ExploreRoleMap) {
  return db.exploreDataset.update({
    where: { id },
    data: { roles: JSON.stringify(roles) },
  });
}

export interface WriteVersionInput {
  datasetId: string;
  schema: ExploreSchema;
  rows: ExploreRowData[];
  provenance: ExploreProvenance;
  buildSource: "auto" | "manual" | "import" | "analysis-run";
  storageSuffix?: string;
  createdById?: string | null;
  /** Column keys whose value identifies the sample / subject / secondary key of a row. */
  keys?: { sample?: string; subject?: string; key?: string };
}

export interface WriteVersionResult {
  versionId: string;
  number: number;
  rowCount: number;
  contentHash: string;
  unchanged: boolean;
}

function cellToKey(value: ExploreCell | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, 200) : null;
}

function tsvEscape(value: ExploreCell): string {
  if (value === null) return "";
  const text = typeof value === "string" ? value : String(value);
  return text.replace(/[\t\r\n]/g, " ");
}

/**
 * Persist a new immutable version of a dataset: rows into Postgres in batches,
 * a TSV plus schema copy on disk for kits and provenance, and the dataset's
 * current pointer moved forward. When the content hash equals the current
 * version nothing is written and the current version is returned.
 */
export async function writeDatasetVersion(input: WriteVersionInput, client: Prisma.TransactionClient = db): Promise<WriteVersionResult> {
  const dataset = await client.exploreDataset.findUnique({
    where: { id: input.datasetId },
    include: { versions: { orderBy: { number: "desc" }, take: 1 } },
  });
  if (!dataset) throw new Error("Dataset not found");

  const contentHash = computeContentHash(input.schema, input.rows);
  const latest = dataset.versions[0] ?? null;
  if (latest && latest.contentHash === contentHash && dataset.currentVersionId === latest.id) {
    return {
      versionId: latest.id,
      number: latest.number,
      rowCount: latest.rowCount,
      contentHash,
      unchanged: true,
    };
  }

  const number = (latest?.number ?? 0) + 1;
  const storage = await resolveExploreStorage();
  const versionDir = path.join(storage.datasetsRoot, sanitizeSegment(dataset.id), `v${number}${input.storageSuffix ? `-${sanitizeSegment(input.storageSuffix)}` : ""}`);
  await fs.mkdir(versionDir, { recursive: true });

  const columns = input.schema.columns.map((column) => column.key);
  // Written in chunks with a sparse line index, so pages of the file can be read without the database.
  const handle = await fs.open(path.join(versionDir, "data.tsv"), "w");
  const offsets: number[] = [];
  try {
    let offset = 0;
    let text = `${columns.join("\t")}\n`;
    for (let index = 0; index < input.rows.length; index += 1) {
      if (index % INDEX_EVERY === 0) {
        if (text) { await handle.write(text); offset += Buffer.byteLength(text); text = ""; }
        offsets.push(offset);
      }
      const row = input.rows[index];
      text += `${columns.map((key) => tsvEscape(row[key] ?? null)).join("\t")}\n`;
      if (text.length > 1 << 20) { await handle.write(text); offset += Buffer.byteLength(text); text = ""; }
    }
    if (text) await handle.write(text);
  } finally {
    await handle.close();
  }
  await fs.writeFile(path.join(versionDir, "rows.idx.json"), JSON.stringify({ every: INDEX_EVERY, offsets, rows: input.rows.length }), "utf8");
  await fs.writeFile(
    path.join(versionDir, "schema.json"),
    JSON.stringify({ schema: input.schema, provenance: input.provenance, contentHash }, null, 2),
    "utf8"
  );

  const version = await client.exploreDatasetVersion.create({
    data: {
      datasetId: dataset.id,
      number,
      contentHash,
      schema: JSON.stringify(input.schema),
      rowCount: input.rows.length,
      provenance: JSON.stringify(input.provenance),
      storagePath: versionDir,
      buildSource: input.buildSource,
      createdById: input.createdById ?? null,
    },
  });

  const sampleKey = input.keys?.sample;
  const subjectKey = input.keys?.subject;
  const secondaryKey = input.keys?.key;
  // Wide tables insert fewer rows per statement (at most ~200,000 cells each).
  const batchSize = Math.max(1, Math.min(ROW_BATCH_SIZE, Math.floor(200_000 / Math.max(1, columns.length))));
  for (let start = 0; start < input.rows.length; start += batchSize) {
    const batch = input.rows.slice(start, start + batchSize).map((row, offset) => ({
      versionId: version.id,
      rowIndex: start + offset,
      sampleId: sampleKey ? cellToKey(row[sampleKey]) : null,
      subjectId: subjectKey ? cellToKey(row[subjectKey]) : null,
      key: secondaryKey ? cellToKey(row[secondaryKey]) : null,
      data: row as Prisma.InputJsonValue,
    }));
    await client.exploreDatasetRow.createMany({ data: batch });
  }

  await client.exploreDataset.update({
    where: { id: dataset.id },
    data: { currentVersionId: version.id },
  });
  // Same content as another stored version (a copy, a re-import): share its file instead of keeping two.
  await shareIdenticalData(path.join(versionDir, "data.tsv"), contentHash, version.id).catch(() => false);

  return { versionId: version.id, number, rowCount: input.rows.length, contentHash, unchanged: false };
}

export interface FetchRowsOptions {
  cursor?: string | null;
  limit?: number;
  sampleId?: string | null;
  subjectId?: string | null;
  key?: string | null;
}

/**
 * Cursor pagination over one version, ordered by rowIndex. The cursor is the
 * last rowIndex returned, so a page is stable even while another version is
 * being written.
 */
export async function fetchDatasetRows(
  versionId: string,
  options: FetchRowsOptions = {}
): Promise<{ rows: ExploreRowRecord[]; nextCursor: string | null; total: number }> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const cursorIndex = options.cursor ? Number.parseInt(options.cursor, 10) : null;
  const version = await versionStorage(versionId);
  const filtered = Boolean(options.sampleId || options.subjectId || options.key);
  if (version?.file) {
    // File-backed: a seek to the page; key filters scan the file (bounded) since there are no row indexes.
    const start = cursorIndex !== null && Number.isFinite(cursorIndex) ? cursorIndex + 1 : 0;
    const test = (value: ExploreCell | undefined, wanted: string | null | undefined) => !wanted || cellToKey(value) === wanted;
    const keys = version.keys;
    const filter = filtered ? (row: ExploreRowData) => test(keys.sample ? row[keys.sample] : null, options.sampleId) && test(keys.subject ? row[keys.subject] : null, options.subjectId) && test(keys.key ? row[keys.key] : null, options.key) : undefined;
    const page = await readRowsFromFile(version.storagePath, version.columns, { start, limit: limit + 1, filter, scanLimit: filtered ? FILE_FILTER_SCAN_ROWS : undefined });
    const rows = page.rows.slice(0, limit);
    const more = page.rows.length > limit || (!page.end && filtered && page.lastIndex !== null);
    const next = page.rows.length > limit ? rows[rows.length - 1].rowIndex : more ? page.lastIndex : null;
    return { rows, nextCursor: next === null ? null : String(next), total: filtered ? rows.length : version.rowCount };
  }
  const where: Prisma.ExploreDatasetRowWhereInput = {
    versionId,
    ...(options.sampleId ? { sampleId: options.sampleId } : {}),
    ...(options.subjectId ? { subjectId: options.subjectId } : {}),
    ...(options.key ? { key: options.key } : {}),
  };
  const [total, rows] = await Promise.all([
    // Unfiltered, the version knows its row count; counting a million rows per page is wasted work.
    !filtered && version ? Promise.resolve(version.rowCount) : db.exploreDatasetRow.count({ where }),
    db.exploreDatasetRow.findMany({
      where: {
        ...where,
        ...(cursorIndex !== null && Number.isFinite(cursorIndex) ? { rowIndex: { gt: cursorIndex } } : {}),
      },
      orderBy: { rowIndex: "asc" },
      take: limit + 1,
    }),
  ]);
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? String(page[page.length - 1].rowIndex) : null;
  return {
    rows: page.map((row) => ({
      rowIndex: row.rowIndex,
      sampleId: row.sampleId,
      subjectId: row.subjectId,
      key: row.key,
      data: (row.data ?? {}) as ExploreRowData,
    })),
    nextCursor,
    total,
  };
}

const FILE_FILTER_SCAN_ROWS = 2_000_000;
type VersionStorage = { rowCount: number; file: boolean; storagePath: string; columns: string[]; keys: { sample?: string; subject?: string; key?: string } };
/** Versions never change, so where their rows live is cached per process. */
const versionStorageCache = new Map<string, VersionStorage>();

async function versionStorage(versionId: string): Promise<VersionStorage | null> {
  const cached = versionStorageCache.get(versionId);
  if (cached) return cached;
  const version = await db.exploreDatasetVersion.findUnique({ where: { id: versionId }, select: { rowCount: true, provenance: true, storagePath: true, schema: true, contentHash: true, dataset: { select: { roles: true } } } });
  if (!version || version.contentHash === "pending") return null;
  const file = Boolean(fileStorageOf(version.provenance) && version.storagePath);
  const roles = parseRoles(version.dataset.roles);
  const entry: VersionStorage = { rowCount: version.rowCount, file, storagePath: version.storagePath ?? "", columns: file ? parseSchema(version.schema).columns.map((column) => column.key) : [],
    keys: { sample: roles.sample, subject: roles.subject, key: roles.taxon_id ?? roles.taxon } };
  if (versionStorageCache.size > 500) versionStorageCache.clear();
  versionStorageCache.set(versionId, entry);
  return entry;
}

/** True when a version keeps its rows only in its file (too large for the database). */
export async function isFileBackedVersion(versionId: string): Promise<boolean> {
  return Boolean((await versionStorage(versionId))?.file);
}

/** Load every row of a version, in rowIndex order, in batches. */
export async function fetchAllDatasetRows(versionId: string): Promise<ExploreRowRecord[]> {
  const out: ExploreRowRecord[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = await fetchDatasetRows(versionId, { cursor, limit: MAX_PAGE_SIZE });
    out.push(...page.rows);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

/**
 * The cache token of a dataset: version hash, latest sample update in the
 * dataset's scope, edit state and curation version. Any view of the dataset
 * is a pure function of these inputs.
 */
export async function computeDatasetCacheToken(datasetId: string): Promise<string> {
  const dataset = await db.exploreDataset.findUnique({
    where: { id: datasetId },
    include: { versions: { orderBy: { number: "desc" }, take: 1 } },
  });
  if (!dataset) return computeCacheToken({ versionHash: null, samplesUpdatedAt: null, editCount: 0, editsUpdatedAt: null, curationVersion: 0 });
  const current = currentVersionOf(dataset);
  const target = parseTargetKey(dataset.targetKey);

  const sampleWhere: Prisma.SampleWhereInput | null =
    target?.type === "study" ? { studyId: target.id } : target?.type === "order" ? { orderId: target.id } : null;

  const [samples, edits, curation] = await Promise.all([
    sampleWhere
      ? db.sample.aggregate({ where: sampleWhere, _max: { updatedAt: true } })
      : Promise.resolve({ _max: { updatedAt: null as Date | null } }),
    db.exploreDatasetEdit.aggregate({
      where: { datasetId, revokedAt: null },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    db.exploreCurationList.aggregate({
      where: { targetKey: dataset.targetKey },
      _sum: { version: true },
    }),
  ]);

  return computeCacheToken({
    versionHash: current?.contentHash ?? null,
    samplesUpdatedAt: samples._max.updatedAt ? samples._max.updatedAt.toISOString() : null,
    editCount: edits._count._all,
    editsUpdatedAt: edits._max.createdAt ? edits._max.createdAt.toISOString() : null,
    curationVersion: curation._sum.version ?? 0,
  });
}

export async function deleteDataset(id: string): Promise<void> {
  const dataset = await db.exploreDataset.findUnique({ where: { id }, select: { id: true } });
  if (!dataset) return;
  await db.exploreDataset.delete({ where: { id } });
  const storage = await resolveExploreStorage();
  await fs
    .rm(path.join(storage.datasetsRoot, sanitizeSegment(id)), { recursive: true, force: true })
    .catch(() => {});
}
