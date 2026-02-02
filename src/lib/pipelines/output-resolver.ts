// Output Resolver
// Central place for writing pipeline outputs to the database.
//
// Uses outputs from:
// - Package manifest (pipelines/<id>/manifest.json)
//
// This is the ONLY place that writes pipeline outputs to the DB.
// Pipeline adapters discover outputs but do not write to DB.

import { db } from '@/lib/db';
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

/**
 * Create an Assembly record (with idempotency check)
 */
async function createAssembly(
  file: DiscoveredFile,
  runId: string,
  _output: DefinitionOutput
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
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
  _output: DefinitionOutput
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
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

/**
 * Map destination types to handler functions
 */
const skipDownloadOnly: DestinationHandler = async () => ({ success: true });

const destinationHandlers: Record<string, DestinationHandler> = {
  // Sample-scoped outputs
  sample_reads: createArtifact,
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
      } else if (artifactResult.error) {
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
        case 'download_only':
          break;
        default:
          result.artifactsCreated++;
      }
    } else if (handlerResult.error) {
      result.errors.push(handlerResult.error);
    }
  }

  // Add any errors from discovery
  result.errors.push(...discovered.errors);

  // Update success flag
  result.success = result.errors.length === 0 ||
    (result.assembliesCreated > 0 || result.binsCreated > 0 || result.artifactsCreated > 0);

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
