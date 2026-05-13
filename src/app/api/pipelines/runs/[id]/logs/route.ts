import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { getPipelineRunLogsForOperator } from '@/lib/pipelines/pipeline-run-ops-service';

// GET - Get logs for a pipeline run
export async function GET(
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

    const { searchParams } = new URL(request.url);
    const result = await getPipelineRunLogsForOperator(id, {
      type: searchParams.get('type') || 'output',
      tail: parseInt(searchParams.get('tail') || '100', 10),
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('[Pipeline Logs API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch logs' },
      { status: 500 }
    );
  }
}
