/**
 * Changing a recipe: moving steps, lanes, purposes, groups and the Expert
 * layout (PATCH flows/:id/recipe), adding a step with a fit guard, the step
 * picker's options, and the recipe revision list. Structural changes bump
 * the recipe revision in the same transaction (D6).
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import { createAnalysis, type AnalysisInputBinding, type AnalysisLanguage } from "./analyses";
import { datasetFitMessage, datasetFitsInput } from "./dataset-kinds";
import { getKit, loadKits, type LoadedKit } from "./kits/loader";
import { bumpRecipeRevision, loadRecipe, type RecipeActor, type RecipeModel } from "./recipe";
import { keyBetween, sortSteps } from "./recipe-order";
import { parseRoles, parseSchema } from "./schema";
import { SENSITIVITY_RANK, type ExploreSensitivity } from "./types";

export type RecipeOp =
  | { op: "move"; stepId: string; after: string | null }
  | { op: "lane"; stepId: string; laneKind: "alternative" | "forEach" | null; laneOf: string | null; laneLabel: string | null }
  | { op: "purpose"; stepId: string; text: string | null }
  | { op: "group"; groups: LayoutGroup[] }
  | { op: "layout"; nodes: Record<string, { x: number; y: number }>; groups?: LayoutGroup[]; snap?: boolean }
  | { op: "headline"; value: string | null };

export interface LayoutGroup {
  id: string;
  name: string;
  stepIds: string[];
  collapsed: boolean;
}

const STRUCTURAL = new Set(["move", "lane"]);
const ID = /^[A-Za-z0-9_.-]{1,128}$/;

function text(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw flowError("invalid_request", "Expected text.");
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function parseGroups(raw: unknown): LayoutGroup[] {
  if (!Array.isArray(raw) || raw.length > 100) throw flowError("invalid_request", "groups must be a list.");
  return raw.map((entry) => {
    const group = entry as Record<string, unknown>;
    if (!group || typeof group.id !== "string" || !ID.test(group.id) || !Array.isArray(group.stepIds)) throw flowError("invalid_request", "Each group needs an id and stepIds.");
    return { id: group.id, name: text(group.name, 120) ?? "Group", stepIds: group.stepIds.filter((id): id is string => typeof id === "string").slice(0, 500), collapsed: group.collapsed === true };
  });
}

/** Validate the ops of a PATCH before anything is written. */
export function parseRecipeOps(raw: unknown): RecipeOp[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 200) throw flowError("invalid_request", "ops must be a list of 1 to 200 changes.");
  return raw.map((entry): RecipeOp => {
    const op = entry as Record<string, unknown>;
    switch (op?.op) {
      case "move":
        if (typeof op.stepId !== "string" || (op.after !== null && typeof op.after !== "string")) throw flowError("invalid_request", "move needs stepId and after (a step id or null).");
        return { op: "move", stepId: op.stepId, after: (op.after as string | null) ?? null };
      case "lane": {
        const laneKind = op.laneKind === "alternative" || op.laneKind === "forEach" ? op.laneKind : op.laneKind === null || op.laneKind === undefined ? null : undefined;
        if (typeof op.stepId !== "string" || laneKind === undefined) throw flowError("invalid_request", 'lane needs stepId and laneKind "alternative", "forEach" or null.');
        if (laneKind && typeof op.laneOf !== "string") throw flowError("invalid_request", "A lane needs laneOf, the step it runs beside.");
        return { op: "lane", stepId: op.stepId, laneKind, laneOf: laneKind ? (op.laneOf as string) : null, laneLabel: laneKind ? text(op.laneLabel, 80) : null };
      }
      case "purpose":
        if (typeof op.stepId !== "string") throw flowError("invalid_request", "purpose needs stepId.");
        return { op: "purpose", stepId: op.stepId, text: text(op.text, 200) };
      case "group":
        return { op: "group", groups: parseGroups(op.groups) };
      case "layout": {
        const nodes: Record<string, { x: number; y: number }> = {};
        const raw = op.nodes && typeof op.nodes === "object" && !Array.isArray(op.nodes) ? (op.nodes as Record<string, unknown>) : null;
        if (!raw) throw flowError("invalid_request", "layout needs nodes.");
        for (const [id, position] of Object.entries(raw).slice(0, 2000)) {
          const point = position as { x?: unknown; y?: unknown };
          if (!ID.test(id) || typeof point?.x !== "number" || typeof point?.y !== "number" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw flowError("invalid_request", `layout.nodes.${id} needs numbers x and y.`);
          nodes[id] = { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 };
        }
        return { op: "layout", nodes, ...(op.groups !== undefined ? { groups: parseGroups(op.groups) } : {}), ...(typeof op.snap === "boolean" ? { snap: op.snap } : {}) };
      }
      case "headline":
        if (op.value !== null && (typeof op.value !== "string" || !/^[A-Za-z0-9_.-]{1,80}\.[^\s]{1,120}$/.test(op.value))) throw flowError("invalid_request", 'headline value must be "<stepId>.<metric>" or null.');
        return { op: "headline", value: (op.value as string | null) ?? null };
      default:
        throw flowError("invalid_request", `Unknown recipe change: ${String(op?.op)}`);
    }
  });
}

type Layout = { nodes: Record<string, { x: number; y: number }>; groups: LayoutGroup[]; snap: boolean };
function layoutOf(raw: Prisma.JsonValue | null | undefined): Layout {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    nodes: value.nodes && typeof value.nodes === "object" && !Array.isArray(value.nodes) ? (value.nodes as Layout["nodes"]) : {},
    groups: Array.isArray(value.groups) ? (value.groups as LayoutGroup[]) : [],
    snap: value.snap !== false,
  };
}

/**
 * The words for a step that would come before a step it reads from, or null.
 * Lanes are exempt: they are placed beside their anchor, not in the line.
 */
export function bindingLostCheck(model: Pick<RecipeModel, "labels" | "upstream">, order: Array<{ id: string; name: string }>): { stepId: string; producerId: string; words: string } | null {
  const index = new Map(order.map((step, position) => [step.id, position] as const));
  for (const step of order) {
    for (const producer of model.upstream.get(step.id) ?? []) {
      if ((index.get(producer) ?? -1) > (index.get(step.id) ?? 0)) {
        const producerStep = order.find((candidate) => candidate.id === producer);
        return { stepId: step.id, producerId: producer, words: `${step.name} reads the table ${producerStep?.name ?? "another step"} writes, so it cannot come before it.` };
      }
    }
  }
  return null;
}

export async function applyRecipeOps(flowId: string, ops: RecipeOp[], expectedRevision: number | undefined, actor: RecipeActor): Promise<void> {
  const structural = ops.some((op) => STRUCTURAL.has(op.op));
  if (structural && expectedRevision === undefined) throw flowError("invalid_request", "expectedRevision is required when moving steps or changing lanes.");
  const model = await loadRecipe(flowId);
  if (!model) throw flowError("not_found", "Flow not found");
  if (expectedRevision !== undefined && expectedRevision !== model.flow.recipeRevision) throw flowError("revision_conflict", "The recipe changed since you opened it.", { current: { recipeRevision: model.flow.recipeRevision } });
  const ids = new Set(model.steps.map((step) => step.id));
  const requireStep = (id: string) => { if (!ids.has(id)) throw flowError("invalid_request", "That step is not part of this flow."); };

  // Work on a copy of the order; positions are recomputed only for moved steps.
  const steps = model.steps.map((step) => ({ id: step.id, name: step.name, position: step.position, createdAt: step.createdAt, laneKind: step.laneKind, laneOf: step.laneOf, laneLabel: step.laneLabel }));
  const changes = new Map<string, Prisma.ExploreAnalysisUpdateInput>();
  const change = (id: string, data: Prisma.ExploreAnalysisUpdateInput) => changes.set(id, { ...(changes.get(id) ?? {}), ...data });
  const flowData: Prisma.ExploreFlowUpdateInput = {};
  let layout: Layout | null = null;
  const messages: string[] = [];

  for (const op of ops) {
    if (op.op === "move") {
      requireStep(op.stepId);
      if (op.after) requireStep(op.after);
      if (op.after === op.stepId) continue;
      const others = sortSteps(steps.filter((step) => step.id !== op.stepId));
      const afterIndex = op.after ? others.findIndex((step) => step.id === op.after) : -1;
      const before = afterIndex >= 0 ? others[afterIndex].position : "";
      const next = others[afterIndex + 1]?.position ?? null;
      const position = keyBetween(before, next && next > before ? next : null);
      const moved = steps.find((step) => step.id === op.stepId)!;
      moved.position = position;
      change(op.stepId, { position });
      messages.push(`Moved ${moved.name}`);
    } else if (op.op === "lane") {
      requireStep(op.stepId);
      if (op.laneOf) {
        requireStep(op.laneOf);
        if (op.laneOf === op.stepId) throw flowError("invalid_request", "A step cannot be a lane of itself.");
      }
      const target = steps.find((step) => step.id === op.stepId)!;
      Object.assign(target, { laneKind: op.laneKind, laneOf: op.laneOf, laneLabel: op.laneLabel });
      change(op.stepId, { laneKind: op.laneKind, laneOf: op.laneOf, laneLabel: op.laneLabel });
      messages.push(op.laneKind ? `${target.name} runs ${op.laneKind === "forEach" ? "for each" : "as an alternative"}` : `${target.name} back on the main lane`);
    } else if (op.op === "purpose") {
      requireStep(op.stepId);
      change(op.stepId, { purpose: op.text });
    } else if (op.op === "group") {
      layout = layout ?? layoutOf(model.flow.layout as Prisma.JsonValue);
      layout.groups = op.groups.map((group) => ({ ...group, stepIds: group.stepIds.filter((id) => ids.has(id)) }));
      for (const step of steps) change(step.id, { groupId: layout.groups.find((group) => group.stepIds.includes(step.id))?.id ?? null });
    } else if (op.op === "layout") {
      layout = layout ?? layoutOf(model.flow.layout as Prisma.JsonValue);
      layout.nodes = { ...layout.nodes, ...op.nodes };
      if (op.groups) {
        layout.groups = op.groups;
        for (const step of steps) change(step.id, { groupId: op.groups.find((group) => group.stepIds.includes(step.id))?.id ?? null });
      }
      if (op.snap !== undefined) layout.snap = op.snap;
    } else if (op.op === "headline") {
      if (op.value && !ids.has(op.value.split(".")[0])) throw flowError("invalid_request", "The headline value must name a step of this flow.");
      flowData.headlineValue = op.value;
    }
  }

  if (structural) {
    const mainLane = sortSteps(steps).filter((step) => !(step.laneKind && step.laneOf && ids.has(step.laneOf)));
    const lost = bindingLostCheck(model, mainLane);
    if (lost) throw flowError("binding_lost", lost.words, { stepId: lost.stepId, words: lost.words, fix: { stepId: lost.stepId, after: lost.producerId } });
  }

  await db.$transaction(async (tx) => {
    for (const [id, data] of changes) await tx.exploreAnalysis.update({ where: { id }, data });
    if (layout) flowData.layout = layout as unknown as Prisma.InputJsonValue;
    if (Object.keys(flowData).length) await tx.exploreFlow.update({ where: { id: flowId }, data: flowData });
    if (structural) {
      const bumped = await bumpRecipeRevision(tx, flowId, actor, messages.join("; ") || "Recipe changed", expectedRevision);
      if (bumped === null) {
        const current = await tx.exploreFlow.findUnique({ where: { id: flowId }, select: { recipeRevision: true } });
        throw flowError("revision_conflict", "The recipe changed since you opened it.", { current: { recipeRevision: current?.recipeRevision ?? null } });
      }
    }
  });
}

export async function listRecipeRevisions(flowId: string) {
  const revisions = await db.exploreFlowRevision.findMany({ where: { flowId }, orderBy: { number: "desc" }, take: 200 });
  return revisions.map((revision) => ({ number: revision.number, message: revision.message, steps: revision.steps, createdById: revision.createdById, createdByMemberId: revision.createdByMemberId, createdAt: revision.createdAt.toISOString() }));
}

// ---------------------------------------------------------------------------
// Outputs a later step can read before the step that writes them has run
// ---------------------------------------------------------------------------

const OUTPUT_NAME = /^[A-Za-z0-9._-]{1,80}$/;

/**
 * The table a step writes under an output name. When the step has not run
 * yet it is created empty (no version); the step's first run fills it, since
 * the runner writes to the dataset of that analysis and output name.
 */
export async function ensureOutputDataset(model: RecipeModel, stepId: string, output: string, userId: string): Promise<string> {
  const step = model.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw flowError("invalid_request", "That step is not part of this flow.");
  if (!OUTPUT_NAME.test(output)) throw flowError("invalid_request", "Output names are letters, digits, dots, dashes and underscores.");
  const existing = [...model.datasets.values()].find((dataset) => dataset.producer === stepId && dataset.artifactName === output);
  if (existing) return existing.id;
  if (step.kitId) {
    const kit = await getKit(step.kitId);
    if (kit && !kit.manifest.outputs.some((entry) => entry.kind === "table" && entry.name === output)) {
      throw flowError("output_not_ready", `Step ${model.labels.get(stepId)} does not write a table called ${output}.`, { stepId, output });
    }
  }
  // The output is as sensitive as the most sensitive table the step reads.
  let sensitivity: ExploreSensitivity = "standard";
  for (const binding of step.bindings) {
    const candidate = (model.datasets.get(binding.datasetId)?.sensitivity ?? "standard") as ExploreSensitivity;
    if ((SENSITIVITY_RANK[candidate] ?? 0) > SENSITIVITY_RANK[sensitivity]) sensitivity = candidate;
  }
  const kit = step.kitId ? await getKit(step.kitId) : null;
  const declared = kit?.manifest.outputs.find((entry) => entry.name === output);
  const dataset = await db.exploreDataset.create({
    data: {
      targetKey: model.flow.targetKey, kind: "derived", tableKind: declared?.tableKind ?? null, name: `${output} (${step.name})`,
      description: `Written by step ${step.name} when it runs.`, sensitivity, createdById: userId,
      sourceConfig: JSON.stringify({ builder: "analysis-run", analysisId: stepId, artifactName: output }),
    },
  });
  model.datasets.set(dataset.id, { id: dataset.id, name: dataset.name, kind: "derived", tableKind: dataset.tableKind, roles: null, sensitivity, currentVersionId: null, producer: stepId, artifactName: output, current: null });
  return dataset.id;
}

// ---------------------------------------------------------------------------
// Adding a step
// ---------------------------------------------------------------------------

export interface AddStepInput {
  after?: string | null;
  laneOf?: string | null;
  laneKind?: "alternative" | "forEach" | null;
  laneLabel?: string | null;
  name?: string | null;
  purpose?: string | null;
  kitId?: string | null;
  code?: string | null;
  language?: AnalysisLanguage;
  inputs: Array<{ alias: string; datasetId?: string; from?: { stepId: string; output: string } }>;
  params?: Record<string, unknown>;
  requestId?: string;
  actor: RecipeActor;
}

/** Whether each chosen table fits the kit's inputs; the first misfit as a 422 with a fix when one exists. */
export function checkKitFit(model: RecipeModel, kit: LoadedKit, bindings: AnalysisInputBinding[], fromStep: Map<string, string>): void {
  for (const binding of bindings) {
    const requirement = kit.manifest.inputs.find((input) => input.alias === binding.alias);
    if (!requirement) throw flowError("incompatible", `${kit.manifest.name} has no input called ${binding.alias}.`, { words: `${kit.manifest.name} has no input called ${binding.alias}.` });
    const dataset = model.datasets.get(binding.datasetId);
    if (!dataset) throw flowError("invalid_request", `The table for ${binding.alias} is not in this study.`);
    if (!dataset.current) {
      // Not written yet: judge by the table kind the upstream step declares.
      if (requirement.tableKind && dataset.tableKind && dataset.tableKind !== requirement.tableKind) {
        const words = `${requirement.label}: ${datasetFitMessage({ ok: false, reason: "table-kind", tableKind: requirement.tableKind })}`;
        throw flowError("incompatible", words, { words, fix: fromStep.has(binding.alias) ? { stepId: fromStep.get(binding.alias), output: dataset.artifactName } : undefined });
      }
      continue;
    }
    const fit = datasetFitsInput({ tableKind: dataset.tableKind, roles: parseRoles(dataset.roles), schema: parseSchema(dataset.current.schema) }, requirement);
    if (!fit.ok) {
      const words = `${requirement.label}: ${datasetFitMessage(fit)}`;
      throw flowError("incompatible", words, { words, fix: fromStep.has(binding.alias) ? { stepId: fromStep.get(binding.alias), output: dataset.artifactName } : undefined });
    }
  }
  for (const input of kit.manifest.inputs) {
    if (!input.optional && !bindings.some((binding) => binding.alias === input.alias)) {
      const words = `${kit.manifest.name} needs a ${input.label.toLowerCase()} table.`;
      throw flowError("incompatible", words, { words });
    }
  }
}

export async function addStep(flowId: string, input: AddStepInput): Promise<string> {
  if (input.requestId) {
    const existing = await db.exploreAnalysis.findUnique({ where: { id: input.requestId }, select: { id: true, flowId: true } });
    if (existing) {
      if (existing.flowId !== flowId) throw flowError("invalid_request", "This request ID belongs to another step.");
      return existing.id;
    }
  }
  const model = await loadRecipe(flowId);
  if (!model) throw flowError("not_found", "Flow not found");
  const ids = new Set(model.steps.map((step) => step.id));
  if (input.after && !ids.has(input.after)) throw flowError("invalid_request", "after must name a step of this flow.");
  if (input.laneOf && !ids.has(input.laneOf)) throw flowError("invalid_request", "laneOf must name a step of this flow.");
  if (!input.kitId && (typeof input.code !== "string" || !input.code.trim())) throw flowError("invalid_request", "A new step needs a kitId or code.");

  const kit = input.kitId ? await getKit(input.kitId) : null;
  if (input.kitId && !kit) throw flowError("invalid_request", `Unknown kit: ${input.kitId}`);
  const bindings: AnalysisInputBinding[] = [];
  const fromStep = new Map<string, string>();
  const aliases = new Set<string>();
  for (const entry of input.inputs) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(entry.alias) || aliases.has(entry.alias)) throw flowError("invalid_request", "Each input needs a unique snake_case alias.");
    aliases.add(entry.alias);
    let datasetId = entry.datasetId ?? "";
    if (entry.from) {
      datasetId = await ensureOutputDataset(model, entry.from.stepId, entry.from.output, input.actor.userId);
      fromStep.set(entry.alias, entry.from.stepId);
    }
    const dataset = model.datasets.get(datasetId);
    if (!dataset) throw flowError("invalid_request", `The table for ${entry.alias} is not in this study.`);
    bindings.push({ alias: entry.alias, datasetId, versionId: null });
  }
  if (kit) checkKitFit(model, kit, bindings, fromStep);

  // Placement: after a step, beside a step (its lane), or at the end.
  const ordered = sortSteps(model.steps);
  let position: string;
  if (input.laneOf) {
    const lane = ordered.filter((step) => step.id === input.laneOf || step.laneOf === input.laneOf);
    const last = lane.at(-1)!;
    const next = ordered[ordered.indexOf(last) + 1];
    position = keyBetween(last.position, next?.position ?? null);
  } else if (input.after) {
    const index = ordered.findIndex((step) => step.id === input.after);
    position = keyBetween(ordered[index].position, ordered[index + 1]?.position ?? null);
  } else {
    position = keyBetween(ordered.at(-1)?.position ?? "", null);
  }
  const analysis = await createAnalysis({
    targetKey: model.flow.targetKey, flowId, name: input.name ?? null, kitId: input.kitId ?? null, language: input.language, inputs: bindings,
    params: input.params, createdById: input.actor.userId, createdByMemberId: input.actor.memberId ?? null, position,
    laneKind: input.laneOf ? input.laneKind ?? "alternative" : null, laneOf: input.laneOf ?? null, laneLabel: input.laneOf ? input.laneLabel ?? null : null,
    purpose: input.purpose ?? null, id: input.requestId, code: input.kitId ? undefined : input.code ?? undefined,
  });
  return analysis.id;
}

// ---------------------------------------------------------------------------
// The step picker
// ---------------------------------------------------------------------------

export async function stepOptions(flowId: string, query: { after?: string | null; output?: string | null; dataset?: string | null }) {
  const model = await loadRecipe(flowId);
  if (!model) throw flowError("not_found", "Flow not found");
  let sources: Array<{ stepId: string | null; output: string | null; datasetId: string }> = [];
  if (query.dataset) {
    // A first step reading a Data table of the study (a blank analysis's added table).
    if (!model.datasets.has(query.dataset)) throw flowError("invalid_request", "Choose a table in this study’s Data.");
    sources = [{ stepId: null, output: null, datasetId: query.dataset }];
  } else if (query.output) {
    const [stepId, ...rest] = query.output.split(".");
    const output = rest.join(".");
    const dataset = [...model.datasets.values()].find((candidate) => candidate.producer === stepId && candidate.artifactName === output);
    if (!dataset) throw flowError("output_not_ready", `Step ${model.labels.get(stepId) ?? "?"} has no table called ${output} yet.`, { stepId, output });
    sources = [{ stepId, output, datasetId: dataset.id }];
  } else if (query.after) {
    if (!model.steps.some((step) => step.id === query.after)) throw flowError("invalid_request", "after must name a step of this flow.");
    sources = [...model.datasets.values()].filter((dataset) => dataset.producer === query.after).map((dataset) => ({ stepId: query.after!, output: dataset.artifactName, datasetId: dataset.id }));
  } else {
    const stepIds = new Set(model.steps.map((step) => step.id));
    const roots = new Set(model.steps.flatMap((step) => step.bindings.map((binding) => binding.datasetId)).filter((id) => !stepIds.has(model.datasets.get(id)?.producer ?? "")));
    sources = [...roots].map((datasetId) => ({ stepId: null, output: null, datasetId }));
  }
  const { kits } = await loadKits();
  const fits: Array<{ kitId: string; name: string; kind: "kit"; reads: string; datasetId: string; words: string }> = [];
  const needsOther: Array<{ kitId: string; name: string; words: string }> = [];
  const warnings: Array<{ kitId: string; words: string }> = [];
  for (const kit of kits) {
    let placed = false;
    for (const source of sources) {
      const dataset = model.datasets.get(source.datasetId);
      if (!dataset) continue;
      const fitting = kit.manifest.inputs.find((input) => {
        // Not written yet: only the table kind the upstream step declares is known.
        if (!dataset.current) return input.tableKind ? dataset.tableKind === input.tableKind : input.requiredRoles.length === 0;
        return datasetFitsInput({ tableKind: dataset.tableKind, roles: parseRoles(dataset.roles), schema: parseSchema(dataset.current.schema) }, input).ok;
      });
      if (!fitting) continue;
      const others = kit.manifest.inputs.filter((input) => input.alias !== fitting.alias && !input.optional);
      if (others.length) needsOther.push({ kitId: kit.manifest.id, name: kit.manifest.name, words: `Needs a ${others.map((input) => input.label.toLowerCase()).join(" and a ")} table too.` });
      else fits.push({ kitId: kit.manifest.id, name: kit.manifest.name, kind: "kit", reads: fitting.alias, datasetId: dataset.id, words: `Reads ${dataset.name} as its ${fitting.label.toLowerCase()}.` });
      placed = true;
      break;
    }
    if (placed) for (const words of kit.manifest.warnings ?? []) warnings.push({ kitId: kit.manifest.id, words });
  }
  const { listTemplates } = await import("./templates");
  return {
    source: sources.length === 1 ? sources[0] : null,
    fits,
    needsOther,
    warnings,
    templates: (await listTemplates()).map((template) => ({ id: template.id, name: template.name, description: template.description })),
  };
}
