import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import fs from 'fs';
import path from 'path';
import { clearPackageCache } from '@/lib/pipelines/package-loader';
import { clearRegistryCache } from '@/lib/pipelines/registry';
import { execFile } from 'child_process';
import { promisify } from 'util';

const STORE_BASE_URL = process.env.SEQDESK_PIPELINE_STORE_URL || 'https://seqdesk.com';
const REGISTRY_URL =
  process.env.SEQDESK_PIPELINE_REGISTRY_URL || `${STORE_BASE_URL}/api/registry`;
const PRIVATE_METAXPATH_ID = 'metaxpath';
const DEFAULT_METAXPATH_PACKAGE_URL = 'https://www.seqdesk.com/private/metaxpath-0.1.0.tar.gz';

const execFileAsync = promisify(execFile);

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

interface PrivateInstallRequest {
  packageUrl?: string;
  accessKey?: string;
  sha256?: string;
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

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getDefaultMetaxPathPackageUrl(): string | undefined {
  return trimToUndefined(
    process.env.SEQDESK_METAXPATH_PACKAGE_URL ||
      process.env.METAXPATH_PACKAGE_URL ||
      DEFAULT_METAXPATH_PACKAGE_URL
  );
}

async function installPrivateMetaxPathPackage(
  opts: PrivateInstallRequest & { replace: boolean }
): Promise<{ source: string; installedVersion?: string }> {
  const packageUrl = trimToUndefined(opts.packageUrl) || getDefaultMetaxPathPackageUrl();
  const accessKey = trimToUndefined(opts.accessKey);
  const sha256 = trimToUndefined(opts.sha256);

  if (!packageUrl || !accessKey) {
    throw new Error('MetaxPath install requires both package URL and access key.');
  }

  const scriptPath = path.join(process.cwd(), 'scripts', 'install-private-metaxpath.sh');
  if (!fs.existsSync(scriptPath)) {
    throw new Error('Missing scripts/install-private-metaxpath.sh in SeqDesk installation.');
  }

  const args = ['--url', packageUrl, '--token', accessKey, '--dir', process.cwd()];
  if (sha256) {
    args.push('--sha256', sha256);
  }
  if (!opts.replace) {
    args.push('--keep-existing');
  }

  try {
    await execFileAsync(scriptPath, args, { maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    const details =
      typeof error === 'object' &&
      error !== null &&
      'stderr' in error &&
      typeof (error as { stderr?: string }).stderr === 'string' &&
      (error as { stderr?: string }).stderr
        ? (error as { stderr: string }).stderr.trim()
        : error instanceof Error
          ? error.message
          : 'Unknown installation error';
    throw new Error(details);
  }

  const manifestPath = path.join(process.cwd(), 'pipelines', PRIVATE_METAXPATH_ID, 'manifest.json');
  let installedVersion: string | undefined;
  try {
    const manifestRaw = await fs.promises.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw) as { package?: { version?: string } };
    installedVersion = trimToUndefined(manifest?.package?.version);
  } catch {
    installedVersion = undefined;
  }

  return {
    source: packageUrl,
    installedVersion,
  };
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
    const {
      pipelineId,
      version,
      replace,
      privatePackageUrl,
      privateAccessKey,
      privateSha256,
    } = body || {};

    if (!pipelineId || typeof pipelineId !== 'string') {
      return NextResponse.json({ error: 'Pipeline ID required' }, { status: 400 });
    }

    if (pipelineId === PRIVATE_METAXPATH_ID) {
      const pipelinesDir = path.join(process.cwd(), 'pipelines');
      const pipelineDir = path.join(pipelinesDir, pipelineId);
      const exists = fs.existsSync(pipelineDir);
      const replaceExisting = replace === true;

      try {
        const privateInstall = await installPrivateMetaxPathPackage({
          packageUrl: privatePackageUrl,
          accessKey: privateAccessKey,
          sha256: privateSha256,
          replace: replaceExisting,
        });

        clearPackageCache();
        clearRegistryCache();

        return NextResponse.json({
          success: true,
          message: `Pipeline ${pipelineId} ${exists ? 'updated' : 'installed'} successfully`,
          pipelineId,
          version: privateInstall.installedVersion || version || 'unknown',
          source: privateInstall.source,
          action: exists ? 'update' : 'install',
          privateInstall: true,
        });
      } catch (error) {
        const details = error instanceof Error ? error.message : 'Unknown error';
        const status = /requires both package URL and access key/i.test(details) ? 400 : 500;
        return NextResponse.json(
          { error: 'Failed to install private MetaxPath package', details },
          { status }
        );
      }
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
    const exists = fs.existsSync(pipelineDir);

    if (exists && !replace) {
      return NextResponse.json(
        { error: `Pipeline ${pipelineId} already installed` },
        { status: 400 }
      );
    }

    await fs.promises.mkdir(pipelinesDir, { recursive: true });

    const tempDir = path.join(
      pipelinesDir,
      `${pipelineId}.__tmp-${Date.now()}`
    );
    await fs.promises.mkdir(tempDir, { recursive: true });

    try {
      await writePackageFiles(tempDir, payload, pipelineId);
    } catch (error) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
      const message = error instanceof Error ? error.message : 'Unknown error';
      return NextResponse.json(
        { error: 'Failed to write pipeline package', details: message },
        { status: 500 }
      );
    }

    if (exists) {
      const backupDir = path.join(
        pipelinesDir,
        `${pipelineId}.__backup-${Date.now()}`
      );
      await fs.promises.rename(pipelineDir, backupDir);
      await fs.promises.rename(tempDir, pipelineDir);
      await fs.promises.rm(backupDir, { recursive: true, force: true });
    } else {
      await fs.promises.rename(tempDir, pipelineDir);
    }

    clearPackageCache();
    clearRegistryCache();

    return NextResponse.json({
      success: true,
      message: `Pipeline ${pipelineId} ${exists ? 'updated' : 'installed'} successfully`,
      pipelineId,
      version: download.version,
      source: download.url,
      action: exists ? 'update' : 'install',
    });
  } catch (error) {
    console.error('Failed to install pipeline:', error);
    return NextResponse.json(
      { error: 'Failed to install pipeline', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
