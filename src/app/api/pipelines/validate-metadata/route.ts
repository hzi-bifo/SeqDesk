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
    const { studyId, orderId, pipelineId, sampleIds } = body;

    if ((!studyId && !orderId) || (studyId && orderId) || !pipelineId) {
      return NextResponse.json(
        { error: 'pipelineId and exactly one of studyId or orderId are required' },
        { status: 400 }
      );
    }

    let validatedSampleIds: string[] | undefined;
    if (sampleIds !== undefined) {
      if (!Array.isArray(sampleIds)) {
        return NextResponse.json(
          { error: 'sampleIds must be an array of strings' },
          { status: 400 }
        );
      }
      if (!sampleIds.every((id) => typeof id === 'string')) {
        return NextResponse.json(
          { error: 'sampleIds must be an array of strings' },
          { status: 400 }
        );
      }
      validatedSampleIds = sampleIds;
    }

    const result = await validatePipelineMetadata(
      orderId ? { type: 'order', orderId, sampleIds: validatedSampleIds } : { type: 'study', studyId, sampleIds: validatedSampleIds },
      pipelineId,
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Validate Pipeline Metadata API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to validate metadata' },
      { status: 500 }
    );
  }
}
