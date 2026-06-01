import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { getExecutionSettings } from '@/lib/pipelines/execution-settings';
import { PIPELINE_REGISTRY } from '@/lib/pipelines';
import {
  getDatabaseDownloadJobStatus,
  getPipelineDatabaseDefinition,
  getPipelineDatabaseStatuses,
  updateDatabaseDownloadJobStatus,
  updateDatabaseDownloadRecord,
} from '@/lib/pipelines/database-downloads';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import crypto from 'crypto';

export const runtime = 'nodejs';

async function computeFileSha256(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
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
    const body = await req.json().catch(() => ({}));
    const { pipelineId, databaseId, path: rawPath } = body || {};

    if (!pipelineId || typeof pipelineId !== 'string') {
      return NextResponse.json({ error: 'Pipeline ID required' }, { status: 400 });
    }
    if (!databaseId || typeof databaseId !== 'string') {
      return NextResponse.json({ error: 'Database ID required' }, { status: 400 });
    }
    if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
      return NextResponse.json({ error: 'Path required' }, { status: 400 });
    }

    const trimmedPath = rawPath.trim();
    if (!path.isAbsolute(trimmedPath)) {
      return NextResponse.json(
        { error: "Path must be absolute (start with '/')" },
        { status: 400 }
      );
    }
    const resolvedPath = path.resolve(trimmedPath);

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
        { error: 'A download is currently running for this database. Cancel it first.' },
        { status: 409 }
      );
    }

    let stats;
    try {
      stats = await fs.stat(resolvedPath);
    } catch {
      return NextResponse.json(
        { error: `No file or directory found at ${resolvedPath}` },
        { status: 404 }
      );
    }
    if (stats.size === 0 && stats.isFile()) {
      return NextResponse.json(
        { error: 'The file at the target path is empty.' },
        { status: 400 }
      );
    }

    // When the definition declares a checksum, verify it before accepting the
    // linked file, mirroring the download path (download-db/route.ts). Without
    // this, an admin could link a wrong-version or corrupt file for a
    // checksum-protected database and have it accepted as verified.
    if (database.sha256 && stats.isFile()) {
      const actualHash = await computeFileSha256(resolvedPath);
      if (actualHash.toLowerCase() !== database.sha256.toLowerCase()) {
        return NextResponse.json(
          {
            error: `Checksum mismatch: expected sha256 ${database.sha256}, got ${actualHash}. The linked file does not match the expected database.`,
          },
          { status: 400 }
        );
      }
    }

    await setPipelineDatabasePath(pipelineId, database.configKey, resolvedPath);
    await updateDatabaseDownloadRecord(pipelineId, databaseId, {
      version: database.version,
      path: resolvedPath,
      sourceUrl: database.downloadUrl,
      sizeBytes: stats.size,
    });
    await updateDatabaseDownloadJobStatus(pipelineId, databaseId, {
      state: 'success',
      phase: undefined,
      sourceUrl: database.downloadUrl,
      targetPath: resolvedPath,
      bytesDownloaded: stats.size,
      totalBytes: stats.size,
      progressPercent: 100,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: undefined,
      cancelled: false,
    });

    const executionSettings = await getExecutionSettings();
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
      path: resolvedPath,
      sizeBytes: stats.size,
      database: statuses.find((entry) => entry.id === databaseId) || null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to link existing file',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
