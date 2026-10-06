/**
 * Pipelines before, during and after a run (identity sheets 96–97) over an in-memory database: the Choose samples step
 * (filters with counts, reads matched in three tries, names, columns, the list a pipeline reads), samples left out
 * while a pipeline ran and after it (quality, Undo), the Methods sentence from the record, version compare, Which one?,
 * the study's limit of pipelines at once, and the run's per-sample states.
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  memory: null as null | import("./__fixtures__/memory-db").MemoryDb,
  pairs: [] as Array<{ sampleId: string; r1: { id: string; name: string; sizeBytes: number }; r2: { id: string; name: string; sizeBytes: number } | null }>,
  versions: new Map<string, { rows: Array<Record<string, unknown>> }>(),
}));

vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./__fixtures__/memory-db");
  state.memory = createMemoryDb({ explorePipelinePreset: { archivedAt: null, note: null, versions: [] }, exploreAnalysisRun: { status: "pending", trial: false, results: null, pipelineRunId: null, flowRunId: null } });
  return { db: state.memory.db };
});
const fixtures = vi.hoisted(() => {
  const definition = { id: "ampliseq", name: "nf-core/ampliseq", description: "ASVs", category: "amplicon", version: "2.9.0", requires: {}, outputs: [], visibility: { showToUser: true, userCanStart: true },
    input: { supportedScopes: ["study"], minSamples: 1, perSample: { reads: true, pairedEnd: true } }, samplesheet: { format: "csv", generator: "x" },
    configSchema: { type: "object", properties: { trunclenf: { type: "integer", title: "Trim forward reads to", "x-seqdesk": { placement: "basic" } }, trunclenr: { type: "integer", title: "Trim reverse reads to", "x-seqdesk": { placement: "basic" } }, primers: { type: "string", title: "Primers", "x-seqdesk": { placement: "basic" } }, reference: { type: "string", title: "Reference database", "x-seqdesk": { placement: "basic" } } } }, defaultConfig: {} };
  const pkg = { id: "ampliseq", basePath: "/p", manifest: { package: { id: "ampliseq", name: "nf-core/ampliseq", version: "2.9.0", description: "ASVs", provider: "nf-core" },
    outputs: [{ id: "asv_table", scope: "run", destination: "run_artifact", discovery: { pattern: "a.tsv" }, table: { label: "ASV table", tableKind: "taxon-counts" } }, { id: "qc_summary", scope: "run", destination: "run_artifact", discovery: { pattern: "q.tsv" }, table: { label: "QC", tableKind: "sample-summary", sampleColumn: "Sample" } }] },
    samplesheet: { samplesheet: { format: "csv", filename: "samplesheet.csv", rows: { scope: "sample" }, columns: [{ name: "sampleID", source: "sample.sampleId" }, { name: "forwardReads", source: "read.file1" }, { name: "reverseReads", source: "read.file2" }, { name: "condition", source: "sample.condition" }] } },
    definition: { steps: [{ id: "cutadapt", name: "Cutadapt", perSample: true, processMatchers: ["CUTADAPT"] }, { id: "dada2", name: "DADA2" }] } };
  return { definition, pkg };
});
vi.mock("@/lib/pipelines/registry", () => ({ PIPELINE_REGISTRY: { ampliseq: fixtures.definition } }));
vi.mock("@/lib/pipelines/package-loader", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/pipelines/package-loader")>()), getPackage: (id: string) => (id === "ampliseq" ? fixtures.pkg : undefined), findStepByProcessFromPackage: () => null }));
vi.mock("@/lib/pipelines/definitions", () => ({ getStepsForPipeline: () => [{ id: "cutadapt", name: "Cutadapt" }, { id: "dada2", name: "DADA2" }] }));
vi.mock("@/lib/pipelines/enablement", () => ({ getPipelineEnabled: async () => true }));
vi.mock("@/lib/pipelines/execution-settings", () => ({ getExecutionSettings: async () => ({ useSlurm: true, pipelineRunDir: "/runs" }) }));
vi.mock("@/lib/pipelines/database-downloads", () => ({ getPipelineDatabaseStatuses: async () => [], getPipelineDatabaseDefinition: () => null }));
vi.mock("@/lib/pipelines/pipeline-readiness-service", () => ({ parsePipelineConfig: (raw: string | null | undefined) => (raw ? JSON.parse(raw) : {}) }));
vi.mock("@/lib/pipelines/data-study", () => ({
  dataStudyAlias: (key: string) => `seqdesk-data:${key}`, findDataStudy: async () => ({ id: "study1" }), linkedReadRecords: async () => [],
  readsInData: async () => ({ files: state.pairs.flatMap((pair) => [pair.r1, ...(pair.r2 ? [pair.r2] : [])]), pairs: state.pairs, words: "" }),
}));
vi.mock("@/lib/pipelines/pipeline-data-service", () => ({ pastDurations: async () => [2460], runBelongsTo: async () => true, getDataRun: async () => null }));
vi.mock("./datasets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./datasets")>()),
  fetchAllDatasetRows: async (versionId: string) => (state.versions.get(versionId)?.rows ?? []).map((data, rowIndex) => ({ rowIndex, sampleId: null, subjectId: null, key: null, data })),
  writeDatasetVersion: vi.fn(async (input: { datasetId: string; schema: unknown; rows: Array<Record<string, unknown>>; provenance: unknown }) => {
    const id = `v${state.versions.size + 1}`;
    state.versions.set(id, { rows: input.rows });
    state.memory!.table("exploreDatasetVersion").push({ id, datasetId: input.datasetId, number: state.versions.size, schema: JSON.stringify(input.schema), rowCount: input.rows.length, contentHash: id, provenance: JSON.stringify(input.provenance), createdAt: new Date() });
    input.rows.forEach((data, rowIndex) => state.memory!.table("exploreDatasetRow").push({ versionId: id, rowIndex, data }));
    await state.memory!.db.exploreDataset.update({ where: { id: input.datasetId }, data: { currentVersionId: id } });
    return { versionId: id, number: state.versions.size, rowCount: input.rows.length, contentHash: id, unchanged: false };
  }),
}));
vi.mock("./analyses", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./analyses")>();
  const db = () => state.memory!.db as unknown as Record<string, { create: (args: unknown) => Promise<Record<string, unknown>>; update: (args: unknown) => Promise<unknown>; findUnique: (args: unknown) => Promise<Record<string, unknown> | null> }>;
  return {
    ...actual,
    createAnalysis: vi.fn(async (input: Record<string, unknown>) => {
      const analysis = await db().exploreAnalysis.create({ data: { flowId: input.flowId, targetKey: input.targetKey, name: input.name, language: input.language, environmentName: input.environmentName, position: input.position, purpose: input.purpose, stepKind: input.stepKind ?? "code" } });
      const revision = await db().exploreAnalysisRevision.create({ data: { analysisId: analysis.id, number: 1, code: input.code, codeHash: actual.codeHashOf(String(input.code)), params: JSON.stringify(input.params ?? {}), inputs: JSON.stringify(input.inputs ?? []), pipeline: input.pipeline ?? null } });
      await db().exploreAnalysis.update({ where: { id: analysis.id }, data: { currentRevisionId: revision.id } });
      return { id: analysis.id };
    }),
    createRevision: vi.fn(async (input: Record<string, unknown>) => {
      const analysis = await db().exploreAnalysis.findUnique({ where: { id: input.analysisId } });
      const current = await db().exploreAnalysisRevision.findUnique({ where: { id: analysis?.currentRevisionId } });
      const code = String(input.code ?? current?.code);
      const revision = await db().exploreAnalysisRevision.create({ data: { analysisId: input.analysisId, number: Number(current?.number ?? 0) + 1, code, codeHash: actual.codeHashOf(code), params: JSON.stringify(input.params ?? JSON.parse(String(current?.params ?? "{}"))), inputs: JSON.stringify(input.inputs ?? JSON.parse(String(current?.inputs ?? "[]"))), pipeline: input.pipeline ?? current?.pipeline ?? null } });
      await db().exploreAnalysis.update({ where: { id: input.analysisId }, data: { currentRevisionId: revision.id } });
      return { id: revision.id };
    }),
    allocateRunNumber: async () => `EXP-${Math.random().toString(36).slice(2, 8)}`,
  };
});
vi.mock("./recipe", async (importOriginal) => ({ ...(await importOriginal<typeof import("./recipe")>()), loadRecipe: vi.fn(async (flowId: string) => modelOf(flowId)) }));

import { parseInputBindings } from "./analyses";
import type { RecipeModel } from "./recipe";
import { resetPipelineStepsProbe, stepReads } from "./pipeline-steps";
import { addSamplesStep, buildSampleList, changeSampleExclusions, cleanSampleName, confirmSampleMatches, parseSamplesConfig, resetSamplesPreviewCache, runSamplesStep, samplesPreview, sameNameWords, uploadSampleMapping, type SamplesStepConfig } from "./samples-step";
import { judgeQuality, leaveOutAfterQuality, leaveOutCheck, qualityOf, samplesAndQualityChanged, undoQualityLeaveOut, withoutSamples } from "./pipeline-quality";
import { fillMethods, pipelineMethodsOf } from "./pipeline-methods";
import { changelogUrl, pipelineRecord, worksPerSample } from "./pipeline-record";
import { metricValue, pipelineVersions } from "./pipeline-compare";
import { questionScore, whichRows } from "./pipeline-which";
import { pipelineCapacity, savePipelineStepSettings } from "./pipeline-limits";
import { dropFromSamplesheet, sampleStates } from "./pipeline-step-extras";
import type { NextflowTask } from "@/lib/pipelines/nextflow/trace-parser";

const rows = (name: string) => state.memory!.table(name);
const actor = { userId: "u1", memberId: "m1", name: "Amara Okafor" };
const admin = { userId: "admin", canRun: true, installation: true, canManage: true };
const member = { userId: "u1", canRun: true, installation: false, canManage: false };

function modelOf(flowId: string): RecipeModel | null {
  const flow = rows("exploreFlow").find((row) => row.id === flowId) as Record<string, unknown> | undefined;
  if (!flow) return null;
  const datasets = new Map<string, RecipeModel["datasets"] extends Map<string, infer D> ? D : never>();
  for (const row of rows("exploreDataset").filter((entry) => entry.targetKey === flow.targetKey)) {
    const config = JSON.parse(String(row.sourceConfig ?? "{}"));
    const current = rows("exploreDatasetVersion").find((version) => version.id === row.currentVersionId) as Record<string, unknown> | undefined;
    datasets.set(String(row.id), { id: String(row.id), name: String(row.name), kind: String(row.kind), tableKind: (row.tableKind as string) ?? null, roles: (row.roles as string) ?? null, sensitivity: "standard", currentVersionId: (row.currentVersionId as string) ?? null,
      producer: config.analysisId ?? null, artifactName: config.artifactName ?? null, current: current ? { id: String(current.id), number: Number(current.number), contentHash: String(current.contentHash), rowCount: Number(current.rowCount), schema: String(current.schema), createdAt: new Date() } : null });
  }
  const steps = rows("exploreAnalysis").filter((row) => row.flowId === flowId).map((analysis, index) => {
    const revision = rows("exploreAnalysisRevision").find((row) => row.id === analysis.currentRevisionId) as Record<string, unknown> | undefined;
    return { id: String(analysis.id), name: String(analysis.name), description: null, purpose: null, kitId: null, language: "shell", environmentName: "", packages: null, position: String(analysis.position || `a${index}`), laneKind: null, laneOf: null, laneLabel: null, groupId: null, paramMeta: null, methodsSentence: null, proposedByTurnId: null, createdAt: new Date(), currentRevisionId: (analysis.currentRevisionId as string) ?? null,
      revision: revision ? { id: String(revision.id), number: Number(revision.number), code: String(revision.code), codeHash: String(revision.codeHash), params: String(revision.params), inputs: String(revision.inputs), fileInputs: "[]", author: "user", authorUserId: "u1", createdAt: new Date() } : null,
      bindings: parseInputBindings(revision?.inputs as string | undefined), stepKind: (analysis.stepKind as "code" | "pipeline" | "samples") ?? "code", pipeline: revision?.pipeline ?? null };
  }).sort((a, b) => a.position.localeCompare(b.position));
  const upstream = new Map(steps.map((step) => [step.id, new Set(step.bindings.map((binding) => datasets.get(binding.datasetId)?.producer).filter((id): id is string => Boolean(id) && id !== step.id))] as const));
  return { flow: { id: flowId, targetKey: String(flow.targetKey), name: String(flow.name), description: null, recipeRevision: 1, runCounter: 0, currentRunId: null, layout: null, headlineValue: null, createdById: "u1", createdByMemberId: null, createdAt: new Date(), updatedAt: new Date() },
    steps, labels: new Map(steps.map((step, index) => [step.id, String(index + 1)])), upstream, datasets };
}

const file = (id: string, name: string) => ({ id, name, sizeBytes: 100 });
const pair = (sampleId: string, n: string) => ({ sampleId, r1: file(`${n}-1`, `${sampleId}_R1_001.fastq.gz`), r2: file(`${n}-2`, `${sampleId}_R2_001.fastq.gz`) });
const METADATA = [
  { sample: "A-01", Diagnosis: "Adenoma", Study: "Feng", Age: 61 }, { sample: "A-02", Diagnosis: "Adenoma", Study: "Feng", Age: 55 },
  { sample: "A-17", Diagnosis: "Adenoma", Study: "Feng", Age: 70 }, { sample: "Normal 12", Diagnosis: "Normal", Study: "Feng", Age: 49 },
  { sample: "N-03", Diagnosis: "Normal", Study: "Feng", Age: 52 }, { sample: "N-04", Diagnosis: "Normal", Study: "Zeller", Age: 44 }, { sample: "C-01", Diagnosis: "Cancer", Study: "Feng", Age: 66 },
];

beforeEach(() => {
  state.memory!.reset();
  state.versions.clear();
  resetPipelineStepsProbe(true);
  resetSamplesPreviewCache();
  state.pairs = [pair("A01_S1_L001", "a1"), pair("A02_S2_L001", "a2"), pair("A17_S12_L001", "a17"), pair("A_17_S93_L001", "a17b"), pair("Normal12_S40_L001", "n12"), pair("N04_S8_L001", "n4"), pair("C01_S9_L001", "c1")];
  rows("exploreFlow").push({ id: "flow1", targetKey: "project:p1", name: "Microbiome diversity" });
  state.versions.set("meta-v1", { rows: METADATA });
  rows("exploreDatasetVersion").push({ id: "meta-v1", datasetId: "meta", number: 1, schema: JSON.stringify({ columns: ["sample", "Diagnosis", "Study", "Age"].map((key) => ({ key, label: key, type: key === "Age" ? "number" : "string" })) }), rowCount: METADATA.length, contentHash: "m1", createdAt: new Date() });
  rows("exploreDataset").push({ id: "meta", targetKey: "project:p1", kind: "imported", name: "metadata.csv", currentVersionId: "meta-v1", sourceConfig: null });
});

const CONFIG: Partial<SamplesStepConfig> & Record<string, unknown> = {
  metadata: { datasetId: "meta", sampleColumn: "sample" }, forPipeline: "ampliseq",
  filters: [{ column: "Diagnosis", op: "is", values: ["Adenoma", "Normal"] }, { column: "Study", op: "is not", values: ["Zeller"] }],
  extraColumns: [{ name: "condition", from: "Diagnosis", map: { Adenoma: "adenoma", Normal: "normal" } }],
};

describe("the Choose samples step", () => {
  it("counts each rule, matches reads in three tries, cleans names, adds columns, and types the list with the pipeline's samplesheet", () => {
    const config = parseSamplesConfig({ ...CONFIG });
    const result = buildSampleList({ config, metadata: { columns: ["sample", "Diagnosis", "Study", "Age"], rows: METADATA }, reads: { pairs: state.pairs, records: [] } });
    expect(result.rules.map((rule) => [rule.words, rule.count, rule.after])).toEqual([["Diagnosis is Adenoma or Normal", 6, 6], ["Study is not Zeller", 6, 5]]);
    expect(result.reads).toMatchObject({ found: 3, of: 5, exact: 0, normalised: 3 });
    // A-17: two files with the same name (a re-sequenced sample) — suggestions to confirm, never a pick. N-03: nothing.
    expect(result.reads.missing.map((entry) => [entry.sample, entry.suggestions.map((suggestion) => [suggestion.sampleId, suggestion.words])])).toEqual([
      ["A-17", [["A17_S12_L001", "same name without the dash"], ["A_17_S93_L001", "same name with an underscore"]]], ["N-03", []]]);
    expect(result.cleaned).toEqual([{ from: "Normal 12", to: "Normal_12" }]);
    expect(result.rows).toEqual([
      { sample: "A-01", fastq_1: "A01_S1_L001_R1_001.fastq.gz", fastq_2: "A01_S1_L001_R2_001.fastq.gz", condition: "adenoma", source_name: "A-01" },
      { sample: "A-02", fastq_1: "A02_S2_L001_R1_001.fastq.gz", fastq_2: "A02_S2_L001_R2_001.fastq.gz", condition: "adenoma", source_name: "A-02" },
      { sample: "Normal_12", fastq_1: "Normal12_S40_L001_R1_001.fastq.gz", fastq_2: "Normal12_S40_L001_R2_001.fastq.gz", condition: "normal", source_name: "Normal 12" },
    ]);
    expect(result.words).toBe("3 of 7 · Diagnosis is Adenoma or Normal · Study is not Zeller · adds condition");
    expect(result.ledger.reasons.map((reason) => [reason.count, reason.reason])).toEqual([[1, "filtered out: Diagnosis is Adenoma or Normal does not hold"], [1, "filtered out: Study is not Zeller does not hold"], [2, "no reads found"]]);
    expect([cleanSampleName(" Adenoma 3 "), sameNameWords("A-01", "A01_S1_L001")]).toEqual(["Adenoma_3", "same name without the dash"]);
  });

  it("is added as a step with its list declared, matches by hand and by an uploaded table, leaves samples out, and writes the list when it runs", async () => {
    const id = await addSamplesStep("flow1", { config: CONFIG, actor });
    expect(rows("exploreAnalysis").find((row) => row.id === id)).toMatchObject({ stepKind: "samples", name: "Choose samples", environmentName: "samples" });
    const list = rows("exploreDataset").find((row) => String(row.name).startsWith("sample_list"))!;
    expect(JSON.parse(String(list.sourceConfig))).toMatchObject({ analysisId: id, artifactName: "sample_list", samplesStep: true });
    const preview = await samplesPreview(modelOf("flow1")!, parseSamplesConfig(CONFIG), id);
    expect(preview).toMatchObject({ rowCount: 3, samplesheet: { columns: ["sample", "fastq_1", "fastq_2", "condition"], fits: true, words: "fits nf-core/ampliseq" }, cleanNames: { on: true, changed: 1 } });

    await confirmSampleMatches("flow1", id, { confirm: [{ sample: "A-17", files: ["a17-1", "a17-2"] }], leaveOut: [{ sample: "N-03", reason: "no likely file" }], actor });
    const after = await samplesPreview(modelOf("flow1")!, parseSamplesConfig(modelOf("flow1")!.steps[0].pipeline), id);
    expect([after.rowCount, after.reads.confirmed, after.reads.missing.length, after.exclusions.map((entry) => [entry.sample, entry.stage, entry.by.name])]).toEqual([4, 1, 0, [["N-03", "before", "Amara Okafor"]]]);
    const upload = await uploadSampleMapping("flow1", id, { csv: "sample,file\nA-17,A_17_S93_L001_R1_001.fastq.gz\nX-9,missing.fastq.gz", actor });
    expect([upload.kept, upload.unknown.map((row) => row.sample)]).toEqual([1, ["X-9"]]);
    await changeSampleExclusions("flow1", id, { add: [{ sample: "A-02", reason: "contaminated" }], actor });

    const settled = await runSamplesStep({ id: "fr1", startedById: "u1", kind: "full" }, { analysisId: id, label: "1", name: "Choose samples", revisionId: String(rows("exploreAnalysis").find((row) => row.id === id)!.currentRevisionId) }, "project:p1", "flow1");
    expect(settled).toEqual({ settled: true });
    const run = rows("exploreAnalysisRun").find((row) => row.id === `fr_fr1_${id}`)!;
    expect(run).toMatchObject({ status: "completed", executionMode: "samples" });
    const written = [...state.versions.values()].at(-1)!.rows;
    expect(written.map((row) => row.sample)).toEqual(["A-01", "A-17", "Normal_12"]);
    // A confirmed match counts, not the name: the uploaded table did not replace it.
    expect(written[1].fastq_1).toBe("A17_S12_L001_R1_001.fastq.gz");
    expect(JSON.parse(String(run.results)).samples).toMatchObject({ rows: 3, total: 7, missing: [], output: { name: "sample_list", rows: 3 } });
    // The pipeline reads the list by its files, under the list's names.
    const reads = await stepReads("project:p1", { from: "table", datasetId: String(list.id), column: "sample" });
    expect([reads.samples.sort(), reads.names]).toEqual([["A01_S1_L001", "A17_S12_L001", "Normal12_S40_L001"], { A01_S1_L001: "A-01", A17_S12_L001: "A-17", Normal12_S40_L001: "Normal_12" }]);
  });
});

describe("samples during and after a run", () => {
  async function pipelineWithTables() {
    const samplesId = await addSamplesStep("flow1", { config: CONFIG, actor });
    await runSamplesStep({ id: "fr1", startedById: "u1", kind: "full" }, { analysisId: samplesId, label: "1", name: "Choose samples", revisionId: String(rows("exploreAnalysis").find((row) => row.id === samplesId)!.currentRevisionId) }, "project:p1", "flow1");
    const list = rows("exploreDataset").find((row) => String(row.name).startsWith("sample_list"))!;
    const config = { pipelineId: "ampliseq", version: "2.9.0", params: { trunclenf: 230, trunclenr: 200, primers: "515F / 806R", reference: "SILVA 138" }, samples: { from: "table", datasetId: list.id, column: "sample" }, outputs: [{ outputId: "asv_table", name: "asv_table" }, { outputId: "qc_summary", name: "qc_summary" }] };
    rows("exploreAnalysis").push({ id: "amp", flowId: "flow1", targetKey: "project:p1", name: "nf-core/ampliseq", stepKind: "pipeline", position: "zz", currentRevisionId: "r-amp" });
    rows("exploreAnalysisRevision").push({ id: "r-amp", analysisId: "amp", number: 1, code: "{}", codeHash: "h", params: JSON.stringify(config.params), inputs: JSON.stringify([{ alias: "samples", datasetId: list.id, versionId: null }]), pipeline: config });
    state.versions.set("qc-v1", { rows: [{ Sample: "A-01", sample_id: "A-01", "FastQC_mqc-generalstats-fastqc-total_sequences": 3120 }, { Sample: "Normal_12", sample_id: "Normal_12", "FastQC_mqc-generalstats-fastqc-total_sequences": 54000 }] });
    state.versions.set("asv-v1", { rows: [{ asv: "ASV1", "A-01": 5, Normal_12: 7 }] });
    rows("exploreDatasetVersion").push({ id: "qc-v1", datasetId: "qc", number: 1, schema: JSON.stringify({ columns: ["Sample", "sample_id", "FastQC_mqc-generalstats-fastqc-total_sequences"].map((key) => ({ key, label: key, type: "string" })) }), rowCount: 2, contentHash: "q1", provenance: JSON.stringify({ builder: "pipeline-step@1" }), createdAt: new Date() },
      { id: "asv-v1", datasetId: "asv", number: 1, schema: JSON.stringify({ columns: ["asv", "A-01", "Normal_12"].map((key) => ({ key, label: key, type: "string" })) }), rowCount: 1, contentHash: "a1", provenance: JSON.stringify({ builder: "pipeline-step@1" }), createdAt: new Date() });
    rows("exploreDataset").push({ id: "qc", targetKey: "project:p1", kind: "derived", name: "qc_summary (ampliseq)", currentVersionId: "qc-v1", sourceConfig: JSON.stringify({ analysisId: "amp", artifactName: "qc_summary" }) },
      { id: "asv", targetKey: "project:p1", kind: "derived", name: "asv_table (ampliseq)", currentVersionId: "asv-v1", sourceConfig: JSON.stringify({ analysisId: "amp", artifactName: "asv_table" }) });
    return { samplesId };
  }

  it("judges quality against the pipeline's threshold, leaves the low samples out of its tables (recorded in step 1), and Undo puts them back", async () => {
    const { samplesId } = await pipelineWithTables();
    const model = modelOf("flow1")!;
    const step = model.steps.find((candidate) => candidate.id === "amp")!;
    const quality = await qualityOf(model, step, step.pipeline as never);
    expect(quality).toMatchObject({ total: 2, passing: 1, words: "1 of 2 samples pass · 1 below 10,000 reads: A-01 3,120", thresholdWords: "threshold 10,000 reads (pipeline default)", recordedIn: { stepId: samplesId, label: "1" } });
    const left = await leaveOutAfterQuality("flow1", "amp", { actor });
    expect([left.samples, left.tables, left.quality?.words]).toEqual([["A-01"], 2, "1 of 1 sample pass · 1 left out after QC (A-01)"]);
    expect(state.versions.get(String(rows("exploreDataset").find((row) => row.id === "asv")!.currentVersionId))!.rows).toEqual([{ asv: "ASV1", Normal_12: 7 }]);
    const exclusions = (rows("exploreAnalysisRevision").filter((row) => row.analysisId === samplesId).at(-1)!.pipeline as { exclusions: Array<Record<string, unknown>> }).exclusions;
    expect(exclusions).toEqual([expect.objectContaining({ sample: "A-01", stage: "after", stepId: "amp", reason: "below 10,000 reads", by: expect.objectContaining({ name: "Amara Okafor" }) })]);
    // A step that read the table before turns out of date, in words.
    const records = new Map([["reader", { stepRunId: "x", revisionId: "y", status: "completed", inputPins: [{ alias: "qc", datasetId: "qc", versionId: "qc-v1" }], flowRunId: "f", flowRunNumber: 2, reusedFrom: null }]]);
    const changed = await samplesAndQualityChanged({ ...modelOf("flow1")!, steps: [...modelOf("flow1")!.steps, { ...step, id: "reader", stepKind: "code" as const }] }, records);
    expect(changed.get("reader")).toBe("1 sample left out after QC in step 2");
    const undone = await undoQualityLeaveOut("flow1", "amp", { actor });
    expect([undone.samples, rows("exploreDataset").find((row) => row.id === "asv")!.currentVersionId, undone.quality?.leftOut]).toEqual([["A-01"], "asv-v1", null]);
  });

  it("leaves a failed sample out only where the stage works sample by sample, and drops it from the samplesheet for Resume", async () => {
    const running = { status: "running" as const, stages: [{ name: "Cutadapt", state: "running" as const }], error: null, progress: { total: 3, done: 1, running: 1, failed: 1, waiting: 0, perSample: true, stage: "Cutadapt", failedSamples: [{ sample: "A-01", stage: "NFCORE_AMPLISEQ:CUTADAPT", words: "failed at CUTADAPT" }] } };
    expect(leaveOutCheck("ampliseq", running)).toMatchObject({ allowed: true, samples: ["A-01"] });
    expect(leaveOutCheck("ampliseq", { ...running, stages: [{ name: "DADA2", state: "failed" }], progress: { ...running.progress, failedSamples: [{ sample: "A-01", stage: "DADA2", words: "x" }] } })).toMatchObject({ allowed: false, words: expect.stringContaining("DADA2 works on all samples together") });
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "leave-out-"));
    await fs.writeFile(path.join(folder, "samplesheet.csv"), "sampleID,forwardReads,reverseReads\nA-01,a1,a2\nN-02,b1,b2\n");
    rows("pipelineRun").push({ id: "prun", pipelineId: "ampliseq", runFolder: folder, inputSampleIds: JSON.stringify(["s1", "s2"]) });
    rows("sample").push({ id: "s1", sampleId: "A-01" }, { id: "s2", sampleId: "N-02" });
    expect(await dropFromSamplesheet("prun", ["A-01"])).toEqual(["A-01"]);
    expect(await fs.readFile(path.join(folder, "samplesheet.csv"), "utf8")).toBe("sampleID,forwardReads,reverseReads\nN-02,b1,b2\n");
    expect(JSON.parse(String(rows("pipelineRun")[0].inputSampleIds))).toEqual(["s2"]);
    const task = (tag: string, status: NextflowTask["status"], process: string, minute: number) => ({ taskId: `${process}-${tag}`, hash: "x", nativeId: "1", name: process, process, tag, status, exit: 0, submit: new Date(2026, 9, 6, 10, minute), start: null, complete: null, duration: null, realtime: null, cpuPercent: null, peakRss: null, peakVmem: null, workdir: null }) as NextflowTask;
    expect(sampleStates([task("A-01", "COMPLETED", "X:FASTQC", 1), task("A-01", "FAILED", "X:CUTADAPT", 2), task("N-02", "RUNNING", "X:CUTADAPT", 3)], ["A-01", "N-02", "N-03"])).toEqual([
      { sample: "A-01", state: "failed", stage: "CUTADAPT" }, { sample: "N-02", state: "running", stage: "CUTADAPT" }, { sample: "N-03", state: "waiting", stage: null }]);
  });
});

describe("the record of a pipeline", () => {
  it("fills the Methods sentence from the run's values and cites the pipeline and its tools, marking missing values", async () => {
    const filled = fillMethods("Reads were processed with {pipeline} {version}: truncated at {params.trunclenf} / {params.trunclenr} bp against {reference}, giving {output.asv_table.rows} ASVs across {samples} samples{params.nope}.",
      { pipeline: "nf-core/ampliseq", version: "2.9.0", samples: 210, params: { trunclenf: 230, trunclenr: 200 }, reference: "SILVA 138", outputs: { asv_table: { rows: 1342, columns: 211 } } });
    expect(filled.text).toBe("Reads were processed with nf-core/ampliseq 2.9.0: truncated at 230 / 200 bp against SILVA 138, giving 1,342 ASVs across 210 samples—.");
    expect(filled.missing).toEqual(["{params.nope}"]);
    expect(filled.tokens.find((token) => token.key === "params.trunclenf")).toMatchObject({ label: "trunclenf", source: "setting", display: "230" });
    const record = pipelineRecord("ampliseq");
    expect(record.citations.map((citation) => citation.short)).toEqual(["Straub et al. 2020", "Callahan et al. 2016", "Martin 2011", "Quast et al. 2013", "Ewels et al. 2020"]);
    expect([record.incremental.allowed, record.incremental.reason]).toEqual([false, "DADA2 learns errors from all samples together, so the tables must be made in one run."]);
    expect([worksPerSample(record, "Cutadapt"), worksPerSample(record, "DADA2"), worksPerSample(record, null, "NFCORE_AMPLISEQ:AMPLISEQ:CUTADAPT_BASIC")]).toEqual([true, false, true]);
    expect(changelogUrl(record, "2.10.0")).toBe("https://github.com/nf-core/ampliseq/releases/tag/2.10.0");
    expect(pipelineRecord("unknown-pipeline")).toMatchObject({ fit: null, source: null, incremental: { allowed: false } });

    await pipelineWithStepOnly();
    const model = modelOf("flow1")!;
    const methods = await pipelineMethodsOf(model, model.steps[0], { results: JSON.stringify({ pipeline: { pipelineRunId: "p1", runNumber: "AMPLISEQ-1", sampleCount: 210, outputs: [{ name: "asv_table", rows: 1342 }] } }), revisionId: null, flowRunNumber: 2 });
    expect(methods).toMatchObject({ source: "record", words: "From the pipeline’s record · Run #2", missing: [] });
    expect(methods!.text).toBe("Reads were processed with nf-core/ampliseq 2.9.0: primers 515F / 806R were removed with Cutadapt, reads truncated at 230 / 200 bp, amplicon sequence variants inferred with DADA2 and classified against SILVA 138, giving 1,342 ASVs across 210 samples.");
  });

  it("tells about a newer version and compares the numbers the manifest asks for", () => {
    const config = { pipelineId: "ampliseq", version: "2.8.0", params: {}, samples: null, outputs: [] };
    expect(pipelineVersions(config, "2.10.0")).toMatchObject({ current: "2.8.0", installed: "2.9.0", newer: { version: "2.10.0", installed: false, words: "nf-core/ampliseq 2.10.0 is available" } });
    expect(pipelineVersions({ ...config, version: "2.9.0" }, null).newer).toBeNull();
    const table = { rows: [{ Genus: "Bacteroides" }, { Genus: "Bacteroides" }, { Genus: "Ruminococcus" }], columns: ["Genus"], roles: {} };
    expect(metricValue({ id: "g", label: "Top genera", kind: "top-features", output: "taxonomy", column: "Genus", top: 1 }, table, null)).toMatchObject({ set: ["Bacteroides"] });
    expect(metricValue({ id: "r", label: "ASVs", kind: "rows", output: "asv_table" }, table, null).words).toBe("3");
  });

  it("compares the pipelines that fit, from the catalogue only", () => {
    const entry = (id: string, extra: Record<string, unknown>) => ({ id, name: id, version: "1", description: "", goals: [], makes: [], tags: [], category: null, missing: [], citation: null, installed: null, labUse: null, source: { kind: "registry", label: "x" }, fit: null, ...extra }) as never;
    const rowsOf = whichRows([entry("ampliseq", { answers: "Which taxa, how much", makes: ["asv_table"], estimate: { words: "about 40 min" } }), entry("qc16s", { goals: ["Read quality"], installed: { version: "v3", enabled: true }, labUse: { runs: 6 } })]);
    expect(rowsOf.find((row) => row.key === "answers")!.values).toEqual({ ampliseq: "Which taxa, how much", qc16s: "Read quality" });
    expect(rowsOf.find((row) => row.key === "here")!.values).toEqual({ ampliseq: "in the store", qc16s: "installed, used 6×" });
    expect(questionScore({ name: "nf-core/ampliseq", description: "16S amplicon reads to ASVs", goals: ["Taxa from amplicons"], makes: ["asv_table"], tags: [], category: null }, "taxa from my 16S amplicons")).toBeGreaterThan(0);
  });
});

describe("words for one", () => {
  it("says one sample as one, not \"all 1 sample\"", async () => {
    state.pairs = [pair("A01_S1_L001", "a1")];
    expect((await stepReads("project:p1", null)).words).toBe("the one sample in Data");
    state.pairs = [pair("A01_S1_L001", "a1"), pair("A02_S2_L001", "a2")];
    expect((await stepReads("project:p1", null)).words).toBe("all 2 samples in Data");
  });
});

describe("limits", () => {
  it("keeps one pipeline of a study at a time by default; the admin raises it", async () => {
    rows("exploreAnalysis").push({ id: "amp", flowId: "flow1", targetKey: "project:p1", stepKind: "pipeline" });
    rows("exploreAnalysisRun").push({ id: "busy", analysisId: "amp", executionMode: "pipeline", status: "running", pipelineRunId: "prun-1" });
    rows("pipelineRun").push({ id: "prun-1", status: "running" });
    expect(await pipelineCapacity("project:p1")).toMatchObject({ max: 1, active: 1, free: false, words: "Waits for the pipeline of this study that is running now (at most 1 at a time)" });
    await expect(savePipelineStepSettings({ maxConcurrentPerStudy: 2 }, member)).rejects.toMatchObject({ code: "forbidden" });
    rows("siteSettings").push({ id: "singleton", extraSettings: "{}" });
    expect(await savePipelineStepSettings({ maxConcurrentPerStudy: 2 }, admin)).toEqual({ maxConcurrentPerStudy: 2 });
    expect((await pipelineCapacity("project:p1")).free).toBe(true);
  });
});

async function pipelineWithStepOnly() {
  const config = { pipelineId: "ampliseq", version: "2.9.0", params: { trunclenf: 230, trunclenr: 200, primers: "515F / 806R", reference: "SILVA 138" }, samples: null, outputs: [{ outputId: "asv_table", name: "asv_table" }] };
  rows("exploreAnalysis").push({ id: "amp", flowId: "flow1", targetKey: "project:p1", name: "nf-core/ampliseq", stepKind: "pipeline", position: "m", currentRevisionId: "r-amp" });
  rows("exploreAnalysisRevision").push({ id: "r-amp", analysisId: "amp", number: 1, code: "{}", codeHash: "h", params: "{}", inputs: "[]", pipeline: config });
}

void withoutSamples; void judgeQuality;
