import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { user: { findUnique: mocks.findUnique } } }));
import { integrationSession } from './identity';
import { integrationConfig, type IntegrationConfig } from './config';
const config: IntegrationConfig = { installationId: 'compute-one', name: 'Lab compute',
  collaborationOrigin: 'https://collaboration.example', secret: 'a'.repeat(40),
  webOrigins: ['https://web.example'], accounts: [{ workspaceId: 'lab', memberId: 'member', userId: 'local' }] };
const request = () => new Request('https://compute.example/api/integration/v1/studies', { headers: { Authorization: `Bearer ${'b'.repeat(64)}` } });
describe('Compute identity boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it('uses the configured authority and live local account roles', async () => {
    const transport = vi.fn(async () => Response.json({ installationId: 'compute-one', workspaceId: 'lab', memberId: 'member', expiresAt: Date.now() + 30000 }));
    vi.stubGlobal('fetch', transport);
    mocks.findUnique.mockResolvedValue({ id: 'local', isActive: true, isDemo: false, firstName: 'Lab', lastName: 'User', email: 'user@example.org', role: 'RESEARCHER', systemRole: 'MEMBER', facilityWorkflowRole: 'REQUESTER' });
    const session = await integrationSession(request(), config);
    expect(session.user.id).toBe('local');
    expect(session.user.systemRole).toBe('MEMBER');
    expect(transport.mock.calls[0]).toEqual([`${config.collaborationOrigin}/api/compute/identity`, expect.objectContaining({ redirect: 'error', cache: 'no-store' })]);
  });
  it('rejects revoked collaboration access before querying scientific accounts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })));
    await expect(integrationSession(request(), config)).rejects.toMatchObject({ status: 403 });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it.each([
    { installationId: 'other', workspaceId: 'lab', memberId: 'member', expiresAt: Date.now() + 30000 },
    { installationId: 'compute-one', workspaceId: 'other', memberId: 'member', expiresAt: Date.now() + 30000 },
    { installationId: 'compute-one', workspaceId: 'lab', memberId: 'member', expiresAt: 1 },
  ])('rejects unbound or expired identities', async identity => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(identity)));
    await expect(integrationSession(request(), config)).rejects.toThrow();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it('does not accept a deactivated Compute account', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ installationId: 'compute-one', workspaceId: 'lab', memberId: 'member', expiresAt: Date.now() + 30000 })));
    mocks.findUnique.mockResolvedValue({ isActive: false });
    await expect(integrationSession(request(), config)).rejects.toMatchObject({ status: 403 });
  });
  it('fails closed for duplicate account mappings or an insecure authority', () => {
    vi.stubEnv('SEQDESK_INTEGRATION_CONFIG', JSON.stringify({ ...config, accounts: [...config.accounts, ...config.accounts] }));
    expect(() => integrationConfig()).toThrow(/Duplicate/);
    vi.stubEnv('SEQDESK_INTEGRATION_CONFIG', JSON.stringify({ ...config, collaborationOrigin: 'http://remote.example' }));
    expect(() => integrationConfig()).toThrow(/HTTPS/);
  });
});
