/**
 * Large tables. A dataset version always has its rows as a TSV on disk (data.tsv); small and mid-sized tables
 * also keep one Postgres row per table row, which curation edits, sample filters and reports query. Above
 * DB_MAX_CELLS the rows stay only in the file ("file-backed"): a sparse line index (rows.idx.json, one byte
 * offset per INDEX_EVERY rows) makes any page a seek plus a short read, and staging a run copies the file.
 *
 * A version whose content equals another stored version shares its data.tsv as a hard link instead of a
 * second copy.
 */
import { createReadStream, createWriteStream, type WriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { MatrixProfileAccumulator, PROFILE_VERSION, type TableProfile } from "./table-profile";
import { ContentHashAccumulator, SchemaAccumulator } from "./schema";
import { streamLineBatches } from "./parsers/delimited-stream";
import { resolveExploreStorage, sanitizeSegment } from "./storage";
import type { ExploreCell, ExploreProvenance, ExploreRoleMap, ExploreRowData, ExploreRowRecord, ExploreSchema } from "./types";

/** Tables with more cells than this keep their rows only in the file. */
export const DB_MAX_CELLS = Number(process.env.SEQDESK_TABLE_DB_MAX_CELLS) > 0 ? Number(process.env.SEQDESK_TABLE_DB_MAX_CELLS) : 20_000_000;
export const INDEX_EVERY = 10_000;
const ROW_BATCH_SIZE = 1000;
/** A Postgres insert batch is kept under this many cells, so a 10,000-column row does not make a 10-million-cell statement. */
const BATCH_MAX_CELLS = 200_000;

export class ImportCancelled extends Error {
  constructor() { super("The import was cancelled."); }
}

export interface FileStorageInfo {
  rows: "file";
  index: string;
}

export function fileStorageOf(provenance: unknown): FileStorageInfo | null {
  let value = provenance;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  const storage = value && typeof value === "object" ? (value as { storage?: { rows?: unknown; index?: unknown } }).storage : null;
  return storage && storage.rows === "file" && typeof storage.index === "string" ? { rows: "file", index: storage.index } : null;
}

function tsvEscape(value: ExploreCell | undefined): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : String(value);
  return text.replace(/[\t\r\n]/g, " ");
}

function cellToKey(value: ExploreCell | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, 200) : null;
}

async function writeChunk(stream: WriteStream, text: string) {
  if (stream.write(text)) return;
  await new Promise<void>((resolve, reject) => {
    const done = (error?: Error) => { stream.off("drain", done); stream.off("error", done); if (error) reject(error); else resolve(); };
    stream.on("drain", done);
    stream.on("error", done);
  });
}

async function closeStream(stream: WriteStream) {
  await new Promise<void>((resolve, reject) => stream.end((error?: Error | null) => (error ? reject(error) : resolve())));
}

/**
 * Replace `file` with a hard link to an identical data.tsv of another version (same content hash), so a
 * re-import or a copy costs no second copy on disk. Keeps the file when no twin exists or linking fails.
 */
export async function shareIdenticalData(file: string, contentHash: string, exceptVersionId: string): Promise<boolean> {
  const twins = await db.exploreDatasetVersion.findMany({ where: { contentHash, id: { not: exceptVersionId }, storagePath: { not: null } }, select: { storagePath: true }, take: 5 });
  for (const twin of twins) {
    const other = path.join(twin.storagePath!, "data.tsv");
    try {
      const [mine, theirs] = await Promise.all([fs.stat(file), fs.stat(other)]);
      if (mine.size !== theirs.size) continue;
      if (mine.ino === theirs.ino && mine.dev === theirs.dev) return true;
      const temporary = `${file}.link`;
      await fs.link(other, temporary);
      await fs.rename(temporary, file);
      return true;
    } catch {
      // Removed by housekeeping, another file system, or no permission: keep our own copy.
    }
  }
  return false;
}

export interface StreamVersionInput {
  datasetId: string;
  columns: string[];
  /** Rows in batches (a promise per batch, not per row). */
  rows: AsyncIterable<ExploreRowData[]>;
  provenance: ExploreProvenance;
  buildSource: "auto" | "manual" | "import" | "analysis-run";
  createdById?: string | null;
  roles?: ExploreRoleMap;
  groups?: Record<string, string>;
  keys?: { sample?: string; subject?: string; key?: string };
  /** Rows the caller expects (from the file size); above DB_MAX_CELLS the rows go straight to file storage. */
  expectedRows?: number;
  signal?: AbortSignal;
  onProgress?: (rows: number) => void;
}

export interface StreamVersionResult {
  versionId: string;
  number: number;
  rowCount: number;
  contentHash: string;
  unchanged: boolean;
  schema: ExploreSchema;
  profile: TableProfile | null;
  fileBacked: boolean;
  sharedData: boolean;
}

/**
 * Write a new version from a stream of rows: one pass that writes the TSV, the Postgres rows (unless the table
 * is too large for them), the schema types, the count-matrix profile and the content hash. Memory is one batch
 * of rows plus a few numbers per column. Cancelling (signal) removes everything written so far.
 */
export async function writeDatasetVersionStream(input: StreamVersionInput): Promise<StreamVersionResult> {
  const dataset = await db.exploreDataset.findUnique({ where: { id: input.datasetId }, include: { versions: { orderBy: { number: "desc" }, take: 1 } } });
  if (!dataset) throw new Error("Dataset not found");
  const latest = dataset.versions[0] ?? null;
  const number = (latest?.number ?? 0) + 1;
  const storage = await resolveExploreStorage();
  const versionDir = path.join(storage.datasetsRoot, sanitizeSegment(dataset.id), `v${number}`);
  await fs.mkdir(versionDir, { recursive: true });
  const columns = input.columns;
  const width = Math.max(1, columns.length);
  // The row estimate can be low (quoted newlines, short first rows): above half the limit the file carries the table
  // from the start, instead of writing rows to the database and deleting them again.
  let inDatabase = !(input.expectedRows && input.expectedRows * width > DB_MAX_CELLS / 2);
  const version = await db.exploreDatasetVersion.create({
    data: { datasetId: dataset.id, number, contentHash: "pending", schema: JSON.stringify({ columns: [] }), rowCount: 0,
      provenance: JSON.stringify(input.provenance), storagePath: versionDir, buildSource: input.buildSource, createdById: input.createdById ?? null },
  });
  const dataFile = path.join(versionDir, "data.tsv");
  const out = createWriteStream(dataFile, { encoding: "utf8" });
  const schemaAccumulator = new SchemaAccumulator();
  const profileAccumulator = new MatrixProfileAccumulator(columns);
  const hash = new ContentHashAccumulator();
  const index: number[] = [];
  let offset = 0;
  let rowCount = 0;
  const batchRows = Math.max(1, Math.min(ROW_BATCH_SIZE, Math.floor(BATCH_MAX_CELLS / width)));
  // Progress (and the cancel check) every ~2 million cells: often for a wide table, every 10,000 rows at most.
  const progressEvery = Math.max(1, Math.min(10_000, Math.floor(2_000_000 / width)));
  let batch: Prisma.ExploreDatasetRowCreateManyInput[] = [];
  const flush = async () => {
    if (inDatabase && batch.length) await db.exploreDatasetRow.createMany({ data: batch });
    batch = [];
  };
  try {
    const header = `${columns.join("\t")}\n`;
    await writeChunk(out, header);
    offset += Buffer.byteLength(header);
    let text = "";
    for await (const rows of input.rows) for (const row of rows) {
      if (rowCount % INDEX_EVERY === 0) {
        if (text) { await writeChunk(out, text); text = ""; }
        index.push(offset);
      }
      const line = `${columns.map((key) => tsvEscape(row[key])).join("\t")}\n`;
      offset += Buffer.byteLength(line);
      text += line;
      if (text.length > 1 << 20) { await writeChunk(out, text); text = ""; }
      schemaAccumulator.add(row);
      profileAccumulator.add(row);
      hash.add(row);
      if (inDatabase) {
        batch.push({ versionId: version.id, rowIndex: rowCount,
          sampleId: input.keys?.sample ? cellToKey(row[input.keys.sample]) : null,
          subjectId: input.keys?.subject ? cellToKey(row[input.keys.subject]) : null,
          key: input.keys?.key ? cellToKey(row[input.keys.key]) : null,
          data: row as Prisma.InputJsonValue });
        if (batch.length >= batchRows) await flush();
        if ((rowCount + 1) * width > DB_MAX_CELLS) {
          // Larger than the database keeps: the rows written so far go, the file carries the table.
          inDatabase = false;
          batch = [];
          await db.exploreDatasetRow.deleteMany({ where: { versionId: version.id } });
        }
      }
      rowCount += 1;
      if (rowCount % progressEvery === 0) {
        input.onProgress?.(rowCount);
        if (input.signal?.aborted) throw new ImportCancelled();
      }
    }
    if (text) await writeChunk(out, text);
    await flush();
    await closeStream(out);
  } catch (error) {
    out.destroy();
    await db.exploreDatasetVersion.delete({ where: { id: version.id } }).catch(() => {});
    await fs.rm(versionDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  input.onProgress?.(rowCount);

  const schema = schemaAccumulator.schema({ roles: input.roles, groups: input.groups });
  // A table with no rows still has its columns.
  if (!schema.columns.length) schema.columns = columns.map((key) => ({ key, label: key, type: "string" }));
  const profile = profileAccumulator.finish(schema.columns);
  const contentHash = hash.digest(schema);
  if (latest && latest.contentHash === contentHash && dataset.currentVersionId === latest.id) {
    await db.exploreDatasetVersion.delete({ where: { id: version.id } });
    await fs.rm(versionDir, { recursive: true, force: true });
    return { versionId: latest.id, number: latest.number, rowCount: latest.rowCount, contentHash, unchanged: true, schema, profile, fileBacked: Boolean(fileStorageOf(latest.provenance)), sharedData: false };
  }
  const provenance: ExploreProvenance & { storage?: FileStorageInfo; profileChecked?: number } = { ...input.provenance, notes: [`${rowCount} rows`, ...(input.provenance.notes ?? [])], ...(profile ? { profile } : { profileChecked: PROFILE_VERSION }) };
  if (!inDatabase) provenance.storage = { rows: "file", index: "rows.idx.json" };
  await fs.writeFile(path.join(versionDir, "rows.idx.json"), JSON.stringify({ every: INDEX_EVERY, offsets: index, rows: rowCount }), "utf8");
  await fs.writeFile(path.join(versionDir, "schema.json"), JSON.stringify({ schema, provenance, contentHash }, null, 2), "utf8");
  const sharedData = await shareIdenticalData(dataFile, contentHash, version.id);
  await db.exploreDatasetVersion.update({ where: { id: version.id }, data: { contentHash, schema: JSON.stringify(schema), rowCount, provenance: JSON.stringify(provenance) } });
  await db.exploreDataset.update({ where: { id: dataset.id }, data: { currentVersionId: version.id } });
  return { versionId: version.id, number, rowCount, contentHash, unchanged: false, schema, profile, fileBacked: !inDatabase, sharedData };
}

/** Split one data.tsv line back into a row: empty cells are null, like the rows it was written from. */
function rowOfLine(line: string, columns: string[]): ExploreRowData {
  const cells = line.split("\t");
  const row: ExploreRowData = {};
  for (let index = 0; index < columns.length; index += 1) {
    const cell = cells[index];
    row[columns[index]] = cell === undefined || cell === "" ? null : cell;
  }
  return row;
}

async function readIndex(dir: string): Promise<{ every: number; offsets: number[]; rows: number } | null> {
  try { return JSON.parse(await fs.readFile(path.join(dir, "rows.idx.json"), "utf8")); } catch { return null; }
}

export interface FileRowsOptions {
  /** First row index to return (after `cursor` when given). */
  start?: number;
  limit: number;
  /** Rows that pass are returned; the scan stops after `scanLimit` rows. */
  filter?: (row: ExploreRowData) => boolean;
  scanLimit?: number;
}

/**
 * Rows of a version from its data.tsv: seek to the nearest indexed offset, then read forward. Without a
 * filter a page costs at most INDEX_EVERY skipped lines; with one, the scan is bounded by `scanLimit`.
 */
export async function readRowsFromFile(storagePath: string, columns: string[], options: FileRowsOptions): Promise<{ rows: ExploreRowRecord[]; scanned: number; end: boolean; lastIndex: number | null }> {
  const start = Math.max(0, options.start ?? 0);
  const index = await readIndex(storagePath);
  let position = 0;
  let rowIndex = -1;
  if (index && index.offsets.length) {
    const block = Math.min(Math.floor(start / index.every), index.offsets.length - 1);
    position = index.offsets[block];
    rowIndex = block * index.every;
  }
  const stream = createReadStream(path.join(storagePath, "data.tsv"), { start: position, highWaterMark: 1 << 20 });
  const rows: ExploreRowRecord[] = [];
  let scanned = 0;
  let end = true;
  let lastIndex: number | null = null;
  try {
    outer: for await (const lines of streamLineBatches(stream)) for (const line of lines) {
      if (rowIndex === -1) { rowIndex = 0; continue; } // header when no index
      const current = rowIndex;
      // The file ends with a newline; its last "line" is not a row.
      if (index ? current >= index.rows : line === "") break outer;
      rowIndex += 1;
      if (current < start) continue;
      scanned += 1;
      lastIndex = current;
      const data = rowOfLine(line, columns);
      if (!options.filter || options.filter(data)) rows.push({ rowIndex: current, sampleId: null, subjectId: null, key: null, data });
      if (rows.length >= options.limit || (options.scanLimit !== undefined && scanned >= options.scanLimit)) { end = false; break outer; }
    }
  } finally {
    stream.destroy();
  }
  return { rows, scanned, end, lastIndex };
}

/** Stream every data line of a version file to `destination` (a run's input): a copy, not a parse. */
export async function copyVersionData(storagePath: string, destination: string): Promise<boolean> {
  try {
    await fs.copyFile(path.join(storagePath, "data.tsv"), destination);
    return true;
  } catch {
    return false;
  }
}

export { readIndex as readRowsIndex };
