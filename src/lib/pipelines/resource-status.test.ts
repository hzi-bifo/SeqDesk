import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { PipelineResourceSchema } from './resource-schema';
import { resourceFingerprint } from './resource-installer';
import { getPipelineDatabaseDefinitions, getPipelineDatabaseStatuses } from './database-downloads';

const state = vi.hoisted(() => ({ root: '', resource: {} as unknown }));
vi.mock('./package-loader', () => ({ getPipelinesDir: () => state.root, getPackage: () => ({ manifest: { resources: [state.resource] } }) }));
const resource = PipelineResourceSchema.parse({ id: 'markers', label: 'Internal fixture', version: 'v1', type: 'archive-set',
  assets: [{ fileName: 'fixture.tar', url: 'https://example.org/fixture.tar', bytes: 1024, format: 'tar', checksum: { algorithm: 'sha256', value: '0'.repeat(64) } }],
  requiredFiles: ['index'], maxExtractedBytes: 4096, config: { pathKey: 'dbDirectory', values: { index: 'pinned' } } });
let directory: string;
beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'seqdesk-resource-status-'));
  state.resource = resource;
  directory = path.join(state.root, 'existing'); await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'index'), 'data');
});
afterEach(async () => { await fs.rm(state.root, { recursive: true, force: true }); });
const status = async (values: Record<string, unknown> = {}) => (await getPipelineDatabaseStatuses('fixture', { dbDirectory: directory, index: 'pinned', ...values }, '/runs'))[0];

it('exposes package resources in the existing database setup model', () => {
  expect(getPipelineDatabaseDefinitions('fixture')[0]).toMatchObject({ id: 'markers', configKey: 'dbDirectory', resource });
});
it('checks linked files without claiming publisher checksums were verified', async () => {
  expect(await status()).toMatchObject({ status: 'downloaded', managedResource: true, sizeBytes: 4, detail: expect.stringContaining('have not been verified') });
});
it('does not equate a downloaded archive with an installed database', async () => {
  expect(await status({ dbDirectory: path.join(directory, 'index') })).toMatchObject({ status: 'missing', detail: expect.stringContaining('real directory') });
});
it('does not accept a mismatched configured version', async () => {
  expect(await status({ index: 'wrong' })).toMatchObject({ status: 'missing', detail: expect.stringContaining('version') });
});
it('detects missing and empty files', async () => {
  await fs.truncate(path.join(directory, 'index'), 0);
  expect(await status()).toMatchObject({ status: 'missing' });
  await fs.unlink(path.join(directory, 'index'));
  expect(await status()).toMatchObject({ status: 'missing' });
});
it('checks receipts for the pinned manifest and notices changed file sizes', async () => {
  const receipt = { fingerprint: resourceFingerprint(resource), files: { index: { bytes: 4 } } };
  await fs.writeFile(path.join(directory, '.seqdesk-resource.json'), JSON.stringify(receipt));
  expect(await status()).toMatchObject({ status: 'downloaded', detail: expect.stringContaining('checksum-verified') });
  await fs.appendFile(path.join(directory, 'index'), 'changed');
  expect(await status()).toMatchObject({ status: 'missing', detail: expect.stringContaining('no longer match') });
});
it('rejects symlink directories even with a trailing slash', async () => {
  const link = path.join(state.root, 'link'); await fs.symlink(directory, link);
  expect(await status({ dbDirectory: link + '/' })).toMatchObject({ status: 'missing', detail: expect.stringContaining('symlink') });
});
