import path from "path";
import { db } from "../src/lib/db";
import { readTail } from "../src/lib/pipelines/nextflow";
import { inferPipelineExitCode } from "../src/lib/pipelines/run-completion";
import {
  isQueueSnapshotRetryable,
  queueSnapshotToRunStatus,
  readIdentityCheckedQueueSnapshot,
} from "../src/lib/pipelines/queue-probe";
import { finalizeExploreRun } from "../src/lib/explore/run-finalize";

const DEFAULT_INTERVAL_MS = 10000;
const ACTIVE = ["pending", "queued", "running"];

/**
 * Bring one active Explore run up to date. The canonical completion signal is
 * the wrapper's exit marker in logs/pipeline.out; the scheduler or process
 * state only refines "queued" versus "running" and catches runs that died
 * without writing a marker.
 */
export async function syncExploreRun(run: {
  id: string;
  status: string;
  runFolder: string | null;
  queueJobId: string | null;
  createdAt: Date;
}): Promise<void> {
  if (!run.runFolder) {
    // Preparation crashed before a folder existed; give it a minute, then fail.
    if (Date.now() - run.createdAt.getTime() > 5 * 60 * 1000) {
      await db.exploreAnalysisRun.updateMany({
        where: { id: run.id, status: { in: ACTIVE } },
        data: { status: "failed", completedAt: new Date(), errorTail: "Run was never prepared" },
      });
    }
    return;
  }

  const exitCode = await inferPipelineExitCode(run.runFolder);
  if (exitCode !== null) {
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
    update.startedAt = new Date();
  } else if (derived === "failed" || derived === "cancelled") {
    update.status = derived;
    update.completedAt = new Date();
    update.errorTail = `${errorTail ?? ""}\n${snapshot.reason ?? "The process ended without writing an exit marker."}`.trim();
  } else if (derived === "completed") {
    // Scheduler says done but no marker yet: wait for the shared filesystem.
    if (!isQueueSnapshotRetryable(snapshot)) update.status = run.status;
  } else if (!snapshot.identityVerified && run.status === "running" && snapshot.source === "local") {
    // The local process is gone and no marker was written.
    update.status = "failed";
    update.completedAt = new Date();
    update.errorTail = `${errorTail ?? ""}\n${snapshot.reason ?? "The analysis process disappeared."}`.trim();
  }
  if (Object.keys(update).length === 0) return;
  await db.exploreAnalysisRun.updateMany({ where: { id: run.id, status: { in: ACTIVE } }, data: update });
}

async function runOnce(): Promise<void> {
  const runs = await db.exploreAnalysisRun.findMany({
    where: { status: { in: ACTIVE } },
    select: { id: true, status: true, runFolder: true, queueJobId: true, createdAt: true },
  });
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
