import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { isDemoSession } from '@/lib/demo/server';
import { syncPipelineRunForOperator } from '@/lib/pipelines/pipeline-run-ops-service';

// POST - Sync run status from Nextflow trace file and queue state
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (isDemoSession(session)) {
      return NextResponse.json(
        { error: 'Run synchronization is disabled in the public demo.' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const run = await db.pipelineRun.findUnique({
      where: { id },
      select: {
        study: { select: { userId: true } },
        order: { select: { userId: true } },
      },
    });

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (
      session.user.role !== 'FACILITY_ADMIN' &&
      run.study?.userId !== session.user.id &&
      run.order?.userId !== session.user.id
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await syncPipelineRunForOperator(id);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('[Sync Pipeline Run API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to sync pipeline run' },
      { status: 500 }
    );
  }
}
