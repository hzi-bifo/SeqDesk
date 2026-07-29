import { db } from '../src/lib/db';
import { parseTraceFile, findTraceFile, readTail } from '../src/lib/pipelines/nextflow';
import { findStepByProcess, getStepsForPipeline } from '../src/lib/pipelines/definitions';
import {
  aggregateStepStatus,
  combineTaskStatuses,
  deriveStepStatus,
  getTraceTaskAttemptGroupKeys,
  reconcileRunStatus,
  type RunStatus,
} from '../src/lib/pipelines/monitor-status';
import { finalizeCompletedPipelineRun } from '../src/lib/pipelines/run-completion';
import {
  isQueueSnapshotRetryable,
  queueSnapshotToRunStatus,
  readIdentityCheckedQueueSnapshot,
} from '../src/lib/pipelines/queue-probe';
import { notifyPipelineRunTerminalInApp } from '../src/lib/notifications/in-app';

const DEFAULT_INTERVAL_MS = 15000;

export async function syncRun(run: {
  id: string;
  pipelineId: string;
  status: RunStatus;
  runFolder: string | null;
  queueJobId: string | null;
  outputPath: string | null;
  errorPath: string | null;
}) {
  let derivedStatus: RunStatus | null = null;
  let currentStep: string | null = null;
  let progress: number | null = null;

  const pipelineSteps = getStepsForPipeline(run.pipelineId);
  const totalSteps = pipelineSteps.length;
  const declaredStepIds = new Set(pipelineSteps.map((step) => step.id));

  if (run.runFolder) {
    const tracePath = await findTraceFile(run.runFolder);
    if (tracePath) {
      const trace = await parseTraceFile(tracePath);
      const taskGroupKeys = getTraceTaskAttemptGroupKeys(trace.tasks);
      const stepMap = new Map<string, {
        stepName: string;
        status: 'pending' | 'running' | 'completed' | 'failed';
        // A step can map several DISTINCT processes/per-sample tasks to one id,
        // so we keep each task's attempts separate to resolve retries WITHOUT
        // letting one task's success mask a different task's failure.
        attemptsByTask: Map<string, ('pending' | 'running' | 'completed' | 'failed')[]>;
        startedAt?: Date;
        completedAt?: Date;
      }>();

      for (const [taskIndex, task] of trace.tasks.entries()) {
        const stepDef = findStepByProcess(run.pipelineId, task.process);
        const stepId = stepDef?.id || task.process;
        const stepName = stepDef?.name || task.process;

        if (!stepMap.has(stepId)) {
          stepMap.set(stepId, { stepName, status: 'pending', attemptsByTask: new Map() });
        }

        const entry = stepMap.get(stepId)!;
        // The parser supplies task_id/attempt metadata when available. The
        // grouping helper uses it to join retries while keeping blank/reused-tag
        // siblings distinct; ambiguous legacy rows remain separate (fail-safe).
        const taskIdentity = taskGroupKeys[taskIndex];
        const attempts = entry.attemptsByTask.get(taskIdentity) ?? [];
        attempts.push(deriveStepStatus(task.status, task.exit));
        entry.attemptsByTask.set(taskIdentity, attempts);

        const startedAt = task.start || task.submit;
        if (startedAt && (!entry.startedAt || startedAt < entry.startedAt)) {
          entry.startedAt = startedAt;
        }
        if (task.complete && (!entry.completedAt || task.complete > entry.completedAt)) {
          entry.completedAt = task.complete;
        }
      }

      for (const entry of stepMap.values()) {
        // Resolve each distinct task (retry-aware), then combine across tasks so
        // a genuinely-failed sibling is never hidden by another task's success.
        const taskStatuses = Array.from(entry.attemptsByTask.values()).map(aggregateStepStatus);
        entry.status = combineTaskStatuses(taskStatuses);
      }

      for (const [stepId, entry] of stepMap) {
        await db.pipelineRunStep.upsert({
          where: {
            pipelineRunId_stepId: {
              pipelineRunId: run.id,
              stepId,
            },
          },
          create: {
            pipelineRunId: run.id,
            stepId,
            stepName: entry.stepName,
            status: entry.status,
            startedAt: entry.startedAt,
            completedAt: entry.completedAt,
          },
          update: {
            status: entry.status,
            stepName: entry.stepName,
            startedAt: entry.startedAt,
            completedAt: entry.completedAt,
          },
        });
      }

      const runningSteps = Array.from(stepMap.values()).filter((s) => s.status === 'running');
      const completedKnownSteps = Array.from(stepMap.entries()).filter(
        ([stepId, step]) => declaredStepIds.has(stepId) && step.status === 'completed'
      ).length;
      if (runningSteps.length > 0) {
        currentStep = runningSteps[0].stepName;
        derivedStatus = 'running';
      } else if (
        stepMap.size > 0 &&
        Array.from(stepMap.values()).every((s) => s.status === 'completed') &&
        totalSteps > 0 &&
        completedKnownSteps === totalSteps
      ) {
        // stepMap contains only processes that have appeared so far. Require every
        // declared step for both local and SLURM runs; packages whose definitions
        // intentionally cover only part of an external workflow finalize from the
        // authoritative local exit marker or scheduler state below.
        derivedStatus = 'completed';
        currentStep = 'Completed';
      } else if (Array.from(stepMap.values()).some((s) => s.status === 'failed')) {
        derivedStatus = 'failed';
        currentStep = 'Failed';
      }

      if (totalSteps > 0) {
        progress = Math.min(99, Math.round((completedKnownSteps / totalSteps) * 100));
      } else {
        progress = trace.overallProgress;
      }
    }
  }

  // Always reconcile against the live scheduler job. A wedged Nextflow trace can
  // report "running 99%" long after the SLURM/local job has actually finished;
  // a terminal scheduler state overrides a stuck non-terminal trace status so a
  // completed/failed run does not hang as running. Conversely, an active job
  // overrides a terminal-looking trace: the trace may only contain an early
  // completed task wave while later tasks have not appeared yet.
  let schedulerStatus: RunStatus | null = null;
  let schedulerConfirmationPending = false;
  if (run.queueJobId) {
    const queueSnapshot = await readIdentityCheckedQueueSnapshot({
      jobId: run.queueJobId,
      runId: run.id,
      runFolder: run.runFolder,
    });
    schedulerStatus = queueSnapshotToRunStatus(queueSnapshot);
    schedulerConfirmationPending = isQueueSnapshotRetryable(queueSnapshot);
  }
  const traceDerivedStatus = derivedStatus;
  derivedStatus = reconcileRunStatus(derivedStatus, schedulerStatus);
  if (
    schedulerConfirmationPending &&
    derivedStatus !== null &&
    ['completed', 'failed', 'cancelled'].includes(derivedStatus)
  ) {
    // A trace terminal label is not proof that the outer wrapper/allocation
    // exited. Failed tasks may still retry while it is alive. Keep the run
    // retryable until the exact stored identity is verified.
    derivedStatus =
      run.status === 'pending' || run.status === 'queued'
        ? run.status
        : 'running';
    currentStep = 'Waiting for scheduler confirmation...';
    progress = Math.min(99, progress ?? 99);
  }

  if (
    (traceDerivedStatus === 'completed' ||
      traceDerivedStatus === 'failed') &&
    (derivedStatus === 'running' ||
      derivedStatus === 'queued' ||
      derivedStatus === 'pending')
  ) {
    currentStep =
      schedulerConfirmationPending
        ? 'Waiting for scheduler confirmation...'
        : derivedStatus === 'running'
        ? 'Running on compute node'
        : 'Waiting for scheduler';
    progress = Math.min(99, progress ?? 0);
  }

  if (derivedStatus === 'completed') {
    progress = 100;
    if (!currentStep) currentStep = 'Completed';
  } else if (derivedStatus === 'failed' && !currentStep) {
    currentStep = 'Failed';
  } else if (derivedStatus === 'cancelled' && !currentStep) {
    currentStep = 'Cancelled';
  }

  if (derivedStatus) {
    // When the monitor (the safety-net daemon) finalizes a run as completed it
    // must ingest the pipeline's outputs BEFORE recording the terminal status.
    // runOnce only selects non-terminal runs, so once a row is marked completed
    // it is never revisited — if ingestion ran afterwards and failed (a transient
    // DB/NFS error, or outputs not yet flushed) the run would be stuck completed
    // with no artifacts/read writebacks and no retry. Ingest first; on failure
    // hold the run in a non-terminal "finalizing" state so the next pass retries.
    // Resolution is idempotent (re-resolving skips existing artifacts).
    if (derivedStatus === 'completed') {
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
        await notifyPipelineRunTerminalInApp(
          run.id,
          run.status,
          'completed'
        );
        return;
      } catch (error) {
        console.error('[pipeline-monitor] Post-completion output resolution failed for run', run.id, error);
        derivedStatus = 'running';
        currentStep = 'Finalizing outputs...';
        progress = 99;
      }
    }

    const update: Record<string, unknown> = { status: derivedStatus };
    if (currentStep) update.currentStep = currentStep;
    if (progress !== null) update.progress = progress;
    if (derivedStatus === 'failed' || derivedStatus === 'cancelled') {
      update.completedAt = new Date();
    }
    if (derivedStatus === 'running' && run.status !== 'running') {
      update.startedAt = new Date();
    }

    const outputTail = await readTail(run.outputPath);
    if (outputTail) update.outputTail = outputTail;
    const errorTail = await readTail(run.errorPath);
    if (errorTail) update.errorTail = errorTail;

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
    if (
      count > 0 &&
      (derivedStatus === 'failed' || derivedStatus === 'cancelled')
    ) {
      await notifyPipelineRunTerminalInApp(
        run.id,
        run.status,
        derivedStatus
      );
    }
  }
}

async function runOnce() {
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
  await runOnce();
  setInterval(runOnce, interval);
}

// Auto-run when executed as the monitor daemon, but not when imported by a unit
// test (vitest sets VITEST), so syncRun can be tested in isolation.
if (!process.env.VITEST) {
  main().catch((error) => {
    console.error('[pipeline-monitor] fatal', error);
    process.exit(1);
  });
}
