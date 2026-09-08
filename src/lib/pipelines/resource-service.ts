import path from 'node:path';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getPackage, getPipelinesDir } from './package-loader';
import { getExecutionSettings } from './execution-settings';
import { PipelineResourceSchema, type PipelineResource } from './resource-schema';
import { cancelResourceJob, ResourceError } from './resource-jobs';
import { resourceFingerprint, resourcePreflight, startResourceInstallation, linkResourceInstallation } from './resource-installer';

/** Compare-and-swap merges preserve concurrent unrelated configuration edits. */
export async function bindResourceConfig(pipelineId: string, resource: PipelineResource, directory: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const installedPackage = getPackage(pipelineId);
    const current = installedPackage?.manifest.resources?.find(candidate => candidate.id === resource.id);
    if (!current || resourceFingerprint(PipelineResourceSchema.parse(current)) !== resourceFingerprint(resource)) {
      throw new ResourceError('Pipeline package or database definition changed during setup. Reopen setup for the installed package; verified files are retained.', 409);
    }
    const existing = await db.pipelineConfig.findUnique({ where: { pipelineId } });
    let saved: Record<string, unknown> = {};
    if (existing?.config) {
      const parsed: unknown = JSON.parse(existing.config);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ResourceError('Saved pipeline configuration is invalid; repair it before installing a resource');
      saved = parsed as Record<string, unknown>;
    }
    const config = JSON.stringify({ ...installedPackage?.registry?.defaultConfig, ...saved,
      [resource.config.pathKey]: directory, ...resource.config.values });
    if (existing) {
      const result = await db.pipelineConfig.updateMany({ where: { pipelineId, config: existing.config }, data: { config } });
      if (result.count === 1) return;
    } else {
      try {
        await db.pipelineConfig.create({ data: { pipelineId, enabled: false, config } });
        return;
      } catch (error) { if ((error as { code?: string }).code !== 'P2002') throw error; }
    }
  }
  throw new ResourceError('Pipeline configuration changed concurrently. Retry linking the verified installation.', 409);
}

/** Called only after the route has checked system.pipelines.manage. */
export async function resourceApiAction(
  action: 'preflight' | 'start' | 'link' | 'cancel',
  pipelineId: string, resource: PipelineResource,
  rawPath?: unknown, limitRate?: string,
) {
  try {
    const root = getPipelinesDir();
    if (action === 'cancel') return NextResponse.json(await cancelResourceJob(root, pipelineId, resource.id));
    const settings = await getExecutionSettings();
    if (rawPath !== undefined && typeof rawPath !== 'string') throw new ResourceError('Resource path must be a string');
    let directory = typeof rawPath === 'string' ? rawPath.trim() : '';
    if (!directory) {
      if (action === 'link') throw new ResourceError('Existing database directory required');
      const base = settings.pipelineDatabaseDir || (settings.pipelineRunDir && path.join(settings.pipelineRunDir, 'databases'));
      if (!base || !path.isAbsolute(base) || settings.pipelineRunDir === '/') throw new ResourceError('Configure a pipeline database directory in Infrastructure first');
      directory = path.join(base, pipelineId, resource.id);
    }
    if (action === 'preflight') return NextResponse.json({ pipelineId, databaseId: resource.id, ...await resourcePreflight(resource, directory) });
    const context = { root, pipelineId, resource, directory, limitRate,
      applyConfig: (installed: string) => bindResourceConfig(pipelineId, resource, installed) };
    if (action === 'link') return NextResponse.json(await linkResourceInstallation(context));
    const result = await startResourceInstallation(context);
    return NextResponse.json({ started: result.started, job: result.job }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Resource setup failed' }, { status: error instanceof ResourceError ? error.status : 500 });
  }
}
