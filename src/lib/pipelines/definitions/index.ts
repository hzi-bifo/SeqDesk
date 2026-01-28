// Pipeline Definitions Loader
//
// Definitions are loaded exclusively from pipeline packages (pipelines/<id>/).

import {
  findStepByProcessFromPackage,
  getAllPackageIds,
  getPackageDefinition as getPackageDefinitionFromPackage,
  getStepsFromPackage,
  hasPackage,
  packageToDagData,
} from '../package-loader';

export type StepCategory =
  | 'qc'
  | 'preprocessing'
  | 'assembly'
  | 'binning'
  | 'annotation'
  | 'quantification'
  | 'alignment'
  | 'variant_calling'
  | 'reporting';

export interface PipelineStepDef {
  id: string;
  name: string;
  description: string;
  category: StepCategory;
  dependsOn: string[];
  processMatchers?: string[]; // Nextflow process names to match this step
  tools?: string[];           // Tools/software used in this step
  outputs?: string[];         // File types produced by this step
  docs?: string;              // URL to documentation
  parameters?: string[];      // Parameter names relevant to this step
}

export interface PipelineParameter {
  name: string;
  type: 'string' | 'integer' | 'number' | 'boolean' | 'file' | 'path';
  description: string;
  default?: string | number | boolean;
  required?: boolean;
  enum?: (string | number)[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  group?: string;
  hidden?: boolean;
}

export interface PipelineParameterGroup {
  name: string;
  description?: string;
  parameters: PipelineParameter[];
}

export type SeqDeskSource =
  | 'order_reads'        // FASTQ files from order
  | 'order_files'        // Any files attached to order
  | 'sample_reads'       // Per-sample read files
  | 'samplesheet'        // Generated samplesheet
  | 'reference_genome'   // Reference from settings
  | 'manual';            // User provides manually

export type SeqDeskDestination =
  | 'sample_reads'       // Per-sample read files
  | 'sample_qc'          // Updates sample QC status
  | 'sample_metadata'    // Updates sample metadata fields
  | 'sample_assemblies'  // Stored as sample assemblies
  | 'sample_bins'        // Stored as sample genome bins
  | 'sample_annotations' // Stored as sample annotations
  | 'study_report'       // Study-level report
  | 'order_files'        // Stored as order output files
  | 'order_report'       // Linked as order report
  | 'run_artifact'       // Artifacts tied to pipeline run
  | 'download_only';     // Available for download only

export interface PipelineInput {
  id: string;
  name: string;
  description?: string;
  fileTypes?: string[];
  source?: SeqDeskSource;        // Where this input comes from in SeqDesk
  sourceDescription?: string;    // Human-readable description
}

export interface PipelineOutput {
  id: string;
  name: string;
  description?: string;
  fromStep: string;
  fileTypes?: string[];
  destination?: SeqDeskDestination;  // Where this output goes in SeqDesk
  destinationField?: string;         // Specific field it updates (e.g., "qc_status")
  destinationDescription?: string;   // Human-readable description
}

export interface PipelineDefinition {
  pipeline: string;
  name?: string;
  description?: string;
  url?: string;
  version?: string;
  minNextflowVersion?: string;
  authors?: string[];
  inputs?: PipelineInput[];
  outputs?: PipelineOutput[];
  steps: PipelineStepDef[];
  parameterGroups?: PipelineParameterGroup[];
}

export interface DagNode {
  id: string;
  name: string;
  description?: string;
  category?: string;
  order: number;
  nodeType: 'step' | 'input' | 'output';
  fileTypes?: string[];
  tools?: string[];           // Tools/software used (for steps)
  outputs?: string[];         // File types produced (for steps)
  docs?: string;              // URL to documentation
  parameters?: string[];      // Parameter names relevant to this step
  // SeqDesk integration
  source?: SeqDeskSource;
  sourceDescription?: string;
  destination?: SeqDeskDestination;
  destinationField?: string;
  destinationDescription?: string;
}

export interface DagEdge {
  from: string;
  to: string;
  label?: string;  // File types flowing through this edge
}

export interface DagData {
  nodes: DagNode[];
  edges: DagEdge[];
  pipeline?: {
    name?: string;
    description?: string;
    url?: string;
    version?: string;
    minNextflowVersion?: string;
    authors?: string[];
    parameterGroups?: PipelineParameterGroup[];
  };
}

/**
 * Get DAG data for a pipeline
 */
export function getPipelineDag(pipelineId: string): DagData | null {
  return packageToDagData(pipelineId);
}

/**
 * Get full pipeline definition
 */
export function getPipelineDefinition(pipelineId: string): PipelineDefinition | null {
  const definition = getPackageDefinitionFromPackage(pipelineId);
  return (definition as PipelineDefinition) || null;
}

/**
 * Get list of all available pipeline definitions
 */
export function getAvailablePipelineDefinitions(): string[] {
  return getAllPackageIds();
}

/**
 * Check if a pipeline has a definition
 */
export function hasPipelineDefinition(pipelineId: string): boolean {
  return hasPackage(pipelineId);
}

/**
 * Extract the process name from a Nextflow trace process string.
 * Nextflow process names come in formats like:
 * - "NFCORE_MAG:MAG:FASTQC_RAW (sample1)"
 * - "NFCORE_MAG:MAG:BINNING_PREP:BOWTIE2_ASSEMBLY_ALIGN (sample1)"
 * - "FASTQC"
 *
 * This function extracts the last process name component (e.g., "FASTQC_RAW", "BOWTIE2_ASSEMBLY_ALIGN")
 */
export function extractProcessName(traceProcessName: string): string {
  // Remove sample suffix like " (sample1)" if present
  const withoutSuffix = traceProcessName.split(' ')[0];

  // Get the last part after the final colon
  const parts = withoutSuffix.split(':');
  return parts[parts.length - 1];
}

/**
 * Find a step in a pipeline definition by matching a Nextflow process name.
 * This is the definition-driven replacement for MAG-specific step mapping.
 *
 * @param pipelineId - The pipeline ID (e.g., "mag")
 * @param processName - The Nextflow process name from trace/weblog
 * @returns The matching step definition, or null if not found
 */
export function findStepByProcess(
  pipelineId: string,
  processName: string
): PipelineStepDef | null {
  return findStepByProcessFromPackage(pipelineId, processName);
}

/**
 * Get all steps for a pipeline, sorted by dependency order.
 * This is used for initializing step progress when a run starts.
 *
 * @param pipelineId - The pipeline ID (e.g., "mag")
 * @returns Array of steps sorted by execution order, or empty array if not found
 */
export function getStepsForPipeline(pipelineId: string): PipelineStepDef[] {
  return getStepsFromPackage(pipelineId);
}

/**
 * Get a specific step by ID from a pipeline definition.
 *
 * @param pipelineId - The pipeline ID (e.g., "mag")
 * @param stepId - The step ID (e.g., "assembly")
 * @returns The step definition, or null if not found
 */
export function getStepById(
  pipelineId: string,
  stepId: string
): PipelineStepDef | null {
  const definition = getPackageDefinitionFromPackage(pipelineId);
  return definition?.steps.find((s) => s.id === stepId) as PipelineStepDef || null;
}
