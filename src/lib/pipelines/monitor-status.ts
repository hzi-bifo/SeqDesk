export type RunStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

const NON_TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'pending',
  'queued',
  'running',
]);

export function normalizeStatus(value?: string): string {
  return value ? value.toLowerCase() : '';
}

export function isTerminalRunStatus(status: RunStatus | null): boolean {
  return status !== null && TERMINAL_RUN_STATUSES.has(status);
}

export function deriveStepStatus(status: string, exit?: number): StepStatus {
  const normalized = normalizeStatus(status);
  if (
    normalized.includes('fail') ||
    normalized.includes('error') ||
    (exit !== undefined && exit !== 0)
  ) {
    return 'failed';
  }
  // A task that is only SUBMITTED is queued in the scheduler, not yet executing.
  // Treat it as pending so a queued job is not reported as running.
  if (normalized.includes('run') || normalized.includes('start')) {
    return 'running';
  }
  if (
    normalized.includes('complete') ||
    normalized.includes('done') ||
    normalized.includes('success')
  ) {
    return 'completed';
  }
  return 'pending';
}

/**
 * Reconcile the run status derived from the Nextflow trace with the live
 * scheduler (SLURM/local) job state.
 *
 * The Nextflow trace can wedge — e.g. a task's COMPLETED update is never flushed
 * to trace.txt, or a step is left marked "running" — and the run then reports
 * "running 99%" indefinitely even though the scheduler job has already finished.
 * When the scheduler job has reached a terminal state (completed/failed/
 * cancelled) but the trace is still non-terminal, trust the scheduler so a
 * finished run does not hang as running/queued.
 *
 * A terminal trace status (the pipeline itself reported completion/failure) is
 * authoritative and is never overridden.
 */
export function reconcileRunStatus(
  traceStatus: RunStatus | null,
  schedulerStatus: RunStatus | null
): RunStatus | null {
  if (!traceStatus) {
    return schedulerStatus;
  }
  if (
    schedulerStatus &&
    NON_TERMINAL_RUN_STATUSES.has(traceStatus) &&
    TERMINAL_RUN_STATUSES.has(schedulerStatus)
  ) {
    return schedulerStatus;
  }
  return traceStatus;
}
