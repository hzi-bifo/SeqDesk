/**
 * Numbered runs of a flow's recipe (FLOW-GAPS D4, D5, A3). A run executes the
 * whole recipe, its out-of-date steps or chosen steps (with everything
 * downstream) as one record: #14 of this flow, over one recipe revision, with
 * the inputs, code and environment it used pinned. Steps it does not execute
 * are reused from the current run. One run per flow is active at a time.
 *
 * Steps execute through the existing step runner (createAndStartRun). The
 * explore monitor advances runs: after a step finishes it starts the steps
 * that were waiting for it, or fails the run with the error in words.
 */
import path from "path";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { readTail } from "@/lib/pipelines/nextflow";
import { flowError } from "@/lib/integration/flow-contract";
import { codeHashOf, parseInputBindings } from "./analyses";
import { pinEnvironment, type EnvironmentPin } from "./environment-lock";
import { resolveReadyEnvironment } from "./environments";
import { failureWords } from "./failure-words";
import { flowRunChanged } from "./flow-events";
import { computeStepStates, ensureRecipeRevision, loadRecipe, paramDiff, type RecipeModel, type StepRecord } from "./recipe";
import { downstreamOf, executionOrder, upstreamOf } from "./recipe-order";
import { parseStoredBlocks } from "./report-blocks";
import { cancelRun, createAndStartRun, ExploreRunError } from "./runner";
import { parseJsonObject, parseSchema } from "./schema";

export type FlowRunKind = "full" | "outOfDate" | "steps" | "trial";
export type FlowRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
const ACTIVE_FLOW = ["queued", "running"];
const ACTIVE_STEP = new Set(["pending", "queued", "running"]);

export interface PlanEntry {
  analysisId: string;
  label: string;
  name: string;
  revisionId: string;
  codeHash: string;
  environmentName: string;
  language: string;
  execute: boolean;
  dependsOn: string[];
  reusedFrom: { flowRunId: string; number: number | null; stepRunId: string } | null;
}

export interface FlowActor {
  userId: string;
  memberId?: string | null;
  name?: string | null;
}

export interface StartFlowRunInput {
  scope: "all" | "outOfDate" | { steps: string[] };
  trial?: boolean;
  sample?: number;
  notify?: boolean;
  requestId?: string;
  actor: FlowActor;
}

export interface StepValue {
  key: string;
  label: string;
  unit: string | null;
  value: unknown;
}

export interface FlowRunValue extends StepValue {
  stepId: string;
  stepLabel: string;
  metric: string;
}

export interface FlowRunSummary {
  id: string;
  flowId: string;
  number: number | null;
  trialNumber: number | null;
  kind: FlowRunKind;
  status: FlowRunStatus;
  interval: { from: string; to: string | null };
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  recipeRevision: number;
  codeLabel: string;
  inputsLabel: string | null;
  environment: (EnvironmentPin & Record<string, unknown>) | null;
  headline: { key: string; label: string; value: unknown; unit: string | null } | null;
  failed: { stepId: string; stepLabel: string; words: string } | null;
  startedBy: { userId: string; memberId: string | null; name: string | null };
  current: boolean;
  superseded: boolean;
  progress: { done: number; total: number; current: { stepId: string; label: string; name: string } | null };
  stepCount: number;
  reusedCount: number;
  ref: string;
}

type FlowRunRecord = Prisma.ExploreFlowRunGetPayload<object>;
type StepRunLite = { id: string; analysisId: string; status: string; revisionId: string; runNumber: string; inputPins: Prisma.JsonValue; results: string | null; errorTail: string | null; exitCode: number | null; startedAt: Date | null; completedAt: Date | null; durationMs: number | null; createdAt: Date; runFolder: string | null };
const stepRunSelect = { id: true, analysisId: true, status: true, revisionId: true, runNumber: true, inputPins: true, results: true, errorTail: true, exitCode: true, startedAt: true, completedAt: true, durationMs: true, createdAt: true, runFolder: true } as const;

export function planOf(run: { plan: Prisma.JsonValue }): PlanEntry[] {
  return Array.isArray(run.plan) ? (run.plan as unknown as PlanEntry[]) : [];
}

type Pin = { alias: string; datasetId: string; versionId: string; versionNumber?: number | null; contentHash?: string | null; name?: string; rowCount?: number };
function pinsOf(raw: Prisma.JsonValue | null | undefined): Pin[] {
  return Array.isArray(raw) ? (raw as unknown as Pin[]).filter((pin) => pin && typeof pin.alias === "string" && typeof pin.datasetId === "string") : [];
}

function resultsOf(raw: string | null | undefined): { metrics?: Record<string, unknown>; metricMeta?: Record<string, { label?: string; unit?: string }>; ledger?: unknown[]; notes?: string[] } {
  return (parseJsonObject(raw) ?? {}) as ReturnType<typeof resultsOf>;
}

const humanize = (key: string) => {
  const text = key.replace(/[_-]+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : key;
};

/** The named values one step run recorded (`metric`), with their labels and units. */
export function stepValues(results: string | null | undefined): StepValue[] {
  const parsed = resultsOf(results);
  const metrics = parsed.metrics && typeof parsed.metrics === "object" ? parsed.metrics : {};
  const meta = parsed.metricMeta ?? {};
  return Object.entries(metrics).slice(0, 100).map(([key, value]) => ({ key, label: meta[key]?.label ?? humanize(key), unit: meta[key]?.unit ?? null, value }));
}

export function stepLedger(results: string | null | undefined): unknown[] {
  const ledger = resultsOf(results).ledger;
  return Array.isArray(ledger) ? ledger : [];
}

// ---------------------------------------------------------------------------
// Records: what each step of a run is (executed or reused)
// ---------------------------------------------------------------------------

/** Per step, the step run a flow run executed or reused. */
export async function runRecords(flowRunId: string): Promise<{ run: FlowRunRecord; records: Map<string, StepRecord>; stepRuns: Map<string, StepRunLite> } | null> {
  const run = await db.exploreFlowRun.findUnique({ where: { id: flowRunId } });
  if (!run) return null;
  const plan = planOf(run);
  const own = await db.exploreAnalysisRun.findMany({ where: { flowRunId: run.id }, select: stepRunSelect, orderBy: { createdAt: "asc" } });
  const reusedIds = plan.map((entry) => entry.reusedFrom?.stepRunId).filter((id): id is string => Boolean(id));
  const reused = reusedIds.length ? await db.exploreAnalysisRun.findMany({ where: { id: { in: reusedIds } }, select: stepRunSelect }) : [];
  const stepRuns = new Map<string, StepRunLite>();
  for (const stepRun of [...reused, ...own]) stepRuns.set(stepRun.id, stepRun);
  const latestOwn = new Map<string, StepRunLite>();
  for (const stepRun of own) latestOwn.set(stepRun.analysisId, stepRun);
  const records = new Map<string, StepRecord>();
  for (const entry of plan) {
    const stepRun = entry.execute ? latestOwn.get(entry.analysisId) : entry.reusedFrom ? stepRuns.get(entry.reusedFrom.stepRunId) : undefined;
    if (!stepRun) continue;
    records.set(entry.analysisId, {
      stepRunId: stepRun.id,
      revisionId: stepRun.revisionId,
      status: stepRun.status,
      inputPins: pinsOf(stepRun.inputPins).map((pin) => ({ alias: pin.alias, datasetId: pin.datasetId, versionId: pin.versionId })),
      flowRunId: entry.execute ? run.id : entry.reusedFrom!.flowRunId,
      flowRunNumber: entry.execute ? run.number : entry.reusedFrom!.number,
      reusedFrom: entry.execute ? null : entry.reusedFrom ? { flowRunId: entry.reusedFrom.flowRunId, number: entry.reusedFrom.number } : null,
    });
  }
  return { run, records, stepRuns };
}

/** The revisions the records used, for telling code from param changes. */
export async function revisionsUsedBy(records: Map<string, StepRecord>): Promise<Map<string, { codeHash: string; params: string }>> {
  const ids = [...new Set([...records.values()].map((record) => record.revisionId))];
  if (!ids.length) return new Map();
  const revisions = await db.exploreAnalysisRevision.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, codeHash: true, params: true } });
  return new Map(revisions.map((revision) => [revision.id, { codeHash: revision.codeHash || codeHashOf(revision.code), params: revision.params }] as const));
}

// ---------------------------------------------------------------------------
// Starting a run
// ---------------------------------------------------------------------------

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002");
}

async function activeRunOf(flowId: string) {
  return db.exploreFlowRun.findFirst({ where: { flowId, status: { in: ACTIVE_FLOW } }, orderBy: { createdAt: "desc" } });
}

async function runActiveError(flowId: string) {
  const active = await activeRunOf(flowId);
  return flowError("run_active", active?.kind === "trial" ? `Trial ${active.trialNumber} of this flow is still running. Wait for it or stop it first.` : `Run #${active?.number ?? "?"} of this flow is still running. Wait for it or stop it first.`,
    { run: active ? { id: active.id, number: active.number, trialNumber: active.trialNumber, kind: active.kind, status: active.status } : null });
}

/** Which steps a run executes and which it reuses (D5). */
export function planRun(model: RecipeModel, scope: StartFlowRunInput["scope"], current: Map<string, StepRecord>, states: Map<string, { state: string }>): PlanEntry[] {
  const ids = new Set(model.steps.map((step) => step.id));
  let execute: Set<string>;
  if (scope === "all") execute = new Set(ids);
  else if (scope === "outOfDate") {
    const stale = model.steps.filter((step) => ["notRun", "outOfDate", "failed"].includes(states.get(step.id)?.state ?? "notRun")).map((step) => step.id);
    execute = downstreamOf(stale, model.upstream);
  } else {
    const chosen = scope.steps.filter((id) => ids.has(id));
    if (chosen.length !== scope.steps.length) throw flowError("invalid_request", "A chosen step is not part of this flow.");
    execute = downstreamOf(chosen, model.upstream);
    // A chosen step that reads from a step with nothing to reuse runs that step too.
    for (const dep of upstreamOf(execute, model.upstream)) if (current.get(dep)?.status !== "completed") execute.add(dep);
  }
  for (const id of execute) if (!ids.has(id)) execute.delete(id);
  const ordered = executionOrder(model.steps, model.upstream);
  return ordered.map((step) => {
    const record = current.get(step.id);
    const runs = execute.has(step.id);
    return {
      analysisId: step.id,
      label: model.labels.get(step.id) ?? "?",
      name: step.name,
      revisionId: step.revision?.id ?? "",
      codeHash: step.revision?.codeHash ?? "",
      environmentName: step.environmentName,
      language: step.language,
      execute: runs,
      dependsOn: [...(model.upstream.get(step.id) ?? [])],
      reusedFrom: !runs && record && record.status === "completed" ? { flowRunId: record.reusedFrom?.flowRunId ?? record.flowRunId, number: record.reusedFrom?.number ?? record.flowRunNumber, stepRunId: record.stepRunId } : null,
    };
  });
}

export async function startFlowRun(flowId: string, input: StartFlowRunInput): Promise<FlowRunSummary> {
  if (input.requestId) {
    const existing = await db.exploreFlowRun.findUnique({ where: { requestId: input.requestId } });
    if (existing) {
      if (existing.flowId !== flowId || existing.startedById !== input.actor.userId) throw flowError("invalid_request", "This request ID belongs to another run.");
      return serializeFlowRunById(existing.id);
    }
  }
  if (await activeRunOf(flowId)) throw await runActiveError(flowId);
  const model = await loadRecipe(flowId);
  if (!model) throw flowError("not_found", "Flow not found");
  if (!model.steps.length) throw flowError("invalid_request", "This flow has no steps yet.");
  const missingRevision = model.steps.find((step) => !step.revision);
  if (missingRevision) throw flowError("invalid_request", `Step ${model.labels.get(missingRevision.id)} has no code yet.`);
  const recipe = await ensureRecipeRevision(flowId, { userId: input.actor.userId, memberId: input.actor.memberId });

  const current = model.flow.currentRunId ? (await runRecords(model.flow.currentRunId))?.records ?? new Map<string, StepRecord>() : new Map<string, StepRecord>();
  const states = computeStepStates({ model, records: current, revisionsUsed: await revisionsUsedBy(current) });
  const trial = Boolean(input.trial);
  const plan = planRun(model, input.scope, current, states);
  const executed = plan.filter((entry) => entry.execute);
  if (!executed.length) throw flowError("invalid_request", "Every step is current. Choose the steps to run again.");

  for (const name of new Set(executed.map((entry) => entry.environmentName))) {
    if (!(await resolveReadyEnvironment(name))) throw flowError("environment_missing", `Environment ${name} is not built yet. A facility admin can build it under Explore environments.`, { environment: name });
  }
  const primary = executed[0];
  const environment = await pinEnvironment(primary.environmentName, primary.language).catch(() => null);
  const kind: FlowRunKind = trial ? "trial" : input.scope === "all" ? "full" : input.scope === "outOfDate" ? "outOfDate" : "steps";
  const sample = trial ? Math.min(Math.max(Math.floor(input.sample ?? 2), 1), 50) : null;

  let created: FlowRunRecord;
  try {
    created = await db.$transaction(async (tx) => {
      const counter = await tx.exploreFlow.update({ where: { id: flowId }, data: trial ? { trialCounter: { increment: 1 } } : { runCounter: { increment: 1 } }, select: { runCounter: true, trialCounter: true } });
      return tx.exploreFlowRun.create({
        data: {
          flowId,
          number: trial ? null : counter.runCounter,
          trialNumber: trial ? counter.trialCounter : null,
          kind,
          flowRevisionId: recipe.revisionId,
          recipeRevision: recipe.recipeRevision,
          status: "queued",
          startedById: input.actor.userId,
          startedByMemberId: input.actor.memberId ?? null,
          startedByName: input.actor.name?.slice(0, 200) ?? null,
          notifyOnFinish: Boolean(input.notify),
          stepCount: plan.length,
          doneCount: 0,
          plan: plan as unknown as Prisma.InputJsonValue,
          environment: environment ? (environment as unknown as Prisma.InputJsonValue) : undefined,
          trialSample: sample ? { samples: sample } : undefined,
          requestId: input.requestId ?? null,
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      if (input.requestId) {
        const existing = await db.exploreFlowRun.findUnique({ where: { requestId: input.requestId } });
        if (existing) return serializeFlowRunById(existing.id);
      }
      throw await runActiveError(flowId);
    }
    throw error;
  }
  await flowRunChanged(created.id, "queued");
  await advanceFlowRun(created.id);
  return serializeFlowRunById(created.id);
}

// ---------------------------------------------------------------------------
// Advancing a run (called after start, by the monitor, after each finalize)
// ---------------------------------------------------------------------------

const advancing = new Set<string>();

/** Trial steps read their upstream trial step's output file, never the database. */
async function trialFileInputs(entry: PlanEntry, plan: PlanEntry[], latest: Map<string, StepRunLite>, model: RecipeModel | null) {
  if (!model) return undefined;
  const step = model.steps.find((candidate) => candidate.id === entry.analysisId);
  const revision = step?.revision?.id === entry.revisionId ? step.revision : await db.exploreAnalysisRevision.findUnique({ where: { id: entry.revisionId }, select: { inputs: true } });
  const files: Record<string, { path: string; artifactId: string; name: string }> = {};
  for (const binding of parseInputBindings(revision?.inputs)) {
    const dataset = model.datasets.get(binding.datasetId);
    const producer = dataset?.producer ? plan.find((candidate) => candidate.analysisId === dataset.producer && candidate.execute) : undefined;
    if (!producer || !dataset?.artifactName) continue;
    const upstream = latest.get(producer.analysisId);
    if (!upstream) continue;
    const artifact = await db.exploreArtifact.findFirst({ where: { runId: upstream.id, kind: "table", name: dataset.artifactName, format: { in: ["tsv", "csv"] } } });
    if (artifact) files[binding.alias] = { path: artifact.path, artifactId: artifact.id, name: dataset.name };
  }
  return files;
}

export async function advanceFlowRun(flowRunId: string): Promise<void> {
  if (advancing.has(flowRunId)) return;
  advancing.add(flowRunId);
  try {
    await advanceOnce(flowRunId);
  } finally {
    advancing.delete(flowRunId);
  }
}

async function advanceOnce(flowRunId: string): Promise<void> {
  const run = await db.exploreFlowRun.findUnique({ where: { id: flowRunId } });
  if (!run || !ACTIVE_FLOW.includes(run.status)) return;
  const plan = planOf(run);
  const stepRuns = await db.exploreAnalysisRun.findMany({ where: { flowRunId: run.id }, select: stepRunSelect, orderBy: { createdAt: "asc" } });
  const latest = new Map<string, StepRunLite>();
  for (const stepRun of stepRuns) latest.set(stepRun.analysisId, stepRun);
  const executed = plan.filter((entry) => entry.execute);

  const failed = executed.find((entry) => latest.get(entry.analysisId)?.status === "failed");
  if (failed) {
    const stepRun = latest.get(failed.analysisId)!;
    await failFlowRun(run, failed, failureWords(failed.label, stepRun.errorTail, stepRun.exitCode), stepRun.errorTail);
    return;
  }
  if (executed.some((entry) => latest.get(entry.analysisId)?.status === "cancelled")) {
    await finishCancelled(run.id);
    return;
  }
  const completed = executed.filter((entry) => latest.get(entry.analysisId)?.status === "completed");
  if (completed.length === executed.length) {
    await completeFlowRun(run, plan, latest);
    return;
  }

  let model: RecipeModel | null | undefined;
  let started = false;
  for (const entry of executed) {
    if (latest.has(entry.analysisId)) continue;
    const ready = entry.dependsOn.every((dep) => {
      const upstream = plan.find((candidate) => candidate.analysisId === dep);
      return !upstream || !upstream.execute || latest.get(dep)?.status === "completed";
    });
    if (!ready) continue;
    if (run.kind === "trial" && model === undefined) model = await loadRecipe(run.flowId);
    try {
      const stepRun = await createAndStartRun({
        analysisId: entry.analysisId,
        revisionId: entry.revisionId,
        createdById: run.startedById,
        // One id per step of this run, so two advancing processes cannot start it twice.
        runId: `fr_${run.id}_${entry.analysisId}`.slice(0, 120),
        flowRun: {
          id: run.id,
          stepLabel: entry.label,
          trial: run.kind === "trial",
          sample: (run.trialSample as { samples?: number } | null)?.samples ?? 2,
          fileInputs: run.kind === "trial" ? await trialFileInputs(entry, plan, latest, model ?? null) : undefined,
          environmentDigest: (run.environment as { lockDigest?: string | null } | null)?.lockDigest ?? null,
        },
      });
      latest.set(entry.analysisId, { ...stepRun, analysisId: entry.analysisId, revisionId: entry.revisionId, inputPins: null, results: null, errorTail: null, exitCode: null, startedAt: null, completedAt: null, durationMs: null, createdAt: new Date(), runFolder: null, runNumber: stepRun.runNumber });
      started = true;
      if (stepRun.status === "failed") {
        const record = await db.exploreAnalysisRun.findUnique({ where: { id: stepRun.id }, select: { errorTail: true, exitCode: true } });
        await failFlowRun(run, entry, failureWords(entry.label, record?.errorTail, record?.exitCode), record?.errorTail ?? null);
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Another process started this step a moment ago: nothing to do.
      if (error instanceof ExploreRunError && error.status === 409 && /still active/.test(message)) continue;
      await failFlowRun(run, entry, failureWords(entry.label, message), message);
      return;
    }
  }

  const running = executed.find((entry) => ACTIVE_STEP.has(latest.get(entry.analysisId)?.status ?? ""));
  const data: Prisma.ExploreFlowRunUpdateManyMutationInput = {
    doneCount: completed.length,
    currentAnalysisId: running?.analysisId ?? null,
  };
  const becameRunning = run.status === "queued" && started;
  if (becameRunning) {
    data.status = "running";
    data.startedAt = new Date();
  }
  const changed = becameRunning || run.doneCount !== completed.length || run.currentAnalysisId !== (running?.analysisId ?? null);
  if (!changed) return;
  const updated = await db.exploreFlowRun.updateMany({ where: { id: run.id, status: { in: ACTIVE_FLOW } }, data });
  if (updated.count) await flowRunChanged(run.id, becameRunning ? "started" : "progress");
}

async function failFlowRun(run: FlowRunRecord, entry: PlanEntry, words: string, detail: string | null): Promise<void> {
  const updated = await db.exploreFlowRun.updateMany({
    where: { id: run.id, status: { in: ACTIVE_FLOW } },
    data: { status: "failed", completedAt: new Date(), failedAnalysisId: entry.analysisId, failedStepLabel: entry.label, failureWords: words, failureDetail: detail?.slice(-4000) ?? null, currentAnalysisId: null },
  });
  if (!updated.count) return;
  // The steps after it do not start; anything still running is stopped.
  const active = await db.exploreAnalysisRun.findMany({ where: { flowRunId: run.id, status: { in: [...ACTIVE_STEP] } }, select: { id: true } });
  for (const stepRun of active) await cancelRun(stepRun.id).catch(() => false);
  await flowRunChanged(run.id, "failed");
}

async function finishCancelled(flowRunId: string): Promise<void> {
  const updated = await db.exploreFlowRun.updateMany({ where: { id: flowRunId, status: { in: ACTIVE_FLOW } }, data: { status: "cancelled", completedAt: new Date(), currentAnalysisId: null } });
  if (!updated.count) return;
  const active = await db.exploreAnalysisRun.findMany({ where: { flowRunId, status: { in: [...ACTIVE_STEP] } }, select: { id: true } });
  for (const stepRun of active) await cancelRun(stepRun.id).catch(() => false);
  await flowRunChanged(flowRunId, "cancelled");
}

/** The run's values in recipe order and its headline (D28: the flow's headline value, else the first value). */
export function runValues(plan: PlanEntry[], results: Map<string, string | null>, headlineValue: string | null): { values: FlowRunValue[]; headline: FlowRunSummary["headline"] } {
  const values: FlowRunValue[] = [];
  for (const entry of plan) {
    for (const value of stepValues(results.get(entry.analysisId))) values.push({ ...value, key: `${entry.analysisId}.${value.key}`, metric: value.key, stepId: entry.analysisId, stepLabel: entry.label });
  }
  const chosen = (headlineValue ? values.find((value) => value.key === headlineValue) : undefined) ?? values[0];
  return { values: values.slice(0, 200), headline: chosen ? { key: chosen.key, label: chosen.label, value: chosen.value, unit: chosen.unit } : null };
}

async function completeFlowRun(run: FlowRunRecord, plan: PlanEntry[], latest: Map<string, StepRunLite>): Promise<void> {
  const reusedIds = plan.map((entry) => (!entry.execute ? entry.reusedFrom?.stepRunId : null)).filter((id): id is string => Boolean(id));
  const reused = reusedIds.length ? await db.exploreAnalysisRun.findMany({ where: { id: { in: reusedIds } }, select: stepRunSelect }) : [];
  const byStep = new Map<string, StepRunLite>();
  for (const entry of plan) {
    const stepRun = entry.execute ? latest.get(entry.analysisId) : reused.find((candidate) => candidate.id === entry.reusedFrom?.stepRunId);
    if (stepRun) byStep.set(entry.analysisId, stepRun);
  }
  const flow = await db.exploreFlow.findUnique({ where: { id: run.flowId }, select: { headlineValue: true } });
  const { values, headline } = runValues(plan, new Map([...byStep].map(([id, stepRun]) => [id, stepRun.results] as const)), flow?.headlineValue ?? null);
  const inputs = aggregateInputs(plan, byStep);
  const executed = plan.filter((entry) => entry.execute);
  const now = new Date();
  const updated = await db.exploreFlowRun.updateMany({
    where: { id: run.id, status: { in: ACTIVE_FLOW } },
    data: {
      status: "completed", completedAt: now, doneCount: executed.length, currentAnalysisId: null,
      summary: { headline, values } as unknown as Prisma.InputJsonValue,
      inputs: inputs as unknown as Prisma.InputJsonValue,
      verification: { steps: { done: byStep.size, total: plan.length }, at: now.toISOString() },
      ...(run.startedAt ? {} : { startedAt: run.queuedAt }),
    },
  });
  if (!updated.count) return;
  // A completed run of the recipe becomes the current one; trials never do (D13).
  if (run.kind !== "trial") await db.exploreFlow.update({ where: { id: run.flowId }, data: { currentRunId: run.id } });
  await flowRunChanged(run.id, "finished");
}

/** The tables each step read, one entry per step and alias. */
function aggregateInputs(plan: PlanEntry[], byStep: Map<string, StepRunLite>) {
  const inputs: Array<Pin & { stepId: string }> = [];
  for (const entry of plan) {
    for (const pin of pinsOf(byStep.get(entry.analysisId)?.inputPins)) inputs.push({ ...pin, stepId: entry.analysisId });
  }
  return inputs;
}

/** Advance every active run; the monitor calls this on each pass. */
export async function advanceActiveFlowRuns(): Promise<void> {
  const runs = await db.exploreFlowRun.findMany({ where: { status: { in: ACTIVE_FLOW } }, select: { id: true } });
  for (const run of runs) {
    try {
      await advanceFlowRun(run.id);
    } catch (error) {
      console.error("[flow] could not advance run", run.id, error);
    }
  }
}

// ---------------------------------------------------------------------------
// Stop, make current
// ---------------------------------------------------------------------------

export async function cancelFlowRun(flowRunId: string): Promise<FlowRunSummary> {
  const run = await db.exploreFlowRun.findUnique({ where: { id: flowRunId } });
  if (!run) throw flowError("not_found", "Run not found");
  if (ACTIVE_FLOW.includes(run.status)) await finishCancelled(run.id);
  return serializeFlowRunById(run.id);
}

export async function makeRunCurrent(flowRunId: string): Promise<{ run: FlowRunSummary; flow: { id: string; currentRunId: string } }> {
  const run = await db.exploreFlowRun.findUnique({ where: { id: flowRunId } });
  if (!run) throw flowError("not_found", "Run not found");
  if (run.status !== "completed" || run.kind === "trial") throw flowError("not_completed", "Only a completed run of the recipe can be the current one.");
  await db.exploreFlow.update({ where: { id: run.flowId }, data: { currentRunId: run.id } });
  await flowRunChanged(run.id, "current");
  return { run: await serializeFlowRunById(run.id), flow: { id: run.flowId, currentRunId: run.id } };
}

// ---------------------------------------------------------------------------
// Reading runs
// ---------------------------------------------------------------------------

function shortHash(value: string): string {
  return codeHashOf(value).slice(0, 6);
}

export function codeLabelOf(run: { recipeRevision: number; plan: Prisma.JsonValue }): string {
  return `rev ${run.recipeRevision} ${shortHash(planOf(run).map((entry) => `${entry.analysisId}:${entry.codeHash}`).join("\n"))}`;
}

/** "counts v2 8be04d": the first table the recipe reads from outside, and how many more. */
export function inputsLabelOf(inputs: Array<Pin & { stepId?: string }>, produced: Set<string>): string | null {
  const external = inputs.filter((pin) => !produced.has(pin.datasetId));
  const unique = [...new Map(external.map((pin) => [pin.datasetId, pin] as const)).values()];
  if (!unique.length) return null;
  const first = unique[0];
  const label = `${first.alias} v${first.versionNumber ?? "?"}${first.contentHash ? ` ${first.contentHash.slice(0, 6)}` : ""}`;
  return unique.length > 1 ? `${label} +${unique.length - 1}` : label;
}

interface SerializeContext {
  currentRunId: string | null;
  currentNumber: number | null;
  headlineValue: string | null;
  produced: Set<string>;
  stepRuns?: StepRunLite[];
}

export function serializeFlowRun(run: FlowRunRecord, context: SerializeContext): FlowRunSummary {
  const plan = planOf(run);
  const summary = (run.summary ?? {}) as { headline?: FlowRunSummary["headline"] };
  const executed = plan.filter((entry) => entry.execute);
  const currentEntry = run.currentAnalysisId ? plan.find((entry) => entry.analysisId === run.currentAnalysisId) : undefined;
  const inputs = Array.isArray(run.inputs) && (run.inputs as unknown[]).length ? (run.inputs as unknown as Pin[]) : (context.stepRuns ?? []).flatMap((stepRun) => pinsOf(stepRun.inputPins));
  return {
    id: run.id,
    flowId: run.flowId,
    number: run.number,
    trialNumber: run.trialNumber,
    kind: run.kind as FlowRunKind,
    status: run.status as FlowRunStatus,
    interval: { from: (run.startedAt ?? run.queuedAt).toISOString(), to: run.completedAt?.toISOString() ?? null },
    queuedAt: run.queuedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    recipeRevision: run.recipeRevision,
    codeLabel: codeLabelOf(run),
    inputsLabel: inputsLabelOf(inputs, context.produced),
    environment: (run.environment as FlowRunSummary["environment"]) ?? null,
    headline: summary.headline ?? null,
    failed: run.status === "failed" && run.failedAnalysisId ? { stepId: run.failedAnalysisId, stepLabel: run.failedStepLabel ?? "?", words: run.failureWords ?? "" } : null,
    startedBy: { userId: run.startedById, memberId: run.startedByMemberId, name: run.startedByName },
    current: context.currentRunId === run.id,
    superseded: run.status === "completed" && run.kind !== "trial" && context.currentRunId !== run.id && context.currentNumber !== null && (run.number ?? 0) < context.currentNumber,
    progress: { done: run.doneCount, total: executed.length, current: currentEntry ? { stepId: currentEntry.analysisId, label: currentEntry.label, name: currentEntry.name } : null },
    stepCount: run.stepCount,
    reusedCount: plan.filter((entry) => !entry.execute && entry.reusedFrom).length,
    ref: `labdesk://run/${run.id}`,
  };
}

/** Tables some step of the flow writes (so inputs labels name outside tables only). */
async function producedDatasets(flowId: string, targetKey: string): Promise<Set<string>> {
  const [steps, derived] = await Promise.all([
    db.exploreAnalysis.findMany({ where: { flowId }, select: { id: true } }),
    db.exploreDataset.findMany({ where: { targetKey, kind: "derived" }, select: { id: true, sourceConfig: true } }),
  ]);
  const ids = new Set(steps.map((step) => step.id));
  return new Set(derived.filter((dataset) => {
    const config = parseJsonObject(dataset.sourceConfig);
    return typeof config?.analysisId === "string" && ids.has(config.analysisId);
  }).map((dataset) => dataset.id));
}

async function contextFor(flowId: string): Promise<SerializeContext & { targetKey: string }> {
  const flow = await db.exploreFlow.findUnique({ where: { id: flowId }, select: { currentRunId: true, headlineValue: true, targetKey: true } });
  const current = flow?.currentRunId ? await db.exploreFlowRun.findUnique({ where: { id: flow.currentRunId }, select: { number: true } }) : null;
  return { currentRunId: flow?.currentRunId ?? null, currentNumber: current?.number ?? null, headlineValue: flow?.headlineValue ?? null, produced: await producedDatasets(flowId, flow?.targetKey ?? ""), targetKey: flow?.targetKey ?? "" };
}

export async function serializeFlowRunById(flowRunId: string): Promise<FlowRunSummary> {
  const run = await db.exploreFlowRun.findUnique({ where: { id: flowRunId } });
  if (!run) throw flowError("not_found", "Run not found");
  const context = await contextFor(run.flowId);
  const stepRuns = await db.exploreAnalysisRun.findMany({ where: { flowRunId: run.id }, select: stepRunSelect });
  return serializeFlowRun(run, { ...context, stepRuns });
}

export async function listFlowRuns(flowId: string, options: { trials?: boolean } = {}) {
  const runs = await db.exploreFlowRun.findMany({ where: { flowId, ...(options.trials === false ? { kind: { not: "trial" } } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
  const context = await contextFor(flowId);
  const active = runs.filter((run) => ACTIVE_FLOW.includes(run.status) && !(Array.isArray(run.inputs) && (run.inputs as unknown[]).length));
  const activeStepRuns = active.length ? await db.exploreAnalysisRun.findMany({ where: { flowRunId: { in: active.map((run) => run.id) } }, select: { ...stepRunSelect, flowRunId: true } }) : [];
  const earlierStepRuns = await db.exploreAnalysisRun.count({ where: { analysis: { flowId }, flowRunId: null } });
  return {
    runs: runs.map((run) => serializeFlowRun(run, { ...context, stepRuns: activeStepRuns.filter((stepRun) => stepRun.flowRunId === run.id) })),
    earlierStepRuns,
    counts: {
      total: runs.length,
      completed: runs.filter((run) => run.status === "completed").length,
      failed: runs.filter((run) => run.status === "failed").length,
      running: runs.filter((run) => ACTIVE_FLOW.includes(run.status)).length,
      trials: runs.filter((run) => run.kind === "trial").length,
    },
  };
}

type ArtifactLite = { id: string; runId: string; kind: string; format: string; name: string; derivedDatasetId: string | null; derivedVersionId: string | null; checksum: string | null; path: string };

/** Estimated time left (D40): only when an earlier completed run of this recipe revision timed every remaining step. */
async function estimateMs(run: FlowRunRecord, plan: PlanEntry[], latest: Map<string, StepRunLite>): Promise<number | null> {
  if (!ACTIVE_FLOW.includes(run.status)) return null;
  const earlier = await db.exploreFlowRun.findFirst({ where: { flowId: run.flowId, status: "completed", recipeRevision: run.recipeRevision, kind: { not: "trial" }, id: { not: run.id } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (!earlier) return null;
  const timed = await db.exploreAnalysisRun.findMany({ where: { flowRunId: earlier.id, status: "completed" }, select: { analysisId: true, durationMs: true } });
  const duration = new Map(timed.map((entry) => [entry.analysisId, entry.durationMs] as const));
  let total = 0;
  for (const entry of plan.filter((candidate) => candidate.execute)) {
    const stepRun = latest.get(entry.analysisId);
    if (stepRun?.status === "completed") continue;
    const took = duration.get(entry.analysisId);
    if (took === undefined || took === null) return null;
    const elapsed = stepRun?.startedAt ? Date.now() - stepRun.startedAt.getTime() : 0;
    total += Math.max(0, took - elapsed);
  }
  return total;
}

export async function getFlowRunDetail(flowRunId: string) {
  const loaded = await runRecords(flowRunId);
  if (!loaded) throw flowError("not_found", "Run not found");
  const { run, records, stepRuns } = loaded;
  const plan = planOf(run);
  const context = await contextFor(run.flowId);
  const own = [...stepRuns.values()].filter((stepRun) => plan.some((entry) => entry.execute && entry.analysisId === stepRun.analysisId));
  const latest = new Map<string, StepRunLite>();
  for (const stepRun of own.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) latest.set(stepRun.analysisId, stepRun);
  const artifactRunIds = [...records.values()].map((record) => record.stepRunId);
  const artifacts: ArtifactLite[] = artifactRunIds.length ? await db.exploreArtifact.findMany({ where: { runId: { in: artifactRunIds } }, select: { id: true, runId: true, kind: true, format: true, name: true, derivedDatasetId: true, derivedVersionId: true, checksum: true, path: true }, orderBy: { createdAt: "asc" } }) : [];
  const steps = plan.map((entry) => {
    const record = records.get(entry.analysisId);
    const stepRun = record ? stepRuns.get(record.stepRunId) : undefined;
    const status = !entry.execute ? (entry.reusedFrom ? "reused" : "notRun")
      : !stepRun ? (run.status === "failed" || run.status === "cancelled" ? "cancelled" : "queued")
      : stepRun.status === "pending" ? "queued" : stepRun.status;
    const blockedBy = status === "cancelled" && run.failedStepLabel ? run.failedStepLabel : null;
    return {
      stepId: entry.analysisId, label: entry.label, name: entry.name, status,
      stepRunId: stepRun?.id ?? null, runNumber: stepRun?.runNumber ?? null,
      reusedFrom: !entry.execute && entry.reusedFrom ? { flowRunId: entry.reusedFrom.flowRunId, number: entry.reusedFrom.number } : null,
      revisionId: entry.revisionId,
      durationMs: stepRun?.durationMs ?? null,
      startedAt: stepRun?.startedAt?.toISOString() ?? null,
      completedAt: stepRun?.completedAt?.toISOString() ?? null,
      blockedBy,
      ledger: stepLedger(stepRun?.results),
      values: stepValues(stepRun?.results),
      outputs: artifacts.filter((artifact) => artifact.runId === stepRun?.id).map((artifact) => ({ artifactId: artifact.id, name: artifact.name, kind: artifact.kind, format: artifact.format })),
    };
  });
  const runningEntry = plan.find((entry) => entry.execute && ACTIVE_STEP.has(latest.get(entry.analysisId)?.status ?? ""));
  const runningStep = runningEntry ? latest.get(runningEntry.analysisId) : undefined;
  const logTail = runningEntry && runningStep?.runFolder ? { stepId: runningEntry.analysisId, label: runningEntry.label, lines: (await readTail(path.join(runningStep.runFolder, "logs", "pipeline.out"), 40)) ?? "" } : null;
  const findings = await db.exploreRunFinding.findMany({ where: { flowRunId: run.id }, orderBy: { acceptedAt: "asc" } });
  const byStep = new Map<string, StepRunLite>();
  for (const [stepId, record] of records) { const stepRun = stepRuns.get(record.stepRunId); if (stepRun) byStep.set(stepId, stepRun); }
  const summary = serializeFlowRun(run, { ...context, stepRuns: own });
  return {
    ...summary,
    inputs: Array.isArray(run.inputs) && (run.inputs as unknown[]).length ? run.inputs : aggregateInputs(plan, byStep),
    steps,
    progress: { ...summary.progress, etaMs: await estimateMs(run, plan, latest) },
    logTail,
    failureDetail: run.failureDetail,
    findings: findings.map((finding) => ({ id: finding.id, analysisId: finding.analysisId, text: finding.text, values: finding.values, caveats: finding.caveats, acceptedById: finding.acceptedById, acceptedAt: finding.acceptedAt.toISOString() })),
  };
}

// ---------------------------------------------------------------------------
// Outputs and comparison
// ---------------------------------------------------------------------------

export async function flowRunOutputs(flowRunId: string) {
  const loaded = await runRecords(flowRunId);
  if (!loaded) throw flowError("not_found", "Run not found");
  const { run, records, stepRuns } = loaded;
  const plan = planOf(run);
  const flow = await db.exploreFlow.findUnique({ where: { id: run.flowId }, select: { targetKey: true, headlineValue: true } });
  const recordRuns = [...records.values()].map((record) => record.stepRunId);
  const artifacts: ArtifactLite[] = recordRuns.length ? await db.exploreArtifact.findMany({ where: { runId: { in: recordRuns } }, select: { id: true, runId: true, kind: true, format: true, name: true, derivedDatasetId: true, derivedVersionId: true, checksum: true, path: true }, orderBy: { createdAt: "asc" } }) : [];
  const versionIds = artifacts.map((artifact) => artifact.derivedVersionId).filter((id): id is string => Boolean(id));
  const versions = versionIds.length ? await db.exploreDatasetVersion.findMany({ where: { id: { in: versionIds } }, select: { id: true, rowCount: true, schema: true } }) : [];
  const reports = flow ? await db.exploreReport.findMany({ where: { targetKey: flow.targetKey }, select: { id: true, title: true, blocks: true } }) : [];
  const stepOfRun = new Map([...records].map(([stepId, record]) => [record.stepRunId, stepId] as const));
  const labelOf = new Map(plan.map((entry) => [entry.analysisId, entry.label] as const));
  const outputs = artifacts.filter((artifact) => artifact.kind !== "log").map((artifact) => {
    const stepId = stepOfRun.get(artifact.runId) ?? "";
    const version = versions.find((entry) => entry.id === artifact.derivedVersionId);
    const png = artifact.kind === "figure" ? artifacts.find((candidate) => candidate.runId === artifact.runId && candidate.name === artifact.name && candidate.format === "png") : undefined;
    const usedIn = reports.filter((report) => parseStoredBlocks(report.blocks).some((block) => {
      const entry = block as { type?: string; analysisId?: string; figureName?: string; datasetId?: string };
      return (entry.type === "figure" && entry.analysisId === stepId && entry.figureName === artifact.name) || (Boolean(artifact.derivedDatasetId) && entry.datasetId === artifact.derivedDatasetId);
    })).map((report) => ({ reportId: report.id, title: report.title }));
    return {
      artifactId: artifact.id, stepId, stepLabel: labelOf.get(stepId) ?? "?", name: artifact.name, title: artifact.name, kind: artifact.kind, format: artifact.format,
      url: `explore/runs/${artifact.runId}/artifacts/${artifact.id}`,
      thumbnailUrl: png ? `explore/runs/${png.runId}/artifacts/${png.id}` : null,
      dims: version ? `${version.rowCount.toLocaleString("en-US")} rows × ${parseSchema(version.schema).columns.length} columns` : null,
      datasetId: artifact.derivedDatasetId, versionId: artifact.derivedVersionId, checksum: artifact.checksum,
      ref: `labdesk://output/${run.id}/${artifact.id}`, usedIn,
    };
  });
  const results = new Map([...records].map(([stepId, record]) => [stepId, stepRuns.get(record.stepRunId)?.results ?? null] as const));
  const { values } = runValues(plan, results, flow?.headlineValue ?? null);
  return { outputs, values: values.map((value) => ({ ...value, ref: `labdesk://value/${run.id}/${value.stepId}/${encodeURIComponent(value.metric)}`, runId: run.id, runNumber: run.number, output: null, verified: run.status === "completed" })) };
}

const formatValue = (value: unknown) => (typeof value === "number" ? value.toLocaleString("en-US") : value === null || value === undefined ? "—" : String(value));

export async function compareFlowRuns(aId: string, bId: string, stepId?: string | null) {
  const [a, b] = await Promise.all([runRecords(aId), runRecords(bId)]);
  if (!a || !b) throw flowError("not_found", "Run not found");
  if (a.run.flowId !== b.run.flowId) throw flowError("invalid_request", "Both runs must belong to the same flow.");
  const planA = planOf(a.run);
  const planB = planOf(b.run);
  const name = (run: FlowRunRecord) => (run.number !== null ? `Run #${run.number}` : `Trial ${run.trialNumber}`);
  const labelOf = new Map([...planA, ...planB].map((entry) => [entry.analysisId, entry.label] as const));
  const words: string[] = [];

  const pinsFor = (loaded: NonNullable<typeof a>) => {
    const byStep = new Map<string, StepRunLite>();
    for (const [id, record] of loaded.records) { const stepRun = loaded.stepRuns.get(record.stepRunId); if (stepRun) byStep.set(id, stepRun); }
    return aggregateInputs(planOf(loaded.run), byStep);
  };
  const inputsA = new Map(pinsFor(a).map((pin) => [pin.datasetId, pin] as const));
  const inputsB = new Map(pinsFor(b).map((pin) => [pin.datasetId, pin] as const));
  const inputs = [...inputsB.values()].filter((pin) => inputsA.has(pin.datasetId) && inputsA.get(pin.datasetId)!.versionId !== pin.versionId).map((pin) => {
    const from = inputsA.get(pin.datasetId)!;
    return { alias: pin.alias, name: pin.name ?? pin.alias, from: { version: from.versionNumber ?? null, contentHash: from.contentHash ?? null }, to: { version: pin.versionNumber ?? null, contentHash: pin.contentHash ?? null } };
  });
  for (const input of inputs) words.push(`${name(b.run)} used ${input.alias} v${input.to.version ?? "?"} instead of v${input.from.version ?? "?"}`);

  const code = planB.filter((entry) => {
    const other = planA.find((candidate) => candidate.analysisId === entry.analysisId);
    return other && other.codeHash !== entry.codeHash;
  }).map((entry) => {
    const other = planA.find((candidate) => candidate.analysisId === entry.analysisId)!;
    return { stepId: entry.analysisId, label: entry.label, from: { revisionId: other.revisionId, codeHash: other.codeHash }, to: { revisionId: entry.revisionId, codeHash: entry.codeHash } };
  });
  const revisionIds = [...new Set([...planA, ...planB].map((entry) => entry.revisionId).filter(Boolean))];
  const revisions = revisionIds.length ? await db.exploreAnalysisRevision.findMany({ where: { id: { in: revisionIds } }, select: { id: true, number: true, params: true } }) : [];
  const revisionOf = new Map(revisions.map((revision) => [revision.id, revision] as const));
  const codeWithNumbers = code.map((entry) => ({ stepId: entry.stepId, label: entry.label, from: { revisionNumber: revisionOf.get(entry.from.revisionId)?.number ?? null, codeHash: entry.from.codeHash }, to: { revisionNumber: revisionOf.get(entry.to.revisionId)?.number ?? null, codeHash: entry.to.codeHash } }));
  for (const entry of codeWithNumbers) words.push(`step ${entry.label}'s code changed`);
  const params = planB.flatMap((entry) => {
    const other = planA.find((candidate) => candidate.analysisId === entry.analysisId);
    if (!other || other.revisionId === entry.revisionId) return [];
    return paramDiff(revisionOf.get(other.revisionId)?.params, revisionOf.get(entry.revisionId)?.params).map((diff) => ({ stepId: entry.analysisId, label: entry.label, ...diff }));
  });
  for (const diff of params) words.push(`step ${diff.label} used ${diff.key} ${formatValue(diff.to)} instead of ${formatValue(diff.from)}`);

  const envA = a.run.environment as { label?: string; lockDigest?: string | null; specHash?: string } | null;
  const envB = b.run.environment as { label?: string; lockDigest?: string | null; specHash?: string } | null;
  const environment = (envA?.lockDigest ?? envA?.specHash ?? null) === (envB?.lockDigest ?? envB?.specHash ?? null) ? "same" : { from: { label: envA?.label ?? null, lockDigest: envA?.lockDigest ?? null }, to: { label: envB?.label ?? null, lockDigest: envB?.lockDigest ?? null } };
  if (environment !== "same") words.push("the environment changed");

  const steps = planB.map((entry) => {
    const recordA = a.records.get(entry.analysisId);
    const recordB = b.records.get(entry.analysisId);
    const valuesA = new Map(stepValues(recordA ? a.stepRuns.get(recordA.stepRunId)?.results : null).map((value) => [value.key, value] as const));
    const valuesB = stepValues(recordB ? b.stepRuns.get(recordB.stepRunId)?.results : null);
    const lines = valuesB.filter((value) => JSON.stringify(valuesA.get(value.key)?.value) !== JSON.stringify(value.value)).map((value) => ({ label: value.label, from: valuesA.get(value.key)?.value ?? null, to: value.value }));
    return { stepId: entry.analysisId, label: entry.label, lines };
  }).filter((entry) => entry.lines.length);
  for (const step of steps.slice(0, 3)) {
    const line = step.lines[0];
    words.push(`step ${step.label}: ${line.label} ${formatValue(line.from)} → ${formatValue(line.to)}`);
  }

  const keyDiff = stepId ? await keyDiffOf(stepId, a, b) : null;
  const sentence = words.length ? `${words[0][0].toUpperCase()}${words[0].slice(1)}${words.length > 1 ? `; ${words.slice(1).join("; ")}` : ""}.` : `${name(b.run)} and ${name(a.run)} used the same inputs, code and environment.`;
  return {
    a: { id: a.run.id, number: a.run.number }, b: { id: b.run.id, number: b.run.number },
    inputs, code: codeWithNumbers, params, environment, steps, keyDiff, words: sentence,
    labels: Object.fromEntries(labelOf),
  };
}

/** D37: the key-set difference of the called rows of the step's first table (a boolean `called` column). */
async function keyDiffOf(stepId: string, a: NonNullable<Awaited<ReturnType<typeof runRecords>>>, b: NonNullable<Awaited<ReturnType<typeof runRecords>>>) {
  const recordA = a.records.get(stepId);
  const recordB = b.records.get(stepId);
  if (!recordA || !recordB) return null;
  const tableOf = (runId: string) => db.exploreArtifact.findFirst({ where: { runId, kind: "table", derivedVersionId: { not: null } }, orderBy: { createdAt: "asc" }, select: { name: true, derivedVersionId: true } });
  const [tableA, tableB] = await Promise.all([tableOf(recordA.stepRunId), tableOf(recordB.stepRunId)]);
  if (!tableA?.derivedVersionId || !tableB?.derivedVersionId || tableA.name !== tableB.name) return null;
  const calledKeys = async (versionId: string): Promise<Set<string> | null> => {
    const version = await db.exploreDatasetVersion.findUnique({ where: { id: versionId }, select: { schema: true, rowCount: true } });
    if (!version || version.rowCount > 500000) return null;
    const schema = parseSchema(version.schema);
    const called = schema.columns.find((column) => column.key === "called" && column.type === "boolean");
    if (!called) return null;
    const idColumn = schema.columns.find((column) => column.key !== "called")?.key;
    const rows = await db.exploreDatasetRow.findMany({ where: { versionId }, select: { key: true, data: true } });
    const keys = new Set<string>();
    for (const row of rows) {
      const data = row.data as Record<string, unknown>;
      if (data.called === true || data.called === "true") keys.add(row.key ?? String(idColumn ? data[idColumn] : ""));
    }
    return keys;
  };
  const [keysA, keysB] = await Promise.all([calledKeys(tableA.derivedVersionId), calledKeys(tableB.derivedVersionId)]);
  if (!keysA || !keysB) return null;
  const added = [...keysB].filter((key) => !keysA.has(key));
  const removed = [...keysA].filter((key) => !keysB.has(key));
  return { stepId, output: tableB.name, added: added.length, removed: removed.length, sample: { added: added.slice(0, 20), removed: removed.slice(0, 20) } };
}
