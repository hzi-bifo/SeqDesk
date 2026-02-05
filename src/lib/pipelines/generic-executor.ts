/**
 * Generic Pipeline Executor
 *
 * Prepares and executes pipelines based on manifest configuration.
 * This replaces pipeline-specific executors (like mag/executor.ts) with
 * a manifest-driven approach.
 *
 * The executor uses:
 * - manifest.execution for Nextflow command building
 * - manifest.execution.paramMap for UI config to Nextflow flag conversion
 * - manifest.execution.paramRules for conditional parameter logic
 */

import path from 'path';
import fs from 'fs/promises';
import { db } from '@/lib/db';
import { getPackage, type LoadedPackage, type PackageExecution } from './package-loader';
import { createGenericAdapter } from './generic-adapter';
import { getAdapter, registerAdapter, type PipelineAdapter } from './adapters/types';

// Extended execution type with paramMap and paramRules
interface ExtendedPackageExecution extends PackageExecution {
  paramMap?: Record<string, string>;
  paramRules?: Array<{
    when: Record<string, unknown>;
    add: Array<string | { flag: string; value: unknown }>;
  }>;
}

export interface ExecutionSettings {
  useSlurm: boolean;
  slurmQueue?: string;
  slurmCores?: number;
  slurmMemory?: string;
  slurmTimeLimit?: number;
  slurmOptions?: string;
  runtimeMode?: 'conda';
  condaPath?: string;
  condaEnv?: string;
  nextflowProfile?: string;
  pipelineRunDir: string;
  dataBasePath: string;
  weblogUrl?: string;
  weblogSecret?: string;
}

export interface PrepareRunOptions {
  runId: string;
  pipelineId: string;
  studyId: string;
  sampleIds?: string[];
  config: Record<string, unknown>;
  executionSettings: ExecutionSettings;
  userId: string;
}

export interface PrepareResult {
  success: boolean;
  runId: string;
  runFolder?: string;
  errors: string[];
}

/**
 * Generate run number in format {PIPELINE_ID}-YYYYMMDD-NNN
 */
async function generateRunNumber(pipelineId: string): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `${pipelineId.toUpperCase()}-${dateStr}-`;

  // Find the highest existing run number for today
  const existingRuns = await db.pipelineRun.findMany({
    where: {
      runNumber: { startsWith: prefix },
    },
    select: { runNumber: true },
    orderBy: { runNumber: 'desc' },
    take: 1,
  });

  let nextNum = 1;
  if (existingRuns.length > 0) {
    const lastNum = parseInt(existingRuns[0].runNumber.slice(-3), 10);
    if (!isNaN(lastNum)) {
      nextNum = lastNum + 1;
    }
  }

  return `${prefix}${nextNum.toString().padStart(3, '0')}`;
}

/**
 * Create run directory and prepare files
 */
async function prepareRunDirectory(
  runNumber: string,
  pipelineRunDir: string
): Promise<string> {
  const runFolder = path.join(pipelineRunDir, runNumber);

  await fs.mkdir(runFolder, { recursive: true });
  await fs.mkdir(path.join(runFolder, 'logs'), { recursive: true });

  return runFolder;
}

/**
 * Build weblog URL with run ID and optional secret
 */
function buildWeblogUrl(
  baseUrl: string | undefined,
  runId: string,
  secret?: string
): string | null {
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('runId', runId);
    if (secret) {
      url.searchParams.set('token', secret);
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Build Nextflow config content for weblog
 */
function buildRunConfig(weblogUrl: string | null): string | null {
  if (!weblogUrl) return null;
  return `weblog {\n  enabled = true\n  url = "${weblogUrl}"\n}\n`;
}

function normalizeParamKey(value: string): string {
  return value.replace(/^--?/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * Merge manifest profiles with admin-configured profile
 * - Combines manifest profiles + admin profiles
 * - De-duplicates
 * - Ensures conda is always present (required for SeqDesk execution)
 */
function mergeProfiles(
  manifestProfiles: string[],
  adminProfile?: string
): string {
  const profiles: string[] = [];
  const seen = new Set<string>();

  const addProfile = (profile: string) => {
    const trimmed = profile.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    profiles.push(trimmed);
  };

  // Add manifest profiles first
  for (const p of manifestProfiles) {
    addProfile(p);
  }

  // Add admin-configured profiles (these may override/extend)
  if (adminProfile) {
    for (const p of adminProfile.split(',')) {
      addProfile(p);
    }
  }

  // Ensure conda is always present (required for SeqDesk execution)
  if (!seen.has('conda')) {
    profiles.push('conda');
  }

  return profiles.join(',');
}

/**
 * Check if a rule condition matches the current config
 */
function matchesRule(
  when: Record<string, unknown>,
  config: Record<string, unknown>
): boolean {
  for (const [key, expectedValue] of Object.entries(when)) {
    const actualValue = config[key];

    // Handle different comparison types
    if (typeof expectedValue === 'boolean') {
      if (actualValue !== expectedValue) return false;
    } else if (expectedValue === null) {
      if (actualValue !== null && actualValue !== undefined) return false;
    } else {
      if (actualValue !== expectedValue) return false;
    }
  }
  return true;
}

/**
 * Build pipeline flags from execution config and user config
 *
 * Uses:
 * - execution.defaultParams as base
 * - execution.paramMap to convert UI config keys to Nextflow flags
 * - execution.paramRules for conditional parameters
 */
function buildPipelineFlags(
  execution: ExtendedPackageExecution,
  userConfig: Record<string, unknown>
): string[] {
  const flags: string[] = [];

  // 1. Merge defaultParams with userConfig
  const merged: Record<string, unknown> = {
    ...execution.defaultParams,
    ...userConfig,
  };

  // 2. Apply paramMap (if exists)
  if (execution.paramMap) {
    const mappedFlags = new Set(
      Object.values(execution.paramMap).map((flag) => normalizeParamKey(flag))
    );

    for (const [uiKey, nfFlag] of Object.entries(execution.paramMap)) {
      const value = merged[uiKey];

      if (value === true) {
        // Boolean true -> add flag
        flags.push(nfFlag);
      } else if (value === false || value === null || value === undefined) {
        // Boolean false/null/undefined -> skip
        continue;
      } else {
        // Other values -> add flag with value
        flags.push(`${nfFlag} ${value}`);
      }

      // Remove from merged so we don't process it again
      delete merged[uiKey];
    }

    // Process remaining keys that weren't in paramMap
    for (const [key, value] of Object.entries(merged)) {
      // Skip internal/processed keys
      if (key.startsWith('_')) continue;
      if (mappedFlags.has(normalizeParamKey(key))) continue;

      if (value === true) {
        flags.push(`--${key}`);
      } else if (value === false || value === null || value === undefined) {
        continue;
      } else {
        flags.push(`--${key} ${value}`);
      }
    }
  } else {
    // No paramMap - direct conversion: key -> --key
    for (const [key, value] of Object.entries(merged)) {
      if (key.startsWith('_')) continue;

      if (value === true) {
        flags.push(`--${key}`);
      } else if (value === false || value === null || value === undefined) {
        continue;
      } else {
        flags.push(`--${key} ${value}`);
      }
    }
  }

  // 3. Apply paramRules
  for (const rule of execution.paramRules ?? []) {
    if (matchesRule(rule.when, { ...execution.defaultParams, ...userConfig })) {
      for (const item of rule.add) {
        if (typeof item === 'string') {
          flags.push(item);
        } else {
          flags.push(`${item.flag} ${item.value}`);
        }
      }
    }
  }

  return flags;
}

/**
 * Generate SLURM script for pipeline execution
 */
function generateSlurmScript(
  pkg: LoadedPackage,
  runFolder: string,
  samplesheetPath: string,
  outputDir: string,
  flags: string[],
  settings: ExecutionSettings,
  runConfigPath: string | null,
  runNumber: string
): string {
  const execution = pkg.manifest.execution;
  const traceFile = `${runFolder}/trace.txt`;
  const dagFile = `${runFolder}/dag.dot`;
  const reportFile = `${runFolder}/report.html`;
  const timelineFile = `${runFolder}/timeline.html`;

  // Build conda activation commands
  const condaEnv = settings.condaEnv || 'seqdesk-pipelines';
  let condaActivation = '# No conda path configured - using system PATH';
  if (settings.condaPath) {
    condaActivation = `# Initialize and activate conda environment
export PATH="${settings.condaPath}/bin:$PATH"
source "${settings.condaPath}/etc/profile.d/conda.sh"
if ! conda env list | awk '{print $1}' | grep -qx "${condaEnv}"; then
    echo "ERROR: conda env ${condaEnv} not found"
    exit 1
fi
conda activate ${condaEnv}

# Verify nextflow is available
if ! command -v nextflow &> /dev/null; then
    echo "ERROR: nextflow not found after conda activation"
    exit 1
fi
echo "Using nextflow: $(which nextflow)"`;
  }

  const nameFlag = `-name ${runNumber}`;
  // Merge manifest profiles with admin-configured profile
  const mergedProfiles = mergeProfiles(execution.profiles, settings.nextflowProfile);
  const profileFlag = mergedProfiles ? `-profile ${mergedProfiles}` : '';
  const configFlag = runConfigPath ? `-c ${runConfigPath}` : '';
  // Pin pipeline version from manifest
  const revisionFlag = execution.version ? `-r ${execution.version}` : '';

  const nextflowArgs = [
    `--input ${samplesheetPath}`,
    `--outdir ${outputDir}`,
    `-with-trace ${traceFile}`,
    `-with-dag ${dagFile}`,
    `-with-report ${reportFile}`,
    `-with-timeline ${timelineFile}`,
    nameFlag,
    revisionFlag,
    configFlag,
    profileFlag,
    ...flags,
  ].filter(Boolean).join(' \\\n  ');

  return `#!/bin/bash
#SBATCH -p ${settings.slurmQueue || 'cpu'}
#SBATCH -c ${settings.slurmCores || 4}
#SBATCH --mem='${settings.slurmMemory || '64GB'}'
#SBATCH -t ${settings.slurmTimeLimit || 12}:0:0
#SBATCH -D "${runFolder}"
#SBATCH --output="logs/slurm-%j.out"
#SBATCH --error="logs/slurm-%j.err"
${settings.slurmOptions ? `#SBATCH ${settings.slurmOptions}` : ''}

# Log file paths (read by pipeline monitor)
STDOUT_LOG="${runFolder}/logs/pipeline.out"
STDERR_LOG="${runFolder}/logs/pipeline.err"

echo "Starting ${execution.pipeline} v${execution.version} pipeline at $(date)" > "$STDOUT_LOG"
echo "" > "$STDERR_LOG"

${condaActivation}

# Run ${execution.pipeline} v${execution.version}
nextflow run ${execution.pipeline} \\
  ${nextflowArgs} \\
  >> "$STDOUT_LOG" 2>> "$STDERR_LOG"

# Capture exit code
EXIT_CODE=$?

echo "Pipeline completed with exit code: $EXIT_CODE at $(date)" >> "$STDOUT_LOG"
exit $EXIT_CODE
`;
}

/**
 * Generate local execution script for pipeline
 */
function generateLocalScript(
  pkg: LoadedPackage,
  runFolder: string,
  samplesheetPath: string,
  outputDir: string,
  flags: string[],
  settings: ExecutionSettings,
  runConfigPath: string | null,
  runNumber: string
): string {
  const execution = pkg.manifest.execution;
  const traceFile = `${runFolder}/trace.txt`;
  const dagFile = `${runFolder}/dag.dot`;
  const reportFile = `${runFolder}/report.html`;
  const timelineFile = `${runFolder}/timeline.html`;

  // Build conda activation commands
  const condaEnv = settings.condaEnv || 'seqdesk-pipelines';
  let condaActivation = '# No conda path configured - using system PATH';
  if (settings.condaPath) {
    condaActivation = `# Initialize and activate conda environment
export PATH="${settings.condaPath}/bin:$PATH"
source "${settings.condaPath}/etc/profile.d/conda.sh"
if ! conda env list | awk '{print $1}' | grep -qx "${condaEnv}"; then
    echo "ERROR: conda env ${condaEnv} not found" >> "$STDERR_LOG"
    exit 1
fi
conda activate ${condaEnv}

# Verify nextflow is available
if ! command -v nextflow &> /dev/null; then
    echo "ERROR: nextflow not found after conda activation" >> "$STDERR_LOG"
    echo "PATH=$PATH" >> "$STDERR_LOG"
    exit 1
fi
echo "Using nextflow: $(which nextflow)" >> "$STDOUT_LOG"`;
  }

  const nameFlag = `-name ${runNumber}`;
  // Merge manifest profiles with admin-configured profile
  const mergedProfiles = mergeProfiles(execution.profiles, settings.nextflowProfile);
  const profileFlag = mergedProfiles ? `-profile ${mergedProfiles}` : '';
  const configFlag = runConfigPath ? `-c ${runConfigPath}` : '';
  // Pin pipeline version from manifest
  const revisionFlag = execution.version ? `-r ${execution.version}` : '';

  const nextflowArgs = [
    `--input ${samplesheetPath}`,
    `--outdir ${outputDir}`,
    `-with-trace ${traceFile}`,
    `-with-dag ${dagFile}`,
    `-with-report ${reportFile}`,
    `-with-timeline ${timelineFile}`,
    nameFlag,
    revisionFlag,
    configFlag,
    profileFlag,
    ...flags,
  ].filter(Boolean).join(' \\\n  ');

  return `#!/bin/bash
set -e

# Log file paths
STDOUT_LOG="${runFolder}/logs/pipeline.out"
STDERR_LOG="${runFolder}/logs/pipeline.err"

echo "Starting ${execution.pipeline} v${execution.version} pipeline at $(date)" > "$STDOUT_LOG"
echo "" > "$STDERR_LOG"

${condaActivation}

# Run ${execution.pipeline} v${execution.version}
nextflow run ${execution.pipeline} \\
  ${nextflowArgs} \\
  >> "$STDOUT_LOG" 2>> "$STDERR_LOG"

EXIT_CODE=$?
echo "Pipeline completed with exit code: $EXIT_CODE at $(date)" >> "$STDOUT_LOG"
exit $EXIT_CODE
`;
}

/**
 * Prepare a pipeline run using manifest-driven configuration
 *
 * This creates the run directory, generates the samplesheet and scripts,
 * but does NOT actually execute the pipeline.
 */
export async function prepareGenericRun(
  options: PrepareRunOptions
): Promise<PrepareResult> {
  const {
    runId,
    pipelineId,
    studyId,
    sampleIds,
    config,
    executionSettings,
  } = options;
  const errors: string[] = [];

  try {
    // Load package
    const pkg = getPackage(pipelineId);
    if (!pkg) {
      errors.push(`Pipeline package not found: ${pipelineId}`);
      return { success: false, runId, errors };
    }

    // Generate run number
    const runNumber = await generateRunNumber(pipelineId);

    // Create run directory
    const runFolder = await prepareRunDirectory(
      runNumber,
      executionSettings.pipelineRunDir
    );

    // Get or create adapter for this pipeline
    let adapter: PipelineAdapter | null | undefined = getAdapter(pipelineId);
    if (!adapter) {
      adapter = createGenericAdapter(pipelineId);
      if (adapter) {
        registerAdapter(adapter);
      }
    }

    if (!adapter) {
      errors.push(`Could not create adapter for pipeline: ${pipelineId}`);
      return { success: false, runId, errors };
    }

    // Generate samplesheet
    const samplesheet = await adapter.generateSamplesheet({
      studyId,
      sampleIds,
      dataBasePath: executionSettings.dataBasePath,
    });

    if (samplesheet.errors.length > 0) {
      errors.push(...samplesheet.errors);
    }

    if (samplesheet.sampleCount === 0) {
      errors.push('No valid samples for samplesheet');
      return { success: false, runId, errors };
    }

    // Write samplesheet
    const samplesheetPath = path.join(runFolder, 'samplesheet.csv');
    await fs.writeFile(samplesheetPath, samplesheet.content);

    // Output directory
    const outputDir = path.join(runFolder, 'output');
    await fs.mkdir(outputDir, { recursive: true });

    // Create run-specific Nextflow config (weblog, etc.)
    const weblogUrl = buildWeblogUrl(
      executionSettings.weblogUrl,
      runId,
      executionSettings.weblogSecret
    );
    const runConfig = buildRunConfig(weblogUrl);
    const runConfigPath = runConfig ? path.join(runFolder, 'nextflow.config') : null;
    if (runConfig && runConfigPath) {
      await fs.writeFile(runConfigPath, runConfig);
    }

    // Build pipeline flags
    const execution = pkg.manifest.execution as ExtendedPackageExecution;
    const flags = buildPipelineFlags(execution, config);

    // Generate execution script
    const script = executionSettings.useSlurm
      ? generateSlurmScript(
          pkg,
          runFolder,
          samplesheetPath,
          outputDir,
          flags,
          executionSettings,
          runConfigPath,
          runNumber
        )
      : generateLocalScript(
          pkg,
          runFolder,
          samplesheetPath,
          outputDir,
          flags,
          executionSettings,
          runConfigPath,
          runNumber
        );

    const scriptPath = path.join(runFolder, 'run.sh');
    await fs.writeFile(scriptPath, script);
    await fs.chmod(scriptPath, 0o755);

    // Update run record with folder and paths
    await db.pipelineRun.update({
      where: { id: runId },
      data: {
        runNumber,
        runFolder,
        outputPath: path.join(runFolder, 'logs/pipeline.out'),
        errorPath: path.join(runFolder, 'logs/pipeline.err'),
        status: 'queued',
        queuedAt: new Date(),
        config: JSON.stringify(config),
      },
    });

    return {
      success: true,
      runId,
      runFolder,
      errors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push(`Failed to prepare run: ${message}`);
    return { success: false, runId, errors };
  }
}
