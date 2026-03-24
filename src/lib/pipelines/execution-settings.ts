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
  runtimeMode: "conda";
  condaPath: string;
  condaEnv: string;
  nextflowProfile: string;
  pipelineRunDir: string;
  weblogUrl: string;
  weblogSecret: string;
  /** When true, omit conda from Nextflow profiles (macOS ARM local execution) */
  skipConda?: boolean;
}

export const DEFAULT_EXECUTION_SETTINGS: ExecutionSettings = {
  useSlurm: false,
  slurmQueue: "cpu",
  slurmCores: 4,
  slurmMemory: "64GB",
  slurmTimeLimit: 12,
  slurmOptions: "",
  runtimeMode: "conda",
  condaPath: "",
  condaEnv: "seqdesk-pipelines",
  nextflowProfile: "",
  pipelineRunDir: "/data/pipeline_runs",
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
    pipelineRunDir: getConfiguredValue(
      resolvedConfig,
      "pipelines.execution.runDirectory",
      execution?.runDirectory
    ),
  };
}

function omitUndefinedValues<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as Partial<T>;
}

export async function getExecutionSettings(): Promise<ExecutionSettings> {
  const configOverrides = omitUndefinedValues(getConfigExecutionOverrides(loadConfig()));
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });

  if (!settings?.extraSettings) {
    return {
      ...DEFAULT_EXECUTION_SETTINGS,
      ...configOverrides,
      runtimeMode: "conda",
    };
  }

  try {
    const extra = JSON.parse(settings.extraSettings);
    const merged = {
      ...DEFAULT_EXECUTION_SETTINGS,
      ...(extra.pipelineExecution || {}),
      ...configOverrides,
    } as ExecutionSettings;

    merged.runtimeMode = "conda";
    return merged;
  } catch {
    return {
      ...DEFAULT_EXECUTION_SETTINGS,
      ...configOverrides,
      runtimeMode: "conda",
    };
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

  extra.pipelineExecution = executionSettings;

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
