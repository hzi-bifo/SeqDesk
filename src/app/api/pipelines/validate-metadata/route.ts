import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isActiveSession } from '@/lib/auth-session';
import { validatePipelineMetadata } from '@/lib/pipelines/metadata-validation';
import { decideCapability } from '@/lib/authorization';
import { getServerDeploymentProfile } from '@/lib/deployment-profile/server';
import { db } from '@/lib/db';
import { loadStudyPipelineSamples, scopePipelineStudyTarget } from '@/lib/pipelines/study-samples';

// POST - Validate metadata for a pipeline run
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!isActiveSession(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { studyId, orderId, pipelineId, sampleIds } = body;
    const access = decideCapability(session, 'analysis.run', getServerDeploymentProfile());
    if (!access.allowed || !access.grant) return NextResponse.json({ error: 'Forbidden' }, { status: access.status });

    if ((!studyId && !orderId) || (studyId && orderId) || !pipelineId) {
      return NextResponse.json(
        { error: 'pipelineId and exactly one of studyId or orderId are required' },
        { status: 400 }
      );
    }

    let validatedSampleIds: string[] | undefined;
    const scope = access.grant.scope === 'installation' ? {} : { userId: session.user.id };
    const target = orderId ? await db.order.findFirst({ where: { id: orderId, ...scope }, select: { id: true } }) : await db.study.findFirst({ where: { id: studyId, ...scope }, select: { id: true } });
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
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

    const pipelineTarget = scopePipelineStudyTarget(orderId ? { type: 'order', orderId, sampleIds: validatedSampleIds } : { type: 'study', studyId }, pipelineId);
    if (pipelineTarget.type === 'study') {
      const samples = await loadStudyPipelineSamples(pipelineTarget, { userId: session.user.id, installation: access.grant.scope === 'installation' });
      const available = new Set(samples.map(sample => sample.id));
      if (validatedSampleIds && (!validatedSampleIds.length || validatedSampleIds.some(id => !available.has(id)))) {
        return NextResponse.json({ error: 'Selected samples are not available in this study' }, { status: 400 });
      }
      pipelineTarget.sampleIds = [...new Set(validatedSampleIds ?? samples.map(sample => sample.id))];
    }
    const result = await validatePipelineMetadata(pipelineTarget, pipelineId);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Validate Pipeline Metadata API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to validate metadata' },
      { status: 500 }
    );
  }
}
