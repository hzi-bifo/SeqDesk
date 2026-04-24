import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { PIPELINE_REGISTRY } from '@/lib/pipelines';
import { getAdapter, registerAdapter } from '@/lib/pipelines/adapters';
import { createGenericAdapter } from '@/lib/pipelines/generic-adapter';
import { validatePipelineMetadata } from '@/lib/pipelines/metadata-validation';
import {
  getPipelineRunConfigIssues,
  normalizePipelineRunConfig,
} from '@/lib/pipelines/simulate-reads-config';
import { isDemoSession } from '@/lib/demo/server';
import type { PipelineTarget } from '@/lib/pipelines/types';
import { supportsPipelineTarget } from '@/lib/pipelines/target';

function parseRunResults(rawResults: string | null | undefined): Record<string, unknown> | null {
  if (!rawResults) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawResults);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

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
    const orderId = searchParams.get('orderId');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Build query
    const where: Record<string, unknown> = {};

    // Non-admins can only see runs for their own studies
    if (session.user.role !== 'FACILITY_ADMIN') {
      where.OR = [
        { study: { userId: session.user.id } },
        { order: { userId: session.user.id } },
      ];
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

    if (orderId) {
      where.orderId = orderId;
    }

    const [runs, total] = await Promise.all([
      db.pipelineRun.findMany({
        where,
        include: {
          study: {
            select: { id: true, title: true, userId: true },
          },
          order: {
            select: { id: true, name: true, orderNumber: true, userId: true },
          },
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          _count: {
            select: { assembliesCreated: true, binsCreated: true },
          },
          artifacts: {
            select: {
              id: true,
              name: true,
              path: true,
              type: true,
              sampleId: true,
            },
            orderBy: { createdAt: 'asc' },
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
        results: parseRunResults(run.results),
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

    if (isDemoSession(session)) {
      return NextResponse.json(
        { error: 'Pipeline execution is disabled in the public demo.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { pipelineId, studyId, orderId, sampleIds, config } = body;
    let requestedSampleIds: string[] | undefined;

    if (sampleIds !== undefined) {
      if (!Array.isArray(sampleIds) || sampleIds.some((id: unknown) => typeof id !== 'string')) {
        return NextResponse.json(
          { error: 'sampleIds must be an array of strings' },
          { status: 400 }
        );
      }
      requestedSampleIds = sampleIds;
    }

    if ((!studyId && !orderId) || (studyId && orderId)) {
      return NextResponse.json(
        { error: 'Exactly one of studyId or orderId is required' },
        { status: 400 }
      );
    }

    const target: PipelineTarget = orderId
      ? { type: 'order', orderId, sampleIds: requestedSampleIds }
      : { type: 'study', studyId, sampleIds: requestedSampleIds };

    // Validate pipeline
    const definition = PIPELINE_REGISTRY[pipelineId];
    if (!definition) {
      return NextResponse.json({ error: 'Invalid pipeline ID' }, { status: 400 });
    }

    if (!supportsPipelineTarget(definition, target)) {
      return NextResponse.json(
        { error: `Pipeline ${pipelineId} does not support ${target.type} targets` },
        { status: 400 }
      );
    }

    const [study, order] = await Promise.all([
      target.type === 'study'
        ? db.study.findUnique({
            where: { id: target.studyId },
            include: {
              samples: {
                include: {
                  reads: true,
                  assemblies: true,
                  bins: true,
                },
              },
            },
          })
        : Promise.resolve(null),
      target.type === 'order'
        ? db.order.findUnique({
            where: { id: target.orderId },
            include: {
              samples: {
                include: {
                  reads: true,
                  assemblies: true,
                  bins: true,
                },
              },
            },
          })
        : Promise.resolve(null),
    ]);

    const samples = target.type === 'study' ? study?.samples || [] : order?.samples || [];

    if (target.type === 'study' && !study) {
      return NextResponse.json({ error: 'Study not found' }, { status: 404 });
    }

    if (target.type === 'order' && !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Validate samples if specific ones requested
    if (requestedSampleIds && requestedSampleIds.length > 0) {
      const validSampleIds = new Set(samples.map(s => s.id));
      const invalidIds = requestedSampleIds.filter((id) => !validSampleIds.has(id));
      if (invalidIds.length > 0) {
        return NextResponse.json(
          { error: `Invalid sample IDs: ${invalidIds.join(', ')}` },
          { status: 400 }
        );
      }
    }

    // Validate runtime metadata server-side so runs cannot bypass UI checks
    const metadataValidation = await validatePipelineMetadata(
      target,
      pipelineId,
    );
    const metadataErrors = metadataValidation.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.message);
    if (metadataErrors.length > 0) {
      return NextResponse.json(
        {
          error: 'Pipeline metadata validation failed',
          details: metadataErrors,
        },
        { status: 400 }
      );
    }

    // Validate pipeline-specific input prerequisites before creating the run
    let adapter = getAdapter(pipelineId);
    if (!adapter) {
      const genericAdapter = createGenericAdapter(pipelineId);
      if (genericAdapter) {
        registerAdapter(genericAdapter);
        adapter = genericAdapter;
      }
    }

    if (adapter) {
      const validation = await adapter.validateInputs(target);
      if (!validation.valid) {
        return NextResponse.json(
          {
            error: 'Pipeline input validation failed',
            details: validation.issues,
          },
          { status: 400 }
        );
      }
    }

    const normalizedConfig = normalizePipelineRunConfig(
      pipelineId,
      asRecord(config),
    );
    const configIssues = getPipelineRunConfigIssues(
      pipelineId,
      normalizedConfig,
    );
    if (configIssues.length > 0) {
      return NextResponse.json(
        {
          error: 'Pipeline config validation failed',
          details: configIssues,
        },
        { status: 400 }
      );
    }

    // Generate a unique temporary run number (will be updated to proper format by executor)
    const tempRunNumber = `${pipelineId.toUpperCase()}-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const inputSampleIds =
      requestedSampleIds && requestedSampleIds.length > 0
        ? JSON.stringify(requestedSampleIds)
        : null;

    // Create the run record (pending status)
    const run = await db.pipelineRun.create({
      data: {
        runNumber: tempRunNumber,
        pipelineId,
        status: 'pending',
        targetType: target.type,
        studyId: target.type === 'study' ? target.studyId : null,
        orderId: target.type === 'order' ? target.orderId : null,
        userId: session.user.id,
        config:
          Object.keys(normalizedConfig).length > 0
            ? JSON.stringify(normalizedConfig)
            : null,
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
        orderId: run.orderId,
        targetType: run.targetType,
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
