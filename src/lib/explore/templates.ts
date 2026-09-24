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

const SlotSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  question: z.string().min(1).max(200),
  role: z.string().max(40).optional(),
  kind: z.enum(["column", "columns", "table"]),
}).strict();

const TemplateStepSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  name: z.string().min(1).max(200),
  purpose: z.string().max(200).optional(),
  language: z.enum(["python", "r"]).default("python"),
  codeFile: z.string().min(1).max(200).optional(),
  kitId: z.string().min(1).max(80).optional(),
  params: z.record(z.string(), z.unknown()).default({}),
  paramMeta: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  inputs: z.array(z.union([
    z.object({ alias: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), source: z.literal("dataset") }).strict(),
    z.object({ alias: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), from: z.object({ step: z.string(), output: z.string() }).strict() }).strict(),
  ])).min(1),
  outputs: z.array(z.object({ name: z.string(), kind: z.enum(["table", "figure", "value", "finding", "report"]) }).strict()).default([]),
}).strict().refine((step) => Boolean(step.codeFile) !== Boolean(step.kitId), { message: "A template step needs codeFile or kitId" });

export const TemplateSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  slots: z.array(SlotSchema).max(20),
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
  return { id: template.id, name: template.name, description: template.description, slots: template.slots, steps: template.steps.map((step) => ({ name: step.name, purpose: step.purpose ?? null })) };
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

export async function createFlowFromTemplate(input: { targetKey: string; templateId: string; name?: string | null; datasetId: string; slots: unknown; actor: RecipeActor }) {
  const template = (await listTemplates()).find((candidate) => candidate.id === input.templateId);
  if (!template) throw flowError("not_found", "Template not found");
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
