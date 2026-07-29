export type RunStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

export type TraceTaskAttempt = {
  process: string;
  tag?: string | null;
  taskId?: string | null;
  attempt?: number | null;
  status: string;
  exit?: number;
};

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

/**
 * Decide the status of a local (non-SLURM) run from its exit marker and PID
 * liveness. The exit marker wins: once a run has written a terminal exit code
 * the run is terminal regardless of PID liveness, because a recycled PID now
 * owned by an unrelated live process would otherwise pin a finished run as
 * 'running'. PID liveness is only the fallback when no exit marker exists yet.
 *
 *  - exitCode === 0    -> 'completed'  (terminal marker present)
 *  - exitCode != 0     -> 'failed'     (terminal marker present)
 *  - no marker, alive  -> 'running'    (genuinely still executing)
 *  - no marker, gone   -> null         (unknown; leave trace status untouched)
 */
export function resolveLocalLiveness(
  exitCode: number | null,
  pidAlive: boolean
): RunStatus | null {
  if (exitCode !== null) {
    return exitCode === 0 ? 'completed' : 'failed';
  }
  return pidAlive ? 'running' : null;
}

export function isTerminalRunStatus(status: RunStatus | null): boolean {
  return status !== null && TERMINAL_RUN_STATUSES.has(status);
}

/**
 * Aggregate the per-attempt outcomes for a single pipeline step into one final
 * step status. Nextflow retries (and `-resume` re-runs) emit multiple trace
 * rows for the same process: an early FAILED attempt followed by a later
 * COMPLETED/CACHED one. The final outcome must reflect the *last word*, not a
 * sticky early failure, so a successfully-retried step is not pinned to failed.
 *
 * Resolution order:
 *  - running   if any attempt is currently running (work still in flight)
 *  - completed if any attempt succeeded (a successful retry clears earlier fails)
 *  - failed    if every terminal attempt failed and none succeeded
 *  - pending   if nothing has started yet
 */
export function aggregateStepStatus(attempts: readonly StepStatus[]): StepStatus {
  let sawRunning = false;
  let sawCompleted = false;
  let sawFailed = false;
  for (const attempt of attempts) {
    if (attempt === 'running') sawRunning = true;
    else if (attempt === 'completed') sawCompleted = true;
    else if (attempt === 'failed') sawFailed = true;
  }
  if (sawRunning) return 'running';
  if (sawCompleted) return 'completed';
  if (sawFailed) return 'failed';
  return 'pending';
}

/**
 * Combine the resolved per-task statuses of a single pipeline step into the
 * step's overall status.
 *
 * A step often maps several DISTINCT Nextflow processes plus their per-sample
 * tasks to one step id (e.g. the MAG "binning" step covers METABAT2, MAXBIN2,
 * and CONCOCT). Unlike retry attempts of ONE logical task — where a later
 * COMPLETED/CACHED legitimately clears an earlier FAILED (see aggregateStepStatus,
 * applied per task identity) — a DISTINCT sibling task's success must NEVER mask
 * another task's failure. Otherwise a genuinely failed task is hidden and the
 * run is falsely reported as completed. Failure is therefore dominant over
 * completion here. Precedence:
 *  - running   if any task is still in flight
 *  - failed    if any distinct task failed (never masked by a sibling success)
 *  - completed only when every task completed
 *  - pending   otherwise
 */
export function combineTaskStatuses(taskStatuses: readonly StepStatus[]): StepStatus {
  if (taskStatuses.length === 0) return 'pending';
  if (taskStatuses.includes('running')) return 'running';
  if (taskStatuses.includes('failed')) return 'failed';
  if (taskStatuses.every((status) => status === 'completed')) return 'completed';
  return 'pending';
}

export function deriveStepStatus(status: string, exit?: number): StepStatus {
  const normalized = normalizeStatus(status);
  // ABORTED tasks (workflow torn down) are failures, matching the trace parser,
  // the weblog handler, and the ops-service. Check the exit code independently
  // so a non-zero exit is failed even when the label looks benign.
  if (
    normalized.includes('fail') ||
    normalized.includes('error') ||
    normalized.includes('abort') ||
    (exit !== undefined && exit !== 0)
  ) {
    return 'failed';
  }
  // A task that is only SUBMITTED is queued in the scheduler, not yet executing.
  // Treat it as pending so a queued job is not reported as running.
  if (normalized.includes('run') || normalized.includes('start')) {
    return 'running';
  }
  // CACHED tasks (reused via -resume) are finished work, not pending.
  if (
    normalized.includes('complete') ||
    normalized.includes('done') ||
    normalized.includes('success') ||
    normalized.includes('cache')
  ) {
    return 'completed';
  }
  return 'pending';
}

/**
 * Assign each trace row to a logical task while keeping sibling tasks separate.
 *
 * Nextflow gives every execution attempt a new `task_id`, so task_id alone
 * cannot join retries. Conversely, process/tag is not a task identity: tags are
 * optional and need not be unique. When the trace includes Nextflow's `attempt`
 * field, an attempt greater than one is joined to one failed predecessor with
 * the same process/tag and immediately preceding attempt number. Every first
 * attempt remains a separate task, even when tags are blank or reused.
 *
 * Older/default trace files can omit `attempt`. Those rows are grouped only
 * when they repeat the exact task_id; otherwise each row stays distinct. That
 * fail-safe may retain an old failed retry row, but it cannot turn a genuinely
 * failed sibling into a false success.
 */
export function getTraceTaskAttemptGroupKeys(
  tasks: readonly TraceTaskAttempt[]
): string[] {
  type GroupState = {
    key: string;
    lastAttempt: number;
    lastStatus: StepStatus;
  };

  const groupsByCoarseIdentity = new Map<string, GroupState[]>();
  const groupsByTaskId = new Map<string, GroupState>();
  let groupSequence = 0;

  return tasks.map((task) => {
    const coarseIdentity = `${task.process}\u0000${task.tag?.trim() ?? ''}`;
    const taskIdValue = task.taskId?.trim();
    const taskId =
      taskIdValue && taskIdValue !== '-' ? `${coarseIdentity}\u0000${taskIdValue}` : null;
    const attempt =
      typeof task.attempt === 'number' &&
      Number.isInteger(task.attempt) &&
      task.attempt > 0
        ? task.attempt
        : null;
    const status = deriveStepStatus(task.status, task.exit);

    let group = taskId ? groupsByTaskId.get(taskId) : undefined;

    if (!group && attempt !== null && attempt > 1) {
      group = groupsByCoarseIdentity
        .get(coarseIdentity)
        ?.find(
          (candidate) =>
            candidate.lastAttempt === attempt - 1 &&
            candidate.lastStatus === 'failed'
        );
    }

    if (!group) {
      group = {
        key: `trace-task-${groupSequence++}`,
        lastAttempt: attempt ?? 1,
        lastStatus: status,
      };
      const groups = groupsByCoarseIdentity.get(coarseIdentity) ?? [];
      groups.push(group);
      groupsByCoarseIdentity.set(coarseIdentity, groups);
    } else {
      group.lastAttempt = attempt ?? group.lastAttempt;
      group.lastStatus = status;
    }

    if (taskId) {
      groupsByTaskId.set(taskId, group);
    }

    return group.key;
  });
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
 * An active scheduler job is authoritative over a terminal-looking trace. A
 * trace only contains tasks that have appeared so far, so an early completed
 * wave can look terminal while downstream/sibling tasks are still running.
 * Once both sources are terminal, failure is dominant, then cancellation, then
 * completion. This prevents a clean wrapper exit from hiding a failed task and
 * also prevents a completed trace from hiding a wrapper-level failure after the
 * last task (for example, output publication or teardown).
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
    NON_TERMINAL_RUN_STATUSES.has(schedulerStatus) &&
    TERMINAL_RUN_STATUSES.has(traceStatus)
  ) {
    return schedulerStatus;
  }
  if (
    schedulerStatus &&
    NON_TERMINAL_RUN_STATUSES.has(traceStatus) &&
    TERMINAL_RUN_STATUSES.has(schedulerStatus)
  ) {
    return schedulerStatus;
  }
  if (
    schedulerStatus &&
    TERMINAL_RUN_STATUSES.has(traceStatus) &&
    TERMINAL_RUN_STATUSES.has(schedulerStatus)
  ) {
    if (traceStatus === 'failed' || schedulerStatus === 'failed') {
      return 'failed';
    }
    if (traceStatus === 'cancelled' || schedulerStatus === 'cancelled') {
      return 'cancelled';
    }
    return 'completed';
  }
  return traceStatus;
}
