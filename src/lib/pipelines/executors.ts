/**
 * One interface for where a pipeline run executes: this server (local) or SLURM. Each executor reads the same shape
 * of evidence about a run for the reconciler (run-reconciler.ts) and cleans up after a run that ended; the monitor
 * and cancel no longer branch on the executor themselves.
 */
import * as nextflow from './nextflow';
import { classifyFailure } from './plain-status';
import { readIdentityCheckedQueueSnapshot, type QueueSnapshot } from './queue-probe';
import { cancelLeftoverSlurmTaskJobs, readEndedTaskJob, readWaitingTaskReason } from './slurm-task-cleanup';

export interface RunRef { id: string; runFolder: string | null; queueJobId: string | null; startedAt?: Date | null }

/** What an executor knows about a run, in the shape the reconciler takes. */
export interface RunEvidence {
  scheduler: QueueSnapshot | null;
  slurm: boolean;
  waitingTaskReason: string | null;
  endedTask: string | null;
}

export interface RunExecutor {
  kind: 'local' | 'slurm' | 'none';
  evidence(run: RunRef): Promise<RunEvidence>;
  /** After the run's own job or process is gone: leave nothing of it running. */
  cleanup(run: RunRef): Promise<void>;
}

export interface ExecutorDeps {
  snapshot: typeof readIdentityCheckedQueueSnapshot;
  waitingTaskReason: typeof readWaitingTaskReason;
  endedTaskJob: typeof readEndedTaskJob;
  readTail: typeof nextflow.readTail;
  cancelLeftovers: typeof cancelLeftoverSlurmTaskJobs;
}
// Looked up when used, so a test that mocks one of these modules partly can still load this one.
const DEPS: ExecutorDeps = {
  snapshot: (...a) => readIdentityCheckedQueueSnapshot(...a), waitingTaskReason: (...a) => readWaitingTaskReason(...a),
  endedTaskJob: (...a) => readEndedTaskJob(...a), readTail: (...a) => nextflow.readTail(...a), cancelLeftovers: (...a) => cancelLeftoverSlurmTaskJobs(...a),
};

/** "ended:<kind>:<process>" for a task job SLURM already ended badly while Nextflow has not noticed yet. */
async function endedTaskReason(run: RunRef, deps: ExecutorDeps): Promise<string | null> {
  const ended = await deps.endedTaskJob(run.runFolder, run.startedAt ?? null);
  if (!ended) return null;
  const log = await deps.readTail(`${ended.workDir}/.command.log`).catch(() => null);
  const kind = ended.state === 'CANCELLED' || (/\*\*\* JOB \d+ ON \S+ CANCELLED AT /.test(log ?? '') && !/memory/i.test(log ?? ''))
    ? 'cancelled'
    : classifyFailure({ texts: [log], slurmStates: [ended.state], exitCodes: [/^0:9$/.test(ended.exitCode) ? 137 : null] });
  return `ended:${kind}:${ended.process}`;
}

export function slurmExecutor(deps: ExecutorDeps = DEPS): RunExecutor {
  return {
    kind: 'slurm',
    async evidence(run) {
      const scheduler = await deps.snapshot({ jobId: run.queueJobId, runId: run.id, runFolder: run.runFolder });
      let waitingTaskReason: string | null = null, endedTask: string | null = null;
      if (scheduler.identityVerified && scheduler.state === 'RUNNING') {
        waitingTaskReason = await deps.waitingTaskReason(run.runFolder);
        if (!waitingTaskReason) endedTask = await endedTaskReason(run, deps);
      }
      return { scheduler, slurm: true, waitingTaskReason, endedTask };
    },
    async cleanup(run) { await deps.cancelLeftovers(run.runFolder); },
  };
}

export function localExecutor(deps: ExecutorDeps = DEPS): RunExecutor {
  return {
    kind: 'local',
    async evidence(run) {
      return { scheduler: await deps.snapshot({ jobId: run.queueJobId, runId: run.id, runFolder: run.runFolder }), slurm: false, waitingTaskReason: null, endedTask: null };
    },
    // The run's process group is signalled by cancel; its scope ends with it. Nothing else to clean.
    async cleanup() { /* nothing */ },
  };
}

/** A run with no job or process yet (preparing, or waiting for a share of this server). */
const noExecutor: RunExecutor = { kind: 'none', async evidence() { return { scheduler: null, slurm: false, waitingTaskReason: null, endedTask: null }; }, async cleanup() { /* nothing */ } };

export function executorFor(run: Pick<RunRef, 'queueJobId'>, deps: ExecutorDeps = DEPS): RunExecutor {
  if (!run.queueJobId) return noExecutor;
  return /^\d+$/.test(run.queueJobId) ? slurmExecutor(deps) : localExecutor(deps);
}
