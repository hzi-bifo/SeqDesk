import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import fs from 'fs/promises';
import { isDemoSession } from '@/lib/demo/server';
import { cleanupRunOutputData } from '@/lib/pipelines/run-delete';

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

    const target =
      run.targetType === 'order' && run.orderId
        ? { type: 'order' as const, orderId: run.orderId }
        : run.studyId
          ? { type: 'study' as const, studyId: run.studyId }
          : null;

    if (target) {
      const samples =
        run.targetType === 'order'
          ? run.order?.samples || []
          : run.study?.samples || [];

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
