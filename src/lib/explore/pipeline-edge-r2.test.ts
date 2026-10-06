/**
 * Edge cases of pipeline steps, round 2 (identity sheets 95–97, 6 Oct 2026), on the fixture of pipeline-step-runs.test.ts:
 * Resume waits for the study's limit and never resumes a stop a later run replaced, or reads that changed; a pipeline
 * the admin switched off, a version no longer here and settings out of bounds or gone from the schema are refused
 * before a run is recorded; Run again (fresh) starts anew; cancelling a step that waits for the limit, cancelling twice;
 * deleting steps stops their pipeline runs.
 */
import os from "os";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: true,
  readsChanged: null as string | null,
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
vi.mock("@/lib/pipelines/enablement", () => ({ getPipelineEnabled: async () => state.enabled }));
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
  readsChangedSinceRun: async () => state.readsChanged,
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

import { advanceFlowRun, cancelFlowRun, getFlowRunDetail, planRun, runRecords, serializeFlowRunById, startFlowRun } from "./flow-runs";
import { pipelineReadsChanged, pipelineStepCode, preflightConfig, resetPipelineStepsProbe, type PipelineStepConfig } from "./pipeline-steps";
import { stopPipelinesOfSteps } from "./pipeline-step-runs";
import { plainRunStatus, type PlainRunInput } from "@/lib/pipelines/plain-status";
import { resumePipelineStep } from "./run-plan";
import { codeHashOf } from "./analyses";
import type { RecipeModel } from "./recipe";

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
  Object.assign(state, { created: [], createResponse: null, cancelled: [], resumed: [], written: [], codeStarted: [], pairCount: 2, where: null, enabled: true, readsChanged: null });
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


const failRun = async (flowRunId: string) => {
  const pipelineRunId = String(stepRun(flowRunId, "qc")!.pipelineRunId);
  await setPipeline(pipelineRunId, { status: "failed", completedAt: new Date() });
  await advanceFlowRun(flowRunId);
  return pipelineRunId;
};
/** Another analysis of the same study whose pipeline step is running now (the study's limit is 1). */
async function otherAnalysisRunning() {
  rows("exploreAnalysis").push({ id: "other-qc", flowId: "flow2", targetKey: "project:p1", name: "FastQC", stepKind: "pipeline", packages: null, createdAt: new Date() });
  const prun = await db().pipelineRun.create({ data: { runNumber: "FASTQC-OTHER", pipelineId: "fastqc", status: "running", userId: "u1" } });
  await db().exploreAnalysisRun.create({ data: { id: "other-run", analysisId: "other-qc", revisionId: "rev-other", runNumber: "EXP-O-1", status: "running", executionMode: "pipeline", pipelineRunId: prun.id, flowRunId: "fr-other" } });
  return String(prun.id);
}

describe("edge cases, round 2", () => {
  it("Resume waits for the study's limit like a new run, then continues the stopped run in place", async () => {
    const first = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    const stopped = await failRun(first.id);
    const other = await otherAnalysisRunning();
    const resumed = await resumePipelineStep("flow1", "qc", { actor, access, memory: "64 GB" });
    const waiting = stepRun(resumed.id, "qc")!;
    expect(waiting.status).toBe("queued");
    expect(JSON.parse(String(waiting.results)).pipeline).toMatchObject({ waiting: { reason: "limit", words: "Waits for the pipeline of this study that is running now (at most 1 at a time)" } });
    expect(state.resumed).toEqual([]);
    // The other analysis's pipeline ends: the claim goes, the next pass resumes the stopped run (not a new one).
    await setPipeline(other, { status: "completed" });
    await advanceFlowRun(resumed.id);
    await advanceFlowRun(resumed.id);
    expect(state.resumed).toEqual([{ runId: stopped, memory: "64 GB" }]);
    expect(state.created.length).toBe(1);
  });

  it("never resumes a stop that a later finished run of the step replaced", async () => {
    const first = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    await failRun(first.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    await setPipeline(String(stepRun(second.id, "qc")!.pipelineRunId), { status: "completed", completedAt: new Date() });
    await advanceFlowRun(second.id);
    await finishCodeStep(second.id, "overview");
    await advanceFlowRun(second.id);
    expect(stepRun(second.id, "qc")!.status).toBe("completed");
    await expect(resumePipelineStep("flow1", "qc", { actor, access })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("refuses Resume after the reads in Data changed, in words, unless forced", async () => {
    const first = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    await failRun(first.id);
    state.readsChanged = "1 file added";
    await expect(resumePipelineStep("flow1", "qc", { actor, access })).rejects.toMatchObject({ code: "reads_changed", message: "The reads in Data changed since this run (1 file added). Resume would use the reads it started with; Run again uses the new ones." });
    const forced = await resumePipelineStep("flow1", "qc", { actor, access, force: true });
    expect(forced.status).not.toBe("failed");
  });

  it("Resume twice: the second is refused while the first runs (one active run per flow)", async () => {
    const first = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    await failRun(first.id);
    await resumePipelineStep("flow1", "qc", { actor, access });
    await expect(resumePipelineStep("flow1", "qc", { actor, access })).rejects.toMatchObject({ code: "run_active" });
    expect(state.resumed.length).toBe(1);
  });

  it("a pipeline the admin switched off after the step was added: the check says so and the run is refused before it is recorded", async () => {
    state.enabled = false;
    const preflight = await preflightConfig(recipeModel(), config, "qc", access);
    expect(preflight.checks.find((check) => check.id === "enabled")).toMatchObject({ ok: false, words: "FastQC is switched off on this server", fix: { kind: "ask-admin", label: "Ask an admin" } });
    expect((await preflightConfig(recipeModel(), config, "qc", { ...access, canManage: true })).checks.find((check) => check.id === "enabled")?.fix?.label).toBe("Switch it on");
    await expect(startFlowRun("flow1", { scope: "all", actor, pipelines: { access } })).rejects.toMatchObject({ code: "invalid_request", message: "Step 1 is not ready: FastQC is switched off on this server." });
    expect(rows("exploreFlowRun").length).toBe(0);
    expect(state.created.length).toBe(0);
  });

  it("a version no longer on the server, a setting out of bounds and an option gone from the schema are named with one fix", async () => {
    const old = { ...config, version: "0.11.9" };
    expect((await preflightConfig(recipeModel(), old, "qc", access)).checks.find((check) => check.id === "version")).toMatchObject({ ok: false, words: "the step is pinned to FastQC 0.11.9; this server has 0.12.1", fix: { kind: "switch-version", label: "Use 0.12.1", version: "0.12.1" } });
    const outOfBounds = await preflightConfig(recipeModel(), { ...config, params: { kmers: 50 } }, "qc", access);
    expect(outOfBounds.ready).toBe(false);
    expect(outOfBounds.checks.find((check) => check.id === "settings")).toMatchObject({ ok: false, fix: { kind: "reset-settings" } });
    const schema = fastqc.definition.configSchema;
    fastqc.definition.configSchema = { type: "object", properties: { ...schema.properties, mode: { type: "string", title: "Mode", enum: ["fast", "full"], default: "fast" } } } as unknown as typeof schema;
    try {
      const gone = await preflightConfig(recipeModel(), { ...config, params: { kmers: 5, mode: "legacy" } }, "qc", access);
      const check = gone.checks.find((entry) => entry.id === "settings")!;
      expect(check.ok).toBe(false);
      expect(check.words).toMatch(/Mode/);
    } finally {
      fastqc.definition.configSchema = schema;
    }
  });

  it("Run again (fresh) starts a new pipeline run although a finished one with the same inputs exists", async () => {
    const first = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    await setPipeline(String(stepRun(first.id, "qc")!.pipelineRunId), { status: "completed", completedAt: new Date() });
    await advanceFlowRun(first.id);
    await finishCodeStep(first.id, "overview");
    await advanceFlowRun(first.id);
    const again = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access, fresh: ["qc"] } });
    expect(state.created.length).toBe(2);
    expect(JSON.parse(String(stepRun(again.id, "qc")!.results)).pipeline.reused).not.toBe(true);
  });

  it("cancelling a step that waits for the study's limit cancels nothing of SeqDesk's, and a second cancel changes nothing", async () => {
    await otherAnalysisRunning();
    const run = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    expect(stepRun(run.id, "qc")!.status).toBe("queued");
    await cancelFlowRun(run.id);
    await cancelFlowRun(run.id);
    expect(state.cancelled).toEqual([]);
    expect(stepRun(run.id, "qc")!.status).toBe("cancelled");
    expect((rows("exploreFlowRun").find((row) => row.id === run.id) as { status: string }).status).toBe("cancelled");
  });

  it("deleting a step (or its analysis) stops its pipeline run first, once", async () => {
    const run = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    const pipelineRunId = String(stepRun(run.id, "qc")!.pipelineRunId);
    expect(await stopPipelinesOfSteps(["qc"])).toBe(1);
    expect(state.cancelled).toEqual([pipelineRunId]);
    expect(stepRun(run.id, "qc")!.status).toBe("cancelled");
    expect(await stopPipelinesOfSteps(["qc"])).toBe(0);
    expect(await stopPipelinesOfSteps([])).toBe(0);
  });

  it("reads added or removed in Data since the step's run: \"N new since Run #x\" or \"N fewer\", and the same reads again: nothing", async () => {
    const run = await startFlowRun("flow1", { scope: "all", actor, pipelines: { access } });
    await setPipeline(String(stepRun(run.id, "qc")!.pipelineRunId), { status: "completed", completedAt: new Date() });
    await advanceFlowRun(run.id);
    const records = async () => (await runRecords(run.id))!.records;
    expect((await pipelineReadsChanged(recipeModel(), await records())).get("qc")).toBeUndefined();
    const two = state.files;
    state.files = [...two, { id: "f5", name: "S3_R1.fastq.gz", sizeBytes: 100 }, { id: "f6", name: "S3_R2.fastq.gz", sizeBytes: 100 }];
    state.pairCount = 3;
    expect((await pipelineReadsChanged(recipeModel(), await records())).get("qc")).toBe("1 sample new since Run #1");
    state.files = two.slice(0, 2); state.pairCount = 1;
    expect((await pipelineReadsChanged(recipeModel(), await records())).get("qc")).toBe("1 sample fewer since Run #1");
    state.files = two; state.pairCount = 2;
    expect((await pipelineReadsChanged(recipeModel(), await records())).get("qc")).toBeUndefined();
  });
});
