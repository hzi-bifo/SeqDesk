import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { isDemoSession } from '@/lib/demo/server';
import { startPipelineRunForOperator } from '@/lib/pipelines/pipeline-run-service';

// POST - Start/execute a pipeline run
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
    let startBody: Record<string, unknown> = {};
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        startBody = parsed as Record<string, unknown>;
      }
    } catch {
      // Empty body is allowed.
    }

    const result = await startPipelineRunForOperator({
      runId: id,
      body: startBody,
      userId: session.user.id,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('[Start Pipeline Run API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to start pipeline run' },
      { status: 500 }
    );
  }
}
