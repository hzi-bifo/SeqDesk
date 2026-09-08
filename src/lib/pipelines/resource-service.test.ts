import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PipelineResourceSchema } from './resource-schema';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(),
  start: vi.fn(), link: vi.fn(), preflight: vi.fn(), settings: vi.fn(), package: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { pipelineConfig: { findUnique: mocks.findUnique, updateMany: mocks.updateMany, create: mocks.create } } }));
vi.mock('./package-loader', () => ({ getPipelinesDir: () => '/internal-state', getPackage: mocks.package }));
vi.mock('./execution-settings', () => ({ getExecutionSettings: mocks.settings }));
vi.mock('./resource-installer', async importOriginal => ({ ...await importOriginal<typeof import('./resource-installer')>(), startResourceInstallation: mocks.start, linkResourceInstallation: mocks.link, resourcePreflight: mocks.preflight }));
import { bindResourceConfig, resourceApiAction } from './resource-service';

const resource = PipelineResourceSchema.parse({ id: 'markers', label: 'Internal fixture', version: 'v1', type: 'archive-set',
  assets: [{ fileName: 'fixture.tar', url: 'https://example.org/fixture.tar', bytes: 1024, format: 'tar', checksum: { algorithm: 'sha256', value: '0'.repeat(64) } }],
  requiredFiles: ['index'], maxExtractedBytes: 4096, config: { pathKey: 'dbDirectory', values: { index: 'pinned' } } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.package.mockReturnValue({ registry: { defaultConfig: { threads: 4 } }, manifest: { resources: [resource] } });
  mocks.findUnique.mockResolvedValue({ enabled: false, config: '{"unrelated":"keep"}' });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.settings.mockResolvedValue({ pipelineRunDir: '/data/runs', pipelineDatabaseDir: '/data/databases' });
  mocks.start.mockResolvedValue({ started: true, job: { state: 'running' }, completion: Promise.resolve() });
});

describe('resource configuration binding', () => {
  it('sets path and version together, preserving defaults, edits and enabled state', async () => {
    await bindResourceConfig('internal-fixture', resource, '/installed/db');
    const args = mocks.updateMany.mock.calls[0][0];
    expect(JSON.parse(args.data.config)).toEqual({ threads: 4, unrelated: 'keep', dbDirectory: '/installed/db', index: 'pinned' });
    expect(args.data).not.toHaveProperty('enabled');
    expect(args.where.config).toBe('{"unrelated":"keep"}');
  });
  it('retries when configuration changed concurrently, without losing the newer edit', async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.findUnique.mockResolvedValueOnce({ config: '{"unrelated":"old"}' }).mockResolvedValue({ config: '{"unrelated":"new"}' });
    await bindResourceConfig('internal-fixture', resource, '/installed/db');
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mocks.updateMany.mock.calls[1][0].data.config).unrelated).toBe('new');
  });
  it('does not silently discard invalid saved configuration', async () => {
    mocks.findUnique.mockResolvedValue({ config: '[]' });
    await expect(bindResourceConfig('internal-fixture', resource, '/installed/db')).rejects.toThrow('invalid');
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it('never enables a newly configured pipeline automatically', async () => {
    mocks.findUnique.mockResolvedValue(null);
    await bindResourceConfig('internal-fixture', resource, '/installed/db');
    expect(mocks.create.mock.calls[0][0].data.enabled).toBe(false);
  });
  it('handles a concurrent first configuration without overwriting it', async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    mocks.create.mockRejectedValue({ code: 'P2002' });
    await bindResourceConfig('internal-fixture', resource, '/installed/db');
    expect(JSON.parse(mocks.updateMany.mock.calls[0][0].data.config).unrelated).toBe('keep');
  });
  it('bounds conflict retries', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(bindResourceConfig('internal-fixture', resource, '/installed/db')).rejects.toMatchObject({ status: 409 });
    expect(mocks.updateMany).toHaveBeenCalledTimes(5);
  });
  it('does not activate a resource after its pipeline was removed or its definition changed', async () => {
    mocks.package.mockReturnValueOnce(undefined).mockReturnValueOnce({ manifest: { resources: [{ ...resource, version: 'v2' }] } });
    await expect(bindResourceConfig('internal-fixture', resource, '/installed/db')).rejects.toMatchObject({ status: 409 });
    await expect(bindResourceConfig('internal-fixture', resource, '/installed/db')).rejects.toMatchObject({ status: 409 });
    expect(mocks.updateMany).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('resource API service', () => {
  it('starts in the configured database root and returns 202 without serializing the worker promise', async () => {
    const response = await resourceApiAction('start', 'internal-fixture', resource);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ started: true, job: { state: 'running' } });
    expect(mocks.start.mock.calls[0][0]).toMatchObject({ directory: '/data/databases/internal-fixture/markers' });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it('passes a directory and rate but no client URLs or executable commands', async () => {
    await resourceApiAction('start', 'internal-fixture', resource, '/other/database/', '10M');
    expect(mocks.start.mock.calls[0][0]).toMatchObject({ directory: '/other/database/', limitRate: '10M', resource });
  });
  it('requires a configured root or explicit path', async () => {
    mocks.settings.mockResolvedValue({});
    expect((await resourceApiAction('start', 'internal-fixture', resource)).status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('rejects invalid or missing existing paths', async () => {
    expect((await resourceApiAction('start', 'internal-fixture', resource, {})).status).toBe(400);
    expect((await resourceApiAction('link', 'internal-fixture', resource)).status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.link).not.toHaveBeenCalled();
  });
});
