/**
 * Adding and changing pipeline steps, Ready to run, the run preview, a lab's presets and install requests, the store
 * as members read it, and a study's data in one line — over an in-memory database, with real gzip FASTQ files for
 * the data summary.
 */
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
import { createInstallRequest, dataSummary, decideInstallRequest, deletePreset, listInstallRequests, listPresets, pipelineStore, resetStoreCache, savePreset } from "./pipeline-lab";
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

describe("adding a pipeline step", () => {
  it("adds it with its settings checked and its tables declared before the first run", async () => {
    const id = await addPipelineStep("flow1", { pipelineId: "fastqc", params: { kmers: 5 }, labKey: lab, actor });
    const analysis = rows("exploreAnalysis").find((row) => row.id === id)!;
    expect(analysis).toMatchObject({ name: "FastQC", stepKind: "pipeline", environmentName: "pipeline:fastqc", language: "shell", purpose: "FastQC does its work." });
    const revision = rows("exploreAnalysisRevision").find((row) => row.analysisId === id)!;
    expect(parsePipelineStepConfig(revision.pipeline)).toMatchObject({ pipelineId: "fastqc", version: "0.12.1", params: { kmers: 5 }, outputs: [{ outputId: "summary", name: "fastqc_summary" }] });
    expect(JSON.parse(String(revision.params))).toEqual({ kmers: 5 });
    expect(rows("exploreDataset")).toEqual([expect.objectContaining({ kind: "derived", tableKind: "sample-summary", name: "fastqc_summary (FastQC)", roles: JSON.stringify({ sample: "sample_id" }),
      sourceConfig: JSON.stringify({ builder: "analysis-run", analysisId: id, artifactName: "fastqc_summary", pipelineId: "fastqc", pipelineOutputId: "summary" }) })]);
    // A second FastQC step keeps its own table name.
    const second = await addPipelineStep("flow1", { pipelineId: "fastqc", labKey: lab, actor });
    expect(parsePipelineStepConfig(rows("exploreAnalysisRevision").find((row) => row.analysisId === second)!.pipeline)!.outputs).toEqual([{ outputId: "summary", name: "fastqc_summary_2" }]);
  });

  it("refuses admin and unknown settings, another version, and a pipeline that is not here unless it asks to install it", async () => {
    await expect(addPipelineStep("flow1", { pipelineId: "fastqc", params: { threads: 64 }, labKey: lab, actor })).rejects.toMatchObject({ code: "invalid_request", message: "Only an admin sets Threads (in the pipeline's settings on this server)." });
    await expect(addPipelineStep("flow1", { pipelineId: "fastqc", params: { colour: 1 }, labKey: lab, actor })).rejects.toMatchObject({ message: "FastQC has no setting called colour." });
    await expect(addPipelineStep("flow1", { pipelineId: "fastqc", version: "0.11.9", labKey: lab, actor })).rejects.toMatchObject({ message: "This server has FastQC 0.12.1, not 0.11.9." });
    await expect(addPipelineStep("flow1", { pipelineId: "ampliseq", labKey: lab, actor })).rejects.toMatchObject({ message: "ampliseq is not installed on this server. Ask an admin to install it." });
    const waiting = await addPipelineStep("flow1", { pipelineId: "ampliseq", version: "2.9.0", request: { reason: "Taxa for the CRC samples" }, labKey: lab, actor });
    const request = rows("explorePipelineInstallRequest")[0];
    expect(request).toMatchObject({ labKey: lab, pipelineId: "ampliseq", version: "2.9.0", reason: "Taxa for the CRC samples", flowId: "flow1", analysisId: waiting, requestedByName: "Amara Okafor", status: "pending" });
    expect(parsePipelineStepConfig(rows("exploreAnalysisRevision").find((row) => row.analysisId === waiting)!.pipeline)).toMatchObject({ requestId: request.id, outputs: [] });
    expect(rows("exploreAnalysis").find((row) => row.id === waiting)).toMatchObject({ purpose: "Waiting to be installed." });
  });

  it("reads a sample list an earlier step writes, and a pinned existing run writes its tables at once", async () => {
    rows("exploreAnalysis").push({ id: "s1", flowId: "flow1", targetKey: "project:p1", name: "Choose samples", stepKind: "code", position: "a0", currentRevisionId: "r-s1", createdAt: new Date() });
    rows("exploreAnalysisRevision").push({ id: "r-s1", analysisId: "s1", number: 1, code: "x", codeHash: "h", params: "{}", inputs: "[]" });
    const id = await addPipelineStep("flow1", { pipelineId: "fastqc", after: "s1", samples: { from: "table", fromStep: { stepId: "s1", output: "sample_list" }, column: "sample" }, labKey: lab, actor });
    const revision = rows("exploreAnalysisRevision").find((row) => row.analysisId === id)!;
    const list = rows("exploreDataset").find((row) => String(row.name).startsWith("sample_list"))!;
    expect(JSON.parse(String(revision.inputs))).toEqual([{ alias: "samples", datasetId: list.id, versionId: null }]);
    expect(parsePipelineStepConfig(revision.pipeline)!.samples).toEqual({ from: "table", datasetId: list.id, column: "sample" });

    rows("pipelineRun").push({ id: "prun-3", pipelineId: "fastqc", status: "completed", config: JSON.stringify({ kmers: 6, threads: 8 }), runNumber: "FASTQC-3", studyId: "study1", completedAt: new Date("2026-10-03T10:00:00Z") });
    rows("pipelineArtifact").push({ id: "a1", pipelineRunId: "prun-3", outputId: "summary" });
    const pinned = await addPipelineStep("flow1", { pinnedRunId: "prun-3", labKey: lab, actor });
    expect(parsePipelineStepConfig(rows("exploreAnalysisRevision").find((row) => row.analysisId === pinned)!.pipeline)).toMatchObject({ pinnedRunId: "prun-3", params: { kmers: 6 }, outputs: [{ outputId: "summary", name: "fastqc_summary_2" }] });
    expect(rows("exploreAnalysis").find((row) => row.id === pinned)).toMatchObject({ name: "FastQC · run of 2026-10-03", purpose: "Reads the tables of FASTQC-3, pinned; nothing reruns." });
    expect(state.written).toEqual([{ pipelineRunId: "prun-3", outputs: [{ outputId: "summary", name: "fastqc_summary_2" }] }]);
  });

  it("takes a lab preset's settings under the step's own", async () => {
    const preset = await savePreset(lab, { pipelineId: "fastqc", name: "Short reads", params: { kmers: 4 } }, actor, member);
    const id = await addPipelineStep("flow1", { pipelineId: "fastqc", presetId: preset.id, labKey: lab, actor });
    expect(parsePipelineStepConfig(rows("exploreAnalysisRevision").find((row) => row.analysisId === id)!.pipeline)).toMatchObject({ params: { kmers: 4 }, presetId: preset.id });
    await expect(addPipelineStep("flow1", { pipelineId: "fastqc", presetId: preset.id, labKey: "another|lab", actor })).rejects.toMatchObject({ message: "That preset is not one of this lab’s presets for this pipeline." });
  });
});

describe("changing a pipeline step", () => {
  it("makes a new revision with the same code for a settings change, and refuses a stale edit", async () => {
    const id = await addPipelineStep("flow1", { pipelineId: "fastqc", params: { kmers: 5 }, labKey: lab, actor });
    const first = rows("exploreAnalysisRevision").find((row) => row.analysisId === id)!;
    expect(await updatePipelineStep("flow1", id, { params: { kmers: 5 }, actor })).toBe(false);
    expect(await updatePipelineStep("flow1", id, { params: { kmers: 8 }, expectedRevisionId: String(first.id), actor })).toBe(true);
    expect(state.revisions.at(-1)).toMatchObject({ params: { kmers: 8 }, message: "Set kmers to 8", code: first.code });
    await expect(updatePipelineStep("flow1", id, { params: { kmers: 9 }, expectedRevisionId: String(first.id), actor })).rejects.toMatchObject({ code: "step_conflict" });
    await expect(updatePipelineStep("flow1", id, { params: { kmers: 99 }, actor })).rejects.toMatchObject({ message: "Kmer size must be at most 10." });
    await expect(updatePipelineStep("flow1", id, { version: "0.13.0", actor })).rejects.toMatchObject({ message: "This server has FastQC 0.12.1, not 0.13.0." });
    // null removes a setting: the default applies again.
    expect(await updatePipelineStep("flow1", id, { params: { kmers: null }, actor })).toBe(true);
    expect(state.revisions.at(-1)).toMatchObject({ params: {} });
  });

  it("switches a pinned step to a newer run (Use it)", async () => {
    rows("pipelineRun").push({ id: "prun-3", pipelineId: "fastqc", status: "completed", config: "{}", runNumber: "FASTQC-3", studyId: "study1", completedAt: new Date("2026-10-03T10:00:00Z") }, { id: "prun-4", pipelineId: "fastqc", status: "completed", config: "{}", runNumber: "FASTQC-4", studyId: "study1", completedAt: new Date("2026-10-05T10:00:00Z") });
    rows("pipelineArtifact").push({ id: "a1", pipelineRunId: "prun-3", outputId: "summary" });
    const id = await addPipelineStep("flow1", { pinnedRunId: "prun-3", labKey: lab, actor });
    expect(await updatePipelineStep("flow1", id, { pinnedRunId: "prun-4", actor })).toBe(true);
    expect(state.revisions.at(-1)).toMatchObject({ message: "Reads FASTQC-4" });
    expect(state.written.at(-1)).toMatchObject({ pipelineRunId: "prun-4" });
  });
});

describe("Ready to run", () => {
  it("passes for a ready step and says the estimate", async () => {
    const id = await addPipelineStep("flow1", { pipelineId: "fastqc", labKey: lab, actor });
    const preflight = await preflightPipeline("flow1", { stepId: id }, member);
    expect(preflight).toMatchObject({ ready: true, words: "Ready to run", where: "SeqDesk · SLURM", estimate: { seconds: 2460, words: "about 41 min on 2 samples", samples: 2 } });
    expect(preflight.checks.map((check) => [check.id, check.ok, check.words])).toEqual([
      ["reads", true, "reads found for 2 samples"], ["settings", true, "settings are valid"], ["compute", true, "fits on SeqDesk · SLURM · about 41 min"],
    ]);
    expect(preflight.checks[0].detail).toBe("4 files · 3.9 KB");
  });

  it("names each failing check with one fix: a missing reference, a required setting, no reads, who may start it", async () => {
    state.installed.add("ampliseq");
    const draft = { pipelineId: "ampliseq", params: { trunclenf: 230 } };
    const forMember = await preflightPipeline("flow1", { draft }, { ...member, userId: "u2" });
    expect(forMember).toMatchObject({ ready: false, words: "2 of 5 checks pass" });
    expect(forMember.checks.filter((check) => !check.ok).map((check) => [check.id, check.words, check.fix?.kind, check.fix?.label])).toEqual([
      ["reference", "SILVA 138 is not installed on this server", "ask-admin", "Ask an admin"],
      ["settings", "Reference database needs a value", "set-setting", "Set Reference database"],
      ["permission", "Only Amara Okafor or a SeqDesk admin starts pipelines here.", "ask-admin", "Ask an admin"],
    ]);
    const forAdmin = await preflightPipeline("flow1", { draft }, admin);
    expect(forAdmin.checks.find((check) => check.id === "reference")?.fix).toMatchObject({ kind: "install-reference", label: "Install · 2.1 GB", referenceId: "silva-138" });
    state.files = [];
    const noReads = await preflightPipeline("flow1", { draft: { pipelineId: "fastqc" } }, member);
    expect(noReads.checks.find((check) => check.id === "reads")).toMatchObject({ ok: false, words: "there are no FASTQ reads in this study’s Data yet", fix: { kind: "add-reads", label: "Add reads in Data" } });
  });

  it("gives the add form the schema the draft would have: settings with their values, tables named as adding them would, files and references", async () => {
    state.installed.add("ampliseq");
    await addPipelineStep("flow1", { pipelineId: "fastqc", labKey: lab, actor });
    const draft = await preflightPipeline("flow1", { draft: { pipelineId: "fastqc", params: { kmers: 5 } } }, member);
    expect(draft.settingsCount).toBe(1);
    expect(draft.settings?.map((setting) => [setting.key, setting.value, setting.default, setting.changed, setting.placement])).toEqual([["kmers", 5, 7, true, "advanced"]]);
    expect(draft.outputs).toEqual([{ outputId: "summary", name: "fastqc_summary_2", label: "FastQC quality summary", tableKind: "sample-summary" }]);
    const ampliseq = await preflightPipeline("flow1", { draft: { pipelineId: "ampliseq" } }, member);
    expect(ampliseq.files).toEqual([{ outputId: "multiqc", label: "multiqc", kind: "report" }]);
    expect(ampliseq.references).toEqual([{ id: "silva-138", label: "SILVA 138 database", installed: false, sizeBytes: 2.1 * 1024 ** 3 }]);
    // A pipeline that is not installed has no schema here yet.
    const missing = await preflightPipeline("flow1", { draft: { pipelineId: "mag" } }, member);
    expect(missing.settings).toBeUndefined();
  });
});

describe("what Run recipe would do", () => {
  it("asks before a pipeline starts, says who runs it and for how long, and reuses a finished run with the same inputs", async () => {
    const id = await addPipelineStep("flow1", { pipelineId: "fastqc", labKey: lab, actor });
    const plan = await previewRunPlan("flow1", "all", actor, member);
    expect(plan).toMatchObject({ ask: true, startsPipelines: 1, words: "Starts FastQC: about 41 min · runs as Amara on SeqDesk · SLURM", estimate: { seconds: 2460 }, blocked: null, alternatives: [] });
    expect(plan.steps).toEqual([expect.objectContaining({ stepId: id, kind: "pipeline", action: "run", pipeline: expect.objectContaining({ starts: true, why: "it has not run yet", samples: 2 }) })]);

    // The same inputs already ran to the end: nothing would start.
    const { pipelineInputHash } = await import("./pipeline-steps");
    const hash = pipelineInputHash({ pipelineId: "fastqc", version: "0.12.1", params: {}, reads: { files: state.files.map((file) => ({ id: file.id, name: file.name, size: file.sizeBytes })), records: [] }, sampleList: null });
    rows("explorePipelineCache").push({ id: "c1", targetKey: "project:p1", pipelineId: "fastqc", version: "0.12.1", inputHash: hash, pipelineRunId: "prun-7" });
    rows("pipelineRun").push({ id: "prun-7", pipelineId: "fastqc", status: "completed", runNumber: "FASTQC-7", runFolder: os.tmpdir() });
    const again = await previewRunPlan("flow1", "all", actor, member);
    expect(again).toMatchObject({ ask: false, startsPipelines: 0, words: "Reuses FastQC" });
    expect(again.steps[0].pipeline).toMatchObject({ starts: false, reuses: { pipelineRunId: "prun-7", runNumber: "FASTQC-7" } });
  });

  it("does not say \"Runs 0 steps\" when nothing would run", async () => {
    rows("exploreAnalysis").push({ id: "s1", flowId: "flow1", targetKey: "project:p1", name: "Sample list", stepKind: "code", language: "r", position: "a0", currentRevisionId: "r-s1", createdAt: new Date() });
    rows("exploreAnalysisRevision").push({ id: "r-s1", analysisId: "s1", number: 1, code: "x", codeHash: "h1", params: "{}", inputs: "[]" });
    const plan = await previewRunPlan("flow1", { steps: [] }, actor, member);
    expect(plan.words).toBe("Nothing to run: every step is up to date");
  });

  it("says why the run cannot start yet", async () => {
    state.installed.add("ampliseq");
    await addPipelineStep("flow1", { pipelineId: "ampliseq", labKey: lab, actor });
    const plan = await previewRunPlan("flow1", "all", actor, member);
    expect(plan).toMatchObject({ ask: false, blocked: { label: "1", words: "Step 1 is not ready: SILVA 138 is not installed on this server." } });
  });

  it("says what runs before the pipeline and what after it, and never merges steps that do not run into a range", async () => {
    // Step 1 (own code) runs first, then FastQC starts, then step 3 reads its table.
    rows("exploreAnalysis").push({ id: "s1", flowId: "flow1", targetKey: "project:p1", name: "Sample list", stepKind: "code", language: "r", position: "a0", currentRevisionId: "r-s1", createdAt: new Date() });
    rows("exploreAnalysisRevision").push({ id: "r-s1", analysisId: "s1", number: 1, code: "x", codeHash: "h1", params: "{}", inputs: "[]" });
    const pipeline = await addPipelineStep("flow1", { pipelineId: "fastqc", after: "s1", labKey: lab, actor });
    const summary = rows("exploreDataset").find((row) => String(row.name).startsWith("fastqc_summary"))!;
    rows("exploreAnalysis").push({ id: "s3", flowId: "flow1", targetKey: "project:p1", name: "Quality overview", stepKind: "code", language: "r", position: "z0", currentRevisionId: "r-s3", createdAt: new Date() });
    rows("exploreAnalysisRevision").push({ id: "r-s3", analysisId: "s3", number: 1, code: "y", codeHash: "h3", params: "{}", inputs: JSON.stringify([{ alias: "qc", datasetId: summary.id, versionId: null }]) });
    const plan = await previewRunPlan("flow1", "all", actor, member);
    expect(plan.steps.map((step) => [step.label, step.stepId === pipeline ? "pipeline" : step.kind])).toEqual([["1", "code"], ["2", "pipeline"], ["3", "code"]]);
    expect(plan.words).toBe("Runs step 1, then starts FastQC (about 41 min), then step 3 · runs as Amara on SeqDesk · SLURM");
    const { stepsWords } = await import("./run-plan");
    const at = (...labels: string[]) => labels.map((label) => ({ label, index: Number(label) - 1 }));
    expect([stepsWords(at("3")), stepsWords(at("3", "4", "5")), stepsWords(at("1", "3")), stepsWords(at("3", "4")), stepsWords(at("3", "4", "6")), stepsWords(at("3", "4", "5", "7"))])
      .toEqual(["step 3", "steps 3 to 5", "steps 1 and 3", "steps 3 and 4", "steps 3, 4 and 6", "steps 3 to 5 and 7"]);
  });
});

describe("a lab's presets and install requests", () => {
  it("keeps presets per lab; their author or the admin changes them", async () => {
    const preset = await savePreset(lab, { pipelineId: "fastqc", name: "Short reads", note: "MiSeq 2×150", params: { kmers: 4 } }, actor, member);
    expect(preset).toMatchObject({ pipelineId: "fastqc", name: "Short reads", note: "MiSeq 2×150", params: { kmers: 4 }, versions: ["0.12.1"], author: { userId: "u1", name: "Amara Okafor" }, canEdit: true });
    expect(await listPresets("another|lab", null, member)).toEqual([]);
    expect((await listPresets(lab, "fastqc", { userId: "u2", canManage: false }))[0]).toMatchObject({ name: "Short reads", canEdit: false });
    await expect(savePreset(lab, { id: preset.id, name: "Mine now" }, { userId: "u2", name: "Lena Berg" }, { ...member, userId: "u2" })).rejects.toMatchObject({ code: "forbidden", message: "Only Amara Okafor or an admin changes this preset." });
    await expect(savePreset(lab, { pipelineId: "fastqc", name: "Bad", params: { threads: 2 } }, actor, member)).rejects.toMatchObject({ code: "invalid_request" });
    expect(await savePreset(lab, { id: preset.id, params: { kmers: 3 } }, { userId: "admin", name: "Admin" }, admin)).toMatchObject({ params: { kmers: 3 }, name: "Short reads" });
    await deletePreset(lab, preset.id, actor, member);
    expect(await listPresets(lab, null, member)).toEqual([]);
  });

  it("asks once per pipeline; the admin installs and the waiting step declares its tables, or declines with a reason", async () => {
    const waiting = await addPipelineStep("flow1", { pipelineId: "ampliseq", version: "2.9.0", request: { reason: "Taxa for the CRC samples" }, labKey: lab, actor });
    const again = await createInstallRequest({ labKey: lab, pipelineId: "ampliseq", actor });
    expect(rows("explorePipelineInstallRequest")).toHaveLength(1);
    expect(again.id).toBe(rows("explorePipelineInstallRequest")[0].id);
    await expect(createInstallRequest({ labKey: lab, kind: "wanted", actor })).rejects.toMatchObject({ message: "Say what you need, or paste a link." });
    expect((await listInstallRequests(lab, { userId: "u1", canManage: false }))[0]).toMatchObject({ name: "ampliseq", status: "pending", canDecide: false, canWithdraw: true, flowName: "Microbiome diversity", stepId: waiting });

    await expect(decideInstallRequest(again.id, { decision: "install" }, actor, member)).rejects.toMatchObject({ code: "forbidden" });
    const decided = await decideInstallRequest(again.id, { decision: "install" }, { userId: "admin", name: "Admin Person" }, admin, async () => { state.installed.add("ampliseq"); return { version: "2.9.0" }; });
    expect(decided).toMatchObject({ status: "installed", note: "Installed 2.9.0.", decidedBy: { name: "Admin Person" } });
    const settled = parsePipelineStepConfig(rows("exploreAnalysisRevision").filter((row) => row.analysisId === waiting).at(-1)!.pipeline);
    expect(settled).toMatchObject({ requestId: null, version: "2.9.0", outputs: [{ outputId: "asv_table", name: "ampliseq_asv_table" }] });
    expect(rows("exploreAnalysis").find((row) => row.id === waiting)).toMatchObject({ name: "nf-core/ampliseq", purpose: "nf-core/ampliseq does its work." });

    const wanted = await createInstallRequest({ labKey: lab, kind: "wanted", text: "nf-core/rnafusion, for fusion genes", actor });
    expect(await decideInstallRequest(wanted.id, { decision: "decline", note: "Not on this server; ask the SeqDesk team" }, { userId: "admin", name: "Admin" }, admin)).toMatchObject({ status: "declined", note: "Not on this server; ask the SeqDesk team" });
  });
});

describe("asking for a reference database, and telling the person who asked", () => {
  const adminActor = { userId: "admin", memberId: null, name: "Sam Admin" };
  it("asks for a missing reference database once; it settles when the database is there, and the person who asked is told", async () => {
    state.installed.add("ampliseq");
    const row = await createInstallRequest({ labKey: lab, kind: "reference", pipelineId: "ampliseq", referenceId: "silva-138", reason: "Taxa for the CRC samples", actor });
    expect(row).toMatchObject({ kind: "reference", pipelineId: "ampliseq", text: "silva-138", status: "pending" });
    expect((await createInstallRequest({ labKey: lab, kind: "reference", pipelineId: "ampliseq", referenceId: "silva-138", actor })).id).toBe(row.id);
    await expect(createInstallRequest({ labKey: lab, kind: "reference", pipelineId: "ampliseq", referenceId: "gtdb", actor })).rejects.toMatchObject({ code: "not_found" });
    let [view] = await listInstallRequests(lab, { userId: "u1", canManage: false });
    expect(view).toMatchObject({ kind: "reference", name: "SILVA 138", referenceId: "silva-138", text: null, link: null, canWithdraw: true });
    // A database SeqDesk installs in its admin settings: the admin is told so; the request waits.
    await expect(decideInstallRequest(row.id, { decision: "install" }, adminActor, admin)).rejects.toMatchObject({ code: "invalid_request", message: "SILVA 138 is installed from SeqDesk’s admin settings (Admin › Pipelines › Databases); installing it from here is not possible yet." });
    // Installed there meanwhile: the request settles by itself and the person who asked is told.
    state.silva = true;
    [view] = await listInstallRequests(lab, { userId: "u1", canManage: false });
    expect(view).toMatchObject({ status: "installed", note: "SILVA 138 is installed." });
    expect(rows("inAppNotification")).toEqual([expect.objectContaining({ userId: "u1", eventType: "pipeline.install-request.decided", title: "SILVA 138 is installed", body: "nf-core/ampliseq can use it now." })]);
  });

  it("tells the person who asked when an admin declines (with the reason) or installs; a wanted pipeline keeps its link", async () => {
    const declined = await createInstallRequest({ labKey: lab, pipelineId: "ampliseq", actor });
    await decideInstallRequest(declined.id, { decision: "decline", note: "Not this year; use the lab's 16S quick QC." }, adminActor, admin);
    expect(rows("inAppNotification").at(-1)).toMatchObject({ userId: "u1", title: "ampliseq will not be installed", body: "Not this year; use the lab's 16S quick QC.", severity: "warning" });
    const wanted = await createInstallRequest({ labKey: lab, kind: "pipeline-wanted", text: "nf-core/rnafusion (https://nf-co.re/rnafusion), for fusion genes", actor });
    const [view] = (await listInstallRequests(lab, { userId: "u1", canManage: false })).filter((entry) => entry.id === wanted.id);
    expect(view).toMatchObject({ kind: "wanted", link: "https://nf-co.re/rnafusion", referenceId: null });
    await decideInstallRequest(wanted.id, { decision: "install", note: "Asked the SeqDesk team." }, adminActor, admin);
    expect(rows("inAppNotification").at(-1)).toMatchObject({ title: "Your request for a pipeline was answered", body: "Asked the SeqDesk team." });
  });
});

describe("the store for members", () => {
  it("lists this server's pipelines and the store's in one list, each with one action", async () => {
    const load = vi.fn(async () => ({ registries: [{ id: "registry:seqdesk", label: "SeqDesk Registry", registryUrl: "x", browseUrl: "y" }], categories: [], registryErrors: [], duplicatePipelineIds: [], successfulRegistryCount: 1,
      pipelines: [
        { id: "ampliseq", name: "nf-core/ampliseq", description: "Amplicon reads to ASVs", category: "amplicon", version: "2.9.0", latestVersion: "2.9.0", versions: [{ version: "2.9.0" }, { version: "2.8.0" }], author: "nf-core", downloads: 1100, verified: true, icon: "", featured: false, tags: ["16S"], isPrivate: false, licenseRequired: false, targets: null, catalogs: ["study"], capabilities: null, source: { kind: "registry", sourceId: "registry:x", label: "SeqDesk Registry" } },
        { id: "fastqc", name: "FastQC", description: "QC", category: "qc", version: "0.12.1", latestVersion: "0.12.2", versions: [{ version: "0.12.2" }], author: "SeqDesk", downloads: 3, verified: true, icon: "", featured: false, tags: [], isPrivate: false, licenseRequired: false, targets: null, catalogs: ["study"], capabilities: null, source: { kind: "registry", sourceId: "registry:x", label: "SeqDesk Registry" } },
      ] }));
    await createInstallRequest({ labKey: lab, pipelineId: "ampliseq", actor });
    const store = await pipelineStore({ labKey: lab, access: member, load: load as never });
    expect(store.pipelines.map((entry) => [entry.id, entry.state, entry.action.label, entry.badges])).toEqual([
      ["fastqc", "ready", "Add", ["installed", "verified"]],
      ["ampliseq", "store", "Asked", ["nf-core", "verified"]],
    ]);
    expect(store.pipelines[0]).toMatchObject({ latestVersion: "0.12.2", tables: ["fastqc_summary"], installed: { version: "0.12.1", enabled: true } });
    expect(store.pipelines[1]).toMatchObject({ goals: ["Taxa from amplicons"], request: { status: "pending", requestedBy: "Amara Okafor" } });
    expect((await pipelineStore({ labKey: lab, access: admin, load: load as never })).pipelines[1].action).toEqual({ kind: "install", label: "Install" });
  });

  it("gives each card what it reads, its stages, files, references, settings and where its description comes from; store entries take the registry's fields", async () => {
    state.installed.add("ampliseq");
    const load = vi.fn(async () => ({ registries: [], categories: [], registryErrors: [], duplicatePipelineIds: [], successfulRegistryCount: 1,
      pipelines: [{ id: "taxprofiler", name: "nf-core/taxprofiler", description: "Shotgun profiling", category: "taxonomy", version: "1.1.0", latestVersion: "1.1.0", versions: [{ version: "1.1.0" }], author: "nf-core", downloads: 0, verified: true, icon: "", featured: false, tags: [], isPrivate: false, licenseRequired: false, targets: null, catalogs: ["study"], capabilities: null,
        source: { kind: "registry", sourceId: "registry:x", label: "nf-core registry", sha256: "abc" },
        record: { stages: ["Kraken2", "MetaPhlAn", "Bracken"], references: [{ id: "k2", label: "Kraken2 standard", sizeBytes: 70 * 1024 ** 3 }], sizeBytes: 12 * 1024 ** 2, citedBy: 120, goals: ["Species from shotgun reads"], inputs: { reads: "shotgun", layouts: ["paired", "single"] } } }] }));
    const store = await pipelineStore({ labKey: lab, access: member, load: load as never });
    const entry = (id: string) => store.pipelines.find((candidate) => candidate.id === id)!;
    expect(entry("fastqc")).toMatchObject({ inputs: [{ id: "reads", label: "FASTQ reads", kind: "reads", detail: null }], files: [], stages: ["FastQC"], settings: { count: 1, basic: [] },
      described: true, reads: { kind: "any" }, outputs: [{ name: "fastqc_summary", tableKind: "sample-summary" }], answers: "Are the reads good enough", estimate: null });
    expect(entry("ampliseq")).toMatchObject({ files: [{ label: "multiqc", kind: "report" }], stages: ["FastQC", "Cutadapt", "DADA2", "SILVA taxonomy", "MultiQC"], references: [{ id: "silva-138", label: "SILVA 138", installed: false }],
      settings: { count: 3, basic: ["Trim forward reads to", "Primers", "Reference database"] }, changelogUrl: "https://github.com/nf-core/ampliseq/releases/tag/2.9.0", reads: { kind: "amplicon" } });
    expect(entry("taxprofiler")).toMatchObject({ stages: ["Kraken2", "MetaPhlAn", "Bracken"], references: [{ id: "k2", label: "Kraken2 standard", installed: false }], sizeBytes: 12 * 1024 ** 2, citedBy: 120, signed: true, licenseKey: false,
      goals: ["Species from shotgun reads"], described: true, reads: { kind: "shotgun", layouts: ["paired", "single"] }, inputs: [{ id: "reads", label: "FASTQ reads", kind: "reads" }] });
  });
});

describe("a study's data in one line", () => {
  it("reads a few reads of the FASTQ files: layout, length, amplicon region and primers", async () => {
    const insert = (i: number) => "ACGT".repeat(60).slice(i % 4, 230 + (i % 4));
    await writeFastq("A01_R1.fastq.gz", Array.from({ length: 50 }, (_, i) => `GTGCCAGCAGCCGCGGTAA${insert(i)}`.slice(0, 250)));
    await writeFastq("A01_R2.fastq.gz", Array.from({ length: 50 }, (_, i) => `GGACTACAAGGGTATCTAAT${insert(i + 1)}`.slice(0, 250)));
    await writeFastq("A02_R1.fastq.gz", Array.from({ length: 50 }, (_, i) => `GTGTCAGCCGCCGCGGTAA${insert(i + 2)}`.slice(0, 250)));
    await writeFastq("A02_R2.fastq.gz", Array.from({ length: 50 }, (_, i) => `GGACTACTAGGGTTTCTAAT${insert(i + 3)}`.slice(0, 250)));
    const summary = await dataSummary("project:p1");
    expect(summary).toMatchObject({ samples: 2, reads: { files: 4, pairs: 2, single: 0, layout: "paired", length: { max: 250 } }, kind: "amplicon", region: "16S V4", primers: { forward: "515F", reverse: "806R", share: 1 }, tablesOnly: false,
      words: "2 samples · paired FASTQ 2×250 · 16S V4 amplicons (primers 515F/806R in 100% of reads)" });
  });

  it("says tables only when Data has no reads", async () => {
    state.files = [];
    rows("exploreDataset").push({ id: "d1", targetKey: "project:p1", kind: "imported", name: "genus.csv", currentVersionId: "v1", createdAt: new Date() });
    rows("exploreDatasetVersion").push({ id: "v1", rowCount: 708, schema: JSON.stringify({ columns: Array.from({ length: 149 }, (_, i) => ({ key: `c${i}` })) }) });
    expect(await dataSummary("project:p1")).toMatchObject({ samples: 0, reads: null, kind: null, tablesOnly: true, words: "1 table (genus.csv 708 × 149) · no reads" });
  });
});
