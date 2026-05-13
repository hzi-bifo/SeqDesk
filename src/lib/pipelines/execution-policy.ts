import {
  DEFAULT_EXECUTION_SETTINGS,
  type ExecutionSettings,
  type SlurmSettings,
} from "./execution-settings";

export type ExecutionMode = "local" | "slurm";
export type ExecutionModeRequest = "default" | ExecutionMode;
export type ExecutionPolicySource = "global" | "pipeline" | "run";

export interface RunExecutionOverride {
  executionMode?: ExecutionModeRequest;
  slurm?: Partial<SlurmSettings>;
}

export interface ResolvedExecutionPolicy {
  mode: ExecutionMode;
  source: ExecutionPolicySource;
  settings: ExecutionSettings;
  profile: {
    mode: ExecutionMode;
    source: ExecutionPolicySource;
    pipelineId: string;
    useSlurm: boolean;
    slurm?: SlurmSettings;
    nextflowProfile: string;
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeExecutionMode(value: unknown): ExecutionModeRequest | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "default" || normalized === "local" || normalized === "slurm") {
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
    const intValue = Math.trunc(value);
    return intValue > 0 ? intValue : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function normalizeSlurmSettings(
  value: unknown
): Partial<SlurmSettings> | undefined {
  const source = toRecord(value);
  if (!source) return undefined;

  const normalized: Partial<SlurmSettings> = {};
  const queue = normalizeString(source.queue ?? source.slurmQueue);
  const cores = normalizePositiveInt(source.cores ?? source.slurmCores);
  const memory = normalizeString(source.memory ?? source.slurmMemory);
  const timeLimit = normalizePositiveInt(source.timeLimit ?? source.slurmTimeLimit);
  const options = normalizeString(
    source.options ?? source.slurmOptions ?? source.clusterOptions
  );

  if (queue) normalized.queue = queue;
  if (cores !== undefined) normalized.cores = cores;
  if (memory) normalized.memory = memory;
  if (timeLimit !== undefined) normalized.timeLimit = timeLimit;
  if (options !== undefined) normalized.options = options;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeRunExecutionOverride(
  value: unknown
): RunExecutionOverride | undefined {
  const source = toRecord(value);
  if (!source) return undefined;

  const executionMode = normalizeExecutionMode(
    source.executionMode ?? source.mode
  );
  const slurm = normalizeSlurmSettings(source.slurm ?? source);

  if (!executionMode && !slurm) return undefined;
  return { executionMode, slurm };
}

export function parseRunExecutionProfileRequest(
  rawProfile: string | null | undefined
): RunExecutionOverride | undefined {
  if (!rawProfile) return undefined;
  try {
    const parsed = JSON.parse(rawProfile) as unknown;
    const request = toRecord(parsed)?.request ?? parsed;
    return normalizeRunExecutionOverride(request);
  } catch {
    return undefined;
  }
}

export function serializeRunExecutionRequest(
  request: RunExecutionOverride | undefined
): string | null {
  if (!request) return null;
  return JSON.stringify({ request });
}

function getGlobalSlurmSettings(settings: ExecutionSettings): SlurmSettings {
  return {
    queue: settings.slurmQueue || DEFAULT_EXECUTION_SETTINGS.slurmQueue,
    cores:
      Number.isFinite(settings.slurmCores) && settings.slurmCores > 0
        ? Math.trunc(settings.slurmCores)
        : DEFAULT_EXECUTION_SETTINGS.slurmCores,
    memory: settings.slurmMemory || DEFAULT_EXECUTION_SETTINGS.slurmMemory,
    timeLimit:
      Number.isFinite(settings.slurmTimeLimit) && settings.slurmTimeLimit > 0
        ? Math.trunc(settings.slurmTimeLimit)
        : DEFAULT_EXECUTION_SETTINGS.slurmTimeLimit,
    options: settings.slurmOptions || DEFAULT_EXECUTION_SETTINGS.slurmOptions,
  };
}

function mergeSlurm(
  base: SlurmSettings,
  override: Partial<SlurmSettings> | undefined
): SlurmSettings {
  if (!override) return base;
  return {
    queue: override.queue || base.queue,
    cores:
      typeof override.cores === "number" &&
      Number.isFinite(override.cores) &&
      override.cores > 0
        ? Math.trunc(override.cores)
        : base.cores,
    memory: override.memory || base.memory,
    timeLimit:
      typeof override.timeLimit === "number" &&
      Number.isFinite(override.timeLimit) &&
      override.timeLimit > 0
        ? Math.trunc(override.timeLimit)
        : base.timeLimit,
    options: override.options ?? base.options,
  };
}

export function buildExecutionProfileJson(
  policy: ResolvedExecutionPolicy,
  resolvedAt = new Date()
): string {
  return JSON.stringify({
    ...policy.profile,
    resolvedAt: resolvedAt.toISOString(),
  });
}

export function resolvePipelineExecutionPolicy(args: {
  pipelineId: string;
  settings: ExecutionSettings;
  runOverride?: RunExecutionOverride;
}): ResolvedExecutionPolicy {
  const { pipelineId, settings, runOverride } = args;
  let mode: ExecutionMode = settings.useSlurm ? "slurm" : "local";
  let source: ExecutionPolicySource = "global";
  let slurm = getGlobalSlurmSettings(settings);
  let nextflowProfile = settings.nextflowProfile || "";

  const pipelineOverride = settings.pipelineOverrides?.[pipelineId];
  if (pipelineOverride) {
    slurm = mergeSlurm(slurm, pipelineOverride.slurm);
    if (pipelineOverride.nextflowProfile?.trim()) {
      nextflowProfile = pipelineOverride.nextflowProfile.trim();
    }
    if (pipelineOverride.mode === "local" || pipelineOverride.mode === "slurm") {
      mode = pipelineOverride.mode;
      source = "pipeline";
    }
  }

  if (runOverride?.slurm) {
    slurm = mergeSlurm(slurm, runOverride.slurm);
  }
  if (runOverride?.executionMode === "local" || runOverride?.executionMode === "slurm") {
    mode = runOverride.executionMode;
    source = "run";
  }

  const effectiveSettings: ExecutionSettings = {
    ...settings,
    useSlurm: mode === "slurm",
    slurmQueue: slurm.queue,
    slurmCores: slurm.cores,
    slurmMemory: slurm.memory,
    slurmTimeLimit: slurm.timeLimit,
    slurmOptions: slurm.options,
    nextflowProfile,
  };

  return {
    mode,
    source,
    settings: effectiveSettings,
    profile: {
      mode,
      source,
      pipelineId,
      useSlurm: mode === "slurm",
      slurm: mode === "slurm" ? slurm : undefined,
      nextflowProfile,
    },
  };
}
