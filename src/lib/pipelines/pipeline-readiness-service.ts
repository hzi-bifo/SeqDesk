import {
  accessSync,
  constants as fsConstants,
} from "fs";
import fs from "fs/promises";
import path from "path";
import { validatePipelineConfigSchema } from "./config-schema-validation";
import type { getPipelineDatabaseStatuses } from "./database-downloads";
import {
  getPackage,
  type PackageManifest,
} from "./package-loader";
import { isLocalPipelineReference } from "./pipeline-paths";
import type { PrerequisiteCheck } from "./prerequisite-check";
import { getReadCleaningPathIssues } from "./read-cleaning-path-validation";
import {
  getPipelineRunConfigIssues,
  normalizePipelineRunConfig,
} from "./simulate-reads-config";
import {
  checkMetaxPathPackageCompatibility,
  METAXPATH_MIN_COMPATIBLE_VERSION,
} from "./metaxpath-compatibility";
import type { PipelineConfigSchema } from "./types";

export type PipelineReadinessAction =
  | "install"
  | "sync"
  | "download-db"
  | "configure"
  | "configure-runtime"
  | "configure-storage"
  | "enable"
  | "review-outputs";

export interface PipelineReadinessItem {
  id: string;
  label: string;
  status: "ready" | "warning" | "missing";
  detail?: string;
  action?: PipelineReadinessAction;
  href?: string;
  /** A non-ready item with blocking=true prevents activation. */
  blocking?: boolean;
}

export interface PipelineReadiness {
  status: "ready" | "warning" | "missing";
  summary: string;
  items: PipelineReadinessItem[];
  canEnable: boolean;
}

export type ManagedPipelineSetupState =
  | "not-installed"
  | "ready"
  | "needs-package"
  | "needs-config"
  | "needs-db"
  | "needs-runtime"
  | "needs-storage"
  | "needs-attention";
export type ManagedPipelineActivationState = "enabled" | "disabled";

export function deriveManagedActivationState(
  enabled: boolean
): ManagedPipelineActivationState {
  return enabled ? "enabled" : "disabled";
}

export interface ManagedPipelineNextAction {
  id: string;
  label: string;
  action: PipelineReadinessAction;
  detail?: string;
  href?: string;
}

export function parsePipelineConfig(
  rawConfig: string | null | undefined
): Record<string, unknown> {
  if (!rawConfig) return {};
  try {
    const parsed = JSON.parse(rawConfig);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore invalid JSON and fall back to defaults.
  }
  return {};
}

export function isPipelineConfigRecord(
  value: unknown
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const ALLOWED_SEQUENCING_TECHNOLOGIES_SCHEMA: PipelineConfigSchema["properties"][string] =
  {
    type: "array",
    title: "Allow For Sequencing Technologies",
    description:
      "Optional. If selected, this pipeline can only run for orders using one of these sequencing technologies.",
    default: [],
  };

export function extendConfigSchemaWithTechnologyAllowlist(
  schema: PipelineConfigSchema
): PipelineConfigSchema {
  if (schema.properties.allowedSequencingTechnologies) {
    return schema;
  }

  return {
    ...schema,
    properties: {
      ...schema.properties,
      allowedSequencingTechnologies:
        ALLOWED_SEQUENCING_TECHNOLOGIES_SCHEMA,
    },
  };
}

export function extendDefaultConfigWithTechnologyAllowlist(
  defaultConfig: Record<string, unknown>
): Record<string, unknown> {
  if (
    Object.prototype.hasOwnProperty.call(
      defaultConfig,
      "allowedSequencingTechnologies"
    )
  ) {
    return defaultConfig;
  }

  return {
    ...defaultConfig,
    allowedSequencingTechnologies: [],
  };
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function validateRequiredLocalConfigPaths(args: {
  schema: PipelineConfigSchema;
  config: Record<string, unknown>;
  executionMode: "local" | "slurm";
}): { issues: string[]; warnings: string[] } {
  const issues: string[] = [];
  const warnings: string[] = [];

  for (const key of args.schema.required || []) {
    const property = args.schema.properties[key];
    if (property?.["x-seqdesk"]?.group !== "databases") continue;

    const configuredPath =
      typeof args.config[key] === "string" ? args.config[key].trim() : "";
    if (!configuredPath) continue;

    const label = property.title || key;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(configuredPath)) {
      warnings.push(
        `${label} uses a remote URI and cannot be verified by SeqDesk: ${configuredPath}`
      );
      continue;
    }
    if (!path.isAbsolute(configuredPath)) {
      issues.push(`${label} must use an absolute path: ${configuredPath}`);
      continue;
    }
    if (args.executionMode === "slurm") {
      warnings.push(
        `${label} is assumed to exist on the compute node and cannot be verified from this host: ${configuredPath}`
      );
      continue;
    }

    try {
      accessSync(configuredPath, fsConstants.R_OK);
    } catch {
      issues.push(
        `${label} does not exist or is not readable: ${configuredPath}`
      );
    }
  }

  return { issues, warnings };
}

export function validateManagedPipelineConfig(args: {
  pipelineId: string;
  schema: PipelineConfigSchema;
  config: Record<string, unknown>;
  executionMode: "local" | "slurm";
}): {
  missingFields: string[];
  issues: string[];
  pipelineIssues: string[];
  pathWarnings: string[];
} {
  const schemaValidation = validatePipelineConfigSchema(
    args.schema,
    args.config
  );
  const normalizedConfig = normalizePipelineRunConfig(
    args.pipelineId,
    args.config
  );
  const configIssues = getPipelineRunConfigIssues(
    args.pipelineId,
    normalizedConfig
  );
  const pathValidation = getReadCleaningPathIssues(
    args.pipelineId,
    normalizedConfig,
    args.executionMode
  );
  const requiredPathValidation = validateRequiredLocalConfigPaths({
    schema: args.schema,
    config: normalizedConfig,
    executionMode: args.executionMode,
  });
  const pipelineIssues = [
    ...schemaValidation.valueIssues,
    ...configIssues,
    ...pathValidation.issues,
    ...requiredPathValidation.issues,
  ];

  return {
    missingFields: schemaValidation.missingFields,
    issues: [...schemaValidation.requiredIssues, ...pipelineIssues],
    pipelineIssues,
    pathWarnings: [
      ...pathValidation.warnings,
      ...requiredPathValidation.warnings,
    ],
  };
}

export type LocalPathInspection = {
  status: PipelineReadinessItem["status"];
  detail: string;
};

export async function inspectManagedLocalPath(args: {
  targetPath: string | null | undefined;
  writable?: boolean;
}): Promise<LocalPathInspection> {
  const targetPath = args.targetPath?.trim();
  if (!targetPath || targetPath === "/") {
    return {
      status: "missing",
      detail:
        targetPath === "/"
          ? "The filesystem root cannot be used as this pipeline path."
          : "No path is configured.",
    };
  }

  try {
    const entry = await fs.lstat(targetPath);
    const stats = entry.isSymbolicLink() ? await fs.stat(targetPath) : entry;
    if (!stats.isDirectory()) {
      return {
        status: "missing",
        detail: `Path is not a directory: ${targetPath}`,
      };
    }
    const canonicalTarget = await fs.realpath(targetPath);
    if (canonicalTarget === path.parse(canonicalTarget).root) {
      return {
        status: "missing",
        detail: `The filesystem root cannot be used as this pipeline path: ${targetPath}`,
      };
    }

    const accessMode = args.writable
      ? fsConstants.R_OK | fsConstants.W_OK
      : fsConstants.R_OK;
    await fs.access(targetPath, accessMode);

    if (args.writable) {
      const canonicalStats = await fs.stat(canonicalTarget);
      if (!canonicalStats.isDirectory()) {
        return {
          status: "missing",
          detail: `Path is not a directory: ${targetPath}`,
        };
      }

      let probeDirectory: string | null = null;
      try {
        probeDirectory = await fs.mkdtemp(
          path.join(canonicalTarget, ".seqdesk-readiness-")
        );
        const probeDirectoryStat = await fs.lstat(probeDirectory);
        const canonicalProbeDirectory = await fs.realpath(probeDirectory);
        if (
          probeDirectoryStat.isSymbolicLink() ||
          !probeDirectoryStat.isDirectory() ||
          path.dirname(canonicalProbeDirectory) !== canonicalTarget
        ) {
          throw new Error(
            "Readiness probe escaped the configured directory."
          );
        }
        const probeFile = path.join(probeDirectory, "write-probe");
        await fs.writeFile(probeFile, "seqdesk readiness\n", {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        const probeFileStat = await fs.lstat(probeFile);
        if (probeFileStat.isSymbolicLink() || !probeFileStat.isFile()) {
          throw new Error("Readiness probe file has an unsafe type.");
        }
        await fs.unlink(probeFile);
        await fs.rmdir(probeDirectory);
        probeDirectory = null;
        if ((await fs.realpath(targetPath)) !== canonicalTarget) {
          throw new Error(
            "Configured pipeline run directory changed during its readiness probe."
          );
        }
      } catch {
        return {
          status: "missing",
          detail: `Directory cannot safely create and remove files: ${targetPath}`,
        };
      } finally {
        if (probeDirectory) {
          try {
            const resolvedProbeDirectory = path.resolve(probeDirectory);
            if (
              path.dirname(resolvedProbeDirectory) === canonicalTarget &&
              path
                .basename(resolvedProbeDirectory)
                .startsWith(".seqdesk-readiness-")
            ) {
              const probeStat = await fs.lstat(resolvedProbeDirectory);
              if (probeStat.isSymbolicLink()) {
                await fs.unlink(resolvedProbeDirectory);
              } else {
                await fs.rm(resolvedProbeDirectory, {
                  recursive: true,
                  force: true,
                });
              }
            }
          } catch {
            // Best-effort cleanup of the uniquely named readiness probe.
          }
        }
      }
    }

    return {
      status: "ready",
      detail: args.writable
        ? `Accessible and writable: ${targetPath}`
        : `Accessible: ${targetPath}`,
    };
  } catch {
    return {
      status: "missing",
      detail: args.writable
        ? `Path does not exist or is not writable: ${targetPath}`
        : `Path does not exist or is not readable: ${targetPath}`,
    };
  }
}

function mapPrerequisiteStatus(
  status: PrerequisiteCheck["status"]
): PipelineReadinessItem["status"] {
  if (status === "pass") return "ready";
  if (status === "warning") return "warning";
  return "missing";
}

function buildPrerequisiteDetail(check: PrerequisiteCheck): string {
  const details = check.details?.trim();
  return details ? `${check.message}. ${details}` : check.message;
}

function resolveLocalPipelinePath(
  packageBasePath: string | undefined,
  manifest: PackageManifest | null
): string | null {
  const pipelineRef = manifest?.execution?.pipeline;
  if (
    !pipelineRef ||
    !isLocalPipelineReference(pipelineRef.trim()) ||
    !packageBasePath
  ) {
    return null;
  }
  return path.isAbsolute(pipelineRef)
    ? pipelineRef
    : path.resolve(packageBasePath, pipelineRef);
}

function deriveReadinessStatus(
  items: PipelineReadinessItem[]
): PipelineReadiness["status"] {
  if (items.some((item) => item.status === "missing")) return "missing";
  if (items.some((item) => item.status === "warning")) return "warning";
  return "ready";
}

function buildReadinessSummary(
  status: PipelineReadiness["status"],
  items: PipelineReadinessItem[]
): string {
  if (status === "ready") return "Ready to run";
  const nextItem =
    items.find((item) => item.status === "missing") ||
    items.find((item) => item.status === "warning");
  return nextItem?.detail || nextItem?.label || "Setup needs attention";
}

export async function buildManagedPipelineReadiness(args: {
  pipelineId: string;
  enabled: boolean;
  manifest: PackageManifest | null;
  resolvedConfig: Record<string, unknown>;
  configSchema: PipelineConfigSchema;
  databaseDownloads: Awaited<ReturnType<typeof getPipelineDatabaseStatuses>>;
  runtimeWarnings: string[];
  runtimePrerequisites: PrerequisiteCheck[];
  executionMode: "local" | "slurm";
  dataPathStatus: LocalPathInspection;
  runDirectoryStatus: LocalPathInspection;
}): Promise<PipelineReadiness> {
  const pkg = getPackage(args.pipelineId);
  const localPipelinePath = resolveLocalPipelinePath(
    pkg?.basePath,
    args.manifest
  );
  const packageOutputCount = args.manifest?.outputs?.length ?? 0;
  const items: PipelineReadinessItem[] = [];

  items.push({
    id: "package",
    label: "Pipeline package",
    status: args.manifest ? "ready" : "missing",
    detail: args.manifest
      ? "Descriptor package is installed."
      : "Install or sync the pipeline package first.",
    action: args.manifest ? undefined : "install",
    blocking: true,
  });
  if (localPipelinePath) {
    const workflowExists = await pathExists(localPipelinePath);
    items.push({
      id: "workflow",
      label: "Workflow snapshot",
      status: workflowExists ? "ready" : "missing",
      detail: workflowExists
        ? "Workflow files are available locally."
        : "Workflow files are missing. Sync the private GitHub package again.",
      action: workflowExists ? undefined : "sync",
      blocking: true,
    });
  } else if (args.manifest?.execution?.pipeline) {
    items.push({
      id: "workflow",
      label: "Workflow source",
      status: "ready",
      detail: `Nextflow will use ${args.manifest.execution.pipeline}.`,
      blocking: true,
    });
  }

  if (args.pipelineId === "metaxpath" && pkg && args.manifest) {
    const compatibility = await checkMetaxPathPackageCompatibility({
      basePath: pkg.basePath,
      manifest: args.manifest,
      registry: pkg.registry,
    });
    items.push({
      id: "metaxpath-compatibility",
      label: "MetaxPath package version",
      status: compatibility.compatible ? "ready" : "missing",
      detail: compatibility.compatible
        ? `Installed package ${compatibility.version} is compatible.`
        : `${compatibility.issues.join(
            " "
          )} Sync MetaxPath-Nextflow ${METAXPATH_MIN_COMPATIBLE_VERSION} or newer.`,
      action: compatibility.compatible ? undefined : "sync",
      blocking: true,
    });
  }

  const configValidation = validateManagedPipelineConfig({
    pipelineId: args.pipelineId,
    schema: args.configSchema,
    config: args.resolvedConfig,
    executionMode: args.executionMode,
  });
  items.push({
    id: "required-config",
    label: "Required configuration",
    status:
      configValidation.missingFields.length > 0 ? "missing" : "ready",
    detail:
      configValidation.missingFields.length > 0
        ? `Configure: ${configValidation.missingFields.join(", ")}.`
        : "All required configuration values are set.",
    action:
      configValidation.missingFields.length > 0
        ? "configure"
        : undefined,
    blocking: true,
  });
  const missingDatabaseConfigFields = configValidation.missingFields.filter(
    (fieldLabel) =>
      Object.entries(args.configSchema.properties).some(
        ([fieldKey, property]) =>
          (property.title || fieldKey) === fieldLabel &&
          property["x-seqdesk"]?.group === "databases"
      )
  );
  if (missingDatabaseConfigFields.length > 0) {
    items.push({
      id: "database-config",
      label: "Database configuration",
      status: "missing",
      detail: `Configure or link: ${missingDatabaseConfigFields.join(", ")}.`,
      action:
        args.databaseDownloads.length > 0 ? "download-db" : "configure",
      blocking: true,
    });
  }

  if (args.runtimeWarnings.length > 0) {
    items.push({
      id: "metaxpath-runtime-warnings",
      label: "MetaxPath runtime defaults",
      status: "warning",
      detail: args.runtimeWarnings.join(" "),
      blocking: false,
    });
  }

  if (args.databaseDownloads.length > 0) {
    const missingDatabase = args.databaseDownloads.find(
      (database) => database.status !== "downloaded"
    );
    items.push({
      id: "databases",
      label: "Runtime databases",
      status: missingDatabase ? "missing" : "ready",
      detail: missingDatabase
        ? `${missingDatabase.label} is not installed.`
        : "Required database assets are installed.",
      action: missingDatabase ? "download-db" : undefined,
      blocking: true,
    });
  }

  if (args.pipelineId === "metaxpath") {
    const paramsFile = args.resolvedConfig.paramsFile;
    const configuredParamsFile = hasNonEmptyString(paramsFile)
      ? paramsFile.trim()
      : null;
    const paramsFileExists = hasNonEmptyString(paramsFile)
      ? await pathExists(paramsFile)
      : false;
    items.push({
      id: "params-file",
      label: "MetaxPath params file",
      status: paramsFileExists ? "ready" : "missing",
      detail: paramsFileExists
        ? `SeqDesk will pass ${configuredParamsFile} to Nextflow.`
        : configuredParamsFile
          ? `Configured params file does not exist: ${configuredParamsFile}`
          : "Install the MetaxPath DB bundle so metaxpath.downloaded.params.yaml is configured.",
      action: paramsFileExists ? undefined : "download-db",
      blocking: true,
    });
  }

  items.push({
    id: "pipeline-config",
    label: "Pipeline configuration validation",
    status:
      configValidation.pipelineIssues.length > 0
        ? "missing"
        : configValidation.pathWarnings.length > 0
          ? "warning"
          : "ready",
    detail:
      configValidation.pipelineIssues.length > 0
        ? configValidation.pipelineIssues.join(" ")
        : configValidation.pathWarnings.length > 0
          ? configValidation.pathWarnings.join(" ")
          : "Pipeline-specific configuration checks passed.",
    action:
      configValidation.pipelineIssues.length > 0
        ? "configure"
        : undefined,
    // Remote/SLURM paths cannot always be inspected from the web host. Keep
    // those explicit warnings visible without making activation impossible.
    blocking: configValidation.pipelineIssues.length > 0,
  });

  for (const prerequisite of args.runtimePrerequisites) {
    const status = mapPrerequisiteStatus(prerequisite.status);
    items.push({
      id: `runtime-${prerequisite.id}`,
      label: prerequisite.name,
      status,
      detail: buildPrerequisiteDetail(prerequisite),
      action: status === "ready" ? undefined : "configure-runtime",
      href: "/admin/pipeline-runtime#required-runtime",
      blocking: true,
    });
  }

  items.push(
    {
      id: "data-storage-path",
      label: "Data storage path",
      ...args.dataPathStatus,
      action:
        args.dataPathStatus.status === "ready"
          ? undefined
          : "configure-storage",
      href: "/admin/data-storage#required-data-storage",
      blocking: true,
    },
    {
      id: "pipeline-run-directory",
      label: "Pipeline run directory",
      ...args.runDirectoryStatus,
      action:
        args.runDirectoryStatus.status === "ready"
          ? undefined
          : "configure-runtime",
      href: "/admin/pipeline-runtime#required-runtime",
      blocking: true,
    }
  );

  items.push({
    id: "outputs",
    label: "Output browsing",
    status: packageOutputCount > 0 ? "ready" : "warning",
    detail:
      packageOutputCount > 0
        ? `${packageOutputCount} output pattern${
            packageOutputCount === 1 ? "" : "s"
          } configured; run output folder browsing is also available.`
        : "Raw run output browsing is available, but curated output patterns are not configured.",
    action: packageOutputCount > 0 ? undefined : "review-outputs",
    blocking: false,
  });

  items.push({
    id: "enabled",
    label: "Enabled for users",
    status: args.enabled ? "ready" : "warning",
    detail: args.enabled
      ? "Pipeline is enabled."
      : "Pipeline is installed but disabled.",
    action: args.enabled ? undefined : "enable",
    blocking: false,
  });

  const status = deriveReadinessStatus(items);
  const canEnable = items.every(
    (item) =>
      item.id === "enabled" ||
      item.blocking === false ||
      item.status === "ready"
  );
  return {
    status,
    summary: buildReadinessSummary(status, items),
    items,
    canEnable,
  };
}

export function deriveManagedSetupState(
  readiness: PipelineReadiness | null
): ManagedPipelineSetupState {
  if (!readiness) return "not-installed";
  if (readiness.canEnable) return "ready";

  const blockingIds = new Set(
    readiness.items
      .filter(
        (item) =>
          item.id !== "enabled" &&
          item.blocking !== false &&
          item.status !== "ready"
      )
      .map((item) => item.id)
  );
  if (
    blockingIds.has("package") ||
    blockingIds.has("workflow") ||
    blockingIds.has("metaxpath-compatibility")
  ) {
    return "needs-package";
  }
  if (
    blockingIds.has("databases") ||
    blockingIds.has("params-file") ||
    blockingIds.has("database-config")
  ) {
    return "needs-db";
  }
  if (
    blockingIds.has("required-config") ||
    blockingIds.has("pipeline-config")
  ) {
    return "needs-config";
  }
  if (
    Array.from(blockingIds).some(
      (id) => id.startsWith("runtime-") || id === "pipeline-run-directory"
    )
  ) {
    return "needs-runtime";
  }
  if (blockingIds.has("data-storage-path")) {
    return "needs-storage";
  }
  return "needs-attention";
}

export function getManagedNextActions(
  readiness: PipelineReadiness | null
): ManagedPipelineNextAction[] {
  if (!readiness) {
    return [
      {
        id: "install",
        label: "Install pipeline",
        action: "install",
      },
    ];
  }

  const seen = new Set<string>();
  const actions: ManagedPipelineNextAction[] = [];
  for (const item of readiness.items) {
    if (
      item.status === "ready" ||
      !item.action ||
      (item.action === "enable" && !readiness.canEnable) ||
      item.action === "review-outputs"
    ) {
      continue;
    }
    const key = `${item.action}:${item.href || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    actions.push({
      id: item.id,
      label: item.label,
      action: item.action,
      detail: item.detail,
      href: item.href,
    });
  }
  return actions;
}

export function getBlockingReadinessDetails(
  readiness: PipelineReadiness
): string[] {
  return readiness.items
    .filter(
      (item) =>
        item.id !== "enabled" &&
        item.blocking !== false &&
        item.status !== "ready"
    )
    .map(
      (item) =>
        `${item.label}: ${item.detail || "Setup is incomplete."}`
    );
}
