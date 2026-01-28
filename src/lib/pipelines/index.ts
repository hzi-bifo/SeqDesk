// Pipeline system exports

export * from './types';
export * from './registry';

// Package loader (new folder-based packages)
export {
  getPackage,
  getAllPackages,
  getAllPackageIds,
  hasPackage,
  getPackageManifest,
  getPackageDefinition,
  getPackageRegistry,
  getPackageSamplesheet,
  getPackageParsers,
  getParser,
  clearPackageCache,
  // Compatibility layer
  packageToPipelineDefinition,
  getAllPipelineDefinitionsFromPackages,
  packageToDagData,
  findStepByProcessFromPackage,
  getStepsFromPackage,
  // Types
  type LoadedPackage,
  type PackageManifest,
  type PackageInput,
  type PackageOutput,
  type PackageScope,
  type StandardDestination,
  type SamplesheetConfig,
  type SamplesheetColumn,
  type ParserConfig,
  type DefinitionConfig,
  type RegistryConfig,
} from './package-loader';

// Pipeline adapters (new pattern)
export { getAdapter, registerAdapter } from './adapters';
export { resolveOutputs, saveRunResults } from './output-resolver';
export { findStepByProcess, getStepsForPipeline, getStepById } from './definitions';

// Samplesheet generation
export {
  SamplesheetGenerator,
  generateSamplesheetFromConfig,
  hasSamplesheetConfig,
} from './samplesheet-generator';

// MAG pipeline runtime
export {
  generateRunNumber,
  prepareMagRun,
  updateRunStatus,
  processCompletedRun,
} from './mag/executor';
