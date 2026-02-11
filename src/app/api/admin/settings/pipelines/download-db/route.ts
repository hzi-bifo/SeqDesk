import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { getExecutionSettings } from '@/lib/pipelines/execution-settings';
import { PIPELINE_REGISTRY } from '@/lib/pipelines';
import {
  buildPipelineDatabaseTargetPath,
  calculateProgressPercent,
  createDatabaseDownloadLogPath,
  getDatabaseDownloadJobStatus,
  getPipelineDatabaseDefinition,
  getPipelineDatabaseStatuses,
  updateDatabaseDownloadJobStatus,
  updateDatabaseDownloadRecord,
} from '@/lib/pipelines/database-downloads';
import { createWriteStream } from 'fs';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export const runtime = 'nodejs';

async function commandExists(command: string): Promise<boolean> {
  try {
    await execAsync(`command -v ${command}`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function commandSupportsOption(command: string, option: string): Promise<boolean> {
  try {
    const { stdout, stderr } = await execAsync(`${command} --help all`, {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    const output = `${stdout}\n${stderr}`;
    return output.includes(option);
  } catch {
    return false;
  }
}

async function resolveDownloader(): Promise<{
  command: string;
  args: (sourceUrl: string, targetPath: string) => string[];
}> {
  if (await commandExists('curl')) {
    const supportsRetryAllErrors = await commandSupportsOption('curl', '--retry-all-errors');
    return {
      command: 'curl',
      args: (sourceUrl: string, targetPath: string) => [
        '-L',
        '-C',
        '-',
        '--fail',
        '--retry',
        '8',
        '--retry-delay',
        '5',
        ...(supportsRetryAllErrors ? ['--retry-all-errors'] : []),
        '--connect-timeout',
        '30',
        '--speed-time',
        '60',
        '--speed-limit',
        '1024',
        '--output',
        targetPath,
        sourceUrl,
      ],
    };
  }

  if (await commandExists('wget')) {
    return {
      command: 'wget',
      args: (sourceUrl: string, targetPath: string) => [
        '-c',
        '--tries=8',
        '--waitretry=5',
        '--timeout=30',
        '-O',
        targetPath,
        sourceUrl,
      ],
    };
  }

  throw new Error('Neither curl nor wget is available on this server');
}

async function getRemoteContentLength(sourceUrl: string): Promise<number | undefined> {
  try {
    const response = await fetch(sourceUrl, { method: 'HEAD', cache: 'no-store' });
    if (!response.ok) return undefined;
    const header = response.headers.get('content-length');
    if (!header) return undefined;
    const parsed = Number.parseInt(header, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

async function getFileSize(targetPath: string): Promise<number> {
  try {
    const stats = await fs.stat(targetPath);
    return stats.size;
  } catch {
    return 0;
  }
}

function parsePipelineConfig(rawConfig: string | null | undefined): Record<string, unknown> {
  if (!rawConfig) return {};
  try {
    const parsed = JSON.parse(rawConfig);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore and use empty config
  }
  return {};
}

async function setPipelineDatabasePath(
  pipelineId: string,
  configKey: string,
  targetPath: string
): Promise<void> {
  const existing = await db.pipelineConfig.findUnique({
    where: { pipelineId },
    select: { enabled: true, config: true },
  });

  const defaults = PIPELINE_REGISTRY[pipelineId]?.defaultConfig || {};
  const config = {
    ...defaults,
    ...parsePipelineConfig(existing?.config),
    [configKey]: targetPath,
  };

  await db.pipelineConfig.upsert({
    where: { pipelineId },
    create: {
      pipelineId,
      enabled: existing?.enabled ?? true,
      config: JSON.stringify(config),
    },
    update: {
      config: JSON.stringify(config),
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'FACILITY_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { pipelineId, databaseId, replace } = body || {};

    if (!pipelineId || typeof pipelineId !== 'string') {
      return NextResponse.json({ error: 'Pipeline ID required' }, { status: 400 });
    }

    if (!databaseId || typeof databaseId !== 'string') {
      return NextResponse.json({ error: 'Database ID required' }, { status: 400 });
    }

    const database = getPipelineDatabaseDefinition(pipelineId, databaseId);
    if (!database) {
      return NextResponse.json(
        { error: `Database ${databaseId} is not defined for pipeline ${pipelineId}` },
        { status: 404 }
      );
    }

    const existingJob = await getDatabaseDownloadJobStatus(pipelineId, databaseId);
    if (existingJob?.state === 'running') {
      return NextResponse.json(
        { error: 'Database download already in progress', job: existingJob },
        { status: 409 }
      );
    }

    const executionSettings = await getExecutionSettings();
    if (!executionSettings.pipelineRunDir || executionSettings.pipelineRunDir === '/') {
      return NextResponse.json(
        { error: 'Pipeline run directory is not configured. Set it in Admin > Infrastructure.' },
        { status: 400 }
      );
    }

    const targetPath = buildPipelineDatabaseTargetPath(
      executionSettings.pipelineRunDir,
      pipelineId,
      databaseId,
      database.fileName
    );
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    if (replace === true) {
      await fs.rm(targetPath, { force: true });
    }

    const [downloader, totalBytes] = await Promise.all([
      resolveDownloader(),
      getRemoteContentLength(database.downloadUrl),
    ]);
    const localBytes = await getFileSize(targetPath);

    const hasCompleteExistingFile =
      replace !== true &&
      localBytes > 0 &&
      typeof totalBytes === 'number' &&
      totalBytes > 0 &&
      localBytes >= totalBytes;

    if (hasCompleteExistingFile) {
      await updateDatabaseDownloadRecord(pipelineId, databaseId, {
        version: database.version,
        path: targetPath,
        sourceUrl: database.downloadUrl,
        sizeBytes: localBytes,
      });
      await setPipelineDatabasePath(pipelineId, database.configKey, targetPath);
      await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
        state: 'success',
        sourceUrl: database.downloadUrl,
        targetPath,
        bytesDownloaded: localBytes,
        totalBytes,
        progressPercent: 100,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        error: undefined,
      });

      const pipelineConfigRecord = await db.pipelineConfig.findUnique({
        where: { pipelineId },
        select: { config: true },
      });
      const statuses = await getPipelineDatabaseStatuses(
        pipelineId,
        parsePipelineConfig(pipelineConfigRecord?.config),
        executionSettings.pipelineRunDir
      );

      return NextResponse.json({
        success: true,
        pipelineId,
        databaseId,
        alreadyPresent: true,
        database: statuses.find((entry) => entry.id === databaseId) || null,
      });
    }

    const logPath = await createDatabaseDownloadLogPath(pipelineId, databaseId);
    const logStream = createWriteStream(logPath, { flags: 'a' });
    logStream.write(
      `[${new Date().toISOString()}] Starting database download for ${pipelineId}/${databaseId}\n`
    );
    logStream.write(
      `[${new Date().toISOString()}] Command: ${downloader.command} ${downloader
        .args(database.downloadUrl, targetPath)
        .join(' ')}\n`
    );

    const startedAt = new Date().toISOString();
    await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
      state: 'running',
      sourceUrl: database.downloadUrl,
      targetPath,
      bytesDownloaded: localBytes,
      totalBytes,
      progressPercent: calculateProgressPercent(localBytes, totalBytes),
      startedAt,
      finishedAt: undefined,
      error: undefined,
      logPath,
      pid: undefined,
    });

    try {
      const child = spawn(downloader.command, downloader.args(database.downloadUrl, targetPath), {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      if (child.pid) {
        await updateDatabaseDownloadJobStatus(pipelineId, databaseId, { pid: child.pid });
      }

      if (child.stdout) child.stdout.pipe(logStream);
      if (child.stderr) child.stderr.pipe(logStream);

      const progressTimer = setInterval(() => {
        void (async () => {
          const bytesDownloaded = await getFileSize(targetPath);
          await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
            bytesDownloaded,
            totalBytes,
            progressPercent: calculateProgressPercent(bytesDownloaded, totalBytes),
          });
        })().catch(() => {
          // Best-effort progress update only.
        });
      }, 5000);

      child.on('error', async (error) => {
        clearInterval(progressTimer);
        try {
          await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
            state: 'error',
            finishedAt: new Date().toISOString(),
            error: error.message,
          });
        } catch {
          // If persisting status fails, we still close the log stream.
        }
        logStream.end();
      });

      child.on('close', async (code) => {
        clearInterval(progressTimer);
        try {
          const finishedAt = new Date().toISOString();
          if (code === 0) {
            const bytesDownloaded = await getFileSize(targetPath);
            await updateDatabaseDownloadRecord(pipelineId, databaseId, {
              version: database.version,
              path: targetPath,
              sourceUrl: database.downloadUrl,
              sizeBytes: bytesDownloaded,
            });
            await setPipelineDatabasePath(pipelineId, database.configKey, targetPath);
            await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
              state: 'success',
              finishedAt,
              bytesDownloaded,
              totalBytes,
              progressPercent: 100,
              error: undefined,
            });
          } else {
            const bytesDownloaded = await getFileSize(targetPath);
            const progressPercent = calculateProgressPercent(bytesDownloaded, totalBytes);
            const error =
              code === 18
                ? typeof totalBytes === 'number' && totalBytes > 0
                  ? `Download exited with code 18 (partial transfer ${bytesDownloaded}/${totalBytes} bytes). Re-run to resume.`
                  : 'Download exited with code 18 (partial transfer). Re-run to resume.'
                : `Download exited with code ${code}`;
            await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
              state: 'error',
              finishedAt,
              bytesDownloaded,
              totalBytes,
              progressPercent,
              error,
            });
          }
        } catch (handlerError) {
          await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
            state: 'error',
            finishedAt: new Date().toISOString(),
            error:
              handlerError instanceof Error
                ? handlerError.message
                : 'Failed to finalize database download',
          });
        }
        logStream.end();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start database download';
      await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
        state: 'error',
        finishedAt: new Date().toISOString(),
        error: message,
      });
      return NextResponse.json(
        { error: 'Failed to start database download', details: message },
        { status: 500 }
      );
    }

    const pipelineConfigRecord = await db.pipelineConfig.findUnique({
      where: { pipelineId },
      select: { config: true },
    });
    const statuses = await getPipelineDatabaseStatuses(
      pipelineId,
      parsePipelineConfig(pipelineConfigRecord?.config),
      executionSettings.pipelineRunDir
    );

    return NextResponse.json({
      success: true,
      pipelineId,
      databaseId,
      database: statuses.find((entry) => entry.id === databaseId) || null,
    });
  } catch (error) {
    console.error('[Pipeline DB Download] Failed:', error);
    return NextResponse.json(
      {
        error: 'Failed to download pipeline database',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
