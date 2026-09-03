import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  authorizationErrorResponse,
  decideServerCapability,
} from '@/lib/authorization/api';
import { getPipelineDag } from '@/lib/pipelines/definitions';

// GET - Get DAG data for a pipeline
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pipelineId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    const access = decideServerCapability(session, 'system.pipelines.manage');
    if (!access.allowed) {
      return authorizationErrorResponse(access);
    }

    const { pipelineId } = await params;

    // Get DAG data from registry
    const dagData = getPipelineDag(pipelineId);

    if (!dagData) {
      return NextResponse.json(
        { error: `No workflow definition for pipeline: ${pipelineId}` },
        { status: 404 }
      );
    }

    return NextResponse.json(dagData);
  } catch (error) {
    console.error('[Pipeline DAG API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipeline DAG' },
      { status: 500 }
    );
  }
}
