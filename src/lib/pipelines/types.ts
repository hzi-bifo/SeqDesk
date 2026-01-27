// Pipeline system type definitions

export type PipelineCategory = 'analysis' | 'submission' | 'qc';

// Output types determine how results are handled
export type OutputType =
  | 'data'       // Creates new records (assemblies, bins, alignment files)
  | 'accession'  // Updates existing records with accession numbers
  | 'report'     // Generates viewable reports (HTML, PDF)
  | 'metric';    // Stores metrics in database

export type InputScope = 'study' | 'samples' | 'sample';

export interface PipelineOutput {
  type: OutputType;
  name: string;           // 'assemblies', 'bins', 'qc_report', etc.
  description: string;
  model?: string;         // Prisma model name if this creates DB records
  visibility: 'admin' | 'user' | 'both';
  downloadable?: boolean;
}

export interface PipelineInput {
  supportedScopes: InputScope[];
  minSamples?: number;
  maxSamples?: number;
  perSample: {
    reads: boolean;
    pairedEnd: boolean;
    assemblies?: boolean;
    bins?: boolean;
  };
}

export interface PipelineConfigSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    title: string;
    description?: string;
    default?: unknown;
    enum?: unknown[];
  }>;
  required?: string[];
}

export interface PipelineDefinition {
  id: string;
  name: string;
  description: string;
  category: PipelineCategory;
  version?: string;
  website?: string;

  // What the pipeline requires to run
  requires: {
    reads?: boolean;
    assemblies?: boolean;
    bins?: boolean;
    checksums?: boolean;
    studyAccession?: boolean;
    sampleMetadata?: boolean;
  };

  // Dependencies on other pipelines
  dependsOn?: string[];

  // What the pipeline outputs
  outputs: PipelineOutput[];

  // Visibility settings
  visibility: {
    showToUser: boolean;     // Show status to researchers
    userCanStart: boolean;   // Can researchers start this pipeline
  };

  // Input configuration
  input: PipelineInput;

  // Samplesheet generation
  samplesheet: {
    format: 'csv' | 'tsv' | 'yaml' | 'filelist';
    generator: string;  // Function name to generate samplesheet
  };

  // Configuration schema for admin settings
  configSchema: PipelineConfigSchema;
  defaultConfig: Record<string, unknown>;

  // UI
  icon: string;
}

// Pipeline run status
export type PipelineRunStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

// Step status within a pipeline run
export type PipelineStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

// Input for starting a pipeline run
export interface StartPipelineInput {
  pipelineId: string;
  studyId: string;
  sampleIds?: string[];  // If not provided, run on all samples in study
  config?: Record<string, unknown>;
}

// Result summary structure
export interface PipelineRunResult {
  assembliesCreated?: number;
  binsCreated?: number;
  artifactsCreated?: number;
  errors?: string[];
  warnings?: string[];
  metrics?: Record<string, unknown>;
}
