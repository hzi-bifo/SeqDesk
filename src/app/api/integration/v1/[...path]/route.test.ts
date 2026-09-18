import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  session: vi.fn(), studies: vi.fn(), study: vi.fn(), create: vi.fn(), start: vi.fn(),
  list: vi.fn(), read: vi.fn(), details: vi.fn(), cancel: vi.fn(), cancelAccess: vi.fn(), file: vi.fn(),
  capability: vi.fn(),
}));
vi.mock('@/lib/integration/identity', async () => {
  const actual = await vi.importActual<typeof import('@/lib/integration/identity')>('@/lib/integration/identity');
  return { ...actual, integrationSession: mocks.session };
});
vi.mock('@/lib/db', () => ({ db: { study: { findMany: mocks.studies, findFirst: mocks.study } } }));
vi.mock('@/lib/authorization', () => ({ decideCapability: mocks.capability }));
vi.mock('@/lib/deployment-profile/server', () => ({ getServerDeploymentProfile: () => ({}) }));
vi.mock('@/lib/pipelines/pipeline-run-service', () => ({ listPipelineRunsForOperator: mocks.list, createPipelineRunForOperator: mocks.create, startPipelineRunForOperator: mocks.start }));
vi.mock('@/lib/pipelines/pipeline-run-ops-service', () => ({ getPipelineRunDetailsForOperator: mocks.details, cancelPipelineRunForOperator: mocks.cancel }));
vi.mock('@/lib/pipelines/run-visibility', () => ({ assertPipelineRunReadAccess: mocks.read, assertPipelineRunCancelAccess: mocks.cancelAccess }));
vi.mock('@/lib/pipelines/run-file-service', () => ({ servePipelineRunFile: mocks.file }));
vi.mock('@/lib/pipelines/registry', () => ({ PIPELINE_REGISTRY: {} }));
vi.mock('@/lib/pipelines/enablement', () => ({ getPipelineEnabled: vi.fn() }));
import { GET, POST, OPTIONS } from './route';
import { IntegrationAccessError } from '@/lib/integration/identity';
const request = (path: string, method = 'GET', body?: unknown, origin = 'https://web.example') => new NextRequest(`https://compute.example/api/integration/v1/${path}`, {
  method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});
const context = (path: string) => ({ params: Promise.resolve({ path: path.split('/') }) });
describe('Analysis API authorization and standalone service reuse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SEQDESK_INTEGRATION_CONFIG_FILE', '');
    vi.stubEnv('SEQDESK_INTEGRATION_CONFIG', JSON.stringify({ installationId: 'one', name: 'Compute', collaborationOrigin: 'https://collaboration.example', secret: 'a'.repeat(64), webOrigins: ['https://web.example'], accounts: [] }));
    mocks.session.mockResolvedValue({ user: { id: 'local' } });
    mocks.capability.mockImplementation((_session, capability) => capability.endsWith('read_all') || capability === 'system.pipelines.manage' ? { allowed: false, status: 403 } : { allowed: true, grant: { scope: 'own' }, status: 200 });
    mocks.studies.mockResolvedValue([{ id: 'study', title: 'Study', description: null, createdAt: new Date(), _count: { samples: 2 } }]);
  });
  afterEach(() => vi.unstubAllEnvs());
  it('rejects untrusted browser origins before identity or data access', async () => {
    expect((await GET(request('studies', 'GET', undefined, 'https://other.example'), context('studies'))).status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.studies).not.toHaveBeenCalled();
  });
  it('preflights only the configured origin without allowing cookies', async () => {
    const response = await OPTIONS(request('studies', 'OPTIONS'), context('studies'));
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://web.example');
    expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(false);
  });
  it('discovery exposes no account mapping or secret', async () => {
    const response = await GET(request('info'), context('info'));
    const body = await response.json();
    expect(body.installationId).toBe('one');
    expect(body.secret).toBeUndefined(); expect(body.accounts).toBeUndefined(); expect(mocks.session).not.toHaveBeenCalled();
  });
  it('fails closed when collaboration identity is revoked', async () => {
    mocks.session.mockRejectedValueOnce(new IntegrationAccessError(403, 'Revoked'));
    expect((await GET(request('studies'), context('studies'))).status).toBe(403);
    expect(mocks.studies).not.toHaveBeenCalled();
  });
  it('scopes study lists and individual study lookups to the authorized local user', async () => {
    expect((await GET(request('studies'), context('studies'))).status).toBe(200);
    expect(mocks.studies).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'local' } }));
    mocks.study.mockResolvedValue(null);
    expect((await GET(request('studies/other'), context('studies/other'))).status).toBe(404);
    expect(mocks.study).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'other', userId: 'local' } }));
  });
  it('uses existing run creation with the local actor and capability scope', async () => {
    mocks.create.mockResolvedValue({ status: 200, body: { run: { id: 'run' } } });
    const body = { studyId: 'study', pipelineId: 'checksum', config: {} };
    expect((await POST(request('runs', 'POST', body), context('runs'))).status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith({ body, userId: 'local', accessScope: 'own', canManageConfig: false });
  });
  it('does not read run details or cancel a run when object access is denied', async () => {
    mocks.read.mockResolvedValue({ status: 404, body: { error: 'Not found' } });
    mocks.cancelAccess.mockResolvedValue({ status: 403, body: { error: 'Forbidden' } });
    expect((await GET(request('runs/other'), context('runs/other'))).status).toBe(404);
    expect((await POST(request('runs/other/cancel', 'POST', {}), context('runs/other/cancel'))).status).toBe(403);
    expect(mocks.details).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('forces result-file downloads through the existing authorized file service', async () => {
    mocks.file.mockResolvedValue(new Response('result', { headers: { 'Content-Type': 'application/octet-stream' } }));
    const response = await GET(request('runs/run/file?path=report.html&inline=1'), context('runs/run/file'));
    expect(response.status).toBe(200);
    expect(mocks.file.mock.calls[0][0].nextUrl.searchParams.get('mode')).toBe('download');
    expect(mocks.file.mock.calls[0][0].nextUrl.searchParams.has('inline')).toBe(false);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://web.example');
  });
});
