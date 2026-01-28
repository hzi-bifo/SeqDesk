import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { parseTraceFile, findTraceFile } from '@/lib/pipelines/nextflow';
import { findStepByProcess, getStepsForPipeline } from '@/lib/pipelines/definitions';

// POST - Sync run status from Nextflow trace file
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { id } = await params;

    const run = await db.pipelineRun.findUnique({
      where: { id },
      select: {
        id: true,
        runFolder: true,
        status: true,
        pipelineId: true,
      },
    });

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (!run.runFolder) {
      return NextResponse.json(
        { error: 'Run folder not set' },
        { status: 400 }
      );
    }

    // Find and parse trace file
    const tracePath = await findTraceFile(run.runFolder);

    if (!tracePath) {
      return NextResponse.json({
        success: true,
        message: 'No trace file found yet',
        synced: false,
      });
    }

    const traceResult = await parseTraceFile(tracePath);

    const steps = new Map<string, {
      stepName: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      startedAt?: Date;
      completedAt?: Date;
    }>();

    for (const task of traceResult.tasks) {
      const stepDef = findStepByProcess(run.pipelineId, task.process);
      const stepId = stepDef?.id || task.process;
      const stepName = stepDef?.name || task.process;

      if (!steps.has(stepId)) {
        steps.set(stepId, { stepName, status: 'pending' });
      }

      const entry = steps.get(stepId)!;
      const status = task.status.toLowerCase();

      if (status.includes('fail') || task.exit !== undefined && task.exit !== 0) {
        entry.status = 'failed';
      } else if (status.includes('run') || status.includes('start') || status.includes('submit')) {
        if (entry.status !== 'failed') entry.status = 'running';
      } else if (status.includes('complete') || status.includes('done') || status.includes('success')) {
        if (entry.status === 'pending') entry.status = 'completed';
      }

      const startedAt = task.start || task.submit;
      if (startedAt && (!entry.startedAt || startedAt < entry.startedAt)) {
        entry.startedAt = startedAt;
      }

      if (task.complete && (!entry.completedAt || task.complete > entry.completedAt)) {
        entry.completedAt = task.complete;
      }
    }

    for (const [stepId, entry] of steps) {
      await db.pipelineRunStep.upsert({
        where: {
          pipelineRunId_stepId: {
            pipelineRunId: id,
            stepId,
          },
        },
        create: {
          pipelineRunId: id,
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

    // Build current step description
    const runningProcesses = Array.from(steps.entries())
      .filter(([, s]) => s.status === 'running')
      .map(([stepId]) => stepId);

    const currentStep = runningProcesses.length > 0
      ? `Running: ${runningProcesses.join(', ')}`
      : traceResult.overallProgress === 100
        ? 'Completed'
        : 'Processing...';

    // Update run with progress
    const pipelineSteps = getStepsForPipeline(run.pipelineId);
    const totalSteps = pipelineSteps.length;
    const completedSteps = Array.from(steps.values()).filter(s => s.status === 'completed').length;
    const progress = totalSteps > 0
      ? Math.min(99, Math.round((completedSteps / totalSteps) * 100))
      : traceResult.overallProgress;

    await db.pipelineRun.update({
      where: { id },
      data: {
        progress,
        currentStep,
        // Update timestamps if available
        ...(traceResult.startedAt && !run.status.includes('running') ? {
          startedAt: traceResult.startedAt,
        } : {}),
      },
    });

    return NextResponse.json({
      success: true,
      synced: true,
      progress: traceResult.overallProgress,
      processes: traceResult.processes.size,
      tasks: traceResult.tasks.length,
      currentStep,
    });
  } catch (error) {
    console.error('[Sync Pipeline Run API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to sync pipeline run' },
      { status: 500 }
    );
  }
}
