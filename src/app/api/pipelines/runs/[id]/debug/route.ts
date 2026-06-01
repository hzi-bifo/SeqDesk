import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { isDemoSession } from '@/lib/demo/server';
import {
  type DebugBundle,
  buildDebugBundleText,
  getPipelineDebugBundleForOperator,
} from '@/lib/pipelines/pipeline-run-ops-service';
import { assertPipelineRunReadAccess } from '@/lib/pipelines/run-visibility';

// GET - Build a debug bundle (run/session info) for support
export async function GET(
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
        { error: 'Run diagnostics are disabled in the public demo.' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const accessError = await assertPipelineRunReadAccess(id, session);
    if (accessError) {
      return NextResponse.json(accessError.body, { status: accessError.status });
    }

    const result = await getPipelineDebugBundleForOperator(id);
    if (result.status >= 400) {
      return NextResponse.json(result.body, { status: result.status });
    }

    const format = new URL(request.url).searchParams.get('format');
    if (format === 'text') {
      return new NextResponse(buildDebugBundleText(result.body as DebugBundle), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
        },
      });
    }

    return NextResponse.json(result.body);
  } catch (error) {
    console.error('[Run Debug API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to build debug bundle' },
      { status: 500 }
    );
  }
}
