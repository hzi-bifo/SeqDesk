import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  analysisFind: vi.fn(), conversationFind: vi.fn(), conversationCreate: vi.fn(), conversationUpdate: vi.fn(),
  scopeFindMany: vi.fn(), scopeCreate: vi.fn(), projectCreate: vi.fn(), projectFindMany: vi.fn(), projectUpdate: vi.fn(),
  resolve: vi.fn(), moduleEnabled: vi.fn(), listReports: vi.fn(), capability: vi.fn(),
  getReportRecord: vi.fn(), getReportView: vi.fn(), renderReportHtml: vi.fn(),
  listFlows: vi.fn(), createFlow: vi.fn(), getFlow: vi.fn(), getFlowRecord: vi.fn(), updateFlow: vi.fn(), deleteFlow: vi.fn(), processCleanupJobs: vi.fn(async () => ({ done: 0, failed: 0 })), pruneRuns: vi.fn(),
  loadCanvasGraph: vi.fn(), listAnalyses: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: {
  exploreAnalysis: { findUnique: mocks.analysisFind },
  exploreStepConversation: { findUnique: mocks.conversationFind, create: mocks.conversationCreate, updateMany: mocks.conversationUpdate },
  integrationExploreScope: { findMany: mocks.scopeFindMany, create: mocks.scopeCreate, findFirst: vi.fn().mockResolvedValue(null) },
  exploreProject: { create: mocks.projectCreate, findMany: mocks.projectFindMany, update: mocks.projectUpdate },
} }));
vi.mock('@/lib/authorization/api', () => ({ decideServerCapability: mocks.capability }));
vi.mock('@/lib/explore/authorization', async () => {
  const actual = await vi.importActual<typeof import('@/lib/explore/authorization')>('@/lib/explore/authorization');
  return { ...actual, resolveTargetAccess: mocks.resolve, requireTargetAccess: vi.fn() };
});
vi.mock('@/lib/explore/module', () => ({ isExploreModuleEnabled: mocks.moduleEnabled }));
vi.mock('@/lib/explore/reports', async () => {
  const actual = await vi.importActual<typeof import('@/lib/explore/reports')>('@/lib/explore/reports');
  return { ...actual, listReports: mocks.listReports, getReportRecord: mocks.getReportRecord, getReportView: mocks.getReportView };
});
vi.mock('@/lib/explore/report-export', () => ({ renderReportHtml: mocks.renderReportHtml }));
vi.mock('@/lib/explore/flows', () => ({ listFlows: mocks.listFlows, createFlow: mocks.createFlow, getFlow: mocks.getFlow, getFlowRecord: mocks.getFlowRecord, updateFlow: mocks.updateFlow, deleteFlow: mocks.deleteFlow }));
vi.mock('@/lib/explore/housekeeping', () => ({ processCleanupJobs: mocks.processCleanupJobs, flowCitations: vi.fn(), housekeepingCounts: vi.fn(), pruneRuns: mocks.pruneRuns }));
vi.mock('@/lib/explore/canvas', () => ({ loadCanvasGraph: mocks.loadCanvasGraph }));
vi.mock('@/lib/explore/analyses', async () => {
  const actual = await vi.importActual<typeof import('@/lib/explore/analyses')>('@/lib/explore/analyses');
  return { ...actual, listAnalyses: mocks.listAnalyses };
});
import { NextRequest } from 'next/server';
import { createFlowStudy, handleExploreRequest, listFlowStudies, statusOf } from './explore';
import type { IntegrationSession } from './identity';

const session = { user: { id: 'local' }, integration: { authority: 'https://collab.example', workspaceId: 'team', memberId: 'member', projectId: '' } } as IntegrationSession;
const request = (method: string, url: string, body?: unknown) => new NextRequest(new URL(url, 'http://compute.test'), { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });

describe('Flow studies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.moduleEnabled.mockResolvedValue(true);
    mocks.capability.mockImplementation((_session, capability) => ({ allowed: true, principal: { id: 'local' }, grant: { scope: capability === 'analysis.read_all' ? 'own' : 'own' } }));
  });
  it('lists the projects linked to the workspace, never other projects', async () => {
    mocks.scopeFindMany.mockResolvedValue([{ targetKey: 'project:p1' }, { targetKey: 'study:s1' }]);
    mocks.projectFindMany.mockResolvedValue([{ id: 'p1', name: 'Microbiome', description: null, createdAt: new Date('2026-09-17T09:00:00Z') }]);
    expect(await listFlowStudies(session)).toEqual([{ id: 'p1', targetKey: 'project:p1', type: 'project', label: 'Microbiome', description: null, createdAt: '2026-09-17T09:00:00.000Z', access: 'write', projectId: '', visibility: 'lab', ownerMemberId: '' }]);
    // Every lab study of the workspace and the caller's own private ones; one project's when asked.
    expect(mocks.scopeFindMany.mock.calls[0][0].where).toEqual({ authority: 'https://collab.example', workspaceId: 'team', OR: [{ visibility: 'lab' }, { visibility: 'private', ownerMemberId: 'member' }] });
    await listFlowStudies(session, { projectId: 'proj1' });
    expect(mocks.scopeFindMany.mock.calls[1][0].where.projectId).toBe('proj1');
    await listFlowStudies({ ...session, integration: { ...session.integration, projectId: 'only' } } as IntegrationSession, { projectId: 'other' });
    expect(mocks.scopeFindMany.mock.calls[2][0].where.projectId).toBe('only');
    expect(mocks.projectFindMany.mock.calls[0][0].where).toEqual({ id: { in: ['p1'] } });
  });
  it('creates a study as a project owned by the caller and links it to the workspace', async () => {
    mocks.projectCreate.mockResolvedValue({ id: 'p2', name: 'Assay', description: 'First run', createdAt: new Date('2026-09-17T09:00:00Z') });
    mocks.scopeCreate.mockResolvedValue({});
    expect((await createFlowStudy(session, 'Assay', 'First run')).targetKey).toBe('project:p2');
    expect(mocks.projectCreate.mock.calls[0][0].data).toEqual({ name: 'Assay', description: 'First run', ownerId: 'local' });
    expect(mocks.scopeCreate.mock.calls[0][0].data).toMatchObject({ authority: 'https://collab.example', workspaceId: 'team', projectId: '', targetKey: 'project:p2', createdBy: 'local' });
  });
  it('creates project and private studies within what the handle allows', async () => {
    mocks.projectCreate.mockResolvedValue({ id: 'p3', name: 'Mine', description: null, createdAt: new Date('2026-09-24T09:00:00Z') });
    mocks.scopeCreate.mockResolvedValue({});
    const study = await createFlowStudy(session, 'Mine', null, { projectId: 'proj-1', visibility: 'private' });
    expect(study).toMatchObject({ projectId: 'proj-1', visibility: 'private', ownerMemberId: 'member' });
    expect(mocks.scopeCreate.mock.calls[0][0].data).toMatchObject({ projectId: 'proj-1', visibility: 'private', ownerMemberId: 'member' });
    const scoped = { ...session, integration: { ...session.integration, projectId: 'proj-2' } } as IntegrationSession;
    await expect(createFlowStudy(scoped, 'Other', null, { projectId: 'proj-1' })).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect((await createFlowStudy(scoped, 'Default', null)).projectId).toBe('proj-2');
    await expect(createFlowStudy(session, 'Bad', null, { visibility: 'everyone' })).rejects.toMatchObject({ status: 400 });
    await expect(createFlowStudy(session, 'Bad', null, { projectId: 'has space' })).rejects.toMatchObject({ status: 400 });
  });
  it('refuses read-only accounts', async () => {
    mocks.capability.mockImplementation((_session, capability) => capability === 'analysis.run' ? { allowed: false } : { allowed: true, principal: { id: 'local' } });
    await expect(createFlowStudy(session, 'Assay', null)).rejects.toMatchObject({ status: 403 });
    expect(mocks.projectCreate).not.toHaveBeenCalled();
  });
});

describe('Flow requests', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.moduleEnabled.mockResolvedValue(true); });
  it('answers 404 for everything while the Explore module is off', async () => {
    mocks.moduleEnabled.mockResolvedValue(false);
    const response = await handleExploreRequest(request('GET', '/api/integration/v1/explore/scopes'), session, ['scopes'], new Headers());
    expect(response.status).toBe(404);
  });
  it('lists reports of an accessible scope with the caller\'s edit level', async () => {
    mocks.resolve.mockResolvedValue({ level: 'read', target: { type: 'project', id: 'p1' } });
    mocks.listReports.mockResolvedValue([{ id: 'r1' }]);
    const response = await handleExploreRequest(request('GET', '/api/integration/v1/explore/reports?targetKey=project:p1'), session, ['reports'], new Headers({ 'Access-Control-Allow-Origin': 'http://web.test' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://web.test');
    expect(await response.json()).toEqual({ reports: [{ id: 'r1' }], canEdit: false });
  });
  it('lists the flows of every study of a project', async () => {
    mocks.scopeFindMany.mockResolvedValue([{ targetKey: 'project:p1', projectId: 'proj-1', visibility: 'lab', ownerMemberId: '' }]);
    mocks.projectFindMany.mockResolvedValue([{ id: 'p1', name: 'Microbiome', description: null, createdAt: new Date('2026-09-17T09:00:00Z') }]);
    mocks.listFlows.mockResolvedValue([{ id: 'f1', name: 'Diversity', targetKey: 'project:p1' }]);
    mocks.capability.mockReturnValue({ allowed: true, principal: { id: 'local' }, grant: { scope: 'own' } });
    const body = await (await handleExploreRequest(request('GET', '/x/explore/flows?projectId=proj-1'), session, ['flows'], new Headers())).json();
    expect(body).toEqual({ flows: [{ id: 'f1', name: 'Diversity', targetKey: 'project:p1', projectId: 'proj-1', visibility: 'lab' }], canEdit: true });
    expect(mocks.scopeFindMany.mock.calls[0][0].where.projectId).toBe('proj-1');
  });
  it('lists, creates, renames and deletes the flows of a study', async () => {
    mocks.resolve.mockResolvedValue({ level: 'write', target: { type: 'project', id: 'p1' } });
    mocks.listFlows.mockResolvedValue([{ id: 'f1', name: 'Diversity' }]);
    expect(await (await handleExploreRequest(request('GET', '/x/explore/flows?targetKey=project:p1'), session, ['flows'], new Headers())).json()).toEqual({ flows: [{ id: 'f1', name: 'Diversity', projectId: '', visibility: 'lab' }], canEdit: true });
    mocks.createFlow.mockResolvedValue({ id: 'f2', name: 'Flow 2' });
    const created = await handleExploreRequest(request('POST', '/x/explore/flows', { targetKey: 'project:p1', name: 'Flow 2', description: '' }), session, ['flows'], new Headers());
    expect(created.status).toBe(201);
    expect(mocks.createFlow).toHaveBeenCalledWith('project:p1', 'local', 'Flow 2', null, 'member');
    mocks.getFlowRecord.mockResolvedValue({ id: 'f2', targetKey: 'project:p1', name: 'Flow 2' });
    mocks.updateFlow.mockResolvedValue({ id: 'f2', name: 'Alpha diversity' });
    expect(await (await handleExploreRequest(request('PATCH', '/x/explore/flows/f2', { name: 'Alpha diversity' }), session, ['flows', 'f2'], new Headers())).json()).toEqual({ flow: { id: 'f2', name: 'Alpha diversity' } });
    expect(mocks.updateFlow).toHaveBeenCalledWith('f2', { name: 'Alpha diversity' });
    expect(await (await handleExploreRequest(request('DELETE', '/x/explore/flows/f2'), session, ['flows', 'f2'], new Headers())).json()).toEqual({ deleted: true });
    expect(mocks.processCleanupJobs).toHaveBeenCalled();
    const { ExploreRouteError } = await import('@/lib/explore/route-error');
    mocks.deleteFlow.mockRejectedValueOnce(new ExploreRouteError(409, 'This analysis is cited by report “Airway”.', 'cited', { citations: { reports: [{ id: 'r1', title: 'Airway' }], holds: [] } }));
    const refused = await handleExploreRequest(request('DELETE', '/x/explore/flows/f2'), session, ['flows', 'f2'], new Headers());
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'cited', citations: { reports: [{ id: 'r1', title: 'Airway' }] } });
    mocks.getFlowRecord.mockResolvedValue(null);
    expect((await handleExploreRequest(request('GET', '/x/explore/flows/nope'), session, ['flows', 'nope'], new Headers())).status).toBe(404);
  });
  it('prunes old run outputs only for admins; anyone who can read the study may ask for a dry run', async () => {
    mocks.resolve.mockResolvedValue({ level: 'read', target: { type: 'project', id: 'p1' } });
    mocks.pruneRuns.mockResolvedValue({ dryRun: true, runs: [] });
    const dry = await handleExploreRequest(request('POST', '/x/explore/housekeeping/prune', { targetKey: 'project:p1' }), session, ['housekeeping', 'prune'], new Headers());
    expect(dry.status).toBe(200);
    expect(mocks.pruneRuns).toHaveBeenCalledWith({ targetKey: 'project:p1', dryRun: true, olderThanDays: undefined });
    const real = await handleExploreRequest(request('POST', '/x/explore/housekeeping/prune', { dryRun: false }), session, ['housekeeping', 'prune'], new Headers());
    expect(real.status).toBe(403);
  });
  it('draws a canvas per flow and lists the steps of one flow', async () => {
    mocks.resolve.mockResolvedValue({ level: 'read', target: { type: 'project', id: 'p1' } });
    mocks.loadCanvasGraph.mockResolvedValue({ nodes: [], edges: [] });
    await handleExploreRequest(request('GET', '/x/explore/canvas?targetKey=project:p1&flowId=f1&reportId=r1'), session, ['canvas'], new Headers());
    expect(mocks.loadCanvasGraph).toHaveBeenCalledWith('project:p1', 'r1', 'f1');
    mocks.listAnalyses.mockResolvedValue([]);
    await handleExploreRequest(request('GET', '/x/explore/analyses?targetKey=project:p1&flowId=f1'), session, ['analyses'], new Headers());
    expect(mocks.listAnalyses).toHaveBeenCalledWith('project:p1', null, 'f1');
  });
  it('reads a Flow page across every flow of the study, exports it and hands out an absolute share link', async () => {
    mocks.resolve.mockResolvedValue({ level: 'write', target: { type: 'project', id: 'p1' } });
    mocks.getReportRecord.mockResolvedValue({ id: 'r1', targetKey: 'project:p1', title: 'Report' });
    mocks.getReportView.mockResolvedValue({ id: 'r1' });
    await handleExploreRequest(request('GET', '/x/explore/reports/r1'), session, ['reports', 'r1'], new Headers());
    expect(mocks.getReportView).toHaveBeenCalledWith('r1', { outputs: 'scope', suggest: false });
    mocks.renderReportHtml.mockResolvedValue({ html: '<!doctype html><title>Report: results/2026</title>', title: 'Report: results/2026' });
    const exported = await handleExploreRequest(request('GET', '/x/explore/reports/r1/export'), session, ['reports', 'r1', 'export'], new Headers());
    expect(exported.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(exported.headers.get('Content-Disposition')).toContain("filename*=UTF-8''Report-%20results-2026.html");
    expect(mocks.renderReportHtml).toHaveBeenCalledWith('r1', { plotly: 'inline', view: { outputs: 'scope', suggest: false } });
  });
  it('hides scopes the session may not open and unknown operations', async () => {
    mocks.resolve.mockResolvedValue({ level: 'none', target: { type: 'project', id: 'p1' } });
    expect((await handleExploreRequest(request('GET', '/x/explore/reports?targetKey=project:p1'), session, ['reports'], new Headers())).status).toBe(404);
    expect((await handleExploreRequest(request('GET', '/x/explore/nothing'), session, ['nothing'], new Headers())).status).toBe(404);
  });
});


describe('step conversation persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.moduleEnabled.mockResolvedValue(true);
    mocks.analysisFind.mockResolvedValue({ id: 'a1', targetKey: 'project:p1' });
  });
  const call = (method: string, body?: unknown) => handleExploreRequest(request(method, '/x/explore/analyses/a1/conversation', body), session, ['analyses', 'a1', 'conversation'], new Headers());
  it('scopes saved conversations to the authenticated user and step', async () => {
    mocks.conversationFind.mockResolvedValue({ version: 4, state: '{"turns":[],"draft":"hello"}' });
    expect(await (await call('GET')).json()).toEqual({ version: 4, state: { turns: [], draft: 'hello' } });
    expect(mocks.conversationFind).toHaveBeenCalledWith({ where: { analysisId_userId: { analysisId: 'a1', userId: 'local' } } });
  });
  it('rejects stale tab updates and simultaneous first saves', async () => {
    mocks.conversationUpdate.mockResolvedValue({ count: 0 });
    expect((await call('PUT', { version: 2, state: { turns: [], draft: '' } })).status).toBe(409);
    mocks.conversationCreate.mockRejectedValue({ code: 'P2002' });
    expect((await call('PUT', { version: 0, state: { turns: [], draft: '' } })).status).toBe(409);
  });
  it('increments the exact prior conversation version and bounds storage', async () => {
    mocks.conversationUpdate.mockResolvedValue({ count: 1 });
    expect(await (await call('PUT', { version: 2, state: { turns: [], draft: 'test' } })).json()).toEqual({ version: 3 });
    expect(mocks.conversationUpdate.mock.calls[0][0].where).toEqual({ analysisId: 'a1', userId: 'local', version: 2 });
    expect((await call('PUT', { version: 2, state: { draft: 'x'.repeat(800001) } })).status).toBe(400);
  });
});

describe('a full disk while storing', () => {
  it('answers 507 with a plain sentence for ENOSPC and quota errors', () => {
    for (const code of ['ENOSPC', 'EDQUOT']) {
      expect(statusOf(Object.assign(new Error(`${code}: no space left on device, write`), { code }))).toEqual({ status: 507, message: 'The server has no space left to store this. Nothing was added.' });
    }
    expect(statusOf(new Error('something else'))).toBeNull();
  });
});
