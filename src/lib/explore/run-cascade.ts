/**
 * Cascading runs: when a run changed an output table, the analyses that read
 * that table run again, so a chain x -> y -> z follows a press of Run on x.
 * Unchanged outputs (same content hash, no new version) stop the chain.
 */
import { db } from "@/lib/db";
import { parseInputBindings, type RunSummary } from "./analyses";
import { createAndStartRun, ExploreRunError } from "./runner";
import { parseJsonObject } from "./schema";
import type { ExploreProvenance } from "./types";

const ACTIVE = new Set(["pending", "queued", "running"]);

export interface CascadeResult {
  /** Tables whose current version was written by the run. */
  changedDatasets: string[];
  started: Array<{ analysisId: string; name: string; run: RunSummary }>;
  skipped: Array<{ analysisId: string; name: string; reason: string }>;
}

/** Ids of the output tables whose current version this run wrote. */
export async function datasetsChangedByRun(runId: string, targetKey: string): Promise<string[]> {
  const datasets = await db.exploreDataset.findMany({
    where: { targetKey, kind: "derived" },
    include: { versions: { orderBy: { number: "desc" }, take: 1 } },
  });
  const changed: string[] = [];
  for (const dataset of datasets) {
    const current = dataset.versions.find((version) => version.id === dataset.currentVersionId) ?? dataset.versions[0];
    const provenance = parseJsonObject(current?.provenance) as unknown as ExploreProvenance | null;
    if (provenance?.sources?.some((source) => source.type === "analysis-run" && source.id === runId)) changed.push(dataset.id);
  }
  return changed;
}

/**
 * Start the analyses downstream of a completed run whose inputs it changed.
 * Skips the run's own analysis, analyses already running, and analyses that
 * ran after this run finished (they saw the new table already).
 */
export async function cascadeFromRun(runId: string, userId: string): Promise<CascadeResult> {
  const run = await db.exploreAnalysisRun.findUnique({
    where: { id: runId },
    include: { analysis: { select: { id: true, targetKey: true } } },
  });
  if (!run) throw new ExploreRunError(404, "Run not found");
  const result: CascadeResult = { changedDatasets: [], started: [], skipped: [] };
  if (run.status !== "completed") return result;
  result.changedDatasets = await datasetsChangedByRun(runId, run.analysis.targetKey);
  if (result.changedDatasets.length === 0) return result;
  const changed = new Set(result.changedDatasets);

  const analyses = await db.exploreAnalysis.findMany({
    where: { targetKey: run.analysis.targetKey },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const revisionIds = analyses.map((analysis) => analysis.currentRevisionId).filter((id): id is string => Boolean(id));
  const revisions = await db.exploreAnalysisRevision.findMany({ where: { id: { in: revisionIds } } });
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision] as const));
  const finishedAt = run.completedAt ?? run.createdAt;

  for (const analysis of analyses) {
    if (analysis.id === run.analysis.id) continue;
    const revision = analysis.currentRevisionId ? revisionById.get(analysis.currentRevisionId) : undefined;
    const reads = parseInputBindings(revision?.inputs).some((binding) => changed.has(binding.datasetId));
    if (!reads) continue;
    const latest = analysis.runs[0];
    if (latest && ACTIVE.has(latest.status)) {
      result.skipped.push({ analysisId: analysis.id, name: analysis.name, reason: "already running" });
      continue;
    }
    if (latest && latest.createdAt > finishedAt) {
      result.skipped.push({ analysisId: analysis.id, name: analysis.name, reason: "ran after this run finished" });
      continue;
    }
    try {
      const started = await createAndStartRun({
        analysisId: analysis.id,
        executionMode: run.executionMode === "local" || run.executionMode === "slurm" ? run.executionMode : "default",
        createdById: userId,
      });
      result.started.push({ analysisId: analysis.id, name: analysis.name, run: started });
    } catch (error) {
      result.skipped.push({ analysisId: analysis.id, name: analysis.name, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
