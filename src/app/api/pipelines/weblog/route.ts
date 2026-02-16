import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getExecutionSettings } from '@/lib/pipelines/execution-settings';
import { findStepByProcess, getStepsForPipeline } from '@/lib/pipelines/definitions';
import { getAdapter, registerAdapter } from '@/lib/pipelines/adapters';
import { createGenericAdapter } from '@/lib/pipelines/generic-adapter';
import { execFile } from 'child_process';
import { promisify } from 'util';
// Import to trigger adapter registration
import '@/lib/pipelines/adapters/mag';
import { resolveOutputs, saveRunResults } from '@/lib/pipelines/output-resolver';

type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
const MAX_EVENT_PAYLOAD = 12000;
const MAX_EVENT_FUTURE_SKEW_MS = 6 * 60 * 60 * 1000;
const MAX_EVENT_PAST_SKEW_MS = 30 * 24 * 60 * 60 * 1000;
const DUPLICATE_EVENT_WINDOW_MS = 2000;
const execFileAsync = promisify(execFile);

/**
 * Process a completed pipeline run - discover outputs and write to DB
 */
async function processCompletedRun(runId: string, pipelineId: string): Promise<void> {
  // Get the adapter for this pipeline, falling back to generic adapter
  let adapter = getAdapter(pipelineId);
  if (!adapter) {
    // Try to create a generic adapter from manifest
    const genericAdapter = createGenericAdapter(pipelineId);
    if (genericAdapter) {
      registerAdapter(genericAdapter);
      adapter = genericAdapter;
      console.log(`[Pipeline Weblog] Created generic adapter for pipeline: ${pipelineId}`);
    } else {
      console.log(`[Pipeline Weblog] No adapter available for pipeline: ${pipelineId}`);
      return;
    }
  }

  // Fetch run details including output path and samples
  const run = await db.pipelineRun.findUnique({
    where: { id: runId },
    include: {
      study: {
        include: {
          samples: {
            select: {
              id: true,
              sampleId: true,
            },
          },
        },
      },
    },
  });

  if (!run || !run.runFolder) {
    console.log(`[Pipeline Weblog] Run ${runId} has no run folder`);
    return;
  }

  const samples = run.study?.samples || [];
  if (samples.length === 0) {
    console.log(`[Pipeline Weblog] Run ${runId} has no samples`);
    return;
  }

  // Discover outputs - MAG executor creates output at runFolder/output
  const outputDir = `${run.runFolder}/output`;
  const discovered = await adapter.discoverOutputs({
    runId,
    outputDir,
    samples: samples.map((s) => ({ id: s.id, sampleId: s.sampleId })),
  });

  console.log(
    `[Pipeline Weblog] Discovered outputs for run ${runId}:`,
    discovered.summary
  );

  // Resolve outputs to DB records
  const result = await resolveOutputs(pipelineId, runId, discovered);

  // Save results summary to run
  await saveRunResults(runId, result);

  console.log(`[Pipeline Weblog] Output resolution complete for run ${runId}:`, {
    assemblies: result.assembliesCreated,
    bins: result.binsCreated,
    artifacts: result.artifactsCreated,
    errors: result.errors.length,
  });
}

async function countMaterializedOutputs(runId: string): Promise<number> {
  const [assemblies, bins, artifacts] = await Promise.all([
    db.assembly.count({ where: { createdByPipelineRunId: runId } }),
    db.bin.count({ where: { createdByPipelineRunId: runId } }),
    db.pipelineArtifact.count({ where: { pipelineRunId: runId } }),
  ]);
  return assemblies + bins + artifacts;
}

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
  return String(value).toLowerCase();
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

function normalizeQueueState(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return normalized || null;
}

function isTerminalQueueState(value: string | null | undefined): boolean {
  const normalized = normalizeQueueState(value);
  if (!normalized) return false;
  if (normalized === 'UNKNOWN') return false;

  if (
    normalized === 'COMPLETED' ||
    normalized === 'EXITED' ||
    normalized === 'REVOKED' ||
    normalized === 'TIMEOUT' ||
    normalized === 'OUT_OF_MEMORY' ||
    normalized === 'NODE_FAIL' ||
    normalized === 'BOOT_FAIL' ||
    normalized === 'PREEMPTED' ||
    normalized === 'DEADLINE'
  ) {
    return true;
  }

  return (
    normalized.startsWith('CANCELLED') ||
    normalized.startsWith('CANCELED') ||
    normalized.startsWith('FAILED')
  );
}

function isActiveQueueState(value: string | null | undefined): boolean {
  const normalized = normalizeQueueState(value);
  if (!normalized || normalized === 'UNKNOWN') return false;
  return !isTerminalQueueState(normalized);
}

function firstNonEmptyLine(value: string): string {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0] || '';
}

async function readQueueState(jobId: string | null | undefined): Promise<{ state: string | null; reason: string | null }> {
  const normalizedJobId = (jobId || '').trim();
  if (!normalizedJobId) {
    return { state: null, reason: null };
  }

  if (normalizedJobId.startsWith('local-')) {
    const pid = Number(normalizedJobId.replace('local-', ''));
    if (!Number.isInteger(pid) || pid <= 0) {
      return { state: null, reason: null };
    }
    try {
      await execFileAsync('ps', ['-p', String(pid), '-o', 'pid='], { timeout: 5000 });
      return { state: 'RUNNING', reason: null };
    } catch {
      return { state: 'EXITED', reason: null };
    }
  }

  if (!/^\d+$/.test(normalizedJobId)) {
    return { state: null, reason: null };
  }

  try {
    const { stdout } = await execFileAsync(
      'squeue',
      ['-j', normalizedJobId, '-h', '-o', '%T|%R'],
      { timeout: 5000 }
    );
    const line = firstNonEmptyLine(stdout);
    if (line) {
      const [state, reason] = line.split('|');
      return {
        state: state?.trim() || 'UNKNOWN',
        reason: reason?.trim() || null,
      };
    }
  } catch {
    // Ignore and try sacct
  }

  try {
    const { stdout } = await execFileAsync(
      'sacct',
      ['-X', '-P', '-j', normalizedJobId, '--format=JobID,State,Reason', '--noheader'],
      { timeout: 5000 }
    );
    const rows = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [rowJobId, rowState, rowReason] = line.split('|');
        return {
          jobId: rowJobId?.trim() || '',
          state: rowState?.trim() || '',
          reason: rowReason?.trim() || null,
        };
      });

    const primary =
      rows.find((row) => row.jobId === normalizedJobId) ||
      rows.find((row) => row.jobId.startsWith(`${normalizedJobId}.`)) ||
      rows[0];

    if (primary) {
      return {
        state: primary.state || 'UNKNOWN',
        reason: primary.reason,
      };
    }
  } catch {
    // Ignore and fall through
  }

  return { state: null, reason: null };
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
    if (execSettings.weblogSecret && token !== execSettings.weblogSecret) {
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

      const nextStatus: StepStatus =
        existingStep?.status === 'failed' ? 'failed' : stepStatus;

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

    if (!run.lastEventAt || eventAt >= run.lastEventAt) {
      runUpdates.lastEventAt = eventAt;
    }
    if (!run.lastWeblogAt || eventAt >= run.lastWeblogAt) {
      runUpdates.lastWeblogAt = eventAt;
    }

    if (event.includes('workflow_start') || event.includes('workflow_begin')) {
      if (!run.startedAt) {
        runUpdates.startedAt = parsedEventTime || eventAt;
      }
      if (run.status === 'pending' || run.status === 'queued') {
        runUpdates.status = 'running';
      }
    }

    if (stepStatus === 'running' && stepName) {
      runUpdates.currentStep = stepName;
      if (run.status === 'pending' || run.status === 'queued') {
        runUpdates.status = 'running';
      }
      if (!run.startedAt) {
        runUpdates.startedAt = parsedEventTime || eventAt;
      }
    }

    if (stepStatus === 'failed' && stepName) {
      // A failed process event can still be non-fatal (e.g. errorStrategy 'ignore').
      // Keep the run active and wait for workflow-level completion/error events.
      runUpdates.currentStep = `Process failed: ${stepName}`;
      if (run.status === 'pending' || run.status === 'queued') {
        runUpdates.status = 'running';
      }
      delete runUpdates.completedAt;
    }

    if (event.includes('workflow_complete') || event.includes('workflow_finish')) {
      const queueSnapshot = await readQueueState(run.queueJobId);
      if (queueSnapshot.state) {
        runUpdates.queueStatus = queueSnapshot.state;
        runUpdates.queueReason = queueSnapshot.reason || undefined;
        runUpdates.queueUpdatedAt = eventAt;
      }

      if (isActiveQueueState(queueSnapshot.state)) {
        runUpdates.status = 'running';
        runUpdates.currentStep = 'Finalizing...';
        const progressValue =
          typeof runUpdates.progress === 'number' ? runUpdates.progress : 99;
        runUpdates.progress = Math.min(99, progressValue);
        delete runUpdates.completedAt;
      } else {
        let outputsReady = true;
        try {
          await processCompletedRun(runId, run.pipelineId);
          if (run.pipelineId === 'mag') {
            outputsReady = (await countMaterializedOutputs(runId)) > 0;
          }
        } catch (err) {
          console.error('[Pipeline Weblog] Output resolution failed:', err);
          outputsReady = false;
        }

        if (outputsReady) {
          runUpdates.status = 'completed';
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

    if (event.includes('workflow_error') || event.includes('workflow_fail')) {
      runUpdates.status = 'failed';
      runUpdates.currentStep = 'Failed';
      runUpdates.completedAt = parsedEventTime || eventAt;
    }

    if (stepStatus === 'completed' || stepStatus === 'failed') {
      const pipelineSteps = getStepsForPipeline(run.pipelineId);
      const totalSteps = pipelineSteps.length;
      const completedCount = await db.pipelineRunStep.count({
        where: { pipelineRunId: runId, status: 'completed' },
      });
      if (totalSteps > 0) {
        runUpdates.progress = Math.min(
          99,
          Math.round((completedCount / totalSteps) * 100)
        );
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

    await db.$transaction(async (tx) => {
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

      if (Object.keys(runUpdates).length > 0) {
        await tx.pipelineRun.update({
          where: { id: runId },
          data: runUpdates,
        });
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
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Pipeline Weblog] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process weblog event' },
      { status: 500 }
    );
  }
}
