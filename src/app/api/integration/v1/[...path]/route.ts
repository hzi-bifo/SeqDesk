import { NextRequest, NextResponse } from 'next/server';
import { integrationConfig } from '@/lib/integration/config';
import { integrationSession, IntegrationAccessError } from '@/lib/integration/identity';
import { db } from '@/lib/db';
import { decideCapability } from '@/lib/authorization';
import { getServerDeploymentProfile } from '@/lib/deployment-profile/server';
import { listPipelineRunsForOperator, createPipelineRunForOperator, startPipelineRunForOperator } from '@/lib/pipelines/pipeline-run-service';
import { PIPELINE_REGISTRY } from '@/lib/pipelines/registry';
import { getPipelineEnabled } from '@/lib/pipelines/enablement';
import { getPipelineRunDetailsForOperator, cancelPipelineRunForOperator } from '@/lib/pipelines/pipeline-run-ops-service';
import { assertPipelineRunReadAccess, assertPipelineRunCancelAccess } from '@/lib/pipelines/run-visibility';
import { servePipelineRunFile } from '@/lib/pipelines/run-file-service';
import { projectTargetIDs, assertProjectRun, assertProjectTarget, changeProjectLink } from '@/lib/integration/projects';
import { exploreIntegrationCapabilities, handleExploreRequest } from '@/lib/integration/explore';
import { isExploreModuleEnabled } from '@/lib/explore/module';
import { handleImportersRequest, IMPORTER_CAPABILITIES } from '@/lib/integration/importers';
import { handleDataPipelinesRequest, DATA_PIPELINE_CAPABILITIES } from '@/lib/integration/pipelines';
import { pipelineStepsAvailable } from '@/lib/explore/pipeline-steps';
import packageInfo from '../../../../../../package.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, context: Context): Promise<Response> {
  const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
  try {
    const config = integrationConfig();
    if (!config) return json({ error: 'Analysis integration is not enabled.' }, 404);
    const origin = request.headers.get('origin');
    if (origin && !config.webOrigins.includes(origin)) return json({ error: 'Web origin is not allowed.' }, 403);
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      return new Response(null, { status: 204, headers });
    }
    const { path } = await context.params;
    if (path.join('/') === 'info' && request.method === 'GET') {
      return json({ apiVersion: 1, installationId: config.installationId, name: config.name, version: packageInfo.version,
        capabilities: ['studies.read', 'runs.read', 'runs.create', 'runs.start', ...IMPORTER_CAPABILITIES, ...DATA_PIPELINE_CAPABILITIES,
          ...((await isExploreModuleEnabled().catch(() => false)) ? exploreIntegrationCapabilities({ eventsConfigured: process.env.SEQDESK_EXPLORE_EVENTS !== '0', pipelineSteps: await pipelineStepsAvailable().catch(() => false) }) : [])] });
    }
    const session = await integrationSession(request, config);
    if (path[0] === 'explore') return handleExploreRequest(request, session, path.slice(1), headers);
    if (path[0] === 'importers' || path[0] === 'imports') return handleImportersRequest(request, session, path, headers);
    if (path[0] === 'data-pipelines') return handleDataPipelinesRequest(request, session, path, headers);
    const profile = getServerDeploymentProfile();
    if (path.join('/') === 'project-links' && request.method === 'POST') {
      await changeProjectLink(session, await request.json());
      return json({ ok: true });
    }
    if (path[0] === 'runs' && path.length === 3 && path[2] === 'file' && request.method === 'GET') {
      await assertProjectRun(session, path[1]);
      const target = request.nextUrl.clone();
      target.search = new URLSearchParams({ path: request.nextUrl.searchParams.get('path') || '',
        mode: request.nextUrl.searchParams.get('preview') === '1' ? 'preview' : 'download' }).toString();
      const result = await servePipelineRunFile(new NextRequest(target, { signal: request.signal }), session, path[1]);
      const combined = new Headers(result.headers);
      headers.forEach((value, key) => combined.set(key, value));
      combined.set('X-Content-Type-Options', 'nosniff');
      return new Response(result.body, { status: result.status, headers: combined });
    }
    if (path.join('/') === 'pipelines' && request.method === 'GET') {
      const decision = decideCapability(session, 'analysis.run', profile);
      if (!decision.allowed) return json({ error: 'Pipeline execution is not available.' }, decision.status);
      const canManage = decideCapability(session, 'system.pipelines.manage', profile).allowed;
      const target = request.nextUrl.searchParams.get('target') === 'order' ? ['order'] : ['study', 'sample', 'samples'];
      const pipelines = await Promise.all(Object.values(PIPELINE_REGISTRY).filter(definition =>
        definition.input.supportedScopes.some(scope => target.includes(scope))).map(async definition => {
        if (!(await getPipelineEnabled(definition.id))) return null;
        const properties = Object.fromEntries(Object.entries(definition.configSchema.properties).filter(([, property]) => {
          const placement = property['x-seqdesk']?.placement;
          return placement !== 'hidden' && placement !== 'derived' && (canManage || placement !== 'admin');
        }));
        return { id: definition.id, name: definition.name, description: definition.description,
          configSchema: { type: 'object', properties, required: (definition.configSchema.required || []).filter(key => key in properties) } };
      }));
      return json({ pipelines: pipelines.filter(Boolean) });
    }
    if (path[0] === 'orders' && path.length <= 2 && request.method === 'GET') {
      const all = decideCapability(session, 'orders.read_all', profile);
      const own = decideCapability(session, 'orders.read', profile);
      const grant = all.allowed ? all.grant : own.grant;
      if (!grant) return json({ error: 'Order access is not available.' }, own.status);
      const projectIDs = await projectTargetIDs(session, 'order');
      const where = { ...(grant.scope === 'installation' ? {} : { userId: session.user.id }), ...(path[1] ? { id: path[1] } : {}),
        ...(projectIDs === null ? {} : { AND: [{ id: { in: projectIDs } }] }) };
      const select = { id: true, name: true, orderNumber: true, status: true, createdAt: true, _count: { select: { samples: true } } } as const;
      if (path[1]) {
        const order = await db.order.findFirst({ where, select: { ...select,
          samples: { select: { id: true, sampleId: true, sampleAlias: true, sampleTitle: true, scientificName: true, reads: { where: { isActive: true }, select: { id: true, file1: true, file2: true, checksum1: true, checksum2: true, dataClass: true } } } } } });
        if (!order) return json({ error: 'Order not found.' }, 404);
        return json({ order: { id: order.id, title: order.name || order.orderNumber, description: order.orderNumber, status: order.status,
          createdAt: order.createdAt, sampleCount: order._count.samples, samples: order.samples } });
      }
      const orders = await db.order.findMany({ where, select, take: 200, orderBy: { createdAt: 'desc' } });
      return json({ orders: orders.map(order => ({ id: order.id, title: order.name || order.orderNumber,
        description: order.orderNumber, status: order.status, createdAt: order.createdAt, sampleCount: order._count.samples })) });
    }
    if (path[0] === 'runs' && path.length === 2 && request.method === 'GET') {
      await assertProjectRun(session, path[1]);
      const denied = await assertPipelineRunReadAccess(path[1], session);
      if (denied) return json(denied.body, denied.status);
      const result = await getPipelineRunDetailsForOperator(path[1]);
      return json(result.body, result.status);
    }
    if (path[0] === 'runs' && path.length === 3 && path[2] === 'cancel' && request.method === 'POST') {
      await assertProjectRun(session, path[1]);
      const denied = await assertPipelineRunCancelAccess(path[1], session);
      if (denied) return json(denied.body, denied.status);
      const result = await cancelPipelineRunForOperator(path[1]);
      return json(result.body, result.status);
    }
    if (path[0] === 'studies' && path.length <= 2 && request.method === 'GET') {
      const all = decideCapability(session, 'studies.read_all', profile);
      const own = decideCapability(session, 'studies.read', profile);
      const grant = all.allowed ? all.grant : own.grant;
      if (!grant) return json({ error: 'Study access is not available.' }, own.status);
      const projectIDs = await projectTargetIDs(session, 'study');
      const where = { ...(grant.scope === 'installation' ? {} : { userId: session.user.id }),
        ...(path[1] ? { id: path[1] } : {}), ...(projectIDs === null ? {} : { AND: [{ id: { in: projectIDs } }] }) };
      if (path[1]) {
        const study = await db.study.findFirst({ where, select: {
          id: true, title: true, description: true, submitted: true, studyAccessionId: true, checklistType: true, createdAt: true,
          samples: { select: { id: true, sampleId: true, sampleAlias: true, sampleTitle: true, scientificName: true, reads: { where: { isActive: true }, select: { id: true, file1: true, file2: true, checksum1: true, checksum2: true, dataClass: true } } } },
          _count: { select: { samples: true } },
        } });
        if (!study) return json({ error: 'Study not found.' }, 404);
        const { _count, ...fields } = study;
        return json({ study: { ...fields, sampleCount: _count.samples } });
      }
      const studies = await db.study.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200,
        select: { id: true, title: true, description: true, submitted: true, studyAccessionId: true, checklistType: true, createdAt: true, _count: { select: { samples: true } } } });
      return json({ studies: studies.map(({ _count, ...study }) => ({ ...study, sampleCount: _count.samples })) });
    }
    if (path.join('/') === 'runs' && request.method === 'GET') {
      const all = decideCapability(session, 'analysis.read_all', profile);
      const own = decideCapability(session, 'analysis.read_own', profile);
      const grant = all.allowed ? all.grant : own.grant;
      if (!grant) return json({ error: 'Run access is not available.' }, own.status);
      const studyIds = await projectTargetIDs(session, 'study');
      const orderIds = await projectTargetIDs(session, 'order');
      const result = await listPipelineRunsForOperator({ userId: session.user.id, readScope: grant.scope,
        studyId: request.nextUrl.searchParams.get('studyId'), orderId: request.nextUrl.searchParams.get('orderId'), limit: 50,
        ...(studyIds === null ? {} : { targetFilter: { studyIds, orderIds: orderIds || [] } }),
        publishedOnly: !decideCapability(session, 'analysis.run', profile).allowed });
      return json(result.body, result.status);
    }
    if (path[0] === 'runs' && request.method === 'POST' &&
      (path.length === 1 || (path.length === 3 && path[2] === 'start'))) {
      const decision = decideCapability(session, 'analysis.run', profile);
      if (!decision.allowed || !decision.grant) return json({ error: 'Pipeline execution is not allowed.' }, decision.status);
      const raw = await request.text();
      if (raw.length > 65536) return json({ error: 'Run configuration is too large.' }, 413);
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid run configuration.' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid run configuration.' }, 400);
      if (path.length === 1) await assertProjectTarget(session, typeof body.orderId === 'string' ? 'order' : 'study', String(body.orderId || body.studyId || ''));
      else await assertProjectRun(session, path[1]);
      const result = path.length === 1 ? await createPipelineRunForOperator({ body, userId: session.user.id,
        accessScope: decision.grant.scope, canManageConfig: decideCapability(session, 'system.pipelines.manage', profile).allowed }) :
        await startPipelineRunForOperator({ runId: path[1], body, userId: session.user.id, accessScope: decision.grant.scope });
      return json(result.body, result.status);
    }
    return json({ error: 'Unknown Analysis operation.' }, 404);
  } catch (error) {
    if (error instanceof IntegrationAccessError) return json({ error: error.message }, error.status);
    console.error('[Analysis integration] Request failed');
    return json({ error: 'The Analysis service is unavailable.' }, 503);
  }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
