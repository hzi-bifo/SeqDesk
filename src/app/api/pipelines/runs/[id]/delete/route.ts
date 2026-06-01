import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import fs from 'fs/promises';
import { isDemoSession } from '@/lib/demo/server';
import { cancelPipelineRunForOperator } from '@/lib/pipelines/pipeline-run-ops-service';
import { cleanupRunOutputData } from '@/lib/pipelines/run-delete';

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

    const run = await db.pipelineRun.findUnique({
      where: { id },
      include: {
        // queueJobId is included via the model fields by default with `include`.
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
      },
    });

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (run.status === 'running') {
      return NextResponse.json(
        { error: 'Cannot delete a running run. Cancel it first.' },
        { status: 400 }
      );
    }

    // A queued/pending run can already have a live scheduler job (SLURM job or
    // local PID) attached. Deleting the row + folder without cancelling would
    // orphan that job: the scheduler later promotes it to running against a
    // deleted run folder and a missing run row, wasting compute and producing
    // failed weblog callbacks. Cancel the live job before deleting.
    if (
      run.queueJobId &&
      (run.status === 'queued' || run.status === 'pending')
    ) {
      const cancelResult = await cancelPipelineRunForOperator(id);
      if (cancelResult.status >= 400) {
        return NextResponse.json(cancelResult.body, {
          status: cancelResult.status,
        });
      }
    }

    const target =
      run.targetType === 'order' && run.orderId
        ? { type: 'order' as const, orderId: run.orderId }
        : run.studyId
          ? { type: 'study' as const, studyId: run.studyId }
          : null;

    if (target && ['completed', 'failed', 'cancelled'].includes(run.status)) {
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
