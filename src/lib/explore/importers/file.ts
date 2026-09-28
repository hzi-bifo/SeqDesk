import { PROFILE_VERSION, profileNumericMatrix } from "@/lib/explore/table-profile";
import crypto from "crypto";
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { createGunzip } from "zlib";
import { parseDelimitedStream, streamLines, type DelimitedStreamHeader } from "../parsers/delimited-stream";
import { getTableKind, suggestRoles } from "../dataset-kinds";
import { parseDelimited, uniqueColumnKeys } from "../parsers/delimited";
import { coerceCell, inferSchema } from "../schema";
import type { ExploreProvenance, ExploreRole, ExploreRoleMap, ExploreRowData, ExploreSchema, ExploreSensitivity } from "../types";
import { applyIndivoGrammar, INDIVO_DERIVED_COLUMNS } from "./indivo-id";

export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2_000_000;

export interface ImportFileOptions {
  fileName: string;
  /** Apply the INDIVO sample id grammar to this column, adding subject, timepoint, specimen type and more. */
  idGrammar?: { kind: "indivo"; idColumn: string; sampleTypeColumn?: string | null; depletionColumn?: string | null; isolateColumn?: string | null } | null;
  /** Worksheet name for XLSX files; defaults to the first sheet with a header row. */
  sheet?: string | null;
}

export interface ParsedImport {
  columns: string[];
  rows: ExploreRowData[];
  sheets: string[];
  sheet: string | null;
  truncated: boolean;
  warnings: string[];
}

function fileKind(fileName: string): "xlsx" | "csv" | "tsv" | "unknown" {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".xlsx" || ext === ".xlsm") return "xlsx";
  if (ext === ".csv") return "csv";
  if (ext === ".tsv" || ext === ".txt" || ext === ".tab") return "tsv";
  return "unknown";
}

async function parseXlsx(buffer: Buffer, sheetName: string | null | undefined): Promise<ParsedImport> {
  // The package is CommonJS; bundlers hand it over as the default export, plain Node as the namespace.
  const loaded = (await import("exceljs")) as typeof import("exceljs") & { default?: typeof import("exceljs") };
  const ExcelJS = loaded.default ?? loaded;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheets = workbook.worksheets.map((sheet) => sheet.name);
  const worksheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets.find((sheet) => sheet.rowCount > 1) ?? workbook.worksheets[0];
  if (!worksheet) return { columns: [], rows: [], sheets, sheet: null, truncated: false, warnings: ["The workbook has no worksheet."] };

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    headers[columnNumber - 1] = cell.value === null || cell.value === undefined ? "" : String(cellText(cell.value)).trim();
  });
  const columns = uniqueColumnKeys(headers);

  const rows: ExploreRowData[] = [];
  let truncated = false;
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    if (rows.length >= MAX_IMPORT_ROWS) {
      truncated = true;
      return;
    }
    const data: ExploreRowData = {};
    let hasValue = false;
    columns.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      const value = coerceCell(cellText(cell.value));
      if (value !== null) hasValue = true;
      data[column] = value;
    });
    if (hasValue) rows.push(data);
  });
  return { columns, rows, sheets, sheet: worksheet.name, truncated, warnings: [] };
}

function cellText(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const object = value as { richText?: Array<{ text: string }>; text?: unknown; result?: unknown; hyperlink?: string; formula?: string };
    if (Array.isArray(object.richText)) return object.richText.map((part) => part.text).join("");
    if ("result" in object) return object.result ?? null;
    if ("text" in object) return object.text ?? null;
    if (value instanceof Date) return value;
  }
  return value;
}

export async function parseImportFile(buffer: Buffer, options: ImportFileOptions): Promise<ParsedImport> {
  if (buffer.length > MAX_IMPORT_BYTES) {
    throw new Error(`The file is larger than the ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB import limit`);
  }
  const kind = fileKind(options.fileName);
  let parsed: ParsedImport;
  if (kind === "xlsx") {
    parsed = await parseXlsx(buffer, options.sheet);
  } else if (kind === "csv" || kind === "tsv" || kind === "unknown") {
    const result = parseDelimited(buffer.toString("utf8"), { delimiter: kind === "csv" ? "," : "auto", maxRows: MAX_IMPORT_ROWS, hashComments: true });
    parsed = { columns: result.columns, rows: result.rows, sheets: [], sheet: null, truncated: result.truncated, warnings: [] };
  } else {
    throw new Error("Unsupported file type");
  }
  if (parsed.truncated) parsed.warnings.push(`Only the first ${MAX_IMPORT_ROWS} rows were imported.`);

  if (options.idGrammar?.kind === "indivo") {
    const idColumn = options.idGrammar.idColumn;
    if (!parsed.columns.includes(idColumn)) {
      parsed.warnings.push(`Column ${idColumn} is missing, the sample id grammar was not applied.`);
    } else {
      parsed.rows = applyIndivoGrammar(parsed.rows, {
        idColumn,
        sampleTypeColumn: options.idGrammar.sampleTypeColumn ?? null,
        depletionColumn: options.idGrammar.depletionColumn ?? null,
        isolateColumn: options.idGrammar.isolateColumn ?? null,
      });
      for (const derived of INDIVO_DERIVED_COLUMNS) {
        if (!parsed.columns.includes(derived)) parsed.columns.push(derived);
      }
    }
  }
  return parsed;
}

/** Roles of an imported table: suggested from the column names, then what the person chose. */
export function importRoles(columns: string[], tableKind: string | null, requested?: ExploreRoleMap): { roles: ExploreRoleMap; warnings: string[] } {
  const kindDefinition = getTableKind(tableKind);
  const roles: ExploreRoleMap = { ...suggestRoles(columns, tableKind ?? "sample-summary") };
  // Columns derived by an id grammar are canonical and win over name-based guesses.
  if (columns.includes("subject")) roles.subject = "subject";
  if (columns.includes("timepoint")) roles.timepoint = "timepoint";
  if (columns.includes("specimen_type")) roles.group = "specimen_type";
  for (const [role, column] of Object.entries(requested ?? {})) {
    if (column === "") delete roles[role as ExploreRole];
    if (column && columns.includes(column)) roles[role as ExploreRole] = column;
  }
  const warnings: string[] = [];
  if (kindDefinition) {
    const missing = kindDefinition.requiredRoles.filter((role) => !roles[role]);
    if (missing.length) warnings.push(`Roles still missing for ${kindDefinition.label}: ${missing.join(", ")}.`);
  }
  return { roles, warnings };
}

export interface PreparedImport {
  schema: ExploreSchema;
  rows: ExploreRowData[];
  roles: ExploreRoleMap;
  sensitivity: ExploreSensitivity;
  provenance: ExploreProvenance;
  keys: { sample?: string; subject?: string; key?: string };
  warnings: string[];
}

/**
 * Turn a parsed file into what a dataset version needs: schema with roles,
 * a sensitivity guess (a subject column makes it pseudonymous), provenance.
 */
export function prepareImport(
  parsed: ParsedImport,
  options: { tableKind: string | null; roles?: ExploreRoleMap; fileName: string; checksum: string }
): PreparedImport {
  const { roles, warnings: roleWarnings } = importRoles(parsed.columns, options.tableKind, options.roles);
  const warnings = [...parsed.warnings, ...roleWarnings];
  const groups: Record<string, string> = {};
  for (const derived of INDIVO_DERIVED_COLUMNS) groups[derived] = "derived";
  const schema = inferSchema(parsed.rows, { roles, groups });
  const profile = profileNumericMatrix(schema.columns, parsed.rows as Array<Record<string, unknown>>);
  return {
    schema,
    rows: parsed.rows,
    roles,
    sensitivity: roles.subject ? "pseudonymous" : "standard",
    provenance: {
      builtAt: new Date().toISOString(),
      builder: "import@1",
      sources: [{ type: "file", id: options.fileName, label: options.fileName, checksum: options.checksum }],
      notes: [`${parsed.rows.length} rows${parsed.sheet ? ` from sheet ${parsed.sheet}` : ""}`],
      // "Not a matrix" is a finding too: recorded, so a listing does not profile the table again.
      ...(profile ? { profile } : { profileChecked: PROFILE_VERSION }),
    },
    keys: { sample: roles.sample, subject: roles.subject, key: roles.taxon_id ?? roles.taxon },
    warnings,
  };
}

/** Delimited text (optionally gzipped) is read as a stream; XLSX is a zip that exceljs loads whole. */
export function isStreamableTable(fileName: string): boolean {
  const name = fileName.toLowerCase().replace(/\.gz$/, "");
  const kind = fileKind(name);
  return kind === "csv" || kind === "tsv";
}

function delimiterOf(fileName: string): "," | "auto" {
  return fileKind(fileName.toLowerCase().replace(/\.gz$/, "")) === "csv" ? "," : "auto";
}

/**
 * Bytes of a stored file, decompressed when it is .gz, hashed as read: when the whole file has been read the
 * sha256 is compared with the stored checksum and a changed file stops the import.
 */
async function* fileBytes(filePath: string, fileName: string, verify?: { checksum: string }, onBytes?: (bytes: number) => void): AsyncGenerator<Buffer> {
  const raw = createReadStream(filePath, { highWaterMark: 1 << 20 });
  const hash = verify ? crypto.createHash("sha256") : null;
  raw.on("data", (chunk) => { hash?.update(chunk as Buffer); onBytes?.((chunk as Buffer).length); });
  const source = /\.gz$/i.test(fileName) ? raw.pipe(createGunzip()) : raw;
  try {
    for await (const chunk of source) yield chunk as Buffer;
  } finally {
    raw.destroy();
  }
  if (hash && verify && hash.digest("hex") !== verify.checksum) throw new Error("The original file has changed on disk. Upload it again before importing it.");
}

export interface StreamedImport {
  header: DelimitedStreamHeader | undefined;
  rows: AsyncGenerator<ExploreRowData>;
  state: { header?: DelimitedStreamHeader; truncated?: boolean };
}

/** Rows of a delimited file on disk, one at a time; `state.header` is set before the first row. */
export function streamDelimitedFile(filePath: string, fileName: string, options: { verify?: { checksum: string }; maxRows?: number; onBytes?: (bytes: number) => void } = {}) {
  const state: { header?: DelimitedStreamHeader; truncated?: boolean } = {};
  const rows = parseDelimitedStream(streamLines(fileBytes(filePath, fileName, options.verify, options.onBytes)), { delimiter: delimiterOf(fileName), hashComments: true, maxRows: options.maxRows }, state);
  return { rows, state };
}

const SAMPLE_BYTES = 4 * 1024 * 1024;

/**
 * Preview of a large delimited file without reading all of it: the header, the first rows and a row count
 * estimated from the bytes the first rows took (marked approximate). Small files are counted exactly.
 */
export async function previewDelimitedFile(filePath: string, fileName: string, rowsWanted: number): Promise<{ columns: string[]; rows: ExploreRowData[]; rowCount: number; approximate: boolean }> {
  const size = (await fs.stat(filePath)).size;
  let bytes = 0;
  const { rows: stream, state } = streamDelimitedFile(filePath, fileName, { onBytes: (count) => { bytes += count; } });
  const rows: ExploreRowData[] = [];
  let counted = 0;
  let stopped = false;
  for await (const row of stream) {
    counted += 1;
    if (rows.length < rowsWanted) rows.push(row);
    // Enough to estimate: stop reading once a few MB went by (and the preview rows are in).
    if (rows.length >= rowsWanted && bytes >= SAMPLE_BYTES && bytes < size) { stopped = true; break; }
  }
  if (!stopped) return { columns: state.header?.columns ?? [], rows, rowCount: counted, approximate: false };
  const estimate = Math.round(counted * (size / Math.max(1, bytes)));
  return { columns: state.header?.columns ?? [], rows, rowCount: estimate, approximate: true };
}
