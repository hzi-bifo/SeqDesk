/**
 * A pipeline step inside numbered runs of a recipe, end to end through flow-runs.ts with the pipeline run service,
 * the Data study and the table builder replaced: the pipeline starts once (idempotent), the run waits without
 * blocking, the finished pipeline's table becomes a version of the step's table and the next step starts; the same
 * inputs reuse the finished run; a failure fails the recipe run with the pipeline's own sentence; cancelling cancels
 * the pipeline; trials never start one; a person who may not start pipelines is refused before a run is recorded;
 * Resume continues the stopped pipeline run in place.
 */
import os from "os";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  memory: null as null | import("./__fixtures__/memory-db").MemoryDb,
  created: [] as Array<Record<string, unknown>>,
  createResponse: null as null | ((body: Record<string, unknown>) => { status: number; body: Record<string, unknown> }),
  cancelled: [] as string[],
  resumed: [] as Array<{ runId: string; memory: string | null }>,
  written: [] as Array<{ datasetId: string; rows: number }>,
  codeStarted: [] as string[],
  plain: new Map<string, Record<string, unknown>>(),
  files: [] as Array<{ id: string; name: string; sizeBytes: number }>,
  pairCount: 2,
  where: null as null | string,
}));

vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./__fixtures__/memory-db");
  state.memory = createMemoryDb({
    exploreAnalysisRun: { __unique: [["runNumber"]], status: "pending", trial: false, results: null, errorTail: null, outputTail: null, exitCode: null, startedAt: null, completedAt: null, queuedAt: null, durationMs: null, inputPins: null, runFolder: null, queueJobId: null, pipelineRunId: null, reusedFromRunId: null, executionMode: null, flowRunId: null, stepLabel: null },
    exploreFlowRun: { __unique: [["flowId", "number"], ["flowId", "trialNumber"], ["requestId"]], status: "queued", queuedAt: new Date(), startedAt: null, completedAt: null, doneCount: 0, currentAnalysisId: null, failedAnalysisId: null, failedStepLabel: null, failureWords: null, failureDetail: null, preparing: null, summary: null, inputs: [], environment: null, trialSample: null, requestId: null, number: null, trialNumber: null, notifyOnFinish: false, startedByMemberId: null, startedByName: null, outputsPrunedAt: null, recipeRevision: 0, flowRevisionId: null, verification: null },
    pipelineRun: { status: "pending", runFolder: null, inputSampleIds: null, config: null, studyId: "study1" },
    explorePipelineCache: { __unique: [["targetKey", "pipelineId", "version", "inputHash"]] },
  });
  return { db: state.memory.db };
});

const fastqc = vi.hoisted(() => ({
  definition: {
    id: "fastqc", name: "FastQC", description: "Checks read quality", category: "qc", version: "0.12.1", requires: {}, outputs: [], visibility: { showToUser: true, userCanStart: true },
    input: { supportedScopes: ["study"], minSamples: 1, perSample: { reads: true, pairedEnd: false } }, samplesheet: { format: "csv", generator: "samplesheet.yaml" },
    configSchema: { type: "object", properties: { kmers: { type: "integer", title: "Kmer size", minimum: 2, maximum: 10, default: 7, "x-seqdesk": { placement: "advanced" } } } },
    defaultConfig: { kmers: 7 },
  },
  pkg: {
    id: "fastqc", basePath: "/packages/fastqc",
    manifest: { package: { id: "fastqc", name: "FastQC", version: "0.12.1", description: "Checks read quality per sample.", provider: "SeqDesk" },
      outputs: [{ id: "summary", scope: "run", destination: "run_artifact", discovery: { pattern: "summary.tsv" }, table: { label: "FastQC quality summary", tableKind: "sample-summary", sampleColumn: "sample_id" } }] },
  },
}));
vi.mock("@/lib/pipelines/registry", () => ({ PIPELINE_REGISTRY: { fastqc: fastqc.definition } }));
vi.mock("@/lib/pipelines/package-loader", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/pipelines/package-loader")>()), getPackage: (id: string) => (id === "fastqc" ? fastqc.pkg : undefined), findStepByProcessFromPackage: () => null }));
vi.mock("@/lib/pipelines/definitions", () => ({ getStepsForPipeline: (id: string) => (id === "fastqc" ? [{ id: "fastqc", name: "FastQC" }, { id: "multiqc", name: "MultiQC" }] : []) }));
vi.mock("@/lib/pipelines/enablement", () => ({ getPipelineEnabled: async () => true }));
vi.mock("@/lib/pipelines/execution-settings", () => ({ getExecutionSettings: async () => ({ useSlurm: false, pipelineRunDir: "/runs" }) }));
vi.mock("@/lib/pipelines/database-downloads", () => ({ getPipelineDatabaseStatuses: async () => [] }));
vi.mock("@/lib/pipelines/pipeline-readiness-service", () => ({ parsePipelineConfig: (raw: string | null | undefined) => (raw ? JSON.parse(raw) : {}) }));
vi.mock("@/lib/pipelines/data-study", () => ({
  dataStudyAlias: (key: string) => `seqdesk-data:${key}`,
  findDataStudy: async () => ({ id: "study1" }),
  linkedReadRecords: async () => [],
  readsInData: async () => ({ files: state.files, pairs: Array.from({ length: state.pairCount }, (_, i) => ({ sampleId: `S${i + 1}`, r1: state.files[i * 2], r2: state.files[i * 2 + 1] ?? null })), words: "" }),
  ensureDataStudy: async () => ({ studyId: "study1", sampleIds: Array.from({ length: state.pairCount }, (_, i) => `sample-${i + 1}`), pairs: [] }),
  readsSnapshot: (files: Array<{ id: string; name: string; sizeBytes: number }>) => ({ files: files.map((file) => ({ id: file.id, name: file.name, size: file.sizeBytes })) }),
  readsChangedSinceRun: async () => null,
}));
vi.mock("@/lib/pipelines/pipeline-run-service", () => ({
  createPipelineRunForOperator: vi.fn(async (input: { body: Record<string, unknown>; userId: string; accessScope: string; canManageConfig: boolean }) => {
    state.created.push({ ...input.body, userId: input.userId, accessScope: input.accessScope, canManageConfig: input.canManageConfig });
    if (state.createResponse) return state.createResponse(input.body);
    const run = await state.memory!.db.pipelineRun.create({ data: { runNumber: `FASTQC-${state.created.length}`, pipelineId: input.body.pipelineId, status: "pending", inputSampleIds: JSON.stringify(input.body.sampleIds), userId: input.userId, runFolder: os.tmpdir() } }) as { id: string };
    return { status: 200, body: { success: true, run: { id: run.id } } };
  }),
  startPipelineRunForOperator: vi.fn(async (input: { runId: string }) => { await state.memory!.db.pipelineRun.update({ where: { id: input.runId }, data: { status: "running", startedAt: new Date() } }); return { status: 200, body: { success: true } }; }),
}));
vi.mock("@/lib/pipelines/pipeline-run-ops-service", () => ({ cancelPipelineRunForOperator: vi.fn(async (id: string) => { state.cancelled.push(id); await state.memory!.db.pipelineRun.update({ where: { id }, data: { status: "cancelled" } }); return { status: 200, body: {} }; }) }));
vi.mock("@/lib/pipelines/run-resume", () => ({ resumePipelineRun: vi.fn(async (runId: string, overrides: { memory?: string | null }) => { state.resumed.push({ runId, memory: overrides.memory ?? null }); await state.memory!.db.pipelineRun.update({ where: { id: runId }, data: { status: "running" } }); return { status: 200, body: { resumed: 1 } }; }) }));
vi.mock("@/lib/pipelines/pipeline-data-service", () => ({
  pastDurations: async () => [1800],
  runBelongsTo: async () => true,
  getDataRun: async (id: string) => {
    const run = (await state.memory!.db.pipelineRun.findUnique({ where: { id } })) as { status: string } | null;
    const plain = state.plain.get(id) ?? { shape: run?.status === "completed" ? "finished" : "running", word: "Running", sentence: run?.status === "completed" ? "Finished in 30 min" : "Running · step 1 of 2: FastQC · ~20 min left",
      action: { kind: "cancel", label: "Cancel" }, stages: [{ name: "FASTQC", state: "running" }], processes: [{ name: "FASTQC", status: "running", tasks: 2, done: 1, running: 1, failed: 0 }], error: null, keeps: null, queue: null, estimate: { seconds: 1800, words: "about 30 min" }, elapsedSeconds: 600 };
    return { plain, startedBy: "Amara Okafor", where: state.where ?? "this server", resumed: 0, log: ["fastqc: 1 of 2 samples"] };
  },
}));
vi.mock("./build", () => ({ runBuilder: vi.fn(async () => ({ kind: "pipeline-table", tableKind: "sample-summary", name: "FastQC quality summary", description: null, sensitivity: "standard", roles: { sample: "sample_db_id" },
  schema: { columns: [{ key: "sample_id", label: "Sample", type: "string" }] }, rows: [{ sample_id: "S1" }, { sample_id: "S2" }], keys: { sample: "sample_db_id" },
  provenance: { builtAt: "2026-10-06T10:00:00.000Z", builder: "pipeline-table@2", sources: [{ type: "pipeline-run", id: "prun", label: "FASTQC-1" }] }, sourceConfig: {}, warnings: [] })) }));
vi.mock("./datasets", async (importOriginal) => ({ ...(await importOriginal<typeof import("./datasets")>()), writeDatasetVersion: vi.fn(async (input: { datasetId: string; rows: unknown[] }) => { state.written.push({ datasetId: input.datasetId, rows: input.rows.length }); return { versionId: `v${state.written.length}`, number: state.written.length, rowCount: input.rows.length, contentHash: "h", unchanged: false }; }) }));
vi.mock("./runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./runner")>()),
  createAndStartRun: vi.fn(async (input: { analysisId: string; revisionId: string; createdById: string; runId: string; flowRun: { id: string; stepLabel: string } }) => {
    state.codeStarted.push(input.analysisId);
    const run = await state.memory!.db.exploreAnalysisRun.create({ data: { id: input.runId, analysisId: input.analysisId, revisionId: input.revisionId, runNumber: `EXP-T-${state.codeStarted.length}`, status: "running", startedAt: new Date(), createdById: input.createdById, flowRunId: input.flowRun.id, stepLabel: input.flowRun.stepLabel, executionMode: "local" } }) as { id: string; runNumber: string; status: string };
    return { id: run.id, runNumber: run.runNumber, status: run.status };
  }),
  cancelRun: vi.fn(async (id: string) => { await state.memory!.db.exploreAnalysisRun.updateMany({ where: { id, status: { in: ["pending", "queued", "running"] } }, data: { status: "cancelled" } }); return true; }),
}));
vi.mock("./flow-events", () => ({ flowRunChanged: vi.fn(async () => undefined) }));
vi.mock("./flow-inputs", () => ({ flowInputsProblem: async () => null }));
vi.mock("./environments", () => ({ resolveReadyEnvironment: async () => ({ prefixPath: "/envs/r", specHash: "spec" }) }));
vi.mock("./environment-lock", () => ({ pinEnvironment: async () => ({ name: "seqdesk-explore-r", specHash: "spec", lockDigest: "5c1e9a".padEnd(64, "0"), label: "R 4.4 · lock 5c1e9a", language: "r", languageVersion: "4.4", host: "test" }) }));
vi.mock("./step-environments", async (importOriginal) => ({ ...(await importOriginal<typeof import("./step-environments")>()), resolveStepEnvironment: async (step: { environmentName: string }) => ({ name: step.environmentName, derived: false, status: "ready", packages: { packages: [], channels: [] } }) }));
vi.mock("./recipe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./recipe")>();
  return { ...actual, loadRecipe: vi.fn(async () => recipeModel()), ensureRecipeRevision: vi.fn(async () => ({ recipeRevision: 1, revisionId: "frev-1" })) };
});

import { advanceFlowRun, cancelFlowRun, getFlowRunDetail, planRun, serializeFlowRunById, startFlowRun } from "./flow-runs";
import { pipelineStepCode, preflightConfig, resetPipelineStepsProbe, type PipelineStepConfig } from "./pipeline-steps";
import { pipelineFailureWords, pipelineSnapshot, sampleProgress, stagesFrom, stopPipelineStepRun } from "./pipeline-step-runs";
import { plainRunStatus, type PlainRunInput } from "@/lib/pipelines/plain-status";
import { pipelineStepViews } from "./pipeline-step-view";
import { resumePipelineStep } from "./run-plan";
import { codeHashOf } from "./analyses";
import type { RecipeModel } from "./recipe";
import type { NextflowTask } from "@/lib/pipelines/nextflow/trace-parser";

const config: PipelineStepConfig = { pipelineId: "fastqc", version: "0.12.1", params: { kmers: 5 }, samples: null, outputs: [{ outputId: "summary", name: "fastqc_summary" }] };
const actor = { userId: "u1", memberId: "m1", name: "Amara Okafor" };
const access = { userId: "u1", canRun: true, installation: false, canManage: false };
const db = () => state.memory!.db as unknown as Record<string, { findMany: (args?: unknown) => Promise<Array<Record<string, unknown>>>; findUnique: (args: unknown) => Promise<Record<string, unknown> | null>; update: (args: unknown) => Promise<unknown>; updateMany: (args: unknown) => Promise<{ count: number }>; create: (args: unknown) => Promise<Record<string, unknown>> }>;
const rows = (name: string) => state.memory!.table(name);

function recipeModel(): RecipeModel {
  const flow = rows("exploreFlow")[0] as { currentRunId: string | null };
  const created = new Date("2026-10-01T10:00:00Z");
  const code = pipelineStepCode(config);
  return {
    flow: { id: "flow1", targetKey: "project:p1", name: "Read QC", description: null, recipeRevision: 1, runCounter: 0, currentRunId: flow?.currentRunId ?? null, layout: null, headlineValue: null, createdById: "u1", createdByMemberId: null, createdAt: created, updatedAt: created },
    steps: [
      { id: "qc", name: "FastQC", description: null, purpose: null, kitId: null, language: "shell", environmentName: "pipeline:fastqc", packages: null, position: "a0", laneKind: null, laneOf: null, laneLabel: null, groupId: null, paramMeta: null, methodsSentence: null, proposedByTurnId: null, createdAt: created, currentRevisionId: "rev-qc",
        revision: { id: "rev-qc", number: 1, code, codeHash: codeHashOf(code), params: JSON.stringify(config.params), inputs: "[]", fileInputs: "[]", author: "user", authorUserId: "u1", createdAt: created }, bindings: [], stepKind: "pipeline", pipeline: config },
      { id: "overview", name: "FastQC overview", description: null, purpose: null, kitId: null, language: "r", environmentName: "seqdesk-explore-r", packages: null, position: "a1", laneKind: null, laneOf: null, laneLabel: null, groupId: null, paramMeta: null, methodsSentence: null, proposedByTurnId: null, createdAt: created, currentRevisionId: "rev-ov",
        revision: { id: "rev-ov", number: 1, code: "x", codeHash: codeHashOf("x"), params: "{}", inputs: "[]", fileInputs: "[]", author: "user", authorUserId: "u1", createdAt: created }, bindings: [{ alias: "summary", datasetId: "ds-summary", versionId: null }], stepKind: "code", pipeline: null },
    ],
    labels: new Map([["qc", "1"], ["overview", "2"]]),
    upstream: new Map([["qc", new Set<string>()], ["overview", new Set(["qc"])]]),
    datasets: new Map([["ds-summary", { id: "ds-summary", name: "fastqc_summary (FastQC)", kind: "derived", tableKind: "sample-summary", roles: null, sensitivity: "standard", currentVersionId: null, producer: "qc", artifactName: "fastqc_summary", current: null }]]),
  };
}

async function finishCodeStep(flowRunId: string, analysisId: string) {
  await db().exploreAnalysisRun.updateMany({ where: { flowRunId, analysisId }, data: { status: "completed", completedAt: new Date(), results: JSON.stringify({ metrics: { checks: 3 } }) } });
}
const setPipeline = (id: string, data: Record<string, unknown>) => db().pipelineRun.update({ where: { id }, data });
const stepRun = (flowRunId: string, analysisId: string) => rows("exploreAnalysisRun").find((row) => row.flowRunId === flowRunId && row.analysisId === analysisId) as Record<string, unknown> | undefined;

beforeEach(() => {
  state.memory!.reset();
  Object.assign(state, { created: [], createResponse: null, cancelled: [], resumed: [], written: [], codeStarted: [], pairCount: 2, where: null });
  state.plain.clear();
  state.files = [{ id: "f1", name: "S1_R1.fastq.gz", sizeBytes: 100 }, { id: "f2", name: "S1_R2.fastq.gz", sizeBytes: 100 }, { id: "f3", name: "S2_R1.fastq.gz", sizeBytes: 100 }, { id: "f4", name: "S2_R2.fastq.gz", sizeBytes: 100 }];
  resetPipelineStepsProbe(true);
  const tables = state.memory!.table;
  tables("exploreFlow").push({ id: "flow1", targetKey: "project:p1", name: "Read QC", runCounter: 0, trialCounter: 0, recipeRevision: 1, currentRunId: null, headlineValue: null, layout: null, createdById: "u1", createdAt: new Date(), updatedAt: new Date() });
  tables("exploreAnalysis").push({ id: "qc", flowId: "flow1", targetKey: "project:p1", name: "FastQC", stepKind: "pipeline", packages: null, createdAt: new Date() }, { id: "overview", flowId: "flow1", targetKey: "project:p1", name: "FastQC overview", stepKind: "code", packages: null, createdAt: new Date() });
  tables("exploreAnalysisRevision").push({ id: "rev-qc", analysisId: "qc", number: 1, code: pipelineStepCode(config), codeHash: codeHashOf(pipelineStepCode(config)), params: JSON.stringify(config.params), inputs: "[]", pipeline: config }, { id: "rev-ov", analysisId: "overview", number: 1, code: "x", codeHash: codeHashOf("x"), params: "{}", inputs: "[]", pipeline: null });
  tables("exploreDataset").push({ id: "ds-summary", targetKey: "project:p1", kind: "derived", name: "fastqc_summary (FastQC)", sourceConfig: JSON.stringify({ builder: "analysis-run", analysisId: "qc", artifactName: "fastqc_summary" }), createdAt: new Date() });
  // The study's Data belongs to the person who starts the runs (u1); u2 is a collaborator.
  tables("study").push({ id: "study1", userId: "u1" });
  tables("user").push({ id: "u1", firstName: "Amara", lastName: "Okafor", email: "a@example.org" }, { id: "u2", firstName: "Lena", lastName: "Berg", email: "l@example.org" });
});

describe("a pipeline step in a run of the recipe", () => {
  it("plans the pipeline step as a pipeline", () => {
    const model = recipeModel();
    const plan = planRun(model, "all", new Map(), new Map());
    expect(plan.map((entry) => [entry.analysisId, entry.kind ?? "code", entry.execute, entry.dependsOn])).toEqual([["qc", "pipeline", true, []], ["overview", "code", true, ["qc"]]]);
  });

  it("starts the pipeline once, waits, writes its table as the step's table, then the next step runs", async () => {
    const run = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    expect(run).toMatchObject({ number: 1, status: "running", progress: { done: 0, total: 2, current: { stepId: "qc", label: "1" } } });
    expect(state.created).toEqual([{ pipelineId: "fastqc", studyId: "study1", sampleIds: ["sample-1", "sample-2"], config: { kmers: 5 }, userId: "u1", accessScope: "own", canManageConfig: false }]);
    const qc = stepRun(run.id, "qc")!;
    expect(qc).toMatchObject({ id: `fr_${run.id}_qc`, executionMode: "pipeline", status: "running", runFolder: null });
    expect(qc.pipelineRunId).toBe(rows("pipelineRun")[0].id);
    expect(rows("explorePipelineCache")).toEqual([expect.objectContaining({ targetKey: "project:p1", pipelineId: "fastqc", version: "0.12.1", pipelineRunId: qc.pipelineRunId })]);
    expect(state.codeStarted).toEqual([]);

    // Advancing again (another process, the monitor) neither starts it twice nor blocks.
    await advanceFlowRun(run.id);
    expect(state.created).toHaveLength(1);
    const waiting = await serializeFlowRunById(run.id);
    expect(waiting.pipeline).toEqual({ stepId: "qc", label: "1", status: "running", words: "Running · step 1 of 2: FastQC · ~20 min left" });

    await setPipeline(String(qc.pipelineRunId), { status: "completed", completedAt: new Date() });
    await advanceFlowRun(run.id);
    expect(state.written).toEqual([{ datasetId: "ds-summary", rows: 2 }]);
    expect(stepRun(run.id, "qc")).toMatchObject({ status: "completed" });
    expect(state.codeStarted).toEqual(["overview"]);

    await finishCodeStep(run.id, "overview");
    await advanceFlowRun(run.id);
    const detail = await getFlowRunDetail(run.id);
    expect(detail.status).toBe("completed");
    expect(detail.steps[0]).toMatchObject({ stepId: "qc", status: "completed", kind: "pipeline", pipeline: { status: "completed", pipelineId: "fastqc", sampleCount: 2, outputs: [{ name: "fastqc_summary", datasetId: "ds-summary", versionId: "v1", rows: 2 }] } });
    expect((rows("exploreFlow")[0] as { currentRunId: string }).currentRunId).toBe(run.id);
  });

  it("reuses the finished pipeline run when nothing it reads changed: nothing starts, the next steps run on its table", async () => {
    const first = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    await setPipeline(String(stepRun(first.id, "qc")!.pipelineRunId), { status: "completed", completedAt: new Date() });
    await advanceFlowRun(first.id);
    await finishCodeStep(first.id, "overview");
    await advanceFlowRun(first.id);

    const second = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    expect(state.created).toHaveLength(1);
    const reused = stepRun(second.id, "qc")!;
    expect(reused).toMatchObject({ status: "completed", pipelineRunId: stepRun(first.id, "qc")!.pipelineRunId, reusedFromRunId: stepRun(first.id, "qc")!.id });
    expect(JSON.parse(String(reused.results)).pipeline).toMatchObject({ reused: true });
    expect(state.codeStarted).toEqual(["overview", "overview"]);

    // New reads in Data: a new pipeline run.
    state.files = [...state.files, { id: "f5", name: "S3_R1.fastq.gz", sizeBytes: 100 }, { id: "f6", name: "S3_R2.fastq.gz", sizeBytes: 100 }];
    state.pairCount = 3;
    await finishCodeStep(second.id, "overview");
    await advanceFlowRun(second.id);
    const third = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    expect(state.created).toHaveLength(2);
    expect(stepRun(third.id, "qc")).toMatchObject({ status: "running" });
  });

  it("fails the recipe run with the pipeline's own sentence and stops before the next step", async () => {
    const run = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    const pipelineRunId = String(stepRun(run.id, "qc")!.pipelineRunId);
    state.plain.set(pipelineRunId, { shape: "needs-you", word: "Needs you", sentence: "DADA2 ran out of memory on sample S2 · Resume with 64 GB", action: { kind: "resume", label: "Resume with 64 GB", memory: "64 GB" },
      stages: [{ name: "FASTQC", state: "done" }, { name: "DADA2", state: "failed" }], processes: [], error: { kind: "memory", sentence: "DADA2 ran out of memory on sample S2 · Resume with 64 GB", firstLines: ["Process `DADA2 (S2)` terminated (exit 137)"], process: "DADA2", sample: "S2", exitCode: 137 },
      keeps: { finishedSteps: 1, tasks: 2, restartsAt: "DADA2", words: "1 finished step, restarts at DADA2" }, queue: null, estimate: { seconds: null, words: "no estimate yet" }, elapsedSeconds: 900 });
    await setPipeline(pipelineRunId, { status: "failed", completedAt: new Date() });
    await advanceFlowRun(run.id);
    const detail = await getFlowRunDetail(run.id);
    expect(detail).toMatchObject({ status: "failed", failed: { stepId: "qc", stepLabel: "1", words: "Step 1 (FastQC) stopped: DADA2 ran out of memory on sample S2" } });
    expect(detail.steps[0].pipeline).toMatchObject({ status: "failed", error: { kind: "memory", fix: { kind: "resume", label: "Resume with 64 GB", memory: "64 GB" } }, keeps: { finishedSteps: 1 } });
    expect(state.codeStarted).toEqual([]);

    // Resume: a new run of that step whose pipeline run continues in place, with more memory.
    const resumed = await resumePipelineStep("flow1", "qc", { memory: "64 GB", actor, access });
    expect(state.resumed).toEqual([{ runId: pipelineRunId, memory: "64 GB" }]);
    expect(state.created).toHaveLength(1);
    expect(stepRun(resumed.id, "qc")).toMatchObject({ status: "running", pipelineRunId });
  });

  it("cancelling the recipe run cancels its pipeline run, unless another recipe run waits on it", async () => {
    const run = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    const pipelineRunId = String(stepRun(run.id, "qc")!.pipelineRunId);
    await cancelFlowRun(run.id);
    expect(state.cancelled).toEqual([pipelineRunId]);
    expect(stepRun(run.id, "qc")).toMatchObject({ status: "cancelled" });

    // Two step runs on one pipeline run: the first stop leaves it running.
    state.memory!.table("exploreAnalysisRun").push({ id: "a", analysisId: "qc", status: "running", executionMode: "pipeline", pipelineRunId: "shared", runNumber: "EXP-A" }, { id: "b", analysisId: "qc", status: "running", executionMode: "pipeline", pipelineRunId: "shared", runNumber: "EXP-B" });
    state.memory!.table("pipelineRun").push({ id: "shared", status: "running", runNumber: "FASTQC-9" });
    await stopPipelineStepRun("a");
    expect(state.cancelled).toEqual([pipelineRunId]);
    await stopPipelineStepRun("b");
    expect(state.cancelled).toEqual([pipelineRunId, "shared"]);
  });

  it("a cancel that arrives after the pipeline finished keeps the step finished, with its tables", async () => {
    const run = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    const pipelineRunId = String(stepRun(run.id, "qc")!.pipelineRunId);
    // FastQC finished; the recipe has not looked yet when Cancel is pressed.
    await setPipeline(pipelineRunId, { status: "completed", completedAt: new Date() });
    await cancelFlowRun(run.id);
    expect(state.cancelled).toEqual([]);
    expect(stepRun(run.id, "qc")).toMatchObject({ status: "completed" });
    expect(JSON.parse(String(stepRun(run.id, "qc")!.results)).pipeline.status).toBe("completed");
    // The step after it had not started: the recipe run itself is cancelled.
    expect(rows("exploreFlowRun").find((row) => row.id === run.id)).toMatchObject({ status: "cancelled" });
    expect(stepRun(run.id, "overview")).toBeUndefined();
  });

  it("never starts a pipeline in a trial: the step's last result is read, or the trial is refused", async () => {
    await expect(startFlowRun("flow1", { scope: "all", trial: true, actor, pipelines: { access } })).rejects.toMatchObject({ message: "Trials do not run pipelines; run the recipe once first." });
    const run = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    await setPipeline(String(stepRun(run.id, "qc")!.pipelineRunId), { status: "completed", completedAt: new Date() });
    await advanceFlowRun(run.id);
    await finishCodeStep(run.id, "overview");
    await advanceFlowRun(run.id);
    const trial = await startFlowRun("flow1", { scope: "all", trial: true, actor, pipelines: { access } });
    expect(state.created).toHaveLength(1);
    expect(stepRun(trial.id, "qc")).toBeUndefined();
    expect(state.codeStarted).toEqual(["overview", "overview"]);
  });

  it("refuses a run before recording it when the starter may not start pipelines here, unless the same work already finished", async () => {
    const before = rows("exploreFlowRun").length;
    await expect(startFlowRun("flow1", { scope: "all", actor, pipelines: { access: { ...access, userId: "u2" } } })).rejects.toMatchObject({ code: "forbidden", message: "Step 1 is not ready: Only Amara Okafor or a SeqDesk admin starts pipelines here." });
    await expect(startFlowRun("flow1", { scope: "all", actor, pipelines: { access: { ...access, canRun: false } } })).rejects.toMatchObject({ code: "forbidden" });
    expect(rows("exploreFlowRun").length).toBe(before);
    // Starting a run from elsewhere without saying who may start pipelines is refused too.
    await expect(startFlowRun("flow1", { scope: "all", actor })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("says a refusal of the run service in words on the step", async () => {
    state.createResponse = () => ({ status: 400, body: { error: "Pipeline config validation failed", details: ["Kmer size must be at most 10."] } });
    const run = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    await advanceFlowRun(run.id);
    const detail = await getFlowRunDetail(run.id);
    expect(detail.status).toBe("failed");
    expect(detail.failed?.words).toBe("Step 1 could not start FastQC: Pipeline config validation failed · Kmer size must be at most 10.");
    expect(stepRun(run.id, "qc")!.errorTail).toBe("Step 1 could not start FastQC: Pipeline config validation failed · Kmer size must be at most 10.");
  });
});

describe("progress in plain words", () => {
  const task = (process: string, tag: string | null, status: NextflowTask["status"], minute: number): NextflowTask => ({ taskId: `${process}-${tag}`, hash: "ab/cd", nativeId: "1", name: `${process} (${tag})`, process, tag, status, exit: status === "FAILED" ? 1 : 0,
    submit: new Date(2026, 9, 6, 10, minute), start: null, complete: null, duration: null, realtime: null, cpuPercent: null, peakRss: null, peakVmem: null, workdir: null });
  it("counts the samples of the stage being worked on, and names failed samples", () => {
    const tasks = [task("FASTQC", "S1", "COMPLETED", 1), task("FASTQC", "S2", "COMPLETED", 1), task("FASTQC", "S3", "COMPLETED", 1),
      task("CUTADAPT", "S1", "COMPLETED", 5), task("CUTADAPT", "S2", "RUNNING", 6), task("CUTADAPT", "S3", "FAILED", 6)];
    const stages = stagesFrom("unknown", { stages: [{ name: "FASTQC", state: "done" }, { name: "CUTADAPT", state: "running" }], processes: [{ name: "X:FASTQC", status: "done", tasks: 3, done: 3, running: 0, failed: 0, cpuHours: null, peakBytes: null, seconds: null }, { name: "X:CUTADAPT", status: "running", tasks: 3, done: 1, running: 1, failed: 1, cpuHours: null, peakBytes: null, seconds: null }] }, "running", tasks);
    expect(stages).toEqual([{ name: "FASTQC", state: "done", samples: { done: 3, total: 3 } }, { name: "CUTADAPT", state: "running", samples: { done: 1, total: 3 } }]);
    expect(sampleProgress(tasks, 4, stages)).toEqual({ total: 4, done: 1, running: 1, failed: 1, waiting: 1, perSample: true, stage: "CUTADAPT", failedSamples: [{ sample: "S3", stage: "CUTADAPT", words: "failed at CUTADAPT (exit 1)" }] });
    expect(sampleProgress([], 0, stages)).toBeNull();
  });

  it("counts the run's samples only: a stage with samples still to come is running, a summary over all samples is no sample, a finished run has every sample done", () => {
    // Live on the CRC lab: FastQC on 42 samples read "Run FastQC · done 13/13" while 29 samples waited (the trace lists a
    // task once it finished), and the finished run said 1 of 42 samples done (its summary task counted as the stage).
    const samples = { names: ["S1", "S2", "S3", "S4"], total: 4 };
    const process = (name: string, done: number) => ({ name, status: "done" as const, tasks: done, done, running: 0, failed: 0, cpuHours: null, peakBytes: null, seconds: null });
    const half = [task("FASTQC", "S1", "COMPLETED", 1), task("FASTQC", "S2", "COMPLETED", 2)];
    const plainHalf = { stages: [{ name: "FASTQC", state: "done" as const }], processes: [process("X:FASTQC", 2)] };
    expect(stagesFrom("unknown", plainHalf, "running", half, samples)).toEqual([{ name: "FASTQC", state: "running", samples: { done: 2, total: 4 } }]);
    // Stopped there: not done, not failed; Resume starts at it.
    expect(stagesFrom("unknown", plainHalf, "cancelled", half, samples)[0]).toMatchObject({ state: "waiting", samples: { done: 2, total: 4 } });
    expect(sampleProgress(half, 4, [{ name: "FASTQC", state: "running" }], { names: samples.names })).toMatchObject({ total: 4, done: 2, waiting: 2, stage: "FASTQC" });

    const all = [...samples.names.map((name, i) => task("FASTQC", name, "COMPLETED", i)), task("SUMMARIZE", "fastqc-summary", "COMPLETED", 9)];
    const plainAll = { stages: [{ name: "FASTQC", state: "done" as const }, { name: "SUMMARIZE", state: "done" as const }], processes: [process("X:FASTQC", 4), process("X:SUMMARIZE", 1)] };
    const stages = stagesFrom("unknown", plainAll, "completed", all, samples);
    expect(stages).toEqual([{ name: "FASTQC", state: "done", samples: { done: 4, total: 4 } }, { name: "SUMMARIZE", state: "done", samples: null }]);
    expect(sampleProgress(all, 4, stages, { names: samples.names, finished: true })).toEqual({ total: 4, done: 4, running: 0, failed: 0, waiting: 0, perSample: true, stage: "SUMMARIZE", failedSamples: [] });
    // Without the samples' names every tagged task counts, as before.
    expect(stagesFrom("unknown", plainAll, "completed", all)[1]).toMatchObject({ samples: { done: 1, total: 1 } });
  });

  it("keeps names with capitals when the sentence goes mid-line", () => {
    expect(pipelineFailureWords("2", JSON.stringify({ pipeline: { pipelineId: "fastqc", error: { sentence: "Assembly ran out of memory · Resume with 128 GB" } } }), null)).toBe("Step 2 (FastQC) stopped: assembly ran out of memory");
    expect(pipelineFailureWords("2", null, "SLURM did not take the job")).toBe("Step 2 (the pipeline) stopped: SLURM did not take the job");
  });
});

describe("a stopped, reused or not-ready pipeline step as people read it (found live on the CRC example lab)", () => {
  const view = async (stoppedAfter?: Date | null) => (await pipelineStepViews({ model: recipeModel(), viewed: new Map(), activeRunId: null, readsChanged: new Map(), access, stoppedAfter })).get("qc")!;

  it("a cancelled step run says it stopped and what Resume keeps, not its last Running pass, and the recipe shows it", async () => {
    const run = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    const pipelineRunId = String(stepRun(run.id, "qc")!.pipelineRunId);
    state.plain.set(pipelineRunId, { shape: "cancelled", word: "Cancelled", sentence: "Cancelled at MultiQC · 1 finished step is kept", action: { kind: "run-again", label: "Run again" },
      stages: [{ name: "FASTQC", state: "done" }, { name: "MULTIQC", state: "waiting" }], processes: [], error: null, keeps: { finishedSteps: 1, tasks: 2, restartsAt: "MultiQC", words: "1 finished step, restarts at MultiQC" }, queue: null, estimate: { seconds: null, words: "no estimate yet" }, elapsedSeconds: 300 });
    await cancelFlowRun(run.id);
    const stopped = stepRun(run.id, "qc")!;
    expect(stopped.status).toBe("cancelled");
    expect(JSON.parse(String(stopped.results)).pipeline).toMatchObject({ status: "cancelled", words: "Cancelled at MultiQC · 1 finished step is kept", keeps: { finishedSteps: 1 } });
    expect((await getFlowRunDetail(run.id)).steps[0].pipeline).toMatchObject({ status: "cancelled" });
    // The recipe as it is now shows where it stopped (Resume); a run a person picks shows that run only.
    expect((await view(null)).run).toMatchObject({ status: "cancelled", stepStatus: "cancelled", flowRunNumber: 1, keeps: { words: "1 finished step, restarts at MultiQC" } });
    expect((await view(undefined)).run).toBeNull();
  });

  it("a failed step run is the run the recipe shows until the step runs again: its error, its fix, what Resume keeps", async () => {
    const run = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    const pipelineRunId = String(stepRun(run.id, "qc")!.pipelineRunId);
    state.plain.set(pipelineRunId, { shape: "needs-you", word: "Needs you", sentence: "FastQC hit the 1 s time limit", action: { kind: "resume", label: "Resume with 2 s", time: "2 s" },
      stages: [{ name: "FASTQC", state: "failed" }], processes: [], error: { kind: "time", sentence: "FastQC hit the 1 s time limit", firstLines: [], process: "FASTQC", sample: "S1", exitCode: 140 },
      keeps: { finishedSteps: 0, tasks: 0, restartsAt: "FastQC", words: "0 finished steps, restarts at FastQC" }, queue: null, estimate: { seconds: null, words: "no estimate yet" }, elapsedSeconds: 12 });
    await setPipeline(pipelineRunId, { status: "failed", completedAt: new Date() });
    await advanceFlowRun(run.id);
    expect((await view(null)).run).toMatchObject({ status: "failed", flowRunNumber: 1, error: { kind: "time", fix: { kind: "resume", label: "Resume with 2 s", time: "2 s" } } });
    // Once the step finished again (a later current run), the stop is history.
    expect((await view(new Date(Date.now() + 60_000))).run).toBeNull();
  });

  it("says which run of the recipe ran a pipeline run it reuses (reused from Run #1, not its own number)", async () => {
    const first = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    await setPipeline(String(stepRun(first.id, "qc")!.pipelineRunId), { status: "completed", completedAt: new Date() });
    await advanceFlowRun(first.id);
    await finishCodeStep(first.id, "overview");
    await advanceFlowRun(first.id);
    const second = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    expect(JSON.parse(String(stepRun(second.id, "qc")!.results)).pipeline).toMatchObject({ reused: true, reusedFrom: { flowRunId: first.id, number: 1 } });
    expect((await getFlowRunDetail(second.id)).steps[0]).toMatchObject({ status: "completed", reusedFrom: { flowRunId: first.id, number: 1 } });
  });

  it("offers the admin, not a setting the step may not set, when a setting only an admin sets is missing", async () => {
    const schema = fastqc.definition.configSchema;
    fastqc.definition.configSchema = { type: "object", required: ["markers"], properties: { ...schema.properties, markers: { type: "string", title: "Marker database", "x-seqdesk": { placement: "admin" } } } } as unknown as typeof schema;
    try {
      const forMember = await preflightConfig(recipeModel(), config, "qc", access);
      expect(forMember.checks.find((check) => check.id === "settings")).toMatchObject({ ok: false, words: "Marker database needs a value", fix: { kind: "ask-admin", label: "Ask an admin", key: "markers" } });
      const forAdmin = await preflightConfig(recipeModel(), config, "qc", { ...access, canManage: true });
      expect(forAdmin.checks.find((check) => check.id === "settings")?.fix).toMatchObject({ kind: "ask-admin", label: "Set it in the pipeline’s settings", key: "markers" });
    } finally {
      fastqc.definition.configSchema = schema;
    }
  });
});

describe("on SLURM: the step reads the run's state in the same words as the Data card (MOCKED scheduler fields, real plain status)", () => {
  const now = new Date();
  // What the monitor keeps on a SLURM run (queue-probe + reconciler), and what the server asked SLURM for.
  const slurmRun = (fields: Partial<PlainRunInput>): PlainRunInput => ({ status: "queued", executionMode: "slurm", queueJobId: "4819227", askedMemory: "4 GB", askedCores: 2, timeLimitHours: 2, queue: "cpu", queuedAt: now, ...fields });
  async function snapshotFor(fields: Partial<PlainRunInput>) {
    state.where = "SLURM";
    const run = await db().pipelineRun.create({ data: { runNumber: "FASTQC-9", pipelineId: "fastqc", status: fields.status ?? "queued", inputSampleIds: JSON.stringify(["sample-1"]), runFolder: null } }) as { id: string };
    state.plain.set(run.id, plainRunStatus({ now, run: slurmRun(fields) }) as unknown as Record<string, unknown>);
    return (await pipelineSnapshot(run.id, "project:p1"))!;
  }

  it.each([
    ["Priority", "Waiting in the queue · other jobs go first"],
    ["Resources", "Waiting for a free node with 2 cores and 4 GB"],
    ["QOSMaxJobsPerUserLimit", "Waiting: your lab already has its maximum of jobs running"],
  ])("queued with %s: the reason in words, on SLURM, nothing to fix", async (reason, words) => {
    const snap = await snapshotFor({ queueStatus: "PENDING", queueReason: reason });
    expect(snap).toMatchObject({ status: "queued", words, where: "SLURM", error: null });
  });

  it("a job SLURM will never start (PartitionTimeLimit): the step says it and its one fix is the admin", async () => {
    const snap = await snapshotFor({ queueStatus: "PENDING", queueReason: "PartitionTimeLimit" });
    expect(snap).toMatchObject({ status: "queued", words: "Won’t start: it asks for more time (2 h) than the cpu queue allows", error: { kind: "time", fix: { kind: "ask-admin", label: "Ask the admin" } } });
  });

  it("running on SLURM: Running, where SLURM", async () => {
    const snap = await snapshotFor({ status: "running", queueStatus: "RUNNING", startedAt: new Date(now.getTime() - 60_000), outputTail: "executor >  slurm (1)\n[ab/cdef12] RUN_FASTQC (S1) | 0 of 1\n" });
    expect(snap).toMatchObject({ status: "running", where: "SLURM", error: null });
    expect(snap.words).toMatch(/^Running · step 1 of \d+: FastQC/);
  });

  it.each([
    ["OUT_OF_MEMORY", "memory", { kind: "resume", label: "Resume with 8 GB", memory: "8 GB" }],
    ["TIMEOUT", "time", { kind: "resume", label: "Resume with 4 h", time: "4h" }],
    ["NODE_FAIL", "node", { kind: "resume", label: "Resume" }],
  ])("ended %s: the error kind (%s) and its one fix on the step", async (state_, kind, fix) => {
    const snap = await snapshotFor({ status: "failed", queueStatus: state_, completedAt: now, startedAt: new Date(now.getTime() - 3_600_000) });
    expect(snap).toMatchObject({ status: "failed", where: "SLURM", error: { kind, fix } });
  });

  it("SLURM refused the job: the step says why and offers to start it again", async () => {
    const snap = await snapshotFor({ status: "failed", queueJobId: null, errorTail: "sbatch exited with code 1: sbatch: error: Batch job submission failed: Unable to contact slurm controller (connect failure)" });
    expect(snap).toMatchObject({ status: "failed", words: "SLURM did not take the job: the SLURM controller did not answer", error: { fix: { kind: "run-again", label: "Retry" } } });
  });
});
