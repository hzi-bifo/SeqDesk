// Pipeline Registry - defines available pipelines
//
// This module uses the package-loader as the single source of truth.

import { PipelineDefinition } from './types';
import {
  getAllPackages,
  getAllPackageIds,
  packageToPipelineDefinition,
} from './package-loader';

/**
 * Build the pipeline registry from loaded packages
 */
function buildRegistry(): Record<string, PipelineDefinition> {
  const registry: Record<string, PipelineDefinition> = {};

  // Load from packages (takes precedence over fallback)
  for (const pkg of getAllPackages()) {
    const def = packageToPipelineDefinition(pkg.id);
    if (def) {
      registry[pkg.id] = def;
    }
  }

  return registry;
}

// Lazy-initialized registry
let _registry: Record<string, PipelineDefinition> | null = null;

function getRegistry(): Record<string, PipelineDefinition> {
  if (!_registry) {
    _registry = buildRegistry();
  }
  return _registry;
}

/**
 * Clear the registry cache (useful for hot-reloading)
 */
export function clearRegistryCache(): void {
  _registry = null;
}

// Export the registry for backward compatibility
export const PIPELINE_REGISTRY = new Proxy({} as Record<string, PipelineDefinition>, {
  get(target, prop: string) {
    return getRegistry()[prop];
  },
  ownKeys() {
    return Object.keys(getRegistry());
  },
  getOwnPropertyDescriptor(target, prop: string) {
    const value = getRegistry()[prop];
    if (value) {
      return { configurable: true, enumerable: true, value };
    }
    return undefined;
  },
  has(target, prop: string) {
    return prop in getRegistry();
  },
});

// Get pipeline definition by ID
export function getPipelineDefinition(pipelineId: string): PipelineDefinition | undefined {
  return packageToPipelineDefinition(pipelineId);
}

// Get all enabled pipelines (based on PipelineConfig in database)
export function getAllPipelineIds(): string[] {
  return getAllPackageIds();
}

// Check if a pipeline can run on a study
export function canRunPipeline(
  pipelineId: string,
  study: {
    samples: Array<{
      reads: Array<{ file1: string | null; file2: string | null }>;
      assemblies: Array<{ id: string }>;
      bins: Array<{ id: string }>;
    }>;
    studyAccessionId: string | null;
  }
): { canRun: boolean; issues: string[] } {
  const pipeline = PIPELINE_REGISTRY[pipelineId];
  if (!pipeline) {
    return { canRun: false, issues: ['Pipeline not found'] };
  }

  const issues: string[] = [];

  // Check sample count
  if (pipeline.input.minSamples && study.samples.length < pipeline.input.minSamples) {
    issues.push(`Requires at least ${pipeline.input.minSamples} sample(s)`);
  }
  if (pipeline.input.maxSamples && study.samples.length > pipeline.input.maxSamples) {
    issues.push(`Maximum ${pipeline.input.maxSamples} sample(s) allowed`);
  }

  // Check requirements
  if (pipeline.requires.studyAccession && !study.studyAccessionId) {
    issues.push('Study must have an ENA accession number');
  }

  // Check per-sample requirements
  for (const sample of study.samples) {
    if (pipeline.input.perSample.reads) {
      const hasReads = sample.reads.some(r => r.file1);
      if (!hasReads) {
        issues.push('All samples must have reads assigned');
        break;
      }
    }

    if (pipeline.input.perSample.pairedEnd) {
      const hasPairedReads = sample.reads.some(r => r.file1 && r.file2);
      if (!hasPairedReads) {
        issues.push('All samples must have paired-end reads');
        break;
      }
    }

    if (pipeline.input.perSample.assemblies) {
      if (sample.assemblies.length === 0) {
        issues.push('All samples must have assemblies');
        break;
      }
    }

    if (pipeline.input.perSample.bins) {
      if (sample.bins.length === 0) {
        issues.push('All samples must have bins');
        break;
      }
    }
  }

  if (pipeline.requires.reads) {
    const anyReads = study.samples.some(s => s.reads.some(r => r.file1));
    if (!anyReads) {
      issues.push('Study must have samples with reads');
    }
  }

  if (pipeline.requires.assemblies) {
    const anyAssemblies = study.samples.some(s => s.assemblies.length > 0);
    if (!anyAssemblies) {
      issues.push('Study must have samples with assemblies');
    }
  }

  return {
    canRun: issues.length === 0,
    issues,
  };
}
