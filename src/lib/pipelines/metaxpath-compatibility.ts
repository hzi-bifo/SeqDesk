import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import type { LoadedPackage, PackageManifest } from './package-loader';
import { deriveManifestTargets, type PackageTargetType } from './package-contracts';

export const METAXPATH_MIN_COMPATIBLE_VERSION = '0.1.1';
export const METAXPATH_SAFE_DEFAULTS_VERSION = '0.1.5';
export const METAXPATH_RECOMMENDED_PRED_VFS_AMRS_MEMORY_GB = 96;
export const METAXPATH_STALE_CHUNK_BREADTH_FLAG = '--chunk-breadth';

export interface MetaxPathCompatibilityResult {
  compatible: boolean;
  version: string;
  minimumVersion: string;
  issues: string[];
  workflowPath?: string;
}

export interface MetaxPathCompatibilityOptions {
  requiredTarget?: PackageTargetType;
}

export interface MetaxPathRuntimeWarningInput {
  manifest?: Pick<PackageManifest, 'package' | 'execution'> | null;
  config?: Record<string, unknown> | null;
  paramsFileContent?: string | null;
}

type MetaxPathPackageForCompatibility = {
  basePath: string;
  manifest: PackageManifest;
  registry?: LoadedPackage['registry'];
};

function parseVersion(value: string): number[] | null {
  const match = value.trim().match(/^v?(\d+(?:\.\d+){0,2})/i);
  if (!match) return null;
  return match[1].split('.').map((part) => Number.parseInt(part, 10));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
}

function parseMemoryToGb(value: unknown): number | null {
  const raw = readString(value);
  if (!raw) return null;

  const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)\s*\.?\s*([kmgt]?i?b?)?$/i);
  if (!match) return null;

  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return null;

  const unit = (match[2] || 'gb').toLowerCase();
  if (unit.startsWith('t')) return amount * 1024;
  if (unit.startsWith('m')) return amount / 1024;
  if (unit.startsWith('k')) return amount / (1024 * 1024);
  return amount;
}

function parseParamsFileRecord(content: string | null | undefined): Record<string, unknown> {
  if (!content?.trim()) return {};
  try {
    const parsed = yaml.load(content);
    if (isRecord(parsed)) {
      if (isRecord(parsed.params)) {
        return {
          ...parsed,
          ...parsed.params,
        };
      }
      return parsed;
    }
  } catch {
    // Ignore invalid params files; runtime warnings fall back to manifest/config.
  }
  return {};
}

function buildEffectiveRuntimeConfig(input: MetaxPathRuntimeWarningInput): Record<string, unknown> {
  return {
    ...(input.manifest?.execution?.defaultParams || {}),
    ...parseParamsFileRecord(input.paramsFileContent),
    ...(input.config || {}),
  };
}

function getKraken2Db(config: Record<string, unknown>): string | null {
  return readString(
    firstDefined(
      config.kraken2Db,
      config.kraken2_db,
      config.kraken2Database,
      config.kraken2_database
    )
  );
}

function getKraken2MemoryMapping(config: Record<string, unknown>): boolean | null {
  return readBoolean(firstDefined(config.kraken2MemoryMapping, config.kraken2_memory_mapping));
}

function getPredVfsAmrsMemory(config: Record<string, unknown>): unknown {
  return firstDefined(config.predVfsAmrsMemory, config.pred_vfs_amrs_memory);
}

function isMetaxPathManifest(manifest: MetaxPathRuntimeWarningInput['manifest']): boolean {
  return manifest?.package?.id === 'metaxpath';
}

async function readConfiguredParamsFile(config: Record<string, unknown> | null | undefined): Promise<string | null> {
  const paramsFile = readString(config?.paramsFile);
  if (!paramsFile || !path.isAbsolute(paramsFile)) return null;

  try {
    return await fs.readFile(paramsFile, 'utf8');
  } catch {
    return null;
  }
}

export function comparePackageVersions(left: string, right: string): number | null {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) return null;

  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }
  return 0;
}

export function getMetaxPathRuntimeWarnings(input: MetaxPathRuntimeWarningInput): string[] {
  if (!isMetaxPathManifest(input.manifest)) return [];

  const warnings: string[] = [];
  const version = input.manifest?.package?.version || 'unknown';
  const versionComparison = comparePackageVersions(version, METAXPATH_SAFE_DEFAULTS_VERSION);
  if (versionComparison !== null && versionComparison < 0) {
    warnings.push(
      `Installed MetaxPath package ${version} predates the Kraken2 PlusPF runtime hardening in ${METAXPATH_SAFE_DEFAULTS_VERSION}. Sync MetaxPath before relying on UI-launched PlusPF runs.`
    );
  }

  const config = buildEffectiveRuntimeConfig(input);
  const kraken2Db = getKraken2Db(config);
  const usesPlusPf = Boolean(kraken2Db && /pluspf/i.test(kraken2Db));
  if (usesPlusPf && getKraken2MemoryMapping(config) !== true) {
    warnings.push(
      'Kraken2 PlusPF is configured without memory mapping. PlusPF can exceed common Slurm cgroup memory limits and be SIGKILLed while loading the database; enable kraken2MemoryMapping.'
    );
  }

  const predMemoryRaw = getPredVfsAmrsMemory(config);
  const predMemoryGb = parseMemoryToGb(predMemoryRaw);
  if (
    predMemoryGb !== null &&
    predMemoryGb < METAXPATH_RECOMMENDED_PRED_VFS_AMRS_MEMORY_GB
  ) {
    const memoryLabel = readString(predMemoryRaw) || `${predMemoryGb} GB`;
    warnings.push(
      `PRED_VFS_AMRS memory is ${memoryLabel}; PlusPF runs should request at least ${METAXPATH_RECOMMENDED_PRED_VFS_AMRS_MEMORY_GB} GB to reduce Kraken2 cgroup kills.`
    );
  }

  return warnings;
}

export async function collectMetaxPathRuntimeWarnings(input: {
  manifest?: Pick<PackageManifest, 'package' | 'execution'> | null;
  config?: Record<string, unknown> | null;
}): Promise<string[]> {
  const paramsFileContent = await readConfiguredParamsFile(input.config);
  return getMetaxPathRuntimeWarnings({
    manifest: input.manifest,
    config: input.config,
    paramsFileContent,
  });
}

function isLocalPipelineRef(value: string): boolean {
  return (
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.startsWith('../')
  );
}

function resolveWorkflowPath(pkg: MetaxPathPackageForCompatibility): string | undefined {
  const pipelineRef = pkg.manifest.execution.pipeline;
  if (!isLocalPipelineRef(pipelineRef)) return undefined;
  return path.isAbsolute(pipelineRef)
    ? pipelineRef
    : path.resolve(pkg.basePath, pipelineRef);
}

async function readWorkflowMain(workflowPath?: string): Promise<string | null> {
  if (!workflowPath) return null;

  try {
    const stat = await fs.stat(workflowPath);
    const mainPath = stat.isDirectory()
      ? path.join(workflowPath, 'main.nf')
      : workflowPath;
    return await fs.readFile(mainPath, 'utf8');
  } catch {
    return null;
  }
}

export async function checkMetaxPathPackageCompatibility(
  pkg: MetaxPathPackageForCompatibility | LoadedPackage,
  options: MetaxPathCompatibilityOptions = {}
): Promise<MetaxPathCompatibilityResult> {
  const version = pkg.manifest.package.version || 'unknown';
  const issues: string[] = [];
  const workflowPath = resolveWorkflowPath(pkg);
  const comparison = comparePackageVersions(version, METAXPATH_MIN_COMPATIBLE_VERSION);

  if (comparison === null || comparison < 0) {
    issues.push(
      `Installed MetaxPath package version ${version} is older than required ${METAXPATH_MIN_COMPATIBLE_VERSION}.`
    );
  }

  const workflowMain = await readWorkflowMain(workflowPath);
  if (workflowMain?.includes(METAXPATH_STALE_CHUNK_BREADTH_FLAG)) {
    issues.push(
      `Installed MetaxPath workflow still contains removed Metax CLI flag ${METAXPATH_STALE_CHUNK_BREADTH_FLAG}.`
    );
  }

  const supportedTargets = deriveManifestTargets(pkg.manifest, pkg.registry);
  if (
    options.requiredTarget &&
    !supportedTargets.includes(options.requiredTarget)
  ) {
    issues.push(
      `Installed MetaxPath package does not declare ${options.requiredTarget} target support.`
    );
  }

  return {
    compatible: issues.length === 0,
    version,
    minimumVersion: METAXPATH_MIN_COMPATIBLE_VERSION,
    issues,
    ...(workflowPath ? { workflowPath } : {}),
  };
}

export function buildMetaxPathCompatibilityMessage(
  result: MetaxPathCompatibilityResult
): string {
  const base =
    `MetaxPath package ${result.version} is not compatible with this SeqDesk launcher. ` +
    `Install or sync MetaxPath-Nextflow ${result.minimumVersion} or newer before starting this pipeline.`;
  if (result.issues.length === 0) return base;
  return `${base}\n${result.issues.join('\n')}`;
}
