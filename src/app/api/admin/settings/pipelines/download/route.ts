import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPackageManifest } from '@/lib/pipelines/package-loader';
import { getExecutionSettings } from '@/lib/pipelines/execution-settings';
import {
  createDownloadLogPath,
  getDownloadJobStatus,
  getPipelineDownloadStatus,
  readNextflowManifestVersion,
  resolvePipelineAssetsPath,
  updateDownloadJobStatus,
  updateDownloadRecord,
} from '@/lib/pipelines/nextflow-downloads';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';

const execAsync = promisify(exec);

export const runtime = 'nodejs';

async function resolveCondaBin(condaPath?: string): Promise<string | null> {
  if (condaPath) {
    const candidates = [
      path.join(condaPath, 'condabin', 'conda'),
      path.join(condaPath, 'bin', 'conda'),
    ];

    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // try next
      }
    }
  }

  try {
    await execAsync('which conda', { timeout: 5000 });
    return 'conda';
  } catch {
    return null;
  }
}

async function resolveNextflowCommand(
  condaPath?: string,
  condaEnv?: string
): Promise<{ command: string; baseArgs: string[]; source: 'conda' | 'system' }> {
  const envName = condaEnv?.trim() || 'seqdesk-pipelines';
  const condaBin = await resolveCondaBin(condaPath);

  if (condaBin) {
    const condaArgs = ['run', '-n', envName, 'nextflow'];
    try {
      await execAsync(`${condaBin} run -n ${envName} nextflow -version 2>&1`, { timeout: 30000 });
      return { command: condaBin, baseArgs: condaArgs, source: 'conda' };
    } catch {
      // fall back to system nextflow
    }
  }

  try {
    await execAsync('nextflow -version', { timeout: 10000 });
    return { command: 'nextflow', baseArgs: [], source: 'system' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nextflow not found';
    throw new Error(message);
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'FACILITY_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { pipelineId, version } = body || {};

    if (!pipelineId || typeof pipelineId !== 'string') {
      return NextResponse.json({ error: 'Pipeline ID required' }, { status: 400 });
    }

    const manifest = getPackageManifest(pipelineId);
    if (!manifest) {
      return NextResponse.json({ error: `Pipeline manifest not found: ${pipelineId}` }, { status: 404 });
    }

    if (manifest.execution.type !== 'nextflow') {
      return NextResponse.json({ error: 'Pipeline is not a Nextflow pipeline' }, { status: 400 });
    }

    const pipelineRef = manifest.execution.pipeline;
    const targetVersion = version || manifest.execution.version;

    if (!pipelineRef) {
      return NextResponse.json({ error: 'Pipeline reference missing in manifest' }, { status: 400 });
    }

    const assetsInfo = resolvePipelineAssetsPath(pipelineRef);
    if (assetsInfo.kind !== 'remote') {
      return NextResponse.json(
        { error: 'Pipeline download is not supported for this reference', details: assetsInfo.reason },
        { status: 400 }
      );
    }

    const existingJob = await getDownloadJobStatus(pipelineId);
    if (existingJob?.state === 'running') {
      return NextResponse.json(
        { error: 'Pipeline download already in progress', job: existingJob },
        { status: 409 }
      );
    }

    const executionSettings = await getExecutionSettings();
    const { command: nextflowCommand, baseArgs, source } = await resolveNextflowCommand(
      executionSettings.condaPath,
      executionSettings.condaEnv
    );

    const env = {
      ...process.env,
      NXF_ANSI_LOG: 'false',
    };

    const logPath = await createDownloadLogPath(pipelineId);
    const logStream = createWriteStream(logPath, { flags: 'a' });
    logStream.write(`[${new Date().toISOString()}] Starting download\\n`);

    const pullArgs = [...baseArgs, 'pull', pipelineRef];
    if (targetVersion) {
      pullArgs.push('-r', targetVersion);
    }
    logStream.write(`[${new Date().toISOString()}] Command: ${nextflowCommand} ${pullArgs.join(' ')}\\n`);

    const startedAt = new Date().toISOString();
    await updateDownloadJobStatus(pipelineId, {
      state: 'running',
      pipelineId,
      pipelineRef,
      requestedVersion: targetVersion,
      source,
      startedAt,
      logPath,
    });

    try {
      const child = spawn(nextflowCommand, pullArgs, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      if (child.pid) {
        await updateDownloadJobStatus(pipelineId, { pid: child.pid });
      }

      if (child.stdout) {
        child.stdout.pipe(logStream);
      }
      if (child.stderr) {
        child.stderr.pipe(logStream);
      }

      child.on('error', async (error) => {
        await updateDownloadJobStatus(pipelineId, {
          state: 'error',
          finishedAt: new Date().toISOString(),
          error: error.message,
        });
        logStream.end();
      });

      child.on('close', async (code) => {
        const finishedAt = new Date().toISOString();
        if (code === 0) {
          const detectedVersion = await readNextflowManifestVersion(assetsInfo.path);
          await updateDownloadRecord(pipelineId, {
            pipeline: pipelineRef,
            version: detectedVersion || targetVersion,
            path: assetsInfo.path,
            source,
          });
          await updateDownloadJobStatus(pipelineId, {
            state: 'success',
            finishedAt,
            resolvedVersion: detectedVersion || targetVersion,
          });
        } else {
          await updateDownloadJobStatus(pipelineId, {
            state: 'error',
            finishedAt,
            error: `Download exited with code ${code}`,
          });
        }
        logStream.end();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to spawn download';
      await updateDownloadJobStatus(pipelineId, {
        state: 'error',
        finishedAt: new Date().toISOString(),
        error: message,
      });
      return NextResponse.json(
        { error: 'Failed to start pipeline download', details: message },
        { status: 500 }
      );
    }

    const downloadStatus = await getPipelineDownloadStatus(
      pipelineId,
      pipelineRef,
      manifest.execution.version
    );

    return NextResponse.json({
      success: true,
      pipelineId,
      version: targetVersion,
      download: downloadStatus,
    });
  } catch (error) {
    console.error('[Pipeline Download] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to download pipeline', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
