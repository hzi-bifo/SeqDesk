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
import { flowInputsProblem } from "./flow-inputs";
import path from "path";
import { parseMetricDefinition, type MetricDefinition } from "./metric-definition";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { readTail } from "@/lib/pipelines/nextflow";
import { flowError } from "@/lib/integration/flow-contract";
import { codeHashOf, parseInputBindings } from "./analyses";
import { pinEnvironment, type EnvironmentPin } from "./environment-lock";
import { Prisma as PrismaValues } from "@prisma/client";
import { resolveReadyEnvironment } from "./environments";
import { condaErrorExcerpt, prepareEnvironmentByName, preparingWords, resolveStepEnvironment } from "./step-environments";
import { failureWords } from "./failure-words";
import { flowRunChanged } from "./flow-events";
import { computeStepStates, ensureRecipeRevision, loadRecipe, paramDiff, type RecipeModel, type StepRecord } from "./recipe";
import { downstreamOf, executionOrder, upstreamOf } from "./recipe-order";
import { parseStoredBlocks } from "./report-blocks";
import { cancelRun, createAndStartRun, ExploreRunError } from "./runner";
import { figureTrialInputs } from "./figure-trial-inputs";
import { readRunIsolation, summarizeIsolation } from "./sandbox/prepare";
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
  /** Extra conda packages of the step: environmentName is then its derived `<base>+<key>` environment. */
  packages?: number;
  language: string;
  execute: boolean;
  dependsOn: string[];
  reusedFrom: { flowRunId: string; number: number | null; stepRunId: string } | null;
  /** Figure trials (figure-trial.ts): the step reads the exact input files this step run read, and runs this code. */
  figureTrial?: { inputsFrom: string; codeOverride: string | null; continualfig: "record" | "style" };
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
  /** What the value counts, with the filters it used (metricMeta.<key>.definition); null when the step gave none. */
  definition: MetricDefinition | null;
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
  /** A step waiting for its environment to build: "Preparing environment · installing 3 packages". */
  preparing?: { analysisId: string; label: string; environment: string; packages: string[]; words: string; log: string | null; since: string } | null;
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
  /** Completed after the current run but not made current, because the current run is held. */
  newer: boolean;
  /** People's marks and Writer references that keep this run in place. */
  holds: { checks: number; writer: number };
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

function resultsOf(raw: string | null | undefined): { metrics?: Record<string, unknown>; metricMeta?: Record<string, { label?: string; unit?: string; definition?: unknown }>; ledger?: unknown[]; notes?: string[] } {
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
  return Object.entries(metrics).slice(0, 100).map(([key, value]) => ({ key, label: meta[key]?.label ?? humanize(key), unit: meta[key]?.unit ?? null, value, definition: parseMetricDefinition(meta[key]?.definition) }));
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

function paramsObject(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try { const value: unknown = JSON.parse(raw); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; }
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

/**
 * The step a failed run newer than the current one stopped at, while that step still has the code and settings it
 * failed with. Once someone changes or reverts the step, the failure no longer describes it: the step is judged
 * against the current run again, so the recipe's status and "Re-run N steps" agree without a full run (B8).
 */
export async function failedStepAfter(flowId: string, currentRun: { createdAt: Date } | null, model: RecipeModel): Promise<string | null> {
  const failed = await db.exploreFlowRun.findFirst({ where: { flowId, status: "failed", kind: { not: "trial" }, ...(currentRun ? { createdAt: { gt: currentRun.createdAt } } : {}) }, orderBy: { createdAt: "desc" }, select: { id: true, failedAnalysisId: true } });
  if (!failed?.failedAnalysisId) return null;
  const stepRun = await db.exploreAnalysisRun.findFirst({ where: { flowRunId: failed.id, analysisId: failed.failedAnalysisId }, orderBy: { createdAt: "desc" }, select: { revisionId: true } });
  const step = model.steps.find((entry) => entry.id === failed.failedAnalysisId);
  if (stepRun && step?.revision && stepRun.revisionId !== step.revision.id) return null;
  return failed.failedAnalysisId;
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
  const inputsProblem = await flowInputsProblem(flowId, model.flow.targetKey);
  if (inputsProblem) throw flowError("invalid_request", inputsProblem);
  const missingRevision = model.steps.find((step) => !step.revision);
  if (missingRevision) throw flowError("invalid_request", `Step ${model.labels.get(missingRevision.id)} has no code yet.`);
  const recipe = await ensureRecipeRevision(flowId, { userId: input.actor.userId, memberId: input.actor.memberId });

  const currentRun = model.flow.currentRunId ? await runRecords(model.flow.currentRunId) : null;
  const current = currentRun?.records ?? new Map<string, StepRecord>();
  // The same states the recipe shows (recipe-view.ts), including a failure that still applies.
  const states = computeStepStates({ model, records: current, revisionsUsed: await revisionsUsedBy(current), failedAt: await failedStepAfter(flowId, currentRun?.run ?? null, model) });
  const trial = Boolean(input.trial);
  const plan = planRun(model, input.scope, current, states);
  const executed = plan.filter((entry) => entry.execute);
  if (!executed.length) throw flowError("invalid_request", "Every step is current. Choose the steps to run again.");

  // Each step's effective environment is fixed now. A step with extra packages uses its derived environment:
  // its build starts here and the step waits for it; a shipped base must already be built.
  const stepPackages = new Map((await db.exploreAnalysis.findMany({ where: { id: { in: executed.map((entry) => entry.analysisId) } }, select: { id: true, packages: true } })).map((row) => [row.id, row.packages] as const));
  for (const entry of executed) {
    const state = await resolveStepEnvironment({ environmentName: entry.environmentName, packages: stepPackages.get(entry.analysisId) });
    if (!state.derived) continue;
    if (state.status === "failed") throw flowError("environment_missing", `Could not build the environment for step ${entry.label}. Change its packages or prepare it again.\n${condaErrorExcerpt(state.error ?? state.log ?? "")}`.trim(), { environment: state.name, step: entry.analysisId });
    entry.environmentName = state.name;
    entry.packages = state.packages.packages.length;
    if (state.status !== "ready") await prepareEnvironmentByName(state.name);
  }
  for (const name of new Set(executed.filter((entry) => !entry.packages).map((entry) => entry.environmentName))) {
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
    if (entry.packages) {
      // Runs never install packages: the step waits while its environment builds, and fails with the conda error.
      const environment = await prepareEnvironmentByName(entry.environmentName);
      if (environment?.status === "failed") {
        await failFlowRun(run, entry, `Could not build the environment for step ${entry.label}.`, condaErrorExcerpt(environment.error ?? environment.log ?? ""));
        return;
      }
      if (environment && environment.status !== "ready") {
        const preparing = { analysisId: entry.analysisId, label: entry.label, environment: entry.environmentName, packages: environment.packages.packages, words: preparingWords(environment), log: environment.log?.split("\n").slice(-6).join("\n") ?? null, since: (run.preparing as { since?: string } | null)?.since ?? new Date().toISOString() };
        if (JSON.stringify(run.preparing) !== JSON.stringify(preparing)) {
          await db.exploreFlowRun.updateMany({ where: { id: run.id, status: { in: ACTIVE_FLOW } }, data: { preparing } });
          await flowRunChanged(run.id, "progress");
        }
        continue;
      }
      if (run.preparing) await db.exploreFlowRun.updateMany({ where: { id: run.id }, data: { preparing: PrismaValues.DbNull } });
      if (!run.environment && entry === executed[0]) {
        const pin = await pinEnvironment(entry.environmentName, entry.language).catch(() => null);
        if (pin) await db.exploreFlowRun.updateMany({ where: { id: run.id }, data: { environment: pin as unknown as Prisma.InputJsonValue } });
      }
    }
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
          fileInputs: entry.figureTrial ? await figureTrialInputs(entry.figureTrial.inputsFrom) : run.kind === "trial" ? await trialFileInputs(entry, plan, latest, model ?? null) : undefined,
          ...(entry.figureTrial ? { codeOverride: entry.figureTrial.codeOverride ?? undefined, continualfig: entry.figureTrial.continualfig } : {}),
          environmentDigest: (run.environment as { lockDigest?: string | null } | null)?.lockDigest ?? null,
          ...(entry.packages ? { environmentName: entry.environmentName } : {}),
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
  // A completed run of the recipe becomes the current one, unless people have marked the
  // current run or the Writer cites its values: then it completes as newer, not current.
  // Trials never become current (D13).
  if (run.kind !== "trial") {
    const flow = await db.exploreFlow.findUnique({ where: { id: run.flowId }, select: { currentRunId: true } });
    const held = flow?.currentRunId && flow.currentRunId !== run.id ? await db.exploreRunHold.count({ where: { flowRunId: flow.currentRunId } }) : 0;
    if (!held) await db.exploreFlow.updateMany({ where: { id: run.flowId, currentRunId: flow?.currentRunId ?? null }, data: { currentRunId: run.id } });
  }
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

export interface AffectedValue {
  ref: string;
  stepId: string;
  metric: string;
  label: string;
  from: unknown;
  to: unknown;
  changed: boolean;
  /** The same value in the new current run, or null when that run has no such value. */
  currentRef: string | null;
}

/** The value a reference names in another run of the same flow (same step and key). */
async function valueIn(runId: string, stepId: string, key: string) {
  const loaded = await runRecords(runId);
  const record = loaded?.records.get(stepId);
  const stepRun = record ? loaded!.stepRuns.get(record.stepRunId) : undefined;
  return stepValues(stepRun?.results).find((value) => value.key === key) ?? null;
}

/**
 * Writer references to a run's values, compared with another run: what a
 * document shows now and what it would show from `toRunId`.
 */
export async function compareWriterValues(fromRunId: string, toRunId: string): Promise<AffectedValue[]> {
  const holds = await db.exploreRunHold.findMany({ where: { flowRunId: fromRunId, kind: "writer" }, orderBy: { createdAt: "asc" } });
  const affected: AffectedValue[] = [];
  for (const hold of holds) {
    const match = /^labdesk:\/\/value\/([^/]+)\/([^/]+)\/(.+)$/.exec(hold.key);
    if (!match || match[1] !== fromRunId) continue;
    const key = decodeURIComponent(match[3]);
    const [before, after] = await Promise.all([valueIn(fromRunId, match[2], key), valueIn(toRunId, match[2], key)]);
    affected.push({ ref: hold.key, stepId: match[2], metric: key, label: after?.label ?? before?.label ?? key, from: before?.value ?? null, to: after?.value ?? null,
      changed: JSON.stringify(before?.value ?? null) !== JSON.stringify(after?.value ?? null), currentRef: after ? `labdesk://value/${toRunId}/${match[2]}/${encodeURIComponent(key)}` : null });
  }
  return affected;
}

/**
 * Make a completed run the current one (a person's choice, so marks and
 * Writer references do not stop it). The answer lists the Writer values that
 * pointed at the previous current run, with the values they would now show.
 */
export async function makeRunCurrent(flowRunId: string): Promise<{ run: FlowRunSummary; flow: { id: string; currentRunId: string; previousRunId: string | null }; affected: AffectedValue[] }> {
  const run = await db.exploreFlowRun.findUnique({ where: { id: flowRunId } });
  if (!run) throw flowError("not_found", "Run not found");
  if (run.status !== "completed" || run.kind === "trial") throw flowError("not_completed", "Only a completed run of the recipe can be the current one.");
  const flow = await db.exploreFlow.findUnique({ where: { id: run.flowId }, select: { currentRunId: true } });
  const previous = flow?.currentRunId && flow.currentRunId !== run.id ? flow.currentRunId : null;
  await db.exploreFlow.update({ where: { id: run.flowId }, data: { currentRunId: run.id } });
  await flowRunChanged(run.id, "current");
  return { run: await serializeFlowRunById(run.id), flow: { id: run.flowId, currentRunId: run.id, previousRunId: previous }, affected: previous ? await compareWriterValues(previous, run.id) : [] };
}

// ---------------------------------------------------------------------------
// Holds: people's marks and Writer references that keep a run current
// ---------------------------------------------------------------------------

export type HoldKind = "check" | "writer";

export async function listHolds(flowRunId: string) {
  const holds = await db.exploreRunHold.findMany({ where: { flowRunId }, orderBy: { createdAt: "asc" } });
  return holds.map((hold) => ({ id: hold.id, kind: hold.kind as HoldKind, key: hold.key, memberId: hold.memberId, createdAt: hold.createdAt.toISOString() }));
}

/** A paper-scoped hold protects a run independently of any one value in it. */
function writerDocumentHoldKey(key: string): boolean {
  if (!key.startsWith("writer:")) return false;
  try {
    const scope: unknown = JSON.parse(key.slice(7));
    return Array.isArray(scope) && scope.length === 2 &&
      scope.every(value => typeof value === "string" && value.trim().length > 0) &&
      key === `writer:${JSON.stringify(scope)}`;
  } catch { return false; }
}

export async function addHold(flowRunId: string, kind: unknown, key: unknown, actor: FlowActor) {
  if (kind !== "check" && kind !== "writer") throw flowError("invalid_request", 'kind must be "check" or "writer".');
  if (typeof key !== "string" || !key.trim() || key.length > 2048) throw flowError("invalid_request", "key must be the check key, value reference or paper key (at most 2,048 characters).");
  const run = await db.exploreFlowRun.findUnique({ where: { id: flowRunId }, select: { status: true, kind: true } });
  if (!run) throw flowError("not_found", "Run not found");
  if (run.kind === "trial") throw flowError("invalid_request", "Trial runs cannot be marked or cited.");
  if (kind === "writer" && !writerDocumentHoldKey(key) && !key.startsWith(`labdesk://value/${flowRunId}/`) && !key.startsWith(`labdesk://output/${flowRunId}/`)) throw flowError("invalid_request", "A Writer hold names a value or output of this run, or a paper scoped to a workspace.");
  const existing = await db.exploreRunHold.findUnique({ where: { flowRunId_kind_key: { flowRunId, kind, key } }, select: { id: true } });
  if (!existing) {
    try {
      await db.exploreRunHold.create({ data: { flowRunId, kind, key, memberId: actor.memberId ?? null, createdById: actor.userId } });
      // A person's mark shows in the flow's conversation as a check turn.
      if (kind === "check") {
        const { appendCheckTurn } = await import("./conversation");
        await appendCheckTurn(flowRunId, key, actor);
      }
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002")) throw error;
    }
  }
  return listHolds(flowRunId);
}

export async function removeHold(flowRunId: string, kind: unknown, key: unknown) {
  if ((kind !== "check" && kind !== "writer") || typeof key !== "string") throw flowError("invalid_request", "Name the hold with kind and key.");
  await db.exploreRunHold.deleteMany({ where: { flowRunId, kind, key } });
  return listHolds(flowRunId);
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
  holds?: Map<string, { checks: number; writer: number }>;
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
    preparing: ACTIVE_FLOW.includes(run.status) ? (run.preparing as FlowRunSummary["preparing"]) ?? null : null,
    headline: summary.headline ?? null,
    failed: run.status === "failed" && run.failedAnalysisId ? { stepId: run.failedAnalysisId, stepLabel: run.failedStepLabel ?? "?", words: run.failureWords ?? "" } : null,
    startedBy: { userId: run.startedById, memberId: run.startedByMemberId, name: run.startedByName },
    current: context.currentRunId === run.id,
    superseded: run.status === "completed" && run.kind !== "trial" && context.currentRunId !== run.id && context.currentNumber !== null && (run.number ?? 0) < context.currentNumber,
    progress: { done: run.doneCount, total: executed.length, current: currentEntry ? { stepId: currentEntry.analysisId, label: currentEntry.label, name: currentEntry.name } : null },
    stepCount: run.stepCount,
    reusedCount: plan.filter((entry) => !entry.execute && entry.reusedFrom).length,
    newer: run.status === "completed" && run.kind !== "trial" && context.currentRunId !== run.id && context.currentNumber !== null && (run.number ?? 0) > context.currentNumber,
    holds: context.holds?.get(run.id) ?? { checks: 0, writer: 0 },
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
  const counted = await db.exploreRunHold.groupBy({ by: ["flowRunId", "kind"], where: { flowRun: { flowId } }, _count: { _all: true } });
  const holds = new Map<string, { checks: number; writer: number }>();
  for (const row of counted) {
    const entry = holds.get(row.flowRunId) ?? { checks: 0, writer: 0 };
    if (row.kind === "writer") entry.writer += row._count._all;
    else entry.checks += row._count._all;
    holds.set(row.flowRunId, entry);
  }
  return { currentRunId: flow?.currentRunId ?? null, currentNumber: current?.number ?? null, holds, headlineValue: flow?.headlineValue ?? null, produced: await producedDatasets(flowId, flow?.targetKey ?? ""), targetKey: flow?.targetKey ?? "" };
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
  const isolations = new Map<string, ReturnType<typeof summarizeIsolation>>();
  await Promise.all([...stepRuns.values()].map(async (stepRun) => { if (stepRun.runFolder) isolations.set(stepRun.id, summarizeIsolation(await readRunIsolation(stepRun.runFolder))); }));
  // The settings each step ran with in this run (its revision's params), so Methods can cite them against the run.
  const used = await revisionsUsedBy(records);
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
      params: record ? paramsObject(used.get(record.revisionId)?.params) : null,
      durationMs: stepRun?.durationMs ?? null,
      startedAt: stepRun?.startedAt?.toISOString() ?? null,
      completedAt: stepRun?.completedAt?.toISOString() ?? null,
      blockedBy,
      ledger: stepLedger(stepRun?.results),
      values: stepValues(stepRun?.results),
      outputs: artifacts.filter((artifact) => artifact.runId === stepRun?.id).map((artifact) => ({ artifactId: artifact.id, name: artifact.name, kind: artifact.kind, format: artifact.format })),
      // How the step ran: "Sandboxed · no network · reads its inputs only".
      isolation: stepRun ? isolations.get(stepRun.id) ?? null : null,
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
