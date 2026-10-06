/**
 * The recipe of a flow as the server holds it: its steps in order, what each
 * step reads from which other step, the recipe revision, and the state of
 * every step against the flow's current run (FLOW-GAPS D6, D7, D11).
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { codeHashOf, parseInputBindings, type AnalysisInputBinding } from "./analyses";
import { downstreamOf, keyBetween, labelSteps, lineageOrder, sortSteps, spreadKeys } from "./recipe-order";
import { parseJsonObject } from "./schema";

type Client = Prisma.TransactionClient | typeof db;

export interface RecipeRevisionRecord {
  id: string;
  number: number;
  code: string;
  codeHash: string;
  params: string;
  inputs: string;
  fileInputs: string;
  author: string;
  authorUserId: string | null;
  createdAt: Date;
}

export interface RecipeStep {
  id: string;
  name: string;
  description: string | null;
  purpose: string | null;
  kitId: string | null;
  language: string;
  environmentName: string;
  packages: unknown;
  position: string;
  laneKind: string | null;
  laneOf: string | null;
  laneLabel: string | null;
  groupId: string | null;
  paramMeta: unknown;
  methodsSentence: unknown;
  proposedByTurnId: string | null;
  createdAt: Date;
  currentRevisionId: string | null;
  revision: RecipeRevisionRecord | null;
  bindings: AnalysisInputBinding[];
  /** code | pipeline | samples (explore.pipeline-steps); "code" on servers before the migration. */
  stepKind: "code" | "pipeline" | "samples";
  /** A pipeline step's configuration from its current revision (pipeline-steps.ts parses it); null otherwise. */
  pipeline: unknown;
}

export interface DatasetInfo {
  id: string;
  name: string;
  kind: string;
  tableKind: string | null;
  roles: string | null;
  sensitivity: string;
  currentVersionId: string | null;
  producer: string | null;
  artifactName: string | null;
  /** Installed by a reference-resource import (sourceConfig.origin.kind "reference"). */
  reference?: boolean;
  current: { id: string; number: number; contentHash: string; rowCount: number; schema: string; createdAt: Date } | null;
}

export interface RecipeModel {
  flow: {
    id: string;
    targetKey: string;
    name: string;
    description: string | null;
    recipeRevision: number;
    runCounter: number;
    currentRunId: string | null;
    layout: unknown;
    headlineValue: string | null;
    createdById: string;
    createdByMemberId: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  /** Steps in recipe order. */
  steps: RecipeStep[];
  labels: Map<string, string>;
  /** step -> the steps whose tables it reads. */
  upstream: Map<string, Set<string>>;
  datasets: Map<string, DatasetInfo>;
}

const revisionSelect = { id: true, number: true, code: true, codeHash: true, params: true, inputs: true, fileInputs: true, author: true, authorUserId: true, createdAt: true } as const;

/** Which analysis wrote a derived table (its sourceConfig), and under which output name. */
export function producerOfDataset(sourceConfig: string | null, runToAnalysis?: Map<string, string>): { analysisId: string | null; artifactName: string | null } {
  const config = parseJsonObject(sourceConfig) ?? {};
  const analysisId = typeof config.analysisId === "string" ? config.analysisId : typeof config.runId === "string" ? runToAnalysis?.get(config.runId) ?? null : null;
  return { analysisId, artifactName: typeof config.artifactName === "string" ? config.artifactName : null };
}

/** A dataset installed by a reference-resource import: its sourceConfig.origin says kind "reference". */
export function isReferenceImport(sourceConfig: string | null): boolean {
  const origin = parseJsonObject(sourceConfig)?.origin;
  return !!origin && typeof origin === "object" && (origin as Record<string, unknown>).kind === "reference";
}

/** Load a flow's recipe. Positions are backfilled from lineage the first time (C.16). */
export async function loadRecipe(flowId: string, client: Client = db): Promise<RecipeModel | null> {
  const flow = await client.exploreFlow.findUnique({ where: { id: flowId } });
  if (!flow) return null;
  const analyses = await client.exploreAnalysis.findMany({ where: { flowId }, orderBy: { createdAt: "asc" } });
  const revisionIds = analyses.map((analysis) => analysis.currentRevisionId).filter((id): id is string => Boolean(id));
  const revisions = revisionIds.length ? await client.exploreAnalysisRevision.findMany({ where: { id: { in: revisionIds } }, select: revisionSelect }) : [];
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision] as const));
  // stepKind and a revision's pipeline exist only after the pipeline-steps migration: read without naming them, so a
  // client or database from before it still loads every recipe (all steps are code there).
  const kindOf = (analysis: unknown) => { const kind = (analysis as { stepKind?: unknown }).stepKind; return kind === "pipeline" || kind === "samples" ? kind : "code"; };
  const configured = analyses.filter((analysis) => kindOf(analysis) !== "code" && analysis.currentRevisionId).map((analysis) => analysis.currentRevisionId!);
  const pipelineOf = new Map<string, unknown>();
  if (configured.length) {
    for (const revision of await client.exploreAnalysisRevision.findMany({ where: { id: { in: configured } } })) pipelineOf.set(revision.id, (revision as { pipeline?: unknown }).pipeline ?? null);
  }
  const datasets = await client.exploreDataset.findMany({
    where: { targetKey: flow.targetKey },
    select: { id: true, name: true, kind: true, tableKind: true, roles: true, sensitivity: true, currentVersionId: true, sourceConfig: true,
      versions: { orderBy: { number: "desc" }, take: 1, select: { id: true, number: true, contentHash: true, rowCount: true, schema: true, createdAt: true } } },
  });
  const datasetInfo = new Map<string, DatasetInfo>();
  for (const dataset of datasets) {
    const { analysisId, artifactName } = dataset.kind === "derived" ? producerOfDataset(dataset.sourceConfig) : { analysisId: null, artifactName: null };
    datasetInfo.set(dataset.id, {
      id: dataset.id, name: dataset.name, kind: dataset.kind, tableKind: dataset.tableKind, roles: dataset.roles, sensitivity: dataset.sensitivity,
      currentVersionId: dataset.currentVersionId, producer: analysisId, artifactName, current: dataset.versions[0] ?? null,
      ...(isReferenceImport(dataset.sourceConfig) ? { reference: true } : {}),
    });
  }
  // The newest version is not always the current one (a person can pin an older one); read the current explicitly.
  const stale = [...datasetInfo.values()].filter((dataset) => dataset.currentVersionId && dataset.current?.id !== dataset.currentVersionId);
  if (stale.length) {
    const versions = await client.exploreDatasetVersion.findMany({ where: { id: { in: stale.map((dataset) => dataset.currentVersionId!) } }, select: { id: true, number: true, contentHash: true, rowCount: true, schema: true, createdAt: true, datasetId: true } });
    for (const version of versions) {
      const info = datasetInfo.get(version.datasetId);
      if (info) info.current = version;
    }
  }
  const stepIds = new Set(analyses.map((analysis) => analysis.id));
  const steps: RecipeStep[] = analyses.map((analysis) => {
    const revision = analysis.currentRevisionId ? revisionById.get(analysis.currentRevisionId) ?? null : null;
    return {
      id: analysis.id, name: analysis.name, description: analysis.description, purpose: analysis.purpose, kitId: analysis.kitId, language: analysis.language,
      environmentName: analysis.environmentName, packages: analysis.packages, position: analysis.position, laneKind: analysis.laneKind, laneOf: analysis.laneOf, laneLabel: analysis.laneLabel,
      groupId: analysis.groupId, paramMeta: analysis.paramMeta, methodsSentence: analysis.methodsSentence, proposedByTurnId: analysis.proposedByTurnId, createdAt: analysis.createdAt,
      currentRevisionId: analysis.currentRevisionId,
      revision: revision ? { ...revision, codeHash: revision.codeHash || codeHashOf(revision.code) } : null,
      bindings: parseInputBindings(revision?.inputs),
      stepKind: kindOf(analysis),
      pipeline: analysis.currentRevisionId ? pipelineOf.get(analysis.currentRevisionId) ?? null : null,
    };
  });
  const upstream = new Map<string, Set<string>>();
  for (const step of steps) {
    const deps = new Set<string>();
    for (const binding of step.bindings) {
      const producer = datasetInfo.get(binding.datasetId)?.producer;
      if (producer && producer !== step.id && stepIds.has(producer)) deps.add(producer);
    }
    upstream.set(step.id, deps);
  }
  let ordered = sortSteps(steps);
  const unplaced = steps.filter((step) => !step.position);
  if (unplaced.length) {
    // First recipe read of an older flow: order by lineage and keep that order.
    // Steps added later by older clients (no position) go to the end.
    const placed = steps.filter((step) => step.position);
    const fresh = lineageOrder(unplaced, upstream);
    let keys = spreadKeys(fresh.length);
    if (placed.length) {
      let last = sortSteps(placed).at(-1)!.position;
      keys = fresh.map(() => (last = keyBetween(last, null)));
    }
    for (const [index, step] of fresh.entries()) {
      step.position = keys[index];
      await client.exploreAnalysis.update({ where: { id: step.id }, data: { position: step.position } });
    }
    ordered = sortSteps(steps);
  }
  return {
    flow: { id: flow.id, targetKey: flow.targetKey, name: flow.name, description: flow.description, recipeRevision: flow.recipeRevision, runCounter: flow.runCounter,
      currentRunId: flow.currentRunId, layout: flow.layout, headlineValue: flow.headlineValue, createdById: flow.createdById, createdByMemberId: flow.createdByMemberId,
      createdAt: flow.createdAt, updatedAt: flow.updatedAt },
    steps: ordered,
    labels: labelSteps(ordered),
    upstream,
    datasets: datasetInfo,
  };
}

export { bumpRecipeRevision, ensureRecipeRevision, type RecipeActor } from "./recipe-revision";

// ---------------------------------------------------------------------------
// Step state against the current run (D11)
// ---------------------------------------------------------------------------

export type StepState = "current" | "running" | "queued" | "notRun" | "outOfDate" | "failed" | "blocked";
export type StepStateReason = "codeChanged" | "paramChanged" | "inputChanged" | "upstreamChanged" | "bindingLost" | "failed" | null;

/** What one flow run recorded for one step: the step run it executed, or the one it reused. */
export interface StepRecord {
  stepRunId: string;
  revisionId: string;
  status: string;
  inputPins: Array<{ alias: string; datasetId: string; versionId: string }>;
  flowRunId: string;
  flowRunNumber: number | null;
  reusedFrom: { flowRunId: string; number: number | null } | null;
}

export interface StateInput {
  model: RecipeModel;
  /** Per step, its record in the viewed (usually current) run. */
  records: Map<string, StepRecord>;
  /** Params of the revisions the records used, to tell a param change from a code change. */
  revisionsUsed: Map<string, { codeHash: string; params: string }>;
  /** The active run's plan and step statuses, when a run is going. */
  active?: { executing: Set<string>; running: Set<string> } | null;
  /** Steps the newest failed run (newer than the current run) failed at. */
  failedAt?: string | null;
  /** Pipeline steps whose reads in Data changed since the run (pipeline-steps.ts pipelineReadsChanged): step → words. */
  readsChanged?: Map<string, string> | null;
}

export interface StepStateResult {
  state: StepState;
  reason: StepStateReason;
  paramDiff: Array<{ key: string; from: unknown; to: unknown }>;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function paramDiff(fromRaw: string | null | undefined, toRaw: string | null | undefined): Array<{ key: string; from: unknown; to: unknown }> {
  const from = parseJsonObject(fromRaw) ?? {};
  const to = parseJsonObject(toRaw) ?? {};
  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort();
  return keys.filter((key) => !sameJson(from[key], to[key])).map((key) => ({ key, from: from[key] ?? null, to: to[key] ?? null }));
}

/** The state of every step, in recipe order. Out-of-date spreads downstream as `upstreamChanged`. */
export function computeStepStates(input: StateInput): Map<string, StepStateResult> {
  const { model, records, revisionsUsed } = input;
  const states = new Map<string, StepStateResult>();
  const own = new Map<string, StepStateResult>();
  for (const step of model.steps) {
    const record = records.get(step.id);
    const lost = step.bindings.some((binding) => !model.datasets.has(binding.datasetId));
    if (input.active?.running.has(step.id)) { own.set(step.id, { state: "running", reason: null, paramDiff: [] }); continue; }
    if (input.active?.executing.has(step.id)) { own.set(step.id, { state: "queued", reason: null, paramDiff: [] }); continue; }
    if (lost) { own.set(step.id, { state: "blocked", reason: "bindingLost", paramDiff: [] }); continue; }
    if (input.failedAt === step.id) { own.set(step.id, { state: "failed", reason: "failed", paramDiff: [] }); continue; }
    if (!record || record.status !== "completed") { own.set(step.id, { state: "notRun", reason: null, paramDiff: [] }); continue; }
    if (step.revision && record.revisionId !== step.revision.id) {
      const used = revisionsUsed.get(record.revisionId);
      const diff = paramDiff(used?.params, step.revision.params);
      const codeSame = used && used.codeHash === step.revision.codeHash;
      if (codeSame && diff.length === 0) {
        // A new revision with the same code and params (for example re-bound inputs) is judged by its inputs below;
        // one that reads other tables than the run did is out of date at once (also a table an upstream step writes).
        const bound = step.bindings.map((binding) => `${binding.alias}=${binding.datasetId}`).sort().join("|");
        const ran = record.inputPins.map((pin) => `${pin.alias}=${pin.datasetId}`).sort().join("|");
        if (record.inputPins.length && bound !== ran) { own.set(step.id, { state: "outOfDate", reason: "inputChanged", paramDiff: [] }); continue; }
      } else {
        own.set(step.id, { state: "outOfDate", reason: codeSame ? "paramChanged" : "codeChanged", paramDiff: codeSame ? diff : [] });
        continue;
      }
    }
    const pinned = new Map(record.inputPins.map((pin) => [pin.datasetId, pin.versionId] as const));
    const inputChanged = step.bindings.some((binding) => {
      const dataset = model.datasets.get(binding.datasetId);
      const wanted = binding.versionId ?? dataset?.currentVersionId ?? null;
      const was = pinned.get(binding.datasetId);
      // Tables written by an upstream step change with every run of it; that is judged through the upstream step.
      if (dataset?.producer && model.upstream.get(step.id)?.has(dataset.producer)) return false;
      return Boolean(wanted && was && wanted !== was) || (!was && Boolean(wanted));
    });
    // A pipeline step also reads the FASTQ files in Data, which are not tables: new reads make it out of date.
    const readsChanged = !inputChanged && Boolean(input.readsChanged?.has(step.id));
    own.set(step.id, inputChanged || readsChanged ? { state: "outOfDate", reason: "inputChanged", paramDiff: [] } : { state: "current", reason: null, paramDiff: [] });
  }
  const changed = [...own].filter(([, result]) => result.state === "outOfDate" || result.state === "notRun" || result.state === "failed").map(([id]) => id);
  const affected = downstreamOf(changed, model.upstream);
  for (const step of model.steps) {
    const result = own.get(step.id)!;
    if (result.state === "current" && affected.has(step.id)) states.set(step.id, { state: "outOfDate", reason: "upstreamChanged", paramDiff: [] });
    else states.set(step.id, result);
  }
  return states;
}
