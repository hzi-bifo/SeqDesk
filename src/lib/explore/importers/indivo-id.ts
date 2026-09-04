/**
 * Port of the INDIVO Explorer sample-id grammar (`indivo_common.py`).
 *
 *   {specimen}_{depletion}_{typecode}_D{day}[replicate]
 *
 * Examples: A001_hd_U_D463, A109_U_D1212a, A242_Encasseliflavus_nd_A_D1801,
 * A280=Escherichia.coli_nd_U_D2263. The specimen prefix is the subject.
 */
import type { ExploreRowData } from "../types";

const RE_DAY = /_D(\d+)([A-Za-z]{0,2})$/;
const RE_DEPLETION = /^(hd|nd|zymo)([-+].+)?$/;
const ENV_CONTROL_TOKENS = [
  "soil", "water", "nacl", "control", "standard", "mock", "buffer",
  "zymo", "shield", "pbs", "ampure", "matrix", "spike", "moisten", "blank",
];

export interface ParsedIndivoId {
  specimen: string;
  subject: string;
  depletion: string;
  timepoint: number | null;
  replicate: string;
  sampletypeCode: string;
  sampletype: string;
  cohort: "clinical" | "control";
  isolateLabel: string | null;
}

function isDepletionToken(token: string): boolean {
  return RE_DEPLETION.test(token);
}

function splitIdTokens(id: string): { depletion: string | null; rest: string[] } {
  const base = id.replace(RE_DAY, "");
  const rest = base.split("_").slice(1);
  if (rest.length && isDepletionToken(rest[0])) return { depletion: rest[0], rest: rest.slice(1) };
  for (let index = 1; index < rest.length; index += 1) {
    if (isDepletionToken(rest[index]) && rest.length > index + 1) {
      return { depletion: rest[index], rest: rest.slice(index + 1) };
    }
  }
  return { depletion: null, rest };
}

export function parseSpecimen(id: string): string {
  return id.split("_")[0] ?? "";
}

export function parseDepletionCode(id: string): string {
  const { depletion } = splitIdTokens(id);
  if (depletion) {
    const match = RE_DEPLETION.exec(depletion);
    if (match) return match[1];
  }
  return "unknown";
}

export function normalizeDepletion(value: unknown): string {
  if (value === null || value === undefined) return "unknown";
  const match = RE_DEPLETION.exec(String(value).trim().toLowerCase());
  return match ? match[1] : "unknown";
}

export function parseRelDay(id: string): number | null {
  const match = RE_DAY.exec(id);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function parseReplicate(id: string): string {
  const match = RE_DAY.exec(id);
  return match && match[2] ? match[2] : "";
}

export function parseSampletypeCode(id: string): string {
  const { rest } = splitIdTokens(id);
  return rest.length ? rest.join("_") : "";
}

export function normalizeSampletype(sample: unknown, id: string): string {
  const text = sample === null || sample === undefined ? "" : String(sample).trim();
  const lower = text.toLowerCase();
  const code = parseSampletypeCode(id);
  if (lower.startsWith("urine")) return "Urine";
  if (lower.startsWith("ascites")) return "Ascites";
  if (lower.startsWith("bal")) return "BAL";
  if (lower.startsWith("trachea")) return "Trachea";
  const blob = `${text} ${code}`.toLowerCase();
  if (ENV_CONTROL_TOKENS.some((token) => blob.includes(token))) return "Control/Env";
  const upper = code.toUpperCase();
  if (upper.startsWith("U")) return "Urine";
  if (code && upper[0] === "A" && !upper.startsWith("AMPURE")) return "Ascites";
  if (upper.startsWith("BAL")) return "BAL";
  if (code.toLowerCase().startsWith("trachea")) return "Trachea";
  return "Unknown";
}

export function classifyCohort(sampletype: string): "clinical" | "control" {
  return sampletype === "Control/Env" ? "control" : "clinical";
}

/** The base subject id of a specimen that embeds an isolate label (A226=Ecoli -> A226). */
export function isolateBaseSubject(specimen: string): string {
  return specimen.split("=")[0] ?? specimen;
}

export function parseIndivoId(id: string, sample?: unknown, explicitDepletion?: unknown): ParsedIndivoId {
  const specimen = parseSpecimen(id);
  let depletion = parseDepletionCode(id);
  if (depletion === "unknown" && explicitDepletion !== undefined) depletion = normalizeDepletion(explicitDepletion);
  const sampletype = normalizeSampletype(sample, id);
  const isolateLabel = specimen.includes("=") ? specimen.slice(specimen.indexOf("=") + 1) : null;
  return {
    specimen,
    subject: isolateBaseSubject(specimen),
    depletion,
    timepoint: parseRelDay(id),
    replicate: parseReplicate(id),
    sampletypeCode: parseSampletypeCode(id),
    sampletype,
    cohort: classifyCohort(sampletype),
    isolateLabel,
  };
}

export interface IndivoGrammarOptions {
  idColumn: string;
  sampleTypeColumn?: string | null;
  depletionColumn?: string | null;
  isolateColumn?: string | null;
}

export const INDIVO_DERIVED_COLUMNS = [
  "subject",
  "timepoint",
  "specimen_type",
  "depletion_protocol",
  "replicate",
  "cohort",
  "is_isolate",
] as const;

/**
 * Add the derived columns to every row. Existing columns with the same key
 * are left untouched so a workbook that already carries them wins.
 */
export function applyIndivoGrammar(rows: ExploreRowData[], options: IndivoGrammarOptions): ExploreRowData[] {
  return rows.map((row) => {
    const rawId = row[options.idColumn];
    if (rawId === null || rawId === undefined) return row;
    const id = String(rawId);
    const parsed = parseIndivoId(
      id,
      options.sampleTypeColumn ? row[options.sampleTypeColumn] : undefined,
      options.depletionColumn ? row[options.depletionColumn] : undefined
    );
    const isolateFlag = options.isolateColumn ? row[options.isolateColumn] : null;
    const isIsolate =
      isolateFlag === true || isolateFlag === 1 || isolateFlag === "1" || String(isolateFlag).toLowerCase() === "true"
        ? true
        : isolateFlag === false || isolateFlag === 0 || isolateFlag === "0" || String(isolateFlag).toLowerCase() === "false"
          ? false
          : parsed.isolateLabel !== null;
    const derived: ExploreRowData = {
      subject: parsed.subject,
      timepoint: parsed.timepoint,
      specimen_type: parsed.sampletype,
      depletion_protocol: parsed.depletion,
      replicate: parsed.replicate,
      cohort: parsed.cohort,
      is_isolate: isIsolate,
    };
    const out: ExploreRowData = { ...row };
    for (const [key, value] of Object.entries(derived)) {
      if (!(key in out)) out[key] = value;
    }
    return out;
  });
}
