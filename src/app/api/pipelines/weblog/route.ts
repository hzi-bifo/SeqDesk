import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { notifyPipelineRunTerminalInApp } from '@/lib/notifications/in-app';
import { getExecutionSettings } from '@/lib/pipelines/execution-settings';
import { findStepByProcess, getStepsForPipeline } from '@/lib/pipelines/definitions';
import {
  finalizeCompletedPipelineRun,
} from '@/lib/pipelines/run-completion';
import {
  isActiveQueueState,
  isCancelledQueueState,
  isFailedQueueState,
  isQueueSnapshotRetryable,
  normalizeQueueState,
  readIdentityCheckedQueueSnapshot,
} from '@/lib/pipelines/queue-probe';
// Import to trigger adapter registration
import '@/lib/pipelines/adapters/mag';

type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
const ACTIVE_RUN_STATUSES = ['pending', 'queued', 'running'] as const;
const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const MAX_EVENT_PAYLOAD = 12000;
const MAX_EVENT_FUTURE_SKEW_MS = 6 * 60 * 60 * 1000;
const MAX_EVENT_PAST_SKEW_MS = 30 * 24 * 60 * 60 * 1000;
const DUPLICATE_EVENT_WINDOW_MS = 2000;

function parseDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
}

function resolveEventAt(parsedEventTime: Date | undefined, receivedAt: Date): Date {
  if (!parsedEventTime) return receivedAt;
  const deltaMs = parsedEventTime.getTime() - receivedAt.getTime();
  if (deltaMs > MAX_EVENT_FUTURE_SKEW_MS) return receivedAt;
  if (deltaMs < -MAX_EVENT_PAST_SKEW_MS) return receivedAt;
  return parsedEventTime;
}

function normalizeEvent(value: unknown): string {
  if (!value) return '';
  const normalized = String(value).trim().toLowerCase();

  // Nextflow's weblog contract uses the bare workflow event names
  // `started`, `completed`, and `error`. Preserve the historical aliases while
  // storing and handling every workflow event through one canonical name.
  // Process events such as process_started/process_completed are deliberately
  // left unchanged.
  if (
    normalized === 'started' ||
    normalized === 'workflow_start' ||
    normalized === 'workflow_started' ||
    normalized === 'workflow_begin'
  ) {
    return 'workflow_start';
  }
  if (
    normalized === 'completed' ||
    normalized === 'workflow_complete' ||
    normalized === 'workflow_completed' ||
    normalized === 'workflow_finish' ||
    normalized === 'workflow_finished'
  ) {
    return 'workflow_complete';
  }
  if (
    normalized === 'error' ||
    normalized === 'workflow_error' ||
    normalized === 'workflow_fail' ||
    normalized === 'workflow_failed'
  ) {
    return 'workflow_error';
  }

  return normalized;
}

function getTrace(payload: Record<string, unknown>): Record<string, unknown> | null {
  const trace = payload.trace;
  if (trace && typeof trace === 'object') return trace as Record<string, unknown>;
  const task = payload.task;
  if (task && typeof task === 'object') return task as Record<string, unknown>;
  return null;
}

function getProcessName(trace: Record<string, unknown> | null, payload: Record<string, unknown>): string | null {
  const candidates = [
    trace?.process,
    trace?.name,
    trace?.processName,
    payload.process,
    payload.processName,
    payload.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function stringifyPayload(payload: Record<string, unknown>): string | null {
  try {
    const json = JSON.stringify(payload);
    return truncateString(json, MAX_EVENT_PAYLOAD);
  } catch {
    return null;
  }
}

function extractMessage(
  payload: Record<string, unknown>,
  trace: Record<string, unknown> | null
): string | null {
  const candidates = [
    payload.message,
    payload.error,
    payload.reason,
    payload.cause,
    trace?.error,
    trace?.message,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return truncateString(candidate.trim(), 500);
    }
    if (
      candidate &&
      typeof candidate === 'object' &&
      'message' in candidate &&
      typeof (candidate as { message?: unknown }).message === 'string'
    ) {
      const message = (candidate as { message?: string }).message?.trim();
      if (message) return truncateString(message, 500);
    }
  }
  return null;
}

function deriveStepStatus(event: string, trace: Record<string, unknown> | null): StepStatus | null {
  const traceStatusRaw = trace?.status ?? trace?.state ?? trace?.taskState;
  const traceStatus = typeof traceStatusRaw === 'string' ? traceStatusRaw.toLowerCase() : '';
  const exitStatus =
    typeof trace?.exit === 'number'
      ? trace.exit
      : typeof trace?.exit === 'string'
        ? Number.parseInt(trace.exit, 10)
        : undefined;
  const failed =
    traceStatus.includes('fail') ||
    traceStatus.includes('error') ||
    traceStatus.includes('aborted') ||
    (exitStatus !== undefined && exitStatus !== 0);

  if (event.includes('process_start') || event.includes('task_start') || event.includes('process_submit')) {
    return 'running';
  }

  if (event.includes('process_complete') || event.includes('task_complete')) {
    return failed ? 'failed' : 'completed';
  }

  if (event.includes('process_error')) {
    return 'failed';
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get('runId');
    const token = searchParams.get('token') || '';

    if (!runId) {
      return NextResponse.json({ error: 'runId is required' }, { status: 400 });
    }

    const execSettings = await getExecutionSettings();
    if (!execSettings.weblogSecret) {
      // Fail closed: an unconfigured secret would otherwise leave this
      // state-mutating webhook fully unauthenticated, letting anyone drive
      // run state. Reject until an operator configures a weblog secret
      // (Application Settings → Pipeline execution).
      console.error(
        '[Pipeline Weblog] Rejecting request: no weblog secret configured. ' +
          'Set a weblog secret to enable pipeline weblog callbacks.'
      );
      return NextResponse.json(
        { error: 'Weblog secret is not configured' },
        { status: 503 }
      );
    }
    if (token !== execSettings.weblogSecret) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
    }

    const payload = (await request.json()) as Record<string, unknown>;
    const event = normalizeEvent(payload.event || payload.eventType || payload.type);
    const trace = getTrace(payload);

    const run = await db.pipelineRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        pipelineId: true,
        status: true,
        queueJobId: true,
        runFolder: true,
        progress: true,
        currentStep: true,
        startedAt: true,
        completedAt: true,
        lastEventAt: true,
        lastWeblogAt: true,
      },
    });

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    const parsedEventTime =
      parseDate(payload.utcTime) ||
      parseDate(payload.timestamp) ||
      parseDate(trace?.complete) ||
      parseDate(trace?.start) ||
      parseDate(trace?.submit);
    const receivedAt = new Date();
    const eventAt = resolveEventAt(parsedEventTime, receivedAt);

    // BUG #2: A terminal run must never be resurrected (e.g. cancelled->completed)
    // or have its completedAt/lifecycle fields overwritten by a late/duplicate
    // workflow_complete / workflow_error event. Mirror the ops-service invariant
    // that only gates terminal writes behind active states. The event row is
    // still recorded below; only lifecycle mutations are skipped.
    const runIsTerminal = !['pending', 'queued', 'running'].includes(run.status);

    const processName = getProcessName(trace, payload);
    const stepDefinition = processName
      ? findStepByProcess(run.pipelineId, processName)
      : null;
    const stepId = stepDefinition?.id || processName || null;
    const stepName = stepDefinition?.name || processName || undefined;

    const stepStatus = deriveStepStatus(event, trace);

    if (stepId && stepStatus) {
      const existingStep = await db.pipelineRunStep.findUnique({
        where: {
          pipelineRunId_stepId: {
            pipelineRunId: runId,
            stepId,
          },
        },
        select: { status: true, startedAt: true, completedAt: true },
      });

      const startedAt =
        existingStep?.startedAt ||
        (stepStatus === 'running' ? parsedEventTime : undefined);
      const completedAt =
        existingStep?.completedAt ||
        (stepStatus === 'completed' || stepStatus === 'failed' ? parsedEventTime : undefined);

      // 'failed' and 'completed' are terminal step states. A step shared by
      // multiple Nextflow processes must never regress from a terminal state
      // back to 'running' when a sibling process emits process_start.
      const nextStatus: StepStatus =
        existingStep?.status === 'failed'
          ? 'failed'
          : existingStep?.status === 'completed'
            ? 'completed'
            : stepStatus;

      await db.pipelineRunStep.upsert({
        where: {
          pipelineRunId_stepId: {
            pipelineRunId: runId,
            stepId,
          },
        },
        create: {
          pipelineRunId: runId,
          stepId,
          stepName,
          status: nextStatus,
          startedAt,
          completedAt,
        },
        update: {
          status: nextStatus,
          stepName,
          startedAt,
          completedAt,
        },
      });
    }

    const runUpdates: Record<string, unknown> = {
      statusSource: 'weblog',
    };
    let completedByOutputGate = false;
    let lifecycleClaimUnavailable = false;

    if (!run.lastEventAt || eventAt >= run.lastEventAt) {
      runUpdates.lastEventAt = eventAt;
    }
    if (!run.lastWeblogAt || eventAt >= run.lastWeblogAt) {
      runUpdates.lastWeblogAt = eventAt;
    }

    if (!runIsTerminal && event === 'workflow_start') {
      if (!run.startedAt) {
        runUpdates.startedAt = parsedEventTime || eventAt;
      }
      if (run.status === 'pending' || run.status === 'queued') {
        runUpdates.status = 'running';
      }
    }

    if (!runIsTerminal && stepStatus === 'running' && stepName) {
      runUpdates.currentStep = stepName;
      if (run.status === 'pending' || run.status === 'queued') {
        runUpdates.status = 'running';
      }
      if (!run.startedAt) {
        runUpdates.startedAt = parsedEventTime || eventAt;
      }
    }

    if (!runIsTerminal && stepStatus === 'failed' && stepName) {
      // A failed process event can still be non-fatal (e.g. errorStrategy 'ignore').
      // Keep the run active and wait for workflow-level completion/error events.
      runUpdates.currentStep = `Process failed: ${stepName}`;
      if (run.status === 'pending' || run.status === 'queued') {
        runUpdates.status = 'running';
      }
      delete runUpdates.completedAt;
    }

    if (!runIsTerminal && event === 'workflow_complete') {
      const queueSnapshot = await readIdentityCheckedQueueSnapshot({
        jobId: run.queueJobId,
        runId: run.id,
        runFolder: run.runFolder,
      });
      const queueState = normalizeQueueState(queueSnapshot.state);
      const isLocalRun = (run.queueJobId || '').trim().startsWith('local-');
      const localExitCode = isLocalRun ? queueSnapshot.exitCode ?? null : null;
      const queueConfirmationPending = Boolean(
        run.queueJobId && isQueueSnapshotRetryable(queueSnapshot)
      );
      const queueCancelled = isCancelledQueueState(queueState);
      const queueFailed = isFailedQueueState(queueState);
      const localExitFailed =
        isLocalRun &&
        queueState === 'EXITED' &&
        localExitCode !== null &&
        localExitCode !== 0;
      const localExitUnverified =
        isLocalRun && queueState === 'EXITED' && localExitCode === null;

      if (queueSnapshot.state) {
        runUpdates.queueStatus = queueSnapshot.state;
        runUpdates.queueReason = queueSnapshot.reason || undefined;
        runUpdates.queueUpdatedAt = eventAt;
      }

      if (queueConfirmationPending) {
        // A signed workflow callback can arrive before the outer wrapper exits,
        // and scheduler lookups can fail transiently. Never convert an unknown or
        // unverified PID/job ID into success; the monitor retries the same exact
        // identity probe.
        runUpdates.status = 'running';
        runUpdates.statusSource = 'queue';
        runUpdates.currentStep = 'Waiting for scheduler confirmation...';
        const progressValue =
          typeof run.progress === 'number' ? run.progress : 99;
        runUpdates.progress = Math.min(99, progressValue);
        delete runUpdates.completedAt;
      } else if (queueCancelled) {
        runUpdates.status = 'cancelled';
        runUpdates.statusSource = 'queue';
        runUpdates.currentStep = 'Cancelled';
        runUpdates.completedAt = parsedEventTime || eventAt;
      } else if (queueFailed || localExitFailed) {
        runUpdates.status = 'failed';
        runUpdates.statusSource = 'queue';
        runUpdates.currentStep = 'Failed';
        runUpdates.completedAt = parsedEventTime || eventAt;
      } else if (localExitUnverified) {
        // A disappeared local PID does not prove success. The wrapper's
        // canonical exit marker is the only reliable local exit result; keep
        // the run retryable until a monitor observes that marker.
        runUpdates.status = 'running';
        runUpdates.statusSource = 'queue';
        runUpdates.currentStep = 'Waiting for exit confirmation...';
        const progressValue =
          typeof run.progress === 'number' ? run.progress : 99;
        runUpdates.progress = Math.min(99, progressValue);
        delete runUpdates.completedAt;
      } else if (isActiveQueueState(queueSnapshot.state)) {
        runUpdates.status = 'running';
        const progressValue =
          typeof runUpdates.progress === 'number'
            ? runUpdates.progress
            : typeof run.progress === 'number'
              ? run.progress
              : null;
        const readyToFinalize = progressValue === null || progressValue >= 90;
        runUpdates.currentStep = readyToFinalize ? 'Finalizing...' : 'Running on compute node';
        if (readyToFinalize) {
          runUpdates.progress = Math.min(99, progressValue ?? 99);
        }
        delete runUpdates.completedAt;
      } else {
        let outputsReady = true;
        try {
          const finalized = await finalizeCompletedPipelineRun(
            runId,
            run.pipelineId,
            {
              completedAt: parsedEventTime || eventAt,
              statusSource: 'weblog',
              lastEventAt: eventAt,
              queueStatus: queueSnapshot.state || 'COMPLETED',
              queueReason: queueSnapshot.reason,
              queueUpdatedAt: eventAt,
            }
          );
          lifecycleClaimUnavailable = finalized === 'claim-unavailable';
          completedByOutputGate = finalized === 'completed';
        } catch (err) {
          console.error('[Pipeline Weblog] Output resolution failed:', err);
          outputsReady = false;
        }

        if (lifecycleClaimUnavailable) {
          // A cancellation or another finalizer owns the state transition. Do
          // not overwrite its statusSource/currentStep with this stale event.
          for (const key of Object.keys(runUpdates)) delete runUpdates[key];
        } else if (outputsReady && completedByOutputGate) {
          console.warn(`[RUN-FINALIZE] weblog completed run=${runId} event=${event}`);
          runUpdates.currentStep = 'Completed';
          runUpdates.completedAt = parsedEventTime || eventAt;
          runUpdates.progress = 100;
        } else {
          runUpdates.status = 'running';
          runUpdates.currentStep = 'Finalizing outputs...';
          const progressValue =
            typeof runUpdates.progress === 'number' ? runUpdates.progress : 99;
          runUpdates.progress = Math.min(99, progressValue);
          delete runUpdates.completedAt;
        }
      }
    }

    if (!runIsTerminal && event === 'workflow_error') {
      runUpdates.status = 'failed';
      runUpdates.currentStep = 'Failed';
      runUpdates.completedAt = parsedEventTime || eventAt;
    }

    if (!runIsTerminal && (stepStatus === 'completed' || stepStatus === 'failed')) {
      const pipelineSteps = getStepsForPipeline(run.pipelineId);
      const totalSteps = pipelineSteps.length;
      const completedCount = await db.pipelineRunStep.count({
        where: { pipelineRunId: runId, status: 'completed' },
      });
      if (totalSteps > 0) {
        // BUG #7: a late step event must never decrease progress below the
        // run's existing value. Clamp the recomputed progress to the floor of
        // the current run.progress (capped at 99 to leave headroom for 100%).
        const recomputed = Math.min(
          99,
          Math.round((completedCount / totalSteps) * 100)
        );
        const floor = typeof run.progress === 'number' ? run.progress : 0;
        runUpdates.progress = Math.max(recomputed, Math.min(floor, 99));
      }
    }

    const statusRaw = trace?.status ?? trace?.state ?? payload.status ?? payload.state;
    const statusValue = stepStatus || (typeof statusRaw === 'string' ? statusRaw : undefined);
    const eventType = event || 'weblog';
    const eventMessage = extractMessage(payload, trace);
    const eventPayload = stringifyPayload(payload);
    const eventRecord = {
      pipelineRunId: runId,
      eventType,
      processName: processName || undefined,
      stepId,
      status: statusValue,
      message: eventMessage || undefined,
      payload: eventPayload || undefined,
      source: 'weblog',
      occurredAt: eventAt,
    };

    const nextStatus =
      typeof runUpdates.status === 'string' ? runUpdates.status : run.status;
    const requiresStatusGuard = !runIsTerminal && typeof runUpdates.status === 'string';
    const requiresLifecycleGuard =
      !runIsTerminal &&
      !completedByOutputGate &&
      Object.keys(runUpdates).length > 0;

    const { statusWriteApplied } = await db.$transaction(async (tx) => {
      const duplicateWindowStart = new Date(eventAt.getTime() - DUPLICATE_EVENT_WINDOW_MS);
      const duplicateWindowEnd = new Date(eventAt.getTime() + DUPLICATE_EVENT_WINDOW_MS);
      const duplicate = await tx.pipelineRunEvent.findFirst({
        where: {
          pipelineRunId: runId,
          eventType,
          processName: processName ?? null,
          stepId: stepId ?? null,
          status: statusValue ?? null,
          message: eventMessage ?? null,
          payload: eventPayload ?? null,
          source: 'weblog',
          occurredAt: {
            gte: duplicateWindowStart,
            lte: duplicateWindowEnd,
          },
        },
        select: { id: true },
      });

      if (!duplicate) {
        await tx.pipelineRunEvent.create({ data: eventRecord });
      }

      let statusWriteApplied = true;
      if (Object.keys(runUpdates).length > 0) {
        if (requiresLifecycleGuard) {
          // Lifecycle state was derived from the snapshot read before queue and
          // output processing. Re-check the current row in this transaction so
          // a concurrent cancellation/terminal write cannot be resurrected by
          // this stale weblog result.
          const { count } = await tx.pipelineRun.updateMany({
            where: {
              id: runId,
              status: { in: [...ACTIVE_RUN_STATUSES] },
              OR: [
                { statusSource: null },
                {
                  statusSource: {
                    notIn: ['finalizing', 'cancelling'],
                  },
                },
              ],
            },
            data: runUpdates,
          });
          statusWriteApplied = count > 0;
        } else {
          await tx.pipelineRun.update({
            where: { id: runId },
            data: runUpdates,
          });
        }
      }

      const excess = await tx.pipelineRunEvent.findMany({
        where: { pipelineRunId: runId },
        orderBy: { occurredAt: 'desc' },
        skip: 100,
        select: { id: true },
      });
      if (excess.length > 0) {
        await tx.pipelineRunEvent.deleteMany({
          where: { id: { in: excess.map((entry) => entry.id) } },
        });
      }

      return { statusWriteApplied };
    });

    if (
      requiresLifecycleGuard &&
      statusWriteApplied &&
      requiresStatusGuard &&
      TERMINAL_RUN_STATUSES.has(nextStatus)
    ) {
      await notifyPipelineRunTerminalInApp(runId, run.status, nextStatus);
    } else if (completedByOutputGate && statusWriteApplied) {
      await notifyPipelineRunTerminalInApp(runId, run.status, 'completed');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Pipeline Weblog] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process weblog event' },
      { status: 500 }
    );
  }
}
