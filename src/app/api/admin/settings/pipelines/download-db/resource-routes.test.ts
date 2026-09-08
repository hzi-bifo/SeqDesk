import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ session: vi.fn(), definition: vi.fn(), action: vi.fn(), job: vi.fn(), cancel: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/pipelines', () => ({ PIPELINE_REGISTRY: {} }));
vi.mock('@/lib/pipelines/resource-service', () => ({ resourceApiAction: mocks.action }));
vi.mock('@/lib/pipelines/resource-jobs', () => ({ cancelResourceJob: mocks.cancel }));
vi.mock('@/lib/pipelines/package-loader', () => ({ getPipelinesDir: () => '/internal-state' }));
vi.mock('@/lib/pipelines/database-downloads', () => ({
  getPipelineDatabaseDefinition: mocks.definition, getDatabaseDownloadJobStatus: mocks.job,
}));
import { POST as start } from './route';
import { POST as preflight } from './preflight/route';
import { POST as link } from './link-existing/route';
import { POST as cancel } from './cancel/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'admin', role: 'FACILITY_ADMIN' } });
  mocks.definition.mockReturnValue({ resource: { id: 'markers' } });
  mocks.job.mockResolvedValue({ state: 'running', managedResource: true });
  mocks.action.mockResolvedValue(NextResponse.json({ ok: true }));
  mocks.cancel.mockResolvedValue({ cancelled: true });
});
const request = () => new NextRequest('http://localhost/internal-resource-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pipelineId: 'internal-fixture', databaseId: 'markers', path: '/existing/db', targetPath: '/new/db' }) });
describe('managed resource route authorization and dispatch', () => {
  it.each([['start', start], ['preflight', preflight], ['link', link], ['cancel', cancel]] as const)('%s requires authentication and an administrator', async (_name, handler) => {
    mocks.session.mockResolvedValue(null);
    expect((await handler(request())).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { id: 'user', role: 'RESEARCHER' } });
    expect((await handler(request())).status).toBe(403);
    expect(mocks.action).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it.each([['start', start, '/new/db'], ['preflight', preflight, '/new/db'], ['link', link, '/existing/db']] as const)('%s dispatches by manifest resource, without legacy downloads', async (name, handler, directory) => {
    expect((await handler(request())).status).toBe(200);
    expect(mocks.action.mock.calls[0].slice(0, 4)).toEqual([name, 'internal-fixture', { id: 'markers' }, directory]);
  });
  it('cancels managed jobs without killing any process by PID', async () => {
    const kill = vi.spyOn(process, 'kill');
    try {
      expect((await cancel(request())).status).toBe(200);
      expect(mocks.cancel).toHaveBeenCalledWith('/internal-state', 'internal-fixture', 'markers');
      expect(kill).not.toHaveBeenCalled();
    } finally { kill.mockRestore(); }
  });
});
