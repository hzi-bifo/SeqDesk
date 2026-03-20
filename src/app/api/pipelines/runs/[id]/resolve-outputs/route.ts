import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { getAdapter, registerAdapter } from '@/lib/pipelines/adapters';
import '@/lib/pipelines/adapters/mag';
import { createGenericAdapter } from '@/lib/pipelines/generic-adapter';
import { resolveOutputs, saveRunResults } from '@/lib/pipelines/output-resolver';
import path from 'path';
import { isDemoSession } from '@/lib/demo/server';
import type { PipelineTarget } from '@/lib/pipelines/types';

/**
 * POST - Manually trigger output resolution for a completed run
 * Useful for re-running resolution if initial attempt failed or was incomplete
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    const run = await db.pipelineRun.findUnique({
      where: { id },
      include: {
        study: {
          include: {
            samples: {
              select: {
                id: true,
                sampleId: true,
              },
            },
          },
        },
        order: {
          include: {
            samples: {
              select: {
                id: true,
                sampleId: true,
              },
            },
          },
        },
      },
    });

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (run.status !== 'completed' && run.status !== 'failed') {
      return NextResponse.json(
        { error: 'Can only resolve outputs for completed or failed runs' },
        { status: 400 }
      );
    }

    if (!run.runFolder) {
      return NextResponse.json(
        { error: 'Run folder not set' },
        { status: 400 }
      );
    }

    let adapter = getAdapter(run.pipelineId);
    if (!adapter) {
      const genericAdapter = createGenericAdapter(run.pipelineId);
      if (genericAdapter) {
        registerAdapter(genericAdapter);
        adapter = genericAdapter;
      }
    }
    if (!adapter) {
      return NextResponse.json(
        { error: `No adapter found for pipeline: ${run.pipelineId}` },
        { status: 400 }
      );
    }

    const target: PipelineTarget | null =
      run.targetType === 'order' && run.orderId
        ? { type: 'order', orderId: run.orderId }
        : run.studyId
          ? { type: 'study', studyId: run.studyId }
          : null;

    const samples = run.targetType === 'order' ? run.order?.samples || [] : run.study?.samples || [];
    if (samples.length === 0) {
      return NextResponse.json(
        { error: 'No samples found for this run' },
        { status: 400 }
      );
    }

    // Output directory is runFolder/output for MAG
    const outputDir = path.join(run.runFolder, 'output');

    // Discover outputs
    const discovered = await adapter.discoverOutputs({
      runId: id,
      outputDir,
      target: target || undefined,
      samples,
    });

    // Resolve outputs to DB records
    const result = await resolveOutputs(run.pipelineId, id, discovered);

    // Save results summary to run
    await saveRunResults(id, result);

    return NextResponse.json({
      success: result.success,
      discovered: discovered.summary,
      resolved: {
        assembliesCreated: result.assembliesCreated,
        binsCreated: result.binsCreated,
        artifactsCreated: result.artifactsCreated,
      },
      errors: result.errors,
      warnings: result.warnings,
    });
  } catch (error) {
    console.error('[Resolve Outputs API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to resolve outputs' },
      { status: 500 }
    );
  }
}
