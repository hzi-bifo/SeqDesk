// Pipeline Adapter Interface
// Defines the contract for pipeline-specific logic that must be implemented
// for each pipeline to integrate with SeqDesk.
//
// The adapter encapsulates:
// - Input validation
// - Samplesheet generation
// - Output discovery
//
// NOTE: Adapters do NOT write to the database. They return discovered artifacts
// which are then processed by the Output Resolver.

import type { PipelineTarget } from '@/lib/pipelines/types';

/**
 * Result of validating pipeline inputs
 */
export interface ValidationResult {
  valid: boolean;
  issues: string[];
}

/**
 * Result of generating a samplesheet
 */
export interface SamplesheetResult {
  content: string;
  sampleCount: number;
  errors: string[];
}

/**
 * Options for samplesheet generation
 */
export interface SamplesheetOptions {
  target: PipelineTarget;
  dataBasePath: string;  // Base path for sequencing files
}

/**
 * A discovered output file from a pipeline run
 */
export interface DiscoveredFile {
  type: 'assembly' | 'bin' | 'artifact' | 'report' | 'qc';
  name: string;
  path: string;
  sampleId?: string;      // Database sample ID if sample-specific
  sampleName?: string;    // Sample name (sampleId field from Sample model)
  fromStep?: string;      // Step ID that produced this file
  outputId?: string;      // Optional manifest output ID for precise mapping
  metadata?: Record<string, unknown>;  // Additional metadata (e.g., completeness, contamination)
}

/**
 * Result of discovering outputs from a pipeline run
 */
export interface DiscoverOutputsResult {
  files: DiscoveredFile[];
  errors: string[];
  summary: {
    assembliesFound: number;
    binsFound: number;
    artifactsFound: number;
    reportsFound: number;
  };
}

/**
 * Options for output discovery
 */
export interface DiscoverOutputsOptions {
  runId: string;
  outputDir: string;
  target?: PipelineTarget;
  samples: Array<{
    id: string;        // Database ID
    sampleId: string;  // Sample identifier (e.g., "SAMP-001")
  }>;
}

/**
 * Pipeline Adapter Interface
 *
 * Each pipeline must implement this interface to integrate with SeqDesk.
 * The adapter handles pipeline-specific logic without writing to the database.
 */
export interface PipelineAdapter {
  /**
   * Pipeline identifier (must match definition.json pipeline field)
   */
  readonly pipelineId: string;

  /**
   * Validate that all required inputs are available for running the pipeline.
   *
   * @param target - The study/order target to validate
   * @returns Validation result with any issues found
   */
  validateInputs(
    target: PipelineTarget
  ): Promise<ValidationResult>;

  /**
   * Generate the samplesheet file content for the pipeline.
   *
   * @param options - Options for samplesheet generation
   * @returns Samplesheet content and any errors encountered
   */
  generateSamplesheet(
    options: SamplesheetOptions
  ): Promise<SamplesheetResult>;

  /**
   * Discover output files from a completed pipeline run.
   * This does NOT write to the database - it only returns discovered files.
   *
   * @param options - Options for output discovery
   * @returns Discovered files and summary
   */
  discoverOutputs(
    options: DiscoverOutputsOptions
  ): Promise<DiscoverOutputsResult>;
}

/**
 * Registry of available pipeline adapters
 */
const adapterRegistry = new Map<string, PipelineAdapter>();

/**
 * Register a pipeline adapter
 */
export function registerAdapter(adapter: PipelineAdapter): void {
  adapterRegistry.set(adapter.pipelineId, adapter);
}

/**
 * Get a pipeline adapter by ID
 */
export function getAdapter(pipelineId: string): PipelineAdapter | undefined {
  return adapterRegistry.get(pipelineId);
}

/**
 * Get all registered adapter IDs
 */
export function getRegisteredAdapterIds(): string[] {
  return Array.from(adapterRegistry.keys());
}
