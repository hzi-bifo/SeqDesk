import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { isActiveSession } from '@/lib/auth-session';
import { decideCapability } from '@/lib/authorization';
import { getServerDeploymentProfile } from '@/lib/deployment-profile/server';
import {
  getDemoFacilityWorkspaceUserIds,
  isDemoSession,
} from '@/lib/demo/server';
import {
  createPipelineRunForOperator,
  listPipelineRunsForOperator,
} from '@/lib/pipelines/pipeline-run-service';

// GET - List pipeline runs
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!isActiveSession(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const deploymentProfile = getServerDeploymentProfile();

    const readAll = decideCapability(session, 'analysis.read_all', deploymentProfile);
    const readOwn = decideCapability(session, 'analysis.read_own', deploymentProfile);
    const readGrant = readAll.allowed ? readAll.grant : readOwn.grant;
    if (!readGrant) {
      const status = readOwn.status === 401 ? 401 : readOwn.status;
      return NextResponse.json(
        { error: status === 404 ? 'Not found' : status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status }
      );
    }

    const { searchParams } = new URL(request.url);
    const publishedOnly =
      !decideCapability(session, 'analysis.run', deploymentProfile).allowed ||
      searchParams.get('publishedOnly') === 'true' ||
      searchParams.get('userVisible') === 'true' ||
      searchParams.get('visible') === 'user';
    const demoWorkspaceUserIds =
      await getDemoFacilityWorkspaceUserIds(session);
    const result = await listPipelineRunsForOperator({
      userId: session.user.id,
      readScope: readGrant.scope,
      demoWorkspaceUserIds,
      pipelineId: searchParams.get('pipelineId'),
      status: searchParams.get('status'),
      studyId: searchParams.get('studyId'),
      orderId: searchParams.get('orderId'),
      publishedOnly,
      limit: parseInt(searchParams.get('limit') || '50', 10),
      offset: parseInt(searchParams.get('offset') || '0', 10),
    });

    return NextResponse.json(result.body, { status: result.status });
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

    if (!isActiveSession(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const deploymentProfile = getServerDeploymentProfile();
    const decision = decideCapability(session, 'analysis.run', deploymentProfile);
    if (!decision.allowed || !decision.grant) {
      return NextResponse.json(
        { error: decision.status === 404 ? 'Not found' : 'Forbidden' },
        { status: decision.status }
      );
    }

    if (isDemoSession(session)) {
      return NextResponse.json(
        { error: 'Pipeline execution is disabled in the public demo.' },
        { status: 403 }
      );
    }

    const parsed = await request.json();
    const body =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const result = await createPipelineRunForOperator({
      body,
      userId: session.user.id,
      accessScope: decision.grant.scope,
      canManageConfig: decideCapability(session, 'system.pipelines.manage', deploymentProfile).allowed,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('[Pipeline Runs API] Error creating run:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to create pipeline run', details: message },
      { status: 500 }
    );
  }
}
