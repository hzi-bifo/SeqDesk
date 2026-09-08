import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { pack } from 'tar-stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PipelineResourceSchema, type PipelineResource } from './resource-schema';
import { isPublicResourceAddress, validateResourceDirectory } from './resource-files';
import { startResourceInstallation, linkResourceInstallation, resourcePreflight } from './resource-installer';
import { cancelResourceJob, claimResourceJob, readResourceJob, resourceJobPaths, atomicResourceJson } from './resource-jobs';

// Tiny internal archive fixtures exercise the real filesystem/streaming installer.
// They are NOT copies or simulated responses from an external scientific service.
async function archive(entries: Array<{ name: string; body?: string; type?: string; linkname?: string }>) {
  const tar = pack();
  for (const entry of entries) tar.entry(entry, Buffer.from(entry.body ?? 'internal fixture only'));
  tar.finalize();
  const chunks = [];
  for await (const chunk of tar) chunks.push(chunk);
  return Buffer.concat(chunks);
}

let temp: string;
let bytes: Buffer;
let resource: PipelineResource;
beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'seqdesk-resource-test-'));
  bytes = await archive([{ name: 'metadata.pkl' }, { name: 'index.1.bt2l' }]);
  resource = PipelineResourceSchema.parse({
    id: 'markers', label: 'Internal fixture', version: 'v1', type: 'archive-set',
    assets: [{ fileName: 'fixture.tar', url: 'https://example.org/fixture.tar', bytes: bytes.length, format: 'tar',
      checksum: { algorithm: 'sha256', value: createHash('sha256').update(bytes).digest('hex') } }],
    requiredFiles: ['metadata.pkl', 'index.1.bt2l'], maxExtractedBytes: 1024 ** 2,
    config: { pathKey: 'dbDirectory', values: { index: 'pinned' } },
  });
});
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(temp, { recursive: true, force: true }); });
const root = () => path.join(temp, 'state');
const context = () => ({ root: root(), pipelineId: 'internal-fixture', resource, directory: path.join(temp, 'databases'), applyConfig: vi.fn().mockResolvedValue(undefined) });
const dependencies = () => ({ open: async () => Readable.from([bytes]) });
const job = () => readResourceJob(root(), 'internal-fixture', 'markers');

describe('declarative resource contract', () => {
  it.each(['../escape', '/etc/passwd', 'folder/file', 'bad\\name', '__proto__'])('rejects unsafe or undeclared paths: %s', name => {
    expect(PipelineResourceSchema.safeParse({ ...resource, requiredFiles: [name] }).success).toBe(false);
  });
  it.each(['invalid URL', 'http://example.org/db', 'https://user:pass@example.org/db', 'https://127.0.0.1/db', 'https://[::1]/db', 'https://example.org:8443/db'])('rejects unsupported resource URLs: %s', url => {
    expect(PipelineResourceSchema.safeParse({ ...resource, assets: [{ ...resource.assets[0], url }] }).success).toBe(false);
  });
  it('rejects malformed hashes, duplicate files, bindings and executable hooks', () => {
    for (const changed of [
      { assets: [{ ...resource.assets[0], checksum: { algorithm: 'sha256', value: '1234' } }] },
      { requiredFiles: ['index', 'INDEX'] },
      { config: { pathKey: 'dbDirectory', values: { dbDirectory: '/bad' } } },
      { script: 'untrusted shell' },
    ]) expect(PipelineResourceSchema.safeParse({ ...resource, ...changed }).success).toBe(false);
  });
  it.each(['127.0.0.1', '10.1.2.3', '172.16.1.2', '192.168.1.1', '169.254.169.254', '100.64.1.1', '198.18.1.1', '0.0.0.0', '224.0.0.1', '::ffff:127.0.0.1', '256.1.1.1'])('rejects non-public resolved addresses: %s', address => {
    expect(isPublicResourceAddress(address)).toBe(false);
  });
  it('accepts a public IPv4 address', () => expect(isPublicResourceAddress('8.8.8.8')).toBe(true));
});

describe('resource setup lifecycle', () => {
  it('installs verified files, retains old data, and only then binds config', async () => {
    const options = context();
    await fs.mkdir(options.directory);
    await fs.writeFile(path.join(options.directory, 'existing-database'), 'keep');
    options.applyConfig.mockImplementation(async directory => {
      expect(await validateResourceDirectory(resource, directory)).toMatchObject({ bytes: 42 });
    });
    const started = await startResourceInstallation(options, dependencies());
    expect(started.started).toBe(true);
    await started.completion;
    expect(await job()).toMatchObject({ state: 'success', progressPercent: 100 });
    expect(options.applyConfig).toHaveBeenCalledOnce();
    expect(await fs.readFile(path.join(options.directory, 'existing-database'), 'utf8')).toBe('keep');
    const installed = options.applyConfig.mock.calls[0][0];
    const receipt = JSON.parse(await fs.readFile(path.join(installed, '.seqdesk-resource.json'), 'utf8'));
    expect(receipt.assets[0].sha256).toHaveLength(64);
    expect(receipt.files['metadata.pkl'].sha256).toHaveLength(64);
    expect((await fs.readdir(options.directory)).some(name => name.startsWith('.seqdesk-resource-'))).toBe(false);
  });
  it('supports gzip archives and publisher MD5 with a local SHA256 receipt', async () => {
    bytes = gzipSync(bytes);
    resource.assets[0] = { ...resource.assets[0], bytes: bytes.length, format: 'tar.gz', checksum: { algorithm: 'md5', value: createHash('md5').update(bytes).digest('hex') } };
    const started = await startResourceInstallation(context(), dependencies()); await started.completion;
    expect(await job()).toMatchObject({ state: 'success' });
  });
  it('accepts bounded positive base-256 tar sizes used by the upstream large indexes', async () => {
    bytes.fill(0, 124, 136); bytes[124] = 128; bytes[135] = 21;
    bytes.fill(32, 148, 156);
    const checksum = bytes.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
    bytes.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    resource.assets[0].checksum.value = createHash('sha256').update(bytes).digest('hex');
    const started = await startResourceInstallation(context(), dependencies()); await started.completion;
    expect(await job()).toMatchObject({ state: 'success' });
  });
  it('rejects nonempty partial files when the manifest declares file sizes', async () => {
    resource.fileSizes = { 'metadata.pkl': 500, 'index.1.bt2l': 1000 };
    const options = context(); await fs.mkdir(options.directory);
    for (const name of resource.requiredFiles) await fs.writeFile(path.join(options.directory, name), 'partial');
    await expect(linkResourceInstallation(options)).rejects.toThrow('Incomplete');
    expect(options.applyConfig).not.toHaveBeenCalled();
    const started = await startResourceInstallation(options, dependencies()); await started.completion;
    expect(await job()).toMatchObject({ state: 'error', error: expect.stringContaining('does not match') });
  });
  it.each(['checksum', 'truncated', 'oversized', 'missing', 'expanded-limit', 'duplicate', 'traversal', 'symlink', 'empty'])('fails closed for %s and never binds config', async reason => {
    if (reason === 'checksum') resource.assets[0].checksum.value = '0'.repeat(64);
    if (reason === 'truncated') resource.assets[0].bytes += 1;
    if (reason === 'oversized') resource.assets[0].bytes -= 1;
    if (reason === 'missing') resource.requiredFiles.push('absent');
    if (reason === 'expanded-limit') resource.maxExtractedBytes = 10;
    if (['duplicate', 'traversal', 'symlink', 'empty'].includes(reason)) {
      bytes = await archive(reason === 'duplicate' ? [{ name: 'metadata.pkl' }, { name: 'metadata.pkl' }] : reason === 'traversal' ? [{ name: '../metadata.pkl' }] : reason === 'symlink' ? [{ name: 'metadata.pkl', type: 'symlink', linkname: '/etc/passwd', body: '' }] : [{ name: 'metadata.pkl', body: '' }]);
      resource.assets[0].bytes = bytes.length;
      resource.assets[0].checksum.value = createHash('sha256').update(bytes).digest('hex');
    }
    const options = context();
    const started = await startResourceInstallation(options, dependencies()); await started.completion;
    expect(await job()).toMatchObject({ state: 'error' });
    expect(options.applyConfig).not.toHaveBeenCalled();
    expect(await fs.readdir(options.directory)).toEqual([]);
  });
  it('accounts for extraction space and enforces preflight on start', async () => {
    const options = context();
    const before = await resourcePreflight(resource, options.directory);
    expect(before.requiredBytes).toBe(bytes.length + resource.maxExtractedBytes + 1024 ** 3);
    const open = vi.fn();
    await expect(startResourceInstallation(options, { open, preflight: async () => ({ ...before, sufficient: false }) })).rejects.toThrow('Insufficient');
    expect(open).not.toHaveBeenCalled();
    const claim = await claimResourceJob(root(), options.pipelineId, resource.id); await claim.release();
  });
  it.each(['/', 'relative/path'])('rejects dangerous or relative parent: %s', directory => expect(resourcePreflight(resource, directory)).rejects.toThrow('dedicated absolute'));
  it('cancels a blocked transfer and blocks a concurrent start until cleanup', async () => {
    const options = context();
    const pending = new Readable({ read() {} });
    const started = await startResourceInstallation(options, { open: async (_url, signal) => {
      signal.addEventListener('abort', () => pending.destroy(signal.reason), { once: true });
      return pending;
    } });
    await expect(startResourceInstallation(options, dependencies())).rejects.toMatchObject({ status: 409 });
    await cancelResourceJob(root(), options.pipelineId, resource.id);
    await started.completion;
    expect(await job()).toMatchObject({ state: 'error', cancelled: true });
    expect(options.applyConfig).not.toHaveBeenCalled();
    expect(await fs.readdir(options.directory)).toEqual([]);
    const retry = await startResourceInstallation(options, dependencies()); await retry.completion;
    expect(await job()).toMatchObject({ state: 'success' });
  });
  it('rejects cancellation once config activation has begun', async () => {
    const options = context();
    options.applyConfig.mockImplementation(async () => {
      await expect(cancelResourceJob(root(), options.pipelineId, resource.id)).rejects.toMatchObject({ status: 409 });
    });
    const started = await startResourceInstallation(options, dependencies()); await started.completion;
    expect(await job()).toMatchObject({ state: 'success' });
  });
  it('cannot cancel a newer attempt using a stale job token', async () => {
    const old = await claimResourceJob(root(), 'internal-fixture', 'markers');
    await atomicResourceJson(old.paths.job, { managedResource: true, owner: old.owner, pipelineId: 'internal-fixture', databaseId: 'markers', state: 'running' });
    await old.beginCommit(); await old.release();
    const newer = await claimResourceJob(root(), 'internal-fixture', 'markers');
    try {
      await expect(cancelResourceJob(root(), 'internal-fixture', 'markers')).rejects.toMatchObject({ status: 409 });
      expect(await newer.isCancelled()).toBe(false);
      await newer.beginCommit();
    } finally { await newer.release(); }
  });
  it('retains verified data if configuration persistence fails', async () => {
    const options = context(); options.applyConfig.mockRejectedValue(new Error('Internal persistence failure'));
    const started = await startResourceInstallation(options, dependencies()); await started.completion;
    expect(await job()).toMatchObject({ state: 'error', error: expect.stringContaining('retained') });
    await expect(validateResourceDirectory(resource, (await job())!.targetPath!)).resolves.toMatchObject({ bytes: 42 });
  });
  it('links only a complete directory, without claiming checksum verification', async () => {
    const options = context(); await fs.mkdir(options.directory);
    await expect(linkResourceInstallation(options)).rejects.toThrow('Missing');
    for (const name of resource.requiredFiles) await fs.writeFile(path.join(options.directory, name), 'local trusted fixture');
    await expect(linkResourceInstallation(options)).resolves.toMatchObject({ success: true, verification: expect.stringContaining('not verified') });
    expect(options.applyConfig).toHaveBeenCalledOnce();
    await fs.unlink(path.join(options.directory, resource.requiredFiles[0]));
    await fs.symlink('/etc/passwd', path.join(options.directory, resource.requiredFiles[0]));
    await expect(linkResourceInstallation(options)).rejects.toThrow('invalid');
  });
  it('reports a dead worker as interrupted and recovers its claim', async () => {
    const paths = resourceJobPaths(root(), 'internal-fixture', 'markers');
    await fs.mkdir(paths.lock, { recursive: true });
    const owner = { host: os.hostname(), pid: 2147483647, token: 'internal-dead-worker' };
    await atomicResourceJson(path.join(paths.lock, 'owner.json'), owner);
    await atomicResourceJson(paths.job, { owner, managedResource: true, state: 'running', pipelineId: 'internal-fixture', databaseId: 'markers' });
    expect(await job()).toMatchObject({ state: 'error', error: expect.stringContaining('interrupted') });
    const started = await startResourceInstallation(context(), dependencies()); await started.completion;
    expect(await job()).toMatchObject({ state: 'success' });
  });
  it('reports corrupt status without crashing the settings page and never reclaims an unknown owner', async () => {
    const paths = resourceJobPaths(root(), 'internal-fixture', 'markers');
    await fs.mkdir(paths.lock, { recursive: true });
    await fs.writeFile(paths.job, '{broken');
    expect(await job()).toMatchObject({ state: 'error', error: expect.stringContaining('cannot be read') });
    await expect(claimResourceJob(root(), 'internal-fixture', 'markers')).rejects.toMatchObject({ status: 409 });
    await atomicResourceJson(path.join(paths.lock, 'owner.json'), { host: os.hostname(), pid: 2147483647, token: '../../invalid' });
    await expect(claimResourceJob(root(), 'internal-fixture', 'markers')).rejects.toMatchObject({ status: 409 });
  });
});
