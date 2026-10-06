/**
 * Pipelines as recipe steps (explore.pipeline-steps, Web/design/continual/PIPELINE-STEPS-PLAN.md). A SeqDesk pipeline
 * sits in a recipe as one step: an ExploreAnalysis with stepKind "pipeline" whose revision keeps
 * {pipelineId, version, params, samples, outputs, presetId?, pinnedRunId?, requestId?} in `pipeline`. Its code is the
 * canonical JSON of everything but the settings, so a settings edit reads `paramChanged` and a version or sample-list
 * change `codeChanged`, with the recipe's out-of-date logic unchanged. Its outputs are declared when it is added, from
 * the manifest's table outputs, as the step's own tables; the steps after it read them like any step output.
 *
 * Running it lives in pipeline-step-runs.ts. Everything here is written so that a server whose Prisma client or
 * database predates the migration keeps working: code steps never touch the new columns, and the feature reports
 * itself off (pipelineStepsAvailable) until both have them.
 */
import { createHash } from "node:crypto";
import fs from "fs/promises";
import path from "path";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import { PIPELINE_REGISTRY } from "@/lib/pipelines/registry";
import { getPackage, type LoadedPackage, type PackageOutputTable } from "@/lib/pipelines/package-loader";
import { getPipelineEnabled } from "@/lib/pipelines/enablement";
import { getStepsForPipeline } from "@/lib/pipelines/definitions";
import { getExecutionSettings } from "@/lib/pipelines/execution-settings";
import { getPipelineDatabaseStatuses } from "@/lib/pipelines/database-downloads";
import { parsePipelineConfig as parseStoredPipelineConfig } from "@/lib/pipelines/pipeline-readiness-service";
import { pipelineConfigOverrideIssues, validatePipelineConfigSchema } from "@/lib/pipelines/config-schema-validation";
import { pipelineRequiresPairedReads } from "@/lib/pipelines/read-mode";
import { findDataStudy, linkedReadRecords, readsInData, type DataReadPair } from "@/lib/pipelines/data-study";
import { pastDurations } from "@/lib/pipelines/pipeline-data-service";
import { durationWords } from "@/lib/pipelines/plain-status";
import type { PipelineConfigProperty, PipelineDefinition } from "@/lib/pipelines/types";
import { knownPipelineTable } from "./pipeline-tables";
import { createAnalysis, createRevision, RevisionConflict, type AnalysisInputBinding } from "./analyses";
import { loadRecipe, type RecipeActor, type RecipeModel, type RecipeStep, type StepRecord } from "./recipe";
import { keyBetween, sortSteps } from "./recipe-order";
import { parseJsonObject, parseSchema } from "./schema";
import { SENSITIVITY_RANK, type ExploreSensitivity } from "./types";
import { parseExclusions, type SamplesExclusion } from "./sample-exclusions";

// ---------------------------------------------------------------------------
// The step's configuration
// ---------------------------------------------------------------------------

export type StepKind = "code" | "pipeline" | "samples";
export const stepKindOf = (value: unknown): StepKind => (value === "pipeline" ? "pipeline" : value === "samples" ? "samples" : "code");

/** What a pipeline step runs on: every sample with reads in the study's Data, or the samples a table names. */
export interface PipelineSamplesSpec {
  from: "data" | "table";
  /** The sample list (a Data table or a step's output, bound as the step's `samples` input). */
  datasetId?: string | null;
  /** The column naming the samples; default `sample`, else the table's sample role. */
  column?: string | null;
}

export interface PipelineOutputSpec {
  /** The manifest output (`outputs[].id`). */
  outputId: string;
  /** The table name next steps read it by (snake_case, unique in the flow). */
  name: string;
}

export interface PipelineStepConfig {
  pipelineId: string;
  version: string;
  /** The settings a person (or a preset) set; the pipeline's defaults and the admin's configuration fill the rest. */
  params: Record<string, unknown>;
  samples: PipelineSamplesSpec | null;
  outputs: PipelineOutputSpec[];
  presetId?: string | null;
  /** An existing finished run the step reads, pinned; nothing reruns. */
  pinnedRunId?: string | null;
  /** The pipeline is not on this server yet: the step waits for this install request. */
  requestId?: string | null;
  /** Samples left out while it ran or after it (quality), for a pipeline that runs on every sample in Data (one that
   *  reads a sample list keeps them in the Choose samples step). Not part of the step's code: nothing turns out of date. */
  exclusions?: SamplesExclusion[];
}

/** JSON with sorted keys, so equal settings always hash the same. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** A stored `pipeline` value as a config, or null when it is not one. Tolerant: older or partial values read as far as they go. */
export function parsePipelineStepConfig(raw: unknown): PipelineStepConfig | null {
  const value = typeof raw === "string" ? (() => { try { return JSON.parse(raw) as unknown; } catch { return null; } })() : raw;
  const config = record(value);
  const pipelineId = text(config.pipelineId);
  if (!pipelineId) return null;
  const samples = record(config.samples);
  const outputs = Array.isArray(config.outputs) ? config.outputs.map(record).filter((entry) => text(entry.outputId) && text(entry.name)).map((entry) => ({ outputId: text(entry.outputId)!, name: text(entry.name)! })) : [];
  return {
    pipelineId,
    version: text(config.version) ?? "",
    params: record(config.params),
    samples: samples.from === "table" ? { from: "table", datasetId: text(samples.datasetId), column: text(samples.column) } : samples.from === "data" ? { from: "data" } : null,
    outputs,
    presetId: text(config.presetId),
    pinnedRunId: text(config.pinnedRunId),
    requestId: text(config.requestId),
    ...(Array.isArray(config.exclusions) && config.exclusions.length ? { exclusions: parseExclusions(config.exclusions) } : {}),
  };
}

/** The step's code: everything that decides what the pipeline does except the settings (which are the revision's params). */
export function pipelineStepCode(config: PipelineStepConfig): string {
  return JSON.stringify(JSON.parse(canonicalJson({
    kind: "pipeline", pipelineId: config.pipelineId, version: config.version,
    samples: config.samples ? { from: config.samples.from, datasetId: config.samples.datasetId ?? null, column: config.samples.column ?? null } : { from: "data" },
    outputs: config.outputs, pinnedRunId: config.pinnedRunId ?? null, requestId: config.requestId ?? null,
  })), null, 2);
}

/** What the stored revision keeps in its `pipeline` column. */
export function pipelineJsonOf(config: PipelineStepConfig): Prisma.InputJsonValue {
  return JSON.parse(canonicalJson({ ...config, presetId: config.presetId ?? null, pinnedRunId: config.pinnedRunId ?? null, requestId: config.requestId ?? null })) as Prisma.InputJsonValue;
}

/** The files a pipeline run would read, as a snapshot kept with its cache key. */
export interface ReadsKey { files: Array<{ id: string; name: string; size: number }>; records: string[] }

/**
 * The reuse key of a pipeline step run (ExplorePipelineCache.inputHash): the version, the settings in canonical
 * order, the reads it would run on (file ids, names, sizes and linked read records) and the sample list's content.
 * The same key on the same study means the same samplesheet and the same work.
 */
export function pipelineInputHash(input: { pipelineId: string; version: string; params: Record<string, unknown>; reads: ReadsKey; sampleList?: { contentHash: string | null; column: string | null; samples: string[] } | null }): string {
  return sha256(canonicalJson({
    pipelineId: input.pipelineId, version: input.version, params: input.params,
    reads: { files: [...input.reads.files].sort((a, b) => a.id.localeCompare(b.id)), records: [...input.reads.records].sort() },
    sampleList: input.sampleList ? { contentHash: input.sampleList.contentHash, column: input.sampleList.column, samples: [...input.sampleList.samples].sort() } : null,
  }));
}

// ---------------------------------------------------------------------------
// Is the feature on here?
// ---------------------------------------------------------------------------

let probe: { at: number; ok: boolean } | null = null;

/** Whether this client knows a field of a model (Prisma's own data model, so an older generated client says no). */
function clientHasField(model: string, field: string): boolean {
  try {
    const dmmf = (Prisma as unknown as { dmmf?: { datamodel?: { models?: Array<{ name: string; fields: Array<{ name: string }> }> } } }).dmmf;
    return Boolean(dmmf?.datamodel?.models?.find((entry) => entry.name === model)?.fields.some((entry) => entry.name === field));
  } catch {
    return false;
  }
}

/**
 * Pipeline steps need the migration 20261006120000_pipeline_steps in the database and a Prisma client generated from
 * that schema. Until both are there the capability is not advertised and every pipeline-step route says so; nothing
 * else changes. Checked once a minute.
 */
export async function pipelineStepsAvailable(): Promise<boolean> {
  if (probe && Date.now() - probe.at < 60_000) return probe.ok;
  let ok = false;
  try {
    const client = db as unknown as Record<string, unknown>;
    const models = Boolean(client.explorePipelineCache && client.explorePipelinePreset && client.explorePipelineInstallRequest);
    const fields = clientHasField("ExploreAnalysis", "stepKind") && clientHasField("ExploreAnalysisRevision", "pipeline") && clientHasField("ExploreAnalysisRun", "pipelineRunId");
    if (models && fields) {
      const rows = await db.$queryRaw<Array<{ n: bigint | number }>>`SELECT count(*) AS n FROM information_schema.columns WHERE (table_name = 'ExploreAnalysis' AND column_name = 'stepKind') OR (table_name = 'ExploreAnalysisRevision' AND column_name = 'pipeline') OR (table_name = 'ExploreAnalysisRun' AND column_name = 'pipelineRunId')`;
      const tables = await db.$queryRaw<Array<{ n: bigint | number }>>`SELECT count(*) AS n FROM information_schema.tables WHERE table_name IN ('ExplorePipelineCache', 'ExplorePipelinePreset', 'ExplorePipelineInstallRequest')`;
      ok = Number(rows[0]?.n ?? 0) >= 3 && Number(tables[0]?.n ?? 0) >= 3;
    }
  } catch {
    ok = false;
  }
  probe = { at: Date.now(), ok };
  return ok;
}

/** For tests: forget the probe. */
export function resetPipelineStepsProbe(value?: boolean): void {
  probe = value === undefined ? null : { at: Date.now(), ok: value };
}

export async function requirePipelineSteps(): Promise<void> {
  if (!(await pipelineStepsAvailable())) throw flowError("invalid_request", "Pipeline steps need a database update on this Compute server. Its administrator can apply SeqDesk's latest migration.");
}

// ---------------------------------------------------------------------------
// What a pipeline is: definition, package, outputs, stages, settings
// ---------------------------------------------------------------------------

export interface PipelineInfo {
  id: string;
  name: string;
  /** The installed package's version (one version is installed at a time). */
  version: string;
  description: string;
  definition: PipelineDefinition;
  pkg: LoadedPackage;
}

/** The pipeline as installed on this server, or null. Order-only and internal pipelines are not steps. */
export function pipelineInfo(pipelineId: string): PipelineInfo | null {
  const definition = PIPELINE_REGISTRY[pipelineId];
  const pkg = getPackage(pipelineId);
  if (!definition || !pkg) return null;
  if (!definition.input.supportedScopes.includes("study")) return null;
  return { id: pipelineId, name: pkg.manifest.package.name || definition.name, version: pkg.manifest.package.version || definition.version || "", description: pkg.manifest.package.description || definition.description, definition, pkg };
}

/** Pipelines that never run on an Analysis study's Data as a step. */
export const NOT_STEPS = new Set(["_example", "study-demo-report", "simulate-reads", "submg", "fastq-checksum", "cami-opal"]);

/** Plain table names next steps read a pipeline's tables by. */
const OUTPUT_NAMES: Record<string, string> = {
  "fastqc:summary": "fastqc_summary",
  "reads-qc:summary_tsv": "read_stats",
  "kraken2-bracken:summary": "bracken_top_taxa",
  "kraken2-bracken:bracken_report": "bracken_species",
  "metaxpath:sample_profile": "metaxpath_profiles",
};

/** "fastqc" + "summary" → fastqc_summary; a manifest output id that already names the pipeline is kept. */
export function outputNameFor(pipelineId: string, outputId: string): string {
  const known = OUTPUT_NAMES[`${pipelineId}:${outputId}`];
  if (known) return known;
  const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const stem = clean(pipelineId.replace(/^nf-core[/-]/, "")).split("_")[0] || "pipeline";
  const id = clean(outputId) || "table";
  const name = id.startsWith(stem) ? id : `${stem}_${id}`;
  return (/^[a-z]/.test(name) ? name : `t_${name}`).slice(0, 60);
}

export interface PipelineTableOutput {
  outputId: string;
  name: string;
  label: string;
  description: string | null;
  tableKind: string | null;
  roles: Record<string, string>;
}

/** The outputs that become tables (the manifest's `table`, or the fallback list for older packages). */
export function tableOutputsOf(pipelineId: string): PipelineTableOutput[] {
  const pkg = getPackage(pipelineId);
  if (!pkg) return [];
  const out: PipelineTableOutput[] = [];
  for (const output of pkg.manifest.outputs) {
    if (output.destination === "sample_reads" || output.writeback) continue;
    const spec: (PackageOutputTable & { label?: string }) | null = output.table ?? knownPipelineTable(pipelineId, output.id);
    if (!spec) continue;
    out.push({
      outputId: output.id, name: outputNameFor(pipelineId, output.id),
      label: spec.label ?? output.result?.preview?.label ?? output.id.replace(/[_-]+/g, " "),
      description: spec.description ?? null, tableKind: spec.tableKind ?? null, roles: spec.roles ?? {},
    });
  }
  return out;
}

/** Outputs that stay files of the run (reports, figures, archives): shown on the step, never datasets. */
export function fileOutputsOf(pipelineId: string): Array<{ outputId: string; label: string; kind: "report" | "figure" | "file" }> {
  const pkg = getPackage(pipelineId);
  if (!pkg) return [];
  const tables = new Set(tableOutputsOf(pipelineId).map((output) => output.outputId));
  return pkg.manifest.outputs.filter((output) => !tables.has(output.id) && output.destination !== "sample_reads" && !output.writeback).map((output) => {
    const pattern = output.discovery?.pattern ?? "";
    const kind = /\.html?$/i.test(pattern) || output.type === "report" ? "report" as const : /\.(png|svg|pdf|jpe?g)$/i.test(pattern) ? "figure" as const : "file" as const;
    return { outputId: output.id, label: output.result?.preview?.label ?? output.id.replace(/[_-]+/g, " "), kind };
  });
}

/** Its stages as small steps, in order (the package definition's steps). */
export function stagesOf(pipelineId: string): string[] {
  try {
    return getStepsForPipeline(pipelineId).map((step) => step.name || step.id).filter(Boolean);
  } catch {
    return [];
  }
}

export interface PipelineSetting {
  key: string;
  title: string;
  description: string | null;
  type: string;
  value: unknown;
  default: unknown;
  enum: unknown[] | null;
  minimum: number | null;
  maximum: number | null;
  /** basic: shown up front · advanced: behind "All N settings". Admin, hidden and derived settings are never shown. */
  placement: "basic" | "advanced";
  /** Set on this step (differs from the pipeline's default). */
  changed: boolean;
}

const HIDDEN_PLACEMENTS = new Set(["admin", "hidden", "derived"]);
const placementOf = (property: PipelineConfigProperty) => property["x-seqdesk"]?.placement;

/** The settings a person may set on a step, with the values it runs with. */
export function pipelineSettings(definition: PipelineDefinition, params: Record<string, unknown>, stored: Record<string, unknown> = {}): PipelineSetting[] {
  const out: PipelineSetting[] = [];
  for (const [key, property] of Object.entries(definition.configSchema?.properties ?? {})) {
    const placement = placementOf(property);
    if (placement && HIDDEN_PLACEMENTS.has(placement)) continue;
    const fallback = key in stored ? stored[key] : key in (definition.defaultConfig ?? {}) ? (definition.defaultConfig as Record<string, unknown>)[key] : property.default ?? null;
    const value = key in params ? params[key] : fallback;
    out.push({
      key, title: property.title || key, description: property.description ?? null, type: property.type, value: value ?? null, default: fallback ?? null,
      enum: Array.isArray(property.enum) ? property.enum : null, minimum: typeof property.minimum === "number" ? property.minimum : null, maximum: typeof property.maximum === "number" ? property.maximum : null,
      placement: placement === "basic" ? "basic" : "advanced", changed: key in params && JSON.stringify(params[key]) !== JSON.stringify(fallback),
    });
  }
  // Basic settings first, in the schema's order.
  return [...out.filter((setting) => setting.placement === "basic"), ...out.filter((setting) => setting.placement === "advanced")];
}

/**
 * Settings a step may carry, checked the way the integration API starts pipelines (canManageConfig false): unknown,
 * admin-only, hidden and derived settings are refused, and every value must fit the pipeline's schema. Required
 * settings that nobody set are not refused here: the step can be added, and its Ready to run check says what is missing.
 */
export function validateStepParams(definition: PipelineDefinition, params: Record<string, unknown>, stored: Record<string, unknown> = {}): { refused: string[]; missing: string[] } {
  const schema = definition.configSchema ?? { type: "object", properties: {} };
  const properties = schema.properties ?? {};
  const refused: string[] = [];
  for (const key of Object.keys(params)) {
    const property = Object.hasOwn(properties, key) ? properties[key] : undefined;
    if (!property) { refused.push(`${definition.name} has no setting called ${key}.`); continue; }
    const placement = placementOf(property);
    if (placement === "hidden" || placement === "derived") refused.push(`${property.title || key} is set by SeqDesk, not by a step.`);
    else if (placement === "admin") refused.push(`Only an admin sets ${property.title || key} (in the pipeline's settings on this server).`);
  }
  for (const issue of pipelineConfigOverrideIssues(schema, params, false)) if (!refused.some((entry) => entry.includes(issue.split(" ").pop() ?? ""))) refused.push(`${issue}.`.replace(/\.\.$/, "."));
  // Values are checked as they would run: defaults and the admin's configuration under the step's own settings.
  const merged = { ...(definition.defaultConfig as Record<string, unknown> ?? {}), ...stored, ...params };
  const validation = validatePipelineConfigSchema(schema, merged);
  for (const issue of validation.valueIssues) {
    const key = Object.entries(properties).find(([name, property]) => issue.startsWith(`${property.title || name} `))?.[0];
    if (key && key in params) refused.push(issue);
  }
  const missing = validation.missingFields;
  return { refused: [...new Set(refused)], missing };
}

/** The admin's stored configuration of a pipeline (PipelineConfig.config), as the run service merges it. */
export async function storedPipelineConfig(pipelineId: string): Promise<Record<string, unknown>> {
  const row = await db.pipelineConfig.findUnique({ where: { pipelineId }, select: { config: true } });
  return parseStoredPipelineConfig(row?.config) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Who may start a pipeline here
// ---------------------------------------------------------------------------

/** What the caller's SeqDesk account may do, decided by the route from the session. */
export interface PipelineAccess {
  userId: string;
  /** analysis.run: may run pipelines at all. */
  canRun: boolean;
  /** An installation-wide grant: starts pipelines on anyone's study. */
  installation: boolean;
  /** system.pipelines.manage: installs and switches pipelines (the server's admin). */
  canManage: boolean;
}

export async function personName(userId: string | null | undefined): Promise<string> {
  const user = userId ? await db.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, email: true } }) : null;
  return user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email : "its owner";
}

/**
 * SeqDesk's rule for a pipeline run on a study's Data: the study's owner (whoever set up its Data) or an
 * installation-wide grant starts it. Said before a run starts, so a recipe run never fails halfway for it.
 */
export async function pipelineStartAccess(targetKey: string, access: PipelineAccess): Promise<{ ok: boolean; words: string | null }> {
  if (!access.canRun) return { ok: false, words: "Your SeqDesk account may not run pipelines; ask an admin." };
  if (access.installation) return { ok: true, words: null };
  const study = await findDataStudy(targetKey);
  const owner = study ? (await db.study.findUnique({ where: { id: study.id }, select: { userId: true } }))?.userId : null;
  if (owner && owner !== access.userId) return { ok: false, words: `Only ${await personName(owner)} or a SeqDesk admin starts pipelines here.` };
  return { ok: true, words: null };
}

// ---------------------------------------------------------------------------
// Samples: which reads a step runs on
// ---------------------------------------------------------------------------

/** A sample name as people and sequencers write it, reduced to compare: case, dashes, leading zeros, lane and S endings. */
export function normalizeSampleName(name: string): string {
  return name.toLowerCase()
    .replace(/\.(fastq|fq)(\.gz)?$/, "")
    .replace(/([._-](r?[12]))?(_001)?$/, "")
    .replace(/_s\d+(_l\d{3})?$/, "")
    .replace(/_l\d{3}$/, "")
    .replace(/[^a-z0-9]+/g, "")
    .replace(/(^|[a-z])0+(\d)/g, "$1$2");
}

export interface SampleMatch { matched: Array<{ name: string; sampleId: string; how: "exact" | "normalised" }>; unmatched: string[]; ambiguous: string[] }

/** Names from a sample list matched to the reads in Data: exactly, then by the normalised name. Never a guess. */
export function matchSamplesToReads(names: string[], reads: Array<{ sampleId: string; label?: string | null }>): SampleMatch {
  const exact = new Map<string, string>();
  const loose = new Map<string, string[]>();
  for (const read of reads) {
    for (const label of new Set([read.sampleId, read.label].filter((value): value is string => Boolean(value)))) {
      exact.set(label, read.sampleId);
      const key = normalizeSampleName(label);
      loose.set(key, [...new Set([...(loose.get(key) ?? []), read.sampleId])]);
    }
  }
  const out: SampleMatch = { matched: [], unmatched: [], ambiguous: [] };
  for (const name of [...new Set(names.map((value) => value.trim()).filter(Boolean))]) {
    const hit = exact.get(name);
    if (hit) { out.matched.push({ name, sampleId: hit, how: "exact" }); continue; }
    const candidates = loose.get(normalizeSampleName(name)) ?? [];
    if (candidates.length === 1) out.matched.push({ name, sampleId: candidates[0], how: "normalised" });
    else if (candidates.length > 1) out.ambiguous.push(name);
    else out.unmatched.push(name);
  }
  return out;
}

/** The sample names in a sample list: the chosen column, else `sample`, else the table's sample role, else its first column. */
export async function sampleListNames(datasetId: string, column: string | null | undefined): Promise<{ names: string[]; column: string | null; versionId: string | null; contentHash: string | null; rows: number; columns: string[]; files?: Record<string, string[]> }> {
  const dataset = await db.exploreDataset.findUnique({ where: { id: datasetId }, select: { currentVersionId: true, roles: true } });
  if (!dataset?.currentVersionId) return { names: [], column: column ?? null, versionId: null, contentHash: null, rows: 0, columns: [] };
  const version = await db.exploreDatasetVersion.findUnique({ where: { id: dataset.currentVersionId }, select: { id: true, schema: true, rowCount: true, contentHash: true } });
  if (!version) return { names: [], column: column ?? null, versionId: null, contentHash: null, rows: 0, columns: [] };
  const columns = parseSchema(version.schema).columns.map((entry) => entry.key);
  const roles = record(parseJsonObject(dataset.roles));
  const chosen = (column && columns.includes(column) ? column : null) ?? (columns.includes("sample") ? "sample" : null) ?? (typeof roles.sample === "string" && columns.includes(roles.sample) ? roles.sample : null) ?? null;
  if (!chosen) return { names: [], column: null, versionId: version.id, contentHash: version.contentHash, rows: version.rowCount, columns };
  const rows = await db.exploreDatasetRow.findMany({ where: { versionId: version.id }, select: { data: true }, orderBy: { rowIndex: "asc" }, take: 20_000 });
  const names = rows.map((row) => (row.data as Record<string, unknown> | null)?.[chosen]).filter((value) => value !== null && value !== undefined && value !== "").map(String);
  // A list that names each sample's read files (fastq_1, fastq_2: a Choose samples step's list, or an uploaded one) is
  // matched by those files, so a confirmed match never depends on the name again.
  const files: Record<string, string[]> = {};
  if (columns.includes("fastq_1")) {
    for (const row of rows) {
      const data = (row.data as Record<string, unknown> | null) ?? {};
      const name = data[chosen];
      const read = [data.fastq_1, data.fastq_2].filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim());
      if (name !== null && name !== undefined && name !== "" && read.length) files[String(name)] = read;
    }
  }
  return { names, column: chosen, versionId: version.id, contentHash: version.contentHash, rows: version.rowCount, columns, ...(Object.keys(files).length ? { files } : {}) };
}

/** Samples left out in the Choose samples step that makes a list (its list's dataset is marked `samplesStep`). */
export async function listExclusions(datasetId: string | null | undefined): Promise<SamplesExclusion[]> {
  if (!datasetId) return [];
  const dataset = await db.exploreDataset.findUnique({ where: { id: datasetId }, select: { sourceConfig: true } }).catch(() => null);
  const source = record(parseJsonObject(dataset?.sourceConfig ?? null));
  if (source.samplesStep !== true || typeof source.analysisId !== "string") return [];
  const analysis = await db.exploreAnalysis.findUnique({ where: { id: source.analysisId }, select: { currentRevisionId: true } }).catch(() => null);
  const revision = analysis?.currentRevisionId ? await db.exploreAnalysisRevision.findUnique({ where: { id: analysis.currentRevisionId } }).catch(() => null) : null;
  return parseExclusions(record((revision as { pipeline?: unknown } | null)?.pipeline).exclusions);
}

export interface StepReads {
  /** Data sample ids (DataReadPair.sampleId or linked record labels) the run starts from. */
  samples: string[];
  pairs: DataReadPair[];
  records: number;
  key: ReadsKey;
  /** Sample list problems: names without reads, names that match more than one sample. */
  unmatched: string[];
  ambiguous: string[];
  sampleList: { contentHash: string | null; column: string | null; samples: string[]; rows: number; columns: string[] } | null;
  words: string;
  /** Data sample id → the name the sample list gives it (the pipeline's samplesheet uses the list's names). */
  names?: Record<string, string>;
  /** Samples left out (the list's names, or Data sample ids without a list): not run, not in the key's samples. */
  excluded?: string[];
}

const plural = (count: number, word: string, many = `${word}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? word : many}`;

/**
 * The reads a pipeline step would run on now, and the key that says whether they changed. Samples left out (the step's
 * own exclusions, and those of the Choose samples step that makes its list) do not run; they change the run's input
 * (its sample list), not the reads key, so leaving one out never reads as "the reads in Data changed".
 */
export async function stepReads(targetKey: string, samples: PipelineSamplesSpec | null, exclusions?: SamplesExclusion[] | null): Promise<StepReads> {
  const [{ files, pairs }, study] = await Promise.all([readsInData(targetKey), findDataStudy(targetKey)]);
  const records = study ? await linkedReadRecords(study.id) : [];
  const all = [...pairs.map((pair) => ({ sampleId: pair.sampleId, label: pair.sampleId })), ...records.map((entry) => ({ sampleId: entry.label, label: entry.label }))];
  const fromList = samples?.from === "table" && samples.datasetId ? await listExclusions(samples.datasetId) : [];
  const excluded = new Set([...(exclusions ?? []), ...fromList].map((entry) => entry.sample));
  if (!samples || samples.from !== "table" || !samples.datasetId) {
    const kept = all.filter((entry) => !excluded.has(entry.sampleId));
    const left = all.length - kept.length;
    return {
      samples: kept.map((entry) => entry.sampleId), pairs: left ? pairs.filter((pair) => !excluded.has(pair.sampleId)) : pairs, records: left ? records.filter((entry) => !excluded.has(entry.label)).length : records.length,
      key: { files: files.map((file) => ({ id: file.id, name: file.name, size: file.sizeBytes })), records: records.map((entry) => entry.readId) },
      unmatched: [], ambiguous: [],
      // Left-out samples change what runs: the run's input names them (the reads key stays the reads in Data).
      sampleList: left ? { contentHash: null, column: null, samples: kept.map((entry) => entry.sampleId), rows: all.length, columns: [] } : null,
      words: all.length ? (left ? `${plural(kept.length, "sample")} in Data (${left} left out)` : all.length === 1 ? "the one sample in Data" : `all ${plural(all.length, "sample")} in Data`) : "no samples with reads in Data yet",
      ...(left ? { excluded: all.filter((entry) => excluded.has(entry.sampleId)).map((entry) => entry.sampleId) } : {}),
    };
  }
  const list = await sampleListNames(samples.datasetId, samples.column);
  // Rows that name their read files are matched by those files; the rest by name (exactly, then normalised).
  const byFile = new Map<string, DataReadPair>();
  for (const pair of pairs) { byFile.set(pair.r1.name, pair); if (pair.r2) byFile.set(pair.r2.name, pair); }
  const fileMatched: Array<{ name: string; sampleId: string }> = [];
  const byName: string[] = [];
  for (const name of [...new Set(list.names.map((value) => value.trim()).filter(Boolean))]) {
    const pair = (list.files?.[name] ?? []).map((file) => byFile.get(file) ?? byFile.get(file.split("/").pop() ?? "")).find(Boolean);
    if (pair && !fileMatched.some((entry) => entry.sampleId === pair.sampleId)) fileMatched.push({ name, sampleId: pair.sampleId });
    else byName.push(name);
  }
  const match = matchSamplesToReads(byName, all);
  const matched = [...fileMatched, ...match.matched.filter((entry) => !fileMatched.some((other) => other.sampleId === entry.sampleId))];
  // The reads key: every sample the list names, left out or not (what the step reads in Data).
  const keyPairs = pairs.filter((pair) => matched.some((entry) => entry.sampleId === pair.sampleId));
  const keyFiles = new Set(keyPairs.flatMap((pair) => [pair.r1.id, pair.r2?.id].filter((id): id is string => Boolean(id))));
  const keyRecords = records.filter((entry) => matched.some((other) => other.sampleId === entry.label));
  const running = matched.filter((entry) => !excluded.has(entry.name) && !excluded.has(entry.sampleId));
  const chosen = new Set(running.map((entry) => entry.sampleId));
  const names = Object.fromEntries(running.filter((entry) => entry.name !== entry.sampleId).map((entry) => [entry.sampleId, entry.name]));
  const usedRecords = records.filter((entry) => chosen.has(entry.label));
  const left = matched.length - running.length;
  return {
    samples: [...chosen], pairs: pairs.filter((pair) => chosen.has(pair.sampleId)), records: usedRecords.length,
    key: { files: files.filter((file) => keyFiles.has(file.id)).map((file) => ({ id: file.id, name: file.name, size: file.sizeBytes })), records: keyRecords.map((entry) => entry.readId) },
    unmatched: match.unmatched.filter((name) => !excluded.has(name)), ambiguous: match.ambiguous.filter((name) => !excluded.has(name)),
    sampleList: { contentHash: list.contentHash, column: list.column, samples: [...chosen], rows: list.rows, columns: list.columns },
    words: `the ${plural(chosen.size, "sample")} on the sample list${list.names.length > chosen.size + left ? ` (${list.names.length - chosen.size - left} without reads)` : ""}${left ? ` (${left} left out)` : ""}`,
    ...(Object.keys(names).length ? { names } : {}),
    ...(left ? { excluded: matched.filter((entry) => !running.includes(entry)).map((entry) => entry.name) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Adding and changing a pipeline step
// ---------------------------------------------------------------------------

export interface AddPipelineStepInput {
  pipelineId?: string | null;
  version?: string | null;
  params?: Record<string, unknown> | null;
  presetId?: string | null;
  samples?: { from: "data" } | { from: "table"; datasetId?: string | null; fromStep?: { stepId: string; output: string } | null; column?: string | null } | null;
  /** Manifest output ids kept as tables; default every table output. */
  outputs?: string[] | null;
  /** Read an existing finished run of this study's Data, pinned. */
  pinnedRunId?: string | null;
  /** Not installed here: ask the admins and add the step waiting for it. */
  request?: { reason?: string | null } | null;
  after?: string | null;
  name?: string | null;
  purpose?: string | null;
  requestId?: string;
  labKey?: string | null;
  actor: RecipeActor & { name?: string | null };
}

/** Table names already written by other steps of the flow, so a new step's names do not collide. */
function takenNames(model: RecipeModel): Set<string> {
  return new Set([...model.datasets.values()].filter((dataset) => dataset.producer).map((dataset) => dataset.artifactName ?? "").filter(Boolean));
}

function uniqueName(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name); n += 1) name = `${base}_${n}`;
  taken.add(name);
  return name;
}

/** The step's declared output table for one output, created empty when missing (filled when the step runs). */
export async function ensurePipelineOutputDataset(model: RecipeModel, step: { id: string; name: string; bindings: AnalysisInputBinding[] }, output: PipelineOutputSpec, pipelineId: string, userId: string): Promise<string> {
  const existing = [...model.datasets.values()].find((dataset) => dataset.producer === step.id && dataset.artifactName === output.name);
  if (existing) return existing.id;
  const contract = tableOutputsOf(pipelineId).find((entry) => entry.outputId === output.outputId);
  let sensitivity: ExploreSensitivity = "standard";
  for (const binding of step.bindings) {
    const candidate = (model.datasets.get(binding.datasetId)?.sensitivity ?? "standard") as ExploreSensitivity;
    if ((SENSITIVITY_RANK[candidate] ?? 0) > SENSITIVITY_RANK[sensitivity]) sensitivity = candidate;
  }
  const dataset = await db.exploreDataset.create({
    data: {
      targetKey: model.flow.targetKey, kind: "derived", tableKind: contract?.tableKind ?? null, name: `${output.name} (${step.name})`.slice(0, 200),
      description: `${contract?.label ?? output.name}: written by the pipeline step ${step.name} when it runs.`.slice(0, 1000), sensitivity, createdById: userId,
      roles: contract && Object.keys(contract.roles).length ? JSON.stringify(contract.roles) : null,
      sourceConfig: JSON.stringify({ builder: "analysis-run", analysisId: step.id, artifactName: output.name, pipelineId, pipelineOutputId: output.outputId }),
    },
  });
  model.datasets.set(dataset.id, { id: dataset.id, name: dataset.name, kind: "derived", tableKind: dataset.tableKind, roles: dataset.roles, sensitivity, currentVersionId: null, producer: step.id, artifactName: output.name, current: null });
  return dataset.id;
}

/** The sample list binding of a step: a Data table, or a table an earlier step writes. */
async function sampleListBinding(model: RecipeModel, samples: AddPipelineStepInput["samples"], userId: string, position: string | null): Promise<{ binding: AnalysisInputBinding | null; spec: PipelineSamplesSpec | null }> {
  if (!samples || samples.from !== "table") return { binding: null, spec: samples?.from === "data" ? { from: "data" } : null };
  let datasetId = samples.datasetId ?? null;
  if (samples.fromStep) {
    const producer = model.steps.find((step) => step.id === samples.fromStep!.stepId);
    if (!producer) throw flowError("invalid_request", "The sample list must come from a step of this analysis.");
    if (position !== null && producer.position >= position) throw flowError("incompatible", `Step ${model.labels.get(producer.id)} comes after this step; a pipeline reads a sample list made above it.`, { words: "A pipeline reads a sample list made above it." });
    const { ensureOutputDataset } = await import("./recipe-edit");
    datasetId = await ensureOutputDataset(model, samples.fromStep.stepId, samples.fromStep.output, userId);
  }
  if (!datasetId || !model.datasets.has(datasetId)) throw flowError("invalid_request", "Choose a sample list in this study’s Data or a table of a step above.");
  return { binding: { alias: "samples", datasetId, versionId: null }, spec: { from: "table", datasetId, column: samples.column ?? null } };
}

/** A preset of the lab for this pipeline (pipeline-lab.ts keeps them); its settings under the step's own. */
async function presetParams(presetId: string | null | undefined, pipelineId: string, labKey: string | null | undefined): Promise<Record<string, unknown>> {
  if (!presetId) return {};
  const preset = await db.explorePipelinePreset.findUnique({ where: { id: presetId } });
  if (!preset || preset.archivedAt || preset.pipelineId !== pipelineId || (labKey && preset.labKey !== labKey)) throw flowError("invalid_request", "That preset is not one of this lab’s presets for this pipeline.");
  // A preset's quality thresholds (`_thresholds`) are the lab's, not settings of the pipeline.
  const { _thresholds: _ignored, ...params } = record(preset.params);
  void _ignored;
  return params;
}

/** Placement after a step, or at the end of the main lane. */
function placeAfter(model: RecipeModel, after: string | null | undefined): string {
  const ordered = sortSteps(model.steps);
  if (after) {
    const index = ordered.findIndex((step) => step.id === after);
    if (index < 0) throw flowError("invalid_request", "after must name a step of this flow.");
    return keyBetween(ordered[index].position, ordered[index + 1]?.position ?? null);
  }
  return keyBetween(ordered.at(-1)?.position ?? "", null);
}

/** Outputs a finished pipeline run actually has (its artifacts' output ids). */
async function runOutputIds(pipelineRunId: string): Promise<Set<string>> {
  const artifacts = await db.pipelineArtifact.findMany({ where: { pipelineRunId }, select: { outputId: true }, distinct: ["outputId"] });
  return new Set(artifacts.map((artifact) => artifact.outputId).filter((id): id is string => Boolean(id)));
}

/**
 * Add a pipeline as a step. The settings are checked against the pipeline's schema (admin-only settings refused), the
 * outputs it keeps as tables are declared now so the steps after it can be fit-checked before its first run, and a
 * pinned existing run writes its tables at once. A pipeline that is not installed here is added only with `request`:
 * the step then waits for the admins (pipeline-lab.ts) and declares its outputs once the pipeline is installed.
 */
export async function addPipelineStep(flowId: string, input: AddPipelineStepInput): Promise<string> {
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
  const position = placeAfter(model, input.after);
  let config: PipelineStepConfig;
  let name: string;
  let purpose = input.purpose ?? null;
  let pinnedRun: { id: string; studyId: string | null } | null = null;
  const bindings: AnalysisInputBinding[] = [];

  if (input.pinnedRunId) {
    const { runBelongsTo } = await import("@/lib/pipelines/pipeline-data-service");
    if (!(await runBelongsTo(input.pinnedRunId, model.flow.targetKey))) throw flowError("not_found", "That pipeline run is not in this study’s Data.");
    const run = await db.pipelineRun.findUnique({ where: { id: input.pinnedRunId }, select: { id: true, pipelineId: true, status: true, config: true, runNumber: true, studyId: true, completedAt: true } });
    if (!run) throw flowError("not_found", "That pipeline run is not in this study’s Data.");
    if (run.status !== "completed") throw flowError("invalid_request", "Only a finished run can be used; this one has not finished.");
    const info = pipelineInfo(run.pipelineId);
    const has = await runOutputIds(run.id);
    const outputs = tableOutputsOf(run.pipelineId).filter((output) => has.has(output.outputId));
    if (!outputs.length) throw flowError("invalid_request", "That run made no tables a step could read.");
    const taken = takenNames(model);
    const params = (() => { try { return record(JSON.parse(run.config ?? "{}")); } catch { return {}; } })();
    const visible = info ? Object.fromEntries(Object.entries(params).filter(([key]) => { const property = info.definition.configSchema?.properties?.[key]; return property && !HIDDEN_PLACEMENTS.has(placementOf(property) ?? ""); })) : {};
    config = { pipelineId: run.pipelineId, version: info?.version ?? "", params: visible, samples: null, outputs: outputs.map((output) => ({ outputId: output.outputId, name: uniqueName(output.name, taken) })), pinnedRunId: run.id };
    name = input.name?.trim() || `${info?.name ?? run.pipelineId} · run of ${run.completedAt ? run.completedAt.toISOString().slice(0, 10) : run.runNumber}`;
    purpose = purpose ?? `Reads the tables of ${run.runNumber}, pinned; nothing reruns.`;
    pinnedRun = { id: run.id, studyId: run.studyId };
  } else {
    const pipelineId = text(input.pipelineId);
    if (!pipelineId) throw flowError("invalid_request", "Name the pipeline with pipelineId.");
    if (NOT_STEPS.has(pipelineId)) throw flowError("invalid_request", "That pipeline does not run on a study’s reads, so it cannot be a step.");
    const info = pipelineInfo(pipelineId);
    if (!info) {
      if (!input.request) throw flowError("invalid_request", `${pipelineId} is not installed on this server. Ask an admin to install it.`, { fix: { kind: "ask-install", pipelineId } });
      // Not here yet: a step that waits for the admins. Its outputs are declared once the pipeline is installed.
      const { createInstallRequest } = await import("./pipeline-lab");
      const request = await createInstallRequest({ labKey: input.labKey ?? "", kind: "install", pipelineId, version: input.version ?? null, reason: input.request.reason ?? null, targetKey: model.flow.targetKey, flowId, stepPosition: position, actor: input.actor });
      config = { pipelineId, version: input.version ?? "", params: record(input.params), samples: null, outputs: [], requestId: request.id };
      name = input.name?.trim() || pipelineId;
      purpose = purpose ?? "Waiting to be installed.";
    } else {
      if (input.version && input.version !== info.version) throw flowError("invalid_request", `This server has ${info.name} ${info.version}, not ${input.version}.`);
      if (!(await getPipelineEnabled(pipelineId))) throw flowError("invalid_request", `${info.name} is switched off on this server. Its admin can switch it on.`, { fix: { kind: "ask-admin" } });
      const params = { ...(await presetParams(input.presetId, pipelineId, input.labKey)), ...record(input.params) };
      const stored = await storedPipelineConfig(pipelineId);
      const { refused } = validateStepParams(info.definition, params, stored);
      if (refused.length) throw flowError("invalid_request", refused.join(" "), { refused });
      const samples = await sampleListBinding(model, input.samples ?? null, input.actor.userId, position);
      if (samples.binding) bindings.push(samples.binding);
      const available = tableOutputsOf(pipelineId);
      const wanted = input.outputs?.length ? available.filter((output) => input.outputs!.includes(output.outputId)) : available;
      if (input.outputs?.length && wanted.length !== input.outputs.length) throw flowError("invalid_request", `${info.name} has no table output ${input.outputs.find((id) => !available.some((output) => output.outputId === id))}.`);
      const taken = takenNames(model);
      config = { pipelineId, version: info.version, params, samples: samples.spec, outputs: wanted.map((output) => ({ outputId: output.outputId, name: uniqueName(output.name, taken) })), presetId: input.presetId ?? null };
      name = input.name?.trim() || info.name;
      purpose = purpose ?? (info.description ? info.description.split(/(?<=\.)\s/)[0].slice(0, 200) : null);
    }
  }

  const code = pipelineStepCode(config);
  const analysis = await createAnalysis({
    targetKey: model.flow.targetKey, flowId, name, language: "shell", environmentName: `pipeline:${config.pipelineId}`, inputs: bindings,
    params: config.params, createdById: input.actor.userId, createdByMemberId: input.actor.memberId ?? null, position, purpose, id: input.requestId, code,
    stepKind: "pipeline", pipeline: pipelineJsonOf(config),
  });
  // Declare the outputs now (fit checks before the first run); a pinned run fills them at once.
  const fresh = await loadRecipe(flowId);
  const step = fresh?.steps.find((entry) => entry.id === analysis.id);
  if (fresh && step) {
    for (const output of config.outputs) await ensurePipelineOutputDataset(fresh, step, output, config.pipelineId, input.actor.userId);
    if (pinnedRun) {
      const { writePipelineOutputs } = await import("./pipeline-step-runs");
      await writePipelineOutputs({ targetKey: fresh.flow.targetKey, analysisId: step.id, stepName: step.name, pipelineRunId: pinnedRun.id, pipelineId: config.pipelineId, outputs: config.outputs, userId: input.actor.userId }).catch(() => []);
    }
  }
  if (config.requestId) await db.explorePipelineInstallRequest.update({ where: { id: config.requestId }, data: { analysisId: analysis.id } }).catch(() => undefined);
  return analysis.id;
}

export interface UpdatePipelineStepInput {
  /** Settings to set (merged over the step's own), or all of them with replaceParams. null removes a setting. */
  params?: Record<string, unknown> | null;
  replaceParams?: boolean;
  version?: string | null;
  presetId?: string | null;
  samples?: AddPipelineStepInput["samples"];
  outputs?: string[] | null;
  /** "Use it": read a newer finished run instead (pinned steps). */
  pinnedRunId?: string | null;
  expectedRevisionId?: string;
  labKey?: string | null;
  message?: string | null;
  actor: RecipeActor;
}

/** A pipeline step of a recipe with its parsed configuration, or a 4xx. */
export function pipelineStepOf(model: RecipeModel, stepId: string): { step: RecipeStep; config: PipelineStepConfig } {
  const step = model.steps.find((entry) => entry.id === stepId);
  if (!step) throw flowError("not_found", "That step is not part of this flow.");
  const config = step.stepKind === "pipeline" ? parsePipelineStepConfig(step.pipeline) : null;
  if (!config) throw flowError("invalid_request", "That step is not a pipeline step.");
  return { step, config };
}

/**
 * A new revision of a pipeline step (its settings, version, preset, sample list, kept outputs or pinned run): the step
 * and everything after it turn out of date; nothing runs by itself. Returns false when nothing changed.
 */
export async function updatePipelineStep(flowId: string, stepId: string, input: UpdatePipelineStepInput): Promise<boolean> {
  await requirePipelineSteps();
  const model = await loadRecipe(flowId);
  if (!model) throw flowError("not_found", "Flow not found");
  const { step, config } = pipelineStepOf(model, stepId);
  if (input.expectedRevisionId && step.revision && input.expectedRevisionId !== step.revision.id) {
    throw flowError("step_conflict", "This step changed in another session. Reopen it before changing it.", { stepId, current: { revisionId: step.revision.id } });
  }
  const next: PipelineStepConfig = { ...config, params: { ...config.params } };
  let bindings: AnalysisInputBinding[] = step.bindings.map((binding) => ({ alias: binding.alias, datasetId: binding.datasetId, versionId: null }));
  const messages: string[] = [];

  if (input.pinnedRunId !== undefined && input.pinnedRunId !== null) {
    if (!config.pinnedRunId) throw flowError("invalid_request", "Only a step that reads an existing run can switch runs.");
    const { runBelongsTo } = await import("@/lib/pipelines/pipeline-data-service");
    if (!(await runBelongsTo(input.pinnedRunId, model.flow.targetKey))) throw flowError("not_found", "That pipeline run is not in this study’s Data.");
    const run = await db.pipelineRun.findUnique({ where: { id: input.pinnedRunId }, select: { status: true, pipelineId: true, runNumber: true } });
    if (!run || run.status !== "completed" || run.pipelineId !== config.pipelineId) throw flowError("invalid_request", "Choose a finished run of the same pipeline.");
    if (input.pinnedRunId !== config.pinnedRunId) { next.pinnedRunId = input.pinnedRunId; messages.push(`Reads ${run.runNumber}`); }
  } else {
    const info = pipelineInfo(config.pipelineId);
    if (!info && !config.requestId) throw flowError("invalid_request", `${config.pipelineId} is no longer installed on this server.`);
    if (input.version !== undefined && input.version !== null && input.version !== config.version) {
      if (!info || info.version !== input.version) throw flowError("invalid_request", `This server has ${info?.name ?? config.pipelineId} ${info?.version ?? "not installed"}, not ${input.version}.`);
      next.version = input.version;
      messages.push(`Version ${input.version}`);
    }
    if (input.presetId !== undefined) {
      if (input.presetId) {
        const preset = await presetParams(input.presetId, config.pipelineId, input.labKey);
        next.params = { ...preset, ...(input.params && !input.replaceParams ? Object.fromEntries(Object.entries(input.params).filter(([, value]) => value !== null)) : {}) };
        messages.push("Lab preset");
      }
      next.presetId = input.presetId || null;
    }
    if (input.params) {
      if (input.replaceParams) next.params = Object.fromEntries(Object.entries(input.params).filter(([, value]) => value !== null));
      else for (const [key, value] of Object.entries(input.params)) { if (value === null) delete next.params[key]; else next.params[key] = value; }
      const changed = Object.keys({ ...config.params, ...next.params }).filter((key) => JSON.stringify(config.params[key]) !== JSON.stringify(next.params[key]));
      if (changed.length) messages.push(changed.length === 1 ? `Set ${changed[0]} to ${JSON.stringify(next.params[changed[0]] ?? null)}` : `Changed ${changed.length} settings`);
    }
    if (info) {
      const { refused } = validateStepParams(info.definition, next.params, await storedPipelineConfig(config.pipelineId));
      if (refused.length) throw flowError("invalid_request", refused.join(" "), { refused });
    }
    if (input.samples !== undefined) {
      const order = sortSteps(model.steps);
      const samples = await sampleListBinding(model, input.samples, input.actor.userId, step.position || order.find((entry) => entry.id === stepId)?.position || null);
      bindings = bindings.filter((binding) => binding.alias !== "samples");
      if (samples.binding) bindings.push(samples.binding);
      next.samples = samples.spec;
      messages.push(samples.spec?.from === "table" ? "Runs on a sample list" : "Runs on all samples");
    }
    if (input.outputs) {
      if (!info) throw flowError("invalid_request", "The outputs are known once the pipeline is installed.");
      const available = tableOutputsOf(config.pipelineId);
      const missing = input.outputs.find((id) => !available.some((output) => output.outputId === id));
      if (missing) throw flowError("invalid_request", `${info.name} has no table output ${missing}.`);
      const taken = takenNames(model);
      for (const output of config.outputs) taken.delete(output.name);
      next.outputs = available.filter((output) => input.outputs!.includes(output.outputId)).map((output) => config.outputs.find((kept) => kept.outputId === output.outputId) ?? { outputId: output.outputId, name: uniqueName(output.name, taken) });
      messages.push("Changed the tables it keeps");
    }
  }
  const before = canonicalJson({ ...config, bindings: step.bindings.map((binding) => `${binding.alias}=${binding.datasetId}`).sort() });
  const after = canonicalJson({ ...next, bindings: bindings.map((binding) => `${binding.alias}=${binding.datasetId}`).sort() });
  if (before === after) return false;
  try {
    await createRevision({
      analysisId: stepId, expectedRevisionId: step.revision?.id, code: pipelineStepCode(next), params: next.params, inputs: bindings, pipeline: pipelineJsonOf(next),
      author: "user", authorUserId: input.actor.userId, authorMemberId: input.actor.memberId ?? null, message: input.message ?? (messages.join(" · ") || "Changed the pipeline step"),
    });
  } catch (error) {
    if (error instanceof RevisionConflict) throw flowError("step_conflict", error.message, { stepId });
    throw error;
  }
  const fresh = await loadRecipe(flowId);
  const updated = fresh?.steps.find((entry) => entry.id === stepId);
  if (fresh && updated) for (const output of next.outputs) await ensurePipelineOutputDataset(fresh, updated, output, next.pipelineId, input.actor.userId);
  if (next.pinnedRunId && next.pinnedRunId !== config.pinnedRunId && fresh && updated) {
    // The pinned tables follow the run at once; the step reads ◇ out of date until the recipe runs.
    const { writePipelineOutputs } = await import("./pipeline-step-runs");
    await writePipelineOutputs({ targetKey: fresh.flow.targetKey, analysisId: stepId, stepName: updated.name, pipelineRunId: next.pinnedRunId, pipelineId: next.pipelineId, outputs: next.outputs, userId: input.actor.userId }).catch(() => []);
  }
  return true;
}

/**
 * A waiting step whose pipeline is now installed: declare its outputs and settle its version (a new revision). Called
 * when an admin installs the pipeline the step asked for.
 */
export async function settleWaitingStep(analysisId: string, actor: RecipeActor): Promise<boolean> {
  const analysis = await db.exploreAnalysis.findUnique({ where: { id: analysisId }, select: { flowId: true } });
  if (!analysis?.flowId) return false;
  const model = await loadRecipe(analysis.flowId);
  const step = model?.steps.find((entry) => entry.id === analysisId);
  const config = step?.stepKind === "pipeline" ? parsePipelineStepConfig(step.pipeline) : null;
  const info = config ? pipelineInfo(config.pipelineId) : null;
  if (!model || !step || !config?.requestId || !info) return false;
  const taken = takenNames(model);
  const next: PipelineStepConfig = { ...config, version: info.version, requestId: null, outputs: tableOutputsOf(config.pipelineId).map((output) => ({ outputId: output.outputId, name: uniqueName(output.name, taken) })) };
  const { refused } = validateStepParams(info.definition, next.params, await storedPipelineConfig(config.pipelineId));
  if (refused.length) next.params = {};
  await createRevision({ analysisId, code: pipelineStepCode(next), params: next.params, pipeline: pipelineJsonOf(next), author: "user", authorUserId: actor.userId, authorMemberId: actor.memberId ?? null, message: `${info.name} ${info.version} is installed` });
  await db.exploreAnalysis.update({ where: { id: analysisId }, data: { name: step.name === config.pipelineId ? info.name : step.name, environmentName: `pipeline:${config.pipelineId}`, purpose: step.purpose === "Waiting to be installed." ? (info.description.split(/(?<=\.)\s/)[0] || null) : step.purpose } });
  const fresh = await loadRecipe(analysis.flowId);
  const updated = fresh?.steps.find((entry) => entry.id === analysisId);
  if (fresh && updated) for (const output of next.outputs) await ensurePipelineOutputDataset(fresh, updated, output, next.pipelineId, actor.userId);
  return true;
}

// ---------------------------------------------------------------------------
// Ready to run: checks in plain sentences, each with one fix
// ---------------------------------------------------------------------------

export type PipelineCheckId = "installed" | "enabled" | "version" | "samples" | "reads" | "reference" | "settings" | "compute" | "permission";
export type PipelineFixKind = "ask-install" | "ask-admin" | "install-reference" | "switch-version" | "add-reads" | "open-step" | "match-samples" | "single-end" | "set-setting" | "reset-settings" | "clean-names";
export interface PipelineFix { kind: PipelineFixKind; label: string; stepId?: string; referenceId?: string; sizeBytes?: number | null; requestId?: string; version?: string; key?: string }
export interface PipelineCheck { id: PipelineCheckId; ok: boolean; words: string; detail?: string | null; fix?: PipelineFix | null }
export interface PipelinePreflight {
  stepId: string | null;
  pipelineId: string;
  ready: boolean;
  /** "4 of 5 checks pass", or "Ready to run". */
  words: string;
  checks: PipelineCheck[];
  estimate: { seconds: number | null; words: string; samples: number };
  where: string;
  /** The pipeline's schema as the step (or the draft of the add form) would have it: settings with the values it would
   *  run with (preset, own settings, defaults), every table it can keep, its files and reference databases. Absent
   *  while the pipeline is not installed here (its schema arrives with it) and for a pinned run. */
  settings?: PipelineSetting[];
  settingsCount?: number;
  outputs?: Array<{ outputId: string; name: string; label: string; tableKind: string | null }>;
  files?: Array<{ outputId: string; label: string; kind: "report" | "figure" | "file" }>;
  references?: Array<{ id: string; label: string; installed: boolean; sizeBytes: number | null }>;
}

export interface PreflightDraft { pipelineId: string; version?: string | null; params?: Record<string, unknown> | null; presetId?: string | null; samples?: PipelineSamplesSpec | null; requestId?: string | null }

const bytesWords = (bytes: number | null | undefined) => {
  if (!bytes || !Number.isFinite(bytes)) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};

/**
 * Whether a pipeline step (or a draft of one, before it is added) can run now: installed and switched on, the pinned
 * version, reads found (for the samples it runs on), the sample list's columns, reference databases, settings, who may
 * start it, and an estimate. Every failing check says why and offers one fix. Run recipe waits until all pass.
 */
export async function preflightPipeline(flowId: string, target: { stepId: string } | { draft: PreflightDraft }, access: PipelineAccess, labKey?: string | null): Promise<PipelinePreflight> {
  await requirePipelineSteps();
  const model = await loadRecipe(flowId);
  if (!model) throw flowError("not_found", "Flow not found");
  let config: PipelineStepConfig;
  let stepId: string | null = null;
  if ("stepId" in target) {
    config = pipelineStepOf(model, target.stepId).config;
    stepId = target.stepId;
  } else {
    const draft = target.draft;
    const params = { ...(await presetParams(draft.presetId, draft.pipelineId, labKey)), ...record(draft.params) };
    config = { pipelineId: draft.pipelineId, version: draft.version ?? pipelineInfo(draft.pipelineId)?.version ?? "", params, samples: draft.samples ?? null, outputs: [], requestId: draft.requestId ?? null };
  }
  return preflightConfig(model, config, stepId, access);
}

export async function preflightConfig(model: RecipeModel, config: PipelineStepConfig, stepId: string | null, access: PipelineAccess): Promise<PipelinePreflight> {
  const checks: PipelineCheck[] = [];
  const settings = await getExecutionSettings();
  const where = settings.useSlurm ? "SeqDesk · SLURM" : "this server";
  const info = pipelineInfo(config.pipelineId);
  const name = info?.name ?? config.pipelineId;
  let schema: Pick<PipelinePreflight, "settings" | "settingsCount" | "outputs" | "files" | "references"> = {};
  const done = (samples: number, seconds: number | null): PipelinePreflight => {
    const failing = checks.filter((check) => !check.ok).length;
    return { stepId, pipelineId: config.pipelineId, ready: failing === 0, words: failing ? `${checks.length - failing} of ${checks.length} checks pass` : "Ready to run", checks,
      estimate: { seconds, words: seconds == null ? "no estimate yet" : `about ${durationWords(seconds)} on ${plural(samples, "sample")}`, samples }, where, ...schema };
  };

  if (config.pinnedRunId) {
    const run = await db.pipelineRun.findUnique({ where: { id: config.pinnedRunId }, select: { status: true, runNumber: true, runFolder: true } });
    const ok = run?.status === "completed";
    checks.push({ id: "installed", ok, words: ok ? `reads the tables of ${run!.runNumber}, pinned; nothing reruns` : "the pinned run is gone from Data", fix: ok ? null : { kind: "open-step", label: "Choose another run", stepId: stepId ?? undefined } });
    return done(0, 0);
  }
  if (!info) {
    // A withdrawn request asks nothing any more: the step offers to ask again.
    const stored = config.requestId ? await db.explorePipelineInstallRequest.findUnique({ where: { id: config.requestId } }) : null;
    const request = stored?.status === "withdrawn" ? null : stored;
    const asked = request ? ` · asked by ${request.requestedByName ?? "a member"}, ${request.createdAt.toISOString().slice(0, 10)}` : "";
    checks.push({ id: "installed", ok: false, words: request?.status === "declined" ? `${name} will not be installed: ${request.decisionNote ?? "an admin said no"}` : `${name} is not installed on this server yet${asked}`,
      fix: request ? (access.canManage && request.status === "pending" ? { kind: "ask-install", label: "Install", requestId: request.id } : null) : { kind: "ask-install", label: access.canManage ? "Install" : "Ask to install" } });
    return done(0, null);
  }
  const enabled = await getPipelineEnabled(config.pipelineId);
  if (!enabled) checks.push({ id: "enabled", ok: false, words: `${info.name} is switched off on this server`, fix: { kind: "ask-admin", label: access.canManage ? "Switch it on" : "Ask an admin" } });
  if (config.version && config.version !== info.version) checks.push({ id: "version", ok: false, words: `the step is pinned to ${info.name} ${config.version}; this server has ${info.version}`, fix: { kind: "switch-version", label: `Use ${info.version}`, version: info.version } });

  // Samples and reads
  const reads = await stepReads(model.flow.targetKey, config.samples, config.exclusions);
  if (config.samples?.from === "table") {
    const list = reads.sampleList;
    const dataset = config.samples.datasetId ? model.datasets.get(config.samples.datasetId) : undefined;
    const producer = dataset?.producer ? model.steps.find((step) => step.id === dataset.producer) : undefined;
    if (!dataset) checks.push({ id: "samples", ok: false, words: "the sample list is gone", fix: { kind: "open-step", label: "Choose a sample list", stepId: stepId ?? undefined } });
    else if (!dataset.current) checks.push({ id: "samples", ok: producer ? true : false, words: producer ? `the sample list fills when step ${model.labels.get(producer.id)} runs` : `${dataset.name} has no rows yet`, fix: producer ? null : { kind: "open-step", label: "Choose a sample list", stepId: stepId ?? undefined } });
    else if (!list?.column) checks.push({ id: "samples", ok: false, words: `the sample list has no column naming the samples (sample); it has ${(list?.columns ?? []).slice(0, 5).join(", ")}`, fix: { kind: "open-step", label: producer ? `Open step ${model.labels.get(producer.id)}` : "Choose the column", stepId: producer?.id ?? stepId ?? undefined } });
    else {
      const pairedOnly = pipelineRequiresPairedReads(info.definition.input.perSample);
      const missingMate = pairedOnly ? reads.pairs.filter((pair) => !pair.r2).map((pair) => pair.sampleId) : [];
      // The samplesheet takes the list's names: a name with spaces or signs it does not take stops the pipeline at once.
      const unclean = [...new Set(Object.values(reads.names ?? {}).filter((name) => /[^A-Za-z0-9._-]/.test(name)))];
      if (unclean.length) checks.push({ id: "samples", ok: false, words: `${plural(unclean.length, "sample name")} ${unclean.length === 1 ? "has" : "have"} spaces or signs the samplesheet does not take: ${unclean.slice(0, 3).map((name) => `“${name}”`).join(", ")}${unclean.length > 3 ? ", …" : ""}`,
        fix: producer?.stepKind === "samples" ? { kind: "clean-names", label: `Clean names in step ${model.labels.get(producer.id)}`, stepId: producer.id } : { kind: "open-step", label: producer ? `Open step ${model.labels.get(producer.id)}` : "Choose the column", stepId: producer?.id ?? stepId ?? undefined } });
      else checks.push({ id: "samples", ok: !reads.unmatched.length && !reads.ambiguous.length && !missingMate.length,
        words: reads.unmatched.length ? `${plural(reads.unmatched.length, "sample")} on the sample list ${reads.unmatched.length === 1 ? "has" : "have"} no reads: ${reads.unmatched.slice(0, 4).join(", ")}${reads.unmatched.length > 4 ? ", …" : ""}`
          : reads.ambiguous.length ? `${plural(reads.ambiguous.length, "name")} match more than one sample: ${reads.ambiguous.slice(0, 4).join(", ")}`
          : missingMate.length ? `${plural(missingMate.length, "sample")} ${missingMate.length === 1 ? "has" : "have"} no second read file; ${info.name} needs both for paired reads`
          : `the sample list fits ${info.name}: ${list.column}, ${plural(reads.samples.length, "sample")} with reads`,
        fix: reads.unmatched.length || reads.ambiguous.length ? { kind: "match-samples", label: "Match by hand…", stepId: producer?.id ?? stepId ?? undefined } : missingMate.length ? { kind: "single-end", label: "Single-end instead", stepId: stepId ?? undefined } : null });
    }
  }
  const sizeBytes = (await db.managedFile.findMany({ where: { id: { in: reads.key.files.map((file) => file.id) } }, select: { sizeBytes: true } })).reduce((sum, file) => sum + Number(file.sizeBytes), 0);
  const fileCount = reads.key.files.length;
  const sampleCount = reads.samples.length;
  // A sample list a step above has not made yet: its reads are taken when that step runs (checked again then).
  const listDataset = config.samples?.from === "table" && config.samples.datasetId ? model.datasets.get(config.samples.datasetId) : undefined;
  const listProducer = listDataset && !listDataset.current && listDataset.producer ? model.steps.find((step) => step.id === listDataset.producer) : undefined;
  checks.push(!sampleCount && listProducer
    ? { id: "reads", ok: true, words: `reads are taken for the samples on the list when step ${model.labels.get(listProducer.id)} runs` }
    : sampleCount
    ? { id: "reads", ok: true, words: `reads found for ${plural(sampleCount, "sample")}`, detail: [fileCount ? plural(fileCount, "file") : null, reads.records ? plural(reads.records, "imported read record") : null, bytesWords(sizeBytes)].filter(Boolean).join(" · ") || null }
    : { id: "reads", ok: false, words: "there are no FASTQ reads in this study’s Data yet", fix: { kind: "add-reads", label: "Add reads in Data" } });

  // Reference databases
  const stored = await storedPipelineConfig(config.pipelineId);
  const databases = await getPipelineDatabaseStatuses(config.pipelineId, { ...stored, ...config.params }, settings.pipelineRunDir, (settings as { pipelineDatabaseDir?: string | null }).pipelineDatabaseDir).catch(() => []);
  // The schema as this step (or the add form's draft) would run it: settings with their values, tables, files, references.
  const stepSettings = pipelineSettings(info.definition, config.params, stored);
  // A draft names its tables as adding it would (fastqc_summary_2 when the flow has one already); a step keeps its own.
  const taken = stepId ? null : takenNames(model);
  schema = {
    settings: stepSettings, settingsCount: stepSettings.length,
    outputs: tableOutputsOf(config.pipelineId).map((output) => ({ outputId: output.outputId, name: config.outputs.find((kept) => kept.outputId === output.outputId)?.name ?? (taken ? uniqueName(output.name, taken) : output.name), label: output.label, tableKind: output.tableKind })),
    files: fileOutputsOf(config.pipelineId),
    references: databases.map((database) => ({ id: database.id, label: database.label, installed: database.status === "downloaded", sizeBytes: database.sizeBytes ?? null })),
  };
  for (const database of databases) {
    const ok = database.status === "downloaded";
    const label = database.label.replace(/\s+database$/i, "");
    checks.push({ id: "reference", ok, words: ok ? `${label} is installed` : `${label} is not installed on this server`,
      detail: database.version ?? null,
      fix: ok ? null : access.canManage ? { kind: "install-reference", label: `Install${bytesWords(database.sizeBytes) ? ` · ${bytesWords(database.sizeBytes)}` : ""}`, referenceId: database.id, sizeBytes: database.sizeBytes ?? null } : { kind: "ask-admin", label: "Ask an admin", referenceId: database.id } });
  }

  // Settings
  const { refused, missing } = validateStepParams(info.definition, config.params, stored);
  const settingsOk = !refused.length && !missing.length;
  const properties = info.definition.configSchema?.properties ?? {};
  const keyOf = (title: string) => Object.entries(properties).find(([key, property]) => (property.title || key) === title)?.[0];
  // A setting only an admin sets (a database folder, a pinned index) is not the step's to set: the admin sets it in SeqDesk.
  const settable = missing.find((title) => { const key = keyOf(title); return !key || !HIDDEN_PLACEMENTS.has(placementOf(properties[key]) ?? ""); });
  checks.push({ id: "settings", ok: settingsOk, words: settingsOk ? "settings are valid" : [...refused, ...missing.map((field) => `${field} needs a value`)].join(" · "),
    fix: settingsOk ? null : settable ? { kind: "set-setting", label: `Set ${settable}`, key: keyOf(settable) }
      : missing.length ? { kind: "ask-admin", label: access.canManage ? "Set it in the pipeline’s settings" : "Ask an admin", key: keyOf(missing[0]) }
      : { kind: "reset-settings", label: "Reset to defaults" } });

  // Who runs it
  const start = await pipelineStartAccess(model.flow.targetKey, access);
  if (!start.ok) checks.push({ id: "permission", ok: false, words: start.words ?? "You may not start pipelines here.", fix: { kind: "ask-admin", label: "Ask an admin" } });

  // Compute and estimate
  // No samples yet (no reads, or a list a step above makes): no estimate rather than "about 42 s on 0 samples".
  const durations = sampleCount ? await pastDurations(config.pipelineId, sampleCount) : [];
  const sorted = [...durations].sort((a, b) => a - b);
  const seconds = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
  // Fits the server, but the study's limit of pipelines at once is reached: it waits for a free slot.
  const slot = await import("./pipeline-limits").then((limits) => limits.pipelineCapacity(model.flow.targetKey)).catch(() => null);
  checks.push({ id: "compute", ok: true, words: `${slot && !slot.free ? "fits; waits for a free slot on" : "fits on"} ${where}${seconds != null ? ` · about ${durationWords(seconds)}` : ""}`, detail: seconds == null ? "no estimate yet: no finished runs of this pipeline at this size" : null });
  return done(sampleCount, seconds);
}

// ---------------------------------------------------------------------------
// Reads changed since the step's run
// ---------------------------------------------------------------------------

/** The reads key the step's run recorded (results.pipeline.readsHash), compared with the reads now. */
export async function pipelineReadsChanged(model: RecipeModel, records: Map<string, StepRecord>): Promise<Map<string, string>> {
  const changed = new Map<string, string>();
  const steps = model.steps.filter((step) => step.stepKind === "pipeline");
  if (!model.steps.some((step) => step.stepKind !== "code") || !(await pipelineStepsAvailable())) return changed;
  // Choose samples steps whose reads changed, and steps reading a pipeline's tables after samples were left out of them.
  const { samplesAndQualityChanged } = await import("./pipeline-quality");
  for (const [id, words] of await samplesAndQualityChanged(model, records).catch(() => new Map<string, string>())) changed.set(id, words);
  if (!steps.length) return changed;
  const runs = await db.exploreAnalysisRun.findMany({ where: { id: { in: steps.map((step) => records.get(step.id)?.stepRunId).filter((id): id is string => Boolean(id)) } }, select: { id: true, analysisId: true, results: true } });
  for (const step of steps) {
    const config = parsePipelineStepConfig(step.pipeline);
    const run = runs.find((entry) => entry.analysisId === step.id && entry.id === records.get(step.id)?.stepRunId);
    if (!config || config.pinnedRunId || !run) continue;
    const recorded = record(record(parseJsonObject(run.results)).pipeline);
    const before = typeof recorded.readsKey === "string" ? recorded.readsKey : null;
    if (!before) continue;
    const reads = await stepReads(model.flow.targetKey, config.samples, config.exclusions);
    const now = sha256(canonicalJson(reads.key));
    if (now === before) continue;
    const was = typeof recorded.sampleCount === "number" ? recorded.sampleCount : null;
    const delta = was !== null ? reads.samples.length - was : 0;
    changed.set(step.id, delta > 0 ? `${plural(delta, "sample")} new since Run #${records.get(step.id)?.flowRunNumber ?? "?"}` : delta < 0 ? `${plural(-delta, "sample")} fewer since Run #${records.get(step.id)?.flowRunNumber ?? "?"}` : `the reads in Data changed since Run #${records.get(step.id)?.flowRunNumber ?? "?"}`);
  }
  return changed;
}

export const readsKeyHash = (key: ReadsKey) => sha256(canonicalJson(key));

// ---------------------------------------------------------------------------
// Runs of this study's Data a step can read ("Use an existing run")
// ---------------------------------------------------------------------------

export interface PinnableRun { id: string; runNumber: string; pipelineId: string; pipelineName: string; version: string | null; samples: number | null; startedBy: string | null; completedAt: string | null; durationSeconds: number | null; tables: string[] }

export async function pinnableRuns(targetKey: string, pipelineId?: string | null): Promise<PinnableRun[]> {
  const study = await findDataStudy(targetKey);
  if (!study) return [];
  const runs = await db.pipelineRun.findMany({
    where: { studyId: study.id, status: "completed", ...(pipelineId ? { pipelineId } : {}) }, orderBy: { completedAt: "desc" }, take: 50,
    select: { id: true, runNumber: true, pipelineId: true, inputSampleIds: true, startedAt: true, completedAt: true, user: { select: { firstName: true, lastName: true, email: true } }, artifacts: { select: { outputId: true }, distinct: ["outputId"] } },
  });
  return runs.flatMap((run) => {
    const outputs = new Set(run.artifacts.map((artifact) => artifact.outputId).filter(Boolean));
    const tables = tableOutputsOf(run.pipelineId).filter((output) => outputs.has(output.outputId)).map((output) => output.name);
    if (!tables.length) return [];
    let samples: number | null = null;
    try { const ids = JSON.parse(run.inputSampleIds ?? "null"); samples = Array.isArray(ids) ? ids.length : null; } catch { samples = null; }
    const info = pipelineInfo(run.pipelineId);
    return [{ id: run.id, runNumber: run.runNumber, pipelineId: run.pipelineId, pipelineName: info?.name ?? run.pipelineId, version: info?.version ?? null, samples,
      startedBy: run.user ? [run.user.firstName, run.user.lastName].filter(Boolean).join(" ") || run.user.email : null, completedAt: run.completedAt?.toISOString() ?? null,
      durationSeconds: run.startedAt && run.completedAt ? Math.round((run.completedAt.getTime() - run.startedAt.getTime()) / 1000) : null, tables }];
  });
}

/** A file of a run folder exists (outputs not pruned); used before reusing a cached run. */
export async function runFolderPresent(runFolder: string | null | undefined): Promise<boolean> {
  if (!runFolder) return false;
  return fs.stat(path.resolve(runFolder)).then((stat) => stat.isDirectory(), () => false);
}
