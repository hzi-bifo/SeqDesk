import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { parseTraceFile, findTraceFile } from '@/lib/pipelines/nextflow';
import { findStepByProcess, getStepsForPipeline } from '@/lib/pipelines/definitions';
import {
  inferPipelineExitCode,
  processCompletedPipelineRun,
} from '@/lib/pipelines/run-completion';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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
        startedAt: true,
        completedAt: true,
        lastEventAt: true,
        lastTraceAt: true,
        queueJobId: true,
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
      // If no trace yet, sync status from local process/SLURM queue state.
      const now = new Date();
      const updateData: Record<string, unknown> = {};
      const jobId = run.queueJobId || '';
      let queueState: string | null = null;
      let queueReason: string | null = null;
      let queueSource: 'local' | 'squeue' | 'sacct' | null = null;

      if (jobId.startsWith('local-')) {
        const pid = Number(jobId.replace('local-', ''));
        if (Number.isInteger(pid) && pid > 0) {
          try {
            await execFileAsync('ps', ['-p', String(pid), '-o', 'pid='], { timeout: 5000 });
            queueState = 'RUNNING';
            queueSource = 'local';
          } catch {
            queueState = 'EXITED';
            queueSource = 'local';
          }
        }
      } else if (/^\d+$/.test(jobId)) {
        try {
          const { stdout } = await execFileAsync('squeue', ['-j', jobId, '-h', '-o', '%T|%R'], { timeout: 5000 });
          const line = stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
          if (line) {
            const [state, reason] = line.split('|');
            queueState = state || 'UNKNOWN';
            queueReason = reason || null;
            queueSource = 'squeue';
          }
        } catch {
          // Ignore and try sacct
        }

        if (!queueState) {
          try {
            const { stdout } = await execFileAsync(
              'sacct',
              ['-j', jobId, '--format=State,Reason', '--noheader'],
              { timeout: 5000 }
            );
            const line = stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
            if (line) {
              const [state, reason] = line.split(/\s+/);
              queueState = state || 'UNKNOWN';
              queueReason = reason || null;
              queueSource = 'sacct';
            }
          } catch {
            // ignore
          }
        }
      }

      if (queueState) {
        updateData.queueStatus = queueState;
        updateData.queueReason = queueReason || undefined;
        updateData.queueUpdatedAt = now;
      }

      const normalizedQueueState = queueState ? queueState.toUpperCase() : null;
      const isRunningQueueState = normalizedQueueState === 'RUNNING';
      const isCompletedQueueState = normalizedQueueState === 'COMPLETED';
      const isExitedLocalState = normalizedQueueState === 'EXITED';
      const isCancelledQueueState =
        normalizedQueueState?.startsWith('CANCELLED') ||
        normalizedQueueState?.startsWith('CANCELED') ||
        normalizedQueueState === 'REVOKED';
      const isFailedQueueState = Boolean(
        normalizedQueueState &&
          (
            normalizedQueueState.startsWith('FAILED') ||
            normalizedQueueState === 'TIMEOUT' ||
            normalizedQueueState === 'OUT_OF_MEMORY' ||
            normalizedQueueState === 'NODE_FAIL' ||
            normalizedQueueState === 'BOOT_FAIL' ||
            normalizedQueueState === 'PREEMPTED' ||
            normalizedQueueState === 'DEADLINE'
          )
      );

      if (isRunningQueueState && run.status === 'queued') {
        updateData.status = 'running';
        updateData.startedAt = run.startedAt || now;
        updateData.lastEventAt = now;
        updateData.statusSource = 'queue';
      }

      const inTerminalCandidateState = ['pending', 'queued', 'running'].includes(run.status);
      const shouldFinalize = inTerminalCandidateState && (isCompletedQueueState || isExitedLocalState || isCancelledQueueState || isFailedQueueState);

      if (shouldFinalize) {
        let inferredExitCode: number | null = null;
        if (isCompletedQueueState || isExitedLocalState) {
          inferredExitCode = await inferPipelineExitCode(run.runFolder);
        }

        const consideredSuccessful = isCompletedQueueState || (isExitedLocalState && inferredExitCode === 0);
        if (consideredSuccessful) {
          updateData.status = 'completed';
          updateData.progress = 100;
          updateData.currentStep = 'Completed';
          updateData.completedAt = now;
          updateData.statusSource = 'queue';
          updateData.lastEventAt = now;
          updateData.queueStatus = queueState || 'COMPLETED';
        } else if (isCancelledQueueState) {
          updateData.status = 'cancelled';
          updateData.currentStep = 'Cancelled';
          updateData.completedAt = now;
          updateData.statusSource = 'queue';
          updateData.lastEventAt = now;
        } else {
          updateData.status = 'failed';
          updateData.currentStep = 'Failed';
          updateData.completedAt = now;
          updateData.statusSource = 'queue';
          updateData.lastEventAt = now;
        }
      }

      const nextStatus =
        typeof updateData.status === 'string' ? (updateData.status as string) : run.status;

      if (Object.keys(updateData).length > 0) {
        await db.pipelineRun.update({ where: { id }, data: updateData });
      }

      if (nextStatus === 'completed' && run.status !== 'completed') {
        try {
          await processCompletedPipelineRun(id, run.pipelineId);
        } catch (processError) {
          console.error('[Sync Pipeline Run API] Post-completion processing failed:', processError);
        }
      }

      return NextResponse.json({
        success: true,
        message: 'No trace file found yet',
        synced: false,
        status: nextStatus,
        queueStatus: queueState,
        queueSource,
      });
    }

    const traceResult = await parseTraceFile(tracePath);

    const steps = new Map<string, {
      stepName: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      startedAt?: Date;
      completedAt?: Date;
    }>();

    const normalizeStatus = (value?: string) => (value ? value.toLowerCase() : '');
    for (const task of traceResult.tasks) {
      const stepDef = findStepByProcess(run.pipelineId, task.process);
      const stepId = stepDef?.id || task.process;
      const stepName = stepDef?.name || task.process;

      if (!steps.has(stepId)) {
        steps.set(stepId, { stepName, status: 'pending' });
      }

      const entry = steps.get(stepId)!;
      const status = normalizeStatus(task.status);

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

    const latestEventAt = traceResult.tasks
      .flatMap((task) => [task.submit, task.start, task.complete].filter((t): t is Date => !!t))
      .sort((a, b) => b.getTime() - a.getTime())[0];

    const hasFailures = traceResult.tasks.some((task) => {
      const status = normalizeStatus(task.status);
      return (
        status.includes('fail') ||
        status.includes('error') ||
        status.includes('aborted') ||
        (task.exit !== undefined && task.exit !== 0)
      );
    });
    const hasRunning = traceResult.tasks.some((task) => {
      const status = normalizeStatus(task.status);
      return status.includes('run') || status.includes('start') || status.includes('submit');
    });
    const hasTasks = traceResult.tasks.length > 0;

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

    let nextStatus = run.status;
    if (traceResult.overallProgress === 100 && hasTasks) {
      nextStatus = 'completed';
    } else if (hasFailures) {
      nextStatus = 'failed';
    } else if (hasRunning) {
      nextStatus = 'running';
    }

    const updateData: Record<string, unknown> = {
      progress: nextStatus === 'completed' ? 100 : progress,
      currentStep:
        nextStatus === 'completed'
          ? 'Completed'
          : nextStatus === 'failed'
            ? 'Failed'
            : currentStep,
      statusSource: 'trace',
    };

    if (latestEventAt && (!run.lastEventAt || latestEventAt > run.lastEventAt)) {
      updateData.lastEventAt = latestEventAt;
    }
    if (latestEventAt && (!run.lastTraceAt || latestEventAt > run.lastTraceAt)) {
      updateData.lastTraceAt = latestEventAt;
    }

    if (traceResult.startedAt && !run.startedAt) {
      updateData.startedAt = traceResult.startedAt;
    }

    if (nextStatus !== run.status) {
      updateData.status = nextStatus;
    }

    if (nextStatus === 'completed' && !run.completedAt) {
      updateData.completedAt = traceResult.completedAt || latestEventAt || new Date();
    }

    if (nextStatus === 'failed' && !run.completedAt) {
      updateData.completedAt = latestEventAt || new Date();
    }

    await db.pipelineRun.update({
      where: { id },
      data: updateData,
    });

    if (nextStatus === 'completed' && run.status !== 'completed') {
      try {
        await processCompletedPipelineRun(id, run.pipelineId);
      } catch (processError) {
        console.error('[Sync Pipeline Run API] Post-completion processing failed:', processError);
      }
    }

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
