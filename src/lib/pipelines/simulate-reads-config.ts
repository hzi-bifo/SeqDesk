export const SIMULATE_READS_PIPELINE_ID = "simulate-reads";

export const SIMULATE_READS_MODES = [
  "shortReadPaired",
  "shortReadSingle",
  "longRead",
] as const;
export type SimulateReadsMode = (typeof SIMULATE_READS_MODES)[number];

export const SIMULATE_READS_SIMULATION_MODES = [
  "auto",
  "synthetic",
  "template",
] as const;
export type SimulateReadsSimulationMode =
  (typeof SIMULATE_READS_SIMULATION_MODES)[number];

export const SIMULATE_READS_QUALITY_PROFILES = [
  "standard",
  "highAccuracy",
  "noisy",
] as const;
export type SimulateReadsQualityProfile =
  (typeof SIMULATE_READS_QUALITY_PROFILES)[number];

export interface SimulateReadsConfig {
  simulationMode: SimulateReadsSimulationMode;
  mode: SimulateReadsMode;
  readCount: number;
  readLength: number;
  replaceExisting: boolean;
  qualityProfile: SimulateReadsQualityProfile;
  insertMean: number;
  insertStdDev: number;
  seed: number | null;
  templateDir: string;
}

export const SIMULATE_READS_DEFAULT_CONFIG: SimulateReadsConfig = {
  simulationMode: "auto",
  mode: "shortReadPaired",
  readCount: 1000,
  readLength: 150,
  replaceExisting: true,
  qualityProfile: "standard",
  insertMean: 350,
  insertStdDev: 30,
  seed: null,
  templateDir: "",
};

export const SIMULATE_READS_BASIC_FIELDS = [
  "simulationMode",
  "mode",
  "readCount",
  "readLength",
  "replaceExisting",
  "qualityProfile",
] as const;

export const SIMULATE_READS_ADVANCED_FIELDS = [
  "insertMean",
  "insertStdDev",
  "seed",
] as const;

export const SIMULATE_READS_ENUM_LABELS: Record<string, string> = {
  auto: "Auto",
  synthetic: "Synthetic",
  template: "Template replay",
  shortReadPaired: "Paired-end",
  shortReadSingle: "Single-end",
  longRead: "Long read",
  standard: "Standard",
  highAccuracy: "High accuracy",
  noisy: "Noisy",
};

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = parseFiniteNumber(value);
  if (parsed === null) return fallback;
  const rounded = Math.floor(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function parseTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === "string" && allowed.includes(value)
    ? (value as T[number])
    : fallback;
}

export function normalizeSimulateReadsConfig(
  rawConfig?: Record<string, unknown> | null,
): SimulateReadsConfig {
  const config = rawConfig ?? {};
  const mode = parseEnum(
    config.mode,
    SIMULATE_READS_MODES,
    SIMULATE_READS_DEFAULT_CONFIG.mode,
  );
  const simulationMode = parseEnum(
    config.simulationMode,
    SIMULATE_READS_SIMULATION_MODES,
    SIMULATE_READS_DEFAULT_CONFIG.simulationMode,
  );
  const qualityProfile = parseEnum(
    config.qualityProfile,
    SIMULATE_READS_QUALITY_PROFILES,
    SIMULATE_READS_DEFAULT_CONFIG.qualityProfile,
  );

  const longReadMode = mode === "longRead";
  const readCount = clampInt(
    config.readCount,
    SIMULATE_READS_DEFAULT_CONFIG.readCount,
    longReadMode ? 5 : 2,
    longReadMode ? 5000 : 50000,
  );
  const readLength = clampInt(
    config.readLength,
    SIMULATE_READS_DEFAULT_CONFIG.readLength,
    longReadMode ? 500 : 25,
    longReadMode ? 30000 : 300,
  );
  const minInsertMean = Math.max(readLength * 2 + 20, 200);
  const defaultInsertMean = Math.max(
    SIMULATE_READS_DEFAULT_CONFIG.insertMean,
    minInsertMean,
  );
  const insertMean = clampInt(
    config.insertMean,
    defaultInsertMean,
    minInsertMean,
    5000,
  );
  const insertStdDev = clampInt(
    config.insertStdDev,
    SIMULATE_READS_DEFAULT_CONFIG.insertStdDev,
    5,
    Math.max(5, Math.min(1000, insertMean - readLength)),
  );

  const parsedSeed = parseFiniteNumber(config.seed);
  const seed =
    parsedSeed === null
      ? null
      : clampInt(parsedSeed, 0, 0, 2_147_483_647);

  return {
    simulationMode,
    mode,
    readCount,
    readLength,
    replaceExisting: parseBoolean(
      config.replaceExisting,
      SIMULATE_READS_DEFAULT_CONFIG.replaceExisting,
    ),
    qualityProfile,
    insertMean,
    insertStdDev,
    seed,
    templateDir: parseTrimmedString(config.templateDir),
  };
}

export function getSimulateReadsConfigIssues(
  config: SimulateReadsConfig,
): string[] {
  const issues: string[] = [];

  if (config.mode === "longRead" && config.simulationMode === "template") {
    issues.push(
      "Template simulation is not supported for long-read mode. Choose synthetic or auto mode, or switch to a short-read mode.",
    );
  }

  return issues;
}

export function normalizePipelineRunConfig(
  pipelineId: string,
  rawConfig?: Record<string, unknown> | null,
): Record<string, unknown> {
  if (pipelineId === SIMULATE_READS_PIPELINE_ID) {
    return { ...normalizeSimulateReadsConfig(rawConfig) };
  }
  return rawConfig ?? {};
}

export function getPipelineRunConfigIssues(
  pipelineId: string,
  config: Record<string, unknown>,
): string[] {
  if (pipelineId === SIMULATE_READS_PIPELINE_ID) {
    return getSimulateReadsConfigIssues(normalizeSimulateReadsConfig(config));
  }
  return [];
}
