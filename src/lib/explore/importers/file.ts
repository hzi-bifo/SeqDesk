import path from "path";
import { getTableKind, suggestRoles } from "../dataset-kinds";
import { parseDelimited } from "../parsers/delimited";
import { coerceCell, inferSchema, normalizeColumnKey } from "../schema";
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
  const seen = new Map<string, number>();
  const columns = headers.map((header, index) => {
    const base = normalizeColumnKey(header || `column_${index + 1}`);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });

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
    const result = parseDelimited(buffer.toString("utf8"), { delimiter: kind === "csv" ? "," : "auto", maxRows: MAX_IMPORT_ROWS });
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
  const kindDefinition = getTableKind(options.tableKind);
  const roles: ExploreRoleMap = { ...suggestRoles(parsed.columns, options.tableKind ?? "sample-summary") };
  // Columns derived by an id grammar are canonical and win over name-based guesses.
  if (parsed.columns.includes("subject")) roles.subject = "subject";
  if (parsed.columns.includes("timepoint")) roles.timepoint = "timepoint";
  if (parsed.columns.includes("specimen_type")) roles.group = "specimen_type";
  for (const [role, column] of Object.entries(options.roles ?? {})) {
    if (column && parsed.columns.includes(column)) roles[role as ExploreRole] = column;
  }
  const warnings = [...parsed.warnings];
  if (kindDefinition) {
    const missing = kindDefinition.requiredRoles.filter((role) => !roles[role]);
    if (missing.length) warnings.push(`Roles still missing for ${kindDefinition.label}: ${missing.join(", ")}.`);
  }
  const groups: Record<string, string> = {};
  for (const derived of INDIVO_DERIVED_COLUMNS) groups[derived] = "derived";
  const schema = inferSchema(parsed.rows, { roles, groups });
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
    },
    keys: { sample: roles.sample, subject: roles.subject, key: roles.taxon_id ?? roles.taxon },
    warnings,
  };
}
