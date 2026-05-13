import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { PIPELINE_REGISTRY, getAllPipelineIds } from '@/lib/pipelines';
import { getPipelineDatabaseStatuses } from '@/lib/pipelines/database-downloads';
import {
  parsePipelineAllowlist,
  resolvePipelineEnabled,
} from '@/lib/pipelines/enablement';
import { getExecutionSettings } from '@/lib/pipelines/execution-settings';
import { resolvePipelineExecutionPolicy } from '@/lib/pipelines/execution-policy';
import { getPackage, getPackageManifest, type PackageManifest } from '@/lib/pipelines/package-loader';
import { getPipelineDownloadStatus } from '@/lib/pipelines/nextflow-downloads';
import {
  checkMetaxPathPackageCompatibility,
  METAXPATH_MIN_COMPATIBLE_VERSION,
} from '@/lib/pipelines/metaxpath-compatibility';
import {
  deriveManifestTargets,
  derivePipelineCapabilities,
  derivePipelineCatalogs,
  matchesPipelineCatalog,
  type PipelineCatalog,
} from '@/lib/pipelines/package-contracts';
import type { PipelineConfigSchema } from '@/lib/pipelines/types';
import fs from 'fs/promises';
import path from 'path';

interface PipelineReadinessItem {
  id: string;
  label: string;
  status: 'ready' | 'warning' | 'missing';
  detail?: string;
  action?: 'install' | 'sync' | 'download-db' | 'configure' | 'enable' | 'review-outputs';
}

interface PipelineReadiness {
  status: 'ready' | 'warning' | 'missing';
  summary: string;
  items: PipelineReadinessItem[];
}

function parsePipelineConfig(rawConfig: string | null | undefined): Record<string, unknown> {
  if (!rawConfig) return {};
  try {
    const parsed = JSON.parse(rawConfig);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore invalid JSON and fall back to defaults.
  }
  return {};
}

const ALLOWED_SEQUENCING_TECHNOLOGIES_SCHEMA: PipelineConfigSchema['properties'][string] = {
  type: 'array',
  title: 'Allow For Sequencing Technologies',
  description:
    'Optional. If selected, this pipeline can only run for orders using one of these sequencing technologies.',
  default: [],
};

function extendConfigSchemaWithTechnologyAllowlist(
  schema: PipelineConfigSchema
): PipelineConfigSchema {
  if (schema.properties.allowedSequencingTechnologies) {
    return schema;
  }

  return {
    ...schema,
    properties: {
      ...schema.properties,
      allowedSequencingTechnologies: ALLOWED_SEQUENCING_TECHNOLOGIES_SCHEMA,
    },
  };
}

function extendDefaultConfigWithTechnologyAllowlist(
  defaultConfig: Record<string, unknown>
): Record<string, unknown> {
  if (Object.prototype.hasOwnProperty.call(defaultConfig, 'allowedSequencingTechnologies')) {
    return defaultConfig;
  }

  return {
    ...defaultConfig,
    allowedSequencingTechnologies: [],
  };
}

function isLocalPipelineRef(pipelineRef: string | null | undefined): boolean {
  if (!pipelineRef) return false;
  const trimmed = pipelineRef.trim();
  return (
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  );
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveLocalPipelinePath(
  packageBasePath: string | undefined,
  manifest: PackageManifest | null
): string | null {
  const pipelineRef = manifest?.execution?.pipeline;
  if (!pipelineRef || !isLocalPipelineRef(pipelineRef) || !packageBasePath) {
    return null;
  }
  return path.isAbsolute(pipelineRef)
    ? pipelineRef
    : path.resolve(packageBasePath, pipelineRef);
}

function deriveReadinessStatus(items: PipelineReadinessItem[]): PipelineReadiness['status'] {
  if (items.some((item) => item.status === 'missing')) return 'missing';
  if (items.some((item) => item.status === 'warning')) return 'warning';
  return 'ready';
}

function buildReadinessSummary(
  status: PipelineReadiness['status'],
  items: PipelineReadinessItem[]
): string {
  if (status === 'ready') return 'Ready to run';
  const nextItem = items.find((item) => item.status === 'missing') ||
    items.find((item) => item.status === 'warning');
  return nextItem?.detail || nextItem?.label || 'Setup needs attention';
}

async function buildPipelineReadiness(args: {
  pipelineId: string;
  enabled: boolean;
  manifest: PackageManifest | null;
  resolvedConfig: Record<string, unknown>;
  databaseDownloads: Awaited<ReturnType<typeof getPipelineDatabaseStatuses>>;
}): Promise<PipelineReadiness> {
  const pkg = getPackage(args.pipelineId);
  const localPipelinePath = resolveLocalPipelinePath(pkg?.basePath, args.manifest);
  const packageOutputCount = args.manifest?.outputs?.length ?? 0;
  const items: PipelineReadinessItem[] = [];

  items.push({
    id: 'package',
    label: 'Pipeline package',
    status: args.manifest ? 'ready' : 'missing',
    detail: args.manifest
      ? 'Descriptor package is installed.'
      : 'Install or sync the pipeline package first.',
    action: args.manifest ? undefined : 'install',
  });

  if (localPipelinePath) {
    const workflowExists = await pathExists(localPipelinePath);
    items.push({
      id: 'workflow',
      label: 'Workflow snapshot',
      status: workflowExists ? 'ready' : 'missing',
      detail: workflowExists
        ? 'Workflow files are available locally.'
        : 'Workflow files are missing. Sync the private GitHub package again.',
      action: workflowExists ? undefined : 'sync',
    });
  } else if (args.manifest?.execution?.pipeline) {
    items.push({
      id: 'workflow',
      label: 'Workflow source',
      status: 'ready',
      detail: `Nextflow will use ${args.manifest.execution.pipeline}.`,
    });
  }

  if (args.pipelineId === 'metaxpath' && pkg && args.manifest) {
    const compatibility = await checkMetaxPathPackageCompatibility({
      basePath: pkg.basePath,
      manifest: args.manifest,
      registry: pkg.registry,
    });
    items.push({
      id: 'metaxpath-compatibility',
      label: 'MetaxPath package version',
      status: compatibility.compatible ? 'ready' : 'missing',
      detail: compatibility.compatible
        ? `Installed package ${compatibility.version} is compatible.`
        : `${compatibility.issues.join(' ')} Sync MetaxPath-Nextflow ${METAXPATH_MIN_COMPATIBLE_VERSION} or newer.`,
      action: compatibility.compatible ? undefined : 'sync',
    });
  }

  if (args.databaseDownloads.length > 0) {
    const missingDatabase = args.databaseDownloads.find((database) => database.status !== 'downloaded');
    items.push({
      id: 'databases',
      label: 'Runtime databases',
      status: missingDatabase ? 'missing' : 'ready',
      detail: missingDatabase
        ? `${missingDatabase.label} is not installed.`
        : 'Required database assets are installed.',
      action: missingDatabase ? 'download-db' : undefined,
    });
  }

  if (args.pipelineId === 'metaxpath') {
    const paramsFile = args.resolvedConfig.paramsFile;
    const configuredParamsFile = hasNonEmptyString(paramsFile)
      ? paramsFile.trim()
      : null;
    const paramsFileExists = hasNonEmptyString(paramsFile)
      ? await pathExists(paramsFile)
      : false;
    items.push({
      id: 'params-file',
      label: 'MetaxPath params file',
      status: paramsFileExists ? 'ready' : 'missing',
      detail: paramsFileExists
        ? `SeqDesk will pass ${configuredParamsFile} to Nextflow.`
        : configuredParamsFile
          ? `Configured params file does not exist: ${configuredParamsFile}`
          : 'Install the MetaxPath DB bundle so metaxpath.downloaded.params.yaml is configured.',
      action: paramsFileExists ? undefined : 'download-db',
    });
  }

  items.push({
    id: 'outputs',
    label: 'Output browsing',
    status: packageOutputCount > 0 ? 'ready' : 'warning',
    detail: packageOutputCount > 0
      ? `${packageOutputCount} output pattern${packageOutputCount === 1 ? '' : 's'} configured; run output folder browsing is also available.`
      : 'Raw run output browsing is available, but curated output patterns are not configured.',
    action: packageOutputCount > 0 ? undefined : 'review-outputs',
  });

  items.push({
    id: 'enabled',
    label: 'Enabled for users',
    status: args.enabled ? 'ready' : 'warning',
    detail: args.enabled
      ? 'Pipeline is enabled.'
      : 'Pipeline is installed but disabled.',
    action: args.enabled ? undefined : 'enable',
  });

  const status = deriveReadinessStatus(items);
  return {
    status,
    summary: buildReadinessSummary(status, items),
    items,
  };
}

function parseCatalogParam(value: string | null): PipelineCatalog | 'all' | null {
  if (!value || value === 'all') return 'all';
  if (value === 'order' || value === 'study') return value;
  return null;
}

// GET - List all pipeline configurations
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const enabledOnly = searchParams.get('enabled') === 'true';
    const catalog = parseCatalogParam(searchParams.get('catalog'));

    if (!catalog) {
      return NextResponse.json(
        { error: 'Invalid catalog. Expected one of: all, order, study' },
        { status: 400 }
      );
    }

    // Get all pipeline IDs from registry
    const allPipelineIds = getAllPipelineIds();

    // Get existing configs from database
    const [configs, siteSettings] = await Promise.all([
      db.pipelineConfig.findMany(),
      db.siteSettings.findUnique({
        where: { id: 'singleton' },
        select: { extraSettings: true },
      }),
    ]);
    const configMap = new Map(configs.map(c => [c.pipelineId, c]));
    const profilePipelineAllowlist = parsePipelineAllowlist(siteSettings?.extraSettings);
    const executionSettings = await getExecutionSettings();

    // Build response with registry data + database config
    const pipelines = await Promise.all(allPipelineIds.map(async pipelineId => {
      const definition = PIPELINE_REGISTRY[pipelineId];
      const dbConfig = configMap.get(pipelineId);
      const effectiveEnabled = resolvePipelineEnabled(
        pipelineId,
        dbConfig,
        profilePipelineAllowlist
      );
      const extendedDefaultConfig = extendDefaultConfigWithTechnologyAllowlist(
        definition.defaultConfig
      );
      const extendedConfigSchema = extendConfigSchemaWithTechnologyAllowlist(
        definition.configSchema
      );
      const resolvedConfig = {
        ...extendedDefaultConfig,
        ...parsePipelineConfig(dbConfig?.config),
      };
      const manifest = getPackageManifest(pipelineId) || null;
      const supportedTargets = deriveManifestTargets(manifest, definition);
      const catalogs = derivePipelineCatalogs(supportedTargets);
      const capabilities = derivePipelineCapabilities(manifest, definition);
      const downloadStatus = manifest
        ? isLocalPipelineRef(manifest.execution.pipeline)
          ? {
            status: 'downloaded' as const,
            version: manifest.execution.version,
            expectedVersion: manifest.execution.version,
            path: manifest.execution.pipeline,
            detail: 'Bundled with pipeline package (no remote download required)',
          }
          : await getPipelineDownloadStatus(
            pipelineId,
            manifest.execution.pipeline,
            manifest.execution.version
          )
        : {
          status: 'unsupported' as const,
          detail: 'Missing pipeline manifest',
        };
      const databaseDownloads = await getPipelineDatabaseStatuses(
        pipelineId,
        resolvedConfig,
        executionSettings.pipelineRunDir,
        executionSettings.pipelineDatabaseDir
      );
      const readiness = await buildPipelineReadiness({
        pipelineId,
        enabled: effectiveEnabled,
        manifest,
        resolvedConfig,
        databaseDownloads,
      });
      const executionPolicy = resolvePipelineExecutionPolicy({
        pipelineId,
        settings: executionSettings,
      });

      return {
        pipelineId,
        name: definition.name,
        description: definition.description,
        category: definition.category,
        version: definition.version,
        icon: definition.icon,
        enabled: effectiveEnabled,
        config: resolvedConfig,
        configSchema: extendedConfigSchema,
        defaultConfig: extendedDefaultConfig,
        input: definition.input,
        targets: supportedTargets.length > 0 ? { supported: supportedTargets } : null,
        catalogs,
        capabilities,
        sampleResult: definition.sampleResult ?? null,
        visibility: definition.visibility,
        requires: definition.requires,
        outputs: definition.outputs,
        executionPolicy: {
          mode: executionPolicy.mode,
          source: executionPolicy.source,
          slurm: executionPolicy.profile.slurm || null,
          nextflowProfile: executionPolicy.profile.nextflowProfile,
        },
        download: downloadStatus,
        databaseDownloads,
        readiness,
      };
    }));

    // Filter if only enabled requested
    const result = pipelines
      .filter((pipeline) => (enabledOnly ? pipeline.enabled : true))
      .filter((pipeline) => matchesPipelineCatalog(pipeline.catalogs, catalog));

    return NextResponse.json({ pipelines: result });
  } catch (error) {
    console.error('[Pipelines API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipeline configurations' },
      { status: 500 }
    );
  }
}

// POST - Update a pipeline configuration
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json();
    const { pipelineId, config, enabled } = body;

    if (!pipelineId || !PIPELINE_REGISTRY[pipelineId]) {
      return NextResponse.json({ error: 'Invalid pipeline ID' }, { status: 400 });
    }

    const effectiveEnabled =
      typeof enabled === 'boolean' ? enabled : true;

    // Upsert the configuration
    const result = await db.pipelineConfig.upsert({
      where: { pipelineId },
      create: {
        pipelineId,
        enabled: effectiveEnabled,
        config: config ? JSON.stringify(config) : null,
      },
      update: {
        enabled: effectiveEnabled,
        config: config ? JSON.stringify(config) : null,
      },
    });

    return NextResponse.json({
      success: true,
      pipelineId: result.pipelineId,
      enabled: result.enabled,
    });
  } catch (error) {
    console.error('[Pipelines API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update pipeline configuration' },
      { status: 500 }
    );
  }
}
