/**
 * Flow templates (FLOW-GAPS D33): a small recipe a person starts a flow from
 * by picking a table and answering the slot questions. They live in
 * explore/templates/<id>/template.json with the step code next to them.
 */
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { flowError } from "@/lib/integration/flow-contract";
import { createAnalysis } from "./analyses";
import { createFlow } from "./flows";
import { getDatasetRecord } from "./datasets";
import { db } from "@/lib/db";
import { ensureOutputDataset } from "./recipe-edit";
import { loadRecipe, type RecipeActor } from "./recipe";
import { parseSchema } from "./schema";
import { checkDataset, clearFlowInputs, InputCheckSchema, saveFlowInput, type CheckResult, type InputCheck } from "./flow-inputs";
import { ColumnRoleSchema, fillColumnParams, resolveColumns, roleColumns, rolesLine, type Resolution, type TableFacts } from "./template-columns";

const SlotSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  question: z.string().min(1).max(200),
  role: z.string().max(40).optional(),
  kind: z.enum(["column", "columns", "table"]),
}).strict();

/** A named Data table the template reads (counts, samples); the person maps one of their tables to it. */
const TemplateInputSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().min(1).max(80),
  expects: z.string().min(1).max(300),
  check: InputCheckSchema,
}).strict();

const TemplateStepSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  name: z.string().min(1).max(200),
  purpose: z.string().max(200).optional(),
  language: z.enum(["python", "r", "shell"]).default("python"),
  codeFile: z.string().min(1).max(200).optional(),
  kitId: z.string().min(1).max(80).optional(),
  params: z.record(z.string(), z.unknown()).default({}),
  paramMeta: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  inputs: z.array(z.union([
    z.object({ alias: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), source: z.literal("dataset") }).strict(),
    z.object({ alias: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), input: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/) }).strict(),
    z.object({ alias: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), from: z.object({ step: z.string(), output: z.string() }).strict() }).strict(),
  ])).min(1),
  outputs: z.array(z.object({ name: z.string(), kind: z.enum(["table", "figure", "value", "finding", "report"]) }).strict()).default([]),
  packages: z.array(z.string().min(1).max(120)).max(40).default([]),
}).strict().refine((step) => Boolean(step.codeFile) !== Boolean(step.kitId), { message: "A template step needs codeFile or kitId" });

export const TemplateSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  slots: z.array(SlotSchema).max(20).default([]),
  /** Named Data inputs; a template without them reads the one table the person picks (source: "dataset"). */
  inputs: z.array(TemplateInputSchema).max(10).default([]),
  /** The columns each input's steps need, by role (sample id, condition and its levels, pairing); guessed per table,
   *  changeable in the mapping, written into the step params through {{role}} and {{role.level}}. */
  columns: z.array(ColumnRoleSchema).max(20).default([]),
  steps: z.array(TemplateStepSchema).min(1).max(30),
}).strict();

export type FlowTemplate = z.infer<typeof TemplateSchema> & { dir: string };

export function getTemplatesDir(): string {
  const override = process.env.SEQDESK_EXPLORE_TEMPLATES_DIR?.trim();
  return override ? path.resolve(override) : path.join(process.cwd(), "explore", "templates");
}

export async function listTemplates(): Promise<FlowTemplate[]> {
  const root = getTemplatesDir();
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const templates: FlowTemplate[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(root, entry.name, "template.json"), "utf8"));
      templates.push({ ...TemplateSchema.parse(raw), dir: path.join(root, entry.name) });
    } catch (error) {
      console.error("[flow] skipped an invalid template", entry.name, error instanceof Error ? error.message : error);
    }
  }
  return templates;
}

export function serializeTemplate(template: FlowTemplate) {
  return {
    id: template.id, name: template.name, description: template.description, slots: template.slots,
    inputs: template.inputs.map((input) => ({ key: input.key, label: input.label, expects: input.expects, kind: input.check.kind, columns: input.check.columns })),
    columns: template.columns.map((role) => ({ key: role.key, input: role.input, label: role.label, kind: role.kind, optional: role.optional, hint: role.hint ?? null, levels: role.levels.map((level) => ({ key: level.key, label: level.label, reference: level.reference })) })),
    steps: template.steps.map((step) => ({ name: step.name, purpose: step.purpose ?? null, language: step.language, packages: step.packages, params: step.params })),
  };
}

type SlotValues = Record<string, string | string[]>;

/** `{{slot}}` becomes the chosen column(s); `{{a+b}}` joins column lists. */
export function fillParams(params: Record<string, unknown>, slots: SlotValues): Record<string, unknown> {
  const fill = (value: unknown): unknown => {
    if (typeof value === "string") {
      const match = /^\{\{([a-z_][a-z0-9_]*(?:\+[a-z_][a-z0-9_]*)*)\}\}$/.exec(value);
      if (!match) return value;
      const parts = match[1].split("+").map((key) => {
        if (!(key in slots)) throw flowError("invalid_request", `The template needs an answer for ${key}.`);
        return slots[key];
      });
      return parts.length === 1 ? parts[0] : parts.flatMap((part) => (Array.isArray(part) ? part : [part]));
    }
    if (Array.isArray(value)) return value.map(fill);
    return value;
  };
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, fill(value)]));
}

/** The answers, checked against the chosen table's columns. */
export function checkSlots(template: FlowTemplate, raw: unknown, columns: string[]): SlotValues {
  const given = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const known = new Set(columns);
  const out: SlotValues = {};
  for (const slot of template.slots) {
    const value = given[slot.key];
    if (slot.kind === "column") {
      if (typeof value !== "string" || !known.has(value)) throw flowError("invalid_request", `${slot.question} Choose one column of the table.`);
      out[slot.key] = value;
    } else if (slot.kind === "columns") {
      if (!Array.isArray(value) || !value.length || !value.every((entry) => typeof entry === "string" && known.has(entry))) throw flowError("invalid_request", `${slot.question} Choose columns of the table.`);
      out[slot.key] = [...new Set(value as string[])];
    }
  }
  return out;
}

/** A mapped table's columns and rows, for guessing and checking the column roles (counts: the columns only). */
async function tableFacts(datasetId: string, targetKey: string, withRows: boolean): Promise<TableFacts | null> {
  const dataset = await db.exploreDataset.findUnique({ where: { id: datasetId }, select: { targetKey: true, currentVersionId: true } });
  if (!dataset || dataset.targetKey !== targetKey || !dataset.currentVersionId) return null;
  const version = await db.exploreDatasetVersion.findUnique({ where: { id: dataset.currentVersionId }, select: { schema: true } });
  if (!version) return null;
  const rows = withRows ? await db.exploreDatasetRow.findMany({ where: { versionId: dataset.currentVersionId }, orderBy: { rowIndex: "asc" }, take: 5000, select: { data: true } }) : [];
  return { columns: parseSchema(version.schema).columns.map((column) => ({ key: column.key, type: column.type })), rows: rows.map((row) => (row.data ?? {}) as Record<string, unknown>) };
}

/** Guess or take the column roles for the mapped tables (see template-columns.ts). */
async function resolveTemplateColumns(template: FlowTemplate, targetKey: string, given: Record<string, string | null>, choices: unknown): Promise<Resolution> {
  const tables: Record<string, TableFacts | null> = {};
  for (const input of template.inputs) {
    const datasetId = given[input.key];
    tables[input.key] = datasetId ? await tableFacts(datasetId, targetKey, input.check.kind !== "counts") : null;
  }
  return resolveColumns(template.columns, tables, choicesOf(choices));
}

function choicesOf(raw: unknown): Record<string, string> {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(Object.entries(value).filter(([key, choice]) => /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/.test(key) && typeof choice === "string" && choice.length <= 200) as Array<[string, string]>);
}

/** The check of one input with its roles' columns in place of the example's names. */
function inputCheck(template: FlowTemplate, key: string, resolution: Resolution): InputCheck {
  const input = template.inputs.find((candidate) => candidate.key === key)!;
  if (!template.columns.some((role) => role.input === key)) return input.check;
  return { kind: input.check.kind, columns: roleColumns(resolution.roles, key) };
}

/**
 * The type check of each mapped table ("a count matrix, whole numbers ✓"; unmapped inputs have no result), and the
 * column roles: each role's column (given, or guessed), its options, the chosen levels and plain-sentence problems.
 */
export async function checkTemplateInputs(input: { targetKey: string; templateId: string; datasets: unknown; columns?: unknown }) {
  const template = (await listTemplates()).find((candidate) => candidate.id === input.templateId);
  if (!template) throw flowError("not_found", "Template not found");
  const given = mappingOf(input.datasets);
  const resolution = await resolveTemplateColumns(template, input.targetKey, given, input.columns);
  const inputs = await Promise.all(template.inputs.map(async (slot) => ({
    key: slot.key, datasetId: given[slot.key] ?? null,
    result: given[slot.key] ? await checkDataset(inputCheck(template, slot.key, resolution), given[slot.key]!, input.targetKey) : null,
    roles: given[slot.key] ? rolesLine(resolution.roles, slot.key) : null,
  })));
  const mapped = new Set(Object.entries(given).filter(([, id]) => id).map(([key]) => key));
  return { inputs, columns: { roles: resolution.roles, values: resolution.values, problems: problemsFor(template, resolution, mapped) } };
}

/** Problems of the roles whose tables are mapped (an open input has nothing to check yet). */
function problemsFor(template: FlowTemplate, resolution: Resolution, mapped: Set<string>): string[] {
  const open = template.inputs.filter((input) => !mapped.has(input.key)).map((input) => input.key);
  if (!open.length) return resolution.problems;
  const unmappedLabels = resolution.roles.filter((role) => open.includes(role.input)).map((role) => `Choose the ${role.label.toLowerCase()} column.`);
  return resolution.problems.filter((problem) => !unmappedLabels.includes(problem));
}

function mappingOf(raw: unknown): Record<string, string | null> {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(Object.entries(value).map(([key, id]) => [key, typeof id === "string" && id ? id : null]));
}

export async function createFlowFromTemplate(input: { targetKey: string; templateId: string; name?: string | null; datasetId?: string | null; datasets?: unknown; columns?: unknown; intoFlowId?: string | null; slots: unknown; actor: RecipeActor }) {
  const template = (await listTemplates()).find((candidate) => candidate.id === input.templateId);
  if (!template) throw flowError("not_found", "Template not found");
  if (template.inputs.length) return createFromInputs(template, input);
  if (!input.datasetId) throw flowError("invalid_request", "Choose a table of this study.");
  const dataset = await getDatasetRecord(input.datasetId);
  if (!dataset || dataset.targetKey !== input.targetKey) throw flowError("invalid_request", "Choose a table of this study.");
  const version = dataset.currentVersionId ? await db.exploreDatasetVersion.findUnique({ where: { id: dataset.currentVersionId }, select: { schema: true } }) : null;
  if (!version) throw flowError("invalid_request", `${dataset.name} has no rows yet.`);
  const slots = checkSlots(template, input.slots, parseSchema(version.schema).columns.map((column) => column.key));
  const code = new Map<string, string>();
  for (const step of template.steps) {
    if (!step.codeFile) continue;
    const file = path.resolve(template.dir, step.codeFile);
    if (!file.startsWith(`${template.dir}${path.sep}`)) throw flowError("invalid_request", "Template code must live in the template's folder.");
    code.set(step.key, await fs.readFile(file, "utf8"));
  }
  const flow = await createFlow(input.targetKey, input.actor.userId, input.name?.trim() || template.name, template.description, input.actor.memberId ?? null);
  const stepIds = new Map<string, string>();
  for (const step of template.steps) {
    const model = await loadRecipe(flow.id);
    const bindings = [];
    for (const binding of step.inputs) {
      if ("source" in binding) bindings.push({ alias: binding.alias, datasetId: dataset.id, versionId: null });
      else if ("input" in binding) throw flowError("invalid_request", `Template step ${step.key} reads a named input the template does not declare.`);
      else {
        const upstream = stepIds.get(binding.from.step);
        if (!upstream || !model) throw flowError("invalid_request", `Template step ${step.key} reads from ${binding.from.step}, which comes later.`);
        bindings.push({ alias: binding.alias, datasetId: await ensureOutputDataset(model, upstream, binding.from.output, input.actor.userId), versionId: null });
      }
    }
    const analysis = await createAnalysis({
      targetKey: input.targetKey, flowId: flow.id, name: step.name, purpose: step.purpose ?? null, kitId: step.kitId ?? null, language: step.language,
      code: code.get(step.key), inputs: bindings, params: fillParams(step.params, slots), paramMeta: step.paramMeta ?? null,
      createdById: input.actor.userId, createdByMemberId: input.actor.memberId ?? null,
    });
    stepIds.set(step.key, analysis.id);
  }
  return flow.id;
}

/**
 * A template with named inputs: each maps to a table in the study's Data (or stays open, which blocks Run
 * until someone chooses one). Mapped tables must pass their check; steps get the template's params and packages.
 */
async function createFromInputs(template: FlowTemplate, input: { targetKey: string; name?: string | null; datasets?: unknown; columns?: unknown; intoFlowId?: string | null; actor: RecipeActor }) {
  const given = mappingOf(input.datasets);
  const resolution = await resolveTemplateColumns(template, input.targetKey, given, input.columns);
  for (const slot of template.inputs) {
    const datasetId = given[slot.key];
    if (!datasetId) continue;
    const result = await checkDataset(inputCheck(template, slot.key, resolution), datasetId, input.targetKey);
    if (!result.ok) throw flowError("invalid_request", `${slot.label}: ${result.sentence}`);
  }
  const problems = problemsFor(template, resolution, new Set(Object.entries(given).filter(([, id]) => id).map(([key]) => key)));
  if (problems.length) throw flowError("invalid_request", problems[0]);
  const code = new Map<string, string>();
  for (const step of template.steps) {
    if (!step.codeFile) continue;
    const file = path.resolve(template.dir, step.codeFile);
    if (!file.startsWith(`${template.dir}${path.sep}`)) throw flowError("invalid_request", "Template code must live in the template's folder.");
    code.set(step.key, await fs.readFile(file, "utf8"));
  }
  const flow = input.intoFlowId ? await emptyFlow(input.intoFlowId, input.targetKey, input.name?.trim() || null, template)
    : await createFlow(input.targetKey, input.actor.userId, input.name?.trim() || template.name, template.description, input.actor.memberId ?? null);
  const stepIds = new Map<string, string>();
  const uses = new Map<string, Array<{ stepId: string; alias: string }>>();
  for (const step of template.steps) {
    const model = await loadRecipe(flow.id);
    const bindings = [];
    const pending: Array<{ key: string; alias: string }> = [];
    for (const binding of step.inputs) {
      if ("input" in binding) {
        if (!template.inputs.some((slot) => slot.key === binding.input)) throw flowError("invalid_request", `Template step ${step.key} reads ${binding.input}, which the template does not declare.`);
        const datasetId = given[binding.input];
        if (datasetId) bindings.push({ alias: binding.alias, datasetId, versionId: null });
        pending.push({ key: binding.input, alias: binding.alias });
      } else if ("from" in binding) {
        const upstream = stepIds.get(binding.from.step);
        if (!upstream || !model) throw flowError("invalid_request", `Template step ${step.key} reads from ${binding.from.step}, which comes later.`);
        bindings.push({ alias: binding.alias, datasetId: await ensureOutputDataset(model, upstream, binding.from.output, input.actor.userId), versionId: null });
      } else throw flowError("invalid_request", `Template step ${step.key} must read a named input or an upstream output.`);
    }
    const analysis = await createAnalysis({
      targetKey: input.targetKey, flowId: flow.id, name: step.name, purpose: step.purpose ?? null, kitId: step.kitId ?? null, language: step.language,
      code: code.get(step.key), inputs: bindings, params: fillColumnParams(step.params, resolution.values), paramMeta: step.paramMeta ?? null,
      createdById: input.actor.userId, createdByMemberId: input.actor.memberId ?? null,
    });
    if (step.packages.length) await db.exploreAnalysis.update({ where: { id: analysis.id }, data: { packages: { packages: step.packages, channels: [] } } });
    for (const use of pending) uses.set(use.key, [...(uses.get(use.key) ?? []), { stepId: analysis.id, alias: use.alias }]);
    stepIds.set(step.key, analysis.id);
  }
  for (const [position, slot] of template.inputs.entries()) {
    await saveFlowInput({ flowId: flow.id, key: slot.key, label: slot.label, expects: slot.expects, check: inputCheck(template, slot.key, resolution), datasetId: given[slot.key] ?? null, templateId: template.id, uses: uses.get(slot.key) ?? [], position });
  }
  return flow.id;
}

/**
 * "Start from a template with this table" on a blank analysis: the template fills that analysis instead of a new one.
 * It must have no steps yet; the tables it had attached are replaced by the template's mapped inputs.
 */
async function emptyFlow(flowId: string, targetKey: string, name: string | null, template: FlowTemplate) {
  const flow = await db.exploreFlow.findUnique({ where: { id: flowId }, select: { id: true, targetKey: true, name: true } });
  if (!flow || flow.targetKey !== targetKey) throw flowError("invalid_request", "Choose an analysis of this study.");
  if (await db.exploreAnalysis.count({ where: { flowId } })) throw flowError("invalid_request", "This analysis already has steps; start the template as a new analysis.");
  await clearFlowInputs(flowId);
  await db.exploreFlow.update({ where: { id: flowId }, data: { ...(name && name !== flow.name ? { name } : {}), description: template.description } });
  return { id: flowId };
}
