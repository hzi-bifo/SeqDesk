/**
 * ENA at study level: a project or study accession (PRJNA/PRJEB/ERP/SRP) opens as a table of its runs with the
 * attributes people filter by (instrument, layout, library strategy, sample attributes). A person filters, ticks
 * runs, and the existing FASTQ importer downloads exactly those runs; the table of the chosen runs goes along as a
 * Samples table, so public samples sit next to the lab's own.
 */
import type { WorkbenchFilePreviewItem, WorkbenchImportPreview } from "./types";

/** ENA read_run fields shown as run attributes (checked against the Portal API; unknown fields make it fail). */
export const RUN_ATTRIBUTE_FIELDS = [
  "sample_title", "sample_alias", "library_strategy", "library_source", "library_selection", "instrument_model", "library_layout",
  "country", "collection_date", "host", "isolation_source", "tissue_type", "sex", "cell_type", "cell_line", "strain",
  "environment_biome", "environment_material", "read_count", "base_count", "first_public",
] as const;
/** The columns a filter can use; counts and dates are shown, not filtered. */
export const FILTERABLE = new Set<string>(RUN_ATTRIBUTE_FIELDS.filter(field => !["read_count", "base_count", "first_public", "sample_title", "sample_alias"].includes(field)));
const ALWAYS = ["sample_accession", "scientific_name"];
export const MAX_TABLE_RUNS = 2000;

export type RunFilters = Record<string, string>;

function runMatches(record: Record<string, string | undefined>, filters: RunFilters): boolean {
  return Object.entries(filters).every(([field, wanted]) => (record[field] ?? "").trim().toLowerCase() === wanted.trim().toLowerCase());
}

/**
 * Narrow the parsed FASTQ files to the runs that pass the filters and, when runs were ticked, to those runs;
 * a ticked run that does not exist is an error (the table changed since it was shown).
 */
export function narrowEnaFiles(files: WorkbenchFilePreviewItem[], options: { runs?: string[]; filters?: RunFilters }): WorkbenchFilePreviewItem[] {
  const filters = options.filters ?? {};
  const unknownFilter = Object.keys(filters).filter(field => !FILTERABLE.has(field));
  if (unknownFilter.length) throw new Error(`Runs cannot be filtered by ${unknownFilter.join(", ")}.`);
  if (options.runs?.length) {
    const known = new Set(files.map(file => file.runAccession));
    const missing = options.runs.filter(run => !known.has(run));
    if (missing.length) throw new Error(`ENA has no public FASTQ for ${missing.slice(0, 3).join(", ")} under this accession. Preview it again.`);
  }
  const picked = options.runs?.length ? new Set(options.runs) : null;
  return files.filter(file => (!picked || picked.has(file.runAccession)) && runMatches(file.sourceRecord ?? {}, filters));
}

/** One row per run (not per file), with the attribute columns that have any value in this study. */
export function enaRunTable(files: WorkbenchFilePreviewItem[], options: { filters?: RunFilters; selected: WorkbenchFilePreviewItem[] }): NonNullable<WorkbenchImportPreview["runs"]> {
  const byRun = new Map<string, WorkbenchFilePreviewItem[]>();
  for (const file of files) byRun.set(file.runAccession, [...(byRun.get(file.runAccession) ?? []), file]);
  const chosen = new Set(options.selected.map(file => file.runAccession));
  const fields = [...ALWAYS, ...RUN_ATTRIBUTE_FIELDS];
  const columns = fields.filter(field => files.some(file => (file.sourceRecord?.[field] ?? "").trim()));
  const runs = [...byRun.entries()];
  const rows = runs.slice(0, MAX_TABLE_RUNS).map(([run, runFiles]) => {
    const record = runFiles[0].sourceRecord ?? {};
    return {
      run,
      values: Object.fromEntries(columns.map(column => [column, String(record[column] ?? "").trim()])),
      bytes: runFiles.reduce((sum, file) => sum + (file.bytes ?? 0), 0),
      files: runFiles.length,
      matches: runMatches(record, options.filters ?? {}),
      selected: chosen.has(run),
    };
  });
  return { columns, rows, truncated: runs.length > MAX_TABLE_RUNS };
}

/** The chosen runs and their sample attributes as a TSV, for the Samples table that goes with the reads. */
export function enaSamplesTsv(files: Array<Pick<WorkbenchFilePreviewItem, "runAccession" | "sampleAccession" | "studyAccession" | "scientificName" | "instrumentModel" | "libraryLayout" | "sourceRecord">>): string {
  const seen = new Set<string>();
  const runs = files.filter(file => !seen.has(file.runAccession) && seen.add(file.runAccession));
  const extra = RUN_ATTRIBUTE_FIELDS.filter(field => runs.some(file => (file.sourceRecord?.[field] ?? "").trim()));
  const columns = ["run_accession", "sample_accession", "study_accession", "scientific_name", ...extra.filter(field => field !== "instrument_model" && field !== "library_layout"), "instrument_model", "library_layout"];
  const clean = (value: unknown) => String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
  const rows = runs.map(file => columns.map(column => clean(
    column === "run_accession" ? file.runAccession : column === "sample_accession" ? file.sampleAccession : column === "study_accession" ? file.studyAccession
      : column === "scientific_name" ? file.scientificName : column === "instrument_model" ? file.instrumentModel : column === "library_layout" ? file.libraryLayout : file.sourceRecord?.[column])));
  return `${[columns, ...rows].map(row => row.join("\t")).join("\n")}\n`;
}
