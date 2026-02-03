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
  destination: StandardDestination;
  type?: 'assembly' | 'bin' | 'report' | 'qc' | 'artifact';
  fromStep?: string;
  discovery: PackageOutputDiscovery;
  parsed?: PackageOutputParsed;
}

export interface PackageExecution {
  type: 'nextflow';
  pipeline: string;
  version: string;
  profiles: string[];
  defaultParams: Record<string, unknown>;
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
  inputs: PackageInput[];
  execution: PackageExecution;
  outputs: PackageOutput[];
  schema_requirements?: {
    tables: string[];
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
  };
}

export interface SamplesheetConfig {
  samplesheet: {
    format: 'csv' | 'tsv';
    filename: string;
    rows: {
      scope: PackageScope;
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
  website?: string;
  requires: Record<string, boolean>;
  outputs: RegistryOutput[];
  visibility: {
    showToUser: boolean;
    userCanStart: boolean;
  };
  input: {
    supportedScopes: string[];
    minSamples?: number;
    perSample: {
      reads: boolean;
      pairedEnd: boolean;
    };
  };
  samplesheet: {
    format: string;
    generator: string;
  };
  configSchema: {
    type: string;
    properties: Record<string, unknown>;
  };
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

/**
 * Get the path to the pipelines directory
 */
export function getPipelinesDir(): string {
  const possiblePaths = [
    path.join(process.cwd(), 'pipelines'),
    path.join(process.cwd(), '..', 'pipelines'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return possiblePaths[0];
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
    warnings.push(
      `Package ID mismatch: manifest.package.id="${manifest.package.id}" but folder is "${folderName}"`
    );
  }

  // 3. Validate definition.pipeline == manifest.package.id
  if (definition && definition.pipeline !== manifest.package.id) {
    warnings.push(
      `Definition pipeline mismatch: definition.pipeline="${definition.pipeline}" but manifest.package.id="${manifest.package.id}"`
    );
  }

  // 4. Validate registry.id == manifest.package.id
  if (registry && registry.id !== manifest.package.id) {
    warnings.push(
      `Registry ID mismatch: registry.id="${registry.id}" but manifest.package.id="${manifest.package.id}"`
    );
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
      const filePath = path.join(packageDir, file);
      if (!fs.existsSync(filePath)) {
        errors.push(`Missing file: files.${key}="${file}" not found`);
      }
    }
  }

  // Check parser files
  if (manifest.files.parsers) {
    for (const parserFile of manifest.files.parsers) {
      const parserPath = path.join(packageDir, parserFile);
      if (!fs.existsSync(parserPath)) {
        errors.push(`Missing parser file: "${parserFile}" not found`);
      }
    }
  }

  // 6. Validate parser IDs referenced in outputs[].parsed.from exist
  const parserIds = new Set<string>();
  if (manifest.files.parsers) {
    for (const parserFile of manifest.files.parsers) {
      const parserPath = path.join(packageDir, parserFile);
      const parserConfig = loadYaml<ParserConfig>(parserPath);
      if (parserConfig?.parser?.id) {
        parserIds.add(parserConfig.parser.id);
      }
    }
  }

  for (const output of manifest.outputs) {
    if (output.parsed?.from && !parserIds.has(output.parsed.from)) {
      errors.push(
        `Output "${output.id}" references unknown parser: "${output.parsed.from}"`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Load a single pipeline package from its directory
 */
function loadPackage(packageDir: string): LoadedPackage | null {
  const manifestPath = path.join(packageDir, 'manifest.json');

  // Load manifest (required)
  const manifest = loadJson<PackageManifest>(manifestPath);
  if (!manifest) {
    console.warn(`No manifest found in ${packageDir}`);
    return null;
  }

  const packageId = manifest.package.id;

  // Load definition
  const definitionPath = path.join(packageDir, manifest.files.definition);
  const definition = loadJson<DefinitionConfig>(definitionPath);
  if (!definition) {
    console.warn(`No definition found for package ${packageId}`);
    return null;
  }

  // Load registry
  const registryPath = path.join(packageDir, manifest.files.registry);
  const registry = loadJson<RegistryConfig>(registryPath);
  if (!registry) {
    console.warn(`No registry found for package ${packageId}`);
    return null;
  }

  // Validate manifest and consistency
  const validation = validatePackageManifest(packageDir, manifest, definition, registry);

  // Log warnings but continue
  for (const warning of validation.warnings) {
    console.warn(`[Package ${packageId}] Warning: ${warning}`);
  }

  // Fail fast on validation errors
  if (!validation.valid) {
    for (const error of validation.errors) {
      console.error(`[Package ${packageId}] Error: ${error}`);
    }
    console.error(`Package ${packageId} failed validation - skipping`);
    return null;
  }

  // Load samplesheet (optional)
  let samplesheet: SamplesheetConfig | null = null;
  if (manifest.files.samplesheet) {
    const samplesheetPath = path.join(packageDir, manifest.files.samplesheet);
    samplesheet = loadYaml<SamplesheetConfig>(samplesheetPath);
  }

  // Load parsers
  const parsers = new Map<string, ParserConfig>();
  if (manifest.files.parsers) {
    for (const parserFile of manifest.files.parsers) {
      const parserPath = path.join(packageDir, parserFile);
      const parserConfig = loadYaml<ParserConfig>(parserPath);
      if (parserConfig?.parser) {
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
}

/**
 * Scan the pipelines directory and load all packages
 */
function scanPackages(): void {
  if (packagesScanned) return;

  const pipelinesDir = getPipelinesDir();

  try {
    if (!fs.existsSync(pipelinesDir)) {
      console.warn(`Pipelines directory not found: ${pipelinesDir}`);
      packagesScanned = true;
      return;
    }

    const dirs = fs.readdirSync(pipelinesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .filter(d => !d.name.startsWith('.') && !d.name.startsWith('_'))
      .map(d => d.name);

    for (const dir of dirs) {
      const packageDir = path.join(pipelinesDir, dir);
      const pkg = loadPackage(packageDir);
      if (pkg) {
        packageCache.set(pkg.id, pkg);
        console.log(`Loaded pipeline package: ${pkg.id} (${pkg.manifest.package.name})`);
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
 * Get all loaded pipeline packages
 */
export function getAllPackages(): LoadedPackage[] {
  scanPackages();
  return Array.from(packageCache.values());
}

/**
 * Get all package IDs
 */
export function getAllPackageIds(): string[] {
  scanPackages();
  return Array.from(packageCache.keys());
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
      supportedScopes: registry.input.supportedScopes as ('study' | 'samples' | 'sample')[],
      minSamples: registry.input.minSamples,
      perSample: registry.input.perSample,
    },
    samplesheet: registry.samplesheet as PipelineDefinition['samplesheet'],
    configSchema: registry.configSchema as PipelineDefinition['configSchema'],
    defaultConfig: registry.defaultConfig,
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
      source: input.source as any,
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
      destination: output.destination as any,
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
      parameterGroups: definition.parameterGroups as any,
    },
  };
}

/**
 * Find step by Nextflow process name
 */
export function findStepByProcessFromPackage(
  packageId: string,
  processName: string
): PipelineStepDef | null {
  const pkg = getPackage(packageId);
  if (!pkg) return null;

  // Extract clean process name
  const withoutSuffix = processName.split(' ')[0];
  const parts = withoutSuffix.split(':');
  const cleanName = parts[parts.length - 1].toUpperCase();

  for (const step of pkg.definition.steps) {
    if (!step.processMatchers) continue;

    for (const matcher of step.processMatchers) {
      if (cleanName.includes(matcher.toUpperCase())) {
        return step as PipelineStepDef;
      }
    }
  }

  return null;
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
