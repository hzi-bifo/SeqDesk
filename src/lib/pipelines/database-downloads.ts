import fs from 'fs';
import path from 'path';
import { getPipelinesDir } from './package-loader';

const DB_DOWNLOAD_INDEX_FILE = '.pipeline-database-downloads.json';
const DB_DOWNLOAD_STATUS_FILE = '.pipeline-database-download-status.json';
const DB_DOWNLOAD_LOG_DIR = '.pipeline-database-download-logs';

export interface PipelineDatabaseDefinition {
  id: string;
  label: string;
  description?: string;
  version?: string;
  fileName: string;
  downloadUrl: string;
  configKey: string;
}

export interface PipelineDatabaseDownloadRecord {
  pipelineId: string;
  databaseId: string;
  version?: string;
  path?: string;
  sourceUrl?: string;
  sizeBytes?: number;
  updatedAt: string;
}

export interface PipelineDatabaseDownloadJobStatus {
  pipelineId: string;
  databaseId: string;
  state: 'running' | 'success' | 'error';
  sourceUrl?: string;
  targetPath?: string;
  pid?: number;
  bytesDownloaded?: number;
  totalBytes?: number;
  progressPercent?: number | null;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  logPath?: string;
}

export interface PipelineDatabaseStatus {
  id: string;
  label: string;
  description?: string;
  version?: string;
  configKey: string;
  status: 'downloaded' | 'missing';
  path?: string;
  expectedPath?: string;
  configuredPath?: string;
  sourceUrl?: string;
  sizeBytes?: number;
  lastUpdated?: string;
  detail?: string;
  job?: PipelineDatabaseDownloadJobStatus | null;
}

interface PipelineDatabaseDownloadIndex {
  [key: string]: PipelineDatabaseDownloadRecord | undefined;
}

interface PipelineDatabaseDownloadStatusIndex {
  [key: string]: PipelineDatabaseDownloadJobStatus | undefined;
}

const PIPELINE_DATABASES: Record<string, PipelineDatabaseDefinition[]> = {
  mag: [
    {
      id: 'gtdb',
      label: 'GTDB-Tk Database',
      description: 'GTDB-Tk reference data for taxonomy classification',
      version: '214.1',
      fileName: 'gtdbtk_r214_data.tar.gz',
      downloadUrl:
        'https://data.ace.uq.edu.au/public/gtdb/data/releases/release214/214.1/auxillary_files/gtdbtk_r214_data.tar.gz',
      configKey: 'gtdbDb',
    },
  ],
};

function getRecordKey(pipelineId: string, databaseId: string): string {
  return `${pipelineId}:${databaseId}`;
}

function getDbDownloadIndexPath(): string {
  return path.join(getPipelinesDir(), DB_DOWNLOAD_INDEX_FILE);
}

function getDbDownloadStatusPath(): string {
  return path.join(getPipelinesDir(), DB_DOWNLOAD_STATUS_FILE);
}

export function getDatabaseDownloadLogDir(): string {
  return path.join(getPipelinesDir(), DB_DOWNLOAD_LOG_DIR);
}

async function readDownloadIndex(): Promise<PipelineDatabaseDownloadIndex> {
  const indexPath = getDbDownloadIndexPath();
  try {
    const content = await fs.promises.readFile(indexPath, 'utf8');
    return JSON.parse(content) as PipelineDatabaseDownloadIndex;
  } catch {
    return {};
  }
}

async function writeDownloadIndex(index: PipelineDatabaseDownloadIndex): Promise<void> {
  const indexPath = getDbDownloadIndexPath();
  await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2));
}

async function readDownloadStatusIndex(): Promise<PipelineDatabaseDownloadStatusIndex> {
  const indexPath = getDbDownloadStatusPath();
  try {
    const content = await fs.promises.readFile(indexPath, 'utf8');
    return JSON.parse(content) as PipelineDatabaseDownloadStatusIndex;
  } catch {
    return {};
  }
}

async function writeDownloadStatusIndex(
  index: PipelineDatabaseDownloadStatusIndex
): Promise<void> {
  const statusPath = getDbDownloadStatusPath();
  await fs.promises.mkdir(path.dirname(statusPath), { recursive: true });
  await fs.promises.writeFile(statusPath, JSON.stringify(index, null, 2));
}

async function getPathSize(targetPath?: string): Promise<number | undefined> {
  if (!targetPath) return undefined;
  try {
    const stats = await fs.promises.stat(targetPath);
    return stats.size;
  } catch {
    return undefined;
  }
}

function normalizeConfiguredPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function parseExpectedSize(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function getExpectedSizeForCandidate(
  candidate: string,
  record: PipelineDatabaseDownloadRecord | undefined,
  job: PipelineDatabaseDownloadJobStatus | null
): number | undefined {
  const expectations: Array<number | undefined> = [];

  if (record?.path === candidate) {
    expectations.push(parseExpectedSize(record.sizeBytes));
  }

  if (job?.targetPath === candidate) {
    expectations.push(parseExpectedSize(job.totalBytes));
  }

  return expectations.find((value) => typeof value === 'number');
}

export function getPipelineDatabaseDefinitions(pipelineId: string): PipelineDatabaseDefinition[] {
  return PIPELINE_DATABASES[pipelineId] || [];
}

export function getPipelineDatabaseDefinition(
  pipelineId: string,
  databaseId: string
): PipelineDatabaseDefinition | null {
  const definition = getPipelineDatabaseDefinitions(pipelineId).find((entry) => entry.id === databaseId);
  return definition || null;
}

export function buildPipelineDatabaseRoot(pipelineRunDir: string): string {
  return path.join(path.resolve(pipelineRunDir), 'databases');
}

export function buildPipelineDatabaseTargetPath(
  pipelineRunDir: string,
  pipelineId: string,
  databaseId: string,
  fileName: string
): string {
  return path.join(buildPipelineDatabaseRoot(pipelineRunDir), pipelineId, databaseId, fileName);
}

export function calculateProgressPercent(
  bytesDownloaded: number | undefined,
  totalBytes: number | undefined
): number | null {
  if (typeof bytesDownloaded !== 'number' || !Number.isFinite(bytesDownloaded)) {
    return null;
  }
  if (typeof totalBytes !== 'number' || !Number.isFinite(totalBytes) || totalBytes <= 0) {
    return null;
  }
  const percent = (bytesDownloaded / totalBytes) * 100;
  return Math.max(0, Math.min(100, Math.round(percent * 10) / 10));
}

export async function getDatabaseDownloadJobStatus(
  pipelineId: string,
  databaseId: string
): Promise<PipelineDatabaseDownloadJobStatus | null> {
  const index = await readDownloadStatusIndex();
  return index[getRecordKey(pipelineId, databaseId)] || null;
}

export async function updateDatabaseDownloadJobStatus(
  pipelineId: string,
  databaseId: string,
  update: Partial<PipelineDatabaseDownloadJobStatus>
): Promise<PipelineDatabaseDownloadJobStatus> {
  const key = getRecordKey(pipelineId, databaseId);
  const index = await readDownloadStatusIndex();
  const existing = index[key];
  const merged: PipelineDatabaseDownloadJobStatus = {
    pipelineId,
    databaseId,
    state: existing?.state || 'running',
    ...existing,
    ...update,
  };
  index[key] = merged;
  await writeDownloadStatusIndex(index);
  return merged;
}

export async function createDatabaseDownloadLogPath(
  pipelineId: string,
  databaseId: string
): Promise<string> {
  const logDir = getDatabaseDownloadLogDir();
  await fs.promises.mkdir(logDir, { recursive: true });
  return path.join(logDir, `${pipelineId}-${databaseId}-${Date.now()}.log`);
}

export async function updateDatabaseDownloadRecord(
  pipelineId: string,
  databaseId: string,
  record: Omit<PipelineDatabaseDownloadRecord, 'updatedAt' | 'pipelineId' | 'databaseId'> & {
    updatedAt?: string;
  }
): Promise<PipelineDatabaseDownloadRecord> {
  const key = getRecordKey(pipelineId, databaseId);
  const index = await readDownloadIndex();
  const updated: PipelineDatabaseDownloadRecord = {
    ...index[key],
    ...record,
    pipelineId,
    databaseId,
    updatedAt: record.updatedAt || new Date().toISOString(),
  } as PipelineDatabaseDownloadRecord;

  index[key] = updated;
  await writeDownloadIndex(index);
  return updated;
}

export async function getPipelineDatabaseStatuses(
  pipelineId: string,
  pipelineConfig: Record<string, unknown>,
  pipelineRunDir?: string
): Promise<PipelineDatabaseStatus[]> {
  const definitions = getPipelineDatabaseDefinitions(pipelineId);
  if (definitions.length === 0) return [];

  const [recordIndex, statusIndex] = await Promise.all([
    readDownloadIndex(),
    readDownloadStatusIndex(),
  ]);

  const statuses = await Promise.all(
    definitions.map(async (definition) => {
      const key = getRecordKey(pipelineId, definition.id);
      const record = recordIndex[key];
      const job = statusIndex[key] || null;
      const configuredPath = normalizeConfiguredPath(pipelineConfig[definition.configKey]);
      const expectedPath = pipelineRunDir
        ? buildPipelineDatabaseTargetPath(
            pipelineRunDir,
            pipelineId,
            definition.id,
            definition.fileName
          )
        : undefined;

      const candidates = uniqueStrings([configuredPath, record?.path, expectedPath]);

      let detectedPath: string | undefined;
      let detectedSizeBytes: number | undefined;
      let partialDetail: string | undefined;
      for (const candidate of candidates) {
        const sizeBytes = await getPathSize(candidate);
        if (typeof sizeBytes !== 'number') continue;

        const expectedSize = getExpectedSizeForCandidate(candidate, record, job);
        if (typeof expectedSize === 'number' && sizeBytes < expectedSize) {
          partialDetail = `Partial download detected (${sizeBytes}/${expectedSize} bytes). Re-run download to resume.`;
          continue;
        }

        detectedPath = candidate;
        detectedSizeBytes = sizeBytes;
        break;
      }

      const status: PipelineDatabaseStatus = {
        id: definition.id,
        label: definition.label,
        description: definition.description,
        version: record?.version || definition.version,
        configKey: definition.configKey,
        status: detectedPath ? 'downloaded' : 'missing',
        path: detectedPath || undefined,
        expectedPath,
        configuredPath,
        sourceUrl: record?.sourceUrl || definition.downloadUrl,
        sizeBytes: detectedSizeBytes ?? record?.sizeBytes,
        lastUpdated: record?.updatedAt,
        detail: !detectedPath
          ? partialDetail ||
            (configuredPath
              ? 'Configured database path does not exist'
              : 'Database not downloaded')
          : undefined,
        job,
      };

      return status;
    })
  );

  return statuses;
}
