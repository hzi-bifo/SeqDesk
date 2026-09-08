import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { PipelineResourceSchema, type PipelineResource } from './resource-schema';
import { atomicResourceJson, claimResourceJob, ResourceError, type ResourceJob } from './resource-jobs';
import { openResourceDownload, saveResourceAsset, extractResourceAsset, validateResourceDirectory, type ResourceFiles } from './resource-files';

export function resourceFingerprint(resource: PipelineResource) {
  return createHash('sha256').update(JSON.stringify(resource)).digest('hex');
}

export async function resourcePreflight(resource: PipelineResource, directory: string) {
  if (!path.isAbsolute(directory) || /[\x00-\x1f]/.test(directory) || [path.parse(directory).root, os.homedir(), process.cwd()].includes(path.resolve(directory))) throw new ResourceError('Choose a dedicated absolute database installation directory');
  let parent = path.resolve(directory), freeBytes: number | null = null;
  for (;;) {
    try {
      const stats = await fs.stat(parent);
      if (!stats.isDirectory()) throw new ResourceError('Installation parent must be a directory, not a file');
      const space = await fs.statfs(parent);
      freeBytes = space.bavail * space.bsize;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const next = path.dirname(parent);
      if (next === parent) break;
      parent = next;
    }
  }
  const expectedBytes = resource.assets.reduce((sum, asset) => sum + asset.bytes, 0);
  const requiredBytes = expectedBytes + resource.maxExtractedBytes + 1024 ** 3;
  return {
    managedResource: true, sourceUrl: resource.assets[0].url, assets: resource.assets,
    targetPath: path.resolve(directory), parentDir: path.resolve(directory), expectedBytes, requiredBytes,
    freeBytes, partialBytes: 0, remainingBytes: requiredBytes,
    sufficient: freeBytes !== null && Number.isFinite(freeBytes) && freeBytes >= requiredBytes,
    hasSha256: resource.assets.every(asset => asset.checksum.algorithm === 'sha256'),
    error: freeBytes === null ? 'Could not determine free disk space' : null,
  };
}

interface InstallContext {
  root: string;
  pipelineId: string;
  resource: PipelineResource;
  /** This is a parent directory; no existing file or installation is overwritten. */
  directory: string;
  limitRate?: string;
  applyConfig: (directory: string) => Promise<void>;
}
interface InstallDependencies {
  open?: typeof openResourceDownload;
  preflight?: typeof resourcePreflight;
}

/** Returns after a durable claim, not after a multi-hour download. */
export async function startResourceInstallation(context: InstallContext, dependencies: InstallDependencies = {}) {
  const resource = PipelineResourceSchema.parse(context.resource);
  let bytesPerSecond: number | undefined;
  if (context.limitRate) {
    const match = /^(\d+)([KMG]?)$/i.exec(context.limitRate);
    bytesPerSecond = match ? Number(match[1]) * 1024 ** ('KMG'.indexOf(match[2].toUpperCase()) + 1) : NaN;
    // Empty suffix has exponent zero, not indexOf('') + 1.
    if (match && !match[2]) bytesPerSecond = Number(match[1]);
    if (!Number.isSafeInteger(bytesPerSecond) || bytesPerSecond <= 0) throw new ResourceError('Invalid bandwidth limit');
  }
  const claim = await claimResourceJob(context.root, context.pipelineId, resource.id);
  let working: string | undefined;
  try {
    const preflight = await (dependencies.preflight ?? resourcePreflight)(resource, context.directory);
    if (!preflight.sufficient) throw new ResourceError(preflight.error || 'Insufficient disk space for download and extraction', 400);
    await fs.mkdir(context.directory, { recursive: true });
    const parent = await fs.realpath(context.directory);
    working = await fs.mkdtemp(path.join(parent, '.seqdesk-resource-'));
    await fs.chmod(working, 0o700);
    const output = path.join(working, 'database');
    await fs.mkdir(output, { mode: 0o700 });
    const installed = path.join(parent, `${resource.version}-${claim.owner.token}`);
    let job: ResourceJob = {
      managedResource: true, owner: claim.owner, pipelineId: context.pipelineId, databaseId: resource.id,
      state: 'running', phase: 'downloading', sourceUrl: resource.assets[0].url, targetPath: installed,
      workingDirectory: working,
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      bytesDownloaded: 0, totalBytes: preflight.expectedBytes, progressPercent: 0, limitRate: context.limitRate,
    };
    await atomicResourceJson(claim.paths.job, job);
    const attempt = working;
    const controller = new AbortController();
    let writeTail = Promise.resolve();
    const write = (update: Partial<ResourceJob>) => {
      job = { ...job, ...update, updatedAt: new Date().toISOString() };
      const snapshot = job;
      writeTail = writeTail.then(() => atomicResourceJson(claim.paths.job, snapshot));
      return writeTail;
    };
    let polling = false;
    const cancellation = setInterval(() => {
      if (polling) return;
      polling = true;
      void claim.isCancelled().then(cancelled => {
        if (cancelled) controller.abort(new Error('Database setup cancelled by user'));
      }).catch(error => controller.abort(error)).finally(() => { polling = false; });
    }, 500);
    const completion = (async () => {
      let published = false;
      try {
        const receipts = [];
        let previousBytes = 0, lastUpdate = 0;
        const files: ResourceFiles = {};
        const budget = { bytes: 0 };
        for (const asset of resource.assets) {
          controller.signal.throwIfAborted();
          await write({ phase: 'downloading' });
          const archive = path.join(attempt, asset.fileName);
          const stream = await (dependencies.open ?? openResourceDownload)(asset.url, controller.signal);
          receipts.push(await saveResourceAsset(stream, asset, archive, controller.signal, bytes => {
            if (Date.now() - lastUpdate < 1000) return;
            lastUpdate = Date.now();
            void write({ bytesDownloaded: previousBytes + bytes, progressPercent: (previousBytes + bytes) / preflight.expectedBytes * 100 })
              .catch(error => controller.abort(error));
          }, bytesPerSecond));
          previousBytes += asset.bytes;
          await write({ phase: 'installing', bytesDownloaded: previousBytes, progressPercent: previousBytes / preflight.expectedBytes * 100 });
          await extractResourceAsset(archive, asset, resource, output, controller.signal, files, budget);
          await fs.unlink(archive);
        }
        await write({ phase: 'verifying' });
        await validateResourceDirectory(resource, output);
        await atomicResourceJson(path.join(output, '.seqdesk-resource.json'), {
          resource: resource.id, version: resource.version, fingerprint: resourceFingerprint(resource),
          installedAt: new Date().toISOString(), assets: receipts, files,
        });
        controller.signal.throwIfAborted();
        await claim.beginCommit();
        clearInterval(cancellation);
        // Immutable destination; the old installation is retained for existing runs.
        await fs.rename(output, installed);
        published = true;
        await context.applyConfig(installed);
        await write({ state: 'success', phase: undefined, progressPercent: 100, finishedAt: new Date().toISOString() });
      } catch (error) {
        // Once published, retain the validated directory even if config persistence
        // fails; an administrator can link it. Never remove a possibly active DB.
        const cancelled = await claim.isCancelled();
        await writeTail.catch(() => {});
        writeTail = Promise.resolve();
        await write({ state: 'error', phase: undefined, cancelled,
          error: `${error instanceof Error ? error.message : 'Resource setup failed'}${published ? ' Verified files are retained at the target path; review the configuration or link this directory.' : ''}`,
          finishedAt: new Date().toISOString() });
      } finally {
        clearInterval(cancellation);
        try { await fs.rm(attempt, { recursive: true, force: true }); }
        catch {
          await writeTail.catch(() => {}); writeTail = Promise.resolve();
          await write({ state: 'error', error: `Setup cleanup failed. Temporary files remain in ${attempt}; any existing database configuration is retained.`, finishedAt: new Date().toISOString() });
        } finally { await claim.release(); }
      }
    })();
    // The process owns the worker; restart is detected by the durable claim.
    // Explicitly consume rejections so a filesystem error cannot crash the app.
    void completion.catch(error => console.error('Resource setup worker failed:', error instanceof Error ? error.message : 'Unknown error'));
    return { started: true, job, completion };
  } catch (error) {
    try { if (working) await fs.rm(working, { recursive: true, force: true }); }
    finally { await claim.release(); }
    throw error;
  }
}

export async function linkResourceInstallation(context: Omit<InstallContext, 'limitRate'>) {
  const claim = await claimResourceJob(context.root, context.pipelineId, context.resource.id);
  try {
    const verified = await validateResourceDirectory(context.resource, context.directory);
    await claim.beginCommit();
    await context.applyConfig(context.directory);
    await atomicResourceJson(claim.paths.job, {
      managedResource: true, owner: claim.owner, pipelineId: context.pipelineId, databaseId: context.resource.id,
      state: 'success', targetPath: context.directory, progressPercent: 100,
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    } satisfies ResourceJob);
    return { success: true, path: context.directory, sizeBytes: verified.bytes, verification: 'Required file layout checked. Publisher archive checksums are not verified for linked directories.' };
  } finally { await claim.release(); }
}
