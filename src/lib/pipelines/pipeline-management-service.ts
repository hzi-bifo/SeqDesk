import { db } from "@/lib/db";
import { getResolvedDataBasePath } from "@/lib/files/data-base-path";
import { PIPELINE_REGISTRY, getAllPipelineIds } from "@/lib/pipelines";
import {
  getPipelineDatabaseStatuses,
  type PipelineDatabaseStatus,
} from "./database-downloads";
import {
  parsePipelineAllowlist,
  resolvePipelineEnabled,
} from "./enablement";
import { getExecutionSettings } from "./execution-settings";
import { resolvePipelineExecutionPolicy } from "./execution-policy";
import {
  getPackageManifest,
  type PackageManifest,
} from "./package-loader";
import { getPipelineDownloadStatus } from "./nextflow-downloads";
import { isLocalPipelineReference } from "./pipeline-paths";
import {
  checkPipelineRuntimePrerequisites,
  type PrerequisiteCheck,
} from "./prerequisite-check";
import {
  collectMetaxPathRuntimeWarnings,
} from "./metaxpath-compatibility";
import {
  deriveManifestTargets,
  derivePipelineCapabilities,
  derivePipelineCatalogs,
  matchesPipelineCatalog,
  type PackageTargetType,
  type PipelineCapabilities,
  type PipelineCatalog,
} from "./package-contracts";
import type {
  PipelineConfigSchema,
  PipelineDefinition,
} from "./types";
import {
  buildManagedPipelineReadiness,
  deriveManagedActivationState,
  deriveManagedSetupState,
  extendConfigSchemaWithTechnologyAllowlist,
  extendDefaultConfigWithTechnologyAllowlist,
  getBlockingReadinessDetails,
  getManagedNextActions,
  inspectManagedLocalPath,
  isPipelineConfigRecord,
  parsePipelineConfig,
  validateManagedPipelineConfig,
  type LocalPathInspection,
  type ManagedPipelineNextAction,
  type ManagedPipelineActivationState,
  type ManagedPipelineSetupState,
  type PipelineReadiness,
} from "./pipeline-readiness-service";
import {
  readPipelineInstallProvenance,
  type PipelineInstallProvenance,
} from "./pipeline-install-provenance";
import {
  findUniqueStorePipeline,
  loadPipelineStoreCatalog,
  type DuplicatePipelineRegistryEntry,
  type LoadPipelineStoreCatalogOptions,
  type PipelineStoreSourceError,
} from "./pipeline-store-service";
import type {
  PipelineSourceDescriptor,
  RegistryCategoryEntry,
  RegistrySourceConfig,
  StorePipelineResponse,
} from "./store-sources";

export type {
  ManagedPipelineActivationState,
  ManagedPipelineSetupState,
} from "./pipeline-readiness-service";

export type ManagedPipelinePackageState =
  | "bundled"
  | "installed"
  | "available";
export interface ManagedPipelineCatalogEntry {
  id: string;
  pipelineId: string;
  name: string;
  description: string;
  category: string;
  version: string;
  latestVersion?: string;
  availableVersion?: string;
  updateAvailable: boolean;
  icon: string;
  installed: boolean;
  enabled: boolean;
  packageState: ManagedPipelinePackageState;
  setupState: ManagedPipelineSetupState;
  activationState: ManagedPipelineActivationState;
  targets: PackageTargetType[];
  catalogs: PipelineCatalog[];
  capabilities: PipelineCapabilities | null;
  readiness: PipelineReadiness | null;
  nextActions: ManagedPipelineNextAction[];
  source?: PipelineSourceDescriptor;
  provenance: PipelineInstallProvenance | null;
}

export interface ManagedPipelineStatus extends ManagedPipelineCatalogEntry {
  config: Record<string, unknown>;
  configSchema: PipelineConfigSchema;
  defaultConfig: Record<string, unknown>;
  input: PipelineDefinition["input"];
  sampleResult: PipelineDefinition["sampleResult"] | null;
  visibility: PipelineDefinition["visibility"];
  requires: PipelineDefinition["requires"];
  outputs: PipelineDefinition["outputs"];
  executionPolicy: {
    mode: "local" | "slurm";
    source: "global" | "pipeline" | "run";
    slurm: unknown;
    nextflowProfile: string;
  };
  download: Awaited<ReturnType<typeof getPipelineDownloadStatus>> | {
    status: "unsupported";
    detail: string;
  };
  databaseDownloads: PipelineDatabaseStatus[];
  runtimeWarnings: string[];
}

export interface ManagedPipelineCatalog {
  pipelines: ManagedPipelineCatalogEntry[];
  registries: RegistrySourceConfig[];
  categories: RegistryCategoryEntry[];
  registryErrors: PipelineStoreSourceError[];
  duplicatePipelineIds: DuplicatePipelineRegistryEntry[];
  lastUpdated?: string;
  version?: string;
}

export interface ListManagedPipelineCatalogOptions {
  catalog?: PipelineCatalog | "all";
  installedOnly?: boolean;
  enabledOnly?: boolean;
  store?: Omit<LoadPipelineStoreCatalogOptions, "catalog">;
}

export interface GetManagedPipelineStatusOptions {
  includeAvailable?: boolean;
  sourceId?: string;
  version?: string;
  store?: LoadPipelineStoreCatalogOptions;
}

export interface UpdateManagedPipelineInput {
  pipelineId: string;
  config?: Record<string, unknown> | null;
  enabled?: boolean;
  /**
   * CLI setup patches merge into existing stored settings by default. The
   * browser's full-form submit can opt into replacement to retain its existing
   * semantics.
   */
  replaceConfig?: boolean;
  /** Preserve activation when omitted by default; legacy API can opt into true. */
  enableWhenOmitted?: boolean;
}

export interface UpdateManagedPipelineResult {
  success: true;
  pipelineId: string;
  enabled: boolean;
}

export class PipelineManagementError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: string[] = []
  ) {
    super(message);
    this.name = "PipelineManagementError";
  }
}

interface BuildManagedStatusContext {
  configMap: Map<
    string,
    { pipelineId: string; enabled: boolean; config: string | null }
  >;
  profilePipelineAllowlist: Set<string> | null;
  executionSettings: Awaited<ReturnType<typeof getExecutionSettings>>;
  resolvedDataBasePath: Awaited<ReturnType<typeof getResolvedDataBasePath>>;
  runtimePrerequisitesByPolicy: Map<string, Promise<PrerequisiteCheck[]>>;
  localPathInspections: Map<string, Promise<LocalPathInspection>>;
}

function inspectLocalPathOnce(
  context: BuildManagedStatusContext,
  args: {
    targetPath: string | null | undefined;
    writable?: boolean;
  }
): Promise<LocalPathInspection> {
  const normalizedTargetPath = args.targetPath?.trim() || "";
  const cacheKey = JSON.stringify({
    targetPath: normalizedTargetPath,
    writable: args.writable === true,
  });
  let inspection = context.localPathInspections.get(cacheKey);
  if (!inspection) {
    inspection = inspectManagedLocalPath({
      targetPath: normalizedTargetPath,
      writable: args.writable,
    });
    context.localPathInspections.set(cacheKey, inspection);
  }
  return inspection;
}

function getRuntimePrerequisitesOnce(
  context: BuildManagedStatusContext,
  pipelineId: string
): {
  executionPolicy: ReturnType<typeof resolvePipelineExecutionPolicy>;
  prerequisites: Promise<PrerequisiteCheck[]>;
} {
  const executionPolicy = resolvePipelineExecutionPolicy({
    pipelineId,
    settings: context.executionSettings,
  });
  const runtimePolicyKey = JSON.stringify({
    mode: executionPolicy.mode,
    slurmQueue:
      executionPolicy.mode === "slurm"
        ? executionPolicy.settings.slurmQueue?.trim() || ""
        : "",
    condaPath: executionPolicy.settings.condaPath?.trim() || "",
    condaEnv: executionPolicy.settings.condaEnv?.trim() || "",
  });
  let prerequisites =
    context.runtimePrerequisitesByPolicy.get(runtimePolicyKey);
  if (!prerequisites) {
    prerequisites = checkPipelineRuntimePrerequisites(
      executionPolicy.settings
    );
    context.runtimePrerequisitesByPolicy.set(
      runtimePolicyKey,
      prerequisites
    );
  }
  return { executionPolicy, prerequisites };
}

async function buildInstalledManagedPipelineStatus(
  pipelineId: string,
  context: BuildManagedStatusContext
): Promise<ManagedPipelineStatus | null> {
  const definition = PIPELINE_REGISTRY[pipelineId];
  if (!definition) return null;

  const dbConfig = context.configMap.get(pipelineId);
  const provenance = await readPipelineInstallProvenance(pipelineId);
  const effectiveEnabled =
    !dbConfig && provenance
      ? false
      : resolvePipelineEnabled(
          pipelineId,
          dbConfig,
          context.profilePipelineAllowlist
        );
  const extendedDefaultConfig =
    extendDefaultConfigWithTechnologyAllowlist(definition.defaultConfig);
  const extendedConfigSchema =
    extendConfigSchemaWithTechnologyAllowlist(definition.configSchema);
  const resolvedConfig = {
    ...extendedDefaultConfig,
    ...parsePipelineConfig(dbConfig?.config),
  };
  const manifest = getPackageManifest(pipelineId) || null;
  const supportedTargets = deriveManifestTargets(manifest, definition);
  const catalogs = derivePipelineCatalogs(supportedTargets);
  const capabilities = derivePipelineCapabilities(manifest, definition);
  const downloadStatus = manifest
    ? isLocalPipelineReference(manifest.execution.pipeline.trim())
      ? {
          status: "downloaded" as const,
          version: manifest.execution.version,
          expectedVersion: manifest.execution.version,
          path: manifest.execution.pipeline,
          detail:
            "Bundled with pipeline package (no remote download required)",
        }
      : await getPipelineDownloadStatus(
          pipelineId,
          manifest.execution.pipeline,
          manifest.execution.version
        )
    : {
        status: "unsupported" as const,
        detail: "Missing pipeline manifest",
      };
  const databaseDownloads = await getPipelineDatabaseStatuses(
    pipelineId,
    resolvedConfig,
    context.executionSettings.pipelineRunDir,
    context.executionSettings.pipelineDatabaseDir
  );
  const runtimeWarnings = await collectMetaxPathRuntimeWarnings({
    manifest,
    config: resolvedConfig,
  });
  const { executionPolicy, prerequisites } = getRuntimePrerequisitesOnce(
    context,
    pipelineId
  );
  const [runtimePrerequisites, dataPathStatus, runDirectoryStatus] =
    await Promise.all([
      prerequisites,
      inspectLocalPathOnce(context, {
        targetPath: context.resolvedDataBasePath.dataBasePath,
      }),
      inspectLocalPathOnce(context, {
        targetPath: executionPolicy.settings.pipelineRunDir,
        writable: true,
      }),
    ]);
  const readiness = await buildManagedPipelineReadiness({
    pipelineId,
    enabled: effectiveEnabled,
    manifest,
    resolvedConfig,
    configSchema: extendedConfigSchema,
    databaseDownloads,
    runtimeWarnings,
    runtimePrerequisites,
    executionMode: executionPolicy.mode,
    dataPathStatus,
    runDirectoryStatus,
  });
  return {
    id: pipelineId,
    pipelineId,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    version: definition.version || manifest?.package.version || "unknown",
    latestVersion: definition.version || manifest?.package.version,
    updateAvailable: false,
    icon: definition.icon,
    installed: true,
    enabled: effectiveEnabled,
    packageState: provenance ? "installed" : "bundled",
    setupState: deriveManagedSetupState(readiness),
    activationState: deriveManagedActivationState(effectiveEnabled),
    targets: supportedTargets,
    catalogs,
    capabilities,
    readiness,
    nextActions: getManagedNextActions(readiness),
    provenance,
    config: resolvedConfig,
    configSchema: extendedConfigSchema,
    defaultConfig: extendedDefaultConfig,
    input: definition.input,
    sampleResult: definition.sampleResult ?? null,
    visibility: definition.visibility,
    requires: definition.requires,
    outputs: definition.outputs,
    executionPolicy: {
      mode: executionPolicy.mode,
      source: executionPolicy.source,
      slurm: executionPolicy.profile.slurm || null,
      nextflowProfile: executionPolicy.profile.nextflowProfile,
    },
    download: downloadStatus,
    databaseDownloads,
    runtimeWarnings,
  };
}

async function createManagedStatusContext(): Promise<BuildManagedStatusContext> {
  const [configs, siteSettings, executionSettings, resolvedDataBasePath] =
    await Promise.all([
      db.pipelineConfig.findMany(),
      db.siteSettings.findUnique({
        where: { id: "singleton" },
        select: { extraSettings: true },
      }),
      getExecutionSettings(),
      getResolvedDataBasePath(),
    ]);

  return {
    configMap: new Map(
      configs.map((config) => [
        config.pipelineId,
        {
          pipelineId: config.pipelineId,
          enabled: config.enabled,
          config: config.config,
        },
      ])
    ),
    profilePipelineAllowlist: parsePipelineAllowlist(
      siteSettings?.extraSettings
    ),
    executionSettings,
    resolvedDataBasePath,
    runtimePrerequisitesByPolicy: new Map(),
    localPathInspections: new Map(),
  };
}

export async function listInstalledManagedPipelineStatuses(
  options: {
    pipelineIds?: string[];
    catalog?: PipelineCatalog | "all";
    enabledOnly?: boolean;
  } = {}
): Promise<ManagedPipelineStatus[]> {
  const pipelineIds = options.pipelineIds ?? getAllPipelineIds();
  if (pipelineIds.length === 0) return [];
  const context = await createManagedStatusContext();
  const statuses = await Promise.all(
    pipelineIds.map((pipelineId) =>
      buildInstalledManagedPipelineStatus(pipelineId, context)
    )
  );
  return statuses
    .filter(
      (status): status is ManagedPipelineStatus => status !== null
    )
    .filter((status) => (options.enabledOnly ? status.enabled : true))
    .filter((status) =>
      matchesPipelineCatalog(status.catalogs, options.catalog ?? "all")
    );
}

function createAvailableCatalogEntry(
  pipeline: StorePipelineResponse
): ManagedPipelineCatalogEntry {
  const targets = pipeline.targets?.supported || [];
  return {
    id: pipeline.id,
    pipelineId: pipeline.id,
    name: pipeline.name,
    description: pipeline.description,
    category: pipeline.category,
    version: pipeline.version,
    latestVersion: pipeline.latestVersion,
    availableVersion: pipeline.version,
    updateAvailable: false,
    icon: pipeline.icon,
    installed: false,
    enabled: false,
    packageState: "available",
    setupState: "not-installed",
    activationState: deriveManagedActivationState(false),
    targets,
    catalogs: pipeline.catalogs,
    capabilities: pipeline.capabilities,
    readiness: null,
    nextActions: getManagedNextActions(null),
    source: pipeline.source,
    provenance: null,
  };
}

function mergeAvailablePipeline(
  installed: ManagedPipelineStatus,
  available: StorePipelineResponse | undefined
): ManagedPipelineStatus {
  if (!available) return installed;
  return {
    ...installed,
    latestVersion: available.latestVersion,
    availableVersion: available.version,
    updateAvailable: available.version !== installed.version,
    source: available.source,
  };
}

export async function listManagedPipelineCatalog(
  options: ListManagedPipelineCatalogOptions = {}
): Promise<ManagedPipelineCatalog> {
  const catalog = options.catalog ?? "all";
  const installedStatuses = await listInstalledManagedPipelineStatuses({
    catalog,
    enabledOnly: options.enabledOnly,
  });

  if (options.installedOnly || options.enabledOnly) {
    return {
      pipelines: installedStatuses,
      registries: [],
      categories: [],
      registryErrors: [],
      duplicatePipelineIds: [],
    };
  }

  const store = await loadPipelineStoreCatalog({
    ...(options.store || {}),
    catalog,
  });
  const availableById = new Map(
    store.pipelines.map((pipeline) => [pipeline.id, pipeline])
  );
  const pipelines: ManagedPipelineCatalogEntry[] = installedStatuses.map(
    (installed) =>
      mergeAvailablePipeline(installed, availableById.get(installed.pipelineId))
  );
  const installedIds = new Set(
    installedStatuses.map((pipeline) => pipeline.pipelineId)
  );
  for (const available of store.pipelines) {
    if (!installedIds.has(available.id)) {
      pipelines.push(createAvailableCatalogEntry(available));
    }
  }

  return {
    pipelines,
    registries: store.registries,
    categories: store.categories,
    registryErrors: store.registryErrors,
    duplicatePipelineIds: store.duplicatePipelineIds,
    lastUpdated: store.lastUpdated,
    version: store.version,
  };
}

export async function getManagedPipelineStatus(
  pipelineId: string,
  options: GetManagedPipelineStatusOptions = {}
): Promise<ManagedPipelineCatalogEntry | null> {
  const installed = (
    await listInstalledManagedPipelineStatuses({
      pipelineIds: [pipelineId],
    })
  )[0];
  if (options.includeAvailable === false) {
    return installed || null;
  }

  const store = await loadPipelineStoreCatalog(options.store);
  const available = findUniqueStorePipeline(store, pipelineId, {
    sourceId: options.sourceId,
    version: options.version,
  });
  if (installed) {
    return mergeAvailablePipeline(installed, available || undefined);
  }
  return available ? createAvailableCatalogEntry(available) : null;
}

async function buildActivationReadiness(args: {
  pipelineId: string;
  manifest: PackageManifest | null;
  config: Record<string, unknown>;
  configSchema: PipelineConfigSchema;
  executionSettings: Awaited<ReturnType<typeof getExecutionSettings>>;
}): Promise<PipelineReadiness> {
  const executionPolicy = resolvePipelineExecutionPolicy({
    pipelineId: args.pipelineId,
    settings: args.executionSettings,
  });
  const [
    resolvedDataBasePath,
    databaseDownloads,
    runtimeWarnings,
    runtimePrerequisites,
  ] = await Promise.all([
    getResolvedDataBasePath(),
    getPipelineDatabaseStatuses(
      args.pipelineId,
      args.config,
      executionPolicy.settings.pipelineRunDir,
      executionPolicy.settings.pipelineDatabaseDir
    ),
    collectMetaxPathRuntimeWarnings({
      manifest: args.manifest,
      config: args.config,
    }),
    checkPipelineRuntimePrerequisites(executionPolicy.settings),
  ]);
  const [dataPathStatus, runDirectoryStatus] = await Promise.all([
    inspectManagedLocalPath({
      targetPath: resolvedDataBasePath.dataBasePath,
    }),
    inspectManagedLocalPath({
      targetPath: executionPolicy.settings.pipelineRunDir,
      writable: true,
    }),
  ]);
  return buildManagedPipelineReadiness({
    pipelineId: args.pipelineId,
    enabled: false,
    manifest: args.manifest,
    resolvedConfig: args.config,
    configSchema: args.configSchema,
    databaseDownloads,
    runtimeWarnings,
    runtimePrerequisites,
    executionMode: executionPolicy.mode,
    dataPathStatus,
    runDirectoryStatus,
  });
}

export async function updateManagedPipeline(
  input: UpdateManagedPipelineInput
): Promise<UpdateManagedPipelineResult> {
  const definition = PIPELINE_REGISTRY[input.pipelineId];
  if (!definition) {
    throw new PipelineManagementError("Invalid pipeline ID", 400);
  }
  if (
    input.config !== undefined &&
    input.config !== null &&
    !isPipelineConfigRecord(input.config)
  ) {
    throw new PipelineManagementError(
      "Invalid pipeline configuration",
      422,
      ["Configuration must be a JSON object."]
    );
  }

  const existingConfig = await db.pipelineConfig.findUnique({
    where: { pipelineId: input.pipelineId },
    select: { enabled: true, config: true },
  });
  const persistedConfig = parsePipelineConfig(existingConfig?.config);
  const submittedConfig = input.config || {};
  const storedConfig =
    input.config === undefined
      ? persistedConfig
      : input.replaceConfig
        ? submittedConfig
        : { ...persistedConfig, ...submittedConfig };
  const extendedDefaultConfig =
    extendDefaultConfigWithTechnologyAllowlist(definition.defaultConfig);
  const extendedConfigSchema =
    extendConfigSchemaWithTechnologyAllowlist(definition.configSchema);
  const resolvedConfig = {
    ...extendedDefaultConfig,
    ...storedConfig,
  };
  const executionSettings = await getExecutionSettings();
  const executionPolicy = resolvePipelineExecutionPolicy({
    pipelineId: input.pipelineId,
    settings: executionSettings,
  });
  const configValidation = validateManagedPipelineConfig({
    pipelineId: input.pipelineId,
    schema: extendedConfigSchema,
    config: resolvedConfig,
    executionMode: executionPolicy.mode,
  });

  const effectiveEnabled =
    typeof input.enabled === "boolean"
      ? input.enabled
      : input.enableWhenOmitted
        ? true
        : existingConfig?.enabled ?? false;

  if (
    configValidation.issues.length > 0 &&
    (effectiveEnabled || input.config !== undefined)
  ) {
    throw new PipelineManagementError(
      "Pipeline configuration validation failed",
      422,
      configValidation.issues
    );
  }

  if (effectiveEnabled && existingConfig?.enabled !== true) {
    const readiness = await buildActivationReadiness({
      pipelineId: input.pipelineId,
      manifest: getPackageManifest(input.pipelineId) || null,
      config: resolvedConfig,
      configSchema: extendedConfigSchema,
      executionSettings,
    });
    if (!readiness.canEnable) {
      throw new PipelineManagementError(
        "Pipeline is not ready to enable",
        422,
        getBlockingReadinessDetails(readiness)
      );
    }
  }

  const result = await db.pipelineConfig.upsert({
    where: { pipelineId: input.pipelineId },
    create: {
      pipelineId: input.pipelineId,
      enabled: effectiveEnabled,
      config:
        input.config === undefined && Object.keys(storedConfig).length === 0
          ? null
          : JSON.stringify(storedConfig),
    },
    update: {
      enabled: effectiveEnabled,
      config:
        input.config === undefined
          ? existingConfig?.config ?? null
          : JSON.stringify(storedConfig),
    },
  });

  return {
    success: true,
    pipelineId: result.pipelineId,
    enabled: result.enabled,
  };
}
