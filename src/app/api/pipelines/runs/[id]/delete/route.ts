import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import fs from 'fs/promises';
import { isDemoSession } from '@/lib/demo/server';
import { cancelPipelineRunForOperator } from '@/lib/pipelines/pipeline-run-ops-service';
import {
  isActiveQueueState,
  isQueueSnapshotRetryable,
  isTerminalQueueState,
  readIdentityCheckedQueueSnapshot,
} from '@/lib/pipelines/queue-probe';
import { cleanupRunOutputData } from '@/lib/pipelines/run-delete';

const runInclude = {
  study: {
    select: {
      id: true,
      samples: {
        select: {
          id: true,
          sampleId: true,
        },
      },
    },
  },
  order: {
    select: {
      id: true,
      samples: {
        select: {
          id: true,
          sampleId: true,
        },
      },
    },
  },
} as const;

function parseSelectedSampleIds(value: string | null): string[] | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) {
      return null;
    }
    return parsed as string[];
  } catch {
    return null;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (isDemoSession(session)) {
      return NextResponse.json(
        { error: 'Pipeline execution is disabled in the public demo.' },
        { status: 403 }
      );
    }

    const { id } = await params;

    let run = await db.pipelineRun.findUnique({
      where: { id },
      include: runInclude,
    });

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (
      run.statusSource === 'finalizing' ||
      run.statusSource === 'cancelling'
    ) {
      return NextResponse.json(
        {
          error: 'Cannot delete while another lifecycle operation is active',
          status: run.status,
          statusSource: run.statusSource,
        },
        { status: 409 }
      );
    }

    if (run.status === 'running') {
      return NextResponse.json(
        { error: 'Cannot delete a running run. Cancel it first.' },
        { status: 400 }
      );
    }

    // Claim every pending/queued run, including the launch window before a job
    // ID has been persisted. The cancellation claim fences the launcher; only a
    // fresh terminal snapshot may proceed to destructive cleanup.
    if (run.status === 'queued' || run.status === 'pending') {
      const cancelResult = await cancelPipelineRunForOperator(id);
      if (cancelResult.status >= 400) {
        return NextResponse.json(cancelResult.body, {
          status: cancelResult.status,
        });
      }

      // Deletion is destructive and must only continue once cancellation has
      // positively reached a terminal state. This also prevents a future
      // cancellation-response regression from treating an active lifecycle
      // owner (`finalizing`/`cancelling`) as safe to delete.
      const cancellationStatus =
        typeof cancelResult.body.status === 'string'
          ? cancelResult.body.status
          : null;
      if (
        !cancellationStatus ||
        !['completed', 'failed', 'cancelled'].includes(cancellationStatus)
      ) {
        return NextResponse.json(
          {
            error: 'Run cancellation has not reached a terminal state',
            status: cancellationStatus ?? run.status,
            statusSource:
              typeof cancelResult.body.statusSource === 'string'
                ? cancelResult.body.statusSource
                : null,
          },
          { status: 409 }
        );
      }

      run = await db.pipelineRun.findUnique({
        where: { id },
        include: runInclude,
      });
      if (!run) {
        return NextResponse.json({ error: 'Run not found' }, { status: 404 });
      }
    }

    if (
      run.statusSource === 'finalizing' ||
      run.statusSource === 'cancelling'
    ) {
      return NextResponse.json(
        {
          error: 'Cannot delete while another lifecycle operation is active',
          status: run.status,
          statusSource: run.statusSource,
        },
        { status: 409 }
      );
    }
    if (!['completed', 'failed', 'cancelled'].includes(run.status)) {
      return NextResponse.json(
        {
          error: 'Run has not reached a terminal state',
          status: run.status,
          statusSource: run.statusSource,
        },
        { status: 409 }
      );
    }

    if (run.queueJobId) {
      const queueSnapshot = await readIdentityCheckedQueueSnapshot({
        jobId: run.queueJobId,
        runId: run.id,
        runFolder: run.runFolder,
      });
      if (
        isQueueSnapshotRetryable(queueSnapshot) ||
        isActiveQueueState(queueSnapshot.state) ||
        !isTerminalQueueState(queueSnapshot.state)
      ) {
        return NextResponse.json(
          {
            error:
              queueSnapshot.reason ||
              'Cannot delete until the exact queue job is verified inactive',
            status: run.status,
            queueStatus: queueSnapshot.state,
          },
          { status: 409 }
        );
      }
    }

    const target =
      run.targetType === 'order' && run.orderId
        ? { type: 'order' as const, orderId: run.orderId }
        : run.studyId
          ? { type: 'study' as const, studyId: run.studyId }
          : null;

    if (target) {
      const selectedSampleIds = parseSelectedSampleIds(run.inputSampleIds);
      const selectedSampleIdSet = selectedSampleIds
        ? new Set(selectedSampleIds)
        : null;
      const targetSamples =
        run.targetType === 'order'
          ? run.order?.samples || []
          : run.study?.samples || [];
      const samples = selectedSampleIdSet
        ? targetSamples.filter((sample) => selectedSampleIdSet.has(sample.id))
        : targetSamples;

      await cleanupRunOutputData({
        runId: id,
        pipelineId: run.pipelineId,
        runFolder: run.runFolder,
        target,
        samples,
      });
    }

    // Delete related records that don't cascade automatically
    await db.assembly.deleteMany({
      where: { createdByPipelineRunId: id },
    });

    await db.bin.deleteMany({
      where: { createdByPipelineRunId: id },
    });

    // Steps and artifacts cascade via onDelete: Cascade in the schema,
    // but delete explicitly to be safe
    await db.pipelineRunStep.deleteMany({
      where: { pipelineRunId: id },
    });

    await db.pipelineArtifact.deleteMany({
      where: { pipelineRunId: id },
    });

    // Delete the run record
    await db.pipelineRun.delete({
      where: { id },
    });

    // Delete run folder from disk if it exists
    if (run.runFolder) {
      try {
        await fs.rm(run.runFolder, { recursive: true, force: true });
      } catch {
        // Folder may already be gone — not a fatal error
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Pipeline Run Delete API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete run' },
      { status: 500 }
    );
  }
}
