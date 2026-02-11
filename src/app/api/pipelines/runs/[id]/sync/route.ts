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

type QueueSource = 'local' | 'squeue' | 'sacct' | null;

type QueueSnapshot = {
  state: string | null;
  reason: string | null;
  source: QueueSource;
};

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

async function readQueueSnapshot(jobId: string | null | undefined): Promise<QueueSnapshot> {
  const normalizedJobId = (jobId || '').trim();
  if (!normalizedJobId) {
    return { state: null, reason: null, source: null };
  }

  if (normalizedJobId.startsWith('local-')) {
    const pid = Number(normalizedJobId.replace('local-', ''));
    if (!Number.isInteger(pid) || pid <= 0) {
      return { state: null, reason: null, source: 'local' };
    }
    try {
      await execFileAsync('ps', ['-p', String(pid), '-o', 'pid='], { timeout: 5000 });
      return { state: 'RUNNING', reason: null, source: 'local' };
    } catch {
      return { state: 'EXITED', reason: null, source: 'local' };
    }
  }

  if (!/^\d+$/.test(normalizedJobId)) {
    return { state: null, reason: null, source: null };
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
        source: 'squeue',
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
        source: 'sacct',
      };
    }
  } catch {
    // Ignore and fall through
  }

  return { state: null, reason: null, source: null };
}

async function countMaterializedOutputs(runId: string): Promise<number> {
  const [assemblies, bins, artifacts] = await Promise.all([
    db.assembly.count({ where: { createdByPipelineRunId: runId } }),
    db.bin.count({ where: { createdByPipelineRunId: runId } }),
    db.pipelineArtifact.count({ where: { pipelineRunId: runId } }),
  ]);
  return assemblies + bins + artifacts;
}

// POST - Sync run status from Nextflow trace file
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
        study: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (
      session.user.role !== 'FACILITY_ADMIN' &&
      run.study?.userId !== session.user.id
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
      const queueSnapshot = await readQueueSnapshot(run.queueJobId);
      const queueState = queueSnapshot.state;
      const queueReason = queueSnapshot.reason;
      const queueSource = queueSnapshot.source;

      if (queueState) {
        updateData.queueStatus = queueState;
        updateData.queueReason = queueReason || undefined;
        updateData.queueUpdatedAt = now;
      }

      const normalizedQueueState = normalizeQueueState(queueState);
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
      let resolvedOutputsInThisSync = false;

      if (shouldFinalize) {
        let inferredExitCode: number | null = null;
        if (isCompletedQueueState || isExitedLocalState) {
          inferredExitCode = await inferPipelineExitCode(run.runFolder);
        }

        const consideredSuccessful = isCompletedQueueState || (isExitedLocalState && inferredExitCode === 0);
        if (consideredSuccessful) {
          let outputsReady = true;
          if (run.pipelineId === 'mag') {
            try {
              await processCompletedPipelineRun(id, run.pipelineId);
              resolvedOutputsInThisSync = true;
              outputsReady = (await countMaterializedOutputs(id)) > 0;
            } catch (processError) {
              console.error('[Sync Pipeline Run API] Post-completion processing failed:', processError);
              outputsReady = false;
            }
          }

          if (!outputsReady) {
            updateData.status = 'running';
            updateData.progress = 99;
            updateData.currentStep = 'Finalizing outputs...';
            updateData.completedAt = null;
            updateData.statusSource = 'queue';
            updateData.lastEventAt = now;
            updateData.queueStatus = queueState || 'COMPLETED';
          } else {
          updateData.status = 'completed';
          updateData.progress = 100;
          updateData.currentStep = 'Completed';
          updateData.completedAt = now;
          updateData.statusSource = 'queue';
          updateData.lastEventAt = now;
          updateData.queueStatus = queueState || 'COMPLETED';
          }
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

      if (nextStatus === 'completed' && run.status !== 'completed' && !resolvedOutputsInThisSync) {
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

    const stepSignals = new Map<string, {
      stepName: string;
      hasFailure: boolean;
      hasRunning: boolean;
      hasCompletion: boolean;
      startedAt?: Date;
      completedAt?: Date;
    }>();

    const normalizeStatus = (value?: string) => (value ? value.toLowerCase() : '');
    for (const task of traceResult.tasks) {
      const stepDef = findStepByProcess(run.pipelineId, task.process);
      const stepId = stepDef?.id || task.process;
      const stepName = stepDef?.name || task.process;

      if (!stepSignals.has(stepId)) {
        stepSignals.set(stepId, {
          stepName,
          hasFailure: false,
          hasRunning: false,
          hasCompletion: false,
        });
      }

      const entry = stepSignals.get(stepId)!;
      const status = normalizeStatus(task.status);

      if (status.includes('fail') || task.exit !== undefined && task.exit !== 0) {
        entry.hasFailure = true;
      } else if (status.includes('run') || status.includes('start') || status.includes('submit')) {
        entry.hasRunning = true;
      } else if (
        status.includes('complete') ||
        status.includes('done') ||
        status.includes('success') ||
        status.includes('cache')
      ) {
        entry.hasCompletion = true;
      }

      const startedAt = task.start || task.submit;
      if (startedAt && (!entry.startedAt || startedAt < entry.startedAt)) {
        entry.startedAt = startedAt;
      }

      if (task.complete && (!entry.completedAt || task.complete > entry.completedAt)) {
        entry.completedAt = task.complete;
      }
    }

    const steps = new Map<string, {
      stepName: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      startedAt?: Date;
      completedAt?: Date;
    }>();

    for (const [stepId, entry] of stepSignals) {
      const status: 'pending' | 'running' | 'completed' | 'failed' =
        entry.hasFailure
          ? 'failed'
          : entry.hasRunning
            ? 'running'
            : entry.hasCompletion
              ? 'completed'
              : 'pending';

      steps.set(stepId, {
        stepName: entry.stepName,
        status,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt,
      });
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
    let resolvedOutputsInThisSync = false;
    if (traceResult.overallProgress === 100 && hasTasks) {
      nextStatus = 'completed';
    } else if (hasFailures) {
      nextStatus = 'failed';
    } else if (hasRunning) {
      nextStatus = 'running';
    }

    if (nextStatus === 'completed' && run.pipelineId === 'mag') {
      try {
        await processCompletedPipelineRun(id, run.pipelineId);
        resolvedOutputsInThisSync = true;
        const outputCount = await countMaterializedOutputs(id);
        if (outputCount === 0) {
          nextStatus = 'running';
        }
      } catch (processError) {
        console.error('[Sync Pipeline Run API] Post-completion processing failed:', processError);
        nextStatus = 'running';
      }
    }

    const traceQueueSnapshot = await readQueueSnapshot(run.queueJobId);
    const forceRunningFromQueue = nextStatus === 'completed' && isActiveQueueState(traceQueueSnapshot.state);
    if (forceRunningFromQueue) {
      nextStatus = 'running';
    }

    const updateData: Record<string, unknown> = {
      progress: nextStatus === 'completed' ? 100 : progress,
      currentStep:
        forceRunningFromQueue
          ? (runningProcesses.length > 0
            ? `Running: ${runningProcesses.join(', ')}`
            : 'Finalizing...')
          : nextStatus === 'completed'
            ? 'Completed'
          : nextStatus === 'failed'
            ? 'Failed'
            : currentStep,
      statusSource: forceRunningFromQueue ? 'queue' : 'trace',
    };

    if (traceQueueSnapshot.state) {
      updateData.queueStatus = traceQueueSnapshot.state;
      updateData.queueReason = traceQueueSnapshot.reason || undefined;
      updateData.queueUpdatedAt = new Date();
    }

    if (latestEventAt && (!run.lastEventAt || latestEventAt > run.lastEventAt)) {
      updateData.lastEventAt = latestEventAt;
    }
    if (latestEventAt && (!run.lastTraceAt || latestEventAt > run.lastTraceAt)) {
      updateData.lastTraceAt = latestEventAt;
    }

    if (forceRunningFromQueue) {
      updateData.completedAt = null;
      updateData.lastEventAt = new Date();
      updateData.progress = Math.min(99, progress);
    } else if (nextStatus === 'running' && traceResult.overallProgress === 100) {
      updateData.currentStep = 'Finalizing outputs...';
      updateData.progress = 99;
      updateData.completedAt = null;
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

    if (nextStatus === 'completed' && run.status !== 'completed' && !resolvedOutputsInThisSync) {
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
