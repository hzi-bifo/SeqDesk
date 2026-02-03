import fs from 'fs';
import os from 'os';
import path from 'path';
import { getPipelinesDir } from './package-loader';

const DOWNLOAD_INDEX_FILE = '.pipeline-downloads.json';
const DOWNLOAD_STATUS_FILE = '.pipeline-download-status.json';
const DOWNLOAD_LOG_DIR = '.pipeline-download-logs';

export interface PipelineDownloadRecord {
  pipeline: string;
  version?: string;
  path?: string;
  source?: string;
  updatedAt: string;
}

export interface PipelineDownloadJobStatus {
  pipelineId: string;
  state: 'running' | 'success' | 'error';
  pipelineRef?: string;
  requestedVersion?: string;
  resolvedVersion?: string;
  source?: string;
  pid?: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  logPath?: string;
}

export interface PipelineDownloadStatus {
  status: 'downloaded' | 'missing' | 'unsupported';
  version?: string;
  expectedVersion?: string;
  path?: string;
  lastUpdated?: string;
  detail?: string;
  job?: PipelineDownloadJobStatus | null;
}

interface PipelineDownloadIndex {
  [pipelineId: string]: PipelineDownloadRecord | undefined;
}

interface PipelineDownloadStatusIndex {
  [pipelineId: string]: PipelineDownloadJobStatus | undefined;
}

function getDownloadIndexPath(): string {
  return path.join(getPipelinesDir(), DOWNLOAD_INDEX_FILE);
}

function getDownloadStatusPath(): string {
  return path.join(getPipelinesDir(), DOWNLOAD_STATUS_FILE);
}

export function getDownloadLogDir(): string {
  return path.join(getPipelinesDir(), DOWNLOAD_LOG_DIR);
}

async function readDownloadIndex(): Promise<PipelineDownloadIndex> {
  const indexPath = getDownloadIndexPath();
  try {
    const content = await fs.promises.readFile(indexPath, 'utf8');
    return JSON.parse(content) as PipelineDownloadIndex;
  } catch {
    return {};
  }
}

async function writeDownloadIndex(index: PipelineDownloadIndex): Promise<void> {
  const indexPath = getDownloadIndexPath();
  await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2));
}

async function readDownloadStatusIndex(): Promise<PipelineDownloadStatusIndex> {
  const statusPath = getDownloadStatusPath();
  try {
    const content = await fs.promises.readFile(statusPath, 'utf8');
    return JSON.parse(content) as PipelineDownloadStatusIndex;
  } catch {
    return {};
  }
}

async function writeDownloadStatusIndex(index: PipelineDownloadStatusIndex): Promise<void> {
  const statusPath = getDownloadStatusPath();
  await fs.promises.mkdir(path.dirname(statusPath), { recursive: true });
  await fs.promises.writeFile(statusPath, JSON.stringify(index, null, 2));
}

export async function getDownloadJobStatus(
  pipelineId: string
): Promise<PipelineDownloadJobStatus | null> {
  const index = await readDownloadStatusIndex();
  return index[pipelineId] || null;
}

export async function updateDownloadJobStatus(
  pipelineId: string,
  update: Partial<PipelineDownloadJobStatus>
): Promise<PipelineDownloadJobStatus> {
  const index = await readDownloadStatusIndex();
  const existing = index[pipelineId];
  const merged: PipelineDownloadJobStatus = {
    pipelineId,
    state: existing?.state || 'running',
    ...existing,
    ...update,
  };
  index[pipelineId] = merged;
  await writeDownloadStatusIndex(index);
  return merged;
}

export async function clearDownloadJobStatus(pipelineId: string): Promise<void> {
  const index = await readDownloadStatusIndex();
  if (index[pipelineId]) {
    delete index[pipelineId];
    await writeDownloadStatusIndex(index);
  }
}

export async function createDownloadLogPath(pipelineId: string): Promise<string> {
  const logDir = getDownloadLogDir();
  await fs.promises.mkdir(logDir, { recursive: true });
  return path.join(logDir, `${pipelineId}-${Date.now()}.log`);
}

export async function updateDownloadRecord(
  pipelineId: string,
  record: Omit<PipelineDownloadRecord, 'updatedAt'> & { updatedAt?: string }
): Promise<PipelineDownloadRecord> {
  const index = await readDownloadIndex();
  const updated: PipelineDownloadRecord = {
    ...index[pipelineId],
    ...record,
    updatedAt: record.updatedAt || new Date().toISOString(),
  } as PipelineDownloadRecord;

  index[pipelineId] = updated;
  await writeDownloadIndex(index);
  return updated;
}

export function getNextflowHome(): string {
  return process.env.NXF_HOME || path.join(os.homedir(), '.nextflow');
}

export function getNextflowAssetsDir(): string {
  return process.env.NXF_ASSETS || path.join(getNextflowHome(), 'assets');
}

export function resolvePipelineAssetsPath(
  pipelineRef: string
): { kind: 'remote'; path: string } | { kind: 'local' | 'unsupported'; reason: string } {
  const trimmed = pipelineRef?.trim();

  if (!trimmed) {
    return { kind: 'unsupported', reason: 'Missing pipeline reference' };
  }

  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return { kind: 'local', reason: 'Local pipeline path' };
  }

  if (trimmed.includes('://') || trimmed.startsWith('git@')) {
    return { kind: 'unsupported', reason: 'Remote pipeline URL' };
  }

  const parts = trimmed.split('/').filter(Boolean);
  if (parts.length >= 2) {
    const [org, repo] = parts;
    return { kind: 'remote', path: path.join(getNextflowAssetsDir(), org, repo) };
  }

  return { kind: 'remote', path: path.join(getNextflowAssetsDir(), trimmed) };
}

export async function readNextflowManifestVersion(
  assetsPath: string
): Promise<string | null> {
  const configPath = path.join(assetsPath, 'nextflow.config');
  try {
    const content = await fs.promises.readFile(configPath, 'utf8');
    const match = content.match(/manifest\.version\s*=\s*['\"]([^'\"]+)['\"]/);
    if (match?.[1]) {
      return match[1].trim();
    }
  } catch {
    return null;
  }
  return null;
}

export async function getPipelineDownloadStatus(
  pipelineId: string,
  pipelineRef: string,
  expectedVersion?: string
): Promise<PipelineDownloadStatus> {
  const assetsInfo = resolvePipelineAssetsPath(pipelineRef);
  const job = await getDownloadJobStatus(pipelineId);

  if (assetsInfo.kind !== 'remote') {
    return {
      status: 'unsupported',
      expectedVersion,
      detail: assetsInfo.reason,
      job,
    };
  }

  const recordIndex = await readDownloadIndex();
  const record = recordIndex[pipelineId];

  try {
    await fs.promises.access(assetsInfo.path);
  } catch {
    return {
      status: 'missing',
      expectedVersion,
      path: assetsInfo.path,
      lastUpdated: record?.updatedAt,
      job,
    };
  }

  const detectedVersion = await readNextflowManifestVersion(assetsInfo.path);

  return {
    status: 'downloaded',
    expectedVersion,
    version: detectedVersion || record?.version,
    path: assetsInfo.path,
    lastUpdated: record?.updatedAt,
    job,
  };
}
