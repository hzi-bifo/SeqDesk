import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { getExecutionSettings } from '@/lib/pipelines/execution-settings';
import { PIPELINE_REGISTRY } from '@/lib/pipelines';
import {
  buildPipelineDatabaseInstallDir,
  buildPipelineDatabaseTargetPath,
  calculateProgressPercent,
  createDatabaseDownloadLogPath,
  getDatabaseDownloadJobStatus,
  getPipelineDatabaseDefinition,
  getPipelineDatabaseStatuses,
  updateDatabaseDownloadJobStatus,
  updateDatabaseDownloadRecord,
} from '@/lib/pipelines/database-downloads';
import { createWriteStream, createReadStream } from 'fs';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import type { WriteStream } from 'fs';
import path from 'path';
import crypto from 'crypto';

const LIMIT_RATE_REGEX = /^\d+[KMG]?$/i;

function normalizeLimitRate(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (!LIMIT_RATE_REGEX.test(trimmed)) return undefined;
  return trimmed;
}

function buildDownloadExitError(args: {
  command: string;
  code: number | null;
  bytesDownloaded: number;
  totalBytes?: number;
  label: string;
  logPath: string;
}): string {
  const { command, code, bytesDownloaded, totalBytes, label, logPath } = args;
  if (code === 18) {
    return typeof totalBytes === 'number' && totalBytes > 0
      ? `${command} stopped with code 18 while downloading ${label}: partial transfer ${bytesDownloaded}/${totalBytes} bytes. Re-run to resume. Log: ${logPath}`
      : `${command} stopped with code 18 while downloading ${label}: partial transfer. Re-run to resume. Log: ${logPath}`;
  }
  if (code === null) {
    return `${command} stopped before reporting an exit code while downloading ${label}. Check the server log: ${logPath}`;
  }
  return `${command} failed with exit code ${code} while downloading ${label}. Check network access, permissions for the target directory, and the server log: ${logPath}`;
}

async function computeFileSha256(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

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
  args: (sourceUrl: string, targetPath: string, limitRate?: string) => string[];
}> {
  if (await commandExists('curl')) {
    const supportsRetryAllErrors = await commandSupportsOption('curl', '--retry-all-errors');
    return {
      command: 'curl',
      args: (sourceUrl: string, targetPath: string, limitRate?: string) => [
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
        ...(limitRate ? ['--limit-rate', limitRate] : []),
        '--output',
        targetPath,
        sourceUrl,
      ],
    };
  }

  if (await commandExists('wget')) {
    return {
      command: 'wget',
      args: (sourceUrl: string, targetPath: string, limitRate?: string) => [
        '-c',
        '--tries=8',
        '--waitretry=5',
        '--timeout=30',
        ...(limitRate ? [`--limit-rate=${limitRate}`] : []),
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

async function getFileSizeOrUndefined(targetPath: string): Promise<number | undefined> {
  try {
    const stats = await fs.stat(targetPath);
    return stats.size;
  } catch {
    return undefined;
  }
}

function getMetaxPathInstallerPath(): string {
  return path.join(
    process.cwd(),
    'pipelines',
    'metaxpath',
    'workflow',
    'scripts',
    'install_db_bundle.sh'
  );
}

async function installDatabaseIfNeeded(
  pipelineRunDir: string,
  pipelineId: string,
  databaseId: string,
  archivePath: string,
  database: NonNullable<ReturnType<typeof getPipelineDatabaseDefinition>>,
  databaseDirectory?: string,
  logStream?: WriteStream,
  installDirOverride?: string
): Promise<{ runtimePath: string; sizeBytes: number }> {
  if (database.install?.type !== 'metaxpath_db_bundle') {
    return {
      runtimePath: archivePath,
      sizeBytes: await getFileSize(archivePath),
    };
  }

  const installerPath = getMetaxPathInstallerPath();
  try {
    await fs.access(installerPath);
  } catch {
    throw new Error(
      `MetaxPath DB installer not found at ${installerPath}. Install or update the private MetaxPath pipeline package first.`
    );
  }

  const installDir =
    installDirOverride ||
    buildPipelineDatabaseInstallDir(
      pipelineRunDir,
      pipelineId,
      databaseId,
      databaseDirectory
    );
  await fs.mkdir(installDir, { recursive: true });

  const args = [
    installerPath,
    '--archive',
    archivePath,
    '--skip-download',
    '--dest',
    installDir,
    '--force',
  ];
  logStream?.write(
    `[${new Date().toISOString()}] Installing database bundle: bash ${args.join(' ')}\n`
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn('bash', args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (child.stdout && logStream) child.stdout.pipe(logStream, { end: false });
    if (child.stderr && logStream) child.stderr.pipe(logStream, { end: false });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`MetaxPath database installer exited with code ${code}`));
      }
    });
  });

  const paramsPath = path.join(installDir, database.install.paramsFileName);
  const sizeBytes = await getFileSizeOrUndefined(paramsPath);
  if (typeof sizeBytes !== 'number') {
    throw new Error(
      `MetaxPath database installer did not create ${database.install.paramsFileName}`
    );
  }

  return {
    runtimePath: paramsPath,
    sizeBytes,
  };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'FACILITY_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      pipelineId,
      databaseId,
      replace,
      targetPath: customTargetPath,
      limitRate: rawLimitRate,
    } = body || {};
    const limitRate = normalizeLimitRate(rawLimitRate);
    if (rawLimitRate && !limitRate) {
      return NextResponse.json(
        {
          error:
            "Invalid bandwidth limit. Use a number with optional K/M/G suffix (e.g. '10M', '512K').",
        },
        { status: 400 }
      );
    }

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

    let targetPath: string;
    let installDirOverride: string | undefined;
    const trimmedCustomPath =
      typeof customTargetPath === 'string' ? customTargetPath.trim() : '';
    if (trimmedCustomPath.length > 0) {
      if (!path.isAbsolute(trimmedCustomPath)) {
        return NextResponse.json(
          { error: 'Custom target path must be absolute (start with /)' },
          { status: 400 }
        );
      }
      if (trimmedCustomPath.endsWith('/')) {
        return NextResponse.json(
          { error: 'Custom target path must include the file name, not just a directory' },
          { status: 400 }
        );
      }
      targetPath = path.resolve(trimmedCustomPath);
      installDirOverride = path.join(path.dirname(targetPath), 'installed');
    } else {
      targetPath = buildPipelineDatabaseTargetPath(
        executionSettings.pipelineRunDir,
        pipelineId,
        databaseId,
        database.fileName,
        executionSettings.pipelineDatabaseDir
      );
    }
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
      if (database.sha256) {
        await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
          state: 'running',
          phase: 'verifying',
          sourceUrl: database.downloadUrl,
          targetPath,
          bytesDownloaded: localBytes,
          totalBytes,
          progressPercent: 100,
          startedAt: new Date().toISOString(),
          error: undefined,
        });
        const actualHash = await computeFileSha256(targetPath);
        if (actualHash.toLowerCase() !== database.sha256.toLowerCase()) {
          const message = `Checksum mismatch: expected sha256 ${database.sha256}, got ${actualHash}. Re-run with "Replace existing" to download again.`;
          await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
            state: 'error',
            phase: undefined,
            finishedAt: new Date().toISOString(),
            error: message,
          });
          return NextResponse.json({ error: message }, { status: 422 });
        }
      } else {
        console.warn(
          `[Pipeline DB Download] No sha256 configured for ${pipelineId}/${databaseId}; accepting the existing file on size alone (integrity NOT verified). Add a "sha256" to data/pipeline-databases.json to enable verification.`
        );
      }
      const installed = await installDatabaseIfNeeded(
        executionSettings.pipelineRunDir,
        pipelineId,
        databaseId,
        targetPath,
        database,
        executionSettings.pipelineDatabaseDir,
        undefined,
        installDirOverride
      );
      await updateDatabaseDownloadRecord(pipelineId, databaseId, {
        version: database.version,
        path: installed.runtimePath,
        sourceUrl: database.downloadUrl,
        sizeBytes: installed.sizeBytes,
      });
      await setPipelineDatabasePath(pipelineId, database.configKey, installed.runtimePath);
      await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
        state: 'success',
        phase: undefined,
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
        executionSettings.pipelineRunDir,
        executionSettings.pipelineDatabaseDir
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
    if (limitRate) {
      logStream.write(
        `[${new Date().toISOString()}] Bandwidth limit applied: ${limitRate}\n`
      );
    }
    logStream.write(
      `[${new Date().toISOString()}] Command: ${downloader.command} ${downloader
        .args(database.downloadUrl, targetPath, limitRate)
        .join(' ')}\n`
    );

    const startedAt = new Date().toISOString();
    await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
      state: 'running',
      phase: 'downloading',
      sourceUrl: database.downloadUrl,
      targetPath,
      bytesDownloaded: localBytes,
      totalBytes,
      progressPercent: calculateProgressPercent(localBytes, totalBytes),
      limitRate,
      startedAt,
      finishedAt: undefined,
      error: undefined,
      cancelled: false,
      logPath,
      pid: undefined,
    });

    try {
      const child = spawn(
        downloader.command,
        downloader.args(database.downloadUrl, targetPath, limitRate),
        {
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

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
        const message = `Failed to run ${downloader.command} for ${database.label || databaseId}: ${error.message}. Log: ${logPath}`;
        logStream.write(`[${new Date().toISOString()}] ${message}\n`);
        try {
          await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
            state: 'error',
            finishedAt: new Date().toISOString(),
            error: message,
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
          const currentJob = await getDatabaseDownloadJobStatus(pipelineId, databaseId);
          if (currentJob?.cancelled) {
            // Remove the partial file so it is never later mistaken for a
            // complete download (getPipelineDatabaseStatuses would otherwise
            // report any non-empty file as "downloaded" when no expected size
            // is known, e.g. when the content-length HEAD probe was missing).
            await fs.rm(targetPath, { force: true }).catch(() => {
              // Best-effort cleanup; leave the file if removal fails.
            });
            logStream.write(
              `[${new Date().toISOString()}] Download cancelled by user (exit code ${code}). Removed partial file ${targetPath}.\n`
            );
            logStream.end();
            return;
          }
          if (code === 0) {
            const bytesDownloaded = await getFileSize(targetPath);
            if (database.sha256) {
              await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
                phase: 'verifying',
                bytesDownloaded,
                totalBytes,
                progressPercent: 100,
              });
              logStream.write(
                `[${new Date().toISOString()}] Verifying sha256 checksum...\n`
              );
              const actualHash = await computeFileSha256(targetPath);
              if (actualHash.toLowerCase() !== database.sha256.toLowerCase()) {
                const message = `Checksum mismatch: expected sha256 ${database.sha256}, got ${actualHash}. The downloaded file may be corrupt; re-run with "Replace existing" to download again.`;
                logStream.write(`[${new Date().toISOString()}] ${message}\n`);
                await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
                  state: 'error',
                  phase: undefined,
                  finishedAt,
                  bytesDownloaded,
                  totalBytes,
                  progressPercent: 100,
                  error: message,
                });
                logStream.end();
                return;
              }
              logStream.write(
                `[${new Date().toISOString()}] Checksum OK (sha256 ${actualHash}).\n`
              );
            } else {
              console.warn(
                `[Pipeline DB Download] No sha256 configured for ${pipelineId}/${databaseId}; the download cannot be integrity-checked. Add a "sha256" to data/pipeline-databases.json to enable verification.`
              );
              logStream.write(
                `[${new Date().toISOString()}] WARNING: no sha256 configured for this database; integrity NOT verified.\n`
              );
            }
            await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
              phase: 'installing',
            });
            const installed = await installDatabaseIfNeeded(
              executionSettings.pipelineRunDir,
              pipelineId,
              databaseId,
              targetPath,
              database,
              executionSettings.pipelineDatabaseDir,
              logStream,
              installDirOverride
            );
            await updateDatabaseDownloadRecord(pipelineId, databaseId, {
              version: database.version,
              path: installed.runtimePath,
              sourceUrl: database.downloadUrl,
              sizeBytes: installed.sizeBytes,
            });
            await setPipelineDatabasePath(pipelineId, database.configKey, installed.runtimePath);
            await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
              state: 'success',
              phase: undefined,
              finishedAt,
              bytesDownloaded,
              totalBytes,
              progressPercent: 100,
              error: undefined,
            });
          } else {
            const bytesDownloaded = await getFileSize(targetPath);
            const progressPercent = calculateProgressPercent(bytesDownloaded, totalBytes);
            const error = buildDownloadExitError({
              command: downloader.command,
              code,
              bytesDownloaded,
              totalBytes,
              label: database.label || databaseId,
              logPath,
            });
            logStream.write(`[${new Date().toISOString()}] ${error}\n`);
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
      executionSettings.pipelineRunDir,
      executionSettings.pipelineDatabaseDir
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
