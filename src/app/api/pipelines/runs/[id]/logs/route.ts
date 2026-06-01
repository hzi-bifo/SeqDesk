import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { getPipelineRunLogsForOperator } from '@/lib/pipelines/pipeline-run-ops-service';
import { assertPipelineRunReadAccess } from '@/lib/pipelines/run-visibility';

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
    const accessError = await assertPipelineRunReadAccess(id, session);
    if (accessError) {
      return NextResponse.json(accessError.body, { status: accessError.status });
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
