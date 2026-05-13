import fs from 'fs/promises';
import path from 'path';
import type { LoadedPackage, PackageManifest } from './package-loader';
import { deriveManifestTargets } from './package-contracts';

export const METAXPATH_MIN_COMPATIBLE_VERSION = '0.1.1';
export const METAXPATH_STALE_CHUNK_BREADTH_FLAG = '--chunk-breadth';

export interface MetaxPathCompatibilityResult {
  compatible: boolean;
  version: string;
  minimumVersion: string;
  issues: string[];
  workflowPath?: string;
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
  pkg: MetaxPathPackageForCompatibility | LoadedPackage
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
  if (!supportedTargets.includes('study')) {
    issues.push(
      'Installed MetaxPath package does not declare study target support.'
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
