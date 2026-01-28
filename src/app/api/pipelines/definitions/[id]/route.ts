import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPipelineDag, getPipelineDefinition } from '@/lib/pipelines/definitions';

// GET - Get pipeline definition with workflow DAG
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

    const definition = getPipelineDefinition(id);
    const dag = getPipelineDag(id);

    if (!definition || !dag) {
      return NextResponse.json(
        { error: 'Pipeline definition not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      definition: {
        id: definition.pipeline,
        name: definition.name,
        description: definition.description,
        version: definition.version,
        url: definition.url,
      },
      nodes: dag.nodes,
      edges: dag.edges,
    });
  } catch (error) {
    console.error('[Pipeline Definition API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load pipeline definition' },
      { status: 500 }
    );
  }
}
