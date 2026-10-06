/**
 * "New samples only" (identity sheet 96 f5): for a pipeline whose manifest says it can add samples to its tables
 * (`incremental: true` with a merge rule per table), a run of just the samples that are new since the step's last run;
 * its tables are then built from both runs (each sample from one run). Elsewhere the option is shown off, with the
 * pipeline's reason, in the run plan.
 */
import { db } from "@/lib/db";
import { pipelineRecord } from "./pipeline-record";
import type { PipelineStepConfig, StepReads } from "./pipeline-steps";
import { snapshotOf } from "./pipeline-step-runs";

/** The step's last finished pipeline run and the samples (by name) it ran on, with the runs it merged. */
export async function lastRunSamples(analysisId: string, exceptStepRunId?: string | null): Promise<{ pipelineRunIds: string[]; names: Set<string> } | null> {
  const last = await db.exploreAnalysisRun.findFirst({ where: { analysisId, executionMode: "pipeline", status: "completed", pipelineRunId: { not: null }, ...(exceptStepRunId ? { id: { not: exceptStepRunId } } : {}) }, orderBy: { createdAt: "desc" }, select: { pipelineRunId: true, results: true } });
  if (!last?.pipelineRunId) return null;
  const runIds = [last.pipelineRunId, ...(snapshotOf(last.results)?.incremental?.baseRunIds ?? [])];
  const runs = await db.pipelineRun.findMany({ where: { id: { in: runIds } }, select: { id: true, inputSampleIds: true } });
  const ids = runs.flatMap((run) => { try { const parsed = JSON.parse(run.inputSampleIds ?? "null"); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } });
  const samples = ids.length ? await db.sample.findMany({ where: { id: { in: ids } }, select: { sampleId: true } }) : [];
  return { pipelineRunIds: [...new Set(runIds)], names: new Set(samples.map((sample) => sample.sampleId).filter((name): name is string => Boolean(name))) };
}

/** The Data sample ids that are new since the step's last run (by the names the runs use), or why not. */
export async function newSamplesSince(analysisId: string, config: PipelineStepConfig, reads: Pick<StepReads, "samples" | "names">, exceptStepRunId?: string | null): Promise<{ samples: string[]; baseRunIds: string[]; refusal: string | null }> {
  const incremental = pipelineRecord(config.pipelineId).incremental;
  if (!incremental.allowed) return { samples: [], baseRunIds: [], refusal: incremental.reason ?? "its pipeline makes its tables from all samples together." };
  const last = await lastRunSamples(analysisId, exceptStepRunId);
  if (!last) return { samples: [], baseRunIds: [], refusal: "it has not run yet; run all samples first." };
  const fresh = reads.samples.filter((id) => !last.names.has(reads.names?.[id] ?? id));
  if (!fresh.length) return { samples: [], baseRunIds: [], refusal: "no sample is new since its last run." };
  return { samples: fresh, baseRunIds: last.pipelineRunIds, refusal: null };
}

/** For the run plan: how many samples are new since the step's last run, and whether it may run only those. */
export async function newSamplesOption(analysisId: string, config: PipelineStepConfig, reads: Pick<StepReads, "samples" | "names">, name: string): Promise<{ count: number; allowed: boolean; words: string } | null> {
  const last = await lastRunSamples(analysisId);
  if (!last) return null;
  const count = reads.samples.filter((id) => !last.names.has(reads.names?.[id] ?? id)).length;
  if (!count) return null;
  const incremental = pipelineRecord(config.pipelineId).incremental;
  const samples = `${count} new sample${count === 1 ? "" : "s"}`;
  return incremental.allowed
    ? { count, allowed: true, words: `Run only the ${samples}, merged into the same tables` }
    : { count, allowed: false, words: `Not for ${name}: ${incremental.reason ?? "it makes its tables from all samples together."}` };
}
