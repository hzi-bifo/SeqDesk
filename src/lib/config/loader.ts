/**
 * Configuration Loader
 *
 * Loads and merges configuration from multiple sources:
 * 1. Environment variables (SEQDESK_*)
 * 2. Config file (seqdesk.config.json)
 * 3. Database settings
 *
 * Priority: ENV > File > Database > Defaults
 */

import fs from 'fs';
import path from 'path';
import type { SeqDeskConfig, ResolvedConfig, ConfigSource } from './types';

const CONFIG_FILE_NAMES = [
  'seqdesk.config.json',
  '.seqdeskrc',
  '.seqdeskrc.json',
];

// Default configuration values
const DEFAULT_CONFIG: SeqDeskConfig = {
  site: {
    name: 'SeqDesk',
    dataBasePath: './data',
  },
  pipelines: {
    enabled: false,
    execution: {
      mode: 'local',
      runDirectory: './pipeline_runs',
      conda: {
        enabled: false,
        path: '/opt/conda',
      },
      slurm: {
        enabled: false,
        queue: 'default',
        cores: 4,
        memory: '16GB',
        timeLimit: 24,
      },
    },
    mag: {
      enabled: true,
      version: '3.4.0',
      stubMode: false,
      skipProkka: true,
      skipConcoct: true,
    },
  },
  ena: {
    testMode: true,
    centerName: '',
  },
  sequencingFiles: {
    extensions: ['.fastq.gz', '.fq.gz', '.fastq', '.fq'],
    scanDepth: 2,
    allowSingleEnd: false,
    ignorePatterns: ['**/tmp/**', '**/undetermined/**'],
  },
  auth: {
    allowRegistration: true,
    requireEmailVerification: false,
    sessionTimeout: 24,
  },
};

/**
 * Environment variable mappings
 * Maps SEQDESK_* env vars to config paths
 */
const ENV_MAPPINGS: Record<string, string> = {
  // Site
  SEQDESK_SITE_NAME: 'site.name',
  SEQDESK_DATA_PATH: 'site.dataBasePath',
  SEQDESK_CONTACT_EMAIL: 'site.contactEmail',

  // Pipelines
  SEQDESK_PIPELINES_ENABLED: 'pipelines.enabled',
  SEQDESK_PIPELINE_RUN_DIR: 'pipelines.execution.runDirectory',
  SEQDESK_PIPELINE_MODE: 'pipelines.execution.mode',

  // Conda
  SEQDESK_CONDA_ENABLED: 'pipelines.execution.conda.enabled',
  SEQDESK_CONDA_PATH: 'pipelines.execution.conda.path',
  SEQDESK_CONDA_ENV: 'pipelines.execution.conda.environment',

  // SLURM
  SEQDESK_SLURM_ENABLED: 'pipelines.execution.slurm.enabled',
  SEQDESK_SLURM_QUEUE: 'pipelines.execution.slurm.queue',
  SEQDESK_SLURM_CORES: 'pipelines.execution.slurm.cores',
  SEQDESK_SLURM_MEMORY: 'pipelines.execution.slurm.memory',
  SEQDESK_SLURM_TIME: 'pipelines.execution.slurm.timeLimit',

  // MAG Pipeline
  SEQDESK_MAG_ENABLED: 'pipelines.mag.enabled',
  SEQDESK_MAG_VERSION: 'pipelines.mag.version',
  SEQDESK_MAG_STUB: 'pipelines.mag.stubMode',

  // ENA
  SEQDESK_ENA_TEST_MODE: 'ena.testMode',
  SEQDESK_ENA_USERNAME: 'ena.username',
  SEQDESK_ENA_PASSWORD: 'ena.password',
  SEQDESK_ENA_CENTER: 'ena.centerName',

  // Sequencing Files
  SEQDESK_FILES_EXTENSIONS: 'sequencingFiles.extensions',
  SEQDESK_FILES_SCAN_DEPTH: 'sequencingFiles.scanDepth',
  SEQDESK_FILES_SINGLE_END: 'sequencingFiles.allowSingleEnd',

  // Auth
  SEQDESK_AUTH_REGISTRATION: 'auth.allowRegistration',
  SEQDESK_SESSION_TIMEOUT: 'auth.sessionTimeout',
};

/**
 * Find config file in project directory
 */
function findConfigFile(baseDir: string = process.cwd()): string | null {
  for (const filename of CONFIG_FILE_NAMES) {
    const filePath = path.join(baseDir, filename);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

/**
 * Load config from file
 */
function loadConfigFile(filePath: string): SeqDeskConfig | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as SeqDeskConfig;
  } catch (error) {
    console.warn(`Warning: Could not load config file ${filePath}:`, error);
    return null;
  }
}

/**
 * Parse environment variable value to appropriate type
 */
function parseEnvValue(value: string, path: string): unknown {
  // Boolean values
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;

  // Number values (for specific paths)
  const numberPaths = [
    'slurm.cores',
    'slurm.timeLimit',
    'scanDepth',
    'sessionTimeout',
  ];
  if (numberPaths.some((p) => path.includes(p))) {
    const num = parseInt(value, 10);
    if (!isNaN(num)) return num;
  }

  // Array values (comma-separated)
  if (path.includes('extensions') || path.includes('ignorePatterns')) {
    return value.split(',').map((s) => s.trim());
  }

  return value;
}

/**
 * Load config from environment variables
 */
function loadEnvConfig(): Partial<SeqDeskConfig> {
  const config: Record<string, unknown> = {};

  for (const [envVar, configPath] of Object.entries(ENV_MAPPINGS)) {
    const value = process.env[envVar];
    if (value !== undefined) {
      setNestedValue(config, configPath, parseEnvValue(value, configPath));
    }
  }

  return config as Partial<SeqDeskConfig>;
}

/**
 * Set a nested value in an object using dot notation
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Deep merge two objects
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceValue = source[key as keyof T];
    const targetValue = target[key as keyof T];

    if (
      sourceValue !== undefined &&
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
    } else if (sourceValue !== undefined) {
      (result as Record<string, unknown>)[key] = sourceValue;
    }
  }

  return result;
}

/**
 * Track which source each config value came from
 */
function trackSources(
  defaultConfig: SeqDeskConfig,
  fileConfig: SeqDeskConfig | null,
  envConfig: Partial<SeqDeskConfig>,
  prefix: string = ''
): Record<string, ConfigSource> {
  const sources: Record<string, ConfigSource> = {};

  function traverse(obj: Record<string, unknown>, currentPath: string): void {
    for (const [key, value] of Object.entries(obj)) {
      const fullPath = currentPath ? `${currentPath}.${key}` : key;

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        traverse(value as Record<string, unknown>, fullPath);
      } else {
        // Determine source
        const envValue = getNestedValue(envConfig, fullPath);
        const fileValue = fileConfig
          ? getNestedValue(fileConfig, fullPath)
          : undefined;

        if (envValue !== undefined) {
          sources[fullPath] = 'env';
        } else if (fileValue !== undefined) {
          sources[fullPath] = 'file';
        } else {
          sources[fullPath] = 'default';
        }
      }
    }
  }

  traverse(defaultConfig as Record<string, unknown>, prefix);
  return sources;
}

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(
  obj: Record<string, unknown>,
  path: string
): unknown | undefined {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

// Cached resolved config
let cachedConfig: ResolvedConfig | null = null;
let cacheTime: number = 0;
const CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Load and merge configuration from all sources
 */
export function loadConfig(forceReload: boolean = false): ResolvedConfig {
  const now = Date.now();

  // Return cached config if still valid
  if (!forceReload && cachedConfig && now - cacheTime < CACHE_TTL) {
    return cachedConfig;
  }

  // Find and load config file
  const filePath = findConfigFile();
  const fileConfig = filePath ? loadConfigFile(filePath) : null;

  // Load environment config
  const envConfig = loadEnvConfig();

  // Merge: defaults <- file <- env
  let mergedConfig = deepMerge(DEFAULT_CONFIG, fileConfig || {});
  mergedConfig = deepMerge(mergedConfig, envConfig);

  // Track sources
  const sources = trackSources(DEFAULT_CONFIG, fileConfig, envConfig);

  cachedConfig = {
    config: mergedConfig,
    sources,
    filePath: filePath || undefined,
    loadedAt: new Date(),
  };
  cacheTime = now;

  return cachedConfig;
}

/**
 * Get a specific config value with source tracking
 */
export function getConfigValue<T>(
  path: string,
  defaultValue?: T
): { value: T; source: ConfigSource } {
  const resolved = loadConfig();
  const value = getNestedValue(
    resolved.config as Record<string, unknown>,
    path
  ) as T;
  const source = resolved.sources[path] || 'default';

  return {
    value: value !== undefined ? value : (defaultValue as T),
    source,
  };
}

/**
 * Clear the config cache (useful after database updates)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
  cacheTime = 0;
}

/**
 * Get the default configuration
 */
export function getDefaultConfig(): SeqDeskConfig {
  return DEFAULT_CONFIG;
}

/**
 * Validate a config object against the schema
 */
export function validateConfig(config: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    errors.push('Config must be an object');
    return { valid: false, errors };
  }

  const cfg = config as SeqDeskConfig;

  // Validate site config
  if (cfg.site?.dataBasePath && typeof cfg.site.dataBasePath !== 'string') {
    errors.push('site.dataBasePath must be a string');
  }

  // Validate pipeline config
  if (cfg.pipelines?.execution?.mode) {
    const validModes = ['local', 'slurm', 'kubernetes'];
    if (!validModes.includes(cfg.pipelines.execution.mode)) {
      errors.push(
        `pipelines.execution.mode must be one of: ${validModes.join(', ')}`
      );
    }
  }

  // Validate ENA config
  if (cfg.ena?.testMode !== undefined && typeof cfg.ena.testMode !== 'boolean') {
    errors.push('ena.testMode must be a boolean');
  }

  // Validate sequencing files config
  if (cfg.sequencingFiles?.scanDepth !== undefined) {
    if (
      typeof cfg.sequencingFiles.scanDepth !== 'number' ||
      cfg.sequencingFiles.scanDepth < 1 ||
      cfg.sequencingFiles.scanDepth > 10
    ) {
      errors.push('sequencingFiles.scanDepth must be a number between 1 and 10');
    }
  }

  return { valid: errors.length === 0, errors };
}
