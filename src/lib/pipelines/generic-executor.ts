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

interface PipelineLaunchTarget {
  target: string;
  isLocal: boolean;
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

function buildNextflowRunName(runNumber: string, runId: string): string {
  const safeRunId = runId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8);
  if (!safeRunId) return runNumber;
  return `${runNumber}-${safeRunId}`;
}

function resolvePipelineLaunchTarget(pkg: LoadedPackage): PipelineLaunchTarget {
  const pipelineRef = pkg.manifest.execution.pipeline.trim();

  if (
    pipelineRef.startsWith('/') ||
    pipelineRef.startsWith('./') ||
    pipelineRef.startsWith('../')
  ) {
    return {
      target: path.isAbsolute(pipelineRef)
        ? pipelineRef
        : path.resolve(pkg.basePath, pipelineRef),
      isLocal: true,
    };
  }

  return { target: pipelineRef, isLocal: false };
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
 * Escape values for single-quoted Nextflow config strings.
 */
function escapeNextflowString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, ' ');
}

/**
 * Build run-specific Nextflow config (weblog + executor overrides).
 */
function buildRunConfig(
  weblogUrl: string | null,
  settings: ExecutionSettings,
  pipelineId?: string
): string | null {
  const sections: string[] = [];

  if (weblogUrl) {
    sections.push(`weblog {\n  enabled = true\n  url = "${weblogUrl}"\n}`);
  }

  if (settings.useSlurm) {
    const processLines = [`process {`, `  executor = 'slurm'`];
    if (typeof settings.slurmCores === 'number' && Number.isFinite(settings.slurmCores) && settings.slurmCores > 0) {
      processLines.push(`  cpus = ${Math.floor(settings.slurmCores)}`);
    }
    if (settings.slurmMemory?.trim()) {
      processLines.push(`  memory = '${escapeNextflowString(settings.slurmMemory.trim())}'`);
    }
    if (
      typeof settings.slurmTimeLimit === 'number' &&
      Number.isFinite(settings.slurmTimeLimit) &&
      settings.slurmTimeLimit > 0
    ) {
      processLines.push(`  time = '${settings.slurmTimeLimit}h'`);
    }
    if (settings.slurmQueue?.trim()) {
      processLines.push(`  queue = '${escapeNextflowString(settings.slurmQueue.trim())}'`);
    }
    if (settings.slurmOptions?.trim()) {
      processLines.push(
        `  clusterOptions = '${escapeNextflowString(settings.slurmOptions.trim())}'`
      );
    }
    processLines.push('}');
    sections.push(processLines.join('\n'));
  }

  // Enforce non-default channels to avoid Conda ToS prompts in non-interactive jobs.
  sections.push(
    [
      `conda {`,
      `  channels = ['conda-forge', 'bioconda']`,
      `  createOptions = '--override-channels -c conda-forge -c bioconda'`,
      `}`,
    ].join('\n')
  );

  // CONCOCT can fail in newer Python environments due to missing pkg_resources.
  // Force a compatible interpreter + setuptools for the MAG CONCOCT tasks.
  if (pipelineId === 'mag') {
    sections.push(
      [
        `process {`,
        `  withName: 'NFCORE_MAG:MAG:BINNING:FASTA_BINNING_CONCOCT:CONCOCT_.*' {`,
        `    conda = 'bioconda::concoct=1.1.0 conda-forge::python=3.10 conda-forge::setuptools'`,
        `  }`,
        `}`,
      ].join('\n')
    );
  }

  if (sections.length === 0) return null;
  return `${sections.join('\n\n')}\n`;
}

function normalizeParamKey(value: string): string {
  return value.replace(/^--?/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length === 0;
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

function buildRuntimeBootstrap(settings: ExecutionSettings): string {
  const condaEnv = settings.condaEnv?.trim() || 'seqdesk-pipelines';
  const condaBase = settings.condaPath?.trim();
  const lines: string[] = [];

  lines.push(`CONDA_ENV="${condaEnv}"`);
  lines.push('NEXTFLOW_RUNNER=(nextflow)');
  lines.push('');

  if (condaBase) {
    lines.push('# Initialize and activate conda environment');
    lines.push(`CONDA_BASE="${condaBase}"`);
    lines.push('CONDA_SH="$CONDA_BASE/etc/profile.d/conda.sh"');
    lines.push('export PATH="$CONDA_BASE/bin:$PATH"');
    lines.push('if [ ! -f "$CONDA_SH" ]; then');
    lines.push('  echo "ERROR: conda init script not found at $CONDA_SH" >> "$STDERR_LOG"');
    lines.push('  exit 1');
    lines.push('fi');
    lines.push('source "$CONDA_SH"');
    lines.push('if ! conda activate "$CONDA_ENV" >> "$STDOUT_LOG" 2>> "$STDERR_LOG"; then');
    lines.push('  echo "ERROR: failed to activate conda env $CONDA_ENV" >> "$STDERR_LOG"');
    lines.push('  conda env list >> "$STDERR_LOG" 2>&1 || true');
    lines.push('  exit 1');
    lines.push('fi');
    lines.push('');
  }

  lines.push('# Resolve Nextflow binary');
  lines.push('if command -v nextflow >/dev/null 2>&1; then');
  lines.push('  NEXTFLOW_RUNNER=(nextflow)');
  lines.push('  echo "Using nextflow: $(command -v nextflow)" >> "$STDOUT_LOG"');
  lines.push('elif command -v conda >/dev/null 2>&1 && conda run -n "$CONDA_ENV" nextflow -version >/dev/null 2>&1; then');
  lines.push('  NEXTFLOW_RUNNER=(conda run -n "$CONDA_ENV" nextflow)');
  lines.push('  echo "Using nextflow via conda run in env $CONDA_ENV" >> "$STDOUT_LOG"');
  lines.push('else');
  lines.push('  echo "ERROR: nextflow not found after conda activation" >> "$STDERR_LOG"');
  lines.push('  echo "PATH=$PATH" >> "$STDERR_LOG"');
  lines.push('  if command -v conda >/dev/null 2>&1; then');
  lines.push('    conda info --envs >> "$STDERR_LOG" 2>&1 || true');
  lines.push('  fi');
  lines.push('  exit 1');
  lines.push('fi');

  return lines.join('\n');
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
      const trimmedFlag = nfFlag.trim();

      // Empty mappings mark SeqDesk-only settings that must not be passed to Nextflow.
      if (!trimmedFlag) {
        delete merged[uiKey];
        continue;
      }

      if (value === true) {
        // Boolean true -> add flag
        flags.push(trimmedFlag);
      } else if (value === false || value === null || value === undefined || isBlankString(value)) {
        // Boolean false/null/undefined -> skip
        continue;
      } else {
        // Other values -> add flag with value
        flags.push(`${trimmedFlag} ${value}`);
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
      } else if (value === false || value === null || value === undefined || isBlankString(value)) {
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
      } else if (value === false || value === null || value === undefined || isBlankString(value)) {
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

  // Preserve order while removing exact duplicates.
  return [...new Set(flags)];
}

/**
 * Generate SLURM script for pipeline execution
 */
function generateSlurmScript(
  pkg: LoadedPackage,
  pipelineTarget: PipelineLaunchTarget,
  runFolder: string,
  samplesheetPath: string,
  outputDir: string,
  flags: string[],
  settings: ExecutionSettings,
  runConfigPath: string | null,
  runNumber: string,
  runId: string
): string {
  const execution = pkg.manifest.execution;
  const traceFile = `${runFolder}/trace.txt`;
  const dagFile = `${runFolder}/dag.dot`;
  const reportFile = `${runFolder}/report.html`;
  const timelineFile = `${runFolder}/timeline.html`;
  const runtimeBootstrap = buildRuntimeBootstrap(settings);

  const runName = buildNextflowRunName(runNumber, runId);
  const nameFlag = `-name ${runName}`;
  // Merge manifest profiles with admin-configured profile
  const mergedProfiles = mergeProfiles(execution.profiles, settings.nextflowProfile);
  const profileFlag = mergedProfiles ? `-profile ${mergedProfiles}` : '';
  const configFlag = runConfigPath ? `-c ${runConfigPath}` : '';
  const revisionFlag = !pipelineTarget.isLocal && execution.version ? `-r ${execution.version}` : '';
  const pipelineLabel = pipelineTarget.isLocal
    ? `${execution.pipeline} (local)`
    : `${execution.pipeline} v${execution.version}`;

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

set -euo pipefail

# Log file paths (read by pipeline monitor)
STDOUT_LOG="${runFolder}/logs/pipeline.out"
STDERR_LOG="${runFolder}/logs/pipeline.err"

echo "Starting ${pipelineLabel} pipeline at $(date)" > "$STDOUT_LOG"
echo "" > "$STDERR_LOG"

${runtimeBootstrap}

# Run ${pipelineLabel}
"\${NEXTFLOW_RUNNER[@]}" run "${pipelineTarget.target}" \\
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
  pipelineTarget: PipelineLaunchTarget,
  runFolder: string,
  samplesheetPath: string,
  outputDir: string,
  flags: string[],
  settings: ExecutionSettings,
  runConfigPath: string | null,
  runNumber: string,
  runId: string
): string {
  const execution = pkg.manifest.execution;
  const traceFile = `${runFolder}/trace.txt`;
  const dagFile = `${runFolder}/dag.dot`;
  const reportFile = `${runFolder}/report.html`;
  const timelineFile = `${runFolder}/timeline.html`;
  const runtimeBootstrap = buildRuntimeBootstrap(settings);

  const runName = buildNextflowRunName(runNumber, runId);
  const nameFlag = `-name ${runName}`;
  // Merge manifest profiles with admin-configured profile
  const mergedProfiles = mergeProfiles(execution.profiles, settings.nextflowProfile);
  const profileFlag = mergedProfiles ? `-profile ${mergedProfiles}` : '';
  const configFlag = runConfigPath ? `-c ${runConfigPath}` : '';
  const revisionFlag = !pipelineTarget.isLocal && execution.version ? `-r ${execution.version}` : '';
  const pipelineLabel = pipelineTarget.isLocal
    ? `${execution.pipeline} (local)`
    : `${execution.pipeline} v${execution.version}`;

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
set -euo pipefail

# Log file paths
STDOUT_LOG="${runFolder}/logs/pipeline.out"
STDERR_LOG="${runFolder}/logs/pipeline.err"

echo "Starting ${pipelineLabel} pipeline at $(date)" > "$STDOUT_LOG"
echo "" > "$STDERR_LOG"

${runtimeBootstrap}

# Run ${pipelineLabel}
"\${NEXTFLOW_RUNNER[@]}" run "${pipelineTarget.target}" \\
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

    const pipelineTarget = resolvePipelineLaunchTarget(pkg);
    if (pipelineTarget.isLocal) {
      try {
        await fs.access(pipelineTarget.target);
      } catch {
        errors.push(`Local pipeline path not found: ${pipelineTarget.target}`);
        return { success: false, runId, errors };
      }
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
    const runConfig = buildRunConfig(weblogUrl, executionSettings, pipelineId);
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
          pipelineTarget,
          runFolder,
          samplesheetPath,
          outputDir,
          flags,
          executionSettings,
          runConfigPath,
          runNumber,
          runId
        )
      : generateLocalScript(
          pkg,
          pipelineTarget,
          runFolder,
          samplesheetPath,
          outputDir,
          flags,
          executionSettings,
          runConfigPath,
          runNumber,
          runId
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
