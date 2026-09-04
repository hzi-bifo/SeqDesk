import fs from "fs/promises";
import path from "path";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { computeCacheToken } from "./cache-token";
import { computeContentHash, parseJsonObject, parseRoles, parseSchema } from "./schema";
import { resolveExploreStorage, sanitizeSegment } from "./storage";
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
    currentVersion: current
      ? {
          id: current.id,
          number: current.number,
          rowCount: current.rowCount,
          contentHash: current.contentHash,
          createdAt: toIso(current.createdAt),
        }
      : null,
    createdAt: toIso(dataset.createdAt),
    updatedAt: toIso(dataset.updatedAt),
  };
}

export async function listDatasets(targetKey: string): Promise<ExploreDatasetSummary[]> {
  const datasets = await db.exploreDataset.findMany({
    where: { targetKey },
    include: { versions: { orderBy: { number: "desc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
  });
  return datasets.map(serializeDatasetSummary);
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
  createdById: string;
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
export async function writeDatasetVersion(input: WriteVersionInput): Promise<WriteVersionResult> {
  const dataset = await db.exploreDataset.findUnique({
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
  const versionDir = path.join(storage.datasetsRoot, sanitizeSegment(dataset.id), `v${number}`);
  await fs.mkdir(versionDir, { recursive: true });

  const columns = input.schema.columns.map((column) => column.key);
  const tsvLines = [columns.join("\t")];
  for (const row of input.rows) {
    tsvLines.push(columns.map((key) => tsvEscape(row[key] ?? null)).join("\t"));
  }
  await fs.writeFile(path.join(versionDir, "data.tsv"), `${tsvLines.join("\n")}\n`, "utf8");
  await fs.writeFile(
    path.join(versionDir, "schema.json"),
    JSON.stringify({ schema: input.schema, provenance: input.provenance, contentHash }, null, 2),
    "utf8"
  );

  const version = await db.exploreDatasetVersion.create({
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
  for (let start = 0; start < input.rows.length; start += ROW_BATCH_SIZE) {
    const batch = input.rows.slice(start, start + ROW_BATCH_SIZE).map((row, offset) => ({
      versionId: version.id,
      rowIndex: start + offset,
      sampleId: sampleKey ? cellToKey(row[sampleKey]) : null,
      subjectId: subjectKey ? cellToKey(row[subjectKey]) : null,
      key: secondaryKey ? cellToKey(row[secondaryKey]) : null,
      data: row as Prisma.InputJsonValue,
    }));
    await db.exploreDatasetRow.createMany({ data: batch });
  }

  await db.exploreDataset.update({
    where: { id: dataset.id },
    data: { currentVersionId: version.id },
  });

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
  const where: Prisma.ExploreDatasetRowWhereInput = {
    versionId,
    ...(options.sampleId ? { sampleId: options.sampleId } : {}),
    ...(options.subjectId ? { subjectId: options.subjectId } : {}),
    ...(options.key ? { key: options.key } : {}),
  };
  const [total, rows] = await Promise.all([
    db.exploreDatasetRow.count({ where }),
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
