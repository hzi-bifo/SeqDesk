/**
 * Housekeeping for real use: deleting an analysis (flow) with everything it
 * wrote, pruning the outputs of old runs nobody relies on, and the background
 * queue that removes the files afterwards.
 *
 * Database rows go in one transaction; files are removed later by
 * processCleanupJobs (the explore monitor runs it every tick), and only ever
 * inside the Explore storage roots.
 *
 * What protects a run from pruning: it is the flow's current run, a report
 * (its page, or a saved version of the page) mentions it, one of its step
 * runs, table versions or artifacts, a hold (a pinned check or a Writer
 * citation) is on it, a kept run reuses or reads what it wrote, or it is
 * younger than the cut-off. Pruned runs keep their record, plan, summary,
 * artifact list with checksums, logs and outputs/manifest.json, and carry
 * outputsPrunedAt.
 */
import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { ExploreReportError } from "./reports";
import { ExploreRouteError } from "./route-error";
import { isPathInsideBase, resolveExploreStorage, sanitizeSegment } from "./storage";
import { effectiveStorageSettings } from "./storage-settings";

export const DEFAULT_PRUNE_AFTER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days after which a run's outputs may be pruned: SEQDESK_EXPLORE_PRUNE_AFTER_DAYS, default 30. */
export function pruneAfterDays(): number {
  const raw = Number(process.env.SEQDESK_EXPLORE_PRUNE_AFTER_DAYS);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_PRUNE_AFTER_DAYS;
}

export type CleanupEntry = { path: string; mode: "remove" | "run-outputs" };

/** What a run folder keeps when its outputs are pruned: everything but these. */
const RUN_FOLDER_BULK = ["inputs", "tmp", "home", "lib"];
const RUN_OUTPUTS_KEEP = new Set(["manifest.json"]);

// ---------------------------------------------------------------------------
// Citations

export interface FlowCitations {
  reports: { id: string; title: string }[];
  holds: { kind: string; key: string; runNumber: number | null }[];
}

/** The texts a report cites things by: its page and its saved versions. */
async function reportTexts(targetKey: string | null): Promise<{ id: string; title: string; text: string }[]> {
  const reports = await db.exploreReport.findMany({
    where: targetKey ? { targetKey } : {},
    select: { id: true, title: true, blocks: true, review: { select: { versions: true } } },
  });
  return reports.map((report) => ({ id: report.id, title: report.title, text: `${JSON.stringify(report.blocks ?? null)}\n${JSON.stringify(report.review?.versions ?? null)}` }));
}

/** The reports and holds that keep a flow from being deleted. */
export async function flowCitations(flowId: string): Promise<FlowCitations & { targetKey: string }> {
  const flow = await db.exploreFlow.findUnique({ where: { id: flowId }, select: { id: true, targetKey: true, analyses: { select: { id: true } } } });
  if (!flow) throw new ExploreReportError(404, "Flow not found");
  const analysisIds = flow.analyses.map((analysis) => analysis.id);
  const datasetIds = await flowDatasetIds(analysisIds);
  const needles = [flow.id, ...analysisIds, ...datasetIds];
  const reports = (await reportTexts(flow.targetKey)).filter((report) => needles.some((needle) => report.text.includes(needle))).map(({ id, title }) => ({ id, title }));
  const holds = await db.exploreRunHold.findMany({ where: { flowRun: { flowId } }, select: { kind: true, key: true, flowRun: { select: { number: true } } } });
  return { targetKey: flow.targetKey, reports, holds: holds.map((hold) => ({ kind: hold.kind, key: hold.key, runNumber: hold.flowRun.number })) };
}

/** Output tables the flow's steps wrote (derived datasets). */
async function flowDatasetIds(analysisIds: string[]): Promise<string[]> {
  if (!analysisIds.length) return [];
  const fromArtifacts = await db.exploreArtifact.findMany({ where: { run: { analysisId: { in: analysisIds } }, derivedDatasetId: { not: null } }, select: { derivedDatasetId: true } });
  const ids = new Set(fromArtifacts.map((artifact) => artifact.derivedDatasetId!).filter(Boolean));
  // Output tables declared before any run wrote them name the step in their source configuration.
  const derived = await db.exploreDataset.findMany({ where: { kind: "derived" }, select: { id: true, sourceConfig: true } });
  for (const dataset of derived) {
    try {
      const config = JSON.parse(dataset.sourceConfig ?? "{}") as { analysisId?: string };
      if (config.analysisId && analysisIds.includes(config.analysisId)) ids.add(dataset.id);
    } catch { /* not ours */ }
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// Deleting a flow

export interface FlowDeletion {
  flowId: string;
  datasets: string[];
  keptDatasets: string[];
  inputs: number;
  entries: CleanupEntry[];
  jobId: string | null;
}

function citedMessage(citations: FlowCitations): string {
  const parts: string[] = [];
  if (citations.reports.length) parts.push(`cited by ${citations.reports.length === 1 ? "report" : "reports"} ${citations.reports.map((report) => `“${report.title}”`).join(", ")}`);
  const writer = citations.holds.filter((hold) => hold.kind === "writer");
  const checks = citations.holds.filter((hold) => hold.kind !== "writer");
  if (writer.length) parts.push(`cited in Writer (${writer.length} ${writer.length === 1 ? "value" : "values"})`);
  if (checks.length) parts.push(`pinned by ${checks.length} ${checks.length === 1 ? "check" : "checks"}`);
  return `This analysis is ${parts.join(" and ")}. Remove those citations first; its runs stay until then.`;
}

/**
 * Delete a flow and everything it owns: its inputs, steps, runs, output tables
 * and their stored files. Refused (409) while a report, Writer or a pinned
 * check cites it. Output tables another flow reads are kept.
 */
export async function deleteFlowWithOutputs(flowId: string): Promise<FlowDeletion> {
  const citations = await flowCitations(flowId);
  if (citations.reports.length || citations.holds.length) {
    throw new ExploreRouteError(409, citedMessage(citations), "cited", { citations: { reports: citations.reports, holds: citations.holds } });
  }
  const analyses = await db.exploreAnalysis.findMany({ where: { flowId }, select: { id: true } });
  const analysisIds = analyses.map((analysis) => analysis.id);
  const candidateDatasets = await flowDatasetIds(analysisIds);
  // Another flow's input or another step's code reading the table keeps it.
  const keptDatasets: string[] = [];
  for (const datasetId of candidateDatasets) {
    const [inputs] = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "ExploreFlowInput" WHERE "datasetId" = ${datasetId} AND "flowId" <> ${flowId}`;
    const readers = await db.exploreAnalysisRevision.count({ where: { inputs: { contains: datasetId }, analysis: { OR: [{ flowId: null }, { flowId: { not: flowId } }] } } });
    if (Number(inputs?.n ?? 0) > 0 || readers > 0) keptDatasets.push(datasetId);
  }
  const datasets = candidateDatasets.filter((id) => !keptDatasets.includes(id));
  const stepRuns = analysisIds.length ? await db.exploreAnalysisRun.findMany({ where: { analysisId: { in: analysisIds } }, select: { runFolder: true } }) : [];
  const capsules = await db.exploreCapsule.findMany({ where: { flowRun: { flowId } }, select: { path: true } });
  const storage = await resolveExploreStorage();
  const entries: CleanupEntry[] = [
    ...stepRuns.flatMap((run) => (run.runFolder ? [{ path: run.runFolder, mode: "remove" as const }] : [])),
    ...capsules.flatMap((capsule) => (capsule.path ? [{ path: capsule.path, mode: "remove" as const }] : [])),
    ...datasets.map((id) => ({ path: path.join(storage.datasetsRoot, sanitizeSegment(id)), mode: "remove" as const })),
  ];
  const result = await db.$transaction(async (tx) => {
    const inputs = await tx.$executeRaw`DELETE FROM "ExploreFlowInput" WHERE "flowId" = ${flowId}`;
    // The flow's steps, revisions, step runs, artifacts, numbered runs, holds and capsules cascade.
    await tx.exploreFlow.delete({ where: { id: flowId } });
    if (datasets.length) await tx.exploreDataset.deleteMany({ where: { id: { in: datasets } } });
    const job = entries.length ? await tx.exploreCleanupJob.create({ data: { kind: "flow-delete", reason: `flow ${flowId}`, entries } }) : null;
    return { inputs: Number(inputs), jobId: job?.id ?? null };
  });
  return { flowId, datasets, keptDatasets, inputs: result.inputs, entries, jobId: result.jobId };
}

// ---------------------------------------------------------------------------
// Pruning old run outputs

export type KeepReason = "current" | "cited" | "held" | "recent" | "reused" | "unfinished";

export interface PrunableRun {
  id: string;
  flowId: string;
  flowName: string;
  targetKey: string;
  number: number | null;
  trialNumber: number | null;
  finishedAt: string;
  stepRuns: { id: string; runNumber: string; runFolder: string | null }[];
  versions: { id: string; datasetId: string; number: number; rowCount: number; storagePath: string | null }[];
}

export interface PrunePlan {
  olderThanDays: number;
  cutoff: string;
  runs: PrunableRun[];
  kept: Record<KeepReason, number>;
  alreadyPruned: number;
}

const FINISHED = ["completed", "failed", "cancelled"];

/** What a prune would remove now; nothing is changed. */
export async function planPrune(options: { olderThanDays?: number; targetKey?: string | null; now?: Date } = {}): Promise<PrunePlan> {
  const olderThanDays = options.olderThanDays && options.olderThanDays >= 1 ? Math.floor(options.olderThanDays) : (await effectiveStorageSettings().then((settings) => settings.pruneAfterDays, () => pruneAfterDays()));
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - olderThanDays * DAY_MS);
  const targetKey = options.targetKey ?? null;
  const runs = await db.exploreFlowRun.findMany({
    where: targetKey ? { flow: { targetKey } } : {},
    select: {
      id: true, flowId: true, number: true, trialNumber: true, status: true, completedAt: true, queuedAt: true, outputsPrunedAt: true,
      plan: true, inputs: true,
      flow: { select: { name: true, targetKey: true, currentRunId: true } },
      holds: { select: { id: true } },
      stepRuns: { select: { id: true, runNumber: true, runFolder: true, reusedFromRunId: true, inputPins: true, artifacts: { select: { id: true, derivedDatasetId: true, derivedVersionId: true } } } },
    },
  });
  const kept: Record<KeepReason, number> = { current: 0, cited: 0, held: 0, recent: 0, reused: 0, unfinished: 0 };
  const reports = await reportTexts(targetKey);
  const reportText = reports.map((report) => report.text).join("\n");
  const needlesOf = (run: (typeof runs)[number]) => [run.id, ...run.stepRuns.flatMap((step) => [step.id, step.runNumber, ...step.artifacts.flatMap((artifact) => [artifact.id, artifact.derivedVersionId ?? ""])])].filter(Boolean);

  let candidates = runs.filter((run) => {
    if (run.outputsPrunedAt) return false;
    if (!FINISHED.includes(run.status)) { kept.unfinished += 1; return false; }
    if (run.flow.currentRunId === run.id) { kept.current += 1; return false; }
    if (run.holds.length) { kept.held += 1; return false; }
    if ((run.completedAt ?? run.queuedAt) > cutoff) { kept.recent += 1; return false; }
    if (needlesOf(run).some((needle) => reportText.includes(needle))) { kept.cited += 1; return false; }
    return true;
  });

  // A kept run that reuses a step run, or reads a table version, of a candidate keeps that candidate too.
  for (;;) {
    const candidateIds = new Set(candidates.map((run) => run.id));
    const keptText = runs.filter((run) => !candidateIds.has(run.id) && !run.outputsPrunedAt)
      .map((run) => JSON.stringify([run.plan, run.inputs, run.stepRuns.map((step) => [step.reusedFromRunId, step.inputPins])])).join("\n");
    const next = candidates.filter((run) => !needlesOf(run).some((needle) => keptText.includes(needle)));
    if (next.length === candidates.length) break;
    kept.reused += candidates.length - next.length;
    candidates = next;
  }

  // Table versions the candidates wrote that are no dataset's current version.
  const versionIds = [...new Set(candidates.flatMap((run) => run.stepRuns.flatMap((step) => step.artifacts.map((artifact) => artifact.derivedVersionId).filter((id): id is string => Boolean(id)))))];
  const versions = versionIds.length ? await db.exploreDatasetVersion.findMany({ where: { id: { in: versionIds } }, select: { id: true, datasetId: true, number: true, rowCount: true, storagePath: true, dataset: { select: { currentVersionId: true } } } }) : [];
  const revisionText = versionIds.length ? (await db.exploreAnalysisRevision.findMany({ where: { OR: versionIds.map((id) => ({ inputs: { contains: id } })) }, select: { inputs: true } })).map((revision) => revision.inputs).join("\n") : "";
  const prunableVersion = new Map(versions.filter((version) => version.dataset.currentVersionId !== version.id && !revisionText.includes(version.id)).map((version) => [version.id, version]));

  const alreadyPruned = runs.filter((run) => run.outputsPrunedAt).length;
  return {
    olderThanDays,
    cutoff: cutoff.toISOString(),
    alreadyPruned,
    kept,
    runs: candidates.map((run) => ({
      id: run.id, flowId: run.flowId, flowName: run.flow.name, targetKey: run.flow.targetKey, number: run.number, trialNumber: run.trialNumber,
      finishedAt: (run.completedAt ?? run.queuedAt).toISOString(),
      stepRuns: run.stepRuns.filter((step) => !step.reusedFromRunId).map((step) => ({ id: step.id, runNumber: step.runNumber, runFolder: step.runFolder })),
      versions: run.stepRuns.flatMap((step) => step.artifacts.map((artifact) => (artifact.derivedVersionId ? prunableVersion.get(artifact.derivedVersionId) : undefined)))
        .filter((version): version is NonNullable<typeof version> => Boolean(version))
        .map((version) => ({ id: version.id, datasetId: version.datasetId, number: version.number, rowCount: version.rowCount, storagePath: version.storagePath })),
    })),
  };
}

export interface PruneResult extends PrunePlan { dryRun: boolean; jobId: string | null; prunedAt: string | null }

/**
 * Prune the outputs of old runs (see planPrune). With dryRun nothing changes
 * and the plan says what would go.
 */
export async function pruneRuns(options: { olderThanDays?: number; targetKey?: string | null; dryRun?: boolean; now?: Date } = {}): Promise<PruneResult> {
  const plan = await planPrune(options);
  if (options.dryRun || !plan.runs.length) return { ...plan, dryRun: Boolean(options.dryRun), jobId: null, prunedAt: null };
  const now = options.now ?? new Date();
  const versionIds = [...new Set(plan.runs.flatMap((run) => run.versions.map((version) => version.id)))];
  const entries: CleanupEntry[] = [
    ...plan.runs.flatMap((run) => run.stepRuns.flatMap((step) => (step.runFolder ? [{ path: step.runFolder, mode: "run-outputs" as const }] : []))),
    ...plan.runs.flatMap((run) => run.versions.flatMap((version) => (version.storagePath ? [{ path: version.storagePath, mode: "remove" as const }] : []))),
  ];
  const jobId = await db.$transaction(async (tx) => {
    // The version rows (and their data rows) go; artifacts keep their names and checksums.
    if (versionIds.length) await tx.exploreDatasetVersion.deleteMany({ where: { id: { in: versionIds } } });
    await tx.exploreFlowRun.updateMany({ where: { id: { in: plan.runs.map((run) => run.id) }, outputsPrunedAt: null }, data: { outputsPrunedAt: now } });
    const job = entries.length ? await tx.exploreCleanupJob.create({ data: { kind: "prune", reason: `${plan.runs.length} runs older than ${plan.olderThanDays} days`, entries } }) : null;
    return job?.id ?? null;
  });
  return { ...plan, dryRun: false, jobId, prunedAt: now.toISOString() };
}

/** The daily prune the monitor runs: at most once per 24 hours across processes. */
export async function runDailyPrune(now = new Date()): Promise<PruneResult | null> {
  const last = await db.exploreCleanupJob.findFirst({ where: { kind: "prune-pass" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (last && now.getTime() - last.createdAt.getTime() < DAY_MS) return null;
  await db.exploreCleanupJob.create({ data: { kind: "prune-pass", status: "done", doneAt: now, reason: "daily prune" } });
  return pruneRuns({ now });
}

/** Counts for the Data › project view. */
export async function housekeepingCounts(targetKey: string, now = new Date()): Promise<{ earlierRuns: number; prunable: number; pruned: number; olderThanDays: number; lastPrunedAt: string | null }> {
  const runs = await db.exploreFlowRun.findMany({ where: { flow: { targetKey }, status: "completed", kind: { not: "trial" } }, select: { id: true, outputsPrunedAt: true, flow: { select: { currentRunId: true } } } });
  const earlier = runs.filter((run) => run.flow.currentRunId !== run.id);
  const plan = await planPrune({ targetKey, now });
  const pruned = earlier.filter((run) => run.outputsPrunedAt);
  const last = pruned.map((run) => run.outputsPrunedAt!.getTime()).sort((a, b) => b - a)[0];
  return { earlierRuns: earlier.length, prunable: plan.runs.length, pruned: pruned.length, olderThanDays: plan.olderThanDays, lastPrunedAt: last ? new Date(last).toISOString() : null };
}

// ---------------------------------------------------------------------------
// The background file cleanup

async function removeRunOutputs(folder: string): Promise<void> {
  for (const name of RUN_FOLDER_BULK) await fs.rm(path.join(folder, name), { recursive: true, force: true });
  const outputs = path.join(folder, "outputs");
  const names = await fs.readdir(outputs).catch(() => [] as string[]);
  for (const name of names) if (!RUN_OUTPUTS_KEEP.has(name)) await fs.rm(path.join(outputs, name), { recursive: true, force: true });
  await fs.writeFile(path.join(folder, "PRUNED"), `Outputs pruned on ${new Date().toISOString()}; outputs/manifest.json, logs and the recorded checksums stay.\n`).catch(() => {});
}

/** Remove the files of queued cleanup jobs; paths outside Explore storage are refused, never touched. */
export async function processCleanupJobs(limit = 5): Promise<{ done: number; failed: number }> {
  const jobs = await db.exploreCleanupJob.findMany({ where: { status: "queued", attempts: { lt: 5 } }, orderBy: { createdAt: "asc" }, take: limit });
  if (!jobs.length) return { done: 0, failed: 0 };
  const storage = await resolveExploreStorage();
  const roots = [storage.baseDir, storage.runsRoot];
  let done = 0;
  let failed = 0;
  for (const job of jobs) {
    const problems: string[] = [];
    for (const entry of (job.entries as CleanupEntry[] | null) ?? []) {
      const target = path.resolve(entry.path);
      if (!roots.some((root) => isPathInsideBase(target, root)) || roots.some((root) => path.resolve(root) === target)) {
        problems.push(`outside Explore storage: ${entry.path}`);
        continue;
      }
      try {
        if (entry.mode === "run-outputs") await removeRunOutputs(target);
        else await fs.rm(target, { recursive: true, force: true });
      } catch (error) {
        problems.push(`${entry.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const attempts = job.attempts + 1;
    // Refused paths never succeed on retry: the job fails at once and says why.
    const final = !problems.length || attempts >= 5 || problems.every((problem) => problem.startsWith("outside"));
    await db.exploreCleanupJob.update({ where: { id: job.id }, data: { attempts, status: problems.length ? (final ? "failed" : "queued") : "done", error: problems.length ? problems.join("\n").slice(0, 4000) : null, doneAt: final ? new Date() : null } });
    if (problems.length) failed += 1; else done += 1;
  }
  return { done, failed };
}
