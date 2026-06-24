import { db } from '../src/lib/db';
import { parseTraceFile, findTraceFile, readTail } from '../src/lib/pipelines/nextflow';
import { findStepByProcess, getStepsForPipeline } from '../src/lib/pipelines/definitions';
import {
  aggregateStepStatus,
  combineTaskStatuses,
  deriveStepStatus,
  normalizeStatus,
  reconcileRunStatus,
  resolveLocalLiveness,
  type RunStatus,
} from '../src/lib/pipelines/monitor-status';
import { inferPipelineExitCode, processCompletedPipelineRun } from '../src/lib/pipelines/run-completion';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const DEFAULT_INTERVAL_MS = 15000;

async function checkSlurmStatus(jobId: string): Promise<RunStatus | null> {
  try {
    const { stdout } = await execFileAsync('squeue', ['-h', '-j', jobId, '-o', '%T'], {
      timeout: 5000,
    });
    const state = stdout.trim();
    if (state) {
      const normalized = normalizeStatus(state);
      if (normalized.includes('run')) return 'running';
      if (normalized.includes('pending') || normalized.includes('queue')) return 'queued';
    }
  } catch {
    // Fall through to sacct
  }

  try {
    const { stdout } = await execFileAsync('sacct', ['-j', jobId, '-o', 'State', '-n', '-P'], {
      timeout: 5000,
    });
    const state = stdout.split('\n').map((line) => line.trim()).find(Boolean);
    if (!state) return null;
    const normalized = normalizeStatus(state);
    if (normalized.includes('completed')) return 'completed';
    if (normalized.includes('cancel')) return 'cancelled';
    if (normalized.includes('fail') || normalized.includes('timeout') || normalized.includes('out_of_memory')) {
      return 'failed';
    }
  } catch {
    return null;
  }

  return null;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // The PID is gone (ESRCH) or now owned by an unrelated, recycled process
    // (EPERM). Either way our Nextflow process is no longer the live owner, so
    // it is not safe to treat the PID as proof the run is still executing.
    return false;
  }
}

async function checkLocalStatus(
  jobId: string,
  runFolder: string | null,
): Promise<RunStatus | null> {
  const pidStr = jobId.replace(/^local-/, '');
  const pid = Number.parseInt(pidStr, 10);
  if (!Number.isFinite(pid) || pid <= 0) return null;

  // Exit-marker-first: if the run already wrote a terminal exit code, it is
  // terminal regardless of PID liveness. This stops a RECYCLED PID -- now owned
  // by an unrelated live process -- from pinning a finished run as 'running'.
  // PID liveness is only the fallback when no exit marker exists yet. A
  // successful local run also makes the PID disappear, so a gone PID with no
  // marker is 'unknown' (null), leaving a stuck trace status untouched rather
  // than wrongly flipped to failed.
  const exitCode = runFolder ? await inferPipelineExitCode(runFolder) : null;
  return resolveLocalLiveness(exitCode, isPidAlive(pid));
}

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

  if (run.runFolder) {
    const tracePath = await findTraceFile(run.runFolder);
    if (tracePath) {
      const trace = await parseTraceFile(tracePath);
      const stepMap = new Map<string, {
        stepName: string;
        status: 'pending' | 'running' | 'completed' | 'failed';
        // Attempts grouped by logical task identity (process + tag). A step can
        // map several DISTINCT processes/per-sample tasks to one id, so we keep
        // each task's attempts separate to resolve retries WITHOUT letting one
        // task's success mask a different task's failure.
        attemptsByTask: Map<string, ('pending' | 'running' | 'completed' | 'failed')[]>;
        startedAt?: Date;
        completedAt?: Date;
      }>();

      for (const task of trace.tasks) {
        const stepDef = findStepByProcess(run.pipelineId, task.process);
        const stepId = stepDef?.id || task.process;
        const stepName = stepDef?.name || task.process;

        if (!stepMap.has(stepId)) {
          stepMap.set(stepId, { stepName, status: 'pending', attemptsByTask: new Map() });
        }

        const entry = stepMap.get(stepId)!;
        // Group attempts by logical task identity (process + tag). Retries of the
        // SAME task resolve together below (a later COMPLETED/CACHED clears its
        // own earlier FAILED), while a DISTINCT sibling task can never clear
        // another task's failure -- otherwise a genuinely failed task would be
        // masked and the run falsely reported completed.
        const taskIdentity = `${task.process}\u0000${task.tag ?? ''}`;
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
      const completedSteps = Array.from(stepMap.values()).filter((s) => s.status === 'completed').length;
      if (runningSteps.length > 0) {
        currentStep = runningSteps[0].stepName;
        derivedStatus = 'running';
      } else if (totalSteps > 0 && completedSteps >= totalSteps) {
        // Conclude 'completed' ONLY when ALL defined steps have completed (completedSteps >= the
        // package's totalSteps), NOT merely "every step that has so far APPEARED in the trace". stepMap
        // holds only the steps whose processes have already run; early in the run that is just the
        // input-prep steps (metaxpath: input + move_fastq -- both completed), and the old
        // `stepMap.size > 0 && every entry completed` check read that as done, finalizing the run
        // 'completed' after 2 of 13 steps -- before classification, while the SLURM job was still
        // RUNNING (cancelled by the e2e). This mirrors the ops-service traceCompletedKnownWork
        // completedKnownSteps>=totalSteps guard. Runs with no/partial step coverage (totalSteps === 0,
        // or skipped steps e.g. the mag MEGAHIT-only smoke) finalize from the scheduler / exit marker
        // via reconcileRunStatus(null, schedulerStatus) below instead.
        derivedStatus = 'completed';
        currentStep = 'Completed';
      } else if (Array.from(stepMap.values()).some((s) => s.status === 'failed')) {
        derivedStatus = 'failed';
        currentStep = 'Failed';
      }

      if (totalSteps > 0) {
        progress = Math.min(99, Math.round((completedSteps / totalSteps) * 100));
      } else {
        progress = trace.overallProgress;
      }
    }
  }

  // Always reconcile against the live scheduler job. A wedged Nextflow trace can
  // report "running 99%" long after the SLURM/local job has actually finished;
  // a terminal scheduler state overrides a stuck non-terminal trace status so a
  // completed/failed run does not hang as running.
  let schedulerStatus: RunStatus | null = null;
  if (run.queueJobId) {
    schedulerStatus = run.queueJobId.startsWith('local-')
      ? await checkLocalStatus(run.queueJobId, run.runFolder)
      : await checkSlurmStatus(run.queueJobId);
  }
  derivedStatus = reconcileRunStatus(derivedStatus, schedulerStatus);

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
        await processCompletedPipelineRun(run.id, run.pipelineId);
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
    if (derivedStatus === 'completed' || derivedStatus === 'failed' || derivedStatus === 'cancelled') {
      update.completedAt = new Date();
    }
    if (derivedStatus === 'running' && run.status !== 'running') {
      update.startedAt = new Date();
    }

    const outputTail = await readTail(run.outputPath);
    if (outputTail) update.outputTail = outputTail;
    const errorTail = await readTail(run.errorPath);
    if (errorTail) update.errorTail = errorTail;

    await db.pipelineRun.update({
      where: { id: run.id },
      data: update,
    });
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

  // eslint-disable-next-line no-console
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
