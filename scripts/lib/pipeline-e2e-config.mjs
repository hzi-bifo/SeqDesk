function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function resolveRuntimeRunConfig({
  defaultConfig,
  overrideConfig,
  overrideProvided,
  savedConfigOnly,
}) {
  if (!isRecord(defaultConfig) || !isRecord(overrideConfig)) {
    throw new Error("Runtime E2E config inputs must be JSON objects.");
  }

  if (savedConfigOnly) {
    if (overrideProvided) {
      throw new Error(
        "--saved-config-only cannot be combined with --config-json or SEQDESK_RUNTIME_E2E_CONFIG_JSON."
      );
    }
    const defaultKeys = Object.keys(defaultConfig);
    if (defaultKeys.length > 0) {
      throw new Error(
        `--saved-config-only requires an empty harness default config; found: ${defaultKeys.join(", ")}.`
      );
    }
    return undefined;
  }

  return {
    ...defaultConfig,
    ...overrideConfig,
  };
}

export function buildRuntimeRunCreateBody({
  pipelineId,
  orderId,
  studyId,
  config,
  executionMode,
  slurm,
}) {
  return {
    pipelineId,
    ...(studyId ? { studyId } : { orderId }),
    ...(config === undefined ? {} : { config }),
    executionMode,
    ...(executionMode === "slurm" && slurm ? { slurm } : {}),
  };
}
