import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { getAdapter, registerAdapter } from '@/lib/pipelines/adapters';
import '@/lib/pipelines/adapters/mag';
import { createGenericAdapter } from '@/lib/pipelines/generic-adapter';
import { resolveOutputs } from '@/lib/pipelines/output-resolver';
import { getPackage } from '@/lib/pipelines/package-loader';
import { inferPipelineResultContract } from '@/lib/pipelines/package-contracts';
import {
  PENDING_READ_CANDIDATE_KIND,
  promotePendingWritebacks,
} from '@/lib/pipelines/pending-writebacks';
import path from 'path';
import { isDemoSession } from '@/lib/demo/server';
import type { PipelineTarget } from '@/lib/pipelines/types';

/**
 * POST - Re-resolve outputs for a single sample from a completed run.
 * Used by the "Change Source" UI to switch which run provides a sample's reads.
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
    const body = (await request.json()) as { sampleId?: string };

    if (!body.sampleId || typeof body.sampleId !== 'string') {
      return NextResponse.json({ error: 'Missing sampleId' }, { status: 400 });
    }

    const run = await db.pipelineRun.findUnique({
      where: { id },
      include: {
        study: {
          include: {
            samples: { select: { id: true, sampleId: true } },
          },
        },
        order: {
          include: {
            samples: { select: { id: true, sampleId: true } },
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
      return NextResponse.json({ error: 'Run folder not set' }, { status: 400 });
    }

    const samples = run.targetType === 'order'
      ? run.order?.samples || []
      : run.study?.samples || [];

    const targetSample = samples.find((s) => s.id === body.sampleId);
    if (!targetSample) {
      return NextResponse.json(
        { error: 'Sample not found in this run' },
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

    const outputDir = path.join(run.runFolder, 'output');

    const discovered = await adapter.discoverOutputs({
      runId: id,
      outputDir,
      target: target || undefined,
      samples,
    });

    // Filter to only files for the target sample and force replaceExisting
    const filteredFiles = discovered.files
      .filter((f) => f.sampleId === body.sampleId)
      .map((f) => ({
        ...f,
        metadata: { ...f.metadata, replaceExisting: true },
      }));

    if (filteredFiles.length === 0) {
      return NextResponse.json(
        { error: 'No outputs found for this sample in the run' },
        { status: 404 }
      );
    }

    // Read-cleaning style outputs are staged as run artifacts with a
    // `sample_read_candidate` result contract; they are NOT written through the
    // sample_reads handler, so resolveOutputs (which only honours
    // replaceExisting for sample_reads) would be a silent no-op here. Route these
    // through the promote flow so "Change Source" actually switches the active
    // reads for the sample.
    const packageOutputs = getPackage(run.pipelineId)?.manifest.outputs ?? [];
    const hasCandidateOutput = filteredFiles.some((file) => {
      const output = file.outputId
        ? packageOutputs.find((o) => o.id === file.outputId)
        : undefined;
      return (
        !!output &&
        inferPipelineResultContract(output).kind === PENDING_READ_CANDIDATE_KIND
      );
    });

    if (hasCandidateOutput) {
      if (run.targetType !== 'order') {
        return NextResponse.json(
          { error: 'Candidate read outputs can only be re-resolved for order runs' },
          { status: 400 }
        );
      }

      try {
        const promotion = await promotePendingWritebacks({
          runId: id,
          sampleIds: [body.sampleId],
          userId: session.user.id,
        });

        return NextResponse.json({
          success: true,
          promoted: promotion.promoted,
          readIds: promotion.readIds,
        });
      } catch (promoteError) {
        // Surface actionable promote failures (e.g. the candidate is already the
        // active source, or the run is not completed) rather than a generic 500.
        const message =
          promoteError instanceof Error
            ? promoteError.message
            : 'Failed to re-resolve candidate reads for sample';
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    const result = await resolveOutputs(run.pipelineId, id, {
      ...discovered,
      files: filteredFiles,
    });

    return NextResponse.json({
      success: result.success,
      errors: result.errors,
    });
  } catch (error) {
    console.error('[Resolve Outputs Sample API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to resolve outputs for sample' },
      { status: 500 }
    );
  }
}
