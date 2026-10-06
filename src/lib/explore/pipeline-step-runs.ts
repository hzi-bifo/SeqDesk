/**
 * A pipeline step inside a numbered run of the recipe (PIPELINE-STEPS-PLAN §3–4). When the run reaches the step,
 * startPipelineStep records the step run first (its id `fr_<run>_<step>` makes the start idempotent across advancing
 * processes) and then:
 *   - a pinned step writes the pinned run's tables and completes;
 *   - a Resume continues the failed pipeline run in place (Nextflow -resume, run-resume.ts);
 *   - otherwise the reuse cache (ExplorePipelineCache, per study, pipeline, version and input hash) decides: a finished
 *     run with the same inputs is reused (its tables are written, nothing starts), a run still going is joined, and
 *     only otherwise a new pipeline run starts through the existing run service (enablement, sample checks, the
 *     samplesheet and the execution policy all apply), as the person who started the recipe run.
 * Waiting never blocks a process: each pass of the explore monitor (syncPipelineSteps) reads the pipeline run, keeps a
 * plain progress snapshot on the step run (stages, samples, the sentence), and when the pipeline finishes writes its
 * table outputs as new versions of the step's declared tables with pipeline-run provenance. A failed pipeline fails
 * the step with the pipeline's own sentence; cancelling the recipe run cancels the pipeline run unless another
 * recipe run waits on it too.
 *
 * Pipeline step runs carry executionMode "pipeline" and no run folder of their own, so the explore monitor and
 * housekeeping never treat them as code runs.
 */
import fs from "fs/promises";
import path from "path";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import { createPipelineRunForOperator, startPipelineRunForOperator } from "@/lib/pipelines/pipeline-run-service";
import { cancelPipelineRunForOperator } from "@/lib/pipelines/pipeline-run-ops-service";
import { ensureDataStudy, readsChangedSinceRun, readsInData, readsSnapshot } from "@/lib/pipelines/data-study";
import { getDataRun } from "@/lib/pipelines/pipeline-data-service";
import { prepareFailureWords, slurmRefusal, type PlainStatus } from "@/lib/pipelines/plain-status";
import { resumePipelineRun } from "@/lib/pipelines/run-resume";
import { parseTraceContent, type NextflowTask } from "@/lib/pipelines/nextflow/trace-parser";
import { findStepByProcessFromPackage } from "@/lib/pipelines/package-loader";
import { runBuilder } from "./build";
import { writeDatasetVersion } from "./datasets";
import { allocateRunNumber } from "./analyses";
import { parseJsonObject } from "./schema";
import type { BuildContext } from "./builders/types";
import {
  parsePipelineStepConfig, pipelineInfo, pipelineInputHash, pipelineStartAccess, preflightConfig, readsKeyHash, runFolderPresent, stagesOf, stepReads,
  type PipelineAccess, type PipelineOutputSpec, type PipelineStepConfig,
} from "./pipeline-steps";
import type { RecipeModel, StepRecord } from "./recipe";

const ACTIVE = ["pending", "queued", "running"];
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const plural = (count: number, word: string, many = `${word}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? word : many}`;

/** What a plan entry of a pipeline step carries (ExploreFlowRun.plan[].pipeline). */
export interface PipelinePlan {
  pipelineId: string;
  version: string;
  pinnedRunId?: string | null;
  /** The starter's grant when the run started; the monitor that starts the pipeline later has no session. */
  accessScope?: "own" | "installation";
  /** Resume this failed pipeline run in place instead of starting one; `leaveOut`: without these samples. */
  resume?: { pipelineRunId: string; memory?: string | null; time?: string | null; process?: string | null; leaveOut?: string[] | null } | null;
  /** Start a new pipeline run even when a finished one with the same inputs exists. */
  fresh?: boolean;
  /** Run only the samples that are new since the step's last run, and merge its tables with that run's (pipelines
   *  whose manifest allows it: `incremental`). */
  newSamplesOnly?: boolean;
}

/** The parts of a plan entry this module reads (flow-runs.ts PlanEntry). */
export interface PipelineEntry {
  analysisId: string;
  label: string;
  name: string;
  revisionId: string;
  execute: boolean;
  kind?: "code" | "pipeline" | "samples";
  pipeline?: PipelinePlan;
}

export interface FlowRunLite { id: string; flowId: string; number: number | null; kind: string; startedById: string; startedByName: string | null }

/** The step run's pipeline record (ExploreAnalysisRun.results.pipeline), shown on the step and in the run view. */
export interface PipelineSnapshot {
  pipelineRunId: string | null;
  runNumber: string | null;
  pipelineId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  words: string;
  stages: Array<{ name: string; state: "done" | "running" | "failed" | "waiting"; samples?: { done: number; total: number } | null }>;
  progress: { total: number; done: number; running: number; failed: number; waiting: number; perSample: boolean; stage: string | null; failedSamples: Array<{ sample: string; stage: string; words: string }> } | null;
  error: { kind: string; sentence: string; firstLines: string[]; process: string | null; sample: string | null; fix: { kind: string; label: string; memory?: string; time?: string } | null } | null;
  keeps: { finishedSteps: number; words: string } | null;
  elapsedSeconds: number | null;
  estimate: { seconds: number | null; words: string };
  startedBy: string | null;
  where: string | null;
  log: string[];
  reused?: boolean;
  /** A reused run: the recipe run that ran it ("reused from Run #2"); the step run itself belongs to the later run. */
  reusedFrom?: { flowRunId: string; number: number | null } | null;
  joined?: boolean;
  pinned?: boolean;
  resumed?: number;
  inputHash?: string | null;
  readsKey?: string | null;
  sampleCount?: number | null;
  /** Each sample's state now (the dot grid), by the names the run gave them. */
  sampleStates?: Array<{ sample: string; state: "done" | "running" | "failed" | "waiting"; stage: string | null }>;
  /** A failed sample can be left out (only where the stage works sample by sample), or why not. */
  leaveOut?: { allowed: boolean; words: string; stage: string | null; samples: string[] } | null;
  /** CPU hours the run used so far (from the trace). */
  cpuHours?: number | null;
  /** The step waits before its pipeline starts (another pipeline of the study runs: at most N at a time). */
  waiting?: { reason: "limit"; words: string } | null;
  /** Only the new samples ran; the tables merge with these earlier runs. */
  incremental?: { baseRunIds: string[]; newSamples: number } | null;
  outputs?: Array<{ name: string; outputId: string; datasetId: string | null; versionId: string | null; version: number | null; rows: number | null; warnings: string[] }>;
  updatedAt: string;
}

export function snapshotOf(results: string | null | undefined): PipelineSnapshot | null {
  const pipeline = record(parseJsonObject(results)).pipeline;
  return pipeline && typeof pipeline === "object" ? (pipeline as PipelineSnapshot) : null;
}

// ---------------------------------------------------------------------------
// Writing a finished run's tables into the step's tables
// ---------------------------------------------------------------------------

/** The step's table for an output name (created when missing, as the step declared it). */
async function stepDataset(targetKey: string, analysisId: string, stepName: string, output: PipelineOutputSpec, pipelineId: string, userId: string): Promise<string> {
  const candidates = await db.exploreDataset.findMany({ where: { targetKey, kind: "derived", sourceConfig: { contains: analysisId } }, select: { id: true, sourceConfig: true } });
  const existing = candidates.find((candidate) => { const config = record(parseJsonObject(candidate.sourceConfig)); return config.analysisId === analysisId && config.artifactName === output.name; });
  if (existing) return existing.id;
  const created = await db.exploreDataset.create({ data: { targetKey, kind: "derived", name: `${output.name} (${stepName})`.slice(0, 200), createdById: userId, description: `Written by the pipeline step ${stepName} when it runs.`,
    sourceConfig: JSON.stringify({ builder: "analysis-run", analysisId, artifactName: output.name, pipelineId, pipelineOutputId: output.outputId }) } });
  return created.id;
}

/**
 * A finished pipeline run's table outputs as new versions of the step's tables, built exactly as Data's
 * "output → table" builds them (pipeline-table builder, pinned to that run), with pipeline-run provenance.
 */
export async function writePipelineOutputs(input: { targetKey: string; analysisId: string; stepName: string; pipelineRunId: string; pipelineId: string; outputs: PipelineOutputSpec[]; userId: string; mergeWith?: string[] | null }): Promise<NonNullable<PipelineSnapshot["outputs"]>> {
  const run = await db.pipelineRun.findUnique({ where: { id: input.pipelineRunId }, select: { id: true, runNumber: true, studyId: true } });
  if (!run?.studyId) return input.outputs.map((output) => ({ name: output.name, outputId: output.outputId, datasetId: null, versionId: null, version: null, rows: null, warnings: ["The pipeline run is gone."] }));
  const study = await db.study.findUnique({ where: { id: run.studyId }, select: { userId: true } });
  // The rows are the data study's samples (its owner's); who may start the run was decided before it started.
  const context: BuildContext = { target: { type: "study", id: run.studyId }, targetKey: `study:${run.studyId}`, userId: study?.userId ?? input.userId, installation: false, isFacilityAdmin: false };
  const out: NonNullable<PipelineSnapshot["outputs"]> = [];
  // Samples left out while it ran or after it are not in its tables; new-samples-only runs merge with earlier ones.
  const { builtWithout, laterExcludedOf } = await import("./pipeline-step-extras");
  const leftOut = await laterExcludedOf(input.analysisId).catch(() => new Set<string>());
  for (const output of input.outputs) {
    const datasetId = await stepDataset(input.targetKey, input.analysisId, input.stepName, output, input.pipelineId, input.userId);
    try {
      const raw = await runBuilder("pipeline-table", context, { pipelineId: input.pipelineId, outputId: output.outputId, runIds: [run.id, ...(input.mergeWith ?? []).filter((id) => id !== run.id)] });
      const built = raw ? builtWithout(raw, leftOut) : raw;
      if (!built) { out.push({ name: output.name, outputId: output.outputId, datasetId, versionId: null, version: null, rows: null, warnings: ["This run made no such table."] }); continue; }
      const version = await writeDatasetVersion({
        datasetId, schema: built.schema, rows: built.rows, buildSource: "analysis-run", createdById: input.userId, keys: built.keys,
        provenance: { ...built.provenance, builder: "pipeline-step@1", notes: [...(built.provenance.notes ?? []), `Pipeline step ${input.stepName} · ${run.runNumber}`] },
      });
      await db.exploreDataset.update({ where: { id: datasetId }, data: {
        tableKind: built.tableKind, roles: JSON.stringify(built.roles),
        sourceConfig: JSON.stringify({ builder: "analysis-run", analysisId: input.analysisId, artifactName: output.name, pipelineId: input.pipelineId, pipelineOutputId: output.outputId, pipelineRunId: run.id }),
      } });
      out.push({ name: output.name, outputId: output.outputId, datasetId, versionId: version.versionId, version: version.number, rows: version.rowCount, warnings: built.warnings });
    } catch (error) {
      out.push({ name: output.name, outputId: output.outputId, datasetId, versionId: null, version: null, rows: null, warnings: [error instanceof Error ? error.message : String(error)] });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Progress in plain words: stages, samples, the error and its fix
// ---------------------------------------------------------------------------

const FIX_OF: Record<string, string> = { resume: "resume", "run-again": "run-again", "fix-data": "open-step", "ask-admin": "ask-admin", "show-log": "show-log", retry: "run-again", "ask-less-memory": "ask-admin", "see-jobs": "show-log", cancel: "cancel", "open-outputs": "open-outputs" };

/** The run's samples by name (its input samples), so a task that works on all of them at once (a summary, MultiQC) is not counted as a sample. */
export interface RunSamples { names: string[]; total: number }

/** A task tag names one of the run's samples, exactly or with a suffix ("S1_T1", "S1.trimmed"). Without names every tag counts. */
function sampleTag(names: string[] | undefined): (tag: string | null) => tag is string {
  const known = new Set(names ?? []);
  if (!known.size) return (tag): tag is string => Boolean(tag);
  return (tag): tag is string => Boolean(tag) && (known.has(tag!) || [...tag!.matchAll(/[_.-]/g)].some((match) => known.has(tag!.slice(0, match.index))));
}

const ACTIVE_PIPELINE = ["pending", "queued", "running"];

/**
 * Stages: the package's declared steps with the state of the processes that match them; else the processes. With the
 * run's samples known, a stage counts every sample (the trace lists a task only once it finished), and a stage whose
 * finished tasks are all done while samples are still to come is still running (or, in a stopped run, where Resume starts).
 */
export function stagesFrom(pipelineId: string, plain: Pick<PlainStatus, "processes" | "stages">, status: string, tasks: NextflowTask[], samples?: RunSamples): PipelineSnapshot["stages"] {
  const declared = stagesOf(pipelineId);
  const isSample = sampleTag(samples?.names);
  const taskSamples = (processes: string[]) => {
    const tagged = tasks.filter((task) => processes.includes(task.process) && isSample(task.tag));
    if (!tagged.length) return null;
    const seen = new Set(tagged.map((task) => task.tag)).size;
    const total = samples?.names.length ? Math.max(seen, samples.total) : seen;
    const done = new Set(tagged.filter((task) => task.status === "COMPLETED" || task.status === "CACHED").map((task) => task.tag)).size;
    return { done, total };
  };
  const finished = status === "completed";
  const active = ACTIVE_PIPELINE.includes(status);
  const settle = (state: PipelineSnapshot["stages"][number]["state"], counted: { done: number; total: number } | null, later: boolean) =>
    state === "done" && !later && counted && counted.done < counted.total && !finished ? (active ? "running" as const : "waiting" as const) : state;
  if (!declared.length) {
    return plain.stages.map((stage, index) => {
      const counted = taskSamples(plain.processes.filter((process) => process.name.split(":").pop() === stage.name).map((process) => process.name.split(":").pop()!));
      return { name: stage.name, state: settle(stage.state, counted, plain.stages.slice(index + 1).some((entry) => entry.state !== "waiting")), samples: counted };
    });
  }
  const steps = declared.map((name) => ({ name, matched: [] as typeof plain.processes }));
  const unmatched: typeof plain.processes = [];
  for (const process of plain.processes) {
    const step = (() => { try { return findStepByProcessFromPackage(pipelineId, process.name); } catch { return null; } })();
    const target = step ? steps.find((entry) => entry.name === (step.name || step.id)) : undefined;
    if (target) target.matched.push(process); else unmatched.push(process);
  }
  // A package whose declared steps name none of the processes that ran: its processes are the stages.
  if (plain.processes.length && !steps.some((entry) => entry.matched.length)) {
    return plain.stages.map((stage, index) => {
      const counted = taskSamples([stage.name]);
      return { name: stage.name, state: settle(stage.state, counted, plain.stages.slice(index + 1).some((entry) => entry.state !== "waiting")), samples: counted };
    });
  }
  return steps.map((step, index) => {
    const states = step.matched.map((process) => process.status);
    const state = states.includes("failed") ? "failed" as const : states.includes("running") ? "running" as const : states.length && states.every((value) => value === "done") ? "done" as const
      : finished ? "done" as const : "waiting" as const;
    // A stage with no matching process yet while a later one ran (an unmatched helper process) counts as done.
    const later = steps.slice(index + 1).some((entry) => entry.matched.length);
    const counted = taskSamples(step.matched.map((process) => process.name.split(":").pop()!));
    return { name: step.name, state: settle(state === "waiting" && later ? "done" as const : state, counted, later), samples: counted };
  });
}

/**
 * Per sample, the stage being worked on now: done, running, failed and waiting samples; failed samples by name. Only
 * tasks that work on one sample count (with the run's sample names known); a finished run has every sample done.
 */
export function sampleProgress(tasks: NextflowTask[], total: number, stages: PipelineSnapshot["stages"], options: { names?: string[]; finished?: boolean } = {}): PipelineSnapshot["progress"] {
  if (!total) return null;
  const isSample = sampleTag(options.names);
  const sampleTasks = tasks.filter((task) => isSample(task.tag));
  const failedSamples = sampleTasks.filter((task) => task.status === "FAILED").map((task) => ({ sample: task.tag!, stage: task.process, words: `failed at ${task.process}${task.exit !== null ? ` (exit ${task.exit})` : ""}` }));
  const current = stages.find((stage) => stage.state === "running") ?? stages.find((stage) => stage.state === "failed") ?? stages.find((stage) => stage.state === "waiting") ?? null;
  // The processes of the current stage: those whose tasks are most recent.
  const latest = [...sampleTasks].sort((a, b) => (b.submit?.getTime() ?? 0) - (a.submit?.getTime() ?? 0))[0];
  const process = latest?.process ?? null;
  const stageTasks = process ? sampleTasks.filter((task) => task.process === process) : [];
  const perSample = stageTasks.length > 0;
  const done = new Set(stageTasks.filter((task) => task.status === "COMPLETED" || task.status === "CACHED").map((task) => task.tag));
  const failed = new Set(stageTasks.filter((task) => task.status === "FAILED" && !done.has(task.tag)).map((task) => task.tag));
  if (options.finished) {
    return { total, done: Math.max(0, total - failed.size), running: 0, failed: failed.size, waiting: 0, perSample, stage: current?.name ?? stages.at(-1)?.name ?? process, failedSamples: failedSamples.filter((entry) => failed.has(entry.sample)).slice(0, 50) };
  }
  const running = new Set(stageTasks.filter((task) => (task.status === "RUNNING" || task.status === "SUBMITTED") && !done.has(task.tag) && !failed.has(task.tag)).map((task) => task.tag));
  const waiting = Math.max(0, total - done.size - failed.size - running.size);
  return { total, done: done.size, running: running.size, failed: failed.size, waiting, perSample, stage: current?.name ?? process, failedSamples: failedSamples.slice(0, 50) };
}

async function traceTasks(runFolder: string | null): Promise<NextflowTask[]> {
  if (!runFolder) return [];
  const trace = await fs.readFile(path.join(runFolder, "trace.txt"), "utf8").catch(() => null);
  if (!trace) return [];
  try { return parseTraceContent(trace).tasks; } catch { return []; }
}

const STATUS_OF: Record<string, PipelineSnapshot["status"]> = { pending: "queued", queued: "queued", running: "running", completed: "completed", failed: "failed", cancelled: "cancelled" };

/** The plain snapshot of a pipeline run for the step (getDataRun's plain status plus samples from the trace). */
export async function pipelineSnapshot(pipelineRunId: string, targetKey: string, extra: Partial<PipelineSnapshot> = {}): Promise<PipelineSnapshot | null> {
  const [run, view] = await Promise.all([
    db.pipelineRun.findUnique({ where: { id: pipelineRunId }, select: { id: true, runNumber: true, pipelineId: true, status: true, runFolder: true, inputSampleIds: true } }),
    getDataRun(pipelineRunId, targetKey).catch(() => null),
  ]);
  if (!run) return null;
  const tasks = await traceTasks(run.runFolder);
  let ids: string[] = [];
  try { const parsed = JSON.parse(run.inputSampleIds ?? "null"); ids = Array.isArray(parsed) ? parsed.map(String) : []; } catch { ids = []; }
  const total = ids.length;
  // The samples' names tell per-sample tasks (tagged with the sample) from tasks over all samples (a summary).
  const names = total ? ((await db.sample.findMany({ where: { id: { in: ids } }, select: { sampleId: true } }).catch(() => [])) as Array<{ sampleId: string | null }>).map((sample) => sample.sampleId).filter((name): name is string => Boolean(name)) : [];
  const plain = view?.plain as PlainStatus | undefined;
  const stages = plain ? stagesFrom(run.pipelineId, plain, run.status, tasks, names.length ? { names, total } : undefined) : stagesOf(run.pipelineId).map((name) => ({ name, state: "waiting" as const }));
  const action = plain?.action ?? null;
  return {
    pipelineRunId: run.id, runNumber: run.runNumber, pipelineId: run.pipelineId, status: STATUS_OF[run.status] ?? "running",
    words: plain?.sentence ?? (run.status === "completed" ? "Finished" : "Preparing to start"),
    stages, progress: sampleProgress(tasks, total, stages, { names, finished: run.status === "completed" }),
    error: plain?.error ? { kind: plain.error.kind, sentence: plain.error.sentence, firstLines: plain.error.firstLines.slice(0, 6), process: plain.error.process, sample: plain.error.sample,
      fix: action && action.kind !== "cancel" ? { kind: FIX_OF[action.kind] ?? action.kind, label: action.label, ...(action.memory ? { memory: action.memory } : {}), ...(action.time ? { time: action.time } : {}) } : null } : null,
    keeps: plain?.keeps ? { finishedSteps: plain.keeps.finishedSteps, words: plain.keeps.words } : null,
    elapsedSeconds: plain?.elapsedSeconds ?? null, estimate: plain?.estimate ?? { seconds: null, words: "no estimate yet" },
    startedBy: view?.startedBy ?? null, where: view?.where ?? null, log: Array.isArray((view as { log?: string[] } | null)?.log) ? (view as { log: string[] }).log.slice(-6) : [],
    resumed: view?.resumed ?? 0, sampleCount: total || null,
    ...(await import("./pipeline-step-extras")).snapshotExtras({ pipelineId: run.pipelineId, tasks, names, plain, snapshot: { status: STATUS_OF[run.status] ?? "running", stages, error: plain?.error ? { kind: plain.error.kind, sentence: plain.error.sentence, firstLines: [], process: plain.error.process, sample: plain.error.sample, fix: null } : null, progress: sampleProgress(tasks, total, stages, { names, finished: run.status === "completed" }) } }),
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

/** "Step 2 (nf-core/ampliseq) stopped: DADA2 ran out of memory …" for the recipe run's failure line. */
export function pipelineFailureWords(label: string, results: string | null | undefined, errorTail: string | null | undefined, pipelineId?: string | null): string {
  const snapshot = snapshotOf(results);
  // A refusal before the pipeline ran already reads as a sentence about the step.
  const first = errorTail?.split("\n").find((line) => line.trim())?.trim() ?? "";
  if (!snapshot?.error && first.startsWith(`Step ${label} `)) return first.slice(0, 280);
  const id = snapshot?.pipelineId ?? pipelineId ?? null;
  const name = id ? (pipelineInfo(id)?.name ?? id) : "the pipeline";
  const sentence = snapshot?.error?.sentence ?? errorTail?.split("\n").find((line) => line.trim()) ?? "the pipeline stopped with an error";
  const clean = sentence.replace(/\s*·\s*Resume.*$/i, "");
  // "Assembly ran out…" reads "assembly ran out…" mid-sentence; a name ("DADA2", "FastQC", "SLURM") keeps its capitals.
  const lower = /^[A-Z][a-z]*[A-Z0-9]/.test(clean) ? clean : `${clean.charAt(0).toLowerCase()}${clean.slice(1)}`;
  return `Step ${label} (${name}) stopped: ${lower}`.slice(0, 280);
}

// ---------------------------------------------------------------------------
// Starting, joining, reusing, resuming
// ---------------------------------------------------------------------------

function isUnique(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002");
}

/** The step's configuration at the revision this run executes. */
async function configAt(revisionId: string): Promise<PipelineStepConfig | null> {
  const revision = await db.exploreAnalysisRevision.findUnique({ where: { id: revisionId } });
  return parsePipelineStepConfig((revision as { pipeline?: unknown } | null)?.pipeline);
}

/** Record the step run before anything starts; another process that got there first wins (null). */
async function claimStepRun(run: FlowRunLite, entry: PipelineEntry): Promise<string | null> {
  const id = `fr_${run.id}_${entry.analysisId}`.slice(0, 120);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await db.exploreAnalysisRun.create({ data: {
        id, analysisId: entry.analysisId, revisionId: entry.revisionId, runNumber: await allocateRunNumber(), status: "pending", executionMode: "pipeline",
        createdById: run.startedById, flowRunId: run.id, stepLabel: entry.label, trial: run.kind === "trial", queuedAt: new Date(),
      } });
      return id;
    } catch (error) {
      if (!isUnique(error)) throw error;
      if (await db.exploreAnalysisRun.findUnique({ where: { id }, select: { id: true } })) return null;
    }
  }
  throw new Error("Could not record the pipeline step run.");
}

async function complete(stepRunId: string, data: { pipelineRunId: string; snapshot: PipelineSnapshot; reusedFromRunId?: string | null; inputPins?: Prisma.InputJsonValue | null; startedAt?: Date | null }): Promise<void> {
  const now = new Date();
  const outputs = data.snapshot.outputs ?? [];
  const metrics = data.snapshot.sampleCount ? { samples: data.snapshot.sampleCount } : {};
  await db.exploreAnalysisRun.updateMany({
    where: { id: stepRunId, status: { in: ACTIVE } },
    data: {
      status: "completed", completedAt: now, exitCode: 0, pipelineRunId: data.pipelineRunId, ...(data.startedAt ? { startedAt: data.startedAt } : {}),
      ...(data.reusedFromRunId ? { reusedFromRunId: data.reusedFromRunId } : {}),
      ...(data.inputPins ? { inputPins: data.inputPins } : {}),
      results: JSON.stringify({ pipeline: data.snapshot, metrics, metricMeta: { samples: { label: "Samples" } }, tables: outputs.length, warnings: outputs.flatMap((output) => output.warnings) }),
    },
  });
}

async function fail(stepRunId: string, words: string, snapshot?: Partial<PipelineSnapshot> | null): Promise<void> {
  await db.exploreAnalysisRun.updateMany({
    where: { id: stepRunId, status: { in: ACTIVE } },
    data: { status: "failed", completedAt: new Date(), errorTail: words.slice(0, 4000), ...(snapshot ? { results: JSON.stringify({ pipeline: { ...snapshot, status: "failed", updatedAt: new Date().toISOString() } }) } : {}) },
  });
}

/** The step's sample list pin, as code steps pin the tables they read. */
async function samplesPins(config: PipelineStepConfig, revisionId: string): Promise<Prisma.InputJsonValue | null> {
  void revisionId;
  if (config.samples?.from !== "table" || !config.samples.datasetId) return null;
  const dataset = await db.exploreDataset.findUnique({ where: { id: config.samples.datasetId }, select: { id: true, name: true, currentVersionId: true } });
  const version = dataset?.currentVersionId ? await db.exploreDatasetVersion.findUnique({ where: { id: dataset.currentVersionId }, select: { id: true, number: true, contentHash: true, rowCount: true } }) : null;
  return dataset && version ? [{ alias: "samples", datasetId: dataset.id, versionId: version.id, versionNumber: version.number, contentHash: version.contentHash, name: dataset.name, rowCount: version.rowCount }] as unknown as Prisma.InputJsonValue : null;
}

/** A prior step run of this analysis that ran the same pipeline run ("reused from Run #2"). */
async function priorStepRun(analysisId: string, pipelineRunId: string, exceptId: string): Promise<string | null> {
  const prior = await db.exploreAnalysisRun.findFirst({ where: { analysisId, status: "completed", id: { not: exceptId }, executionMode: "pipeline" }, orderBy: { createdAt: "desc" }, select: { id: true, results: true } });
  return prior && snapshotOf(prior.results)?.pipelineRunId === pipelineRunId ? prior.id : null;
}

/** The recipe run in which this step first finished a pipeline run it now reuses: "reused from Run #2", not the reusing run's own number. */
async function firstFlowRunOf(analysisId: string, pipelineRunId: string, exceptId: string): Promise<{ flowRunId: string; number: number | null } | null> {
  const first = await db.exploreAnalysisRun.findFirst({ where: { analysisId, pipelineRunId, status: "completed", executionMode: "pipeline", id: { not: exceptId }, flowRunId: { not: null } }, orderBy: { createdAt: "asc" }, select: { flowRunId: true } });
  if (!first?.flowRunId) return null;
  const flowRun = await db.exploreFlowRun.findUnique({ where: { id: first.flowRunId }, select: { id: true, number: true } });
  return flowRun ? { flowRunId: flowRun.id, number: flowRun.number ?? null } : null;
}

/** Words for a start the run service refused. */
async function refusalWords(pipelineRunId: string | null, body: Record<string, unknown>, status: number): Promise<string> {
  const told = body as { error?: unknown; details?: unknown };
  const details = Array.isArray(told.details) ? told.details.map(String) : [];
  const prepared = prepareFailureWords([told.error, ...details].map((value) => String(value ?? "")).join("\n"));
  if (prepared) return `${prepared}.`;
  if (status >= 500 && pipelineRunId) {
    const row = await db.pipelineRun.findUnique({ where: { id: pipelineRunId }, select: { executionProfile: true } });
    let asked: { queue?: string | null; memory?: string | null; cores?: number | null } = {};
    try { asked = record(JSON.parse(row?.executionProfile ?? "{}").slurm) as typeof asked; } catch { asked = {}; }
    const refusal = slurmRefusal(String(told.error ?? ""), asked);
    if (refusal) return `SLURM did not take the job: ${refusal.words}.`;
  }
  return [String(told.error ?? "The pipeline could not start."), ...details.slice(0, 3)].join(" · ");
}

/**
 * Start the pipeline step of a recipe run (or settle it at once when it is pinned or reusable). Never throws for the
 * run's own reasons: a refusal fails the step with words, which fails the recipe run in the next pass.
 * Returns whether the step settled now (completed or failed), so the caller advances again at once.
 */
export async function startPipelineStep(run: FlowRunLite, entry: PipelineEntry, targetKey: string): Promise<{ settled: boolean } | null> {
  const stepRunId = await claimStepRun(run, entry);
  if (!stepRunId) return null;
  const config = await configAt(entry.revisionId);
  if (!config) { await fail(stepRunId, `Step ${entry.label} has no pipeline settings.`); return { settled: true }; }
  const plan = entry.pipeline ?? { pipelineId: config.pipelineId, version: config.version };
  const info = pipelineInfo(config.pipelineId);
  try {
    // A pinned existing run: its tables, nothing starts.
    if (config.pinnedRunId) {
      const outputs = await writePipelineOutputs({ targetKey, analysisId: entry.analysisId, stepName: entry.name, pipelineRunId: config.pinnedRunId, pipelineId: config.pipelineId, outputs: config.outputs, userId: run.startedById });
      const snapshot = await pipelineSnapshot(config.pinnedRunId, targetKey, { pinned: true, outputs });
      if (!snapshot) { await fail(stepRunId, `The pinned run of step ${entry.label} is gone from Data.`); return { settled: true }; }
      await complete(stepRunId, { pipelineRunId: config.pinnedRunId, snapshot, startedAt: new Date() });
      return { settled: true };
    }
    if (config.requestId || !info) { await fail(stepRunId, `Step ${entry.label} waits for ${info?.name ?? config.pipelineId} to be installed on this server.`); return { settled: true }; }

    const reads = await stepReads(targetKey, config.samples, config.exclusions);
    // The samples it runs on (left-out samples are not), named as the sample list names them.
    const only = config.samples?.from === "table" || reads.excluded?.length ? reads.samples : undefined;
    if (!reads.samples.length) { await fail(stepRunId, `Step ${entry.label}: there are no FASTQ reads in this study’s Data for it to run on.`); return { settled: true }; }
    if (reads.unmatched.length || reads.ambiguous.length) {
      await fail(stepRunId, `Step ${entry.label}: ${plural(reads.unmatched.length + reads.ambiguous.length, "sample")} on the sample list ${reads.unmatched.length + reads.ambiguous.length === 1 ? "has" : "have"} no clear reads (${[...reads.unmatched, ...reads.ambiguous].slice(0, 4).join(", ")}).`);
      return { settled: true };
    }
    const readsKey = readsKeyHash(reads.key);
    const inputHash = pipelineInputHash({ pipelineId: config.pipelineId, version: config.version, params: config.params, reads: reads.key, sampleList: reads.sampleList });
    const pins = await samplesPins(config, entry.revisionId);
    const base = { inputHash, readsKey, sampleCount: reads.samples.length };
    // At most N pipeline steps of a study run pipelines at once (an admin setting): over it, the step waits. A Resume
    // waits too (it runs the pipeline again); reusing or joining a run starts nothing, so it never counts against it.
    const waitForStudyLimit = async (): Promise<{ settled: boolean } | null> => {
      const { pipelineCapacity } = await import("./pipeline-limits");
      const capacity = await pipelineCapacity(targetKey, stepRunId).catch(() => null);
      if (capacity && !capacity.free) {
        await db.exploreAnalysisRun.updateMany({ where: { id: stepRunId, status: { in: ACTIVE } }, data: { status: "queued", results: JSON.stringify({ pipeline: { pipelineRunId: null, runNumber: null, pipelineId: config.pipelineId, status: "queued", words: capacity.words, stages: [], progress: null, error: null, keeps: null, elapsedSeconds: null, estimate: { seconds: null, words: "no estimate yet" }, startedBy: null, where: null, log: [], waiting: { reason: "limit", words: capacity.words }, ...base, updatedAt: new Date().toISOString() } }) } });
        return { settled: false };
      }
      return null;
    };

    // Resume: the failed pipeline run continues in place (its work folder), with more memory or time when asked.
    if (plan.resume?.pipelineRunId) {
      const waiting = await waitForStudyLimit();
      if (waiting) return waiting;
      await ensureDataStudy({ targetKey, userId: run.startedById, onlySamples: only, names: reads.names });
      // "Leave it out and continue": the samplesheet without them; -resume keeps every finished task of the others.
      if (plan.resume.leaveOut?.length) {
        const { dropFromSamplesheet } = await import("./pipeline-step-extras");
        await dropFromSamplesheet(plan.resume.pipelineRunId, plan.resume.leaveOut);
        await db.explorePipelineCache.upsert({ where: { targetKey_pipelineId_version_inputHash: { targetKey, pipelineId: config.pipelineId, version: config.version, inputHash } }, update: { pipelineRunId: plan.resume.pipelineRunId }, create: { targetKey, pipelineId: config.pipelineId, version: config.version, inputHash, pipelineRunId: plan.resume.pipelineRunId } }).catch(() => undefined);
      }
      const result = await resumePipelineRun(plan.resume.pipelineRunId, { process: plan.resume.process ?? null, memory: plan.resume.memory ?? null, time: plan.resume.time ?? null });
      if (result.status >= 300) { await fail(stepRunId, `Step ${entry.label} could not resume: ${String(result.body.error ?? "the pipeline did not resume")}`); return { settled: true }; }
      const snapshot = await pipelineSnapshot(plan.resume.pipelineRunId, targetKey, base);
      await db.exploreAnalysisRun.updateMany({ where: { id: stepRunId, status: { in: ACTIVE } }, data: { pipelineRunId: plan.resume.pipelineRunId, status: "running", startedAt: new Date(), ...(pins ? { inputPins: pins } : {}), results: JSON.stringify({ pipeline: snapshot }) } });
      return { settled: false };
    }

    // The reuse cache: the same study, pipeline, version and inputs.
    const cached = plan.fresh ? null : await db.explorePipelineCache.findUnique({ where: { targetKey_pipelineId_version_inputHash: { targetKey, pipelineId: config.pipelineId, version: config.version, inputHash } } });
    const cachedRun = cached ? await db.pipelineRun.findUnique({ where: { id: cached.pipelineRunId }, select: { id: true, status: true, runFolder: true, startedAt: true } }) : null;
    if (cachedRun?.status === "completed" && (await runFolderPresent(cachedRun.runFolder))) {
      const outputs = await writePipelineOutputs({ targetKey, analysisId: entry.analysisId, stepName: entry.name, pipelineRunId: cachedRun.id, pipelineId: config.pipelineId, outputs: config.outputs, userId: run.startedById });
      const snapshot = await pipelineSnapshot(cachedRun.id, targetKey, { ...base, reused: true, reusedFrom: await firstFlowRunOf(entry.analysisId, cachedRun.id, stepRunId), outputs });
      if (snapshot) {
        await complete(stepRunId, { pipelineRunId: cachedRun.id, snapshot, reusedFromRunId: await priorStepRun(entry.analysisId, cachedRun.id, stepRunId), inputPins: pins, startedAt: new Date() });
        return { settled: true };
      }
    }
    if (cachedRun && ACTIVE.includes(cachedRun.status)) {
      // Another recipe run already started this exact work: wait on it instead of starting it twice.
      const snapshot = await pipelineSnapshot(cachedRun.id, targetKey, { ...base, joined: true });
      await db.exploreAnalysisRun.updateMany({ where: { id: stepRunId, status: { in: ACTIVE } }, data: { pipelineRunId: cachedRun.id, status: snapshot?.status === "queued" ? "queued" : "running", startedAt: new Date(), ...(pins ? { inputPins: pins } : {}), results: JSON.stringify({ pipeline: snapshot }) } });
      return { settled: false };
    }

    const waiting = await waitForStudyLimit();
    if (waiting) return waiting;
    // New samples only: run those not in the step's last run, and merge the tables with it.
    let onlySamples = only;
    let incremental: PipelineSnapshot["incremental"] = null;
    if (plan.newSamplesOnly) {
      const { newSamplesSince } = await import("./pipeline-step-incremental");
      const since = await newSamplesSince(entry.analysisId, config, reads, stepRunId);
      if (since.refusal) { await fail(stepRunId, `Step ${entry.label}: ${since.refusal}`); return { settled: true }; }
      onlySamples = since.samples;
      incremental = { baseRunIds: since.baseRunIds, newSamples: since.samples.length };
    }
    // A new pipeline run, as the person who started the recipe run.
    const accessScope = plan.accessScope ?? "own";
    const study = await ensureDataStudy({ targetKey, userId: run.startedById, onlySamples, names: reads.names });
    if (!study.sampleIds.length) { await fail(stepRunId, `Step ${entry.label}: there are no FASTQ reads in this study’s Data for it to run on.`); return { settled: true }; }
    const created = await createPipelineRunForOperator({ body: { pipelineId: config.pipelineId, studyId: study.studyId, sampleIds: study.sampleIds, ...(Object.keys(config.params).length ? { config: config.params } : {}) }, userId: run.startedById, accessScope, canManageConfig: false });
    const createdBody = created.body as { run?: { id?: string }; error?: unknown };
    const pipelineRunId = createdBody.run?.id ?? null;
    if (created.status === 403 && createdBody.error === "Forbidden") {
      const access = await pipelineStartAccess(targetKey, { userId: run.startedById, canRun: true, installation: false, canManage: false });
      await fail(stepRunId, `Step ${entry.label}: ${access.words ?? "only the study’s owner or a SeqDesk admin starts pipelines here."}`);
      return { settled: true };
    }
    if (created.status >= 300 || !pipelineRunId) { await fail(stepRunId, `Step ${entry.label} could not start ${info.name}: ${await refusalWords(pipelineRunId, created.body, created.status)}`); return { settled: true }; }
    // Which reads it starts from: a Resume after they changed says so (it would use these).
    const { files } = await readsInData(targetKey);
    const used = new Set(reads.key.files.map((file) => file.id));
    await db.pipelineRunEvent.create({ data: { pipelineRunId, eventType: "inputs", source: "launcher", message: `${plural(used.size, "FASTQ file")} · recipe step ${entry.label}`, payload: JSON.stringify(readsSnapshot(files.filter((file) => used.has(file.id)))) } }).catch(() => undefined);
    await db.exploreAnalysisRun.updateMany({ where: { id: stepRunId, status: { in: ACTIVE } }, data: { pipelineRunId } });
    const started = await startPipelineRunForOperator({ runId: pipelineRunId, body: {}, userId: run.startedById, accessScope });
    if (started.status >= 300) { await fail(stepRunId, `Step ${entry.label} could not start ${info.name}: ${await refusalWords(pipelineRunId, started.body, started.status)}`); return { settled: true }; }
    // A new-samples-only run is not the whole work for these inputs: never reused as such.
    if (!incremental) await db.explorePipelineCache.upsert({
      where: { targetKey_pipelineId_version_inputHash: { targetKey, pipelineId: config.pipelineId, version: config.version, inputHash } },
      update: { pipelineRunId }, create: { targetKey, pipelineId: config.pipelineId, version: config.version, inputHash, pipelineRunId },
    });
    const snapshot = await pipelineSnapshot(pipelineRunId, targetKey, { ...base, ...(incremental ? { incremental } : {}) });
    await db.exploreAnalysisRun.updateMany({ where: { id: stepRunId, status: { in: ACTIVE } }, data: { status: snapshot?.status === "running" ? "running" : "queued", startedAt: new Date(), ...(pins ? { inputPins: pins } : {}), results: JSON.stringify({ pipeline: snapshot }) } });
    return { settled: false };
  } catch (error) {
    await fail(stepRunId, `Step ${entry.label} could not start ${info?.name ?? config.pipelineId}: ${error instanceof Error ? error.message : String(error)}`);
    return { settled: true };
  }
}

/** A step run that never got its pipeline run (the starting process died) is failed after this long. */
const START_GRACE_MS = 3 * 60 * 1000;

/**
 * Bring the active pipeline step runs of a recipe run up to date with their pipeline runs: progress while they go,
 * the step's tables when they finish, the pipeline's sentence when they fail. Returns whether any step run changed state.
 */
export async function syncPipelineSteps(run: FlowRunLite, plan: PipelineEntry[], targetKey: string, now = Date.now()): Promise<boolean> {
  const entries = plan.filter((entry) => entry.execute && entry.kind === "pipeline");
  if (!entries.length) return false;
  const stepRuns = await db.exploreAnalysisRun.findMany({ where: { flowRunId: run.id, analysisId: { in: entries.map((entry) => entry.analysisId) }, status: { in: ACTIVE }, executionMode: "pipeline" } });
  let changed = false;
  for (const stepRun of stepRuns) {
    const entry = entries.find((candidate) => candidate.analysisId === stepRun.analysisId)!;
    const pipelineRunId = (stepRun as { pipelineRunId?: string | null }).pipelineRunId ?? null;
    if (!pipelineRunId) {
      // Waiting for the study's limit of pipelines at once: once there is room, the claim goes and the next pass starts it.
      if (snapshotOf(stepRun.results)?.waiting) {
        const { pipelineCapacity } = await import("./pipeline-limits");
        if ((await pipelineCapacity(targetKey, stepRun.id).catch(() => null))?.free) { await db.exploreAnalysisRun.deleteMany({ where: { id: stepRun.id, status: "queued", pipelineRunId: null } }); changed = true; }
        continue;
      }
      if (stepRun.status === "pending" && now - stepRun.createdAt.getTime() > START_GRACE_MS) { await fail(stepRun.id, `Step ${entry.label}: the pipeline did not start. Run the recipe again.`); changed = true; }
      continue;
    }
    const prun = await db.pipelineRun.findUnique({ where: { id: pipelineRunId }, select: { id: true, status: true, queueJobId: true, createdAt: true } });
    if (!prun) { await fail(stepRun.id, `Step ${entry.label}: its pipeline run is gone.`); changed = true; continue; }
    // Created but never handed to the executor (the starting process died between the two): say so instead of waiting.
    if (prun.status === "pending" && !prun.queueJobId && now - prun.createdAt.getTime() > 3 * START_GRACE_MS) { await fail(stepRun.id, `Step ${entry.label}: the pipeline was prepared but never started. Run the recipe again.`); changed = true; continue; }
    const previous = snapshotOf(stepRun.results);
    const keep = { inputHash: previous?.inputHash ?? null, readsKey: previous?.readsKey ?? null, joined: previous?.joined, sampleCount: previous?.sampleCount ?? null, ...(previous?.incremental ? { incremental: previous.incremental } : {}) };
    if (prun.status === "completed") {
      const config = await configAt(stepRun.revisionId);
      const outputs = config ? await writePipelineOutputs({ targetKey, analysisId: stepRun.analysisId, stepName: entry.name, pipelineRunId: prun.id, pipelineId: config.pipelineId, outputs: config.outputs, userId: run.startedById, mergeWith: previous?.incremental?.baseRunIds ?? null }) : [];
      const snapshot = await pipelineSnapshot(prun.id, targetKey, { ...keep, outputs });
      if (snapshot) await complete(stepRun.id, { pipelineRunId: prun.id, snapshot });
      changed = true;
    } else if (prun.status === "failed") {
      const snapshot = await pipelineSnapshot(prun.id, targetKey, keep);
      await fail(stepRun.id, [snapshot?.error?.sentence ?? "The pipeline stopped with an error.", ...(snapshot?.error?.firstLines ?? [])].join("\n"), snapshot);
      changed = true;
    } else if (prun.status === "cancelled") {
      // Stopped outside the recipe (Data's pipelines, an admin): the record says so, not its last "Running · …" pass.
      const snapshot = await pipelineSnapshot(prun.id, targetKey, keep);
      await db.exploreAnalysisRun.updateMany({ where: { id: stepRun.id, status: { in: ACTIVE } }, data: { status: "cancelled", completedAt: new Date(), ...(snapshot ? { results: JSON.stringify({ pipeline: { ...snapshot, status: "cancelled" } }) } : {}) } });
      changed = true;
    } else {
      const snapshot = await pipelineSnapshot(prun.id, targetKey, keep);
      if (!snapshot) continue;
      const status = snapshot.status === "queued" ? "queued" : "running";
      const same = previous && previous.words === snapshot.words && JSON.stringify(previous.stages) === JSON.stringify(snapshot.stages) && JSON.stringify(previous.progress) === JSON.stringify(snapshot.progress);
      if (same && stepRun.status === status) continue;
      await db.exploreAnalysisRun.updateMany({ where: { id: stepRun.id, status: { in: ACTIVE } }, data: { status, ...(status === "running" && !stepRun.startedAt ? { startedAt: new Date(now) } : {}), results: JSON.stringify({ pipeline: snapshot }), outputTail: snapshot.log.join("\n") || undefined } });
      if (stepRun.status !== status) changed = true;
    }
  }
  return changed;
}

/**
 * Stop a pipeline step run (a cancelled or failed recipe run): its pipeline run is cancelled too, unless another
 * recipe run still waits on the same pipeline run.
 */
export async function stopPipelineStepRun(stepRunId: string): Promise<boolean> {
  const row = await db.exploreAnalysisRun.findUnique({ where: { id: stepRunId } });
  if (!row || !ACTIVE.includes(row.status)) return false;
  const pipelineRunId = (row as { pipelineRunId?: string | null }).pipelineRunId ?? null;
  // A stop that arrives after the pipeline's work finished does not undo it: the step settles as finished.
  if (pipelineRunId && await settleFinishedPipelineStep(stepRunId)) return false;
  if (pipelineRunId) {
    const others = await db.exploreAnalysisRun.count({ where: { pipelineRunId, status: { in: ACTIVE }, id: { not: stepRunId } } });
    const prun = await db.pipelineRun.findUnique({ where: { id: pipelineRunId }, select: { status: true } });
    if (!others && prun && ACTIVE.includes(prun.status)) await cancelLaunchingPipelineRun(pipelineRunId);
  }
  // The cancel raced the pipeline's own end (the server refused it because the work had finished).
  if (pipelineRunId && await settleFinishedPipelineStep(stepRunId)) return false;
  const results = await stoppedResults(row, pipelineRunId);
  const updated = await db.exploreAnalysisRun.updateMany({ where: { id: stepRunId, status: { in: ACTIVE } }, data: { status: "cancelled", completedAt: new Date(), ...(results ? { results } : {}) } });
  return updated.count > 0;
}

/**
 * Before steps are deleted (a step, or the whole analysis): their pipeline runs still going are stopped, unless another
 * recipe run waits on the same pipeline run. Otherwise the pipeline ran on orphaned, holding the server and the study's
 * limit, with nobody left to see it.
 */
export async function stopPipelinesOfSteps(analysisIds: string[]): Promise<number> {
  if (!analysisIds.length) return 0;
  const active = await db.exploreAnalysisRun.findMany({ where: { analysisId: { in: analysisIds }, executionMode: "pipeline", status: { in: ACTIVE } }, select: { id: true } }).catch(() => [] as Array<{ id: string }>);
  let stopped = 0;
  for (const run of active) if (await stopPipelineStepRun(run.id).catch(() => false)) stopped += 1;
  return stopped;
}

/**
 * Cancel a pipeline run, also while it is being launched: SeqDesk refuses (409) to cancel a run that is "running" before
 * its process id is recorded, which takes about a second. Without waiting for it, a cancel in that second left the
 * pipeline running with its step "Cancelled".
 */
export async function cancelLaunchingPipelineRun(pipelineRunId: string, attempts = 8, waitMs = 400): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await cancelPipelineRunForOperator(pipelineRunId).catch((error) => { console.error("[flow] could not cancel the pipeline run", pipelineRunId, error); return null; });
    if (!result || result.status !== 409) return;
    const prun = await db.pipelineRun.findUnique({ where: { id: pipelineRunId }, select: { status: true, queueJobId: true } });
    if (!prun || !ACTIVE.includes(prun.status)) return;
    // A launch in progress (no process id yet): wait for it. With the id recorded now, cancel again at once; any other
    // refusal (its outputs are being saved, it already ended) is the run's own end and is not retried.
    const message = String((result.body as { error?: unknown }).error ?? "");
    if (!prun.queueJobId) await new Promise((resolve) => setTimeout(resolve, waitMs));
    else if (!/no queue job ID is recorded/.test(message)) return;
  }
}

/**
 * When a still-active step run's pipeline run has finished (completed, or its wrapper wrote "exit code: 0" and the
 * monitor has not recorded it yet), settle the step as finished now: its tables written, its record "Finished".
 * True when it did. A cancel that arrives in that moment must not turn finished work into "Cancelled".
 */
export async function settleFinishedPipelineStep(stepRunId: string): Promise<boolean> {
  const row = await db.exploreAnalysisRun.findUnique({ where: { id: stepRunId } });
  if (!row || !ACTIVE.includes(row.status)) return false;
  const pipelineRunId = (row as { pipelineRunId?: string | null }).pipelineRunId ?? null;
  if (!pipelineRunId) return false;
  let prun = await db.pipelineRun.findUnique({ where: { id: pipelineRunId }, select: { status: true, runFolder: true } });
  if (!prun) return false;
  if (ACTIVE.includes(prun.status) && prun.runFolder) {
    const code = await import("@/lib/pipelines/run-completion").then((module) => module.inferPipelineExitCode(prun!.runFolder!)).then(async (value) => (await import("@/lib/pipelines/run-started")).startedExitCode(prun!.runFolder, value)).catch(() => null);
    if (code !== 0) return false;
    // Record the end now (what the monitor does in a few seconds): outputs, status.
    await import("@/lib/pipelines/pipeline-run-ops-service").then((module) => module.syncPipelineRunForOperator(pipelineRunId)).catch(() => null);
    prun = await db.pipelineRun.findUnique({ where: { id: pipelineRunId }, select: { status: true, runFolder: true } });
  }
  if (prun?.status !== "completed") return false;
  const analysis = await db.exploreAnalysis.findUnique({ where: { id: row.analysisId }, select: { targetKey: true, name: true } }).catch(() => null);
  if (!analysis?.targetKey) return false;
  const flowRun = row.flowRunId ? await db.exploreFlowRun.findUnique({ where: { id: row.flowRunId }, select: { startedById: true } }).catch(() => null) : null;
  const previous = snapshotOf(row.results);
  const keep = { inputHash: previous?.inputHash ?? null, readsKey: previous?.readsKey ?? null, joined: previous?.joined, sampleCount: previous?.sampleCount ?? null, ...(previous?.incremental ? { incremental: previous.incremental } : {}) };
  const config = await configAt(row.revisionId);
  const outputs = config ? await writePipelineOutputs({ targetKey: analysis.targetKey, analysisId: row.analysisId, stepName: analysis.name, pipelineRunId, pipelineId: config.pipelineId, outputs: config.outputs, userId: flowRun?.startedById ?? row.createdById, mergeWith: previous?.incremental?.baseRunIds ?? null }) : [];
  const snapshot = await pipelineSnapshot(pipelineRunId, analysis.targetKey, { ...keep, outputs });
  if (!snapshot) return false;
  await complete(stepRunId, { pipelineRunId, snapshot });
  return true;
}

/**
 * The record of a step run that was stopped: "Cancelled at FastQC · 1 finished step is kept" from its pipeline run (what
 * Resume keeps), not the last "Running · …" pass the run view and the recipe would otherwise show. When the pipeline
 * run goes on for another recipe run, only this step run stopped.
 */
async function stoppedResults(row: { analysisId: string; results: string | null }, pipelineRunId: string | null): Promise<string | null> {
  const previous = snapshotOf(row.results);
  const analysis = pipelineRunId ? await db.exploreAnalysis.findUnique({ where: { id: row.analysisId }, select: { targetKey: true } }).catch(() => null) : null;
  const fresh = pipelineRunId && analysis?.targetKey
    ? await pipelineSnapshot(pipelineRunId, analysis.targetKey, { inputHash: previous?.inputHash ?? null, readsKey: previous?.readsKey ?? null, sampleCount: previous?.sampleCount ?? null }).catch(() => null)
    : null;
  const base = fresh ?? previous;
  if (!base) return null;
  return JSON.stringify({ pipeline: { ...base, status: "cancelled", words: fresh?.status === "cancelled" ? fresh.words : "Stopped", updatedAt: new Date().toISOString() } });
}

// ---------------------------------------------------------------------------
// Before a recipe run starts
// ---------------------------------------------------------------------------

export interface PipelineRunOptions {
  access: PipelineAccess;
  /** Resume this step's failed pipeline run (the step's Resume); `leaveOut`: without these samples. */
  resume?: { stepId: string; pipelineRunId: string; memory?: string | null; time?: string | null; process?: string | null; leaveOut?: string[] | null } | null;
  /** Steps that start a new pipeline run even when a finished one with the same inputs exists. */
  fresh?: string[];
  /** Steps that run only their new samples (pipelines that allow it), merged with their last run's tables. */
  newSamplesOnly?: string[];
}

/**
 * The pipeline steps a recipe run would execute, checked before it is recorded: installed and ready, and allowed for
 * the person starting it; trials never start pipelines (a trial reuses the step's last result, or is refused). Said
 * up front so a recipe run never fails halfway for these reasons. Mutates the plan entries (pipeline details).
 */
export async function preparePipelineEntries(input: { model: RecipeModel; plan: Array<PipelineEntry & { reusedFrom: { flowRunId: string; number: number | null; stepRunId: string } | null }>; current: Map<string, StepRecord>; trial: boolean; options: PipelineRunOptions | null | undefined }): Promise<void> {
  const { model, plan, current, trial, options } = input;
  const entries = plan.filter((entry) => entry.kind === "pipeline" && entry.execute);
  if (!entries.length) return;
  for (const entry of entries) {
    const step = model.steps.find((candidate) => candidate.id === entry.analysisId);
    const config = parsePipelineStepConfig(step?.pipeline);
    if (!step || !config) throw flowError("invalid_request", `Step ${entry.label} has no pipeline settings.`);
    entry.pipeline = { pipelineId: config.pipelineId, version: config.version, pinnedRunId: config.pinnedRunId ?? null, accessScope: options?.access.installation ? "installation" : "own" };
    if (trial) {
      // Trials never start pipelines (nor write tables): the step's last result is read instead, else the trial cannot run.
      const record = current.get(entry.analysisId);
      if (record?.status !== "completed") throw flowError("invalid_request", "Trials do not run pipelines; run the recipe once first.", { stepId: entry.analysisId });
      entry.execute = false;
      entry.reusedFrom = { flowRunId: record.reusedFrom?.flowRunId ?? record.flowRunId, number: record.reusedFrom?.number ?? record.flowRunNumber, stepRunId: record.stepRunId };
      continue;
    }
    if (config.pinnedRunId) continue;
    if (options?.resume?.stepId === entry.analysisId) entry.pipeline.resume = { pipelineRunId: options.resume.pipelineRunId, memory: options.resume.memory ?? null, time: options.resume.time ?? null, process: options.resume.process ?? null, ...(options.resume.leaveOut?.length ? { leaveOut: options.resume.leaveOut } : {}) };
    if (options?.fresh?.includes(entry.analysisId)) entry.pipeline.fresh = true;
    if (options?.newSamplesOnly?.includes(entry.analysisId)) {
      const { pipelineRecord } = await import("./pipeline-record");
      const incremental = pipelineRecord(config.pipelineId).incremental;
      if (!incremental.allowed) throw flowError("invalid_request", `Step ${entry.label} cannot run only its new samples: ${incremental.reason ?? "its pipeline makes its tables from all samples together."}`, { stepId: entry.analysisId });
      entry.pipeline.newSamplesOnly = true;
      entry.pipeline.fresh = true;
    }
    if (!options) throw flowError("forbidden", `Step ${entry.label} is a pipeline; start this run from the analysis.`);
    const preflight = await preflightConfig(model, config, entry.analysisId, options.access);
    // A sample list an earlier step of this run writes is checked when the step starts.
    const upstreamRuns = plan.some((other) => other.execute && other.analysisId !== entry.analysisId && model.upstream.get(entry.analysisId)?.has(other.analysisId));
    // Someone who may not start pipelines here can still run the recipe when the same work already finished.
    const reusable = !upstreamRuns && !entry.pipeline.fresh && !entry.pipeline.resume && preflight.checks.some((check) => !check.ok && check.id === "permission")
      ? (await provisionalReuse(model.flow.targetKey, config))?.status === "completed" : false;
    const blocking = preflight.checks.find((check) => !check.ok && !(upstreamRuns && check.id === "samples") && !(reusable && check.id === "permission"));
    if (blocking) {
      const forbidden = blocking.id === "permission";
      throw flowError(forbidden ? "forbidden" : "invalid_request", `Step ${entry.label} is not ready: ${blocking.words.replace(/\.$/, "")}.`, { stepId: entry.analysisId, check: blocking });
    }
  }
}

/**
 * The pipeline run a step would reuse or join if it ran now: a finished run with the same inputs (its folder still
 * there), or one still going. Only meaningful when nothing the step reads runs first in the same recipe run.
 */
export async function provisionalReuse(targetKey: string, config: PipelineStepConfig): Promise<{ status: "completed" | "active"; pipelineRunId: string; runNumber: string } | null> {
  if (config.pinnedRunId || config.requestId || !pipelineInfo(config.pipelineId)) return null;
  const reads = await stepReads(targetKey, config.samples, config.exclusions);
  const inputHash = pipelineInputHash({ pipelineId: config.pipelineId, version: config.version, params: config.params, reads: reads.key, sampleList: reads.sampleList });
  const cached = await db.explorePipelineCache.findUnique({ where: { targetKey_pipelineId_version_inputHash: { targetKey, pipelineId: config.pipelineId, version: config.version, inputHash } } });
  const run = cached ? await db.pipelineRun.findUnique({ where: { id: cached.pipelineRunId }, select: { id: true, runNumber: true, status: true, runFolder: true } }) : null;
  if (run?.status === "completed" && (await runFolderPresent(run.runFolder))) return { status: "completed", pipelineRunId: run.id, runNumber: run.runNumber };
  if (run && ACTIVE.includes(run.status)) return { status: "active", pipelineRunId: run.id, runNumber: run.runNumber };
  return null;
}

/** The failed or cancelled pipeline run a step's Resume continues, and whether the reads changed since. */
export async function resumableRunOf(analysisId: string, targetKey: string): Promise<{ pipelineRunId: string; readsChanged: string | null } | null> {
  // Only the step's newest runs: a stop that a later finished run of the step replaced is not resumed (a run still
  // going is passed over, so a second Resume meets "Run #n is still running").
  const runs = await db.exploreAnalysisRun.findMany({ where: { analysisId, executionMode: "pipeline" }, orderBy: { createdAt: "desc" }, take: 5 });
  for (const run of runs) {
    if (run.status === "completed") return null;
    if (run.status !== "failed" && run.status !== "cancelled") continue;
    const pipelineRunId = (run as { pipelineRunId?: string | null }).pipelineRunId;
    if (!pipelineRunId) continue;
    const prun = await db.pipelineRun.findUnique({ where: { id: pipelineRunId }, select: { status: true } });
    if (prun && (prun.status === "failed" || prun.status === "cancelled")) return { pipelineRunId, readsChanged: await readsChangedSinceRun(pipelineRunId, targetKey) };
    return null;
  }
  return null;
}
