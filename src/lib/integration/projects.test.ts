import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), study: vi.fn(), order: vi.fn(), run: vi.fn(), capability: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { $queryRaw: mocks.query, $executeRaw: mocks.execute,
  study: { findFirst: mocks.study }, order: { findFirst: mocks.order }, pipelineRun: { findUnique: mocks.run } } }));
vi.mock('@/lib/authorization', () => ({ decideCapability: mocks.capability }));
vi.mock('@/lib/deployment-profile/server', () => ({ getServerDeploymentProfile: () => ({}) }));
import { projectTargetIDs, assertProjectRun, assertProjectTarget, changeProjectLink } from './projects';
import type { IntegrationSession } from './identity';
const session = { user: { id: 'local' }, integration: { authority: 'https://collaboration.example', workspaceId: 'team', memberId: 'member', projectId: 'project' } } as IntegrationSession;
describe('scientific project links', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.query.mockResolvedValue([{ targetId: 'allowed' }]);
    mocks.capability.mockImplementation((_session, capability) => capability.endsWith('read_all') ? { allowed: false } : { allowed: true, grant: { scope: 'own' } }); });
  it('uses the confirmed authority, workspace and project, never a client-supplied context', async () => {
    expect(await projectTargetIDs(session, 'study')).toEqual(['allowed']);
    expect(mocks.query.mock.calls[0].slice(1)).toEqual(['https://collaboration.example', 'team', 'project', 'study']);
  });
  it('keeps unscoped scientific access distinct from project membership', async () => {
    expect(await projectTargetIDs({ ...session, integration: { ...session.integration, projectId: '' } }, 'study')).toBeNull();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('blocks unrelated targets and runs before the normal scientific operation', async () => {
    await expect(assertProjectTarget(session, 'study', 'other')).rejects.toMatchObject({ status: 404 });
    mocks.run.mockResolvedValue({ studyId: 'other', orderId: null });
    await expect(assertProjectRun(session, 'run')).rejects.toMatchObject({ status: 404 });
  });
  it('requires independent scientific ownership before creating a link', async () => {
    mocks.study.mockResolvedValue(null);
    await expect(changeProjectLink(session, { kind: 'study', id: 'private-other', linked: true })).rejects.toMatchObject({ status: 404 });
    expect(mocks.study).toHaveBeenCalledWith({ where: { id: 'private-other', userId: 'local' }, select: { id: true } });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('does not let a link body override the verified project context', async () => {
    mocks.study.mockResolvedValue({ id: 'allowed' });
    await changeProjectLink(session, { kind: 'study', id: 'allowed', linked: true, projectId: 'forged', workspaceId: 'other' });
    expect(mocks.execute.mock.calls[0].slice(2)).toEqual(['https://collaboration.example', 'team', 'project', 'study', 'allowed', 'local']);
  });
  it('rejects missing context or malformed target kinds without writing', async () => {
    await expect(changeProjectLink({ ...session, integration: { ...session.integration, projectId: '' } }, { kind: 'study', id: 'allowed', linked: true })).rejects.toMatchObject({ status: 400 });
    await expect(changeProjectLink(session, { kind: ['study'], id: 'allowed', linked: true })).rejects.toMatchObject({ status: 400 });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
