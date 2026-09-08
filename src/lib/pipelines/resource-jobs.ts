import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { PipelineDatabaseDownloadJobStatus } from './database-downloads';

export class ResourceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
interface Owner { token: string; pid: number; host: string }
export interface ResourceJob extends PipelineDatabaseDownloadJobStatus {
  managedResource: true;
  owner?: Owner;
  workingDirectory?: string;
}
function safeId(value: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value)) throw new ResourceError('Invalid resource identifier');
  return value;
}
export function resourceJobPaths(root: string, pipelineId: string, resourceId: string) {
  const dir = path.join(root, '.resource-jobs', safeId(pipelineId), safeId(resourceId));
  return { dir, job: path.join(dir, 'job.json'), lock: path.join(dir, 'lock') };
}
export async function atomicResourceJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, file);
  } finally { await fs.unlink(temporary).catch(() => {}); }
}
async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function validOwner(owner: Owner | null | undefined): owner is Owner {
  return Boolean(owner && typeof owner.host === 'string' && /^[A-Za-z0-9-]{1,120}$/.test(owner.token) && Number.isSafeInteger(owner.pid) && owner.pid > 0);
}
function definitelyDead(owner: Owner | undefined): boolean {
  if (!validOwner(owner) || owner.host !== os.hostname()) return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
}

/** Exclusive filesystem claim also serializes separate app workers. Unknown owners fail closed. */
export async function claimResourceJob(root: string, pipelineId: string, resourceId: string) {
  const paths = resourceJobPaths(root, pipelineId, resourceId);
  await fs.mkdir(paths.dir, { recursive: true, mode: 0o700 });
  const owner: Owner = { token: randomUUID(), pid: process.pid, host: os.hostname() };
  try { await fs.mkdir(paths.lock, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const previous = await readJson<Owner>(path.join(paths.lock, 'owner.json'));
    if (!validOwner(previous) || !definitelyDead(previous)) throw new ResourceError('Resource setup is already running (or its owner cannot safely be recovered)', 409);
    // Only one contender may recover a dead owner's claim.
    const reclaim = await fs.open(path.join(paths.lock, 'reclaim'), 'wx').catch(() => null);
    if (!reclaim) throw new ResourceError('Resource setup recovery is already running', 409);
    await reclaim.close();
    const current = await readJson<Owner>(path.join(paths.lock, 'owner.json'));
    if (current?.token !== previous.token) throw new ResourceError('Resource setup owner changed; retry', 409);
    const retired = path.join(paths.dir, `retired-${previous.token}-${owner.token}`);
    await fs.rename(paths.lock, retired);
    await fs.rm(retired, { recursive: true });
    try { await fs.mkdir(paths.lock, { mode: 0o700 }); }
    catch { throw new ResourceError('Resource setup was claimed by another request', 409); }
  }
  try {
    await atomicResourceJson(path.join(paths.lock, 'owner.json'), owner);
    await fs.writeFile(path.join(paths.lock, `running-${owner.token}`), owner.token, { flag: 'wx' });
  } catch (error) { await fs.rm(paths.lock, { recursive: true, force: true }); throw error; }
  return {
    paths, owner,
    async isCancelled() { return fs.access(path.join(paths.lock, `cancelled-${owner.token}`)).then(() => true, () => false); },
    async beginCommit() {
      try { await fs.rename(path.join(paths.lock, `running-${owner.token}`), path.join(paths.lock, `committing-${owner.token}`)); }
      catch { throw new ResourceError('Resource setup was cancelled before activation', 409); }
    },
    async release() {
      const current = await readJson<Owner>(path.join(paths.lock, 'owner.json'));
      if (current?.token === owner.token) await fs.rm(paths.lock, { recursive: true, force: true });
    },
  };
}

export async function readResourceJob(root: string, pipelineId: string, resourceId: string): Promise<ResourceJob | null> {
  const paths = resourceJobPaths(root, pipelineId, resourceId);
  let job: ResourceJob | null;
  try { job = await readJson<ResourceJob>(paths.job); }
  catch { return { managedResource: true, pipelineId, databaseId: resourceId, state: 'error', error: 'Database setup status cannot be read. Ask an administrator to inspect the resource job state.' }; }
  if (job && (!['running', 'success', 'error'].includes(job.state) || job.pipelineId !== pipelineId || job.databaseId !== resourceId)) {
    return { managedResource: true, pipelineId, databaseId: resourceId, state: 'error', error: 'Invalid database setup status. Ask an administrator to inspect the resource job state.' };
  }
  if (job?.state === 'running') {
    if (!validOwner(job.owner)) return { ...job, state: 'error', error: 'Database setup owner is unknown. Administrator review is required before retrying.' };
    if (definitelyDead(job.owner)) return { ...job, state: 'error', error: `Database setup was interrupted by an app restart. Review the configured database and retry setup. Temporary files may need administrator cleanup${job.workingDirectory ? ` at ${job.workingDirectory}` : ''}.` };
    const cancelled = await fs.access(path.join(paths.lock, `cancelled-${job.owner.token}`)).then(() => true, () => false);
    return { ...job, cancelled };
  }
  return job;
}

export async function readAllResourceJobs(root: string): Promise<ResourceJob[]> {
  const base = path.join(root, '.resource-jobs');
  const pipelines = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
  const result: ResourceJob[] = [];
  for (const entry of pipelines.filter(entry => entry.isDirectory())) {
    for (const resource of await fs.readdir(path.join(base, entry.name), { withFileTypes: true })) {
      if (!resource.isDirectory()) continue;
      const job = await readResourceJob(root, entry.name, resource.name);
      if (job) result.push(job);
    }
  }
  return result;
}

export async function cancelResourceJob(root: string, pipelineId: string, resourceId: string) {
  const paths = resourceJobPaths(root, pipelineId, resourceId);
  const job = await readResourceJob(root, pipelineId, resourceId);
  if (!job) throw new ResourceError('No resource setup job found', 404);
  if (job.state !== 'running') throw new ResourceError(`Cannot cancel job in state '${job.state}'`, 409);
  if (!validOwner(job.owner)) throw new ResourceError('Resource setup owner cannot be verified', 409);
  // Rename is the cancellation/commit linearization point. Never kill a saved PID.
  // Token-specific markers stop a delayed cancel from cancelling a newer attempt.
  try { await fs.rename(path.join(paths.lock, `running-${job.owner.token}`), path.join(paths.lock, `cancelled-${job.owner.token}`)); }
  catch {
    if (!await fs.access(path.join(paths.lock, `cancelled-${job.owner.token}`)).then(() => true, () => false)) throw new ResourceError('Resource setup is already being activated or has finished', 409);
  }
  return { cancelled: true, message: 'Cancellation requested. Temporary files will be removed before another setup can start.' };
}
