import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import fs from 'fs';
import path from 'path';
import { clearPackageCache } from '@/lib/pipelines/package-loader';
import { clearRegistryCache } from '@/lib/pipelines/registry';

const STORE_BASE_URL = process.env.SEQDESK_PIPELINE_STORE_URL || 'https://seqdesk.com';
const REGISTRY_URL =
  process.env.SEQDESK_PIPELINE_REGISTRY_URL || `${STORE_BASE_URL}/api/registry`;

interface RegistryPipeline {
  id: string;
  latestVersion?: string;
  version?: string;
  downloadUrl?: string;
  versions?: Array<{ version: string; downloadUrl?: string }>;
}

interface StoreFileEntry {
  path: string;
  content: string;
  encoding?: string;
}

async function fetchRegistry(): Promise<RegistryPipeline[]> {
  const res = await fetch(REGISTRY_URL, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to fetch registry (${res.status})`);
  }
  const data = await res.json();
  return Array.isArray(data?.pipelines) ? data.pipelines : [];
}

function resolveDownloadUrl(
  pipeline: RegistryPipeline,
  version?: string
): { version: string; url: string } | null {
  const resolvedVersion = version || pipeline.latestVersion || pipeline.version || pipeline.versions?.[0]?.version;
  if (!resolvedVersion) return null;

  if (pipeline.downloadUrl) {
    return { version: resolvedVersion, url: pipeline.downloadUrl };
  }

  const match = pipeline.versions?.find((v) => v.version === resolvedVersion);
  if (match?.downloadUrl) {
    return { version: resolvedVersion, url: match.downloadUrl };
  }

  const fallbackUrl = `${STORE_BASE_URL}/api/registry/pipelines/${pipeline.id}/${resolvedVersion}/download`;
  return { version: resolvedVersion, url: fallbackUrl };
}

function resolveStorePath(baseDir: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Invalid absolute path from store: ${relativePath}`);
  }
  const baseResolved = path.resolve(baseDir);
  const resolved = path.resolve(baseResolved, relativePath);
  if (!resolved.startsWith(`${baseResolved}${path.sep}`)) {
    throw new Error(`Invalid path traversal from store: ${relativePath}`);
  }
  return resolved;
}

function assertPackageId(payload: Record<string, unknown>, pipelineId: string): void {
  const manifest = payload.manifest as { package?: { id?: string } } | undefined;
  const metaPackage = payload.package as { id?: string } | undefined;
  const payloadId = manifest?.package?.id || metaPackage?.id || (payload.id as string | undefined);
  if (payloadId && payloadId !== pipelineId) {
    throw new Error(`Package ID mismatch. Expected ${pipelineId} but got ${payloadId}.`);
  }
}

async function writePackageFiles(
  pipelineDir: string,
  payload: Record<string, unknown>,
  pipelineId: string
): Promise<void> {
  assertPackageId(payload, pipelineId);

  if (Array.isArray(payload.files)) {
    for (const file of payload.files as StoreFileEntry[]) {
      if (!file?.path || typeof file.path !== 'string') {
        throw new Error('Invalid file entry from store.');
      }
      const filePath = resolveStorePath(pipelineDir, file.path);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      const buffer = file.encoding === 'base64'
        ? Buffer.from(file.content, 'base64')
        : Buffer.from(file.content, 'utf8');
      await fs.promises.writeFile(filePath, buffer);
    }
    return;
  }

  if (payload.files && typeof payload.files === 'object') {
    for (const [filePathRaw, content] of Object.entries(payload.files as Record<string, string>)) {
      if (typeof content !== 'string') {
        throw new Error(`Invalid file content for ${filePathRaw}`);
      }
      const filePath = resolveStorePath(pipelineDir, filePathRaw);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, content, 'utf8');
    }
    return;
  }

  if (payload.manifest && payload.definition && payload.registry) {
    await fs.promises.writeFile(
      resolveStorePath(pipelineDir, 'manifest.json'),
      JSON.stringify(payload.manifest, null, 2)
    );
    await fs.promises.writeFile(
      resolveStorePath(pipelineDir, 'definition.json'),
      JSON.stringify(payload.definition, null, 2)
    );
    await fs.promises.writeFile(
      resolveStorePath(pipelineDir, 'registry.json'),
      JSON.stringify(payload.registry, null, 2)
    );
    if (payload.samplesheet) {
      await fs.promises.writeFile(
        resolveStorePath(pipelineDir, 'samplesheet.yaml'),
        String(payload.samplesheet)
      );
    }
    if (payload.parsers && typeof payload.parsers === 'object') {
      for (const [parserPath, parserContent] of Object.entries(payload.parsers as Record<string, string>)) {
        const filePath = resolveStorePath(pipelineDir, parserPath);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, parserContent, 'utf8');
      }
    }
    return;
  }

  throw new Error('Unsupported package payload format from store.');
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

    const registry = await fetchRegistry();
    const pipeline = registry.find((entry) => entry.id === pipelineId);

    if (!pipeline) {
      return NextResponse.json({ error: `Pipeline not found in store: ${pipelineId}` }, { status: 404 });
    }

    const download = resolveDownloadUrl(pipeline, version);
    if (!download) {
      return NextResponse.json({ error: 'No download URL found for pipeline' }, { status: 400 });
    }

    const response = await fetch(download.url, { cache: 'no-store' });
    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to download pipeline package (${response.status})` },
        { status: 502 }
      );
    }

    let payload: Record<string, unknown>;
    try {
      payload = await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSON payload.';
      return NextResponse.json(
        { error: 'Pipeline store returned an invalid package payload', details: message },
        { status: 502 }
      );
    }

    const pipelinesDir = path.join(process.cwd(), 'pipelines');
    const pipelineDir = path.join(pipelinesDir, pipelineId);

    if (fs.existsSync(pipelineDir)) {
      return NextResponse.json(
        { error: `Pipeline ${pipelineId} already installed` },
        { status: 400 }
      );
    }

    await fs.promises.mkdir(pipelinesDir, { recursive: true });
    await fs.promises.mkdir(pipelineDir, { recursive: true });

    try {
      await writePackageFiles(pipelineDir, payload, pipelineId);
    } catch (error) {
      await fs.promises.rm(pipelineDir, { recursive: true, force: true });
      const message = error instanceof Error ? error.message : 'Unknown error';
      return NextResponse.json(
        { error: 'Failed to write pipeline package', details: message },
        { status: 500 }
      );
    }

    clearPackageCache();
    clearRegistryCache();

    return NextResponse.json({
      success: true,
      message: `Pipeline ${pipelineId} installed successfully`,
      pipelineId,
      version: download.version,
      source: download.url,
    });
  } catch (error) {
    console.error('Failed to install pipeline:', error);
    return NextResponse.json(
      { error: 'Failed to install pipeline', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
