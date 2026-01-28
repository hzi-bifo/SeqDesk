import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { PIPELINE_REGISTRY, getAllPipelineIds } from '@/lib/pipelines';

// GET - List all pipeline configurations
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const enabledOnly = searchParams.get('enabled') === 'true';

    // Get all pipeline IDs from registry
    const allPipelineIds = getAllPipelineIds();

    // Get existing configs from database
    const configs = await db.pipelineConfig.findMany();
    const configMap = new Map(configs.map(c => [c.pipelineId, c]));

    // Build response with registry data + database config
    const pipelines = allPipelineIds.map(pipelineId => {
      const definition = PIPELINE_REGISTRY[pipelineId];
      const dbConfig = configMap.get(pipelineId);

      return {
        pipelineId,
        name: definition.name,
        description: definition.description,
        category: definition.category,
        version: definition.version,
        icon: definition.icon,
        enabled: dbConfig?.enabled ?? false,
        config: dbConfig?.config ? JSON.parse(dbConfig.config) : definition.defaultConfig,
        configSchema: definition.configSchema,
        defaultConfig: definition.defaultConfig,
        visibility: definition.visibility,
        requires: definition.requires,
        outputs: definition.outputs,
      };
    });

    // Filter if only enabled requested
    const result = enabledOnly
      ? pipelines.filter(p => p.enabled)
      : pipelines;

    return NextResponse.json({ pipelines: result });
  } catch (error) {
    console.error('[Pipelines API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipeline configurations' },
      { status: 500 }
    );
  }
}

// POST - Update a pipeline configuration
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json();
    const { pipelineId, enabled, config } = body;

    if (!pipelineId || !PIPELINE_REGISTRY[pipelineId]) {
      return NextResponse.json({ error: 'Invalid pipeline ID' }, { status: 400 });
    }

    // Upsert the configuration
    const result = await db.pipelineConfig.upsert({
      where: { pipelineId },
      create: {
        pipelineId,
        enabled: enabled ?? false,
        config: config ? JSON.stringify(config) : null,
      },
      update: {
        enabled: enabled ?? false,
        config: config ? JSON.stringify(config) : null,
      },
    });

    return NextResponse.json({
      success: true,
      pipelineId: result.pipelineId,
      enabled: result.enabled,
    });
  } catch (error) {
    console.error('[Pipelines API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update pipeline configuration' },
      { status: 500 }
    );
  }
}
