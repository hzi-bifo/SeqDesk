/**
 * One reconciler for a pipeline run's state. Every source of evidence about a run — the Nextflow trace (summarised),
 * the exact scheduler job (squeue/sacct or the local pid through queue-probe), why its task jobs wait, a task job SLURM
 * already ended — goes in; out comes the one next state: status, current step, progress, the scheduler fields the card
 * reads, whether outputs must be finalized, when to look again, and the transition to record in the run's event log.
 *
 * Pure: the monitor gathers the evidence and writes the result; cancel and resume record their transitions through
 * `transitionEvent`. Before, the monitor, the details route, cancel and resume each derived these fields on their own,
 * and most of the SLURM bugs found on a real cluster came from their disagreeing (a cancelled run left at RUNNING, a
 * scancel read as failed, a pending reason never recorded).
 */
import {
  aggregateStepStatus, combineTaskStatuses, deriveStepStatus, getTraceTaskAttemptGroupKeys, reconcileRunStatus, traceFailuresAreOnlyAborts, type RunStatus,
} from './monitor-status';
import { findStepByProcess, getStepsForPipeline } from './definitions';
import type { TraceTask } from './nextflow';
import { isQueueSnapshotRetryable, queueSnapshotToRunStatus, type QueueSnapshot } from './queue-probe';

export interface TraceSummary {
  /** The status the trace alone suggests (null while it proves nothing). */
  derived: RunStatus | null;
  currentStep: string | null;
  progress: number | null;
  /** Every failed task was only ABORTED (Nextflow shutting down after a scancel). */
  failuresAborted: boolean;
}

type StepState = 'pending' | 'running' | 'completed' | 'failed';
export interface TraceStep { stepName: string; status: StepState; startedAt?: Date; completedAt?: Date }

/**
 * The trace in the run's terms: one entry per declared step (retry-aware, a failed sibling never hidden by another
 * task's success) and the status the trace alone suggests. Completion needs every declared step: the trace only
 * lists processes that have appeared so far.
 */
export function summarizeTrace(pipelineId: string, tasks: TraceTask[], overallProgress: number): TraceSummary & { steps: Map<string, TraceStep> } {
  const declared = getStepsForPipeline(pipelineId);
  const declaredIds = new Set(declared.map((step) => step.id));
  const keys = getTraceTaskAttemptGroupKeys(tasks);
  const steps = new Map<string, TraceStep & { attempts: Map<string, StepState[]> }>();
  for (const [index, task] of tasks.entries()) {
    const def = findStepByProcess(pipelineId, task.process);
    const id = def?.id || task.process;
    const entry = steps.get(id) ?? { stepName: def?.name || task.process, status: 'pending' as StepState, attempts: new Map<string, StepState[]>() };
    steps.set(id, entry);
    const attempts = entry.attempts.get(keys[index]) ?? [];
    attempts.push(deriveStepStatus(task.status, task.exit ?? undefined));
    entry.attempts.set(keys[index], attempts);
    const started = task.start || task.submit;
    if (started && (!entry.startedAt || started < entry.startedAt)) entry.startedAt = started;
    if (task.complete && (!entry.completedAt || task.complete > entry.completedAt)) entry.completedAt = task.complete;
  }
  for (const entry of steps.values()) entry.status = combineTaskStatuses([...entry.attempts.values()].map(aggregateStepStatus));
  const list = [...steps.entries()];
  const running = list.filter(([, step]) => step.status === 'running');
  const doneDeclared = list.filter(([id, step]) => declaredIds.has(id) && step.status === 'completed').length;
  let derived: RunStatus | null = null;
  let currentStep: string | null = null;
  if (running.length) { derived = 'running'; currentStep = running[0][1].stepName; }
  else if (list.length && list.every(([, step]) => step.status === 'completed') && declared.length > 0 && doneDeclared === declared.length) { derived = 'completed'; currentStep = 'Completed'; }
  else if (list.some(([, step]) => step.status === 'failed')) { derived = 'failed'; currentStep = 'Failed'; }
  const progress = declared.length > 0 ? Math.min(99, Math.round((doneDeclared / declared.length) * 100)) : overallProgress;
  return { derived, currentStep, progress, failuresAborted: traceFailuresAreOnlyAborts(tasks),
    steps: new Map(list.map(([id, { attempts: _attempts, ...step }]) => [id, step])) };
}

export interface ReconcileInput {
  run: { status: RunStatus; queueStatus?: string | null; queueReason?: string | null };
  trace: TraceSummary;
  /** The identity-checked scheduler snapshot of the run's own job; null when the run has no job id yet. */
  scheduler: QueueSnapshot | null;
  slurm: boolean;
  /** While the run's job runs: why its task jobs wait (a drained node, a job limit). */
  waitingTaskReason?: string | null;
  /** While the run's job runs: "ended:<kind>:<process>" for a task job SLURM already ended badly. */
  endedTask?: string | null;
}

export interface Reconciled {
  /** The run's next status; null when the evidence decides nothing. */
  status: RunStatus | null;
  currentStep: string | null;
  progress: number | null;
  /** The scheduler fields to keep on the run (the card's queue sentence reads them); null leaves them as they are. */
  queue: { status: string | null; reason: string | null } | null;
  /** Completed: outputs must be finalized before the status is written. */
  finalize: boolean;
  /** Seconds until this run should be looked at again; null once it is terminal. */
  nextCheckSeconds: number | null;
  /** A change of status, for the run's event log. */
  transition: { from: RunStatus; to: RunStatus } | null;
  /** Words for the run's error log when the evidence itself is the reason (a local process that vanished). */
  note?: string | null;
}

/** A local run whose process is gone without its exit marker (killed with the server, a reboot, kill -9). */
export const LOCAL_VANISHED_NOTE = 'The run\'s process on this server ended without writing its exit code (the server restarted, the host rebooted or the process was killed).';
const vanishedLocal = (snapshot: QueueSnapshot | null) => !!snapshot && snapshot.source === 'local' && !snapshot.identityVerified
  && /exited before its canonical exit marker|belongs to another process|missing its process arguments/.test(snapshot.reason ?? '');

const TERMINAL: RunStatus[] = ['completed', 'failed', 'cancelled'];
const ACTIVE: RunStatus[] = ['pending', 'queued', 'running'];

export function reconcileRun(input: ReconcileInput): Reconciled {
  const { run, trace, scheduler } = input;
  let currentStep = trace.currentStep;
  let progress = trace.progress;

  const schedulerStatus = scheduler ? queueSnapshotToRunStatus(scheduler) : null;
  const confirmationPending = scheduler ? isQueueSnapshotRetryable(scheduler) : false;

  let queue: Reconciled['queue'] = null;
  if (scheduler?.identityVerified && scheduler.state) {
    const state = scheduler.state;
    const reason = state === 'PENDING' && scheduler.reason ? scheduler.reason.replace(/^\((.*)\)$/, '$1')
      : state === 'RUNNING' && input.slurm ? (input.waitingTaskReason ?? input.endedTask ?? null) : null;
    queue = { status: state, reason };
  }

  let status = reconcileRunStatus(trace.derived, schedulerStatus, { traceFailuresAborted: trace.failuresAborted });
  if (confirmationPending && status && TERMINAL.includes(status)) {
    // A terminal-looking trace is no proof the run's job ended; keep it retryable until SLURM confirms.
    status = run.status === 'pending' || run.status === 'queued' ? run.status : 'running';
    currentStep = 'Waiting for scheduler confirmation...';
    progress = Math.min(99, progress ?? 99);
  }
  if ((trace.derived === 'completed' || trace.derived === 'failed') && status && ACTIVE.includes(status)) {
    currentStep = confirmationPending ? 'Waiting for scheduler confirmation...' : status === 'running' ? 'Running on compute node' : 'Waiting for scheduler';
    progress = Math.min(99, progress ?? 0);
  }
  if (status === 'completed') {
    progress = 100;
    currentStep ??= 'Completed';
  } else if (status === 'failed') currentStep ??= 'Failed';
  else if (status === 'cancelled') {
    currentStep ??= 'Cancelled';
    // The scheduler's last state ("RUNNING") no longer describes a cancelled run.
    queue = { status: null, reason: null };
  }

  let note: string | null = null;
  if (vanishedLocal(scheduler) && ACTIVE.includes(run.status) && (!status || ACTIVE.includes(status))) {
    // Nothing will ever write this run's exit marker: waiting for confirmation would last for ever.
    status = trace.derived === 'completed' ? 'running' : 'failed';
    if (status === 'failed') { currentStep = 'Failed'; note = LOCAL_VANISHED_NOTE; }
  }
  const terminal = !!status && TERMINAL.includes(status);
  return {
    note,
    status, currentStep, progress, queue,
    finalize: status === 'completed',
    nextCheckSeconds: terminal ? null : confirmationPending ? 15 : status === 'queued' || status === 'pending' ? 30 : 15,
    transition: status && status !== run.status ? { from: run.status, to: status } : null,
  };
}

/** The event-log row for a run's change of state (the monitor, cancel and resume all write it the same way). */
export function transitionEvent(runId: string, from: string, to: string, source: string, detail?: string | null) {
  return {
    pipelineRunId: runId, eventType: 'state', status: to, source,
    message: `${from} → ${to}${detail ? ` · ${detail}` : ''}`.slice(0, 500),
    payload: JSON.stringify({ from, to, ...(detail ? { detail: detail.slice(0, 300) } : {}) }),
  };
}

/** A run's event log as Details shows it: "14:19 queued → running", newest last. */
export function historyLines(events: { occurredAt: Date; eventType: string; message: string | null }[]): string[] {
  return events
    .filter((e) => e.eventType === 'state' || e.eventType === 'resumed')
    .map((e) => `${e.occurredAt.toISOString().slice(11, 16)} ${e.message ?? e.eventType}`);
}

/**
 * The scheduler fields to keep on a run from one identity-checked snapshot: the same rule the monitor follows
 * (PENDING keeps its reason without parentheses, a running job keeps why its task jobs wait, a terminal or cancelled
 * run keeps no stale reason). Null when the snapshot says nothing trustworthy.
 */
export function queueFieldsFrom(snapshot: QueueSnapshot | null, options: { slurm: boolean; status?: RunStatus | null; waitingTaskReason?: string | null } = { slurm: false }) {
  if (options.status === 'cancelled') return { status: null, reason: null };
  if (!snapshot?.identityVerified || !snapshot.state || snapshot.state === 'UNKNOWN') return null;
  const reason = snapshot.state === 'PENDING' && snapshot.reason ? snapshot.reason.replace(/^\((.*)\)$/, '$1')
    : snapshot.state === 'RUNNING' && options.slurm ? options.waitingTaskReason ?? null : null;
  return { status: snapshot.state, reason };
}
