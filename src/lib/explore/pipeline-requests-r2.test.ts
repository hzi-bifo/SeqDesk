/** Install requests and presets, edge cases round 2 (sheets 96–97, 6 Oct 2026): withdraw, decide twice, decide by a member, a withdrawn request on its waiting step, a deleted or updated preset after use. Fixture of pipeline-step-edit.test.ts. */
import fs from "fs/promises";
import os from "os";
import path from "path";
import zlib from "zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  memory: null as null | import("./__fixtures__/memory-db").MemoryDb,
  installed: new Set<string>(["fastqc"]),
  revisions: [] as Array<Record<string, unknown>>,
  written: [] as Array<{ pipelineRunId: string; outputs: unknown[] }>,
  files: [] as Array<{ id: string; name: string; sizeBytes: number }>,
  silva: false,
  storageRoot: "",
}));

vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./__fixtures__/memory-db");
  state.memory = createMemoryDb({ explorePipelinePreset: { archivedAt: null, note: null, versions: [] }, explorePipelineInstallRequest: { status: "pending", kind: "install", decidedAt: null, decisionNote: null, analysisId: null, flowId: null } });
  return { db: state.memory.db };
});
const fixtures = vi.hoisted(() => {
  const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
  const definition = (id: string, name: string, version: string, properties: Record<string, unknown>, required: string[] = [], pairedEnd = false) => ({
    id, name, description: `${name} does its work.`, category: "qc", version, requires: {}, outputs: [], visibility: { showToUser: true, userCanStart: true },
    input: { supportedScopes: ["study"], minSamples: 1, perSample: { reads: true, pairedEnd } }, samplesheet: { format: "csv", generator: "x" }, configSchema: schema(properties, required), defaultConfig: {},
  });
  const pkg = (id: string, name: string, version: string, outputs: unknown[]) => ({ id, basePath: `/packages/${id}`, manifest: { package: { id, name, version, description: `${name} does its work.`, provider: id === "ampliseq" ? "nf-core" : "SeqDesk" }, outputs } });
  return {
    definitions: {
      fastqc: definition("fastqc", "FastQC", "0.12.1", { kmers: { type: "integer", title: "Kmer size", minimum: 2, maximum: 10, default: 7, "x-seqdesk": { placement: "advanced" } }, threads: { type: "integer", title: "Threads", "x-seqdesk": { placement: "admin" } } }),
      ampliseq: definition("ampliseq", "nf-core/ampliseq", "2.9.0", {
        trunclenf: { type: "integer", title: "Trim forward reads to", minimum: 50, maximum: 300, "x-seqdesk": { placement: "basic" } },
        primers: { type: "string", title: "Primers", enum: ["515F/806R", "341F/805R"], "x-seqdesk": { placement: "basic" } },
        reference: { type: "string", title: "Reference database", "x-seqdesk": { placement: "basic" } },
      }, ["reference"], true),
    } as Record<string, unknown>,
    packages: {
      fastqc: pkg("fastqc", "FastQC", "0.12.1", [{ id: "summary", scope: "run", destination: "run_artifact", discovery: { pattern: "summary.tsv" }, table: { label: "FastQC quality summary", tableKind: "sample-summary", roles: { sample: "sample_id" } } }]),
      ampliseq: pkg("ampliseq", "nf-core/ampliseq", "2.9.0", [
        { id: "asv_table", scope: "run", destination: "run_artifact", discovery: { pattern: "asv.tsv" }, table: { label: "ASV table", tableKind: "feature-counts" } },
        { id: "multiqc", scope: "run", destination: "run_artifact", type: "report", discovery: { pattern: "multiqc_report.html" } },
      ]),
    } as Record<string, unknown>,
  };
});
vi.mock("@/lib/pipelines/registry", () => ({ PIPELINE_REGISTRY: new Proxy({}, { get: (_target, id: string) => (state.installed.has(id) ? fixtures.definitions[id] : undefined) }) }));
vi.mock("@/lib/pipelines/package-loader", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/pipelines/package-loader")>()),
  getPackage: (id: string) => (state.installed.has(id) ? fixtures.packages[id] : undefined), getAllPackages: () => [...state.installed].map((id) => fixtures.packages[id]), getPackageRegistry: () => ({ category: "qc", tags: [] }), findStepByProcessFromPackage: () => null }));
vi.mock("@/lib/pipelines/definitions", () => ({ getStepsForPipeline: (id: string) => (id === "ampliseq" ? ["FastQC", "Cutadapt", "DADA2", "SILVA taxonomy", "MultiQC"].map((name) => ({ id: name, name })) : [{ id: "fastqc", name: "FastQC" }]) }));
vi.mock("@/lib/pipelines/enablement", () => ({ getPipelineEnabled: async () => true }));
vi.mock("@/lib/pipelines/execution-settings", () => ({ getExecutionSettings: async () => ({ useSlurm: true, pipelineRunDir: "/runs" }) }));
vi.mock("@/lib/pipelines/database-downloads", () => ({
  getPipelineDatabaseStatuses: async (id: string) => (id === "ampliseq" ? [{ id: "silva-138", label: "SILVA 138 database", status: state.silva ? "downloaded" : "missing", sizeBytes: 2.1 * 1024 ** 3, configKey: "reference" }] : []),
  getPipelineDatabaseDefinition: (id: string, databaseId: string) => (id === "ampliseq" && databaseId === "silva-138" ? { id: "silva-138", label: "SILVA 138 database", fileName: "silva.tar.gz", downloadUrl: "https://example.org/silva.tar.gz", configKey: "reference" } : null),
}));
vi.mock("@/lib/pipelines/pipeline-readiness-service", () => ({ parsePipelineConfig: (raw: string | null | undefined) => (raw ? JSON.parse(raw) : {}) }));
vi.mock("@/lib/pipelines/data-study", () => ({
  dataStudyAlias: (key: string) => `seqdesk-data:${key}`,
  findDataStudy: async () => ({ id: "study1" }),
  linkedReadRecords: async () => [],
  readsInData: async () => {
    const pairs: Array<{ sampleId: string; r1: unknown; r2: unknown }> = [];
    for (let i = 0; i < state.files.length; i += 2) pairs.push({ sampleId: state.files[i].name.replace(/_R1.*$/, ""), r1: state.files[i], r2: state.files[i + 1] ?? null });
    return { files: state.files, pairs, words: "" };
  },
}));
vi.mock("@/lib/pipelines/pipeline-data-service", () => ({ pastDurations: async () => [2460], runBelongsTo: async () => true, getDataRun: async () => null }));
vi.mock("./storage", async (importOriginal) => ({ ...(await importOriginal<typeof import("./storage")>()), resolveExploreStorage: async () => ({ baseDir: state.storageRoot, importsRoot: state.storageRoot, datasetsRoot: state.storageRoot, runsRoot: state.storageRoot }) }));
vi.mock("./pipeline-step-runs", async (importOriginal) => ({ ...(await importOriginal<typeof import("./pipeline-step-runs")>()), writePipelineOutputs: vi.fn(async (input: { pipelineRunId: string; outputs: unknown[] }) => { state.written.push({ pipelineRunId: input.pipelineRunId, outputs: input.outputs }); return []; }) }));
vi.mock("./analyses", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./analyses")>();
  const db = () => state.memory!.db as unknown as Record<string, { create: (args: unknown) => Promise<Record<string, unknown>>; update: (args: unknown) => Promise<unknown>; findUnique: (args: unknown) => Promise<Record<string, unknown> | null> }>;
  return {
    ...actual,
    createAnalysis: vi.fn(async (input: Record<string, unknown>) => {
      const analysis = await db().exploreAnalysis.create({ data: { ...(input.id ? { id: input.id } : {}), flowId: input.flowId, targetKey: input.targetKey, name: input.name, language: input.language, environmentName: input.environmentName, position: input.position, purpose: input.purpose, stepKind: input.stepKind ?? "code" } });
      const revision = await db().exploreAnalysisRevision.create({ data: { analysisId: analysis.id, number: 1, code: input.code, codeHash: actual.codeHashOf(String(input.code)), params: JSON.stringify(input.params ?? {}), inputs: JSON.stringify(input.inputs ?? []), pipeline: input.pipeline ?? null } });
      await db().exploreAnalysis.update({ where: { id: analysis.id }, data: { currentRevisionId: revision.id } });
      return { id: analysis.id };
    }),
    createRevision: vi.fn(async (input: Record<string, unknown>) => {
      const analysis = await db().exploreAnalysis.findUnique({ where: { id: input.analysisId } });
      if (input.expectedRevisionId && analysis?.currentRevisionId !== input.expectedRevisionId) throw new actual.RevisionConflict("This step changed in another session.");
      const current = await db().exploreAnalysisRevision.findUnique({ where: { id: analysis?.currentRevisionId } });
      state.revisions.push(input);
      const revision = await db().exploreAnalysisRevision.create({ data: { analysisId: input.analysisId, number: Number(current?.number ?? 0) + 1, code: input.code ?? current?.code, codeHash: actual.codeHashOf(String(input.code ?? current?.code)), params: JSON.stringify(input.params ?? JSON.parse(String(current?.params ?? "{}"))), inputs: JSON.stringify(input.inputs ?? JSON.parse(String(current?.inputs ?? "[]"))), pipeline: input.pipeline ?? current?.pipeline ?? null } });
      await db().exploreAnalysis.update({ where: { id: input.analysisId }, data: { currentRevisionId: revision.id } });
      return { id: revision.id };
    }),
  };
});
vi.mock("./recipe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./recipe")>();
  return { ...actual, loadRecipe: vi.fn(async (flowId: string) => modelOf(flowId)) };
});

import { parseInputBindings } from "./analyses";
import type { RecipeModel } from "./recipe";
import { addPipelineStep, parsePipelineStepConfig, preflightPipeline, resetPipelineStepsProbe, updatePipelineStep, type PipelineAccess } from "./pipeline-steps";
import { createInstallRequest, decideInstallRequest, deletePreset, listInstallRequests, resetStoreCache, savePreset, withdrawInstallRequest } from "./pipeline-lab";
import { previewRunPlan } from "./run-plan";

const rows = (name: string) => state.memory!.table(name);
const actor = { userId: "u1", memberId: "m1", name: "Amara Okafor" };
const member: PipelineAccess = { userId: "u1", canRun: true, installation: false, canManage: false };
const admin: PipelineAccess = { userId: "admin", canRun: true, installation: true, canManage: true };
const lab = "https://collab.example|okafor";

/** The recipe model of a flow from the memory tables (what loadRecipe reads), in creation order. */
function modelOf(flowId: string): RecipeModel | null {
  const flow = rows("exploreFlow").find((row) => row.id === flowId) as Record<string, unknown> | undefined;
  if (!flow) return null;
  const analyses = rows("exploreAnalysis").filter((row) => row.flowId === flowId);
  const datasets = new Map<string, RecipeModel["datasets"] extends Map<string, infer D> ? D : never>();
  for (const row of rows("exploreDataset").filter((entry) => entry.targetKey === flow.targetKey)) {
    const config = JSON.parse(String(row.sourceConfig ?? "{}"));
    datasets.set(String(row.id), { id: String(row.id), name: String(row.name), kind: String(row.kind), tableKind: (row.tableKind as string) ?? null, roles: (row.roles as string) ?? null, sensitivity: "standard", currentVersionId: (row.currentVersionId as string) ?? null, producer: config.analysisId ?? null, artifactName: config.artifactName ?? null, current: row.current as never ?? null });
  }
  const steps = analyses.map((analysis, index) => {
    const revision = rows("exploreAnalysisRevision").find((row) => row.id === analysis.currentRevisionId) as Record<string, unknown> | undefined;
    return { id: String(analysis.id), name: String(analysis.name), description: null, purpose: (analysis.purpose as string) ?? null, kitId: null, language: String(analysis.language ?? "r"), environmentName: String(analysis.environmentName ?? ""), packages: null,
      position: String(analysis.position || `a${index}`), laneKind: null, laneOf: null, laneLabel: null, groupId: null, paramMeta: null, methodsSentence: null, proposedByTurnId: null, createdAt: analysis.createdAt as Date, currentRevisionId: (analysis.currentRevisionId as string) ?? null,
      revision: revision ? { id: String(revision.id), number: Number(revision.number), code: String(revision.code), codeHash: String(revision.codeHash), params: String(revision.params), inputs: String(revision.inputs), fileInputs: "[]", author: "user", authorUserId: "u1", createdAt: revision.createdAt as Date } : null,
      bindings: parseInputBindings(revision?.inputs as string | undefined), stepKind: (analysis.stepKind as "code" | "pipeline") ?? "code", pipeline: revision?.pipeline ?? null };
  }).sort((a, b) => a.position.localeCompare(b.position));
  const upstream = new Map(steps.map((step) => [step.id, new Set(step.bindings.map((binding) => datasets.get(binding.datasetId)?.producer).filter((id): id is string => Boolean(id) && id !== step.id))] as const));
  return { flow: { id: flowId, targetKey: String(flow.targetKey), name: String(flow.name), description: null, recipeRevision: 1, runCounter: 0, currentRunId: (flow.currentRunId as string) ?? null, layout: null, headlineValue: null, createdById: "u1", createdByMemberId: null, createdAt: new Date(), updatedAt: new Date() },
    steps, labels: new Map(steps.map((step, index) => [step.id, String(index + 1)])), upstream, datasets };
}

async function writeFastq(name: string, sequences: string[]) {
  const text = sequences.map((seq, i) => `@r${i}\n${seq}\n+\n${"I".repeat(seq.length)}\n`).join("");
  await fs.mkdir(path.join(state.storageRoot, "files"), { recursive: true });
  await fs.writeFile(path.join(state.storageRoot, "files", name), zlib.gzipSync(text));
}

beforeEach(async () => {
  state.memory!.reset();
  state.installed = new Set(["fastqc"]);
  state.revisions = [];
  state.written = [];
  state.silva = false;
  state.files = [{ id: "f1", name: "A01_R1.fastq.gz", sizeBytes: 1000 }, { id: "f2", name: "A01_R2.fastq.gz", sizeBytes: 1000 }, { id: "f3", name: "A02_R1.fastq.gz", sizeBytes: 1000 }, { id: "f4", name: "A02_R2.fastq.gz", sizeBytes: 1000 }];
  state.storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-steps-"));
  resetPipelineStepsProbe(true);
  resetStoreCache();
  rows("exploreFlow").push({ id: "flow1", targetKey: "project:p1", name: "Microbiome diversity", currentRunId: null });
  rows("study").push({ id: "study1", userId: "u1" });
  rows("user").push({ id: "u1", firstName: "Amara", lastName: "Okafor", email: "a@example.org" }, { id: "u2", firstName: "Lena", lastName: "Berg", email: "l@example.org" });
  for (const file of state.files) rows("managedFile").push({ id: file.id, sizeBytes: BigInt(file.sizeBytes), storagePath: file.name, originalName: file.name, targetKey: "project:p1" });
});


describe("install requests and presets, edge cases round 2", () => {
  it("a withdrawn request cannot be decided, its waiting step offers to ask again, and a second decision is refused", async () => {
    const waiting = await addPipelineStep("flow1", { pipelineId: "ampliseq", version: "2.9.0", request: { reason: "Taxa" }, labKey: lab, actor });
    const [request] = await listInstallRequests(lab, { userId: "u1", canManage: false });
    await expect(withdrawInstallRequest(request.id, { userId: "u2", name: "Lena Berg" })).rejects.toMatchObject({ code: "forbidden" });
    expect(await withdrawInstallRequest(request.id, actor)).toMatchObject({ status: "withdrawn" });
    expect(await withdrawInstallRequest(request.id, actor)).toMatchObject({ status: "withdrawn" });
    await expect(decideInstallRequest(request.id, { decision: "install" }, { userId: "admin", name: "Admin" }, admin)).rejects.toMatchObject({ code: "invalid_request", message: "Amara Okafor withdrew this request." });
    const check = (await preflightPipeline("flow1", { stepId: waiting }, member)).checks.find((entry) => entry.id === "installed");
    expect(check).toMatchObject({ ok: false, words: "ampliseq is not installed on this server yet", fix: { kind: "ask-install", label: "Ask to install" } });

    const other = await createInstallRequest({ labKey: lab, pipelineId: "ampliseq", actor });
    await expect(decideInstallRequest(other.id, { decision: "decline" }, actor, member)).rejects.toMatchObject({ code: "forbidden" });
    await decideInstallRequest(other.id, { decision: "decline", note: "No" }, { userId: "admin", name: "Admin" }, admin);
    await expect(decideInstallRequest(other.id, { decision: "decline" }, { userId: "admin", name: "Admin" }, admin)).rejects.toMatchObject({ code: "invalid_request", message: "This request was already decided." });
    await expect(decideInstallRequest(other.id, { decision: "install" }, { userId: "admin", name: "Admin" }, admin)).rejects.toMatchObject({ code: "invalid_request" });
    expect(rows("inAppNotification").filter((row) => row.title === "ampliseq will not be installed")).toHaveLength(1);
  });

  it("a step keeps its settings when its preset is updated (preset.updated) or deleted", async () => {
    const preset = await savePreset(lab, { pipelineId: "fastqc", name: "Short reads", params: { kmers: 4 } }, actor, member);
    const step = await addPipelineStep("flow1", { pipelineId: "fastqc", presetId: preset.id, labKey: lab, actor });
    const config = () => parsePipelineStepConfig(rows("exploreAnalysisRevision").filter((row) => row.analysisId === step).at(-1)!.pipeline)!;
    expect(config().params).toMatchObject({ kmers: 4 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await savePreset(lab, { id: preset.id, params: { kmers: 3 } }, actor, member);
    expect(config().params).toMatchObject({ kmers: 4 });
    await deletePreset(lab, preset.id, actor, member);
    expect(config().params).toMatchObject({ kmers: 4 });
    const ready = await preflightPipeline("flow1", { stepId: step }, member);
    expect(ready.checks.find((entry) => entry.id === "settings")).toMatchObject({ ok: true });
  });

  it("a pipeline as the first step of a study without reads: the reads check fails with its fix and there is no estimate", async () => {
    state.files = [];
    const step = await addPipelineStep("flow1", { pipelineId: "fastqc", labKey: lab, actor });
    const preflight = await preflightPipeline("flow1", { stepId: step }, member);
    expect(preflight.checks.find((check) => check.id === "reads")).toMatchObject({ ok: false, fix: { kind: "add-reads" } });
    expect(preflight.estimate).toMatchObject({ seconds: null, words: "no estimate yet", samples: 0 });
    expect(preflight.checks.find((check) => check.id === "compute")?.words).not.toMatch(/about/);
  });
});

