import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { PIPELINE_REGISTRY } from '@/lib/pipelines';

// GET - List pipeline runs
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const pipelineId = searchParams.get('pipelineId');
    const status = searchParams.get('status');
    const studyId = searchParams.get('studyId');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Build query
    const where: Record<string, unknown> = {};

    // Non-admins can only see runs for their own studies
    if (session.user.role !== 'FACILITY_ADMIN') {
      where.study = { userId: session.user.id };
    }

    if (pipelineId) {
      where.pipelineId = pipelineId;
    }

    if (status) {
      where.status = status;
    }

    if (studyId) {
      where.studyId = studyId;
    }

    const [runs, total] = await Promise.all([
      db.pipelineRun.findMany({
        where,
        include: {
          study: {
            select: { id: true, title: true, userId: true },
          },
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          _count: {
            select: { assembliesCreated: true, binsCreated: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.pipelineRun.count({ where }),
    ]);

    // Enrich with pipeline metadata
    const enrichedRuns = runs.map(run => {
      const definition = PIPELINE_REGISTRY[run.pipelineId];
      return {
        ...run,
        pipelineName: definition?.name || run.pipelineId,
        pipelineIcon: definition?.icon || 'CircleDot',
        results: run.results ? JSON.parse(run.results) : null,
      };
    });

    return NextResponse.json({
      runs: enrichedRuns,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[Pipeline Runs API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipeline runs' },
      { status: 500 }
    );
  }
}

// POST - Create a new pipeline run
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json();
    const { pipelineId, studyId, sampleIds, config } = body;

    // Validate pipeline
    const definition = PIPELINE_REGISTRY[pipelineId];
    if (!definition) {
      return NextResponse.json({ error: 'Invalid pipeline ID' }, { status: 400 });
    }

    // Validate study exists
    const study = await db.study.findUnique({
      where: { id: studyId },
      include: {
        samples: {
          include: {
            reads: true,
            assemblies: true,
            bins: true,
          },
        },
      },
    });

    if (!study) {
      return NextResponse.json({ error: 'Study not found' }, { status: 404 });
    }

    // Validate samples if specific ones requested
    if (sampleIds && sampleIds.length > 0) {
      const validSampleIds = new Set(study.samples.map(s => s.id));
      const invalidIds = sampleIds.filter((id: string) => !validSampleIds.has(id));
      if (invalidIds.length > 0) {
        return NextResponse.json(
          { error: `Invalid sample IDs: ${invalidIds.join(', ')}` },
          { status: 400 }
        );
      }
    }

    // Generate a unique temporary run number (will be updated to proper format by executor)
    const tempRunNumber = `${pipelineId.toUpperCase()}-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const inputSampleIds =
      Array.isArray(sampleIds) && sampleIds.length > 0
        ? JSON.stringify(sampleIds)
        : null;

    // Create the run record (pending status)
    const run = await db.pipelineRun.create({
      data: {
        runNumber: tempRunNumber,
        pipelineId,
        status: 'pending',
        studyId,
        userId: session.user.id,
        config: config ? JSON.stringify(config) : null,
        inputSampleIds,
      },
    });

    // Note: Actual execution is handled by a background worker
    // For now, we just create the record and return
    // The frontend can poll for status updates

    return NextResponse.json({
      success: true,
      run: {
        id: run.id,
        runNumber: run.runNumber,
        status: run.status,
        pipelineId: run.pipelineId,
        studyId: run.studyId,
      },
    });
  } catch (error) {
    console.error('[Pipeline Runs API] Error creating run:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to create pipeline run', details: message },
      { status: 500 }
    );
  }
}
