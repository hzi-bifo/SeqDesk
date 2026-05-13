import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { isDemoSession } from '@/lib/demo/server';
import {
  cancelPipelineRunForOperator,
  getPipelineRunDetailsForOperator,
} from '@/lib/pipelines/pipeline-run-ops-service';

async function assertRunAccess(runId: string, session: { user: { id: string; role: string } }) {
  const run = await db.pipelineRun.findUnique({
    where: { id: runId },
    select: {
      study: { select: { userId: true } },
      order: { select: { userId: true } },
    },
  });

  if (!run) {
    return { status: 404 as const, body: { error: 'Run not found' } };
  }

  if (
    session.user.role !== 'FACILITY_ADMIN' &&
    run.study?.userId !== session.user.id &&
    run.order?.userId !== session.user.id
  ) {
    return { status: 403 as const, body: { error: 'Forbidden' } };
  }

  return null;
}

// GET - Get run details
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
    const accessError = await assertRunAccess(id, session);
    if (accessError) {
      return NextResponse.json(accessError.body, { status: accessError.status });
    }

    const result = await getPipelineRunDetailsForOperator(id);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('[Pipeline Run API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch run details' },
      { status: 500 }
    );
  }
}

// DELETE - Cancel a run
export async function DELETE(
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
    const result = await cancelPipelineRunForOperator(id);
    if (result.status >= 400) {
      return NextResponse.json(result.body, { status: result.status });
    }
    return NextResponse.json({ success: true }, { status: result.status });
  } catch (error) {
    console.error('[Pipeline Run API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to cancel run' },
      { status: 500 }
    );
  }
}
