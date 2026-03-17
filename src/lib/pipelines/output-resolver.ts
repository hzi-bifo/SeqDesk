// Output Resolver
// Central place for writing pipeline outputs to the database.
//
// Uses outputs from:
// - Package manifest (pipelines/<id>/manifest.json)
//
// This is the ONLY place that writes pipeline outputs to the DB.
// Pipeline adapters discover outputs but do not write to DB.

import fs from 'fs/promises';
import path from 'path';
import { db } from '@/lib/db';
import { ensureWithinBase } from '@/lib/files';
import { getResolvedDataBasePath } from '@/lib/files/data-base-path';
import { PipelineOutput as DefinitionOutput } from './definitions';
import { getPackage, PackageOutput } from './package-loader';
import { DiscoveredFile, DiscoverOutputsResult } from './adapters/types';

/**
 * Result of resolving outputs to database records
 */
export interface ResolveResult {
  success: boolean;
  assembliesCreated: number;
  binsCreated: number;
  artifactsCreated: number;
  errors: string[];
  warnings: string[];
}

/**
 * Map of destination types to their handlers
 */
type DestinationHandler = (
  file: DiscoveredFile,
  runId: string,
  output: DefinitionOutput
) => Promise<{ success: boolean; error?: string }>;

function getStringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string
): string | null | undefined {
  const value = metadata?.[key];
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : null;
}

function getNumberMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string
): number | null | undefined {
  const value = metadata?.[key];
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function getBooleanMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string
): boolean | undefined {
  const value = metadata?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

async function copyReadFileToStorage(
  dataBasePath: string,
  targetRelativePath: string,
  sourcePath: string
): Promise<void> {
  const targetAbsolutePath = ensureWithinBase(dataBasePath, targetRelativePath);
  await fs.mkdir(path.dirname(targetAbsolutePath), { recursive: true });
  if (path.resolve(sourcePath) === targetAbsolutePath) {
    return;
  }
  await fs.copyFile(sourcePath, targetAbsolutePath);
}

async function safeDeleteReadFile(
  dataBasePath: string,
  relativeOrAbsolutePath: string | null | undefined
): Promise<void> {
  if (!relativeOrAbsolutePath) return;

  try {
    const absolutePath = path.isAbsolute(relativeOrAbsolutePath)
      ? path.resolve(relativeOrAbsolutePath)
      : ensureWithinBase(dataBasePath, relativeOrAbsolutePath);

    const resolvedBase = path.resolve(dataBasePath);
    if (
      absolutePath !== resolvedBase &&
      !absolutePath.startsWith(`${resolvedBase}${path.sep}`)
    ) {
      return;
    }

    await fs.unlink(absolutePath);
  } catch {
    // Ignore missing files and path validation errors during cleanup.
  }
}

async function replaceSampleReads(
  sampleId: string,
  dataBasePath: string,
  readData: {
    file1: string;
    file2: string | null;
    checksum1: string | null | undefined;
    checksum2: string | null | undefined;
    readCount1: number | null | undefined;
    readCount2: number | null | undefined;
    avgQuality1: number | null | undefined;
    avgQuality2: number | null | undefined;
    fastqcReport1: string | null | undefined;
    fastqcReport2: string | null | undefined;
  }
): Promise<void> {
  const existingReads = await db.read.findMany({
    where: { sampleId },
    select: {
      id: true,
      file1: true,
      file2: true,
    },
  });

  for (const read of existingReads) {
    await safeDeleteReadFile(dataBasePath, read.file1);
    await safeDeleteReadFile(dataBasePath, read.file2);
  }

  if (existingReads.length > 0) {
    await db.read.deleteMany({
      where: { sampleId },
    });
  }

  await db.read.create({
    data: {
      sampleId,
      file1: readData.file1,
      file2: readData.file2,
      checksum1: readData.checksum1 ?? null,
      checksum2: readData.checksum2 ?? null,
      readCount1: readData.readCount1 ?? null,
      readCount2: readData.readCount2 ?? null,
      avgQuality1: readData.avgQuality1 ?? null,
      avgQuality2: readData.avgQuality2 ?? null,
      fastqcReport1: readData.fastqcReport1 ?? null,
      fastqcReport2: readData.fastqcReport2 ?? null,
    },
  });
}

/**
 * Create an Assembly record (with idempotency check)
 */
async function createAssembly(
  file: DiscoveredFile,
  runId: string,
  output: DefinitionOutput
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  void output;

  if (!file.sampleId) {
    return { success: false, error: `Assembly ${file.name}: No sample ID` };
  }

  try {
    // Check if assembly already exists for this run + sample + file
    const existing = await db.assembly.findFirst({
      where: {
        createdByPipelineRunId: runId,
        sampleId: file.sampleId,
        assemblyFile: file.path,
      },
    });

    if (existing) {
      return { success: true, skipped: true };
    }

    await db.assembly.create({
      data: {
        assemblyName: file.name,
        assemblyFile: file.path,
        sampleId: file.sampleId,
        createdByPipelineRunId: runId,
      },
    });
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to create assembly: ${msg}` };
  }
}

/**
 * Create a Bin record (with idempotency check)
 */
async function createBin(
  file: DiscoveredFile,
  runId: string,
  output: DefinitionOutput
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  void output;

  if (!file.sampleId) {
    return { success: false, error: `Bin ${file.name}: No sample ID` };
  }

  try {
    // Check if bin already exists for this run + sample + file
    const existing = await db.bin.findFirst({
      where: {
        createdByPipelineRunId: runId,
        sampleId: file.sampleId,
        binFile: file.path,
      },
    });

    if (existing) {
      return { success: true, skipped: true };
    }

    await db.bin.create({
      data: {
        binName: file.name,
        binFile: file.path,
        completeness: (file.metadata?.completeness as number) ?? null,
        contamination: (file.metadata?.contamination as number) ?? null,
        sampleId: file.sampleId,
        createdByPipelineRunId: runId,
      },
    });
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to create bin: ${msg}` };
  }
}

/**
 * Create a PipelineArtifact record (with idempotency check)
 */
async function createArtifact(
  file: DiscoveredFile,
  runId: string,
  output: DefinitionOutput
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  try {
    // Check if artifact already exists for this run + path
    const existing = await db.pipelineArtifact.findFirst({
      where: {
        pipelineRunId: runId,
        path: file.path,
      },
    });

    if (existing) {
      return { success: true, skipped: true };
    }

    await db.pipelineArtifact.create({
      data: {
        type: file.type === 'report' ? 'report' : file.type === 'qc' ? 'qc' : 'data',
        name: file.name,
        path: file.path,
        sampleId: file.sampleId || null,
        pipelineRunId: runId,
        producedByStepId: file.fromStep || output.fromStep,
        // Persist parsed metadata from adapters
        metadata: file.metadata ? JSON.stringify(file.metadata) : null,
      },
    });
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to create artifact: ${msg}` };
  }
}

async function updateSampleRead(
  file: DiscoveredFile,
  runId: string,
  output: DefinitionOutput
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  void runId;
  void output;

  if (!file.sampleId) {
    return { success: false, error: `Sample read output ${file.name}: No sample ID` };
  }

  const metadata = file.metadata;
  const file1 = getStringMetadata(metadata, 'file1');
  const file2 = getStringMetadata(metadata, 'file2');
  const sourceFile1 = getStringMetadata(metadata, 'sourceFile1');
  const sourceFile2 = getStringMetadata(metadata, 'sourceFile2');
  const replaceExisting = getBooleanMetadata(metadata, 'replaceExisting') === true;
  const hasFileWriteback = Boolean(file1 && sourceFile1);

  if (hasFileWriteback) {
    const resolvedDataBasePath = await getResolvedDataBasePath();

    if (!resolvedDataBasePath.dataBasePath) {
      return {
        success: false,
        error: `Sample read output ${file.name}: Data base path is not configured`,
      };
    }

    try {
      await copyReadFileToStorage(
        resolvedDataBasePath.dataBasePath,
        file1!,
        sourceFile1!
      );

      if (file2 && sourceFile2) {
        await copyReadFileToStorage(
          resolvedDataBasePath.dataBasePath,
          file2,
          sourceFile2
        );
      }

      if (replaceExisting) {
        await replaceSampleReads(file.sampleId, resolvedDataBasePath.dataBasePath, {
          file1: file1!,
          file2: file2 ?? null,
          checksum1: getStringMetadata(metadata, 'checksum1'),
          checksum2: getStringMetadata(metadata, 'checksum2'),
          readCount1: getNumberMetadata(metadata, 'readCount1'),
          readCount2: getNumberMetadata(metadata, 'readCount2'),
          avgQuality1: getNumberMetadata(metadata, 'avgQuality1'),
          avgQuality2: getNumberMetadata(metadata, 'avgQuality2'),
          fastqcReport1: getStringMetadata(metadata, 'fastqcReport1'),
          fastqcReport2: getStringMetadata(metadata, 'fastqcReport2'),
        });
        return { success: true };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: `Failed to materialize sample reads: ${msg}` };
    }
  }

  const read = await db.read.findFirst({
    where: { sampleId: file.sampleId },
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  if (!read) {
    return {
      success: false,
      error: `Sample read output ${file.name}: No canonical Read record found for sample`,
    };
  }

  const data: Record<string, string | number | null> = {};

  if (file1 !== undefined) {
    data.file1 = file1;
  }
  if (file2 !== undefined) {
    data.file2 = file2;
  }

  for (const key of ['checksum1', 'checksum2', 'fastqcReport1', 'fastqcReport2'] as const) {
    const value = getStringMetadata(metadata, key);
    if (value !== undefined) {
      data[key] = value;
    }
  }

  for (const key of ['readCount1', 'readCount2', 'avgQuality1', 'avgQuality2'] as const) {
    const value = getNumberMetadata(metadata, key);
    if (value !== undefined) {
      data[key] = value;
    }
  }

  if (Object.keys(data).length === 0) {
    return { success: true, skipped: true };
  }

  try {
    await db.read.update({
      where: { id: read.id },
      data,
    });
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to update sample read metadata: ${msg}` };
  }
}

/**
 * Map destination types to handler functions
 */
const skipDownloadOnly: DestinationHandler = async () => ({ success: true });

const destinationHandlers: Record<string, DestinationHandler> = {
  // Sample-scoped outputs
  sample_reads: updateSampleRead,
  sample_assemblies: createAssembly,
  sample_bins: createBin,
  sample_qc: createArtifact,
  sample_metadata: createArtifact,
  sample_annotations: createArtifact,
  // Study-scoped outputs
  study_report: createArtifact,
  // Order-scoped outputs
  order_report: createArtifact,
  order_files: createArtifact,
  // Run-scoped outputs
  run_artifact: createArtifact,
  // Download only (no DB record)
  download_only: skipDownloadOnly,
};

/**
 * Find the output definition that matches a discovered file
 */
/**
 * Convert PackageOutput to DefinitionOutput for compatibility
 */
function packageOutputToDefinitionOutput(pkgOutput: PackageOutput): DefinitionOutput {
  return {
    id: pkgOutput.id,
    name: pkgOutput.id,
    fromStep: '', // Filled by DiscoveredFile.fromStep when available
    destination: pkgOutput.destination,
  };
}

/**
 * Find the package output that matches a discovered file
 */
function findMatchingPackageOutput(
  file: DiscoveredFile,
  outputs: PackageOutput[]
): DefinitionOutput | null {
  if (file.outputId) {
    const byId = outputs.find(o => o.id === file.outputId);
    if (byId) return packageOutputToDefinitionOutput(byId);
  }

  const scopePriority = file.sampleId
    ? ['sample', 'study', 'order', 'run']
    : ['study', 'order', 'run', 'sample'];

  const destinationPriorityByType: Record<DiscoveredFile['type'], PackageOutput['destination'][]> = {
    assembly: ['sample_assemblies'],
    bin: ['sample_bins'],
    report: ['study_report', 'order_report', 'run_artifact'],
    qc: ['sample_qc', 'study_report', 'run_artifact'],
    artifact: ['run_artifact', 'order_files', 'download_only'],
  };

  const destinationPriority = destinationPriorityByType[file.type] || [];

  for (const scope of scopePriority) {
    for (const destination of destinationPriority) {
      const match = outputs.find(o => o.scope === scope && o.destination === destination);
      if (match) return packageOutputToDefinitionOutput(match);
    }
  }

  for (const destination of destinationPriority) {
    const match = outputs.find(o => o.destination === destination);
    if (match) return packageOutputToDefinitionOutput(match);
  }

  return null;
}

/**
 * Resolve discovered outputs to database records
 *
 * @param pipelineId - The pipeline ID (e.g., "mag")
 * @param runId - The pipeline run ID
 * @param discovered - The discovered outputs from the adapter
 * @returns Result with counts and any errors
 */
export async function resolveOutputs(
  pipelineId: string,
  runId: string,
  discovered: DiscoverOutputsResult
): Promise<ResolveResult> {
  const result: ResolveResult = {
    success: true,
    assembliesCreated: 0,
    binsCreated: 0,
    artifactsCreated: 0,
    errors: [],
    warnings: [],
  };

  const pkg = getPackage(pipelineId);
  if (!pkg) {
    result.success = false;
    result.errors.push(`Pipeline package not found: ${pipelineId}`);
    return result;
  }

  const packageOutputs = pkg.manifest.outputs || [];

  // Process each discovered file
  for (const file of discovered.files) {
    // Find matching output definition
    let output: DefinitionOutput | null = null;

    output = findMatchingPackageOutput(file, packageOutputs);

    if (!output) {
      result.warnings.push(`No output definition found for ${file.type}: ${file.name}`);
      // Default to creating an artifact
      const artifactResult = await createArtifact(file, runId, {
        id: file.type,
        name: file.name,
        fromStep: file.fromStep || 'unknown',
      });
    if (artifactResult.success) {
      result.artifactsCreated++;
    }
    if (artifactResult.error) {
      result.warnings.push(artifactResult.error);
    }
      continue;
    }

    // Get the handler for this destination
    const destination = output.destination || 'download_only';
    const handler = destinationHandlers[destination];

    if (!handler) {
      result.warnings.push(`Unknown destination type: ${destination}`);
      continue;
    }

    // Execute the handler
    const handlerResult = await handler(file, runId, output);

    if (handlerResult.success) {
      switch (destination) {
        case 'sample_assemblies':
          result.assembliesCreated++;
          break;
        case 'sample_bins':
          result.binsCreated++;
          break;
        case 'sample_reads':
        case 'download_only':
          break;
        default:
          result.artifactsCreated++;
      }
    }
    if (handlerResult.error) {
      result.errors.push(handlerResult.error);
    }
  }

  // Add any errors from discovery
  result.errors.push(...discovered.errors);

  // Update success flag - only true when there are no errors
  result.success = result.errors.length === 0;

  return result;
}

/**
 * Save the resolve result to the pipeline run record
 */
export async function saveRunResults(
  runId: string,
  result: ResolveResult
): Promise<void> {
  const results = {
    assembliesCreated: result.assembliesCreated,
    binsCreated: result.binsCreated,
    artifactsCreated: result.artifactsCreated,
    errors: result.errors.length > 0 ? result.errors : undefined,
    warnings: result.warnings.length > 0 ? result.warnings : undefined,
  };

  await db.pipelineRun.update({
    where: { id: runId },
    data: {
      results: JSON.stringify(results),
    },
  });
}
