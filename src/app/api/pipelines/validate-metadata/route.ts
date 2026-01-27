import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { validatePipelineMetadata } from '@/lib/pipelines/metadata-validation';

// POST - Validate metadata for a pipeline run
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { studyId, pipelineId } = body;

    if (!studyId || !pipelineId) {
      return NextResponse.json(
        { error: 'studyId and pipelineId are required' },
        { status: 400 }
      );
    }

    const result = await validatePipelineMetadata(studyId, pipelineId);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Validate Pipeline Metadata API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to validate metadata' },
      { status: 500 }
    );
  }
}
