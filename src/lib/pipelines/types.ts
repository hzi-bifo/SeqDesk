// Pipeline system type definitions

export type PipelineCategory = 'analysis' | 'submission' | 'qc';

// Output types determine how results are handled
export type OutputType =
  | 'data'       // Creates new records (assemblies, bins, alignment files)
  | 'accession'  // Updates existing records with accession numbers
  | 'report'     // Generates viewable reports (HTML, PDF)
  | 'metric';    // Stores metrics in database

export type InputScope = 'study' | 'order' | 'samples' | 'sample';

export type PipelineTargetType = 'study' | 'order';
export type PipelineReadMode = 'single_or_paired' | 'paired_only';

export interface StudyPipelineTarget {
  type: 'study';
  studyId: string;
  sampleIds?: string[];
}

export interface OrderPipelineTarget {
  type: 'order';
  orderId: string;
  sampleIds?: string[];
}

export type PipelineTarget = StudyPipelineTarget | OrderPipelineTarget;

export interface PipelineOutput {
  type: OutputType;
  name: string;           // 'assemblies', 'bins', 'qc_report', etc.
  description: string;
  model?: string;         // Prisma model name if this creates DB records
  visibility: 'admin' | 'user' | 'both';
  downloadable?: boolean;
}

export interface PipelinePerSampleInput {
  reads: boolean;
  pairedEnd: boolean;
  readMode?: PipelineReadMode;
  assemblies?: boolean;
  bins?: boolean;
}

export interface PipelineInput {
  supportedScopes: InputScope[];
  minSamples?: number;
  maxSamples?: number;
  perSample: PipelinePerSampleInput;
}

export interface PipelineConfigSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    title: string;
    description?: string;
    default?: unknown;
    enum?: unknown[];
    minimum?: number;
    maximum?: number;
  }>;
  required?: string[];
}

export type PipelineSampleResultFormat = 'text' | 'hash_prefix' | 'filename';
export type PipelineSampleResultLayout = 'stack' | 'columns';

export interface PipelineSampleResultValue {
  label?: string;
  path: string;
  whenPathExists?: string;
  format?: PipelineSampleResultFormat;
  truncate?: number;
  /** When true, the value is an HTML file path that can be previewed in-browser */
  previewable?: boolean;
}

export interface PipelineSampleResult {
  columnLabel: string;
  emptyText?: string;
  layout?: PipelineSampleResultLayout;
  values: PipelineSampleResultValue[];
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
  sampleResult?: PipelineSampleResult;

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
  studyId?: string;
  orderId?: string;
  sampleIds?: string[];  // If not provided, run on all samples in target
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
