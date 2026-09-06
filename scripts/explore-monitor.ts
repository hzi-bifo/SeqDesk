import path from "path";
import { db } from "../src/lib/db";
import { readTail } from "../src/lib/pipelines/nextflow";
import { inferPipelineExitCode } from "../src/lib/pipelines/run-completion";
import { queueSnapshotToRunStatus, readIdentityCheckedQueueSnapshot } from "../src/lib/pipelines/queue-probe";
import { finalizeExploreRun } from "../src/lib/explore/run-finalize";

const DEFAULT_INTERVAL_MS = 10000;
const ACTIVE = ["pending", "queued", "running"];
// A run whose folder never appeared is failed after this long: preparation
// crashed before the launch could be recorded.
const PREPARE_GRACE_MS = 5 * 60 * 1000;
// A local process that is gone without a marker is only declared dead after
// this grace period: the wrapper writes the marker in its EXIT trap, so a run
// that finishes between the marker check and the process check would
// otherwise be failed although it succeeded.
const LOCAL_EXIT_GRACE_MS = 30 * 1000;
// The scheduler can report a job as finished before its exit marker is
// visible on a shared filesystem. The wait starts the first time that is seen
// for a run; once it exceeds this, the run is failed instead of staying
// "running" forever. A monitor restart simply restarts the wait.
export const MARKER_GRACE_MS = 5 * 60 * 1000;
const schedulerDoneSince = new Map<string, number>();

export interface SyncExploreRunOptions {
  /** Clock in milliseconds, injectable for tests. */
  now?: () => number;
  markerGraceMs?: number;
}

/**
 * Bring one active Explore run up to date. The canonical completion signal is
 * the wrapper's exit marker in logs/pipeline.out; the scheduler or process
 * state only refines "queued" versus "running" and catches runs that died
 * without writing a marker.
 */
export async function syncExploreRun(
  run: {
    id: string;
    status: string;
    runFolder: string | null;
    queueJobId: string | null;
    createdAt: Date;
    startedAt?: Date | null;
  },
  options: SyncExploreRunOptions = {}
): Promise<void> {
  const now = options.now?.() ?? Date.now();
  const markerGraceMs = options.markerGraceMs ?? MARKER_GRACE_MS;
  if (!run.runFolder) {
    if (now - run.createdAt.getTime() > PREPARE_GRACE_MS) {
      await db.exploreAnalysisRun.updateMany({
        where: { id: run.id, status: { in: ACTIVE } },
        data: { status: "failed", completedAt: new Date(now), errorTail: "Run was never prepared" },
      });
    }
    return;
  }

  const exitCode = await inferPipelineExitCode(run.runFolder);
  if (exitCode !== null) {
    schedulerDoneSince.delete(run.id);
    await finalizeExploreRun(run.id, exitCode);
    return;
  }

  const snapshot = await readIdentityCheckedQueueSnapshot({
    jobId: run.queueJobId,
    runId: run.id,
    runFolder: run.runFolder,
  });
  const derived = queueSnapshotToRunStatus(snapshot);
  const update: Record<string, unknown> = {};
  const [outputTail, errorTail] = await Promise.all([
    readTail(path.join(run.runFolder, "logs", "pipeline.out")),
    readTail(path.join(run.runFolder, "logs", "pipeline.err")),
  ]);
  if (outputTail) update.outputTail = outputTail;
  if (errorTail) update.errorTail = errorTail;

  if (derived === "running" && run.status !== "running") {
    update.status = "running";
    update.startedAt = new Date(now);
  } else if (derived === "failed" || derived === "cancelled") {
    update.status = derived;
    update.completedAt = new Date(now);
    update.errorTail = `${errorTail ?? ""}\n${snapshot.reason ?? "The process ended without writing an exit marker."}`.trim();
  } else if (derived === "completed") {
    // The scheduler says the job is over but the marker is not there yet. On
    // a shared filesystem it can lag, so wait; past the grace period the job
    // evidently ended without its EXIT trap (killed, or the wrapper could not
    // write), and the run is failed rather than left running.
    const since = schedulerDoneSince.get(run.id) ?? now;
    schedulerDoneSince.set(run.id, since);
    if (now - since >= markerGraceMs) {
      update.status = "failed";
      update.completedAt = new Date(now);
      update.errorTail = `${errorTail ?? ""}\nThe scheduler reports the job as ${snapshot.state ?? "finished"}, but no exit marker appeared within ${Math.round(markerGraceMs / 60000)} minutes.`.trim();
    }
  } else if (!snapshot.identityVerified && run.status === "running" && snapshot.source === "local") {
    // The local process is gone. Look for the marker once more: the wrapper
    // writes it while exiting, so it may have appeared since the first check.
    const lateExitCode = await inferPipelineExitCode(run.runFolder);
    if (lateExitCode !== null) {
      schedulerDoneSince.delete(run.id);
      await finalizeExploreRun(run.id, lateExitCode);
      return;
    }
    const since = run.startedAt ?? run.createdAt;
    if (now - since.getTime() < LOCAL_EXIT_GRACE_MS) return;
    update.status = "failed";
    update.completedAt = new Date(now);
    update.errorTail = `${errorTail ?? ""}\n${snapshot.reason ?? "The analysis process disappeared."}`.trim();
  }
  if (Object.keys(update).length === 0) return;
  if (update.status === "failed" || update.status === "cancelled") schedulerDoneSince.delete(run.id);
  await db.exploreAnalysisRun.updateMany({ where: { id: run.id, status: { in: ACTIVE } }, data: update });
}

async function runOnce(): Promise<void> {
  const runs = await db.exploreAnalysisRun.findMany({
    where: { status: { in: ACTIVE } },
    select: { id: true, status: true, runFolder: true, queueJobId: true, createdAt: true, startedAt: true },
  });
  // Forget marker waits of runs that are no longer active (cancelled, finalized elsewhere).
  const activeIds = new Set(runs.map((run) => run.id));
  for (const id of [...schedulerDoneSince.keys()]) if (!activeIds.has(id)) schedulerDoneSince.delete(id);
  for (const run of runs) {
    try {
      await syncExploreRun(run);
    } catch (error) {
      console.error("[explore-monitor] failed to sync run", run.id, error);
    }
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const interval = Number(process.env.EXPLORE_MONITOR_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  if (args.has("--once")) {
    await runOnce();
    return;
  }
  console.log(`[explore-monitor] running every ${interval}ms`);
  await runOnce();
  setInterval(runOnce, interval);
}

if (!process.env.VITEST) {
  main().catch((error) => {
    console.error("[explore-monitor] fatal", error);
    process.exit(1);
  });
}
