/**
 * Pipeline Package Loader
 *
 * Loads self-contained pipeline packages from pipelines/<id>/ folders.
 * Each package contains:
 * - manifest.json (source of truth)
 * - definition.json (DAG steps, process matchers)
 * - registry.json (UI config, schema)
 * - samplesheet.yaml (declarative samplesheet rules)
 * - parsers/*.yaml (output parsers)
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { ManifestSchema } from './manifest-schema';
import {
  DefinitionRuntimeSchema,
  ParserRuntimeSchema,
  RegistryRuntimeSchema,
  SamplesheetRuntimeSchema,
} from './package-descriptor-schema';
import {
  getPipelinesDir,
  hasSupportedCustomPipelineRunner,
  isInstallWorkingDirectory,
  isLocalPipelineReference,
  resolvePathWithinDirectory,
} from './pipeline-paths';
import { readPipelinePackageGenerationSync } from './package-cache-generation';
import { normalizePipelinePerSampleInput } from './read-mode';
import {
  type PackageOutputResultContract,
  type PackageOutputWriteback,
  type PackageTargetType,
  deriveCompatibleInputScopes,
  inferPipelineResultContract,
} from './package-contracts';
import type {
  PipelineParameterGroup,
  SeqDeskDestination,
  SeqDeskSource,
} from './definitions';
import type {
  PipelineConfigProperty,
  PipelineConfigSchema,
  PipelineReadMode,
  PipelineSampleResult,
} from './types';

// ============================================================================
// Package Types
// ============================================================================

export type PackageScope = 'sample' | 'study' | 'order' | 'run';

export type StandardDestination =
  | 'sample_reads'
  | 'sample_assemblies'
  | 'sample_bins'
  | 'sample_annotations'
  | 'sample_qc'
  | 'sample_metadata'
  | 'study_report'
  | 'order_report'
  | 'order_files'
  | 'run_artifact'
  | 'download_only';

export interface PackageInput {
  id: string;
  scope: PackageScope;
  source: string;         // e.g., "sample.reads", "order.platform"
  required: boolean;
  filters?: {
    paired?: boolean;
    [key: string]: unknown;
  };
  transform?: {
    type: string;
    mapping?: Record<string, string>;
    strict?: boolean;
    [key: string]: unknown;
  };
}

export interface PackageOutputDiscovery {
  pattern: string;
  fallbackPattern?: string;
  matchSampleBy?: 'filename' | 'parent_dir' | 'path';
  dependsOn?: string;
}

export interface PackageOutputParsed {
  from: string;       // Parser ID
  matchBy: string;    // Field to match (e.g., "bin_name")
  map: Record<string, string>;  // Field mapping
}

export interface PackageOutput {
  id: string;
  scope: PackageScope;
  /**
   * Whether finalization must discover this output before marking a run
   * terminal. Defaults to true. Set false only for genuinely optional branches
   * (for example MAG bins when binning is disabled).
   */
  required?: boolean;
  destination: StandardDestination;
  type?: 'assembly' | 'bin' | 'report' | 'qc' | 'artifact';
  fromStep?: string;
  discovery: PackageOutputDiscovery;
  parsed?: PackageOutputParsed;
  result?: PackageOutputResultContract;
  writeback?: PackageOutputWriteback;
}

export interface PackageExecution {
  type: 'nextflow';
  pipeline: string;
  version: string;
  profiles: string[];
  defaultParams: Record<string, unknown>;
  /**
   * Optional declarative staging of outputs from completed runs that share the
   * current study. The executor copies only the listed output IDs into the new
   * run folder and injects that directory through configKey.
   */
  priorRunArtifacts?: {
    scope: 'study';
    configKey: string;
    sources: Record<string, string[]>;
  };
  paramMap?: Record<string, string>;
  paramRules?: Array<{
    when: Record<string, unknown>;
    add: Array<string | { flag: string; value: unknown }>;
  }>;
  runtime?: {
    allowMacOsArmConda?: boolean;
    /** When true, skip Conda profile on macOS ARM and run using locally installed tools */
    allowMacOsArmLocal?: boolean;
    /**
     * Extra environment variables exported into the generated run script just before the
     * nextflow launch. Use for per-pipeline runtime knobs the nf-core ecosystem needs — e.g.
     * `NXF_SYNTAX_PARSER: "v1"` for older-template pipelines (detaxizer 1.3.0) that Nextflow
     * 24.10+'s strict v2 parser rejects. Scoped to the one pipeline, so it never perturbs others.
     */
    env?: Record<string, string>;
  };
}

export interface PackageSequencingCompatibility {
  readLengthClass?: 'short' | 'long' | 'both' | 'unknown';
  readLayouts?: Array<'single' | 'paired'>;
  platformFamilies?: string[];
}

export interface PackageManifest {
  package: {
    id: string;
    name: string;
    version: string;
    description: string;
    website?: string;
    provider?: string;
  };
  files: {
    definition: string;
    registry: string;
    samplesheet: string;
    parsers: string[];
    readme?: string;
    scripts?: {
      samplesheet?: string;
      discoverOutputs?: string;
    };
  };
  targets?: {
    supported: PackageTargetType[];
  };
  sequencingCompatibility?: PackageSequencingCompatibility;
  inputs: PackageInput[];
  execution: PackageExecution;
  outputs: PackageOutput[];
  schema_requirements?: {
    tables: string[];
  };
  ui?: {
    sampleResult?: PipelineSampleResult;
  };
}

// Samplesheet types (from YAML)
export interface SamplesheetColumn {
  name: string;
  source: string | null;
  description?: string;
  required?: boolean;
  default?: string;
  filters?: Record<string, unknown>;
  transform?: {
    type: string;
    base?: string;
    mapping?: Record<string, string>;
    strict?: boolean;
  };
}

export interface SamplesheetConfig {
  samplesheet: {
    format: 'csv' | 'tsv';
    filename: string;
    rows: {
      scope: 'sample';
    };
    columns: SamplesheetColumn[];
  };
}

// Parser types (from YAML)
export interface ParserColumn {
  name: string;
  index: number;
  type?: 'string' | 'int' | 'float' | 'boolean';
}

export interface ParserConfig {
  parser: {
    id: string;
    type: 'tsv' | 'csv' | 'json';
    description: string;
    trigger: {
      filePattern: string;
    };
    skipHeader?: boolean;
    columns: ParserColumn[];
  };
}

// Registry types (UI config)
export interface RegistryOutput {
  type: 'data' | 'metric' | 'report';
  name: string;
  description: string;
  model?: string;
  visibility: 'admin' | 'user' | 'both';
  downloadable?: boolean;
}

export interface RegistryConfig {
  id: string;
  name: string;
  description: string;
  category: 'analysis' | 'submission' | 'qc';
  version: string;
  sortOrder?: number;
  website?: string;
  requires: Record<string, boolean>;
  outputs: RegistryOutput[];
  visibility: {
    showToUser: boolean;
    userCanStart: boolean;
  };
  input: {
    supportedScopes: Array<'study' | 'order' | 'samples' | 'sample'>;
    minSamples?: number;
    perSample: {
      reads: boolean;
      pairedEnd: boolean;
      readMode?: PipelineReadMode;
      assemblies?: boolean;
      bins?: boolean;
    };
  };
  sequencingCompatibility?: PackageSequencingCompatibility;
  samplesheet: {
    format: string;
    generator: string;
  };
  configSchema: PipelineConfigSchema;
  defaultConfig: Record<string, unknown>;
  icon: string;
}

// Definition types (DAG)
export interface DefinitionStep {
  id: string;
  name: string;
  description: string;
  category: string;
  dependsOn: string[];
  processMatchers?: string[];
  tools?: string[];
  outputs?: string[];
  docs?: string;
  parameters?: string[];
}

export interface DefinitionInput {
  id: string;
  name: string;
  description?: string;
  fileTypes?: string[];
  source?: string;
  sourceDescription?: string;
}

export interface DefinitionOutput {
  id: string;
  name: string;
  description?: string;
  fromStep: string;
  fileTypes?: string[];
  destination?: string;
  destinationField?: string;
  destinationDescription?: string;
  integrationStatus?: 'implemented' | 'partial' | 'planned';
  _implementationNote?: string;
  _designNote?: string;
}

export interface DefinitionConfig {
  pipeline: string;
  name: string;
  description: string;
  url?: string;
  version: string;
  minNextflowVersion?: string;
  authors?: string[];
  samplesheet?: {
    description?: string;
    columns?: Array<{
      name: string;
      source: string;
      description?: string;
      required?: boolean;
      transform?: string;
      default?: string;
    }>;
    validation?: {
      requirePairedReads?: boolean;
      requirePlatform?: boolean;
    };
  };
  inputs?: DefinitionInput[];
  outputs?: DefinitionOutput[];
  outputDiscovery?: unknown;
  steps: DefinitionStep[];
  parameterGroups?: Array<{
    name: string;
    description?: string;
    parameters: Array<{
      name: string;
      type: string;
      description?: string;
      default?: unknown;
      required?: boolean;
      enum?: unknown[];
      minimum?: number;
      maximum?: number;
    }>;
  }>;
}

// Fully loaded package
export interface LoadedPackage {
  id: string;
  basePath: string;
  manifest: PackageManifest;
  definition: DefinitionConfig;
  registry: RegistryConfig;
  samplesheet: SamplesheetConfig | null;
  parsers: Map<string, ParserConfig>;
}

// ============================================================================
// Package Loader
// ============================================================================

// Cache for loaded packages
const packageCache = new Map<string, LoadedPackage>();
let packagesScanned = false;
let lastScannedGeneration: string | null = null;

export { getPipelinesDir } from './pipeline-paths';

/**
 * Return a cheap process-independent cache token. Including the resolved
 * directory makes changing SEQDESK_PIPELINES_DIR invalidate caches even when
 * neither directory has a generation marker yet.
 */
export function getPackageCacheGeneration(): string {
  const pipelinesDir = path.resolve(getPipelinesDir());
  return `${pipelinesDir}\0${readPipelinePackageGenerationSync(pipelinesDir)}`;
}

/**
 * Load a YAML file and parse it
 */
function loadYaml<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return yaml.load(content) as T;
  } catch (error) {
    console.error(`Failed to load YAML from ${filePath}:`, error);
    return null;
  }
}

/**
 * Load a JSON file and parse it
 */
function loadJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error) {
    console.error(`Failed to load JSON from ${filePath}:`, error);
    return null;
  }
}

/**
 * Validation result for a package
 */
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function resolveManifestPath(
  packageDir: string,
  relativePath: string,
  label: string,
  errors: string[],
  options: { allowBase?: boolean } = {}
): string | null {
  try {
    return resolvePathWithinDirectory(packageDir, relativePath, label, options);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : `Invalid ${label}`);
    return null;
  }
}

/**
 * Validate a package manifest and its consistency with other package files
 */
function validatePackageManifest(
  packageDir: string,
  manifest: PackageManifest,
  definition: DefinitionConfig | null,
  registry: RegistryConfig | null
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const folderName = path.basename(packageDir);

  // 1. Validate manifest against schema
  const schemaResult = ManifestSchema.safeParse({
    manifestVersion: 1, // Add default version for backwards compatibility
    ...manifest,
  });
  if (!schemaResult.success) {
    for (const issue of schemaResult.error.issues) {
      errors.push(`Schema: ${issue.path.join('.')} - ${issue.message}`);
    }
  }

  // 2. Validate folder name == manifest.package.id
  if (manifest.package.id !== folderName) {
    errors.push(
      `Package ID mismatch: manifest.package.id="${manifest.package.id}" but folder is "${folderName}"`
    );
  }

  // 3. Validate definition.pipeline == manifest.package.id
  if (definition && definition.pipeline !== manifest.package.id) {
    errors.push(
      `Definition pipeline mismatch: definition.pipeline="${definition.pipeline}" but manifest.package.id="${manifest.package.id}"`
    );
  }

  // 4. Validate registry.id == manifest.package.id
  if (registry && registry.id !== manifest.package.id) {
    errors.push(
      `Registry ID mismatch: registry.id="${registry.id}" but manifest.package.id="${manifest.package.id}"`
    );
  }

  const pipelineReference = manifest.execution.pipeline.trim();
  if (isLocalPipelineReference(pipelineReference)) {
    const localPipelinePath = resolveManifestPath(
      packageDir,
      pipelineReference,
      'execution.pipeline',
      errors,
      { allowBase: true }
    );
    if (
      localPipelinePath &&
      !fs.existsSync(localPipelinePath) &&
      !hasSupportedCustomPipelineRunner(manifest)
    ) {
      errors.push(
        `Missing local execution.pipeline path: "${pipelineReference}" not found`
      );
    }
  }

  // 5. Check all files in manifest.files.* exist
  const filesToCheck: Array<{ key: string; file: string | undefined }> = [
    { key: 'definition', file: manifest.files.definition },
    { key: 'registry', file: manifest.files.registry },
    { key: 'samplesheet', file: manifest.files.samplesheet },
    { key: 'readme', file: manifest.files.readme },
  ];

  for (const { key, file } of filesToCheck) {
    if (file) {
      const filePath = resolveManifestPath(
        packageDir,
        file,
        `files.${key}`,
        errors
      );
      if (filePath && !fs.existsSync(filePath)) {
        errors.push(`Missing file: files.${key}="${file}" not found`);
      }
    }
  }

  // Check parser files
  if (manifest.files.parsers) {
    for (const parserFile of manifest.files.parsers) {
      const parserPath = resolveManifestPath(
        packageDir,
        parserFile,
        "parser path",
        errors
      );
      if (parserPath && !fs.existsSync(parserPath)) {
        errors.push(`Missing parser file: "${parserFile}" not found`);
      }
    }
  }

  if (manifest.files.scripts) {
    for (const [scriptKey, scriptFile] of Object.entries(manifest.files.scripts)) {
      if (!scriptFile) continue;
      const scriptPath = resolveManifestPath(
        packageDir,
        scriptFile,
        `files.scripts.${scriptKey}`,
        errors
      );
      if (scriptPath && !fs.existsSync(scriptPath)) {
        errors.push(`Missing script file: files.scripts.${scriptKey}="${scriptFile}" not found`);
      }
    }
  }

  // 6. Validate parser IDs referenced in outputs[].parsed.from exist
  const parserColumns = new Map<string, Set<string>>();
  if (manifest.files.parsers) {
    for (const parserFile of manifest.files.parsers) {
      const parserPath = resolveManifestPath(
        packageDir,
        parserFile,
        "parser path",
        errors
      );
      if (!parserPath) continue;
      const parserRaw = loadYaml<unknown>(parserPath);
      const parserResult = ParserRuntimeSchema.safeParse(parserRaw);
      if (!parserResult.success) {
        errors.push(`Invalid parser descriptor: "${parserFile}"`);
      } else {
        const parserId = parserResult.data.parser.id;
        if (parserColumns.has(parserId)) {
          errors.push(`Duplicate parser ID: "${parserId}"`);
        } else {
          const columnNames = new Set<string>();
          for (const column of parserResult.data.parser.columns) {
            if (columnNames.has(column.name)) {
              errors.push(
                `Parser "${parserId}" has duplicate column name "${column.name}"`
              );
            }
            columnNames.add(column.name);
          }
          parserColumns.set(parserId, columnNames);
        }
      }
    }
  }

  for (const output of manifest.outputs) {
    if (
      output.scope === 'sample' &&
      output.required !== false &&
      !output.discovery.matchSampleBy &&
      !manifest.files.scripts?.discoverOutputs
    ) {
      errors.push(
        `Required sample output "${output.id}" must define discovery.matchSampleBy unless a custom discoverOutputs script supplies sample IDs`
      );
    }

    if (output.parsed) {
      const columns = parserColumns.get(output.parsed.from);
      if (!columns) {
        errors.push(
          `Output "${output.id}" references unknown parser: "${output.parsed.from}"`
        );
      } else {
        if (!columns.has(output.parsed.matchBy)) {
          errors.push(
            `Output "${output.id}" references unknown parser match column: "${output.parsed.matchBy}"`
          );
        }
        for (const sourceColumn of Object.values(output.parsed.map)) {
          if (!columns.has(sourceColumn)) {
            errors.push(
              `Output "${output.id}" maps unknown parser column: "${sourceColumn}"`
            );
          }
        }
      }
    }

    if (output.writeback?.target === 'Read') {
      if (output.destination !== 'sample_reads') {
        errors.push(
          `Output "${output.id}" uses Read writeback but destination is "${output.destination}" instead of "sample_reads"`
        );
      }

      if (output.scope !== 'sample') {
        errors.push(
          `Output "${output.id}" uses Read writeback but scope is "${output.scope}" instead of "sample"`
        );
      }
    }

    const result = inferPipelineResultContract(output);
    if (result.kind === 'sample_read_candidate') {
      if (output.destination !== 'run_artifact') {
        errors.push(
          `Output "${output.id}" stages read candidates but destination is "${output.destination}" instead of "run_artifact"`
        );
      }

      if (output.scope !== 'sample') {
        errors.push(
          `Output "${output.id}" stages read candidates but scope is "${output.scope}" instead of "sample"`
        );
      }

      if (result.writebackPolicy !== 'admin_review') {
        warnings.push(
          `Output "${output.id}" stages read candidates without an explicit admin_review writeback policy`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function mergeSeqDeskUi(
  property: PipelineConfigProperty,
  ui: NonNullable<PipelineConfigProperty['x-seqdesk']>
): PipelineConfigProperty {
  return {
    ...property,
    'x-seqdesk': {
      ...(property['x-seqdesk'] || {}),
      ...ui,
      derive: ui.derive
        ? {
            ...(property['x-seqdesk']?.derive || {}),
            ...ui.derive,
          }
        : property['x-seqdesk']?.derive,
    },
  };
}

function upsertConfigProperty(
  registry: RegistryConfig,
  key: string,
  property: PipelineConfigProperty
): void {
  registry.configSchema.properties[key] = {
    ...(registry.configSchema.properties[key] || {}),
    ...property,
    'x-seqdesk': {
      ...(registry.configSchema.properties[key]?.['x-seqdesk'] || {}),
      ...(property['x-seqdesk'] || {}),
    },
  };
}

function annotateConfigProperty(
  registry: RegistryConfig,
  key: string,
  ui: NonNullable<PipelineConfigProperty['x-seqdesk']>,
  overrides: Partial<PipelineConfigProperty> = {}
): void {
  const property = registry.configSchema.properties[key];
  if (!property) return;
  registry.configSchema.properties[key] = mergeSeqDeskUi(
    {
      ...property,
      ...overrides,
    },
    ui
  );
}

const METAXPATH_SEQUENCER_MODE_MAP: Record<string, string> = {
  'oxford-nanopore': 'Nanopore',
  oxford_nanopore: 'Nanopore',
  'oxford nanopore': 'Nanopore',
  nanopore: 'Nanopore',
  ont: 'Nanopore',
  'ont-minion': 'Nanopore',
  'ont-gridion': 'Nanopore',
  'ont-promethion': 'Nanopore',
  minion: 'Nanopore',
  gridion: 'Nanopore',
  promethion: 'Nanopore',
  pacbio: 'PacBio',
  'pacbio-revio': 'PacBio',
  'pacbio-sequel2': 'PacBio',
  revio: 'PacBio',
  sequel: 'PacBio',
  sequel2: 'PacBio',
  'sequel ii': 'PacBio',
  'sequel ii/iie': 'PacBio',
};

function normalizeMetaxPathRegistry(registry?: RegistryConfig): void {
  if (!registry) return;

  upsertConfigProperty(registry, 'sequencer', {
    type: 'string',
    title: 'Sequencing Mode',
    description: 'Derived from the selected order sequencing technology.',
    enum: ['Nanopore', 'PacBio'],
    default: 'Nanopore',
    'x-seqdesk': {
      placement: 'derived',
      group: 'analysis',
      derive: {
        source: 'order.sequencingTechnology.platformFamily',
        map: METAXPATH_SEQUENCER_MODE_MAP,
        requireSingleValue: true,
      },
      helpText:
        'SeqDesk derives this from the selected samples’ order sequencing technology. A run must contain only Nanopore samples or only PacBio samples.',
    },
  });

  upsertConfigProperty(registry, 'skipSylph', {
    type: 'boolean',
    title: 'Sylph Profiling',
    description: 'Add optional Sylph k-mer abundance profiling.',
    default: false,
    'x-seqdesk': {
      placement: 'basic',
      group: 'analysis',
      booleanMode: 'inverse',
      helpText:
        'Runs Sylph k-mer based taxonomic abundance profiling as an additional evidence branch. Disable this only when the Sylph database is not installed or the extra profiling branch is not needed.',
    },
  });

  upsertConfigProperty(registry, 'skipVirulence', {
    type: 'boolean',
    title: 'Virulence Search',
    description: 'Search assemblies for virulence factors with VFDB/BLAST.',
    default: false,
    'x-seqdesk': {
      placement: 'basic',
      group: 'analysis',
      booleanMode: 'inverse',
      helpText:
        'Searches assembled contigs against VFDB with BLAST to report virulence factor hits for profiled species.',
    },
  });

  upsertConfigProperty(registry, 'skipAmr', {
    type: 'boolean',
    title: 'AMR Prediction',
    description: 'Predict antimicrobial resistance markers for detected pathogens.',
    default: false,
    'x-seqdesk': {
      placement: 'basic',
      group: 'analysis',
      booleanMode: 'inverse',
      helpText:
        'Predicts antimicrobial resistance markers with ResFinder/PointFinder and Kover where the required databases and species models are available.',
    },
  });

  upsertConfigProperty(registry, 'assemblers', {
    type: 'string',
    title: 'Assemblers',
    description: 'Comma-separated assembler list passed to MetaxPath.',
    default: registry.defaultConfig.assemblers || 'metaflye',
    'x-seqdesk': {
      placement: 'advanced',
      group: 'analysis',
      helpText:
        'Comma-separated assembler list passed to MetaxPath. Keep the default unless comparing assembler branches intentionally.',
    },
  });
  upsertConfigProperty(registry, 'threads', {
    type: 'number',
    title: 'Threads',
    description: 'CPU threads requested by compute-heavy pipeline steps.',
    default: registry.defaultConfig.threads || 20,
    minimum: 1,
    'x-seqdesk': {
      placement: 'advanced',
      group: 'runtime',
      helpText:
        'CPU threads requested by compute-heavy pipeline steps. Slurm still controls scheduling and cluster resource allocation.',
    },
  });
  upsertConfigProperty(registry, 'topn', {
    type: 'number',
    title: 'Top N Report Rows',
    description: 'Number of top taxa included in final report tables.',
    default: registry.defaultConfig.topn || 50,
    minimum: 1,
    'x-seqdesk': {
      placement: 'advanced',
      group: 'reporting',
      helpText:
        'Number of top taxa included in final combined report tables and HTML output.',
    },
  });

  upsertConfigProperty(registry, 'kraken2MemoryMapping', {
    type: 'boolean',
    title: 'Kraken2 Memory Mapping',
    description: 'Use Kraken2 memory mapping for large PlusPF databases.',
    default: false,
    'x-seqdesk': {
      placement: 'advanced',
      group: 'runtime',
      helpText:
        'Reduces Kraken2 startup memory pressure for large databases such as PlusPF. Recommended on Slurm systems with strict cgroup memory limits.',
    },
  });
  if (!Object.prototype.hasOwnProperty.call(registry.defaultConfig, 'kraken2MemoryMapping')) {
    registry.defaultConfig.kraken2MemoryMapping = false;
  }

  const adminKeys = [
    'metaxDb',
    'metaxDmpDir',
    'kraken2Db',
    'sylphDb',
    'vfdbCore',
    'resfinderDb',
    'pointfinderDb',
    'refIndex',
    'notificationEmails',
  ];
  for (const key of adminKeys) {
    annotateConfigProperty(registry, key, {
      placement: key === 'refIndex' ? 'hidden' : 'admin',
      group: 'databases',
    });
  }
}

function normalizeMetaxPathCompatibility(
  manifest: PackageManifest,
  registry?: RegistryConfig
): void {
  if (manifest.package.id !== 'metaxpath') return;

  manifest.execution.paramMap = {
    ...manifest.execution.paramMap,
    paramsFile: '-params-file',
    kraken2MemoryMapping:
      manifest.execution.paramMap?.kraken2MemoryMapping || '--kraken2_memory_mapping',
  };
  manifest.execution.defaultParams = {
    ...manifest.execution.defaultParams,
    kraken2MemoryMapping:
      manifest.execution.defaultParams.kraken2MemoryMapping ?? false,
  };
  normalizeMetaxPathRegistry(registry);
}

/**
 * Load a single pipeline package from its directory
 */
function loadPackage(packageDir: string): LoadedPackage | null {
  try {
    const manifestPath = path.join(packageDir, 'manifest.json');

    // Parse and validate the raw shape before dereferencing package/files fields.
    const manifestRaw = loadJson<unknown>(manifestPath);
    if (!manifestRaw) {
      console.warn(`No valid manifest found in ${packageDir}`);
      return null;
    }
    const manifestResult = ManifestSchema.safeParse({
      manifestVersion: 1,
      ...manifestRaw,
    });
    if (!manifestResult.success) {
      for (const issue of manifestResult.error.issues) {
        console.error(
          `[Package ${path.basename(packageDir)}] Error: Schema: ${issue.path.join('.')} - ${issue.message}`
        );
      }
      return null;
    }
    const manifest = manifestResult.data as PackageManifest;
    const packageId = manifest.package.id;

    const definitionPath = resolvePathWithinDirectory(
      packageDir,
      manifest.files.definition,
      'definition path'
    );
    const definitionRaw = loadJson<unknown>(definitionPath);
    const definitionResult = DefinitionRuntimeSchema.safeParse(definitionRaw);
    if (!definitionResult.success) {
      console.warn(`Invalid definition for package ${packageId}`);
      return null;
    }
    const definition = definitionResult.data as DefinitionConfig;

    const registryPath = resolvePathWithinDirectory(
      packageDir,
      manifest.files.registry,
      'registry path'
    );
    const registryRaw = loadJson<unknown>(registryPath);
    const registryResult = RegistryRuntimeSchema.safeParse(registryRaw);
    if (!registryResult.success) {
      console.warn(`Invalid registry for package ${packageId}`);
      return null;
    }
    const registry = registryResult.data as RegistryConfig;

    const validation = validatePackageManifest(packageDir, manifest, definition, registry);
    for (const warning of validation.warnings) {
      console.warn(`[Package ${packageId}] Warning: ${warning}`);
    }
    if (!validation.valid) {
      for (const error of validation.errors) {
        console.error(`[Package ${packageId}] Error: ${error}`);
      }
      console.error(`Package ${packageId} failed validation - skipping`);
      return null;
    }

    normalizeMetaxPathCompatibility(manifest, registry);

    let samplesheet: SamplesheetConfig | null = null;
    if (manifest.files.samplesheet) {
      const samplesheetPath = resolvePathWithinDirectory(
        packageDir,
        manifest.files.samplesheet,
        'samplesheet path'
      );
      const samplesheetResult = SamplesheetRuntimeSchema.safeParse(
        loadYaml<unknown>(samplesheetPath)
      );
      if (!samplesheetResult.success) {
        console.warn(`Invalid samplesheet for package ${packageId}`);
        return null;
      }
      samplesheet = samplesheetResult.data as SamplesheetConfig;
    }

    const parsers = new Map<string, ParserConfig>();
    if (manifest.files.parsers) {
      for (const parserFile of manifest.files.parsers) {
        const parserPath = resolvePathWithinDirectory(
          packageDir,
          parserFile,
          'parser path'
        );
        const parserResult = ParserRuntimeSchema.safeParse(
          loadYaml<unknown>(parserPath)
        );
        if (parserResult.success) {
          const parserConfig = parserResult.data as ParserConfig;
          parsers.set(parserConfig.parser.id, parserConfig);
        }
      }
    }

    return {
      id: packageId,
      basePath: packageDir,
      manifest,
      definition,
      registry,
      samplesheet,
      parsers,
    };
  } catch (error) {
    console.error(
      `Failed to load pipeline package from ${packageDir}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/**
 * Scan the pipelines directory and load all packages
 */
function scanPackages(): void {
  const pipelinesDir = getPipelinesDir();
  const scanGeneration = getPackageCacheGeneration();
  if (packagesScanned && lastScannedGeneration === scanGeneration) return;

  // A generation change means another process may have installed, updated, or
  // recovered a package. Never merge a new scan into stale cache entries.
  packageCache.clear();
  packagesScanned = false;
  lastScannedGeneration = scanGeneration;

  try {
    if (!fs.existsSync(pipelinesDir)) {
      console.warn(`Pipelines directory not found: ${pipelinesDir}`);
      packagesScanned = true;
      return;
    }

    const dirs = fs.readdirSync(pipelinesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .filter(d => !d.name.startsWith('.') && !d.name.startsWith('_'))
      .filter(d => !isInstallWorkingDirectory(d.name))
      .map(d => d.name);

    for (const dir of dirs) {
      const packageDir = path.join(pipelinesDir, dir);
      try {
        const pkg = loadPackage(packageDir);
        if (pkg) {
          packageCache.set(pkg.id, pkg);
          console.log(`Loaded pipeline package: ${pkg.id} (${pkg.manifest.package.name})`);
        }
      } catch (error) {
        // A malformed third-party package must not hide every package that is
        // scanned after it.
        console.error(
          `Failed to scan pipeline package directory ${packageDir}:`,
          error
        );
      }
    }

    packagesScanned = true;
  } catch (error) {
    console.error('Failed to scan pipeline packages:', error);
    packagesScanned = true;
  }
}

/**
 * Clear the package cache (useful for hot-reloading in development)
 */
export function clearPackageCache(): void {
  packageCache.clear();
  packagesScanned = false;
  lastScannedGeneration = null;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get a loaded pipeline package by ID
 */
export function getPackage(packageId: string): LoadedPackage | undefined {
  scanPackages();
  return packageCache.get(packageId);
}

/**
 * Get all loaded pipeline packages, sorted by registry sortOrder (then name).
 */
export function getAllPackages(): LoadedPackage[] {
  scanPackages();
  return Array.from(packageCache.values()).sort(compareBySortOrder);
}

/**
 * Get all package IDs, sorted by registry sortOrder (then name).
 */
export function getAllPackageIds(): string[] {
  scanPackages();
  return Array.from(packageCache.values())
    .sort(compareBySortOrder)
    .map((pkg) => pkg.id);
}

function compareBySortOrder(a: LoadedPackage, b: LoadedPackage): number {
  const orderA = a.registry.sortOrder ?? 999;
  const orderB = b.registry.sortOrder ?? 999;
  if (orderA !== orderB) return orderA - orderB;
  return a.registry.name.localeCompare(b.registry.name);
}

/**
 * Check if a package exists
 */
export function hasPackage(packageId: string): boolean {
  scanPackages();
  return packageCache.has(packageId);
}

/**
 * Get the manifest for a package
 */
export function getPackageManifest(packageId: string): PackageManifest | undefined {
  const pkg = getPackage(packageId);
  return pkg?.manifest;
}

/**
 * Get the definition for a package
 */
export function getPackageDefinition(packageId: string): DefinitionConfig | undefined {
  const pkg = getPackage(packageId);
  return pkg?.definition;
}

/**
 * Get the registry config for a package
 */
export function getPackageRegistry(packageId: string): RegistryConfig | undefined {
  const pkg = getPackage(packageId);
  return pkg?.registry;
}

/**
 * Get the samplesheet config for a package
 */
export function getPackageSamplesheet(packageId: string): SamplesheetConfig | null {
  const pkg = getPackage(packageId);
  return pkg?.samplesheet ?? null;
}

export function getPackageScriptPath(
  packageId: string,
  scriptKey: 'samplesheet' | 'discoverOutputs'
): string | null {
  const pkg = getPackage(packageId);
  const scriptPath = pkg?.manifest.files.scripts?.[scriptKey];
  if (!pkg || !scriptPath) return null;
  return path.join(pkg.basePath, scriptPath);
}

/**
 * Get all parsers for a package
 */
export function getPackageParsers(packageId: string): Map<string, ParserConfig> {
  const pkg = getPackage(packageId);
  return pkg?.parsers ?? new Map();
}

/**
 * Get a specific parser by ID
 */
export function getParser(packageId: string, parserId: string): ParserConfig | undefined {
  const parsers = getPackageParsers(packageId);
  return parsers.get(parserId);
}

// ============================================================================
// Compatibility Layer
// ============================================================================
// These functions provide backward compatibility with the old system

import type { PipelineDefinition } from './types';
import type { PipelineStepDef, DagData, DagNode, DagEdge } from './definitions';

/**
 * Convert package registry to old PipelineDefinition format
 * This provides backward compatibility with existing code
 */
export function packageToPipelineDefinition(packageId: string): PipelineDefinition | undefined {
  const pkg = getPackage(packageId);
  if (!pkg) return undefined;

  const registry = pkg.registry;

  return {
    id: registry.id,
    name: registry.name,
    description: registry.description,
    category: registry.category,
    version: registry.version,
    website: registry.website,
    requires: registry.requires as PipelineDefinition['requires'],
    outputs: registry.outputs.map(o => ({
      type: o.type,
      name: o.name,
      description: o.description,
      model: o.model,
      visibility: o.visibility,
      downloadable: o.downloadable,
    })),
    visibility: registry.visibility,
    input: {
      supportedScopes: deriveCompatibleInputScopes(
        pkg.manifest,
        registry
      ) as PipelineDefinition['input']['supportedScopes'],
      minSamples: registry.input.minSamples,
      perSample: normalizePipelinePerSampleInput(registry.input.perSample),
    },
    samplesheet: registry.samplesheet as PipelineDefinition['samplesheet'],
    configSchema: registry.configSchema as PipelineDefinition['configSchema'],
    defaultConfig: registry.defaultConfig,
    sampleResult: pkg.manifest.ui?.sampleResult,
    icon: registry.icon,
  };
}

/**
 * Get all pipeline definitions (compatibility layer)
 */
export function getAllPipelineDefinitionsFromPackages(): Record<string, PipelineDefinition> {
  const result: Record<string, PipelineDefinition> = {};

  for (const pkg of getAllPackages()) {
    const def = packageToPipelineDefinition(pkg.id);
    if (def) {
      result[pkg.id] = def;
    }
  }

  return result;
}

/**
 * Convert package definition to DAG data
 */
export function packageToDagData(packageId: string): DagData | null {
  const pkg = getPackage(packageId);
  if (!pkg) return null;

  const definition = pkg.definition;
  const steps = definition.steps;
  const inputs = definition.inputs || [];
  const outputs = definition.outputs || [];

  // Topological sort for ordering
  const order = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  steps.forEach((s) => {
    inDegree.set(s.id, 0);
    adj.set(s.id, []);
  });

  steps.forEach((s) => {
    s.dependsOn.forEach((dep) => {
      adj.get(dep)?.push(s.id);
      inDegree.set(s.id, (inDegree.get(s.id) || 0) + 1);
    });
  });

  const queue: string[] = [];
  inDegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });

  let orderNum = 1;
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.set(current, orderNum++);
    adj.get(current)?.forEach((next) => {
      const newDeg = (inDegree.get(next) || 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    });
  }

  const maxOrder = Math.max(...Array.from(order.values()), 0);

  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];

  // Build step outputs map for edge labels
  const stepOutputs = new Map<string, string[]>();
  steps.forEach((s) => {
    if (s.outputs) {
      stepOutputs.set(s.id, s.outputs);
    }
  });

  // Add input nodes
  inputs.forEach((input) => {
    nodes.push({
      id: `input_${input.id}`,
      name: input.name,
      description: input.description,
      category: 'input',
      order: 0,
      nodeType: 'input',
      fileTypes: input.fileTypes,
      source: input.source as SeqDeskSource | undefined,
      sourceDescription: input.sourceDescription,
    });
    // Connect to all root steps
    const rootSteps = steps.filter((s) => s.dependsOn.length === 0);
    for (const rootStep of rootSteps) {
      edges.push({ from: `input_${input.id}`, to: rootStep.id, label: input.fileTypes?.join(', ') });
    }
  });

  // Add step nodes
  steps.forEach((s) => {
    nodes.push({
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category,
      order: order.get(s.id) || 0,
      nodeType: 'step',
      tools: s.tools,
      outputs: s.outputs,
      docs: s.docs,
      parameters: s.parameters,
    });
  });

  // Add step edges
  steps.forEach((s) => {
    s.dependsOn.forEach((dep) => {
      const depOutputs = stepOutputs.get(dep);
      edges.push({ from: dep, to: s.id, label: depOutputs?.join(', ') });
    });
  });

  // Add output nodes
  outputs.forEach((output) => {
    nodes.push({
      id: `output_${output.id}`,
      name: output.name,
      description: output.description,
      category: 'output',
      order: maxOrder + 1,
      nodeType: 'output',
      fileTypes: output.fileTypes,
      destination: output.destination as SeqDeskDestination | undefined,
      destinationField: output.destinationField,
      destinationDescription: output.destinationDescription,
    });
    if (output.fromStep) {
      edges.push({
        from: output.fromStep,
        to: `output_${output.id}`,
        label: output.fileTypes?.join(', '),
      });
    }
  });

  return {
    nodes,
    edges,
    pipeline: {
      name: definition.name,
      description: definition.description,
      url: definition.url,
      version: definition.version,
      minNextflowVersion: definition.minNextflowVersion,
      authors: definition.authors,
      parameterGroups: definition.parameterGroups as PipelineParameterGroup[] | undefined,
    },
  };
}

function cleanProcessName(processName: string): string {
  const withoutSuffix = processName.split(' ')[0];
  const parts = withoutSuffix.split(':');
  return (parts[parts.length - 1] || '').toUpperCase();
}

function isRegexLikeMatcher(matcher: string): boolean {
  return /[\\^$.*+?()[\]{}|]/.test(matcher);
}

function scoreProcessMatcher(matcher: string, cleanName: string): number | null {
  const trimmedMatcher = matcher.trim();
  if (!trimmedMatcher) return null;

  if (isRegexLikeMatcher(trimmedMatcher)) {
    try {
      return new RegExp(trimmedMatcher, 'i').test(cleanName)
        ? 700 + trimmedMatcher.length
        : null;
    } catch {
      return null;
    }
  }

  const upperMatcher = trimmedMatcher.toUpperCase();
  if (cleanName === upperMatcher) {
    return 1000 + upperMatcher.length;
  }

  if (cleanName.includes(upperMatcher)) {
    return 300 + upperMatcher.length;
  }

  return null;
}

/**
 * Find step by Nextflow process name.
 *
 * Prefer exact process matcher hits over broader substring or regex matches so
 * steps like FASTQC_TRIMMED do not get swallowed by a generic FASTQC matcher.
 */
export function findStepByProcessFromPackage(
  packageId: string,
  processName: string
): PipelineStepDef | null {
  const pkg = getPackage(packageId);
  if (!pkg) return null;

  const cleanName = cleanProcessName(processName);
  let bestMatch: { step: PipelineStepDef; score: number } | null = null;

  for (const step of pkg.definition.steps) {
    if (!step.processMatchers) continue;

    for (const matcher of step.processMatchers) {
      const score = scoreProcessMatcher(matcher, cleanName);
      if (score === null) continue;

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { step: step as PipelineStepDef, score };
      }
    }
  }

  return bestMatch?.step ?? null;
}

/**
 * Get all steps for a package, sorted by dependency order
 */
export function getStepsFromPackage(packageId: string): PipelineStepDef[] {
  const pkg = getPackage(packageId);
  if (!pkg) return [];

  const steps = pkg.definition.steps;

  // Topological sort
  const order = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  steps.forEach((s) => {
    inDegree.set(s.id, 0);
    adj.set(s.id, []);
  });

  steps.forEach((s) => {
    s.dependsOn.forEach((dep) => {
      adj.get(dep)?.push(s.id);
      inDegree.set(s.id, (inDegree.get(s.id) || 0) + 1);
    });
  });

  const queue: string[] = [];
  inDegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });

  let orderNum = 1;
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.set(current, orderNum++);
    adj.get(current)?.forEach((next) => {
      const newDeg = (inDegree.get(next) || 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    });
  }

  return [...steps].sort((a, b) => {
    return (order.get(a.id) || 0) - (order.get(b.id) || 0);
  }) as PipelineStepDef[];
}
