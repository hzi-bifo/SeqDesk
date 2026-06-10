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
  /** Shared Nextflow conda cacheDir so per-process envs are reused across runs. */
  cacheDir?: string;
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

export interface PipelineExecutionOverrideConfig {
  mode?: 'inherit' | 'local' | 'slurm';
  slurm?: Partial<SlurmConfig>;
  slurmQueue?: string;
  slurmCores?: number;
  slurmMemory?: string;
  slurmTimeLimit?: number;
  slurmOptions?: string;
  clusterOptions?: string;
  nextflowProfile?: string;
}

export interface PipelineExecutionConfig {
  /** Execution mode: local, slurm, or kubernetes */
  mode?: 'local' | 'slurm' | 'kubernetes';
  /** Directory for pipeline run outputs */
  runDirectory?: string;
  conda?: CondaConfig;
  slurm?: SlurmConfig;
  /** Optional per-pipeline execution defaults */
  pipelineOverrides?: Record<string, PipelineExecutionOverrideConfig>;
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
  /** Optional shared root directory for large pipeline database assets */
  databaseDirectory?: string;
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
  /** Whether this Webin account has ENA broker permissions */
  brokerAccount?: boolean;
  /** Center name for broker submissions */
  centerName?: string;
}

export interface SequencingFilesConfig {
  /** Allowed file extensions */
  extensions?: string[];
  /** Allowed file extensions; hosted profile alias for extensions */
  allowedExtensions?: string[];
  /** How deep to scan directories */
  scanDepth?: number;
  /** Allow single-end reads (not just paired-end) */
  allowSingleEnd?: boolean;
  /** Patterns to ignore during scanning */
  ignorePatterns?: string[];
  /** Automatically link discovered files to samples when names match */
  autoAssign?: boolean;
  /** Minimum age for active-write file stability checks */
  activeWriteMinAgeMs?: number;
  /** Read simulation mode: auto uses templates if available, otherwise synthetic */
  simulationMode?: "auto" | "synthetic" | "template";
  /** Template directory for realistic simulation FASTQ pairs */
  simulationTemplateDir?: string;
}

export interface AccessConfig {
  /** Allow users to share submitted orders within their department */
  departmentSharing?: boolean;
  /** Allow users to delete submitted orders */
  allowDeleteSubmittedOrders?: boolean;
  /** Allow users to download assembly outputs */
  allowUserAssemblyDownload?: boolean;
  /** Enable order notes/comments */
  orderNotesEnabled?: boolean;
  /** Facility instructions shown after order submission */
  postSubmissionInstructions?: string;
}

export interface AuthConfig {
  /** Allow public registration */
  allowRegistration?: boolean;
  /** Require email verification */
  requireEmailVerification?: boolean;
  /** Session timeout in hours */
  sessionTimeout?: number;
}

export interface TelemetryConfig {
  /** Opt-in anonymous operational telemetry */
  enabled?: boolean;
  /** Telemetry heartbeat endpoint */
  endpoint?: string;
  /** Minimum hours between automatic heartbeats */
  intervalHours?: number;
}

export type NotificationProvider = "seqdesk-relay";

export interface NotificationEventConfig {
  order?: {
    submitted?: boolean;
    statusChanged?: boolean;
    samplesSent?: boolean;
  };
  ticket?: {
    created?: boolean;
    reply?: boolean;
  };
}

export interface NotificationUserDefaults {
  orders?: boolean;
  support?: boolean;
}

export interface InAppNotificationConfig {
  /** Master switch for the in-app notification panel/channel */
  enabled?: boolean;
}

export interface NotificationConfig {
  /** Master switch for hosted SeqDesk email notification relay */
  enabled?: boolean;
  inApp?: InAppNotificationConfig;
  provider?: NotificationProvider;
  relayUrl?: string;
  /** Scoped hosted profile token. Never expose through client APIs. */
  relayToken?: string;
  events?: NotificationEventConfig;
  userDefaults?: NotificationUserDefaults;
}

export interface AccountValidationModuleSettings {
  /** Email domains accepted for automatic account validation */
  allowedDomains?: string[];
  /** Require allowed-domain validation for new accounts */
  enforceValidation?: boolean;
}

export interface RangeSetting {
  min?: number;
  max?: number;
}

export interface BillingInfoModuleSettings {
  pspEnabled?: boolean;
  pspPrefixRange?: RangeSetting;
  pspMainDigits?: number;
  pspSuffixRange?: RangeSetting;
  pspExample?: string;
  costCenterEnabled?: boolean;
  costCenterPattern?: string;
  costCenterExample?: string;
}

export interface ModuleSettingsConfig {
  "account-validation"?: AccountValidationModuleSettings;
  "billing-info"?: BillingInfoModuleSettings;
}

export interface AppConfig {
  /** App listen port for generated start scripts */
  port?: number;
}

export interface RuntimeConfig {
  /** Runtime database URL (maps to DATABASE_URL) */
  databaseUrl?: string;
  /** Optional direct PostgreSQL URL for Prisma migrations/CLI (maps to DIRECT_URL) */
  directUrl?: string;
  /** Runtime NextAuth URL (maps to NEXTAUTH_URL) */
  nextAuthUrl?: string;
  /** Runtime NextAuth secret (maps to NEXTAUTH_SECRET) */
  nextAuthSecret?: string;
  /** API key for AI validation/extraction routes */
  anthropicApiKey?: string;
  /** Release publishing admin secret for scripts */
  adminSecret?: string;
  /** Vercel Blob token for release publishing scripts */
  blobReadWriteToken?: string;
  /** Optional override for update server URL */
  updateServer?: string;
}

export interface InstallProfileConfig {
  /** Hosted install profile id from seqdesk.org/admin */
  id?: string;
  /** Human-readable hosted profile name */
  name?: string;
  /** Hosted profile version */
  version?: string;
  /** Timestamp when this profile metadata was written locally */
  appliedAt?: string;
}

/**
 * Complete SeqDesk configuration schema
 */
export interface SeqDeskConfig {
  app?: AppConfig;
  installProfile?: InstallProfileConfig;
  site?: SiteConfig;
  pipelines?: PipelinesConfig;
  ena?: EnaConfig;
  sequencingFiles?: SequencingFilesConfig;
  access?: AccessConfig;
  auth?: AuthConfig;
  moduleSettings?: ModuleSettingsConfig;
  telemetry?: TelemetryConfig;
  notifications?: NotificationConfig;
  runtime?: RuntimeConfig;
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
