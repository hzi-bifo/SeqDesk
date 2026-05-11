import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getDatabaseDownloadJobStatus,
  updateDatabaseDownloadJobStatus,
} from '@/lib/pipelines/database-downloads';

export const runtime = 'nodejs';

function killProcessTree(pid: number): boolean {
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'FACILITY_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { pipelineId, databaseId } = body || {};

    if (!pipelineId || typeof pipelineId !== 'string') {
      return NextResponse.json({ error: 'Pipeline ID required' }, { status: 400 });
    }
    if (!databaseId || typeof databaseId !== 'string') {
      return NextResponse.json({ error: 'Database ID required' }, { status: 400 });
    }

    const job = await getDatabaseDownloadJobStatus(pipelineId, databaseId);
    if (!job) {
      return NextResponse.json(
        { error: 'No download job found for this database' },
        { status: 404 }
      );
    }

    if (job.state !== 'running') {
      return NextResponse.json(
        { error: `Cannot cancel job in state '${job.state}'` },
        { status: 409 }
      );
    }

    const killed = job.pid ? killProcessTree(job.pid) : false;

    await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
      state: 'error',
      cancelled: true,
      finishedAt: new Date().toISOString(),
      error: 'Download cancelled by user',
    });

    return NextResponse.json({
      cancelled: true,
      killedProcess: killed,
      pid: job.pid ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to cancel download',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
