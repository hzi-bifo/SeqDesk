/**
 * The built-in "Choose samples" step (stepKind "samples", identity sheet 96 f1–f2, capability explore.samples-steps).
 * No code: a person filters the study's metadata table, the step matches each sample to its reads in Data, cleans the
 * names, adds columns, and writes the sample list a pipeline step reads — typed with the pipeline's samplesheet
 * columns (sample, fastq_1, fastq_2, the added columns) plus `source_name`, the name as the metadata wrote it.
 *
 * Reads are matched in three tries: the exact name, the name without case, dashes, leading zeros and lane or S-number
 * endings (A-01 ↔ A01_S1_L001), then suggestions a person confirms (never used silently). Confirmed matches and an
 * uploaded sample → file table are kept in the step's configuration, so the next run and the next person get the
 * same answer. Samples left out keep their reason, the person and the date; left out before a run they change the
 * step (it turns out of date), left out during or after a pipeline run they take effect at once on that pipeline's
 * tables and on the next run of the list (pipeline-quality.ts), without making anything out of date by themselves.
 *
 * The configuration lives in the revision's `pipeline` JSON (the pipeline-steps migration); its code is the canonical
 * JSON of everything that decides the list, so any change reads codeChanged like a code edit.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import { getPackage } from "@/lib/pipelines/package-loader";
import { findDataStudy, linkedReadRecords, readsInData, type DataReadPair } from "@/lib/pipelines/data-study";
import { createAnalysis, createRevision, RevisionConflict, allocateRunNumber, type AnalysisInputBinding } from "./analyses";
import { fetchAllDatasetRows, writeDatasetVersion } from "./datasets";
import { loadRecipe, type RecipeActor, type RecipeModel, type RecipeStep } from "./recipe";
import { keyBetween, sortSteps } from "./recipe-order";
import { parseJsonObject, parseSchema } from "./schema";
import { canonicalJson, normalizeSampleName, requirePipelineSteps } from "./pipeline-steps";
import { parseExclusions, personOf, type ExclusionStage, type SamplePerson, type SamplesExclusion } from "./sample-exclusions";
import type { ExploreRowData, ExploreSchema } from "./types";

// ---------------------------------------------------------------------------
// The configuration
// ---------------------------------------------------------------------------

export type SamplesFilterOp = "is" | "is not" | "contains" | "at least" | "at most";
export const FILTER_OPS: SamplesFilterOp[] = ["is", "is not", "contains", "at least", "at most"];
export interface SamplesFilter { column: string; op: SamplesFilterOp; values: Array<string | number> }
export interface SamplesExtraColumn { name: string; from: string; map: Record<string, string> | null }
export type { ExclusionStage, SamplePerson, SamplesExclusion } from "./sample-exclusions";
export interface SamplesMatch { sample: string; files: string[]; by: SamplePerson; at: string }
export interface SamplesUploaded { name: string | null; rows: Array<{ sample: string; files: string[] }>; by: SamplePerson; at: string }
export interface SamplesStepConfig {
  kind: "samples";
  /** The metadata table it filters (bound as the step's `metadata` input); null: every sample with reads in Data. */
  metadata: { datasetId: string; sampleColumn: string | null } | null;
  /** The pipeline the list is for (its samplesheet columns); null: the usual sample, fastq_1, fastq_2. */
  forPipeline: string | null;
  filters: SamplesFilter[];
  pairing: { matched: SamplesMatch[]; uploaded: SamplesUploaded | null };
  cleanNames: boolean;
  /** Samples whose reads are not found: left out of the list (said on the step), or the run stops until they are matched. */
  withoutReads: "leave-out" | "stop";
  extraColumns: SamplesExtraColumn[];
  exclusions: SamplesExclusion[];
  /** The table it writes. */
  output: string;
}

export const SAMPLES_OUTPUT = "sample_list";
const rec = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown, max = 200): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
const plural = (count: number, word: string, many = `${word}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? word : many}`;

export const defaultSamplesConfig = (): SamplesStepConfig => ({ kind: "samples", metadata: null, forPipeline: null, filters: [], pairing: { matched: [], uploaded: null }, cleanNames: true, withoutReads: "leave-out", extraColumns: [], exclusions: [], output: SAMPLES_OUTPUT });

/** A stored or sent configuration, tolerantly: what is malformed is left out, never guessed. */
export function parseSamplesConfig(raw: unknown): SamplesStepConfig {
  const value = typeof raw === "string" ? (() => { try { return JSON.parse(raw) as unknown; } catch { return null; } })() : raw;
  const config = rec(value);
  const metadata = rec(config.metadata);
  const filters = (Array.isArray(config.filters) ? config.filters : []).slice(0, 30).flatMap((entry) => {
    const filter = rec(entry);
    const column = text(filter.column, 200);
    const op = FILTER_OPS.find((candidate) => candidate === filter.op);
    const values = (Array.isArray(filter.values) ? filter.values : filter.value !== undefined ? [filter.value] : []).filter((item): item is string | number => (typeof item === "string" && item.length <= 500) || (typeof item === "number" && Number.isFinite(item))).slice(0, 200);
    return column && op ? [{ column, op, values }] : [];
  });
  const pairing = rec(config.pairing);
  const matched = (Array.isArray(pairing.matched) ? pairing.matched : []).slice(0, 5000).flatMap((entry) => {
    const match = rec(entry);
    const sample = text(match.sample, 300);
    const files = (Array.isArray(match.files) ? match.files : []).map((file) => text(file, 120)).filter((file): file is string => Boolean(file)).slice(0, 2);
    return sample && files.length ? [{ sample, files, by: personOf(match.by), at: text(match.at, 40) ?? "" }] : [];
  });
  const uploadedRaw = pairing.uploaded ? rec(pairing.uploaded) : null;
  const uploaded = uploadedRaw ? {
    name: text(uploadedRaw.name, 200), by: personOf(uploadedRaw.by), at: text(uploadedRaw.at, 40) ?? "",
    rows: (Array.isArray(uploadedRaw.rows) ? uploadedRaw.rows : []).slice(0, 20000).flatMap((entry) => {
      const row = rec(entry);
      const sample = text(row.sample, 300);
      const files = (Array.isArray(row.files) ? row.files : []).map((file) => text(file, 120)).filter((file): file is string => Boolean(file)).slice(0, 2);
      return sample && files.length ? [{ sample, files }] : [];
    }),
  } : null;
  const extraColumns = (Array.isArray(config.extraColumns) ? config.extraColumns : []).slice(0, 20).flatMap((entry) => {
    const column = rec(entry);
    const name = text(column.name, 60);
    const from = text(column.from, 200);
    const map = column.map && typeof column.map === "object" && !Array.isArray(column.map)
      ? Object.fromEntries(Object.entries(column.map as Record<string, unknown>).filter(([, to]) => typeof to === "string" || typeof to === "number").slice(0, 500).map(([key, to]) => [key, String(to).slice(0, 200)])) : null;
    return name && from && /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(name) ? [{ name, from, map: map && Object.keys(map).length ? map : null }] : [];
  });
  const exclusions = parseExclusions(config.exclusions);
  const datasetId = text(metadata.datasetId, 80);
  return {
    kind: "samples",
    metadata: datasetId ? { datasetId, sampleColumn: text(metadata.sampleColumn, 200) } : null,
    forPipeline: text(config.forPipeline, 120),
    filters, pairing: { matched, uploaded }, cleanNames: config.cleanNames !== false,
    withoutReads: config.withoutReads === "stop" ? "stop" : "leave-out",
    extraColumns, exclusions, output: text(config.output, 60) ?? SAMPLES_OUTPUT,
  };
}

/** What decides the list. Samples left out during or after a pipeline run are not part of it: they take effect on that
 *  pipeline's tables at once and on the list the next time it runs, so they never make the step out of date. */
export function samplesStepCode(config: SamplesStepConfig): string {
  return JSON.stringify(JSON.parse(canonicalJson({
    kind: "samples", metadata: config.metadata, forPipeline: config.forPipeline, filters: config.filters,
    matched: config.pairing.matched.map((match) => ({ sample: match.sample, files: match.files })),
    uploaded: config.pairing.uploaded?.rows ?? null, cleanNames: config.cleanNames, withoutReads: config.withoutReads,
    extraColumns: config.extraColumns, leftOut: config.exclusions.filter((exclusion) => exclusion.stage === "before").map((exclusion) => exclusion.sample).sort(),
    output: config.output,
  })), null, 2);
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** A sample name a samplesheet takes: no spaces, letters, digits, dots, dashes and underscores. */
export function cleanSampleName(name: string): string {
  return name.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_{2,}/g, "_").replace(/^_+|_+$/g, "") || "sample";
}
export const needsCleaning = (name: string) => /[^A-Za-z0-9._-]/.test(name.trim()) || name !== name.trim();

/** A pair's sample id without the sequencer's endings: A17_S12_L001 → A17. */
export function stemOf(sampleId: string): string {
  return sampleId.replace(/\.(fastq|fq)(\.gz)?$/i, "").replace(/([._-](r?[12]))?(_001)?$/i, "").replace(/_S\d+(_L\d{3})?$/i, "").replace(/_L\d{3}$/i, "");
}

/** Why a file's name is the sample's ("same name without the dash"). */
export function sameNameWords(name: string, sampleId: string): string {
  const a = name.trim(), b = stemOf(sampleId);
  if (a === b) return "same name with the sequencer’s endings";
  if (a.toLowerCase() === b.toLowerCase()) return "same name in another case";
  if (a.replace(/-/g, "") === b) return "same name without the dash";
  if (a.replace(/-/g, "_") === b) return "same name with an underscore";
  if (a.replace(/\s+/g, "") === b || a.replace(/\s+/g, "_") === b) return "same name without the space";
  if (a.replace(/[-_\s]/g, "").replace(/(^|[A-Za-z])0+(\d)/g, "$1$2").toLowerCase() === b.replace(/[-_\s]/g, "").replace(/(^|[A-Za-z])0+(\d)/g, "$1$2").toLowerCase()) return "same name without the leading zero";
  return "same name, written differently";
}

/** Edit distance up to `limit` (more is reported as limit + 1). */
function distance(a: string, b: string, limit = 2): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, current[j]);
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

// ---------------------------------------------------------------------------
// Building the list (pure)
// ---------------------------------------------------------------------------

export interface ReadsSource {
  pairs: DataReadPair[];
  /** Imported read records linked to the study (ENA, SRA): matched by their sample label. */
  records: Array<{ sampleId: string; label: string; paired: boolean; readId: string }>;
}

export interface SampleSuggestion {
  /** The Data file ids (R1, R2) to confirm. */
  files: string[];
  names: string[];
  sampleId: string;
  how: "same-name" | "similar";
  words: string;
}

export interface SamplesRule { index: number; column: string; op: SamplesFilterOp; values: Array<string | number>; words: string; count: number; after: number; missingColumn: boolean }

export interface SamplesListResult {
  /** Rows of the metadata (or samples with reads when there is none). */
  total: number;
  sampleColumn: string | null;
  columns: Array<{ key: string; label: string; values: Array<{ value: string; count: number }> | null; numeric: boolean }>;
  rules: SamplesRule[];
  afterFilters: number;
  leftOut: Array<SamplesExclusion & { inList: boolean }>;
  reads: {
    found: number; of: number; exact: number; normalised: number; confirmed: number; uploaded: number;
    missing: Array<{ sample: string; suggestions: SampleSuggestion[]; words: string }>;
    words: string;
    how: string;
  };
  cleaned: Array<{ from: string; to: string }>;
  extra: Array<{ name: string; from: string; map: Record<string, string> | null; words: string; unmapped: string[] }>;
  /** The list: one row per sample. */
  rows: Array<Record<string, string>>;
  /** Pair sample id (as Data names it) → the list's sample name. */
  pairs: Array<{ sample: string; sampleId: string; files: string[]; how: "exact" | "normalised" | "confirmed" | "uploaded" | "record" }>;
  outputColumns: string[];
  problems: Array<{ kind: "no-reads" | "duplicate-name" | "duplicate-file" | "missing-column" | "no-samples"; words: string; samples: string[] }>;
  ledger: { label: string; alias: string | null; output: string; in: { rows: number; cols: number }; out: { rows: number; cols: number }; samples: { in: number; out: number }; reasons: Array<{ count: number; reason: string; axis: "rows"; keys: string[] }> };
  words: string;
}

const cellText = (value: unknown): string => (value === null || value === undefined ? "" : typeof value === "number" ? String(value) : String(value).trim());
const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = typeof value === "string" && value.trim() ? Number(value.replace(/,/g, "")) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/** "Diagnosis is Adenoma or Normal", "Study is not Zeller", "Age at least 40". */
export function ruleWords(filter: Pick<SamplesFilter, "column" | "op" | "values">): string {
  const values = filter.values.map((value) => (typeof value === "number" ? value.toLocaleString("en-US") : value));
  const list = values.length > 1 ? `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}` : String(values[0] ?? "—");
  return filter.op === "contains" ? `${filter.column} contains ${list}` : `${filter.column} ${filter.op} ${list}`;
}

export function rowPasses(row: Record<string, unknown>, filter: SamplesFilter): boolean {
  const cell = row[filter.column];
  if (filter.op === "at least" || filter.op === "at most") {
    const value = asNumber(cell), bound = asNumber(filter.values[0]);
    if (value === null || bound === null) return false;
    return filter.op === "at least" ? value >= bound : value <= bound;
  }
  const valueText = cellText(cell).toLowerCase();
  const wanted = filter.values.map((value) => String(value).trim().toLowerCase());
  if (filter.op === "contains") return wanted.some((part) => part && valueText.includes(part));
  const hit = wanted.includes(valueText);
  return filter.op === "is" ? hit : !hit;
}

/** The column naming the samples: the chosen one, else `sample`, `sample_id`, `sampleId` or `Sample`, else the first. */
export function sampleColumnOf(columns: string[], chosen: string | null | undefined): string | null {
  if (chosen && columns.includes(chosen)) return chosen;
  const lower = new Map(columns.map((column) => [column.toLowerCase(), column] as const));
  for (const candidate of ["sample", "sample_id", "sampleid", "sample_name", "samplename", "id"]) if (lower.has(candidate)) return lower.get(candidate)!;
  return columns[0] ?? null;
}

interface Resolved { sample: string; pair: DataReadPair | null; record: ReadsSource["records"][number] | null; how: "exact" | "normalised" | "confirmed" | "uploaded" | "record" | null; suggestions: SampleSuggestion[] }

/** Each name's reads: a confirmed match, the uploaded table, the exact name, the normalised name; else suggestions. */
export function resolveReads(names: string[], source: ReadsSource, pairing: SamplesStepConfig["pairing"]): Resolved[] {
  const byFile = new Map<string, DataReadPair>();
  for (const pair of source.pairs) {
    byFile.set(pair.r1.id, pair);
    byFile.set(pair.r1.name, pair);
    if (pair.r2) { byFile.set(pair.r2.id, pair); byFile.set(pair.r2.name, pair); }
  }
  const exact = new Map(source.pairs.map((pair) => [pair.sampleId, pair] as const));
  const loose = new Map<string, DataReadPair[]>();
  for (const pair of source.pairs) loose.set(normalizeSampleName(pair.sampleId), [...(loose.get(normalizeSampleName(pair.sampleId)) ?? []), pair]);
  const recordByLabel = new Map(source.records.map((record) => [record.label, record] as const));
  const recordLoose = new Map<string, ReadsSource["records"]>();
  for (const record of source.records) recordLoose.set(normalizeSampleName(record.label), [...(recordLoose.get(normalizeSampleName(record.label)) ?? []), record]);
  const confirmed = new Map(pairing.matched.map((match) => [match.sample, match] as const));
  const uploaded = new Map((pairing.uploaded?.rows ?? []).map((row) => [row.sample, row] as const));
  const used = new Map<string, string>();
  const out: Resolved[] = [];
  const suggestion = (pair: DataReadPair, how: SampleSuggestion["how"], words: string): SampleSuggestion => ({ files: [pair.r1.id, ...(pair.r2 ? [pair.r2.id] : [])], names: [pair.r1.name, ...(pair.r2 ? [pair.r2.name] : [])], sampleId: pair.sampleId, how, words });
  for (const sample of names) {
    const fromFiles = (files: string[]) => { for (const file of files) { const pair = byFile.get(file); if (pair) return pair; } return null; };
    let pair: DataReadPair | null = null, record: Resolved["record"] = null;
    let how: Resolved["how"] = null;
    const match = confirmed.get(sample);
    const row = uploaded.get(sample);
    if (match && (pair = fromFiles(match.files))) how = "confirmed";
    else if (row && (pair = fromFiles(row.files))) how = "uploaded";
    else if ((pair = exact.get(sample) ?? null)) how = "exact";
    else if ((record = recordByLabel.get(sample) ?? null)) how = "record";
    else {
      const key = normalizeSampleName(sample);
      const candidates = loose.get(key) ?? [];
      const records = recordLoose.get(key) ?? [];
      if (candidates.length === 1 && !records.length) { pair = candidates[0]; how = "normalised"; }
      else if (!candidates.length && records.length === 1) { record = records[0]; how = "record"; }
      else {
        // Third try: suggestions a person confirms. Two files with the same name read as two suggestions, never a pick.
        const suggestions = candidates.map((candidate) => suggestion(candidate, "same-name", sameNameWords(sample, candidate.sampleId)));
        if (!suggestions.length && key.length >= 3) {
          for (const candidate of source.pairs) {
            const other = normalizeSampleName(candidate.sampleId);
            if (other.length < 3) continue;
            const apart = distance(key, other, 1);
            if (apart === 1) suggestions.push(suggestion(candidate, "similar", "one character differs"));
            else if ((other.startsWith(key) || key.startsWith(other)) && Math.abs(other.length - key.length) <= 2) suggestions.push(suggestion(candidate, "similar", other.startsWith(key) ? "the file name goes on after it" : "the file name is shorter"));
            if (suggestions.length >= 3) break;
          }
        }
        out.push({ sample, pair: null, record: null, how: null, suggestions: suggestions.slice(0, 3) });
        continue;
      }
    }
    // One reads file pair serves one sample.
    const key = pair ? pair.sampleId : record ? `record:${record.readId}` : "";
    if (key && used.has(key)) {
      out.push({ sample, pair: null, record: null, how: null, suggestions: [] });
      continue;
    }
    if (key) used.set(key, sample);
    out.push({ sample, pair, record, how, suggestions: [] });
  }
  return out;
}

/** The sample list from the metadata, the reads and the configuration. Pure: everything it needs is passed in. */
export function buildSampleList(input: {
  config: SamplesStepConfig;
  metadata: { columns: string[]; rows: Array<Record<string, unknown>> } | null;
  reads: ReadsSource;
  /** The pipeline's samplesheet columns other than sample and reads, when it names them (condition). */
  samplesheetExtra?: string[];
}): SamplesListResult {
  const { config } = input;
  const columns = input.metadata?.columns ?? ["sample"];
  const sampleColumn = input.metadata ? sampleColumnOf(columns, config.metadata?.sampleColumn) : "sample";
  const sourceRows: Array<Record<string, unknown>> = input.metadata
    ? input.metadata.rows
    : [...input.reads.pairs.map((pair) => ({ sample: pair.sampleId })), ...input.reads.records.filter((record) => !input.reads.pairs.some((pair) => pair.sampleId === record.label)).map((record) => ({ sample: record.label }))];
  const problems: SamplesListResult["problems"] = [];
  // Filters, each counted alone and in order.
  let current = sourceRows;
  const rules: SamplesRule[] = config.filters.map((filter, index) => {
    const missingColumn = !columns.includes(filter.column);
    if (missingColumn) problems.push({ kind: "missing-column", words: `The metadata has no column ${filter.column}; the rule “${ruleWords(filter)}” keeps no samples.`, samples: [] });
    const count = sourceRows.filter((row) => rowPasses(row, filter)).length;
    current = current.filter((row) => rowPasses(row, filter));
    return { index, column: filter.column, op: filter.op, values: filter.values, words: ruleWords(filter), count, after: current.length, missingColumn };
  });
  const afterFilters = current.length;
  const nameOf = (row: Record<string, unknown>) => cellText(sampleColumn ? row[sampleColumn] : "");
  const exclusions = new Map(config.exclusions.map((exclusion) => [exclusion.sample, exclusion] as const));
  const filteredNames = new Set(current.map(nameOf));
  const leftOut = config.exclusions.map((exclusion) => ({ ...exclusion, inList: filteredNames.has(exclusion.sample) }));
  const kept = current.filter((row) => nameOf(row) && !exclusions.has(nameOf(row)));
  const resolved = resolveReads(kept.map(nameOf), input.reads, config.pairing);
  const resolvedBy = new Map(resolved.map((entry) => [entry.sample, entry] as const));
  const missing = resolved.filter((entry) => !entry.pair && !entry.record);
  const duplicates = missing.filter((entry) => !entry.suggestions.length && (input.reads.pairs.some((pair) => normalizeSampleName(pair.sampleId) === normalizeSampleName(entry.sample)) || input.reads.records.some((record) => normalizeSampleName(record.label) === normalizeSampleName(entry.sample))));
  if (duplicates.length) problems.push({ kind: "duplicate-file", words: `${plural(duplicates.length, "sample")} would read files another sample already reads: ${duplicates.slice(0, 4).map((entry) => entry.sample).join(", ")}`, samples: duplicates.map((entry) => entry.sample) });
  if (missing.length) problems.push({ kind: "no-reads", words: `${plural(missing.length, "sample")} ${missing.length === 1 ? "has" : "have"} no reads: ${missing.slice(0, 4).map((entry) => entry.sample).join(", ")}${missing.length > 4 ? ", …" : ""}`, samples: missing.map((entry) => entry.sample) });
  // Names, extra columns and the rows.
  const cleaned: SamplesListResult["cleaned"] = [];
  const extraValues = new Map<string, Set<string>>();
  const rows: SamplesListResult["rows"] = [];
  const pairs: SamplesListResult["pairs"] = [];
  const seen = new Map<string, string>();
  const duplicateNames: string[] = [];
  for (const row of kept) {
    const raw = nameOf(row);
    const entry = resolvedBy.get(raw);
    if (!entry || (!entry.pair && !entry.record)) continue;
    const name = config.cleanNames ? cleanSampleName(raw) : raw;
    if (name !== raw) cleaned.push({ from: raw, to: name });
    if (seen.has(name.toLowerCase())) { duplicateNames.push(raw); continue; }
    seen.set(name.toLowerCase(), raw);
    const out: Record<string, string> = {
      sample: name,
      fastq_1: entry.pair ? entry.pair.r1.name : `read record ${entry.record!.label}`,
      fastq_2: entry.pair ? entry.pair.r2?.name ?? "" : "",
    };
    for (const extra of config.extraColumns) {
      const value = cellText(row[extra.from]);
      const mapped = extra.map ? extra.map[value] : undefined;
      if (extra.map && mapped === undefined && value) extraValues.set(extra.name, new Set([...(extraValues.get(extra.name) ?? []), value]));
      out[extra.name] = mapped ?? value;
    }
    out.source_name = raw;
    rows.push(out);
    pairs.push({ sample: name, sampleId: entry.pair?.sampleId ?? entry.record!.label, files: entry.pair ? [entry.pair.r1.id, ...(entry.pair.r2 ? [entry.pair.r2.id] : [])] : [], how: entry.how! });
  }
  if (duplicateNames.length) problems.push({ kind: "duplicate-name", words: `${plural(duplicateNames.length, "sample")} would get a name another sample has: ${duplicateNames.slice(0, 4).join(", ")}`, samples: duplicateNames });
  if (!rows.length) problems.push({ kind: "no-samples", words: afterFilters ? "No sample on the list has reads yet." : "No samples are left after the filters.", samples: [] });
  const extra = config.extraColumns.map((column) => ({
    ...column, unmapped: [...(extraValues.get(column.name) ?? [])].slice(0, 20),
    words: `${column.name} ← ${column.from}${column.map ? ` · ${Object.entries(column.map).slice(0, 4).map(([from, to]) => `${from} → ${to}`).join(" · ")}` : ""}`,
  }));
  const outputColumns = ["sample", "fastq_1", "fastq_2", ...config.extraColumns.map((column) => column.name), "source_name"];
  const count = (how: Resolved["how"]) => pairs.filter((entry) => entry.how === how).length;
  const found = kept.length - missing.length;
  const removedByRules = rules.map((rule, index) => ({ count: (index === 0 ? sourceRows.length : rules[index - 1].after) - rule.after, reason: `not ${rule.words.replace(` ${rule.op} `, ` ${rule.op === "is" ? "is" : rule.op} `)}` }));
  const reasons: SamplesListResult["ledger"]["reasons"] = [
    ...removedByRules.filter((entry) => entry.count > 0).map((entry, index) => ({ count: entry.count, reason: `filtered out: ${config.filters[index] ? ruleWords(config.filters[index]) : entry.reason} does not hold`, axis: "rows" as const, keys: [] })),
    ...(leftOut.filter((entry) => entry.inList).length ? [{ count: leftOut.filter((entry) => entry.inList).length, reason: "left out by a person, with a reason", axis: "rows" as const, keys: leftOut.filter((entry) => entry.inList).map((entry) => entry.sample).slice(0, 50) }] : []),
    ...(missing.length ? [{ count: missing.length, reason: "no reads found", axis: "rows" as const, keys: missing.map((entry) => entry.sample).slice(0, 50) }] : []),
    ...(duplicateNames.length ? [{ count: duplicateNames.length, reason: "a name another sample has", axis: "rows" as const, keys: duplicateNames.slice(0, 50) }] : []),
  ];
  const added = config.extraColumns.map((column) => column.name);
  const words = [`${rows.length.toLocaleString("en-US")} of ${sourceRows.length.toLocaleString("en-US")}`, ...rules.map((rule) => rule.words), ...(added.length ? [`adds ${added.join(", ")}`] : [])].join(" · ");
  const numericColumns = new Set(columns.filter((column) => sourceRows.length && sourceRows.slice(0, 200).every((row) => cellText(row[column]) === "" || asNumber(row[column]) !== null)));
  return {
    total: sourceRows.length, sampleColumn,
    columns: columns.slice(0, 200).map((key) => {
      if (numericColumns.has(key) || key === sampleColumn) return { key, label: key, values: null, numeric: numericColumns.has(key) };
      const counts = new Map<string, number>();
      for (const row of sourceRows) { const value = cellText(row[key]); if (value) counts.set(value, (counts.get(value) ?? 0) + 1); }
      return { key, label: key, values: counts.size <= 60 ? [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, n]) => ({ value, count: n })) : null, numeric: false };
    }),
    rules, afterFilters, leftOut,
    reads: {
      found, of: kept.length, exact: count("exact"), normalised: count("normalised"), confirmed: count("confirmed"), uploaded: count("uploaded"),
      missing: missing.map((entry) => ({ sample: entry.sample, suggestions: entry.suggestions, words: entry.suggestions.length ? `${entry.suggestions[0].names[0].replace(/_R?1(_001)?\.(fastq|fq)(\.gz)?$/i, "")} · ${entry.suggestions[0].words}` : "no likely file" })),
      words: `${found.toLocaleString("en-US")} of ${kept.length.toLocaleString("en-US")} found`,
      how: "Matched to the samples by name, also without dashes, leading zeros and lane endings (A-01 ↔ A01_S1_L001)",
    },
    cleaned, extra, rows, pairs, outputColumns, problems,
    ledger: { label: "Samples", alias: input.metadata ? "metadata" : null, output: config.output, in: { rows: sourceRows.length, cols: columns.length }, out: { rows: rows.length, cols: outputColumns.length }, samples: { in: sourceRows.length, out: rows.length }, reasons },
    words,
  };
}

// ---------------------------------------------------------------------------
// The pipeline's samplesheet columns
// ---------------------------------------------------------------------------

/** The samplesheet a pipeline reads, in our names: sample, fastq_1, fastq_2 and any metadata columns it takes. */
export function samplesheetOf(pipelineId: string | null): { pipelineId: string | null; name: string | null; columns: string[]; own: string[]; required: string[] } {
  const pkg = pipelineId ? getPackage(pipelineId) : undefined;
  const sheet = pkg?.samplesheet?.samplesheet;
  if (!pkg || !sheet) return { pipelineId, name: pkg?.manifest.package.name ?? null, columns: ["sample", "fastq_1", "fastq_2"], own: ["sample", "fastq_1", "fastq_2"], required: ["sample", "fastq_1"] };
  const ours = (column: { name: string; source: string | null }) => column.source === "sample.sampleId" || column.source === "sample.sampleAlias" ? "sample" : column.source === "read.file1" ? "fastq_1" : column.source === "read.file2" ? "fastq_2" : column.name;
  return {
    pipelineId, name: pkg.manifest.package.name ?? pipelineId,
    columns: sheet.columns.map(ours), own: sheet.columns.map((column) => column.name),
    required: sheet.columns.filter((column) => column.required).map(ours),
  };
}

// ---------------------------------------------------------------------------
// Reading what the list is built from
// ---------------------------------------------------------------------------

export interface SamplesStepInputs {
  metadata: { datasetId: string; name: string; versionId: string; version: number; columns: string[]; rows: Array<Record<string, unknown>> } | null;
  reads: ReadsSource;
  /** What the reads were (file ids, names, sizes, records), for "the reads in Data changed since Run #2". */
  readsKey: string;
}

export async function loadSamplesInputs(model: RecipeModel, config: SamplesStepConfig): Promise<SamplesStepInputs> {
  const targetKey = model.flow.targetKey;
  const [{ files, pairs }, study] = await Promise.all([readsInData(targetKey), findDataStudy(targetKey)]);
  const records = study ? (await linkedReadRecords(study.id)).map((record) => ({ sampleId: record.sampleId, label: record.label, paired: record.paired, readId: record.readId })) : [];
  let metadata: SamplesStepInputs["metadata"] = null;
  if (config.metadata) {
    const dataset = model.datasets.get(config.metadata.datasetId);
    if (!dataset) throw flowError("invalid_request", "The metadata table of this step is gone from the study’s Data. Choose another one.");
    if (dataset.current) {
      const columns = parseSchema(dataset.current.schema).columns.map((column) => column.key);
      const rows = (await fetchAllDatasetRows(dataset.current.id)).map((row) => row.data as Record<string, unknown>);
      metadata = { datasetId: dataset.id, name: dataset.name, versionId: dataset.current.id, version: dataset.current.number, columns, rows };
    } else metadata = { datasetId: dataset.id, name: dataset.name, versionId: "", version: 0, columns: [], rows: [] };
  }
  const readsKey = canonicalJson({ files: files.map((file) => [file.id, file.name, file.sizeBytes]).sort(), records: records.map((record) => record.readId).sort() });
  return { metadata, reads: { pairs, records }, readsKey };
}

// ---------------------------------------------------------------------------
// The preview (the step sheet, the add form, Match by hand)
// ---------------------------------------------------------------------------

export interface SamplesPreview extends Omit<SamplesListResult, "rows" | "pairs"> {
  stepId: string | null;
  metadata: { datasetId: string; name: string; version: number; rows: number; sampleColumn: string | null } | null;
  /** The first rows of the list. */
  rows: Array<Record<string, string>>;
  rowCount: number;
  samplesheet: { pipelineId: string | null; name: string | null; columns: string[]; fits: boolean; missing: string[]; words: string };
  cleanNames: { on: boolean; changed: number; examples: Array<{ from: string; to: string }> };
  exclusions: SamplesExclusion[];
  pairing: { confirmed: number; uploaded: { name: string | null; rows: number; by: string | null; at: string } | null };
  /** The files in Data a person may pick for a sample (Match by hand › Pick files…), not yet used by another sample. */
  freeFiles: Array<{ id: string; name: string; sampleId: string }>;
}

const previewCache = new Map<string, { at: number; preview: SamplesPreview }>();

export async function samplesPreview(model: RecipeModel, config: SamplesStepConfig, stepId: string | null, options: { rows?: number } = {}): Promise<SamplesPreview> {
  const inputs = await loadSamplesInputs(model, config);
  const key = canonicalJson([model.flow.targetKey, stepId, samplesStepCode(config), config.exclusions, inputs.metadata?.versionId ?? null, inputs.readsKey, options.rows ?? 20]);
  const cached = previewCache.get(key);
  if (cached && Date.now() - cached.at < 30_000) return cached.preview;
  const sheet = samplesheetOf(config.forPipeline);
  const result = buildSampleList({ config, metadata: inputs.metadata, reads: inputs.reads, samplesheetExtra: sheet.columns.filter((column) => !["sample", "fastq_1", "fastq_2"].includes(column)) });
  const missingColumns = sheet.required.filter((column) => !result.outputColumns.includes(column));
  const used = new Set(result.pairs.map((entry) => entry.sampleId));
  const { rows, pairs: _pairs, ...rest } = result;
  void _pairs;
  const preview: SamplesPreview = {
    ...rest, stepId,
    metadata: inputs.metadata ? { datasetId: inputs.metadata.datasetId, name: inputs.metadata.name, version: inputs.metadata.version, rows: inputs.metadata.rows.length, sampleColumn: result.sampleColumn } : null,
    rows: rows.slice(0, Math.max(0, Math.min(options.rows ?? 20, 500))), rowCount: rows.length,
    samplesheet: {
      pipelineId: sheet.pipelineId, name: sheet.name, columns: sheet.columns, fits: !missingColumns.length && rows.length > 0, missing: missingColumns,
      words: !sheet.pipelineId ? `${plural(rows.length, "row")}` : missingColumns.length ? `${sheet.name} also needs ${missingColumns.join(", ")}` : `fits ${sheet.name}`,
    },
    cleanNames: { on: config.cleanNames, changed: result.cleaned.length, examples: result.cleaned.slice(0, 5) },
    exclusions: config.exclusions,
    pairing: { confirmed: config.pairing.matched.length, uploaded: config.pairing.uploaded ? { name: config.pairing.uploaded.name, rows: config.pairing.uploaded.rows.length, by: config.pairing.uploaded.by.name, at: config.pairing.uploaded.at } : null },
    freeFiles: inputs.reads.pairs.filter((pair) => !used.has(pair.sampleId)).slice(0, 500).map((pair) => ({ id: pair.r1.id, name: pair.r1.name, sampleId: pair.sampleId })),
  };
  previewCache.set(key, { at: Date.now(), preview });
  if (previewCache.size > 50) previewCache.delete(previewCache.keys().next().value!);
  return preview;
}

/** For tests. */
export function resetSamplesPreviewCache(): void { previewCache.clear(); }

// ---------------------------------------------------------------------------
// Adding and changing the step
// ---------------------------------------------------------------------------

export interface SamplesConfigInput {
  metadata?: { datasetId?: string | null; sampleColumn?: string | null } | null;
  forPipeline?: string | null;
  filters?: unknown;
  cleanNames?: boolean;
  withoutReads?: "leave-out" | "stop";
  extraColumns?: unknown;
  output?: string;
}

/** A samples step of a recipe with its parsed configuration, or a 4xx. */
export function samplesStepOf(model: RecipeModel, stepId: string): { step: RecipeStep; config: SamplesStepConfig } {
  const step = model.steps.find((entry) => entry.id === stepId);
  if (!step) throw flowError("not_found", "That step is not part of this flow.");
  if (step.stepKind !== "samples") throw flowError("invalid_request", "That step is not a Choose samples step.");
  return { step, config: parseSamplesConfig(step.pipeline) };
}

function metadataBinding(model: RecipeModel, config: SamplesStepConfig): AnalysisInputBinding[] {
  if (!config.metadata) return [];
  const dataset = model.datasets.get(config.metadata.datasetId);
  if (!dataset) throw flowError("invalid_request", "Choose a metadata table in this study’s Data.");
  return [{ alias: "metadata", datasetId: dataset.id, versionId: null }];
}

function checkColumns(config: SamplesStepConfig, model: RecipeModel): void {
  const dataset = config.metadata ? model.datasets.get(config.metadata.datasetId) : null;
  const columns = dataset?.current ? parseSchema(dataset.current.schema).columns.map((column) => column.key) : null;
  if (!columns) return;
  for (const filter of config.filters) if (!columns.includes(filter.column)) throw flowError("invalid_request", `The metadata has no column ${filter.column}.`);
  for (const extra of config.extraColumns) {
    if (!columns.includes(extra.from)) throw flowError("invalid_request", `The metadata has no column ${extra.from}.`);
    if (["sample", "fastq_1", "fastq_2", "source_name"].includes(extra.name)) throw flowError("invalid_request", `${extra.name} is already a column of the sample list.`);
  }
  if (new Set(config.extraColumns.map((extra) => extra.name)).size !== config.extraColumns.length) throw flowError("invalid_request", "Two added columns have the same name.");
  if (config.metadata?.sampleColumn && !columns.includes(config.metadata.sampleColumn)) throw flowError("invalid_request", `The metadata has no column ${config.metadata.sampleColumn}.`);
}

/** The configuration a person sent, merged over the current one (fields left out stay as they are). */
export function mergeSamplesConfig(current: SamplesStepConfig, input: SamplesConfigInput): SamplesStepConfig {
  const next = parseSamplesConfig({ ...current, ...(input.filters !== undefined ? { filters: input.filters } : {}), ...(input.extraColumns !== undefined ? { extraColumns: input.extraColumns } : {}) });
  if (input.metadata !== undefined) next.metadata = input.metadata?.datasetId ? { datasetId: input.metadata.datasetId, sampleColumn: input.metadata.sampleColumn ?? null } : null;
  if (input.forPipeline !== undefined) next.forPipeline = input.forPipeline || null;
  if (typeof input.cleanNames === "boolean") next.cleanNames = input.cleanNames;
  if (input.withoutReads === "leave-out" || input.withoutReads === "stop") next.withoutReads = input.withoutReads;
  if (input.output && /^[a-z][a-z0-9_]{0,59}$/.test(input.output)) next.output = input.output;
  return next;
}

/** "212 of 708 · Diagnosis is Adenoma or Normal · adds condition" without counts (before anything ran). */
export function samplesConfigWords(config: SamplesStepConfig): string {
  return [...config.filters.map(ruleWords), ...(config.extraColumns.length ? [`adds ${config.extraColumns.map((column) => column.name).join(", ")}`] : [])].join(" · ") || "every sample with reads";
}

/** The step's sample list table, created empty when missing (written when the step runs). */
async function ensureListDataset(model: RecipeModel, step: { id: string; name: string }, config: SamplesStepConfig, userId: string): Promise<string> {
  const existing = [...model.datasets.values()].find((dataset) => dataset.producer === step.id && dataset.artifactName === config.output);
  if (existing) return existing.id;
  const dataset = await db.exploreDataset.create({
    data: {
      targetKey: model.flow.targetKey, kind: "derived", tableKind: "sample-summary", name: `${config.output} (${step.name})`.slice(0, 200),
      description: `The sample list ${step.name} writes when it runs: sample, fastq_1, fastq_2, its added columns and source_name.`.slice(0, 1000),
      sensitivity: "standard", createdById: userId, roles: JSON.stringify({ sample: "sample" }),
      sourceConfig: JSON.stringify({ builder: "analysis-run", analysisId: step.id, artifactName: config.output, samplesStep: true }),
    },
  });
  model.datasets.set(dataset.id, { id: dataset.id, name: dataset.name, kind: "derived", tableKind: "sample-summary", roles: dataset.roles, sensitivity: "standard", currentVersionId: null, producer: step.id, artifactName: config.output, current: null });
  return dataset.id;
}

export interface AddSamplesStepInput { config?: SamplesConfigInput | null; after?: string | null; name?: string | null; requestId?: string; actor: RecipeActor & { name?: string | null } }

/** Add a Choose samples step: its metadata table bound as `metadata`, its sample list declared at once. */
export async function addSamplesStep(flowId: string, input: AddSamplesStepInput): Promise<string> {
  await requirePipelineSteps();
  if (input.requestId) {
    const existing = await db.exploreAnalysis.findUnique({ where: { id: input.requestId }, select: { id: true, flowId: true } });
    if (existing) {
      if (existing.flowId !== flowId) throw flowError("invalid_request", "This request ID belongs to another step.");
      return existing.id;
    }
  }
  const model = await loadRecipe(flowId);
  if (!model) throw flowError("not_found", "Flow not found");
  const config = mergeSamplesConfig(defaultSamplesConfig(), input.config ?? {});
  if (config.forPipeline && !getPackage(config.forPipeline)) config.forPipeline = config.forPipeline.slice(0, 120);
  checkColumns(config, model);
  const ordered = sortSteps(model.steps);
  let position: string;
  if (input.after) {
    const index = ordered.findIndex((step) => step.id === input.after);
    if (index < 0) throw flowError("invalid_request", "after must name a step of this flow.");
    position = keyBetween(ordered[index].position, ordered[index + 1]?.position ?? null);
  } else position = keyBetween("", ordered[0]?.position ?? null); // without `after`: the first step (it chooses what the others read)
  const taken = new Set([...model.datasets.values()].filter((dataset) => dataset.producer).map((dataset) => dataset.artifactName ?? ""));
  for (let n = 2; taken.has(config.output); n += 1) config.output = `${SAMPLES_OUTPUT}_${n}`;
  const analysis = await createAnalysis({
    targetKey: model.flow.targetKey, flowId, name: input.name?.trim() || "Choose samples", language: "shell", environmentName: "samples",
    inputs: metadataBinding(model, config), params: {}, createdById: input.actor.userId, createdByMemberId: input.actor.memberId ?? null, position,
    purpose: samplesConfigWords(config).slice(0, 200), id: input.requestId, code: samplesStepCode(config), stepKind: "samples", pipeline: config as unknown as Prisma.InputJsonValue,
  });
  const fresh = await loadRecipe(flowId);
  const step = fresh?.steps.find((entry) => entry.id === analysis.id);
  if (fresh && step) await ensureListDataset(fresh, step, config, input.actor.userId);
  return analysis.id;
}

/** Write a new revision of a samples step (nothing runs). Returns false when nothing changed. */
export async function reviseSamplesStep(flowId: string, stepId: string, change: (config: SamplesStepConfig, model: RecipeModel, step: RecipeStep) => SamplesStepConfig, input: { expectedRevisionId?: string; message: string; actor: RecipeActor }): Promise<boolean> {
  await requirePipelineSteps();
  const model = await loadRecipe(flowId);
  if (!model) throw flowError("not_found", "Flow not found");
  const { step, config } = samplesStepOf(model, stepId);
  if (input.expectedRevisionId && step.revision && input.expectedRevisionId !== step.revision.id) {
    throw flowError("step_conflict", "This step changed in another session. Reopen it before changing it.", { stepId, current: { revisionId: step.revision.id } });
  }
  const next = change(parseSamplesConfig(config), model, step);
  checkColumns(next, model);
  if (canonicalJson(next) === canonicalJson(config)) return false;
  try {
    await createRevision({
      analysisId: stepId, expectedRevisionId: step.revision?.id, code: samplesStepCode(next), params: {}, inputs: metadataBinding(model, next), pipeline: next as unknown as Prisma.InputJsonValue,
      author: "user", authorUserId: input.actor.userId, authorMemberId: input.actor.memberId ?? null, message: input.message,
    });
  } catch (error) {
    if (error instanceof RevisionConflict) throw flowError("step_conflict", error.message, { stepId });
    throw error;
  }
  if (next.output !== config.output) {
    const fresh = await loadRecipe(flowId);
    const updated = fresh?.steps.find((entry) => entry.id === stepId);
    if (fresh && updated) await ensureListDataset(fresh, updated, next, input.actor.userId);
  }
  return true;
}

export async function updateSamplesStep(flowId: string, stepId: string, input: SamplesConfigInput & { expectedRevisionId?: string; actor: RecipeActor }): Promise<boolean> {
  return reviseSamplesStep(flowId, stepId, (config) => mergeSamplesConfig(config, input), { expectedRevisionId: input.expectedRevisionId, actor: input.actor, message: "Changed which samples are chosen" });
}

const now = () => new Date().toISOString();
const by = (actor: RecipeActor & { name?: string | null }): SamplePerson => ({ userId: actor.userId, memberId: actor.memberId ?? null, name: actor.name ?? null });

/** Match by hand: confirm suggestions or picked files for samples, and leave others out with a reason. */
export async function confirmSampleMatches(flowId: string, stepId: string, input: { confirm?: Array<{ sample: string; files: string[] }>; leaveOut?: Array<{ sample: string; reason?: string | null }>; expectedRevisionId?: string; actor: RecipeActor & { name?: string | null } }): Promise<boolean> {
  return reviseSamplesStep(flowId, stepId, (config) => {
    const next = parseSamplesConfig(config);
    for (const match of input.confirm ?? []) {
      const files = match.files.filter((file) => typeof file === "string" && file).slice(0, 2);
      if (!match.sample || !files.length) throw flowError("invalid_request", "Each match needs a sample and its files.");
      next.pairing.matched = [...next.pairing.matched.filter((entry) => entry.sample !== match.sample), { sample: match.sample, files, by: by(input.actor), at: now() }];
    }
    for (const leave of input.leaveOut ?? []) {
      if (!leave.sample) continue;
      next.exclusions = [...next.exclusions.filter((entry) => entry.sample !== leave.sample), { sample: leave.sample, reason: (leave.reason ?? "").trim().slice(0, 500) || "No reads found", stage: "before", by: by(input.actor), at: now(), stepId: null }];
    }
    return next;
  }, { expectedRevisionId: input.expectedRevisionId, actor: input.actor, message: [input.confirm?.length ? `Matched ${plural(input.confirm.length, "sample")} by hand` : "", input.leaveOut?.length ? `left out ${plural(input.leaveOut.length, "sample")}` : ""].filter(Boolean).join(", ") || "Matched by hand" });
}

/** "sample,file\nA-17,A17_S12_L001_R1_001.fastq.gz" or rows: the uploaded sample → file table, resolved to Data files. */
export function parseMappingRows(input: { rows?: unknown; csv?: unknown }): Array<{ sample: string; files: string[] }> {
  if (Array.isArray(input.rows)) {
    return input.rows.slice(0, 20000).flatMap((entry) => {
      const row = rec(entry);
      const sample = text(row.sample, 300);
      const files = [row.file, row.file1, row.fastq_1, row.file2, row.fastq_2, ...(Array.isArray(row.files) ? row.files : [])].map((file) => text(file, 300)).filter((file): file is string => Boolean(file));
      return sample && files.length ? [{ sample, files: [...new Set(files)].slice(0, 2) }] : [];
    });
  }
  const csv = typeof input.csv === "string" ? input.csv : "";
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const split = (line: string) => line.split(lines[0].includes("\t") ? "\t" : ",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
  const header = split(lines[0]).map((cell) => cell.toLowerCase());
  const sampleAt = header.findIndex((cell) => ["sample", "sample_id", "sampleid", "name"].includes(cell));
  const fileAt = header.map((cell, index) => (/^(file|file1|file2|fastq_1|fastq_2|fastq|r1|r2|reads)$/.test(cell) ? index : -1)).filter((index) => index >= 0);
  if (sampleAt < 0 || !fileAt.length) throw flowError("invalid_request", "The table needs the columns sample and file.");
  return lines.slice(1, 20001).flatMap((line) => {
    const cells = split(line);
    const sample = cells[sampleAt];
    const files = fileAt.map((index) => cells[index]).filter(Boolean);
    return sample && files.length ? [{ sample, files: [...new Set(files)].slice(0, 2) }] : [];
  });
}

/** Keep an uploaded sample → file table on the step; rows whose files are not in Data are returned, not kept. */
export async function uploadSampleMapping(flowId: string, stepId: string, input: { rows?: unknown; csv?: unknown; name?: string | null; expectedRevisionId?: string; actor: RecipeActor & { name?: string | null } }): Promise<{ changed: boolean; unknown: Array<{ sample: string; files: string[] }>; kept: number }> {
  const model = await loadRecipe(flowId);
  if (!model) throw flowError("not_found", "Flow not found");
  const parsed = parseMappingRows(input);
  if (!parsed.length) throw flowError("invalid_request", "The table has no rows with a sample and a file.");
  const { files } = await readsInData(model.flow.targetKey);
  const byName = new Map(files.map((file) => [file.name, file.id] as const));
  const byId = new Set(files.map((file) => file.id));
  const unknown: Array<{ sample: string; files: string[] }> = [];
  const rows = parsed.flatMap((row) => {
    const ids = row.files.map((file) => (byId.has(file) ? file : byName.get(file) ?? byName.get(file.split("/").pop() ?? "") ?? null));
    if (ids.some((id) => !id)) { unknown.push(row); return []; }
    return [{ sample: row.sample, files: ids as string[] }];
  });
  const changed = await reviseSamplesStep(flowId, stepId, (config) => ({ ...parseSamplesConfig(config), pairing: { ...config.pairing, uploaded: rows.length ? { name: text(input.name, 200), rows, by: by(input.actor), at: now() } : null } }),
    { expectedRevisionId: input.expectedRevisionId, actor: input.actor, message: `Uploaded a sample → file table (${plural(rows.length, "row")})` });
  return { changed, unknown, kept: rows.length };
}

export async function removeSampleMapping(flowId: string, stepId: string, input: { expectedRevisionId?: string; actor: RecipeActor }): Promise<boolean> {
  return reviseSamplesStep(flowId, stepId, (config) => ({ ...parseSamplesConfig(config), pairing: { ...config.pairing, uploaded: null } }), { expectedRevisionId: input.expectedRevisionId, actor: input.actor, message: "Removed the uploaded sample → file table" });
}

/** Leave samples out (with a reason, a person and a date) or take them back. */
export async function changeSampleExclusions(flowId: string, stepId: string, input: { add?: Array<{ sample: string; reason?: string | null; stage?: ExclusionStage; stepId?: string | null }>; remove?: string[]; expectedRevisionId?: string; actor: RecipeActor & { name?: string | null } }): Promise<boolean> {
  return reviseSamplesStep(flowId, stepId, (config) => applyExclusions(parseSamplesConfig(config), input), {
    expectedRevisionId: input.expectedRevisionId, actor: input.actor,
    message: [input.add?.length ? `Left out ${input.add.map((entry) => entry.sample).slice(0, 3).join(", ")}${input.add.length > 3 ? ", …" : ""}` : "", input.remove?.length ? `took back ${input.remove.slice(0, 3).join(", ")}` : ""].filter(Boolean).join("; ") || "Changed the samples left out",
  });
}

/** The exclusions after adding and removing some (pure; a sample left out again keeps the newest reason). */
export function applyExclusions(config: SamplesStepConfig, input: { add?: Array<{ sample: string; reason?: string | null; stage?: ExclusionStage; stepId?: string | null; tables?: SamplesExclusion["tables"] }>; remove?: string[]; actor: RecipeActor & { name?: string | null } }): SamplesStepConfig {
  const remove = new Set(input.remove ?? []);
  const added = (input.add ?? []).filter((entry) => entry.sample);
  const replaced = new Set(added.map((entry) => entry.sample));
  return {
    ...config,
    exclusions: [
      ...config.exclusions.filter((entry) => !remove.has(entry.sample) && !replaced.has(entry.sample)),
      ...added.map((entry) => ({ sample: entry.sample, reason: (entry.reason ?? "").trim().slice(0, 500) || "Left out", stage: entry.stage ?? "before", by: by(input.actor), at: now(), stepId: entry.stepId ?? null, ...(entry.tables?.length ? { tables: entry.tables } : {}) })),
    ],
  };
}

// ---------------------------------------------------------------------------
// Running the step inside a recipe run
// ---------------------------------------------------------------------------

/** The parts of a plan entry this module reads (flow-runs.ts PlanEntry). */
export interface SamplesEntry { analysisId: string; label: string; name: string; revisionId: string }
export interface SamplesRunSnapshot {
  rows: number; total: number; afterFilters: number; found: number; missing: string[]; cleaned: number; leftOut: number;
  readsKey: string; words: string; output: { name: string; datasetId: string | null; versionId: string | null; version: number | null; rows: number };
  /** The list's sample → the pair sample id (as Data names it), for the pipeline step that reads it. */
  pairs: Array<{ sample: string; sampleId: string }>;
}

const STEP_ACTIVE = ["pending", "queued", "running"];
function isUnique(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002"); }

/**
 * Run a samples step of a recipe run: build the list from the metadata version and the reads now, write it as a new
 * version of the step's table and settle at once. Idempotent per recipe run (`fr_<run>_<step>`); a step run another
 * process claimed and left pending is taken over after two minutes. Returns null when another process has it.
 */
export async function runSamplesStep(run: { id: string; startedById: string; kind: string }, entry: SamplesEntry, targetKey: string, flowId: string): Promise<{ settled: boolean } | null> {
  const id = `fr_${run.id}_${entry.analysisId}`.slice(0, 120);
  let claimed = false;
  try {
    await db.exploreAnalysisRun.create({ data: { id, analysisId: entry.analysisId, revisionId: entry.revisionId, runNumber: await allocateRunNumber(), status: "running", executionMode: "samples", createdById: run.startedById, flowRunId: run.id, stepLabel: entry.label, trial: run.kind === "trial", queuedAt: new Date(), startedAt: new Date() } });
    claimed = true;
  } catch (error) {
    if (!isUnique(error)) throw error;
  }
  if (!claimed) {
    const existing = await db.exploreAnalysisRun.findUnique({ where: { id }, select: { status: true, createdAt: true } });
    if (!existing || !STEP_ACTIVE.includes(existing.status) || Date.now() - existing.createdAt.getTime() < 120_000) return null;
  }
  const fail = async (words: string) => {
    await db.exploreAnalysisRun.updateMany({ where: { id, status: { in: STEP_ACTIVE } }, data: { status: "failed", completedAt: new Date(), errorTail: words.slice(0, 4000) } });
    return { settled: true };
  };
  try {
    const revision = await db.exploreAnalysisRevision.findUnique({ where: { id: entry.revisionId } });
    const config = parseSamplesConfig((revision as { pipeline?: unknown } | null)?.pipeline);
    const model = await loadRecipe(flowId);
    if (!model) return fail(`Step ${entry.label}: the analysis is gone.`);
    const inputs = await loadSamplesInputs(model, config);
    if (config.metadata && !inputs.metadata?.versionId) return fail(`Step ${entry.label} (${entry.name}): the metadata table has no rows yet.`);
    const sheet = samplesheetOf(config.forPipeline);
    const result = buildSampleList({ config, metadata: inputs.metadata, reads: inputs.reads, samplesheetExtra: sheet.columns.filter((column) => !["sample", "fastq_1", "fastq_2"].includes(column)) });
    const missing = result.reads.missing.map((entry) => entry.sample);
    if (config.withoutReads === "stop" && missing.length) return fail(`Step ${entry.label} (${entry.name}): ${plural(missing.length, "sample")} ${missing.length === 1 ? "has" : "have"} no reads (${missing.slice(0, 4).join(", ")}${missing.length > 4 ? ", …" : ""}). Match ${missing.length === 1 ? "it" : "them"} by hand or leave ${missing.length === 1 ? "it" : "them"} out.`);
    const duplicate = result.problems.find((problem) => problem.kind === "duplicate-name");
    if (duplicate) return fail(`Step ${entry.label} (${entry.name}): ${duplicate.words}. Change a name or leave one out.`);
    if (!result.rows.length) return fail(`Step ${entry.label} (${entry.name}): ${result.problems.find((problem) => problem.kind === "no-samples")?.words ?? "the list is empty."}`);
    const step = model.steps.find((candidate) => candidate.id === entry.analysisId);
    const datasetId = await ensureListDataset(model, { id: entry.analysisId, name: step?.name ?? entry.name }, config, run.startedById);
    const schema: ExploreSchema = { columns: result.outputColumns.map((key) => ({ key, label: key === "source_name" ? "Name in the metadata" : key, type: "string" as const, ...(key === "sample" ? { role: "sample" as const } : {}) })) };
    const version = await writeDatasetVersion({
      datasetId, schema, rows: result.rows as unknown as ExploreRowData[], buildSource: "analysis-run", createdById: run.startedById, keys: { sample: "sample" },
      provenance: { builtAt: new Date().toISOString(), builder: "samples-step@1", sources: inputs.metadata ? [{ type: "dataset-version", id: inputs.metadata.versionId, label: `${inputs.metadata.name} v${inputs.metadata.version}` }] : [], notes: [result.words, result.reads.words] },
    });
    const snapshot: SamplesRunSnapshot = {
      rows: result.rows.length, total: result.total, afterFilters: result.afterFilters, found: result.reads.found, missing, cleaned: result.cleaned.length, leftOut: result.leftOut.filter((entry) => entry.inList).length,
      readsKey: inputs.readsKey, words: result.words, output: { name: config.output, datasetId, versionId: version.versionId, version: version.number, rows: version.rowCount },
      pairs: (await samplePairs(model, config, inputs, result)).slice(0, 20000),
    };
    const pins = inputs.metadata ? [{ alias: "metadata", datasetId: inputs.metadata.datasetId, versionId: inputs.metadata.versionId, versionNumber: inputs.metadata.version, name: inputs.metadata.name, rowCount: inputs.metadata.rows.length }] : [];
    await db.exploreAnalysisRun.updateMany({
      where: { id, status: { in: STEP_ACTIVE } },
      data: {
        status: "completed", completedAt: new Date(), exitCode: 0, ...(pins.length ? { inputPins: pins as unknown as Prisma.InputJsonValue } : {}),
        results: JSON.stringify({ samples: snapshot, metrics: { samples: result.rows.length }, metricMeta: { samples: { label: "Samples on the list" } }, ledger: [result.ledger], tables: 1, warnings: result.problems.filter((problem) => problem.kind !== "no-samples").map((problem) => problem.words) }),
      },
    });
    return { settled: true };
  } catch (error) {
    return fail(`Step ${entry.label} (${entry.name}) could not make the sample list: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function samplePairs(_model: RecipeModel, _config: SamplesStepConfig, _inputs: SamplesStepInputs, result: SamplesListResult): Promise<SamplesRunSnapshot["pairs"]> {
  return result.pairs.map((entry) => ({ sample: entry.sample, sampleId: entry.sampleId }));
}

export function samplesSnapshotOf(results: string | null | undefined): SamplesRunSnapshot | null {
  const value = rec(parseJsonObject(results)).samples;
  return value && typeof value === "object" ? (value as SamplesRunSnapshot) : null;
}

// ---------------------------------------------------------------------------
// What the recipe shows of a samples step
// ---------------------------------------------------------------------------

export interface SamplesStepView {
  config: SamplesStepConfig;
  /** "212 of 708 · Diagnosis is Adenoma or Normal · adds condition" (counts from the list now). */
  words: string;
  kept: number | null;
  total: number | null;
  reads: { found: number; of: number; missing: string[] } | null;
  cleaned: number;
  exclusions: SamplesExclusion[];
  output: { name: string; datasetId: string | null; version: number | null; columns: string[] };
  samplesheet: { pipelineId: string | null; name: string | null; columns: string[]; fits: boolean; words: string } | null;
  problems: SamplesListResult["problems"];
  /** The viewed run's list, when it ran. */
  run: { rows: number; version: number | null; at: string | null } | null;
}

/** The `samples` object of a samples step in the recipe: its configuration and the list as it would be made now. */
export async function samplesStepView(model: RecipeModel, step: RecipeStep, viewedResults: string | null | undefined): Promise<SamplesStepView> {
  const config = parseSamplesConfig(step.pipeline);
  const dataset = [...model.datasets.values()].find((candidate) => candidate.producer === step.id && candidate.artifactName === config.output);
  const run = samplesSnapshotOf(viewedResults);
  let preview: SamplesPreview | null = null;
  try { preview = await samplesPreview(model, config, step.id, { rows: 0 }); } catch { preview = null; }
  return {
    config, words: preview?.words ?? samplesConfigWords(config), kept: preview?.rowCount ?? null, total: preview?.total ?? null,
    reads: preview ? { found: preview.reads.found, of: preview.reads.of, missing: preview.reads.missing.map((entry) => entry.sample) } : null,
    cleaned: preview?.cleanNames.changed ?? 0, exclusions: config.exclusions,
    output: { name: config.output, datasetId: dataset?.id ?? null, version: dataset?.current?.number ?? null, columns: preview?.outputColumns ?? ["sample", "fastq_1", "fastq_2", ...config.extraColumns.map((column) => column.name), "source_name"] },
    samplesheet: preview ? { pipelineId: preview.samplesheet.pipelineId, name: preview.samplesheet.name, columns: preview.samplesheet.columns, fits: preview.samplesheet.fits, words: preview.samplesheet.words } : null,
    problems: preview?.problems ?? [],
    run: run ? { rows: run.rows, version: run.output.version, at: null } : null,
  };
}

/** The samples left out during or after a run of a pipeline step, recorded in the samples step that makes its list. */
export function laterExclusions(config: SamplesStepConfig): SamplesExclusion[] {
  return config.exclusions.filter((exclusion) => exclusion.stage !== "before");
}
