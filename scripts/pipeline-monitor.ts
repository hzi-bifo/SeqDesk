import { db } from '../src/lib/db';
import { parseTraceFile, findTraceFile, readTail } from '../src/lib/pipelines/nextflow';
import { findStepByProcess, getStepsForPipeline } from '../src/lib/pipelines/definitions';
import {
  aggregateStepStatus,
  combineTaskStatuses,
  deriveStepStatus,
  getTraceTaskAttemptGroupKeys,
  traceFailuresAreOnlyAborts,
  type RunStatus,
} from '../src/lib/pipelines/monitor-status';
import { reconcileRun, summarizeTrace, transitionEvent } from '../src/lib/pipelines/run-reconciler';
import { finalizeCompletedPipelineRun } from '../src/lib/pipelines/run-completion';
import { notifyPipelineRunTerminalInApp } from '../src/lib/notifications/in-app';
import { executorFor } from '../src/lib/pipelines/executors';
import { explainCondaFailure } from '../src/lib/pipelines/conda-explain';

const DEFAULT_INTERVAL_MS = 15000;

export async function syncRun(run: {
  id: string;
  pipelineId: string;
  status: RunStatus;
  runFolder: string | null;
  queueJobId: string | null;
  outputPath: string | null;
  errorPath: string | null;
  startedAt?: Date | null;
}) {
  let derivedStatus: RunStatus | null = null;
  let traceFailuresAborted = false;
  let currentStep: string | null = null;
  let progress: number | null = null;

  if (run.runFolder) {
    const tracePath = await findTraceFile(run.runFolder);
    if (tracePath) {
      const trace = await parseTraceFile(tracePath);
      const summary = summarizeTrace(run.pipelineId, trace.tasks, trace.overallProgress);
      for (const [stepId, entry] of summary.steps) {
        await db.pipelineRunStep.upsert({
          where: { pipelineRunId_stepId: { pipelineRunId: run.id, stepId } },
          create: { pipelineRunId: run.id, stepId, stepName: entry.stepName, status: entry.status, startedAt: entry.startedAt, completedAt: entry.completedAt },
          update: { status: entry.status, stepName: entry.stepName, startedAt: entry.startedAt, completedAt: entry.completedAt },
        });
      }
      derivedStatus = summary.derived;
      currentStep = summary.currentStep;
      progress = summary.progress;
      traceFailuresAborted = summary.failuresAborted;
    }
  }

  // Everything the run's state depends on goes through the one reconciler (src/lib/pipelines/run-reconciler.ts):
  // the trace summary above, the exact scheduler job, why its task jobs wait, a task job SLURM already ended.
  // The run's executor (this server or SLURM) reads its evidence in one shape for the reconciler.
  const executor = executorFor(run);
  const evidence = await executor.evidence(run);
  const { scheduler, slurm, waitingTaskReason, endedTask } = evidence;
  const next = reconcileRun({
    run: { status: run.status },
    trace: { derived: derivedStatus, currentStep, progress, failuresAborted: traceFailuresAborted },
    scheduler, slurm, waitingTaskReason, endedTask,
  });
  if (next.queue) {
    // The card's queue sentence reads these ("Waiting for a free node", "other jobs go first").
    try {
      await db.pipelineRun.update({ where: { id: run.id }, data: { queueStatus: next.queue.status, queueReason: next.queue.reason, queueUpdatedAt: new Date() } });
    } catch (error) {
      console.error('[pipeline-monitor] Could not record the queue state for run', run.id, error);
    }
  }
  let nextStatus = next.status;
  currentStep = next.currentStep;
  progress = next.progress;

  if (nextStatus) {
    // When the monitor (the safety-net daemon) finalizes a run as completed it
    // must ingest the pipeline's outputs BEFORE recording the terminal status.
    // runOnce only selects non-terminal runs, so once a row is marked completed
    // it is never revisited — if ingestion ran afterwards and failed (a transient
    // DB/NFS error, or outputs not yet flushed) the run would be stuck completed
    // with no artifacts/read writebacks and no retry. Ingest first; on failure
    // hold the run in a non-terminal "finalizing" state so the next pass retries.
    // Resolution is idempotent (re-resolving skips existing artifacts).
    if (next.finalize) {
      try {
        const finalized = await finalizeCompletedPipelineRun(
          run.id,
          run.pipelineId,
          {
            statusSource: 'monitor',
          }
        );
        if (finalized === 'claim-unavailable') {
          // Cancellation or another finalizer owns the lifecycle boundary.
          return;
        }
        await recordTransition(run.id, run.status, 'completed');
        await notifyPipelineRunTerminalInApp(
          run.id,
          run.status,
          'completed'
        );
        return;
      } catch (error) {
        console.error('[pipeline-monitor] Post-completion output resolution failed for run', run.id, error);
        nextStatus = 'running';
        currentStep = 'Finalizing outputs...';
        progress = 99;
      }
    }

    const update: Record<string, unknown> = { status: nextStatus };
    if (currentStep) update.currentStep = currentStep;
    if (progress !== null) update.progress = progress;
    if (nextStatus === 'failed' || nextStatus === 'cancelled') {
      update.completedAt = new Date();
    }
    if (nextStatus === 'running' && run.status !== 'running') {
      update.startedAt = new Date();
    }

    const outputTail = await readTail(run.outputPath);
    if (outputTail) update.outputTail = outputTail;
    const errorTail = await readTail(run.errorPath);
    if (errorTail) update.errorTail = errorTail;
    if (next.note) update.errorTail = `${errorTail ? `${errorTail}\n` : ''}${next.note}`;

    const { count } = await db.pipelineRun.updateMany({
      where: {
        id: run.id,
        status: { in: ['pending', 'queued', 'running'] },
        OR: [
          { statusSource: null },
          { statusSource: { notIn: ['finalizing', 'cancelling'] } },
        ],
      },
      data: update,
    });
    if (count > 0 && nextStatus !== run.status) await recordTransition(run.id, run.status, nextStatus);
    if (
      count > 0 &&
      (nextStatus === 'failed' || nextStatus === 'cancelled')
    ) {
      // The run's own job is gone; its nf-* task jobs must not keep running (scancel of the head, its time limit).
      await executor.cleanup(run);
      // Nextflow's own message for a failed conda environment is empty; ask the solver why, once, for the card.
      const log = `${update.outputTail ?? ''}\n${update.errorTail ?? ''}`;
      if (nextStatus === 'failed' && run.runFolder && /Failed to create Conda environment/.test(log)) {
        await explainCondaFailure(run.runFolder, log).catch((error) => console.error('[pipeline-monitor] Could not explain the conda failure for run', run.id, error));
      }
      await notifyPipelineRunTerminalInApp(
        run.id,
        run.status,
        nextStatus
      );
    }
  }
}

/** One row in the run's event log per change of state; a lost write never stops the monitor. */
async function recordTransition(runId: string, from: string, to: string) {
  try {
    await db.pipelineRunEvent.create({ data: transitionEvent(runId, from, to, 'monitor') });
  } catch (error) {
    console.error('[pipeline-monitor] Could not record the transition for run', runId, error);
  }
}

async function runOnce() {
  // Local runs that waited for a share of this server start once they fit (oldest first).
  try {
    const { admitWaitingLocalRuns } = await import('../src/lib/pipelines/pipeline-run-service');
    const started = await admitWaitingLocalRuns();
    if (started.length) console.log('[pipeline-monitor] admitted local runs', started.join(', '));
  } catch (error) {
    console.error('[pipeline-monitor] Could not admit waiting local runs', error);
  }
  const runs = await db.pipelineRun.findMany({
    where: { status: { in: ['pending', 'queued', 'running'] } },
    select: {
      id: true,
      pipelineId: true,
      status: true,
      runFolder: true,
      queueJobId: true,
      outputPath: true,
      errorPath: true,
      startedAt: true,
    },
  });

  for (const run of runs) {
    try {
      await syncRun({ ...run, status: run.status as RunStatus });
    } catch (error) {
      console.error('[pipeline-monitor] Failed to sync run', run.id, error);
    }
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const once = args.has('--once');
  const interval = Number(process.env.PIPELINE_MONITOR_INTERVAL_MS || DEFAULT_INTERVAL_MS);

  if (once) {
    await runOnce();
    return;
  }

  console.log(`[pipeline-monitor] running every ${interval}ms`);
  // One pass after the other: a pass that waits on a slow squeue/sacct must not overlap the next one.
  for (;;) {
    const started = Date.now();
    await runOnce().catch((error) => console.error('[pipeline-monitor] pass failed', error));
    await new Promise((resolve) => setTimeout(resolve, Math.max(1000, interval - (Date.now() - started))));
  }
}

// Auto-run when executed as the monitor daemon, but not when imported by a unit
// test (vitest sets VITEST), so syncRun can be tested in isolation.
if (!process.env.VITEST) {
  main().catch((error) => {
    console.error('[pipeline-monitor] fatal', error);
    process.exit(1);
  });
}
