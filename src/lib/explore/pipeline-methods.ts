/**
 * The Methods sentence of a pipeline step and the papers to cite (identity sheet 96 f8), made from the pipeline's
 * record, never by the assistant: the manifest's template (or SeqDesk's for the pipelines it knows) filled with the
 * values of the run — version, settings, reference database, sample and row counts. Values rest on the run; a newer
 * run updates them. Citations come from the pipeline and each tool it runs. A token the record does not have stays
 * visible as missing instead of being guessed.
 */
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import { parseSchema } from "./schema";
import { loadRecipe, type RecipeModel, type RecipeStep } from "./recipe";
import { parsePipelineStepConfig, pipelineInfo, pipelineSettings, storedPipelineConfig, type PipelineStepConfig } from "./pipeline-steps";
import { snapshotOf, type PipelineSnapshot } from "./pipeline-step-runs";
import { pipelineRecord, type PipelineCitation } from "./pipeline-record";

export interface PipelineMethodsToken {
  token: string;
  key: string;
  label: string;
  value: unknown;
  /** As the sentence writes it ("230", "515F / 806R", "1,342"). */
  display: string;
  source: "pipeline" | "run" | "setting" | "reference" | "count";
}

export interface PipelineMethods {
  /** The sentence with the run's values filled in. */
  text: string;
  /** The template with `{tokens}`, for "Edit wording" (tokens stay values of the run). */
  template: string;
  tokens: PipelineMethodsToken[];
  /** Tokens the record has no value for ("{params.trunclenf}"); shown as missing, never guessed. */
  missing: string[];
  /** Made from the pipeline's record (not the assistant): the mark is the record's underbracket, not pencil. */
  source: "record";
  run: { pipelineRunId: string | null; runNumber: string | null; flowRunNumber: number | null; version: string } | null;
  citations: PipelineCitation[];
  /** "From the pipeline’s record · Run #2" or "From the pipeline’s record · not run yet". */
  words: string;
}

const FALLBACK = "Reads were processed with {pipeline} {version} ({samples} samples).";

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return value.toLocaleString("en-US");
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.map(displayValue).join(" / ");
  return String(value);
}

export interface MethodsValues {
  pipeline: string;
  version: string;
  samples: number | null;
  params: Record<string, unknown>;
  /** Settings by key with their titles, for the token labels. */
  titles?: Record<string, string>;
  reference: string | null;
  outputs: Record<string, { rows: number | null; columns: number | null }>;
}

/** Fill a template's `{tokens}` from the run's values (pure). */
export function fillMethods(template: string, values: MethodsValues): { text: string; tokens: PipelineMethodsToken[]; missing: string[] } {
  const tokens: PipelineMethodsToken[] = [];
  const missing: string[] = [];
  const text = template.replace(/\{([A-Za-z0-9_.:-]+)\}/g, (whole, key: string) => {
    let value: unknown = undefined, label = key, source: PipelineMethodsToken["source"] = "run";
    if (key === "pipeline") { value = values.pipeline; label = "pipeline"; source = "pipeline"; }
    else if (key === "version") { value = values.version; label = "version"; source = "pipeline"; }
    else if (key === "samples") { value = values.samples; label = "samples"; source = "count"; }
    else if (key === "reference") { value = values.reference; label = "reference database"; source = "reference"; }
    else if (key.startsWith("params.") || key.startsWith("setting:")) {
      const name = key.replace(/^params\.|^setting:/, "");
      value = values.params[name]; label = values.titles?.[name] ?? name; source = "setting";
    } else if (key.startsWith("output.")) {
      const [, name, what] = key.split(".");
      const output = values.outputs[name];
      value = what === "columns" ? output?.columns : output?.rows; label = `${name} ${what === "columns" ? "columns" : "rows"}`; source = "count";
    }
    const display = displayValue(value);
    if (!display) { missing.push(whole); return "—"; }
    tokens.push({ token: whole, key, label, value: value ?? null, display, source });
    return display;
  });
  // "1 samples" reads "1 sample" (a count of one, not 11 or 1.5).
  return { text: text.replace(/(^|[^\d.,])1 samples\b/g, "$11 sample"), tokens, missing };
}

/** The values of a run (or of the step's settings before any run) the sentence rests on. */
async function valuesOf(model: RecipeModel, step: RecipeStep, config: PipelineStepConfig, snapshot: PipelineSnapshot | null, version: string): Promise<MethodsValues> {
  const info = pipelineInfo(config.pipelineId);
  const stored = info ? await storedPipelineConfig(config.pipelineId).catch(() => ({})) : {};
  const settings = info ? pipelineSettings(info.definition, config.params, stored) : [];
  const params = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));
  for (const [key, value] of Object.entries(config.params)) if (!(key in params)) params[key] = value;
  const outputs: MethodsValues["outputs"] = {};
  for (const output of config.outputs) {
    const written = snapshot?.outputs?.find((entry) => entry.name === output.name);
    const dataset = [...model.datasets.values()].find((candidate) => candidate.producer === step.id && candidate.artifactName === output.name);
    const columns = dataset?.current ? parseSchema(dataset.current.schema).columns.filter((column) => !["sample_db_id", "pipeline_run", "source_study_id", "cohort_group", "cohort_role"].includes(column.key)).length : null;
    outputs[output.name] = { rows: written?.rows ?? dataset?.current?.rowCount ?? null, columns };
    outputs[output.outputId] = outputs[output.name];
  }
  const reference = typeof params.reference === "string" ? params.reference : null;
  return { pipeline: info?.name ?? config.pipelineId, version, samples: snapshot?.sampleCount ?? null, params, titles: Object.fromEntries(settings.map((setting) => [setting.key, setting.title])), reference, outputs };
}

/** The Methods sentence and citations of a pipeline step, from the viewed run's record (or the step before it ran). */
export async function pipelineMethodsOf(model: RecipeModel, step: RecipeStep, run: { results: string | null; revisionId: string | null; flowRunNumber: number | null } | null): Promise<PipelineMethods | null> {
  const current = parsePipelineStepConfig(step.pipeline);
  if (!current) return null;
  // The settings the run used (its revision), not the step's settings now.
  const usedRevision = run?.revisionId && run.revisionId !== step.revision?.id ? await db.exploreAnalysisRevision.findUnique({ where: { id: run.revisionId } }).catch(() => null) : null;
  const config = parsePipelineStepConfig((usedRevision as { pipeline?: unknown } | null)?.pipeline) ?? current;
  const snapshot = run ? snapshotOf(run.results) : null;
  const record = pipelineRecord(config.pipelineId);
  const version = config.version || pipelineInfo(config.pipelineId)?.version || "";
  const template = record.methods?.template ?? FALLBACK;
  const filled = fillMethods(template, await valuesOf(model, step, config, snapshot, version));
  const citations = [...record.citations];
  return {
    text: filled.text, template, tokens: filled.tokens, missing: filled.missing, source: "record",
    run: snapshot ? { pipelineRunId: snapshot.pipelineRunId, runNumber: snapshot.runNumber, flowRunNumber: run?.flowRunNumber ?? null, version } : null,
    citations, words: `From the pipeline’s record · ${snapshot && run?.flowRunNumber ? `Run #${run.flowRunNumber}` : snapshot ? snapshot.runNumber ?? "its run" : "not run yet"}`,
  };
}

/** GET flows/:id/steps/:stepId/methods[?runId]: the sentence for the current (or a chosen) recipe run. */
export async function pipelineMethodsFor(flowId: string, stepId: string, runId?: string | null): Promise<PipelineMethods> {
  const model = await loadRecipe(flowId);
  if (!model) throw flowError("not_found", "Flow not found");
  const step = model.steps.find((entry) => entry.id === stepId);
  if (!step || step.stepKind !== "pipeline") throw flowError("invalid_request", "That step is not a pipeline step.");
  const flowRunId = runId ?? model.flow.currentRunId;
  let run: { results: string | null; revisionId: string | null; flowRunNumber: number | null } | null = null;
  if (flowRunId) {
    const flowRun = await db.exploreFlowRun.findUnique({ where: { id: flowRunId }, select: { id: true, number: true, flowId: true, plan: true } });
    if (!flowRun || flowRun.flowId !== flowId) throw flowError("not_found", "That run is not a run of this flow.");
    const own = await db.exploreAnalysisRun.findFirst({ where: { flowRunId: flowRun.id, analysisId: stepId }, orderBy: { createdAt: "desc" }, select: { results: true, revisionId: true } });
    // A reused step: the step run it reused.
    const reusedId = !own ? ((Array.isArray(flowRun.plan) ? flowRun.plan : []) as Array<{ analysisId?: string; reusedFrom?: { stepRunId?: string } | null }>).find((entry) => entry.analysisId === stepId)?.reusedFrom?.stepRunId : null;
    const reused = reusedId ? await db.exploreAnalysisRun.findUnique({ where: { id: reusedId }, select: { results: true, revisionId: true } }) : null;
    const row = own ?? reused;
    if (row) run = { results: row.results, revisionId: row.revisionId, flowRunNumber: flowRun.number ?? null };
  }
  const methods = await pipelineMethodsOf(model, step, run);
  if (!methods) throw flowError("invalid_request", "That step is not a pipeline step.");
  return methods;
}

