import { db } from "@/lib/db";
import { loadConfig } from "@/lib/config/loader";
import type { ConfigSource, ResolvedConfig } from "@/lib/config/types";

export interface ExecutionSettings {
  useSlurm: boolean;
  slurmQueue: string;
  slurmCores: number;
  slurmMemory: string;
  slurmTimeLimit: number;
  slurmOptions: string;
  pipelineOverrides: Record<string, PipelineExecutionOverride>;
  runtimeMode: "conda";
  condaPath: string;
  condaEnv: string;
  condaCacheDir: string;
  nextflowProfile: string;
  pipelineRunDir: string;
  pipelineDatabaseDir: string;
  weblogUrl: string;
  weblogSecret: string;
  /** When true, omit conda from Nextflow profiles (macOS ARM local execution) */
  skipConda?: boolean;
}

export interface SlurmSettings {
  queue: string;
  cores: number;
  memory: string;
  timeLimit: number;
  options: string;
}

export interface PipelineExecutionOverride {
  mode?: "inherit" | "local" | "slurm";
  slurm?: Partial<SlurmSettings>;
  nextflowProfile?: string;
}

export const DEFAULT_EXECUTION_SETTINGS: ExecutionSettings = {
  useSlurm: false,
  slurmQueue: "cpu",
  slurmCores: 4,
  slurmMemory: "64GB",
  slurmTimeLimit: 12,
  slurmOptions: "",
  pipelineOverrides: {},
  runtimeMode: "conda",
  condaPath: "",
  condaEnv: "seqdesk-pipelines",
  condaCacheDir: "",
  nextflowProfile: "",
  pipelineRunDir: "/data/pipeline_runs",
  pipelineDatabaseDir: "",
  weblogUrl: "",
  weblogSecret: "",
};

function isFileOrEnvSource(source: ConfigSource | undefined): boolean {
  return source === "file" || source === "env";
}

function getConfiguredValue<T>(
  resolvedConfig: ResolvedConfig,
  configPath: string,
  value: T | undefined
): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  return isFileOrEnvSource(resolvedConfig.sources[configPath]) ? value : undefined;
}

function getConfigExecutionOverrides(
  resolvedConfig: ResolvedConfig
): Partial<ExecutionSettings> {
  const execution = resolvedConfig.config.pipelines?.execution;
  const pipelineOverrides = normalizePipelineExecutionOverrides(
    execution?.pipelineOverrides
  );
  const configuredMode = getConfiguredValue(
    resolvedConfig,
    "pipelines.execution.mode",
    execution?.mode
  );
  const configuredSlurmEnabled = getConfiguredValue(
    resolvedConfig,
    "pipelines.execution.slurm.enabled",
    execution?.slurm?.enabled
  );

  let useSlurm: boolean | undefined;
  if (configuredMode === "slurm") {
    useSlurm = true;
  } else if (configuredMode === "local" || configuredMode === "kubernetes") {
    useSlurm = false;
  } else if (configuredSlurmEnabled !== undefined) {
    useSlurm = configuredSlurmEnabled;
  }

  return {
    useSlurm,
    slurmQueue: getConfiguredValue(
      resolvedConfig,
      "pipelines.execution.slurm.queue",
      execution?.slurm?.queue
    ),
    slurmCores: getConfiguredValue(
      resolvedConfig,
      "pipelines.execution.slurm.cores",
      execution?.slurm?.cores
    ),
    slurmMemory: getConfiguredValue(
      resolvedConfig,
      "pipelines.execution.slurm.memory",
      execution?.slurm?.memory
    ),
    slurmTimeLimit: getConfiguredValue(
      resolvedConfig,
      "pipelines.execution.slurm.timeLimit",
      execution?.slurm?.timeLimit
    ),
    slurmOptions: getConfiguredValue(
      resolvedConfig,
      "pipelines.execution.slurm.options",
      execution?.slurm?.options
    ),
    pipelineOverrides:
      Object.keys(pipelineOverrides).length > 0 ? pipelineOverrides : undefined,
    condaPath: getConfiguredValue(
      resolvedConfig,
      "pipelines.execution.conda.path",
      execution?.conda?.path
    ),
    condaEnv: getConfiguredValue(
      resolvedConfig,
      "pipelines.execution.conda.environment",
      execution?.conda?.environment
    ),
    condaCacheDir: getConfiguredValue(
      resolvedConfig,
      "pipelines.execution.conda.cacheDir",
      execution?.conda?.cacheDir
    ),
    pipelineRunDir: getConfiguredValue(
      resolvedConfig,
      "pipelines.execution.runDirectory",
      execution?.runDirectory
    ),
    pipelineDatabaseDir: getConfiguredValue(
      resolvedConfig,
      "pipelines.databaseDirectory",
      resolvedConfig.config.pipelines?.databaseDirectory
    ),
  };
}

function omitUndefinedValues<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as Partial<T>;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeMode(value: unknown): PipelineExecutionOverride["mode"] | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "inherit" || normalized === "local" || normalized === "slurm") {
    return normalized;
  }
  return undefined;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.trunc(value);
    return normalized > 0 ? normalized : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

export function normalizePipelineExecutionOverrides(
  value: unknown
): Record<string, PipelineExecutionOverride> {
  const source = toRecord(value);
  if (!source) return {};

  const normalized: Record<string, PipelineExecutionOverride> = {};
  for (const [pipelineId, rawOverride] of Object.entries(source)) {
    const id = pipelineId.trim();
    const override = toRecord(rawOverride);
    if (!id || !override) continue;

    const mode = normalizeMode(override.mode);
    const slurmSource = toRecord(override.slurm);
    const slurm: Partial<SlurmSettings> = {};
    const queue = normalizeString(slurmSource?.queue ?? override.slurmQueue);
    const cores = normalizePositiveInt(slurmSource?.cores ?? override.slurmCores);
    const memory = normalizeString(slurmSource?.memory ?? override.slurmMemory);
    const timeLimit = normalizePositiveInt(slurmSource?.timeLimit ?? override.slurmTimeLimit);
    const options = normalizeString(
      slurmSource?.options ?? override.slurmOptions ?? override.clusterOptions
    );

    if (queue) slurm.queue = queue;
    if (cores !== undefined) slurm.cores = cores;
    if (memory) slurm.memory = memory;
    if (timeLimit !== undefined) slurm.timeLimit = timeLimit;
    if (options !== undefined) slurm.options = options;

    const nextflowProfile = normalizeString(override.nextflowProfile);
    const nextOverride: PipelineExecutionOverride = {};
    if (mode) nextOverride.mode = mode;
    if (Object.keys(slurm).length > 0) nextOverride.slurm = slurm;
    if (nextflowProfile) nextOverride.nextflowProfile = nextflowProfile;

    if (Object.keys(nextOverride).length > 0) {
      normalized[id] = nextOverride;
    }
  }

  return normalized;
}

export async function getExecutionSettings(): Promise<ExecutionSettings> {
  const configOverrides = omitUndefinedValues(getConfigExecutionOverrides(loadConfig()));
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });

  if (!settings?.extraSettings) {
    const merged: ExecutionSettings = {
      ...DEFAULT_EXECUTION_SETTINGS,
      ...configOverrides,
      runtimeMode: "conda",
    };
    merged.pipelineOverrides = normalizePipelineExecutionOverrides(
      merged.pipelineOverrides
    );
    return merged;
  }

  try {
    const extra = JSON.parse(settings.extraSettings);
    const merged = {
      ...DEFAULT_EXECUTION_SETTINGS,
      ...(extra.pipelineExecution || {}),
      ...configOverrides,
    } as ExecutionSettings;

    merged.pipelineOverrides = normalizePipelineExecutionOverrides(
      merged.pipelineOverrides
    );
    merged.runtimeMode = "conda";
    return merged;
  } catch {
    const merged: ExecutionSettings = {
      ...DEFAULT_EXECUTION_SETTINGS,
      ...configOverrides,
      runtimeMode: "conda",
    };
    merged.pipelineOverrides = normalizePipelineExecutionOverrides(
      merged.pipelineOverrides
    );
    return merged;
  }
}

export async function saveExecutionSettings(
  executionSettings: ExecutionSettings
): Promise<void> {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });

  let extra: Record<string, unknown> = {};
  if (settings?.extraSettings) {
    try {
      extra = JSON.parse(settings.extraSettings);
    } catch {
      // ignore
    }
  }

  extra.pipelineExecution = {
    ...executionSettings,
    pipelineOverrides: normalizePipelineExecutionOverrides(
      executionSettings.pipelineOverrides
    ),
  };

  await db.siteSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      extraSettings: JSON.stringify(extra),
    },
    update: {
      extraSettings: JSON.stringify(extra),
    },
  });
}
