import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), resolve: vi.fn(), prepare: vi.fn(), bases: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { exploreAnalysis: { findUnique: mocks.find, update: mocks.update } } }));
vi.mock('@/lib/explore/module', () => ({ isExploreModuleEnabled: async () => true }));
vi.mock('@/lib/explore/authorization', async () => {
  const actual = await vi.importActual<typeof import('@/lib/explore/authorization')>('@/lib/explore/authorization');
  return { ...actual, requireTargetAccess: vi.fn(), requireExplorePrincipal: vi.fn() };
});
vi.mock('./explore-flow', () => ({ handleFlowRequest: async () => null, isFlowPath: () => false, flowChanged: vi.fn() }));
vi.mock('@/lib/explore/step-environments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/explore/step-environments')>('@/lib/explore/step-environments');
  return { ...actual, resolveStepEnvironment: mocks.resolve, prepareStepEnvironment: mocks.prepare, listBaseEnvironments: mocks.bases };
});
import { NextRequest } from 'next/server';
import { handleExploreRequest } from './explore';
import type { IntegrationSession } from './identity';

const session = { user: { id: 'local' }, integration: { authority: 'https://collab.example', workspaceId: 'team', memberId: 'member', projectId: '' } } as IntegrationSession;
const call = (method: string, segments: string[], body?: unknown) => handleExploreRequest(new NextRequest(new URL(`/x/explore/${segments.join('/')}`, 'http://compute.test'), { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) }), session, segments, new Headers());
const state = (status: string) => ({ name: 'seqdesk-explore-r+abc', baseName: 'seqdesk-explore-r', derived: true, status, specHash: 's', packages: { packages: ['r-lme4'], channels: [] }, prefixPath: '/secret/envs/x', lockDigest: null, builtAt: null, log: 'Solving environment: done', error: null });

describe('explore.packages routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockResolvedValue({ id: 'a1', targetKey: 'project:p1', environmentName: 'seqdesk-explore-r', packages: { packages: ['r-lme4'], channels: [] } });
    mocks.update.mockResolvedValue({});
    mocks.resolve.mockResolvedValue(state('missing'));
    mocks.prepare.mockResolvedValue(state('building'));
  });
  it('reads a step\'s packages with its environment state and no prefix path', async () => {
    const response = await call('GET', ['analyses', 'a1', 'packages']);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ packages: ['r-lme4'], channels: [], base: 'seqdesk-explore-r', environment: { status: 'missing', derived: true, name: 'seqdesk-explore-r+abc' } });
    expect(JSON.stringify(body)).not.toContain('/secret');
  });
  it('saves normalised packages', async () => {
    const response = await call('PUT', ['analyses', 'a1', 'packages'], { packages: ['R-LME4', 'bioconductor-deseq2 = 1.42', 'r-lme4'], channels: ['bioconda'] });
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { packages: { packages: ['bioconductor-deseq2=1.42', 'r-lme4'], channels: ['bioconda'] } } });
  });
  it.each([['deseq2; rm -rf ~'], ['$(id)'], ['a b'], ['https://x/y.tar.bz2']])('rejects the shell-ish package %j', async (bad) => {
    const response = await call('PUT', ['analyses', 'a1', 'packages'], { packages: ['r-lme4', bad] });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/not a conda package spec/);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('rejects a channel that is a URL', async () => {
    expect((await call('PUT', ['analyses', 'a1', 'packages'], { packages: [], channels: ['https://evil.example/c'] })).status).toBe(400);
  });
  it('prepares now: starts (or retries) the build and answers 202 while it builds', async () => {
    const response = await call('POST', ['analyses', 'a1', 'environment', 'prepare']);
    expect(response.status).toBe(202);
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ environmentName: 'seqdesk-explore-r' }), { retryFailed: true });
    expect((await response.json()).environment).toMatchObject({ status: 'building', log: 'Solving environment: done' });
  });
  it('lists the base environments', async () => {
    mocks.bases.mockResolvedValue([{ name: 'seqdesk-explore-r', language: 'r', packages: ['r-base=4.5.*'] }]);
    expect(await (await call('GET', ['environments', 'bases'])).json()).toEqual({ bases: [{ name: 'seqdesk-explore-r', language: 'r', packages: ['r-base=4.5.*'] }] });
  });
});
