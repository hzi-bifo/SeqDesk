/**
 * A new version of a pipeline, compared before switching (identity sheet 96 f9): the version notice (installed here,
 * or only in the store), "Try it side by side" — the installed version run on the same samples with the same settings
 * as the step's last run, never used by the recipe ("compared, not used") — and the comparison the manifest asks for
 * (row counts, samples passing the quality line, top features). Switching is a new revision of the step
 * (PUT …/pipeline {version}); nothing runs by itself.
 */
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import { createPipelineRunForOperator, startPipelineRunForOperator } from "@/lib/pipelines/pipeline-run-service";
import { durationWords } from "@/lib/pipelines/plain-status";
import { runBuilder } from "./build";
import { allocateRunNumber } from "./analyses";
import { loadRecipe, type RecipeActor } from "./recipe";
import { parseSchema } from "./schema";
import { parsePipelineStepConfig, pipelineInfo, pipelineStartAccess, type PipelineAccess, type PipelineStepConfig } from "./pipeline-steps";
import { snapshotOf, type PipelineSnapshot } from "./pipeline-step-runs";
import { changelogUrl, pipelineRecord, type PipelineCompareMetric } from "./pipeline-record";
import { judgeQuality } from "./pipeline-quality";
import type { BuildContext } from "./builders/types";
import type { ExploreRowData } from "./types";

const ACTIVE = ["pending", "queued", "running"];
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

// ---------------------------------------------------------------------------
// The version notice
// ---------------------------------------------------------------------------

export interface PipelineVersions {
  /** The version the step uses. */
  current: string;
  /** Installed here now, when it differs from the step's. */
  installed: string | null;
  /** The newest the store knows (null when the store was not read yet). */
  latest: string | null;
  /** The newer version to tell about: installed here (can be tried side by side) or only in the store (admins install it). */
  newer: { version: string; installed: boolean; changelogUrl: string | null; words: string } | null;
  changelogUrl: string | null;
}

const compareVersions = (a: string, b: string) => {
  const parts = (value: string) => value.replace(/^v/i, "").split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const p = x[i] ?? 0, q = y[i] ?? 0;
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p - q;
    return String(p).localeCompare(String(q));
  }
  return 0;
};

/** The step's version, what is installed, what the store has, and the newer version to tell about. */
export function pipelineVersions(config: PipelineStepConfig, latest: string | null): PipelineVersions {
  const info = pipelineInfo(config.pipelineId);
  const current = config.version || info?.version || "";
  const installed = info && info.version !== current ? info.version : null;
  const record = pipelineRecord(config.pipelineId);
  const candidates = [installed, latest].filter((value): value is string => Boolean(value) && compareVersions(value!, current) > 0);
  const best = candidates.sort((a, b) => compareVersions(b, a))[0] ?? null;
  const name = info?.name ?? config.pipelineId;
  return {
    current, installed, latest,
    newer: best ? { version: best, installed: best === info?.version, changelogUrl: changelogUrl(record, best), words: `${name} ${best} is ${best === info?.version ? "installed here" : "available"}` } : null,
    changelogUrl: changelogUrl(record, current),
  };
}

// ---------------------------------------------------------------------------
// Try it side by side
// ---------------------------------------------------------------------------

export interface PipelineCompareRow { id: string; label: string; from: string; to: string; change: string; words: string }
export interface PipelineCompare {
  stepId: string;
  from: { version: string; pipelineRunId: string; runNumber: string | null; flowRunNumber: number | null; took: string | null };
  to: { version: string; pipelineRunId: string; runNumber: string | null; status: "queued" | "running" | "completed" | "failed" | "cancelled"; words: string; took: string | null };
  rows: PipelineCompareRow[];
  /** "compared, not used": the trial run stays in Data, the recipe does not read it. */
  label: string;
  changelogUrl: string | null;
  words: string;
  dismissed: boolean;
}

/** The step's last finished run (the one the step reads now), with the version and settings it ran with. */
async function baseRunOf(stepId: string): Promise<{ stepRunId: string; pipelineRunId: string; config: PipelineStepConfig; snapshot: PipelineSnapshot | null; flowRunNumber: number | null } | null> {
  const run = await db.exploreAnalysisRun.findFirst({ where: { analysisId: stepId, executionMode: "pipeline", status: "completed", pipelineRunId: { not: null }, trial: false }, orderBy: { createdAt: "desc" }, select: { id: true, pipelineRunId: true, revisionId: true, results: true, flowRunId: true } });
  if (!run?.pipelineRunId) return null;
  const revision = await db.exploreAnalysisRevision.findUnique({ where: { id: run.revisionId } });
  const config = parsePipelineStepConfig((revision as { pipeline?: unknown } | null)?.pipeline);
  if (!config) return null;
  const flowRun = run.flowRunId ? await db.exploreFlowRun.findUnique({ where: { id: run.flowRunId }, select: { number: true } }) : null;
  return { stepRunId: run.id, pipelineRunId: run.pipelineRunId, config, snapshot: snapshotOf(run.results), flowRunNumber: flowRun?.number ?? null };
}

/**
 * Run the installed (newer) version on the same samples with the same settings as the step's last run, as a trial the
 * recipe does not use. Refused when there is nothing to compare with, the same version, or the study's limit is reached.
 */
export async function startCompareRun(flowId: string, stepId: string, input: { actor: RecipeActor & { name?: string | null }; access: PipelineAccess }): Promise<PipelineCompare> {
  const model = await loadRecipe(flowId);
  if (!model) throw flowError("not_found", "Flow not found");
  const step = model.steps.find((candidate) => candidate.id === stepId);
  const current = step?.stepKind === "pipeline" ? parsePipelineStepConfig(step.pipeline) : null;
  if (!step || !current) throw flowError("invalid_request", "That step is not a pipeline step.");
  const info = pipelineInfo(current.pipelineId);
  if (!info) throw flowError("invalid_request", `${current.pipelineId} is not installed on this server.`);
  const base = await baseRunOf(stepId);
  if (!base) throw flowError("invalid_request", "The step has no finished run to compare with yet. Run the recipe first.");
  if (base.config.version === info.version) throw flowError("invalid_request", `This server has only ${info.name} ${info.version}, the version the step used. An admin installs the newer version first.`, { fix: { kind: "ask-install", pipelineId: current.pipelineId } });
  const access = await pipelineStartAccess(model.flow.targetKey, input.access);
  if (!access.ok) throw flowError("forbidden", access.words ?? "You may not start pipelines here.");
  const { pipelineCapacity } = await import("./pipeline-limits");
  const capacity = await pipelineCapacity(model.flow.targetKey).catch(() => null);
  if (capacity && !capacity.free) throw flowError("invalid_request", `${capacity.words}; try it side by side once it finished.`);
  const prun = await db.pipelineRun.findUnique({ where: { id: base.pipelineRunId }, select: { studyId: true, inputSampleIds: true, runNumber: true } });
  let sampleIds: string[] = [];
  try { const parsed = JSON.parse(prun?.inputSampleIds ?? "null"); sampleIds = Array.isArray(parsed) ? parsed.map(String) : []; } catch { sampleIds = []; }
  if (!prun?.studyId || !sampleIds.length) throw flowError("invalid_request", "The step's last run no longer names its samples; run the recipe again first.");
  const accessScope = input.access.installation ? "installation" as const : "own" as const;
  const created = await createPipelineRunForOperator({ body: { pipelineId: current.pipelineId, studyId: prun.studyId, sampleIds, ...(Object.keys(base.config.params).length ? { config: base.config.params } : {}) }, userId: input.actor.userId, accessScope, canManageConfig: false });
  const pipelineRunId = (created.body as { run?: { id?: string } }).run?.id ?? null;
  if (created.status >= 300 || !pipelineRunId) throw flowError("invalid_request", `${info.name} ${info.version} could not start: ${String((created.body as { error?: unknown }).error ?? "the run service refused")}`);
  const started = await startPipelineRunForOperator({ runId: pipelineRunId, body: {}, userId: input.actor.userId, accessScope });
  if (started.status >= 300) throw flowError("invalid_request", `${info.name} ${info.version} could not start: ${String((started.body as { error?: unknown }).error ?? "the run service refused")}`);
  await db.pipelineRunEvent.create({ data: { pipelineRunId, eventType: "note", source: "launcher", message: `Compared with ${info.name} ${base.config.version} (${prun.runNumber}) for step ${model.labels.get(stepId)} of ${model.flow.name}; compared, not used` } }).catch(() => undefined);
  await db.exploreAnalysisRun.create({ data: {
    id: `cmp_${stepId}_${Date.now().toString(36)}`.slice(0, 120), analysisId: stepId, revisionId: step.revision?.id ?? base.stepRunId, runNumber: await allocateRunNumber(), status: "running", executionMode: "pipeline",
    createdById: input.actor.userId, trial: true, queuedAt: new Date(), startedAt: new Date(), pipelineRunId,
    results: JSON.stringify({ compare: { baseStepRunId: base.stepRunId, basePipelineRunId: base.pipelineRunId, baseVersion: base.config.version, version: info.version, startedBy: input.actor.name ?? null, dismissed: false } }),
  } });
  const view = await compareView(flowId, stepId);
  if (!view) throw flowError("invalid_request", "The comparison could not be read back.");
  return view;
}

const tookOf = (run: { startedAt: Date | null; completedAt: Date | null } | null) => (run?.startedAt && run.completedAt ? durationWords(Math.round((run.completedAt.getTime() - run.startedAt.getTime()) / 1000)) : null);

/** One table of a finished run, built in memory (nothing is written). */
async function tableOf(pipelineRunId: string, pipelineId: string, outputId: string): Promise<{ rows: ExploreRowData[]; columns: string[]; roles: Record<string, string> } | null> {
  const run = await db.pipelineRun.findUnique({ where: { id: pipelineRunId }, select: { studyId: true } });
  if (!run?.studyId) return null;
  const study = await db.study.findUnique({ where: { id: run.studyId }, select: { userId: true } });
  const context: BuildContext = { target: { type: "study", id: run.studyId }, targetKey: `study:${run.studyId}`, userId: study?.userId ?? "", installation: false, isFacilityAdmin: false };
  const built = await runBuilder("pipeline-table", context, { pipelineId, outputId, runIds: [pipelineRunId] }).catch(() => null);
  return built ? { rows: built.rows, columns: built.schema.columns.map((column) => column.key), roles: built.roles as Record<string, string> } : null;
}

/** The value of one compare metric for one run (pure over the built table). */
export function metricValue(metric: PipelineCompareMetric, table: { rows: ExploreRowData[]; columns: string[]; roles: Record<string, string> } | null, qc: { thresholds: Array<{ column: string; label: string; min: number | null; max: number | null; unit: string | null }>; sampleColumn: string | null } | null): { value: number | null; set: string[] | null; words: string } {
  if (!table) return { value: null, set: null, words: "—" };
  if (metric.kind === "rows") return { value: table.rows.length, set: null, words: table.rows.length.toLocaleString("en-US") };
  if (metric.kind === "columns") return { value: table.columns.length, set: null, words: table.columns.length.toLocaleString("en-US") };
  if (metric.kind === "qc-pass") {
    if (!qc) return { value: null, set: null, words: "—" };
    const judged = judgeQuality(table.rows as Array<Record<string, unknown>>, table.columns, qc.thresholds, qc.sampleColumn);
    return { value: judged.passing, set: null, words: judged.passing.toLocaleString("en-US") };
  }
  // top-features: the features ranked by their count (or how often they appear), as a set.
  const column = metric.column && table.columns.includes(metric.column) ? metric.column : table.roles.taxon ?? null;
  if (!column) return { value: null, set: null, words: "—" };
  const weight = table.roles.count ?? table.roles.value ?? null;
  const totals = new Map<string, number>();
  for (const row of table.rows) {
    const name = row[column];
    if (name === null || name === undefined || name === "") continue;
    const add = weight ? Number(row[weight]) || 0 : 1;
    totals.set(String(name), (totals.get(String(name)) ?? 0) + add);
  }
  const top = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, metric.top ?? 10).map(([name]) => name);
  return { value: top.length, set: top, words: top.slice(0, 3).join(", ") };
}

/** The comparison of the step's latest side-by-side run (null when there is none). */
export async function compareView(flowId: string, stepId: string): Promise<PipelineCompare | null> {
  const row = await db.exploreAnalysisRun.findFirst({ where: { analysisId: stepId, id: { startsWith: "cmp_" } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, pipelineRunId: true, results: true } });
  if (!row?.pipelineRunId) return null;
  const info = record(record(JSON.parse(row.results ?? "{}")).compare);
  const baseRunId = String(info.basePipelineRunId ?? "");
  const [toRun, fromRun] = await Promise.all([
    db.pipelineRun.findUnique({ where: { id: row.pipelineRunId }, select: { id: true, runNumber: true, status: true, startedAt: true, completedAt: true, pipelineId: true } }),
    db.pipelineRun.findUnique({ where: { id: baseRunId }, select: { id: true, runNumber: true, startedAt: true, completedAt: true } }),
  ]);
  if (!toRun) return null;
  const baseStep = info.baseStepRunId ? await db.exploreAnalysisRun.findUnique({ where: { id: String(info.baseStepRunId) }, select: { flowRunId: true } }) : null;
  const flowRun = baseStep?.flowRunId ? await db.exploreFlowRun.findUnique({ where: { id: baseStep.flowRunId }, select: { number: true } }) : null;
  const status = (["queued", "running", "completed", "failed", "cancelled"].includes(toRun.status) ? toRun.status : toRun.status === "pending" ? "queued" : "running") as PipelineCompare["to"]["status"];
  // The record follows the trial run.
  if (!ACTIVE.includes(toRun.status) && ACTIVE.includes(row.status)) await db.exploreAnalysisRun.updateMany({ where: { id: row.id, status: { in: ACTIVE } }, data: { status: toRun.status === "completed" ? "completed" : toRun.status === "cancelled" ? "cancelled" : "failed", completedAt: new Date() } });
  const record0 = pipelineRecord(toRun.pipelineId);
  const rows: PipelineCompareRow[] = [];
  if (status === "completed" && fromRun) {
    const qc = record0.qc ? { thresholds: record0.qc.metrics.map((metric) => ({ column: metric.column, label: metric.label, min: metric.min ?? null, max: metric.max ?? null, unit: metric.unit ?? null })), sampleColumn: record0.qc.sampleColumn } : null;
    const cache = new Map<string, Awaited<ReturnType<typeof tableOf>>>();
    const table = async (runId: string, outputId: string) => { const key = `${runId}:${outputId}`; if (!cache.has(key)) cache.set(key, await tableOf(runId, toRun.pipelineId, outputId)); return cache.get(key)!; };
    for (const metric of record0.compare) {
      const outputId = metric.output ?? "";
      const [a, b] = [metricValue(metric, await table(fromRun.id, outputId), qc), metricValue(metric, await table(toRun.id, outputId), qc)];
      let change = "", words = "";
      if (metric.kind === "top-features" && a.set && b.set) {
        const same = a.set.filter((name) => b.set!.includes(name));
        const onlyFrom = a.set.filter((name) => !b.set!.includes(name));
        change = same.length === a.set.length ? "same" : `${same.length} of ${a.set.length} the same`;
        words = onlyFrom.length ? `${change} · ${onlyFrom.slice(0, 2).join(", ")} in ${String(info.baseVersion)} only` : change;
        rows.push({ id: metric.id, label: metric.label, from: a.words, to: b.words, change, words });
        continue;
      }
      if (a.value !== null && b.value !== null) { const delta = b.value - a.value; change = delta === 0 ? "same" : `${delta > 0 ? "+" : "−"}${Math.abs(delta).toLocaleString("en-US")}`; }
      rows.push({ id: metric.id, label: metric.label, from: a.words, to: b.words, change, words: change });
    }
    const [tookA, tookB] = [tookOf(fromRun), tookOf(toRun)];
    if (tookA || tookB) rows.push({ id: "took", label: "Took", from: tookA ?? "—", to: tookB ?? "—", change: "", words: "" });
  }
  const name = pipelineInfo(toRun.pipelineId)?.name ?? toRun.pipelineId;
  return {
    stepId,
    from: { version: String(info.baseVersion ?? ""), pipelineRunId: baseRunId, runNumber: fromRun?.runNumber ?? null, flowRunNumber: flowRun?.number ?? null, took: tookOf(fromRun) },
    to: { version: String(info.version ?? ""), pipelineRunId: toRun.id, runNumber: toRun.runNumber, status, words: status === "completed" ? "Finished" : status === "failed" ? "Stopped" : status === "cancelled" ? "Stopped" : "Running", took: tookOf(toRun) },
    rows, label: "compared, not used", changelogUrl: changelogUrl(record0, String(info.version ?? "")),
    words: `${name} ${String(info.baseVersion ?? "")} and ${String(info.version ?? "")}, same samples and settings`,
    dismissed: info.dismissed === true,
  };
}

/** "Keep 2.9.0": the comparison is put away (the trial run stays in Data). */
export async function dismissCompare(stepId: string): Promise<void> {
  const row = await db.exploreAnalysisRun.findFirst({ where: { analysisId: stepId, id: { startsWith: "cmp_" } }, orderBy: { createdAt: "desc" }, select: { id: true, results: true } });
  if (!row) throw flowError("invalid_request", "There is no comparison to put away.");
  const results = record(JSON.parse(row.results ?? "{}"));
  await db.exploreAnalysisRun.update({ where: { id: row.id }, data: { results: JSON.stringify({ ...results, compare: { ...record(results.compare), dismissed: true } }) } });
}

export const schemaKeys = (schema: string) => parseSchema(schema).columns.map((column) => column.key);
