/**
 * Flow inputs: every table an analysis reads lives in Data (one record, versioned, with access rules).
 * A flow input names what a table stands for ("counts", "samples"): a template declares them, and
 * "Add data" in the recipe attaches one. An input without a table blocks Run with a sentence.
 * Stored in ExploreFlowInput (migration 20260927190000_flow_inputs) through raw SQL.
 */
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import { createRevision, parseInputBindings } from "./analyses";
import { parseSchema } from "./schema";
import { ensureVersionProfile } from "./datasets";
import { profileLine, readProfile, type TableProfile } from "./table-profile";

export const InputCheckSchema = z.object({
  /** counts: an id column, then whole-number columns (features × samples). samples: one row per sample. table: any. */
  kind: z.enum(["counts", "samples", "table"]),
  /** Columns the table must have (for samples: the sample id and the group columns the params name). */
  columns: z.array(z.string().min(1).max(80)).max(20).default([]),
}).strict();
export type InputCheck = z.infer<typeof InputCheckSchema>;

export interface CheckResult { ok: boolean; sentence: string }

type SchemaColumn = { key: string; type: string; role?: string | null };

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

/** The type check sentence for one table against what an input expects ("a count matrix, whole numbers ✓"). */
export function checkColumns(check: InputCheck, columns: SchemaColumn[], rowCount: number, sample: Array<Record<string, unknown>>, profile?: Pick<TableProfile, "verdict" | "sentence" | "why"> | null): CheckResult {
  const result = checkColumnsOnly(check, columns, rowCount, sample);
  if (!profile || !rowCount) return result;
  // The provenance check of the table (raw counts vs normalised) goes into the same sentence.
  if (check.kind === "counts") {
    if (profile.verdict !== "raw-counts") return { ok: false, sentence: `${profileLine(profile)} A count input needs raw read counts.` };
    return result.ok ? { ok: true, sentence: result.sentence.replace(/^A count matrix, whole numbers/, "A count matrix, raw counts, whole numbers") } : result;
  }
  return { ...result, sentence: `${result.sentence} · ${profileLine(profile)}` };
}

function checkColumnsOnly(check: InputCheck, columns: SchemaColumn[], rowCount: number, sample: Array<Record<string, unknown>>): CheckResult {
  const keys = new Set(columns.map((column) => column.key));
  const missing = check.columns.filter((column) => !keys.has(column));
  if (!rowCount) return { ok: false, sentence: "The table has no rows." };
  if (check.kind === "counts") {
    const numeric = columns.filter((column) => column.type === "number");
    const id = columns.find((column) => column.type !== "number");
    if (!id) return { ok: false, sentence: "A count matrix needs a first column naming the features (genes or taxa)." };
    if (numeric.length < 2) return { ok: false, sentence: `A count matrix needs one number column per sample; this table has ${plural(numeric.length, "number column")}.` };
    const fractional = numeric.find((column) => sample.some((row) => { const value = row[column.key]; return typeof value === "number" && (!Number.isInteger(value) || value < 0); }));
    if (fractional) return { ok: false, sentence: `Counts must be whole numbers of zero or more; ${fractional.key} has other values.` };
    if (missing.length) return { ok: false, sentence: `Missing column ${missing.join(", ")}.` };
    return { ok: true, sentence: `A count matrix, whole numbers: ${plural(rowCount, "row")} × ${plural(numeric.length, "sample")} ✓` };
  }
  if (missing.length) return { ok: false, sentence: `Needs column${missing.length === 1 ? "" : "s"} ${missing.join(", ")}; the table has ${columns.slice(0, 6).map((column) => column.key).join(", ")}${columns.length > 6 ? ", …" : ""}.` };
  if (check.kind === "samples") {
    const id = check.columns[0] ?? columns.find((column) => column.role === "sample")?.key ?? columns[0]?.key;
    const ids = sample.map((row) => row[id]).filter((value) => value !== null && value !== undefined && value !== "");
    if (new Set(ids.map(String)).size !== ids.length) return { ok: false, sentence: `Sample ids in ${id} must be unique.` };
    const rest = check.columns.slice(1);
    return { ok: true, sentence: `Sample sheet: ${plural(rowCount, "sample")}, id ${id}${rest.length ? `, ${rest.join(" and ")}` : ""} ✓` };
  }
  return { ok: true, sentence: `A table of ${plural(rowCount, "row")} × ${plural(columns.length, "column")} ✓` };
}

/** Check one Data table against an input. */
export async function checkDataset(check: InputCheck, datasetId: string, targetKey: string): Promise<CheckResult> {
  const dataset = await db.exploreDataset.findUnique({ where: { id: datasetId }, select: { targetKey: true, currentVersionId: true } });
  if (!dataset || dataset.targetKey !== targetKey) return { ok: false, sentence: "Choose a table in this study’s Data." };
  if (!dataset.currentVersionId) return { ok: false, sentence: "The table has no version yet." };
  const version = await db.exploreDatasetVersion.findUnique({ where: { id: dataset.currentVersionId }, select: { schema: true, rowCount: true } });
  if (!version) return { ok: false, sentence: "The table has no version yet." };
  const profile = readProfile(await ensureVersionProfile(dataset.currentVersionId));
  const rows = await db.exploreDatasetRow.findMany({ where: { versionId: dataset.currentVersionId }, orderBy: { rowIndex: "asc" }, take: 500, select: { data: true } });
  return checkColumns(check, parseSchema(version.schema).columns as SchemaColumn[], version.rowCount, rows.map((row) => (row.data ?? {}) as Record<string, unknown>), profile);
}

interface InputRow { id: string; flowId: string; key: string; label: string; expects: string | null; check: unknown; datasetId: string | null; templateId: string | null; uses: unknown; position: number }
type Use = { stepId: string; alias: string };

const usesOf = (raw: unknown): Use[] => (Array.isArray(raw) ? raw.filter((use): use is Use => Boolean(use) && typeof use.stepId === "string" && typeof use.alias === "string") : []);

async function rowsOf(flowId: string): Promise<InputRow[]> {
  return db.$queryRaw<InputRow[]>`SELECT "id", "flowId", "key", "label", "expects", "check", "datasetId", "templateId", "uses", "position" FROM "ExploreFlowInput" WHERE "flowId" = ${flowId} ORDER BY "position", "createdAt"`;
}

export async function saveFlowInput(input: { flowId: string; key: string; label: string; expects?: string | null; check?: InputCheck | null; datasetId: string | null; templateId?: string | null; uses?: Use[]; position?: number }) {
  await db.$executeRaw`INSERT INTO "ExploreFlowInput" ("id", "flowId", "key", "label", "expects", "check", "datasetId", "templateId", "uses", "position")
    VALUES (${randomUUID()}, ${input.flowId}, ${input.key}, ${input.label}, ${input.expects ?? null}, ${input.check ? JSON.stringify(input.check) : null}::jsonb, ${input.datasetId}, ${input.templateId ?? null}, ${JSON.stringify(input.uses ?? [])}::jsonb, ${input.position ?? 0})
    ON CONFLICT ("flowId", "key") DO UPDATE SET "datasetId" = EXCLUDED."datasetId", "updatedAt" = CURRENT_TIMESTAMP`;
}

/** Remove every input of a flow (a blank analysis a template now fills). */
export async function clearFlowInputs(flowId: string) {
  await db.$executeRaw`DELETE FROM "ExploreFlowInput" WHERE "flowId" = ${flowId}`;
}

/** The flow's inputs as the recipe shows them: what each expects, the table chosen and its check sentence. */
export async function listFlowInputs(flowId: string, targetKey: string) {
  const rows = await rowsOf(flowId);
  if (!rows.length) return [];
  const datasetIds = rows.map((row) => row.datasetId).filter((id): id is string => Boolean(id));
  const datasets = datasetIds.length ? await db.exploreDataset.findMany({ where: { id: { in: datasetIds } }, select: { id: true, name: true } }) : [];
  return Promise.all(rows.map(async (row) => {
    const parsed = InputCheckSchema.safeParse(row.check ?? { kind: "table" });
    const check = parsed.success ? parsed.data : { kind: "table" as const, columns: [] };
    return {
      key: row.key, label: row.label, expects: row.expects, templateId: row.templateId,
      datasetId: row.datasetId, datasetName: datasets.find((dataset) => dataset.id === row.datasetId)?.name ?? null,
      result: row.datasetId ? await checkDataset(check, row.datasetId, targetKey) : null,
    };
  }));
}

/** Why the flow cannot run yet, or null: an input with no table, or a table that fails its check. */
export async function flowInputsProblem(flowId: string, targetKey: string): Promise<string | null> {
  const inputs = await listFlowInputs(flowId, targetKey);
  const missing = inputs.filter((input) => !input.datasetId);
  if (missing.length) return `Choose a table in Data for ${missing.map((input) => input.label.toLowerCase()).join(" and ")} before running.`;
  const failing = inputs.find((input) => input.result && !input.result.ok);
  if (failing) return `${failing.label}: ${failing.result!.sentence}`;
  return null;
}

/**
 * Point an input at a Data table ("Upload a table…" files it into Data first; "Choose from Data…" picks one).
 * A new key attaches a plain input; an existing one is remapped, and every step it feeds reads the new table
 * through a new revision (same code and params), so the change is in the step's history.
 */
export async function attachFlowInput(input: { flowId: string; targetKey: string; key?: string | null; label?: string | null; datasetId: string; actor: { userId: string; memberId?: string | null } }) {
  const dataset = await db.exploreDataset.findUnique({ where: { id: input.datasetId }, select: { id: true, name: true, targetKey: true } });
  if (!dataset || dataset.targetKey !== input.targetKey) throw flowError("invalid_request", "A step can only read tables in this study’s Data.");
  const rows = await rowsOf(input.flowId);
  const key = input.key?.trim() || dataset.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "table";
  const existing = rows.find((row) => row.key === key);
  if (existing) {
    const parsed = InputCheckSchema.safeParse(existing.check ?? { kind: "table" });
    const result = await checkDataset(parsed.success ? parsed.data : { kind: "table", columns: [] }, dataset.id, input.targetKey);
    if (!result.ok) throw flowError("invalid_request", `${existing.label}: ${result.sentence}`);
  }
  await saveFlowInput({ flowId: input.flowId, key, label: existing?.label ?? input.label?.trim() ?? dataset.name, datasetId: dataset.id, position: existing?.position ?? rows.length });
  for (const use of usesOf(existing?.uses)) {
    const step = await db.exploreAnalysis.findUnique({ where: { id: use.stepId }, select: { id: true, flowId: true, currentRevisionId: true } });
    if (!step || step.flowId !== input.flowId || !step.currentRevisionId) continue;
    const revision = await db.exploreAnalysisRevision.findUnique({ where: { id: step.currentRevisionId }, select: { inputs: true } });
    const bindings = parseInputBindings(revision?.inputs).filter((binding) => binding.alias !== use.alias);
    await createRevision({ analysisId: step.id, inputs: [...bindings, { alias: use.alias, datasetId: dataset.id, versionId: null }], author: "user", authorUserId: input.actor.userId, authorMemberId: input.actor.memberId ?? null, message: `Reads ${dataset.name} as ${use.alias}` });
  }
  return key;
}
