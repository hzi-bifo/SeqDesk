import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getExecutionSettings } from '@/app/api/admin/settings/pipelines/execution/route';
import { findStepByProcess, getStepsForPipeline } from '@/lib/pipelines/definitions';
import { getAdapter, registerAdapter } from '@/lib/pipelines/adapters';
import { createGenericAdapter } from '@/lib/pipelines/generic-adapter';
// Import to trigger adapter registration
import '@/lib/pipelines/adapters/mag';
import { resolveOutputs, saveRunResults } from '@/lib/pipelines/output-resolver';

type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

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
    if (execSettings.weblogSecret && token !== execSettings.weblogSecret) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
    }

    const payload = (await request.json()) as Record<string, unknown>;
    const event = normalizeEvent(payload.event || payload.eventType || payload.type);
    const trace = getTrace(payload);

    const run = await db.pipelineRun.findUnique({
      where: { id: runId },
      select: { id: true, pipelineId: true, status: true, startedAt: true, completedAt: true },
    });

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    const eventTime =
      parseDate(payload.utcTime) ||
      parseDate(payload.timestamp) ||
      parseDate(trace?.start) ||
      parseDate(trace?.submit) ||
      parseDate(trace?.complete);

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
        (stepStatus === 'running' ? eventTime : undefined);
      const completedAt =
        existingStep?.completedAt ||
        (stepStatus === 'completed' || stepStatus === 'failed' ? eventTime : undefined);

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

    const runUpdates: Record<string, unknown> = {};

    if (event.includes('workflow_start') || event.includes('workflow_begin')) {
      if (!run.startedAt) {
        runUpdates.startedAt = eventTime || new Date();
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
        runUpdates.startedAt = eventTime || new Date();
      }
    }

    if (stepStatus === 'failed' && stepName) {
      runUpdates.status = 'failed';
      runUpdates.currentStep = `Failed at ${stepName}`;
      runUpdates.completedAt = eventTime || new Date();
    }

    if (event.includes('workflow_complete') || event.includes('workflow_finish')) {
      runUpdates.status = 'completed';
      runUpdates.currentStep = 'Completed';
      runUpdates.completedAt = eventTime || new Date();
      runUpdates.progress = 100;

      // Trigger output resolution asynchronously
      processCompletedRun(runId, run.pipelineId).catch((err) => {
        console.error('[Pipeline Weblog] Output resolution failed:', err);
      });
    }

    if (event.includes('workflow_error') || event.includes('workflow_fail')) {
      runUpdates.status = 'failed';
      runUpdates.currentStep = 'Failed';
      runUpdates.completedAt = eventTime || new Date();
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

    if (Object.keys(runUpdates).length > 0) {
      await db.pipelineRun.update({
        where: { id: runId },
        data: runUpdates,
      });
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
