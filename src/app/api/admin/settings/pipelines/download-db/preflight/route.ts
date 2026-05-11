import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getExecutionSettings } from '@/lib/pipelines/execution-settings';
import {
  buildPipelineDatabaseTargetPath,
  getPipelineDatabaseDefinition,
} from '@/lib/pipelines/database-downloads';
import fs from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';

async function headRemoteSize(sourceUrl: string): Promise<number | null> {
  try {
    const response = await fetch(sourceUrl, { method: 'HEAD', cache: 'no-store' });
    if (!response.ok) return null;
    const header = response.headers.get('content-length');
    if (!header) return null;
    const parsed = Number.parseInt(header, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function getLocalSize(targetPath: string): Promise<number> {
  try {
    const stats = await fs.stat(targetPath);
    return stats.size;
  } catch {
    return 0;
  }
}

async function getFreeBytesForPath(targetDir: string): Promise<number | null> {
  let current = path.resolve(targetDir);
  for (let i = 0; i < 64; i += 1) {
    try {
      await fs.access(current);
      const statfs = (fs as unknown as {
        statfs?: (p: string) => Promise<{ bsize: number; bavail: number }>;
      }).statfs;
      if (typeof statfs !== 'function') return null;
      const stats = await statfs(current);
      return stats.bsize * stats.bavail;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'FACILITY_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { pipelineId, databaseId, targetPath: customTargetPath } = body || {};

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

    const executionSettings = await getExecutionSettings();
    let resolvedTargetPath: string | null = null;
    let resolvedError: string | null = null;
    const trimmedCustomPath =
      typeof customTargetPath === 'string' ? customTargetPath.trim() : '';
    if (trimmedCustomPath.length > 0) {
      if (!path.isAbsolute(trimmedCustomPath)) {
        resolvedError = "Custom target path must be absolute (start with '/').";
      } else if (trimmedCustomPath.endsWith('/')) {
        resolvedError =
          'Custom target path must include the file name, not just a directory.';
      } else {
        resolvedTargetPath = path.resolve(trimmedCustomPath);
      }
    } else if (executionSettings.pipelineRunDir && executionSettings.pipelineRunDir !== '/') {
      resolvedTargetPath = buildPipelineDatabaseTargetPath(
        executionSettings.pipelineRunDir,
        pipelineId,
        databaseId,
        database.fileName,
        executionSettings.pipelineDatabaseDir
      );
    } else {
      resolvedError = 'Pipeline run directory is not configured.';
    }

    let expectedBytes: number | null = null;
    let freeBytes: number | null = null;
    let partialBytes = 0;
    let parentDir: string | null = null;

    if (resolvedTargetPath) {
      parentDir = path.dirname(resolvedTargetPath);
      const [size, free, local] = await Promise.all([
        headRemoteSize(database.downloadUrl),
        getFreeBytesForPath(parentDir),
        getLocalSize(resolvedTargetPath),
      ]);
      expectedBytes = size;
      freeBytes = free;
      partialBytes = local;
    }

    const remainingBytes =
      typeof expectedBytes === 'number'
        ? Math.max(0, expectedBytes - partialBytes)
        : null;
    const sufficient =
      typeof freeBytes === 'number' && typeof remainingBytes === 'number'
        ? freeBytes >= remainingBytes
        : null;

    return NextResponse.json({
      pipelineId,
      databaseId,
      sourceUrl: database.downloadUrl,
      targetPath: resolvedTargetPath,
      parentDir,
      expectedBytes,
      freeBytes,
      partialBytes,
      remainingBytes,
      sufficient,
      hasSha256: Boolean(database.sha256),
      error: resolvedError,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Preflight check failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
