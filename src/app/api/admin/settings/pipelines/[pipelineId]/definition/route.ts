import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPipelineDefinition } from '@/lib/pipelines/definitions';
import { getPackageSamplesheet } from '@/lib/pipelines/package-loader';

// GET - Get full pipeline definition including inputs/outputs
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pipelineId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { pipelineId } = await params;

    // Get full definition from registry
    const definition = getPipelineDefinition(pipelineId);

    if (!definition) {
      return NextResponse.json(
        { error: `No definition found for pipeline: ${pipelineId}` },
        { status: 404 }
      );
    }

    const samplesheet = getPackageSamplesheet(pipelineId)?.samplesheet || null;

    return NextResponse.json({
      pipeline: definition.pipeline,
      name: definition.name,
      description: definition.description,
      url: definition.url,
      version: definition.version,
      minNextflowVersion: definition.minNextflowVersion,
      authors: definition.authors,
      inputs: definition.inputs || [],
      outputs: definition.outputs || [],
      samplesheet: samplesheet || null,
      stepCount: definition.steps?.length || 0,
      parameterGroupCount: definition.parameterGroups?.length || 0,
    });
  } catch (error) {
    console.error('[Pipeline Definition API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipeline definition' },
      { status: 500 }
    );
  }
}
