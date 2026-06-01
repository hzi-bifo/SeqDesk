import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { isDemoSession } from '@/lib/demo/server';
import { syncPipelineRunForOperator } from '@/lib/pipelines/pipeline-run-ops-service';
import { assertPipelineRunReadAccess } from '@/lib/pipelines/run-visibility';

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
    const accessError = await assertPipelineRunReadAccess(id, session);
    if (accessError) {
      return NextResponse.json(accessError.body, { status: accessError.status });
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
