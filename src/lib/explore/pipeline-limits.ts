/**
 * Limits on pipeline steps (identity sheet 96, PIPELINE-STEPS-PLAN §6): how many pipeline steps of one study may run
 * pipelines at the same time (default 1, an admin setting), and the lab's compute used this month for the Run
 * confirmation — from the Nextflow traces of the lab's pipeline runs, when they are still there. A server that cannot
 * tell says nothing rather than a guess.
 */
import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import { dataStudyAlias } from "@/lib/pipelines/data-study";
import { parseTraceContent } from "@/lib/pipelines/nextflow/trace-parser";
import type { PipelineAccess } from "./pipeline-steps";

const ACTIVE = ["pending", "queued", "running"];
const SETTINGS_KEY = "explorePipelineSteps";

export interface PipelineStepSettings {
  /** Pipeline steps of one study that may run pipelines at once; a step over the limit waits ("queued"). */
  maxConcurrentPerStudy: number;
}
export const DEFAULT_PIPELINE_STEP_SETTINGS: PipelineStepSettings = { maxConcurrentPerStudy: 1 };

async function readExtra(): Promise<Record<string, unknown>> {
  const stored = await db.siteSettings.findUnique({ where: { id: "singleton" }, select: { extraSettings: true } }).catch(() => null);
  if (!stored?.extraSettings) return {};
  try { return JSON.parse(stored.extraSettings) as Record<string, unknown>; } catch { return {}; }
}

export function normalizePipelineStepSettings(raw: unknown): PipelineStepSettings {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const max = typeof value.maxConcurrentPerStudy === "number" && Number.isFinite(value.maxConcurrentPerStudy) ? Math.floor(value.maxConcurrentPerStudy) : DEFAULT_PIPELINE_STEP_SETTINGS.maxConcurrentPerStudy;
  return { maxConcurrentPerStudy: Math.min(Math.max(max, 1), 20) };
}

export async function pipelineStepSettings(): Promise<PipelineStepSettings> {
  return normalizePipelineStepSettings((await readExtra())[SETTINGS_KEY]);
}

/** The admin changes the limits (system.pipelines.manage). */
export async function savePipelineStepSettings(raw: unknown, access: PipelineAccess): Promise<PipelineStepSettings> {
  if (!access.canManage) throw flowError("forbidden", "Only this Compute server’s admin changes the limits of pipeline steps.");
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (value.maxConcurrentPerStudy !== undefined && (typeof value.maxConcurrentPerStudy !== "number" || !Number.isInteger(value.maxConcurrentPerStudy) || value.maxConcurrentPerStudy < 1 || value.maxConcurrentPerStudy > 20)) {
    throw flowError("invalid_request", "maxConcurrentPerStudy is a whole number from 1 to 20.");
  }
  const extra = await readExtra();
  const settings = normalizePipelineStepSettings({ ...normalizePipelineStepSettings(extra[SETTINGS_KEY]), ...value });
  extra[SETTINGS_KEY] = settings;
  await db.siteSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", extraSettings: JSON.stringify(extra) }, update: { extraSettings: JSON.stringify(extra) } });
  return settings;
}

/** Pipeline steps of a study whose pipeline run is going now (another recipe run's), not counting `exceptStepRunId`. */
export async function activePipelineSteps(targetKey: string, exceptStepRunId?: string | null): Promise<Array<{ stepRunId: string; analysisId: string; pipelineRunId: string }>> {
  const analyses = await db.exploreAnalysis.findMany({ where: { targetKey, stepKind: "pipeline" }, select: { id: true } }).catch(() => [] as Array<{ id: string }>);
  if (!analyses.length) return [];
  const runs = await db.exploreAnalysisRun.findMany({
    where: { analysisId: { in: analyses.map((analysis) => analysis.id) }, executionMode: "pipeline", status: { in: ACTIVE }, pipelineRunId: { not: null }, ...(exceptStepRunId ? { id: { not: exceptStepRunId } } : {}) },
    select: { id: true, analysisId: true, pipelineRunId: true },
  });
  const ids = [...new Set(runs.map((run) => run.pipelineRunId!).filter(Boolean))];
  const going = ids.length ? new Set((await db.pipelineRun.findMany({ where: { id: { in: ids }, status: { in: ACTIVE } }, select: { id: true } })).map((run) => run.id)) : new Set<string>();
  const seen = new Set<string>();
  return runs.filter((run) => run.pipelineRunId && going.has(run.pipelineRunId) && !seen.has(run.pipelineRunId) && seen.add(run.pipelineRunId)).map((run) => ({ stepRunId: run.id, analysisId: run.analysisId, pipelineRunId: run.pipelineRunId! }));
}

export interface PipelineCapacity { max: number; active: number; free: boolean; words: string | null }

/** Whether a pipeline step of this study may start a pipeline run now, and if not, in words. */
export async function pipelineCapacity(targetKey: string, exceptStepRunId?: string | null): Promise<PipelineCapacity> {
  const [settings, active] = await Promise.all([pipelineStepSettings(), activePipelineSteps(targetKey, exceptStepRunId)]);
  const free = active.length < settings.maxConcurrentPerStudy;
  return {
    max: settings.maxConcurrentPerStudy, active: active.length, free,
    words: free ? null : `Waits for ${active.length === 1 ? "the pipeline" : `${active.length} pipelines`} of this study that ${active.length === 1 ? "is" : "are"} running now (at most ${settings.maxConcurrentPerStudy} at a time)`,
  };
}

// ---------------------------------------------------------------------------
// The lab's compute this month
// ---------------------------------------------------------------------------

export interface LabCompute {
  /** CPU hours of the lab's pipeline runs since the first of the month, from their Nextflow traces. */
  cpuHours: number;
  runs: number;
  /** Runs whose trace is gone (pruned): their hours are not counted. */
  unknownRuns: number;
  since: string;
  words: string;
}

const computeCache = new Map<string, { at: number; value: LabCompute | null }>();

/** CPU hours of one run's trace: realtime × CPU share of each finished task (the last attempt per task). */
export async function traceCpuHours(runFolder: string | null): Promise<number | null> {
  if (!runFolder) return null;
  const text = await fs.readFile(path.join(runFolder, "trace.txt"), "utf8").catch(() => null);
  if (!text) return null;
  try {
    const tasks = parseTraceContent(text).tasks;
    return tasks.reduce((sum, task) => sum + ((task.realtime ?? 0) / 3_600_000) * ((task.cpuPercent ?? 100) / 100), 0);
  } catch {
    return null;
  }
}

/**
 * The compute the lab's pipeline runs used this month (every study of the lab's workspace), or null when the server
 * cannot tell (no runs with a trace). Cached for ten minutes.
 */
export async function labComputeThisMonth(labKey: string | null | undefined, now = new Date()): Promise<LabCompute | null> {
  if (!labKey) return null;
  const since = new Date(now.getFullYear(), now.getMonth(), 1);
  const key = `${labKey}|${since.toISOString()}`;
  const cached = computeCache.get(key);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.value;
  const [authority, workspaceId] = labKey.split("|");
  const scopes = await db.integrationExploreScope.findMany({ where: { authority, workspaceId }, select: { targetKey: true }, take: 500 }).catch(() => [] as Array<{ targetKey: string }>);
  let value: LabCompute | null = null;
  if (scopes.length) {
    const studies = await db.study.findMany({ where: { alias: { in: scopes.map((scope) => dataStudyAlias(scope.targetKey)) } }, select: { id: true } });
    const runs = studies.length ? await db.pipelineRun.findMany({ where: { studyId: { in: studies.map((study) => study.id) }, startedAt: { gte: since } }, select: { id: true, runFolder: true }, take: 500 }) : [];
    let hours = 0, counted = 0, unknown = 0;
    for (const run of runs) {
      const cpu = await traceCpuHours(run.runFolder);
      if (cpu === null) unknown += 1;
      else { hours += cpu; counted += 1; }
    }
    if (counted) {
      const month = since.toLocaleString("en-US", { month: "long" });
      const rounded = Math.round(hours);
      value = { cpuHours: rounded, runs: counted, unknownRuns: unknown, since: since.toISOString(), words: `${rounded.toLocaleString("en-US")} CPU hours used by the lab since 1 ${month}${unknown ? ` (${unknown} run${unknown === 1 ? "" : "s"} without a trace not counted)` : ""}` };
    }
  }
  computeCache.set(key, { at: Date.now(), value });
  if (computeCache.size > 50) computeCache.delete(computeCache.keys().next().value!);
  return value;
}

/** For tests. */
export function resetLabComputeCache(): void { computeCache.clear(); }

/** CPU hours of the finished runs of a pipeline here, per sample (for an estimate of a new run); null when unknown. */
export async function cpuHoursPerSample(pipelineId: string): Promise<number | null> {
  const runs = await db.pipelineRun.findMany({ where: { pipelineId, status: "completed" }, select: { runFolder: true, inputSampleIds: true }, orderBy: { completedAt: "desc" }, take: 5 }).catch(() => [] as Array<{ runFolder: string | null; inputSampleIds: string | null }>);
  const rates: number[] = [];
  for (const run of runs) {
    let samples = 0;
    try { const ids = JSON.parse(run.inputSampleIds ?? "null"); samples = Array.isArray(ids) ? ids.length : 0; } catch { samples = 0; }
    const cpu = samples ? await traceCpuHours(run.runFolder) : null;
    if (cpu !== null && cpu > 0) rates.push(cpu / samples);
  }
  if (!rates.length) return null;
  rates.sort((a, b) => a - b);
  return rates[Math.floor((rates.length - 1) / 2)];
}
