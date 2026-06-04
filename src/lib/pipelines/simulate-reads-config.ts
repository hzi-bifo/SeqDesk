import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export const SIMULATE_READS_PIPELINE_ID = "simulate-reads";
export const READ_CLEANING_PIPELINE_ID = "read-cleaning";

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
    Math.max(minInsertMean, 5000),
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
  if (pipelineId === READ_CLEANING_PIPELINE_ID) {
    const issues: string[] = [];
    const classificationKraken2 = config.classificationKraken2 !== false;
    const classificationBbduk = config.classificationBbduk === true;
    const kraken2Db = typeof config.kraken2Db === "string" ? config.kraken2Db.trim() : "";
    const bbdukReference =
      typeof config.bbdukReference === "string" ? config.bbdukReference.trim() : "";

    if (!classificationKraken2 && !classificationBbduk) {
      issues.push("Read Cleaning needs at least one contaminant classifier enabled.");
    }

    if (classificationKraken2 && !kraken2Db) {
      issues.push("Read Cleaning needs a Kraken2 database path when Kraken2 classification is enabled.");
    }

    if (classificationBbduk && !bbdukReference) {
      issues.push("Read Cleaning needs a BBDuk reference FASTA when BBDuk classification is enabled.");
    }

    return issues;
  }
  return [];
}

const KRAKEN2_DB_FILES = ["hash.k2d", "opts.k2d", "taxo.k2d"] as const;

/**
 * Path-level validation for the read-cleaning classifier databases.
 *
 * In `local` mode the supplied paths live on the API host, so we stat them:
 * the Kraken2 database must be a directory (ideally containing the standard
 * hash.k2d/opts.k2d/taxo.k2d files) and the BBDuk reference must be a readable
 * file. A bogus path surfaces here as a blocking issue instead of dying deep in
 * the scheduler.
 *
 * In `slurm` (remote) mode the paths refer to a compute node we cannot stat, so
 * we only require them to be absolute and surface a non-blocking warning rather
 * than a false-negative failure.
 *
 * Returns `{ issues, warnings }`. `issues` block the run; `warnings` do not.
 * Non read-cleaning pipelines return empty arrays.
 */
export function getReadCleaningPathIssues(
  pipelineId: string,
  config: Record<string, unknown>,
  mode: "local" | "slurm",
): { issues: string[]; warnings: string[] } {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (pipelineId !== READ_CLEANING_PIPELINE_ID) {
    return { issues, warnings };
  }

  const classificationKraken2 = config.classificationKraken2 !== false;
  const classificationBbduk = config.classificationBbduk === true;
  const kraken2Db =
    typeof config.kraken2Db === "string" ? config.kraken2Db.trim() : "";
  const bbdukReference =
    typeof config.bbdukReference === "string" ? config.bbdukReference.trim() : "";

  if (classificationKraken2 && kraken2Db) {
    if (mode === "local") {
      let stat: ReturnType<typeof statSync> | null = null;
      try {
        stat = existsSync(kraken2Db) ? statSync(kraken2Db) : null;
      } catch {
        stat = null;
      }
      if (!stat) {
        issues.push(
          `Kraken2 database path does not exist or is not readable: ${kraken2Db}`,
        );
      } else if (!stat.isDirectory()) {
        issues.push(
          `Kraken2 database path is not a directory: ${kraken2Db}`,
        );
      } else {
        const missing = KRAKEN2_DB_FILES.filter(
          (file) => !existsSync(join(kraken2Db, file)),
        );
        if (missing.length > 0) {
          issues.push(
            `Kraken2 database at ${kraken2Db} is missing expected files: ${missing.join(", ")}`,
          );
        }
      }
    } else if (!isAbsolute(kraken2Db)) {
      issues.push(
        `Kraken2 database path must be absolute for remote execution: ${kraken2Db}`,
      );
    } else {
      warnings.push(
        `Kraken2 database path ${kraken2Db} is assumed to exist on the compute node; it is not verified from this host.`,
      );
    }
  }

  if (classificationBbduk && bbdukReference) {
    if (mode === "local") {
      let stat: ReturnType<typeof statSync> | null = null;
      try {
        stat = existsSync(bbdukReference) ? statSync(bbdukReference) : null;
      } catch {
        stat = null;
      }
      if (!stat) {
        issues.push(
          `BBDuk reference FASTA does not exist or is not readable: ${bbdukReference}`,
        );
      } else if (!stat.isFile()) {
        issues.push(
          `BBDuk reference FASTA is not a file: ${bbdukReference}`,
        );
      }
    } else if (!isAbsolute(bbdukReference)) {
      issues.push(
        `BBDuk reference FASTA path must be absolute for remote execution: ${bbdukReference}`,
      );
    } else {
      warnings.push(
        `BBDuk reference FASTA ${bbdukReference} is assumed to exist on the compute node; it is not verified from this host.`,
      );
    }
  }

  return { issues, warnings };
}
