import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import fs from 'fs/promises';

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
