/**
 * SeqDesk Configuration Types
 *
 * Configuration can come from three sources (in order of priority):
 * 1. Environment variables (highest priority)
 * 2. Config file (seqdesk.config.json)
 * 3. Database settings (lowest priority, but UI-editable)
 */

export interface SiteConfig {
  /** Display name of the facility */
  name?: string;
  /** Base path for sequencing data storage */
  dataBasePath?: string;
  /** Contact email for the facility */
  contactEmail?: string;
}

export interface CondaConfig {
  enabled?: boolean;
  path?: string;
  environment?: string;
}

export interface SlurmConfig {
  enabled?: boolean;
  queue?: string;
  cores?: number;
  memory?: string;
  timeLimit?: number;
  /** Additional SLURM options */
  options?: string;
}

export interface PipelineExecutionConfig {
  /** Execution mode: local, slurm, or kubernetes */
  mode?: 'local' | 'slurm' | 'kubernetes';
  /** Directory for pipeline run outputs */
  runDirectory?: string;
  conda?: CondaConfig;
  slurm?: SlurmConfig;
}

export interface MagPipelineConfig {
  enabled?: boolean;
  version?: string;
  /** Use stub mode for testing (fast, no real analysis) */
  stubMode?: boolean;
  /** Skip Prokka annotation */
  skipProkka?: boolean;
  /** Skip CONCOCT binning */
  skipConcoct?: boolean;
}

export interface PipelinesConfig {
  /** Master switch for pipeline features */
  enabled?: boolean;
  execution?: PipelineExecutionConfig;
  mag?: MagPipelineConfig;
}

export interface EnaConfig {
  /** Use ENA test server (wwwdev.ebi.ac.uk) */
  testMode?: boolean;
  /** Webin account username */
  username?: string;
  /** Webin account password (prefer env var SEQDESK_ENA_PASSWORD) */
  password?: string;
  /** Center name for submissions */
  centerName?: string;
}

export interface SequencingFilesConfig {
  /** Allowed file extensions */
  extensions?: string[];
  /** How deep to scan directories */
  scanDepth?: number;
  /** Allow single-end reads (not just paired-end) */
  allowSingleEnd?: boolean;
  /** Patterns to ignore during scanning */
  ignorePatterns?: string[];
  /** Read simulation mode: auto uses templates if available, otherwise synthetic */
  simulationMode?: "auto" | "synthetic" | "template";
  /** Template directory for realistic simulation FASTQ pairs */
  simulationTemplateDir?: string;
}

export interface AuthConfig {
  /** Allow public registration */
  allowRegistration?: boolean;
  /** Require email verification */
  requireEmailVerification?: boolean;
  /** Session timeout in hours */
  sessionTimeout?: number;
}

/**
 * Complete SeqDesk configuration schema
 */
export interface SeqDeskConfig {
  site?: SiteConfig;
  pipelines?: PipelinesConfig;
  ena?: EnaConfig;
  sequencingFiles?: SequencingFilesConfig;
  auth?: AuthConfig;
}

/**
 * Configuration source tracking
 */
export type ConfigSource = 'env' | 'file' | 'database' | 'default';

export interface ConfigValue<T> {
  value: T;
  source: ConfigSource;
}

/**
 * Resolved configuration with source tracking
 */
export interface ResolvedConfig {
  config: SeqDeskConfig;
  sources: Record<string, ConfigSource>;
  filePath?: string;
  loadedAt: Date;
}
