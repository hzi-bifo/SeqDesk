/**
 * The recipe as the Flow client reads it (SERVER-API "Recipe"): the flow, the
 * tables it starts from, every step with its number, inputs, outputs,
 * settings with their meaning, state and the viewed run's ledger and values.
 */
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import { codeRegions } from "./code-regions";
import { datasetFitMessage, datasetFitsInput } from "./dataset-kinds";
import { runRecords, revisionsUsedBy, serializeFlowRunById, stepLedger, stepValues, type FlowRunSummary } from "./flow-runs";
import { inputContractSnapshot } from "./input-validation";
import { getKit, type LoadedKit } from "./kits/loader";
import type { KitInput } from "./kits/schema";
import { computeStepStates, loadRecipe, type RecipeModel, type RecipeStep, type StepRecord } from "./recipe";
import { parseJsonObject, parseRoles, parseSchema } from "./schema";

export interface ParamMetaEntry {
  label?: string;
  unit?: string;
  min?: number;
  max?: number;
  usual?: unknown;
  options?: unknown[];
  meaning?: string;
  consequence?: string;
  phrase?: string;
}

export interface RecipeScopeInfo {
  projectId: string;
  visibility: string;
  ownerMemberId: string;
}

export interface RecipeViewOptions {
  runId?: string | null;
  canEdit: boolean;
  scope?: RecipeScopeInfo | null;
  /** Pending proposals, serialized by the proposals store. */
  proposals?: unknown[];
}

const PARAM_META_KEYS = ["label", "unit", "min", "max", "usual", "options", "meaning", "consequence", "phrase"] as const;

/** Param meta from a kit's JSON schema (`x-meaning`, `x-consequence`, `x-usual`, `x-unit`, `x-phrase`). */
export function kitParamMeta(kit: LoadedKit | null): Record<string, ParamMetaEntry> {
  const properties = (kit?.manifest.params?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const meta: Record<string, ParamMetaEntry> = {};
  for (const [key, definition] of Object.entries(properties)) {
    if (!definition || typeof definition !== "object") continue;
    const entry: ParamMetaEntry = {};
    const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
    const label = text(definition.title);
    if (label) entry.label = label;
    const unit = text(definition["x-unit"]);
    if (unit) entry.unit = unit;
    if (typeof definition.minimum === "number") entry.min = definition.minimum;
    if (typeof definition.maximum === "number") entry.max = definition.maximum;
    if (definition["x-usual"] !== undefined) entry.usual = definition["x-usual"];
    else if (definition.default !== undefined) entry.usual = definition.default;
    if (Array.isArray(definition.enum)) entry.options = definition.enum;
    const meaning = text(definition["x-meaning"]) ?? text(definition.description);
    if (meaning) entry.meaning = meaning;
    const consequence = text(definition["x-consequence"]);
    if (consequence) entry.consequence = consequence;
    const phrase = text(definition["x-phrase"]);
    if (phrase) entry.phrase = phrase;
    meta[key] = entry;
  }
  return meta;
}

/** Meaning a person or the assistant gave a step's settings, over the kit's own. */
export function mergeParamMeta(kitMeta: Record<string, ParamMetaEntry>, stored: unknown): Record<string, ParamMetaEntry> {
  const own = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, ParamMetaEntry>) : {};
  const merged: Record<string, ParamMetaEntry> = { ...kitMeta };
  for (const [key, value] of Object.entries(own)) if (value && typeof value === "object") merged[key] = { ...(kitMeta[key] ?? {}), ...value };
  return merged;
}

/** Validate a paramMeta patch: known fields only, short texts. */
export function parseParamMeta(raw: unknown): Record<string, ParamMetaEntry> | null {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw flowError("invalid_request", "paramMeta must be an object keyed by setting.");
  const out: Record<string, ParamMetaEntry> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 100)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(key) || !value || typeof value !== "object" || Array.isArray(value)) throw flowError("invalid_request", `paramMeta.${key} must be an object.`);
    const entry: ParamMetaEntry = {};
    for (const field of PARAM_META_KEYS) {
      const item = (value as Record<string, unknown>)[field];
      if (item === undefined || item === null) continue;
      if (field === "min" || field === "max") {
        if (typeof item !== "number" || !Number.isFinite(item)) throw flowError("invalid_request", `paramMeta.${key}.${field} must be a number.`);
        entry[field] = item;
      } else if (field === "options") {
        if (!Array.isArray(item) || item.length > 50) throw flowError("invalid_request", `paramMeta.${key}.options must be a list.`);
        entry.options = item;
      } else if (field === "usual") {
        entry.usual = item;
      } else {
        if (typeof item !== "string") throw flowError("invalid_request", `paramMeta.${key}.${field} must be text.`);
        entry[field] = item.trim().slice(0, field === "meaning" || field === "consequence" ? 280 : 80);
      }
    }
    out[key] = entry;
  }
  return out;
}

const plural = (count: number, word: string) => `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;

export function dimsOf(rowCount: number, schemaRaw: string | null | undefined): { rows: number; cols: number; dims: string } {
  const schema = parseSchema(schemaRaw ?? null);
  const cols = schema.columns.filter((column) => !column.key.endsWith("_db_id")).length;
  const entity = typeof schema.rowEntity === "string" && schema.rowEntity.trim() ? schema.rowEntity.trim() : "row";
  return { rows: rowCount, cols, dims: `${plural(rowCount, entity)} × ${plural(cols, "column")}` };
}

async function kitsOf(steps: RecipeStep[]): Promise<Map<string, LoadedKit | null>> {
  const kits = new Map<string, LoadedKit | null>();
  for (const id of new Set(steps.map((step) => step.kitId).filter((id): id is string => Boolean(id)))) kits.set(id, await getKit(id).catch(() => null));
  return kits;
}

function contractOf(step: RecipeStep, kit: LoadedKit | null): KitInput[] | null {
  return inputContractSnapshot(step.revision?.inputs) ?? kit?.manifest.inputs ?? null;
}

/** Whether a table fits a step input, in one sentence. */
export function inputCheck(model: RecipeModel, step: RecipeStep, kit: LoadedKit | null, alias: string, datasetId: string): { ok: boolean; sentence: string } {
  const dataset = model.datasets.get(datasetId);
  if (!dataset) return { ok: false, sentence: "The table this step read is gone. Choose another one." };
  const requirement = contractOf(step, kit)?.find((input) => input.alias === alias);
  const producer = dataset.producer ? model.steps.find((candidate) => candidate.id === dataset.producer) : undefined;
  if (!dataset.current) {
    return producer ? { ok: true, sentence: `Fills when step ${model.labels.get(producer.id)} runs.` } : { ok: false, sentence: `${dataset.name} has no rows yet.` };
  }
  if (!requirement) return { ok: true, sentence: `Reads ${dataset.name}.` };
  const fit = datasetFitsInput({ tableKind: dataset.tableKind, roles: parseRoles(dataset.roles), schema: parseSchema(dataset.current.schema) }, requirement);
  return fit.ok ? { ok: true, sentence: `Fits: ${dataset.name} as the ${requirement.label.toLowerCase()}.` } : { ok: false, sentence: `${requirement.label}: ${datasetFitMessage(fit)}` };
}

export async function getRecipeView(flowId: string, options: RecipeViewOptions) {
  const model = await loadRecipe(flowId);
  if (!model) throw flowError("not_found", "Flow not found");
  const flow = await db.exploreFlow.findUnique({ where: { id: flowId }, select: { currentRunId: true } });
  const currentRunId = flow?.currentRunId ?? null;
  const viewedRunId = !options.runId || options.runId === "current" ? currentRunId : options.runId;
  const current = currentRunId ? await runRecords(currentRunId) : null;
  const viewed = viewedRunId && viewedRunId !== currentRunId ? await runRecords(viewedRunId) : current;
  if (options.runId && options.runId !== "current" && (!viewed || viewed.run.flowId !== flowId)) throw flowError("not_found", "Run not found");
  const currentRecords = current?.records ?? new Map<string, StepRecord>();

  // The active run: what it will execute and what is running now.
  const activeRow = await db.exploreFlowRun.findFirst({ where: { flowId, status: { in: ["queued", "running"] } }, orderBy: { createdAt: "desc" } });
  let activeRun: FlowRunSummary | null = null;
  let active: { executing: Set<string>; running: Set<string> } | null = null;
  if (activeRow) {
    activeRun = await serializeFlowRunById(activeRow.id);
    const stepRuns = await db.exploreAnalysisRun.findMany({ where: { flowRunId: activeRow.id }, select: { analysisId: true, status: true } });
    const plan = Array.isArray(activeRow.plan) ? (activeRow.plan as Array<{ analysisId: string; execute: boolean }>) : [];
    const done = new Set(stepRuns.filter((run) => run.status === "completed").map((run) => run.analysisId));
    active = {
      executing: new Set(plan.filter((entry) => entry.execute && !done.has(entry.analysisId)).map((entry) => entry.analysisId)),
      running: new Set(stepRuns.filter((run) => ["pending", "queued", "running"].includes(run.status)).map((run) => run.analysisId)),
    };
  }
  // A failed run newer than the current one marks the step it failed at.
  const currentRow = current?.run ?? null;
  const failedRun = await db.exploreFlowRun.findFirst({ where: { flowId, status: "failed", kind: { not: "trial" }, ...(currentRow ? { createdAt: { gt: currentRow.createdAt } } : {}) }, orderBy: { createdAt: "desc" }, select: { failedAnalysisId: true } });
  const states = computeStepStates({ model, records: currentRecords, revisionsUsed: await revisionsUsedBy(currentRecords), active, failedAt: failedRun?.failedAnalysisId ?? null });

  const kits = await kitsOf(model.steps);
  const stepIds = new Set(model.steps.map((step) => step.id));
  const viewedRecords = viewed?.records ?? new Map<string, StepRecord>();
  const viewedPins = new Map<string, string>();
  for (const record of viewedRecords.values()) for (const pin of record.inputPins) viewedPins.set(pin.datasetId, pin.versionId);

  // Tables the recipe starts from: read by a step, written by none of them.
  const rootIds = [...new Set(model.steps.flatMap((step) => step.bindings.map((binding) => binding.datasetId)))].filter((id) => {
    const producer = model.datasets.get(id)?.producer;
    return !producer || !stepIds.has(producer);
  });
  const pinnedVersionIds = rootIds.map((id) => viewedPins.get(id)).filter((id): id is string => Boolean(id));
  const pinnedVersions = pinnedVersionIds.length ? await db.exploreDatasetVersion.findMany({ where: { id: { in: pinnedVersionIds } }, select: { id: true, number: true, contentHash: true, rowCount: true, schema: true } }) : [];
  const inputs = rootIds.flatMap((id) => {
    const dataset = model.datasets.get(id);
    if (!dataset) return [];
    const pinned = pinnedVersions.find((version) => version.id === viewedPins.get(id));
    const shown = pinned ?? dataset.current;
    if (!shown) return [];
    const dims = dimsOf(shown.rowCount, shown.schema);
    const newer = pinned && dataset.current && dataset.current.id !== pinned.id && dataset.current.number > pinned.number
      ? { versionId: dataset.current.id, version: dataset.current.number, contentHash: dataset.current.contentHash, at: dataset.current.createdAt.toISOString() }
      : null;
    return [{ datasetId: id, name: dataset.name, versionId: shown.id, version: shown.number, contentHash: shown.contentHash, ...dims, sensitivity: dataset.sensitivity,
      usedBy: model.steps.filter((step) => step.bindings.some((binding) => binding.datasetId === id)).map((step) => step.id), newer }];
  });

  const glosses = model.steps.length ? await db.exploreGloss.findMany({ where: { analysisId: { in: model.steps.map((step) => step.id) } }, select: { analysisId: true, regionHash: true, state: true } }) : [];
  const viewedStepRuns = viewed?.stepRuns ?? new Map();
  const derivedOf = (stepId: string) => [...model.datasets.values()].filter((dataset) => dataset.producer === stepId && dataset.artifactName);

  const steps = model.steps.map((step) => {
    const kit = step.kitId ? kits.get(step.kitId) ?? null : null;
    const state = states.get(step.id) ?? { state: "notRun", reason: null, paramDiff: [] };
    const record = viewedRecords.get(step.id);
    const stepRun = record ? viewedStepRuns.get(record.stepRunId) : undefined;
    const params = parseJsonObject(step.revision?.params) ?? {};
    const meta = mergeParamMeta(kitParamMeta(kit), step.paramMeta);
    const regions = new Set(codeRegions(step.revision?.code ?? "").map((region) => region.regionHash));
    const own = glosses.filter((gloss) => gloss.analysisId === step.id);
    const values = stepValues(stepRun?.results);
    const declared = new Map<string, { name: string; kind: string; label: string }>();
    for (const output of kit?.manifest.outputs ?? []) declared.set(`${output.kind}:${output.name}`, { name: output.name, kind: output.kind, label: output.label ?? output.name });
    for (const dataset of derivedOf(step.id)) if (!declared.has(`table:${dataset.artifactName}`)) declared.set(`table:${dataset.artifactName}`, { name: dataset.artifactName!, kind: "table", label: dataset.artifactName! });
    for (const value of values) declared.set(`value:${value.key}`, { name: value.key, kind: "value", label: value.label });
    for (const metric of kit?.manifest.report?.metrics ?? []) if (!declared.has(`value:${metric.key}`)) declared.set(`value:${metric.key}`, { name: metric.key, kind: "value", label: metric.label });
    const notes = (parseJsonObject(stepRun?.results) ?? {}).notes;
    if (Array.isArray(notes) && notes.length) declared.set("finding:notes", { name: "notes", kind: "finding", label: "Notes" });
    return {
      id: step.id,
      label: model.labels.get(step.id) ?? "?",
      position: step.position,
      laneKind: step.laneKind,
      laneOf: step.laneOf,
      laneLabel: step.laneLabel,
      groupId: step.groupId,
      name: step.name,
      purpose: step.purpose,
      description: step.description,
      language: step.language,
      kitId: step.kitId,
      environmentName: step.environmentName,
      revision: step.revision ? { id: step.revision.id, number: step.revision.number, codeHash: step.revision.codeHash, author: step.revision.author, authorUserId: step.revision.authorUserId, createdAt: step.revision.createdAt.toISOString() } : null,
      inputs: step.bindings.map((binding) => {
        const dataset = model.datasets.get(binding.datasetId);
        const producer = dataset?.producer && stepIds.has(dataset.producer) ? dataset.producer : null;
        return {
          alias: binding.alias, name: dataset?.name ?? binding.alias, kind: "table", datasetId: binding.datasetId,
          from: producer ? { stepId: producer, label: model.labels.get(producer) ?? "?", output: dataset?.artifactName ?? null } : null,
          versionId: record?.inputPins.find((pin) => pin.alias === binding.alias)?.versionId ?? null,
          check: inputCheck(model, step, kit, binding.alias, binding.datasetId),
        };
      }),
      fileInputs: (() => { try { return JSON.parse(step.revision?.fileInputs ?? "[]"); } catch { return []; } })(),
      outputs: [...declared.values()],
      params: [...new Set([...Object.keys(params), ...Object.keys(meta)])].map((key) => ({ key, value: params[key] ?? null, label: meta[key]?.label ?? key, unit: meta[key]?.unit ?? null, min: meta[key]?.min ?? null, max: meta[key]?.max ?? null,
        usual: meta[key]?.usual ?? null, options: meta[key]?.options ?? null, meaning: meta[key]?.meaning ?? null, consequence: meta[key]?.consequence ?? null, phrase: meta[key]?.phrase ?? null })),
      paramMeta: step.paramMeta ?? null,
      state: state.state,
      stateReason: state.reason,
      run: record ? {
        flowRunId: record.flowRunId, number: record.flowRunNumber, stepRunId: record.stepRunId, runNumber: stepRun?.runNumber ?? null, status: record.status,
        reusedFrom: record.reusedFrom, durationMs: stepRun?.durationMs ?? null, ledger: stepLedger(stepRun?.results), values, verified: record.status === "completed",
      } : null,
      glossSummary: { count: own.length, pencil: own.filter((gloss) => gloss.state === "pencil").length, stale: own.filter((gloss) => !regions.has(gloss.regionHash)).length },
      methodsSentence: step.methodsSentence ?? null,
      proposedByTurnId: step.proposedByTurnId,
    };
  });

  const outOfDateSteps = model.steps.filter((step) => states.get(step.id)?.state === "outOfDate");
  const first = outOfDateSteps[0];
  const counts = { steps: steps.length, current: 0, notRun: 0, outOfDate: 0, failed: 0, running: 0 };
  for (const step of steps) {
    if (step.state === "current") counts.current += 1;
    else if (step.state === "notRun") counts.notRun += 1;
    else if (step.state === "outOfDate") counts.outOfDate += 1;
    else if (step.state === "failed" || step.state === "blocked") counts.failed += 1;
    else if (step.state === "running" || step.state === "queued") counts.running += 1;
  }
  const flowRecord = await db.exploreFlow.findUnique({ where: { id: flowId }, select: { recipeRevision: true, layout: true, headlineValue: true, createdByMemberId: true, updatedAt: true } });
  // "Run #16 finished · Make current": a completed run newer than the current one that did not take its place.
  const newer = currentRow?.number !== null && currentRow?.number !== undefined
    ? await db.exploreFlowRun.findFirst({ where: { flowId, status: "completed", kind: { not: "trial" }, number: { gt: currentRow.number } }, orderBy: { number: "desc" }, select: { id: true, number: true, completedAt: true } })
    : null;
  const currentHolds = currentRunId ? await db.exploreRunHold.groupBy({ by: ["kind"], where: { flowRunId: currentRunId }, _count: { _all: true } }) : [];
  return {
    flow: {
      id: model.flow.id, name: model.flow.name, description: model.flow.description, targetKey: model.flow.targetKey,
      projectId: options.scope?.projectId ?? "", visibility: options.scope?.visibility ?? "lab", ownerMemberId: options.scope?.ownerMemberId || model.flow.createdByMemberId || "",
      headlineValue: flowRecord?.headlineValue ?? null, recipeRevision: flowRecord?.recipeRevision ?? model.flow.recipeRevision, currentRunId,
      layout: flowRecord?.layout ?? null, createdAt: model.flow.createdAt.toISOString(),
      newerRun: newer ? { id: newer.id, number: newer.number, completedAt: newer.completedAt?.toISOString() ?? null } : null,
      currentHolds: { checks: currentHolds.filter((row) => row.kind === "check").reduce((sum, row) => sum + row._count._all, 0), writer: currentHolds.filter((row) => row.kind === "writer").reduce((sum, row) => sum + row._count._all, 0) }, updatedAt: (flowRecord?.updatedAt ?? model.flow.updatedAt).toISOString(),
    },
    viewedRun: viewed ? { id: viewed.run.id, number: viewed.run.number, status: viewed.run.status, completedAt: viewed.run.completedAt?.toISOString() ?? null } : null,
    activeRun,
    inputs,
    steps,
    proposals: options.proposals ?? [],
    outOfDate: first ? { since: { stepId: first.id, reason: states.get(first.id)?.reason ?? null, paramDiff: states.get(first.id)?.paramDiff ?? [] }, steps: outOfDateSteps.map((step) => step.id) } : null,
    counts,
    canEdit: options.canEdit,
  };
}

export type RecipeView = Awaited<ReturnType<typeof getRecipeView>>;
