/**
 * Samples of a pipeline step, during and after a run (identity sheet 96 f5, f7): one bad sample left out while a
 * pipeline works sample by sample ("Leave it out and continue"), and the quality line after a run — from the pipeline's
 * quality table (MultiQC general statistics, or its own summary) against the lab preset's thresholds or the pipeline's
 * — with "Leave them out" and Undo.
 *
 * Leaving samples out records them (reason, person, date) where the samples are chosen: the Choose samples step that
 * makes the pipeline's sample list, or the pipeline step itself when it runs on every sample in Data. After a run the
 * pipeline is not run again: its tables get a new version without those samples, so the steps that read them turn out
 * of date and read the filtered tables; the next time the pipeline runs they are not in its samplesheet. Undo puts the
 * tables back as they were and takes the samples back.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import { createRevision, RevisionConflict } from "./analyses";
import { fetchAllDatasetRows, writeDatasetVersion } from "./datasets";
import { loadRecipe, type RecipeActor, type RecipeModel, type RecipeStep, type StepRecord } from "./recipe";
import { parseJsonObject, parseSchema } from "./schema";
import { canonicalJson, parsePipelineStepConfig, pipelineInfo, pipelineJsonOf, pipelineStepCode, type PipelineAccess, type PipelineStepConfig } from "./pipeline-steps";
import { snapshotOf, type PipelineSnapshot } from "./pipeline-step-runs";
import { notPerSampleWords, pipelineRecord, worksPerSample, type PipelineQcMetric } from "./pipeline-record";
import { exclusionWords, samplesList, type SamplesExclusion } from "./sample-exclusions";
import type { ExploreRowData, ExploreSchema } from "./types";

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const plural = (count: number, word: string, many = `${word}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? word : many}`;
type Actor = RecipeActor & { name?: string | null };

// ---------------------------------------------------------------------------
// Thresholds: the lab preset's, else the pipeline's
// ---------------------------------------------------------------------------

/** Where a preset keeps its quality thresholds (beside its settings; never a setting of the pipeline). */
export const THRESHOLDS_KEY = "_thresholds";

export interface QualityThreshold { column: string; label: string; min: number | null; max: number | null; unit: string | null }

export function parseThresholds(raw: unknown): QualityThreshold[] {
  return (Array.isArray(raw) ? raw : []).slice(0, 10).flatMap((entry) => {
    const value = record(entry);
    const column = typeof value.column === "string" && value.column.trim() ? value.column.trim().slice(0, 200) : null;
    const min = typeof value.min === "number" && Number.isFinite(value.min) ? value.min : null;
    const max = typeof value.max === "number" && Number.isFinite(value.max) ? value.max : null;
    if (!column || (min === null && max === null)) return [];
    return [{ column, label: typeof value.label === "string" && value.label.trim() ? value.label.trim().slice(0, 80) : column, min, max, unit: typeof value.unit === "string" ? value.unit.slice(0, 40) : null }];
  });
}

/** A preset's settings and its thresholds, apart. */
export function splitPresetParams(params: Record<string, unknown>): { settings: Record<string, unknown>; thresholds: QualityThreshold[] } {
  const { [THRESHOLDS_KEY]: raw, ...settings } = params;
  return { settings, thresholds: parseThresholds(raw) };
}

const thresholdWords = (threshold: QualityThreshold) => {
  const unit = threshold.unit ?? threshold.label;
  const value = (n: number) => `${n.toLocaleString("en-US")}${unit ? ` ${unit}` : ""}`;
  return threshold.min !== null && threshold.max !== null ? `${value(threshold.min)} to ${value(threshold.max)}` : threshold.min !== null ? value(threshold.min) : `at most ${value(threshold.max!)}`;
};

// ---------------------------------------------------------------------------
// Tables without some samples
// ---------------------------------------------------------------------------

const SAMPLE_COLUMNS = ["sample_id", "sample", "Sample", "sampleID", "sample_name"];

/** A table without some samples: rows naming them (long tables) and columns named after them (wide tables). Pure. */
export function withoutSamples(schema: ExploreSchema, rows: ExploreRowData[], samples: Set<string>, sampleColumn?: string | null): { schema: ExploreSchema; rows: ExploreRowData[]; removedRows: number; removedColumns: string[] } {
  const keys = schema.columns.map((column) => column.key);
  const identity = [sampleColumn, ...SAMPLE_COLUMNS].filter((key): key is string => Boolean(key) && keys.includes(key!));
  const kept = identity.length ? rows.filter((row) => !identity.some((key) => samples.has(String(row[key] ?? "")))) : rows;
  const removedColumns = identity.length ? [] : keys.filter((key) => samples.has(key));
  const filtered = removedColumns.length ? kept.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !removedColumns.includes(key)))) : kept;
  return { schema: removedColumns.length ? { ...schema, columns: schema.columns.filter((column) => !removedColumns.includes(column.key)) } : schema, rows: filtered, removedRows: rows.length - kept.length, removedColumns };
}

// ---------------------------------------------------------------------------
// Where samples are left out: the Choose samples step, or the pipeline step itself
// ---------------------------------------------------------------------------

export interface ExclusionHome { kind: "samples-step" | "pipeline-step"; stepId: string; label: string; exclusions: SamplesExclusion[] }

/** The step that keeps a pipeline step's left-out samples. */
export function exclusionHome(model: RecipeModel, step: RecipeStep, config: PipelineStepConfig): ExclusionHome {
  const dataset = config.samples?.from === "table" && config.samples.datasetId ? model.datasets.get(config.samples.datasetId) : undefined;
  const producer = dataset?.producer ? model.steps.find((candidate) => candidate.id === dataset.producer) : undefined;
  if (producer?.stepKind === "samples") {
    const exclusions = record(producer.pipeline).exclusions;
    return { kind: "samples-step", stepId: producer.id, label: model.labels.get(producer.id) ?? "1", exclusions: parseExclusionsSafe(exclusions) };
  }
  return { kind: "pipeline-step", stepId: step.id, label: model.labels.get(step.id) ?? "?", exclusions: config.exclusions ?? [] };
}

function parseExclusionsSafe(raw: unknown): SamplesExclusion[] {
  return (Array.isArray(raw) ? raw : []) as SamplesExclusion[];
}

/** Write the left-out samples into their home as a new revision with the same code (nothing turns out of date). */
async function writeExclusions(flowId: string, home: ExclusionHome, change: (current: SamplesExclusion[]) => SamplesExclusion[], actor: Actor, message: string): Promise<SamplesExclusion[]> {
  if (home.kind === "samples-step") {
    const { reviseSamplesStep } = await import("./samples-step");
    let written: SamplesExclusion[] = [];
    await reviseSamplesStep(flowId, home.stepId, (config) => { written = change(config.exclusions); return { ...config, exclusions: written }; }, { actor, message });
    return written;
  }
  const model = await loadRecipe(flowId);
  const step = model?.steps.find((candidate) => candidate.id === home.stepId);
  const config = step ? parsePipelineStepConfig(step.pipeline) : null;
  if (!step || !config) throw flowError("not_found", "That step is not part of this flow.");
  const exclusions = change(config.exclusions ?? []);
  const next: PipelineStepConfig = { ...config, exclusions };
  try {
    await createRevision({
      analysisId: step.id, expectedRevisionId: step.revision?.id, code: pipelineStepCode(next), params: next.params, pipeline: pipelineJsonOf(next),
      author: "user", authorUserId: actor.userId, authorMemberId: actor.memberId ?? null, message,
    });
  } catch (error) {
    if (error instanceof RevisionConflict) throw flowError("step_conflict", error.message, { stepId: step.id });
    throw error;
  }
  return exclusions;
}

const person = (actor: Actor) => ({ userId: actor.userId, memberId: actor.memberId ?? null, name: actor.name ?? null });

// ---------------------------------------------------------------------------
// The quality line
// ---------------------------------------------------------------------------

export interface PipelineQuality {
  /** The table it is read from (qc_summary, fastqc_summary). */
  output: string;
  datasetId: string | null;
  versionId: string | null;
  total: number;
  passing: number;
  failing: Array<{ sample: string; values: Array<{ label: string; value: number | null; words: string }> }>;
  thresholds: Array<QualityThreshold & { source: "preset" | "pipeline"; words: string }>;
  /** "210 of 212 samples pass · 2 below 10,000 reads: A-17 3,120 · N-03 8,904". */
  words: string;
  /** "threshold 10,000 reads (lab preset)". */
  thresholdWords: string;
  /** Samples already left out after this step's run, with who and when; Undo takes them back. */
  leftOut: { samples: string[]; reason: string; by: string | null; at: string | null; words: string; canUndo: boolean } | null;
  /** Where left-out samples are recorded ("step 1"). */
  recordedIn: { stepId: string; label: string };
  source: "record";
}

function metricColumn(keys: string[], metric: PipelineQcMetric | QualityThreshold): string | null {
  if (keys.includes(metric.column)) return metric.column;
  const lower = metric.column.toLowerCase();
  return keys.find((key) => key.toLowerCase().endsWith(lower)) ?? null;
}

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = typeof value === "string" && value.trim() ? Number(value.replace(/,/g, "")) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/** Pure: per sample, the values of the thresholds' columns (the smallest when a sample has rows per read file). */
export function judgeQuality(rows: Array<Record<string, unknown>>, columns: string[], thresholds: QualityThreshold[], sampleColumn: string | null): { total: number; passing: number; failing: PipelineQuality["failing"] } {
  const identity = [sampleColumn, ...SAMPLE_COLUMNS].find((key) => key && columns.includes(key)) ?? null;
  const resolved = thresholds.map((threshold) => ({ threshold, column: metricColumn(columns, threshold) })).filter((entry): entry is { threshold: QualityThreshold; column: string } => Boolean(entry.column));
  const bySample = new Map<string, Map<string, number | null>>();
  for (const row of rows) {
    const sample = identity ? String(row[identity] ?? "").trim() : "";
    if (!sample) continue;
    const values = bySample.get(sample) ?? new Map<string, number | null>();
    for (const { threshold, column } of resolved) {
      const value = asNumber(row[column]);
      const was = values.get(threshold.column);
      values.set(threshold.column, was === undefined || was === null ? value : value === null ? was : threshold.max !== null && threshold.min === null ? Math.max(was, value) : Math.min(was, value));
    }
    bySample.set(sample, values);
  }
  const failing: PipelineQuality["failing"] = [];
  for (const [sample, values] of bySample) {
    const bad = resolved.flatMap(({ threshold }) => {
      const value = values.get(threshold.column) ?? null;
      if (value === null) return [];
      if ((threshold.min !== null && value < threshold.min) || (threshold.max !== null && value > threshold.max)) return [{ label: threshold.label, value, words: value.toLocaleString("en-US") }];
      return [];
    });
    if (bad.length) failing.push({ sample, values: bad });
  }
  failing.sort((a, b) => (a.values[0]?.value ?? 0) - (b.values[0]?.value ?? 0));
  return { total: bySample.size, passing: bySample.size - failing.length, failing };
}

/** The quality line of a pipeline step's run, from its quality table; null when the pipeline has none or kept none. */
export async function qualityOf(model: RecipeModel, step: RecipeStep, config: PipelineStepConfig): Promise<PipelineQuality | null> {
  const spec = pipelineRecord(config.pipelineId).qc;
  if (!spec) return null;
  const kept = config.outputs.find((output) => output.outputId === spec.output || output.name === spec.output);
  if (!kept) return null;
  const dataset = [...model.datasets.values()].find((candidate) => candidate.producer === step.id && candidate.artifactName === kept.name);
  if (!dataset?.current) return null;
  // The lab preset's thresholds, else the pipeline's.
  const preset = config.presetId ? await db.explorePipelinePreset.findUnique({ where: { id: config.presetId } }).catch(() => null) : null;
  const fromPreset = preset && !preset.archivedAt ? splitPresetParams(record(preset.params)).thresholds : [];
  const thresholds: QualityThreshold[] = fromPreset.length ? fromPreset : spec.metrics.map((metric) => ({ column: metric.column, label: metric.label, min: metric.min ?? null, max: metric.max ?? null, unit: metric.unit ?? null }));
  if (!thresholds.length) return null;
  const source: "preset" | "pipeline" = fromPreset.length ? "preset" : "pipeline";
  const columns = parseSchema(dataset.current.schema).columns.map((column) => column.key);
  const rows = (await fetchAllDatasetRows(dataset.current.id)).map((row) => row.data as Record<string, unknown>);
  const judged = judgeQuality(rows, columns, thresholds, spec.sampleColumn);
  const home = exclusionHome(model, step, config);
  const left = home.exclusions.filter((exclusion) => exclusion.stage === "after" && exclusion.stepId === step.id);
  const first = thresholds[0];
  const failingWords = judged.failing.length
    ? ` · ${judged.failing.length} ${first.min !== null ? `below ${thresholdWords(first)}` : `above ${thresholdWords(first)}`}: ${judged.failing.slice(0, 4).map((entry) => `${entry.sample} ${entry.values[0]?.words ?? ""}`.trim()).join(" · ")}${judged.failing.length > 4 ? " · …" : ""}`
    : "";
  const leftWords = left.length ? ` · ${left.length} left out after QC (${samplesList(left.map((entry) => entry.sample))})` : "";
  return {
    output: kept.name, datasetId: dataset.id, versionId: dataset.current.id,
    total: judged.total, passing: judged.passing, failing: judged.failing,
    thresholds: thresholds.map((threshold) => ({ ...threshold, source, words: thresholdWords(threshold) })),
    words: `${judged.passing.toLocaleString("en-US")} of ${plural(judged.total, "sample")} pass${failingWords}${leftWords}`,
    thresholdWords: `threshold ${thresholds.map(thresholdWords).join(", ")} (${source === "preset" ? "lab preset" : "pipeline default"})`,
    leftOut: left.length ? { samples: left.map((entry) => entry.sample), reason: left[0].reason, by: left[0].by.name, at: left[0].at || null, words: exclusionWords(left[0]), canUndo: left.some((entry) => entry.tables?.length) } : null,
    recordedIn: { stepId: home.stepId, label: home.label },
    source: "record",
  };
}

// ---------------------------------------------------------------------------
// Leave them out (after a run), Undo
// ---------------------------------------------------------------------------

async function pipelineStep(flowId: string, stepId: string): Promise<{ model: RecipeModel; step: RecipeStep; config: PipelineStepConfig }> {
  const model = await loadRecipe(flowId);
  if (!model) throw flowError("not_found", "Flow not found");
  const step = model.steps.find((candidate) => candidate.id === stepId);
  const config = step?.stepKind === "pipeline" ? parsePipelineStepConfig(step.pipeline) : null;
  if (!step || !config) throw flowError("invalid_request", "That step is not a pipeline step.");
  return { model, step, config };
}

/**
 * Leave samples out after a run (by default those below the quality line): recorded where the samples are chosen,
 * and the step's tables get a version without them, so the steps that read them turn out of date. Nothing reruns.
 */
export async function leaveOutAfterQuality(flowId: string, stepId: string, input: { samples?: string[] | null; reason?: string | null; actor: Actor }): Promise<{ quality: PipelineQuality | null; samples: string[]; tables: number; recordedIn: { stepId: string; label: string } }> {
  const { model, step, config } = await pipelineStep(flowId, stepId);
  const quality = await qualityOf(model, step, config);
  const samples = [...new Set((input.samples?.length ? input.samples : quality?.failing.map((entry) => entry.sample)) ?? [])].filter(Boolean);
  if (!samples.length) throw flowError("invalid_request", quality ? "Every sample passes the quality line; nothing to leave out." : "Name the samples to leave out.");
  const first = quality?.thresholds[0];
  const reason = input.reason?.trim().slice(0, 500) || (first ? `below ${first.words}` : "left out after QC");
  // The step's tables without them: a new version of each (the steps that read them turn out of date).
  const excluded = new Set(samples);
  const tables: Array<{ datasetId: string; before: string | null; after: string }> = [];
  const day = new Date();
  for (const output of config.outputs) {
    const dataset = [...model.datasets.values()].find((candidate) => candidate.producer === step.id && candidate.artifactName === output.name);
    if (!dataset?.current) continue;
    const version = await db.exploreDatasetVersion.findUnique({ where: { id: dataset.current.id }, select: { id: true, schema: true, provenance: true } });
    if (!version) continue;
    const rows = (await fetchAllDatasetRows(version.id)).map((row) => row.data as ExploreRowData);
    const filtered = withoutSamples(parseSchema(version.schema), rows, excluded);
    if (!filtered.removedRows && !filtered.removedColumns.length) continue;
    const previous = record(parseJsonObject(version.provenance));
    const written = await writeDatasetVersion({
      datasetId: dataset.id, schema: filtered.schema, rows: filtered.rows, buildSource: "analysis-run", createdById: input.actor.userId,
      keys: { sample: filtered.rows.some((row) => row.sample_db_id) ? "sample_db_id" : filtered.schema.columns.some((column) => column.key === "sample_id") ? "sample_id" : undefined },
      provenance: {
        builtAt: day.toISOString(), builder: "pipeline-step-qc@1",
        sources: [{ type: "dataset-version", id: version.id, label: `${output.name} as the run wrote it` }, ...(Array.isArray(previous.sources) ? previous.sources as never[] : [])],
        notes: [`Left out after QC: ${samples.join(", ")} · ${reason} · ${input.actor.name ?? "a person"} · ${day.toISOString().slice(0, 10)}`],
      },
    });
    if (!written.unchanged) tables.push({ datasetId: dataset.id, before: version.id, after: written.versionId });
  }
  const home = exclusionHome(model, step, config);
  await writeExclusions(flowId, home, (current) => [
    ...current.filter((entry) => !excluded.has(entry.sample)),
    ...samples.map((sample) => ({ sample, reason, stage: "after" as const, by: person(input.actor), at: day.toISOString(), stepId: step.id, ...(tables.length ? { tables } : {}) })),
  ], input.actor, `Left out after QC: ${samplesList(samples)}`);
  const fresh = await loadRecipe(flowId);
  const freshStep = fresh?.steps.find((candidate) => candidate.id === stepId);
  const freshConfig = freshStep ? parsePipelineStepConfig(freshStep.pipeline) : null;
  return { quality: fresh && freshStep && freshConfig ? await qualityOf(fresh, freshStep, freshConfig) : null, samples, tables: tables.length, recordedIn: { stepId: home.stepId, label: home.label } };
}

/** Undo "Leave them out": the tables as the run wrote them (when nothing newer replaced them), the samples taken back. */
export async function undoQualityLeaveOut(flowId: string, stepId: string, input: { samples?: string[] | null; actor: Actor }): Promise<{ quality: PipelineQuality | null; samples: string[] }> {
  const { model, step, config } = await pipelineStep(flowId, stepId);
  const home = exclusionHome(model, step, config);
  const wanted = input.samples?.length ? new Set(input.samples) : null;
  const left = home.exclusions.filter((exclusion) => exclusion.stage === "after" && exclusion.stepId === step.id && (!wanted || wanted.has(exclusion.sample)));
  if (!left.length) throw flowError("invalid_request", "No samples were left out after this step’s run.");
  const back = new Set(left.map((entry) => entry.sample));
  // Each table back to the version before, unless a newer run already replaced it.
  const tables = new Map<string, { before: string | null; after: string }>();
  for (const entry of left) for (const table of entry.tables ?? []) tables.set(table.datasetId, table);
  const remaining = home.exclusions.filter((exclusion) => exclusion.stage === "after" && exclusion.stepId === step.id && !back.has(exclusion.sample));
  for (const [datasetId, table] of tables) {
    const dataset = await db.exploreDataset.findUnique({ where: { id: datasetId }, select: { currentVersionId: true } });
    if (!dataset || dataset.currentVersionId !== table.after || !table.before) continue;
    if (!remaining.length) { await db.exploreDataset.update({ where: { id: datasetId }, data: { currentVersionId: table.before } }); continue; }
    // Some samples stay left out: a version without only those.
    const version = await db.exploreDatasetVersion.findUnique({ where: { id: table.before }, select: { id: true, schema: true } });
    if (!version) continue;
    const rows = (await fetchAllDatasetRows(version.id)).map((row) => row.data as ExploreRowData);
    const filtered = withoutSamples(parseSchema(version.schema), rows, new Set(remaining.map((entry) => entry.sample)));
    await writeDatasetVersion({ datasetId, schema: filtered.schema, rows: filtered.rows, buildSource: "analysis-run", createdById: input.actor.userId,
      provenance: { builtAt: new Date().toISOString(), builder: "pipeline-step-qc@1", sources: [{ type: "dataset-version", id: version.id, label: "as the run wrote it" }], notes: [`Left out after QC: ${remaining.map((entry) => entry.sample).join(", ")} (took back ${samplesList([...back])})`] } });
  }
  await writeExclusions(flowId, home, (current) => current.filter((entry) => !(entry.stage === "after" && entry.stepId === step.id && back.has(entry.sample))), input.actor, `Took back ${samplesList([...back])} (left out after QC)`);
  const fresh = await loadRecipe(flowId);
  const freshStep = fresh?.steps.find((candidate) => candidate.id === stepId);
  const freshConfig = freshStep ? parsePipelineStepConfig(freshStep.pipeline) : null;
  return { quality: fresh && freshStep && freshConfig ? await qualityOf(fresh, freshStep, freshConfig) : null, samples: [...back] };
}

// ---------------------------------------------------------------------------
// Leave one sample out while it runs, and continue
// ---------------------------------------------------------------------------

export interface LeaveOutCheck { allowed: boolean; words: string; stage: string | null; samples: string[] }

/** Whether a failed sample of this run may be left out: only where the stage it failed at works sample by sample. */
export function leaveOutCheck(pipelineId: string, snapshot: Pick<PipelineSnapshot, "status" | "progress" | "error" | "stages"> | null): LeaveOutCheck | null {
  if (!snapshot) return null;
  const failed = snapshot.progress?.failedSamples ?? [];
  const sample = snapshot.error?.sample ?? null;
  const samples = [...new Set([...failed.map((entry) => entry.sample), ...(sample ? [sample] : [])])];
  if (!samples.length) return null;
  const process = failed[0]?.stage ?? snapshot.error?.process ?? null;
  const stage = snapshot.stages.find((entry) => entry.state === "failed")?.name ?? snapshot.stages.find((entry) => entry.state === "running")?.name ?? null;
  const record = pipelineRecord(pipelineId);
  const allowed = worksPerSample(record, stage, process) || (process ? worksPerSample(record, process, process) : false);
  return { allowed, stage: stage ?? process, samples, words: allowed ? `${samplesList(samples)} can be left out; the other samples keep going` : notPerSampleWords(stage ?? process) };
}

/**
 * "Leave it out and continue": records the failed sample as left out (where the samples are chosen), then — when the
 * pipeline run stopped — resumes it in place without that sample (finished work is kept). While it still runs, the
 * other samples keep going and its tables leave the sample out.
 */
export async function leaveOutDuringRun(flowId: string, stepId: string, input: { samples: string[]; reason?: string | null; resume?: boolean; actor: Actor & { userId: string }; access: PipelineAccess; requestId?: string }): Promise<{ recordedIn: { stepId: string; label: string }; samples: string[]; resumed: boolean; run: unknown | null; words: string }> {
  const { model, step, config } = await pipelineStep(flowId, stepId);
  const latest = await db.exploreAnalysisRun.findFirst({ where: { analysisId: stepId, executionMode: "pipeline", flowRunId: { not: null } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, results: true } });
  const snapshot = latest ? snapshotOf(latest.results) : null;
  const check = leaveOutCheck(config.pipelineId, snapshot);
  if (!check) throw flowError("invalid_request", "No sample failed in this step’s run.");
  if (!check.allowed) throw flowError("invalid_request", check.words, { stage: check.stage });
  const samples = input.samples.length ? input.samples.filter((sample) => check.samples.includes(sample)) : check.samples;
  if (!samples.length) throw flowError("invalid_request", `Only a sample that failed can be left out here: ${samplesList(check.samples)}.`);
  const reason = input.reason?.trim().slice(0, 500) || (snapshot?.progress?.failedSamples.find((entry) => samples.includes(entry.sample))?.words ?? "failed while the pipeline ran");
  const home = exclusionHome(model, step, config);
  const names = new Set(samples);
  await writeExclusions(flowId, home, (current) => [...current.filter((entry) => !names.has(entry.sample)), ...samples.map((sample) => ({ sample, reason, stage: "during" as const, by: person(input.actor), at: new Date().toISOString(), stepId }))], input.actor, `Left out while it ran: ${samplesList(samples)}`);
  const stopped = latest?.status === "failed" || latest?.status === "cancelled";
  if (!stopped || input.resume === false) {
    return { recordedIn: { stepId: home.stepId, label: home.label }, samples, resumed: false, run: null, words: `${samplesList(samples)} left out (recorded in step ${home.label}); the other samples keep running` };
  }
  const { resumePipelineStep } = await import("./run-plan");
  const run = await resumePipelineStep(flowId, stepId, { actor: input.actor, access: input.access, requestId: input.requestId, leaveOut: samples, force: true });
  return { recordedIn: { stepId: home.stepId, label: home.label }, samples, resumed: true, run, words: `${samplesList(samples)} left out (recorded in step ${home.label}); the pipeline continues without ${samples.length === 1 ? "it" : "them"}` };
}

// ---------------------------------------------------------------------------
// What turns out of date by it
// ---------------------------------------------------------------------------

/**
 * Steps out of date because of samples (pipeline-steps.ts pipelineReadsChanged): a Choose samples step whose reads in
 * Data changed since its run, and a step that reads a pipeline step's table that changed by leaving samples out (or
 * taking them back) since it ran — the pipeline step itself stays current, nothing reran.
 */
export async function samplesAndQualityChanged(model: RecipeModel, records: Map<string, StepRecord>): Promise<Map<string, string>> {
  const changed = new Map<string, string>();
  // Choose samples steps: the reads key of their run against the reads now.
  const samplesSteps = model.steps.filter((step) => step.stepKind === "samples" && records.get(step.id)?.status === "completed");
  if (samplesSteps.length) {
    const runs = await db.exploreAnalysisRun.findMany({ where: { id: { in: samplesSteps.map((step) => records.get(step.id)!.stepRunId) } }, select: { id: true, results: true } });
    const { loadSamplesInputs, parseSamplesConfig, samplesSnapshotOf } = await import("./samples-step");
    for (const step of samplesSteps) {
      const run = runs.find((entry) => entry.id === records.get(step.id)!.stepRunId);
      const before = samplesSnapshotOf(run?.results)?.readsKey;
      if (!before) continue;
      const now = (await loadSamplesInputs(model, parseSamplesConfig(step.pipeline)).catch(() => null))?.readsKey;
      if (now && now !== before) changed.set(step.id, `the reads in Data changed since Run #${records.get(step.id)?.flowRunNumber ?? "?"}`);
    }
  }
  // Tables of pipeline steps whose current version left samples out (or took them back) since a reading step ran.
  const pipelineIds = new Set(model.steps.filter((step) => step.stepKind === "pipeline").map((step) => step.id));
  const candidates: Array<{ stepId: string; datasetId: string; pinned: string; current: string; producer: string }> = [];
  for (const step of model.steps) {
    const recordOf = records.get(step.id);
    if (!recordOf || recordOf.status !== "completed") continue;
    for (const pin of recordOf.inputPins) {
      const dataset = model.datasets.get(pin.datasetId);
      if (!dataset?.producer || !pipelineIds.has(dataset.producer) || !dataset.currentVersionId || dataset.currentVersionId === pin.versionId) continue;
      candidates.push({ stepId: step.id, datasetId: dataset.id, pinned: pin.versionId, current: dataset.currentVersionId, producer: dataset.producer });
    }
  }
  if (candidates.length) {
    const versions = await db.exploreDatasetVersion.findMany({ where: { id: { in: [...new Set(candidates.flatMap((entry) => [entry.pinned, entry.current]))] } }, select: { id: true, provenance: true } });
    const builder = new Map(versions.map((version) => [version.id, String(record(parseJsonObject(version.provenance)).builder ?? "")] as const));
    const notes = new Map(versions.map((version) => [version.id, (record(parseJsonObject(version.provenance)).notes as unknown[] | undefined)?.map(String) ?? []] as const));
    for (const entry of candidates) {
      const leftNow = builder.get(entry.current) === "pipeline-step-qc@1";
      const leftBefore = builder.get(entry.pinned) === "pipeline-step-qc@1";
      if (!leftNow && !leftBefore) continue;
      const label = model.labels.get(entry.producer) ?? "?";
      const note = (notes.get(entry.current) ?? []).find((line) => line.startsWith("Left out after QC: "));
      const count = note ? note.replace(/^Left out after QC: /, "").split(" · ")[0].split(", ").filter(Boolean).length : 0;
      if (!changed.has(entry.stepId)) changed.set(entry.stepId, leftNow ? `${count ? plural(count, "sample") : "samples"} left out after QC in step ${label}` : `samples taken back in step ${label}`);
    }
  }
  return changed;
}

/** For a pipeline step's tables when its run finishes: leave out the samples recorded as left out of this step. */
export function excludedNamesOf(config: PipelineStepConfig, listExclusions: SamplesExclusion[]): Set<string> {
  return new Set([...(config.exclusions ?? []), ...listExclusions].filter((entry) => entry.stage !== "before").map((entry) => entry.sample));
}

export const pipelineNameOf = (pipelineId: string) => pipelineInfo(pipelineId)?.name ?? pipelineId;
export const sameJson = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
export type { Prisma };
