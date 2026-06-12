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
import os from 'os';
import { db } from '@/lib/db';
import { getPackage, type LoadedPackage, type PackageExecution } from './package-loader';
import { createGenericAdapter } from './generic-adapter';
import { getAdapter, registerAdapter, type PipelineAdapter } from './adapters/types';
import type { PipelineTarget } from './types';

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
  condaCacheDir?: string;
  nextflowProfile?: string;
  pipelineRunDir: string;
  dataBasePath: string;
  weblogUrl?: string;
  weblogSecret?: string;
  /** When true, omit conda from Nextflow profiles (macOS ARM local execution) */
  skipConda?: boolean;
}

export interface PrepareRunOptions {
  runId: string;
  pipelineId: string;
  target: PipelineTarget;
  config: Record<string, unknown>;
  executionSettings: ExecutionSettings;
  userId: string;
}

export interface PrepareResult {
  success: boolean;
  runId: string;
  runFolder?: string;
  errors: string[];
  /**
   * Non-fatal issues from preparation — e.g. samples skipped during samplesheet
   * generation. The run still launches, but these should be surfaced so the user
   * knows the run covers fewer samples than were selected.
   */
  warnings?: string[];
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

  // Find all existing run numbers for today.
  const existingRuns = await db.pipelineRun.findMany({
    where: {
      runNumber: { startsWith: prefix },
    },
    select: { runNumber: true },
  });

  // Compute the numeric max of the trailing counter across all rows. We cannot
  // rely on `orderBy: { runNumber: 'desc' }` because that sort is lexicographic
  // ("999" sorts after "1000"), which would stall the sequence at 999. Parsing
  // everything after the prefix keeps the counter incrementing past 999.
  let nextNum = 1;
  for (const run of existingRuns) {
    const lastNum = parseInt(run.runNumber.slice(prefix.length), 10);
    if (!isNaN(lastNum) && lastNum + 1 > nextNum) {
      nextNum = lastNum + 1;
    }
  }

  // Pad to at least 3 digits but allow wider counters once a day exceeds 999 runs.
  return `${prefix}${nextNum.toString().padStart(3, '0')}`;
}

/**
 * Detect a Prisma unique-constraint violation (P2002) on the runNumber column,
 * which signals that a concurrent prepare claimed the same generated run number.
 */
function isRunNumberConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (code !== 'P2002') return false;

  // When Prisma reports the offending field(s), only treat runNumber collisions
  // as retryable; any other unique violation should surface normally.
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (typeof target === 'string') return target.includes('runNumber');
  if (Array.isArray(target)) return target.includes('runNumber');
  return true;
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
  const runFolder = path.resolve(pipelineRunDir, runNumber);

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

  // By default a SLURM run submits one SLURM job per process (executor='slurm').
  // On clusters that cap concurrent submissions per user (e.g. QOS
  // MaxSubmitJobsPerUser=1) that nested submission fails. Setting
  // SEQDESK_SLURM_INLINE_EXECUTOR keeps the run wrapped in a single sbatch job but
  // runs the processes with Nextflow's local executor inside that one allocation, so
  // no further jobs are submitted — at the cost of single-node parallelism.
  const slurmInlineExecutor =
    process.env.SEQDESK_SLURM_INLINE_EXECUTOR === '1' ||
    process.env.SEQDESK_SLURM_INLINE_EXECUTOR === 'true';

  if (settings.useSlurm && !slurmInlineExecutor) {
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

  // Overwrite the run report/timeline/trace/dag instead of ABORTING when they already exist.
  // nextflow throws "Report file already exists -- enable the 'report.overwrite' option" when a
  // run folder is reused (a resubmit/retry, or local+SLURM runs landing in the same folder).
  // Each run regenerates these files, so overwriting is safe — and is nextflow's recommended fix.
  sections.push(
    ['report.overwrite = true', 'timeline.overwrite = true', 'trace.overwrite = true', 'dag.overwrite = true'].join('\n'),
  );

  // Enforce non-default channels to avoid Conda ToS prompts in non-interactive jobs.
  const condaBlock = [
    `profiles {`,
    `  standard {}`,
    `  conda {`,
    `    conda.enabled = true`,
    `  }`,
    `}`,
    ``,
    `conda {`,
    `  channels = ['conda-forge', 'bioconda']`,
    `  useMamba = false`,
    `  createOptions = '--override-channels -c conda-forge -c bioconda'`,
  ];
  // Shared conda cacheDir: per-process envs are cached here by hash and reused across
  // runs, so a host with network can pre-build an env that network-isolated SLURM
  // compute nodes reuse without fetching from conda channels.
  if (settings.condaCacheDir?.trim()) {
    condaBlock.push(`  cacheDir = '${escapeNextflowString(settings.condaCacheDir.trim())}'`);
  }
  condaBlock.push(`}`);
  sections.push(condaBlock.join('\n'));

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

  if (pipelineId === 'simulate-reads' && settings.dataBasePath.trim()) {
    sections.push(
      `params {\n  dataBasePath = '${escapeNextflowString(settings.dataBasePath.trim())}'\n}`
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

function toPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.floor(value);
    return normalized > 0 ? normalized : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function getAvailableLocalCpus(): number | null {
  try {
    const available =
      typeof os.availableParallelism === 'function'
        ? os.availableParallelism()
        : os.cpus().length;
    return toPositiveInteger(available);
  } catch {
    return null;
  }
}

function normalizeConfigForLocalExecution(
  pipelineId: string,
  execution: ExtendedPackageExecution,
  userConfig: Record<string, unknown>,
  settings: ExecutionSettings
): Record<string, unknown> {
  if (pipelineId !== 'metaxpath' || settings.useSlurm) {
    return userConfig;
  }

  const localCpus = getAvailableLocalCpus();
  const requestedThreads = toPositiveInteger(
    userConfig.threads ?? execution.defaultParams?.threads
  );

  if (!localCpus || !requestedThreads || requestedThreads <= localCpus) {
    return userConfig;
  }

  // Nextflow's local executor refuses tasks whose cpus exceed the local budget.
  // MetaxPath defaults to 20 threads, so cap local runs to the host/container limit.
  return {
    ...userConfig,
    threads: localCpus,
  };
}

// Wrap a value as a single POSIX shell token. Values that are only made up of
// safe characters are emitted verbatim; anything else is single-quoted with
// embedded single quotes escaped via the standard '\'' dance. This is the
// boundary that prevents user-config values from becoming shell syntax when
// they get written into run.sh.
function shellQuote(value: string): string {
  if (value === '') return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// The run folder is interpolated literally into the generated script (including
// the #SBATCH -D directive, which is parsed by SLURM rather than the shell and so
// cannot be shell-quoted). Characters that would break out of a double-quoted
// context, run a command substitution, or inject extra #SBATCH lines must never
// appear in it. pipelineRunDir is validated on save, but it can also come from a
// config file or env var, so guard at launch as a final backstop.
const SHELL_UNSAFE_RUN_FOLDER = /[\x00-\x1f\x7f"`$\\]/;
function assertSafeRunFolder(runFolder: string): void {
  if (SHELL_UNSAFE_RUN_FOLDER.test(runFolder)) {
    throw new Error(
      'Refusing to launch pipeline: run directory contains unsafe characters'
    );
  }
}

function isSafeFlagKey(key: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(key);
}

// SLURM header fields are interpolated into the generated SBATCH preamble, so
// they must never contain shell/SBATCH metacharacters. These validators reduce
// each field to a safe default when the admin-supplied value is malformed.
function sanitizeSlurmMemory(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (trimmed && /^\d+[KMGT]?B?$/.test(trimmed)) return trimmed;
  return fallback;
}

function sanitizeSlurmQueue(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (trimmed && /^[A-Za-z0-9_-]+$/.test(trimmed)) return trimmed;
  return fallback;
}

function sanitizeSlurmTimeLimit(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  return fallback;
}

// slurmOptions is free-form admin text (e.g. "--gres=gpu:1"). Reject embedded
// newlines (which would inject extra SBATCH/script lines) and shell-quote each
// whitespace-separated token so it cannot break out of the directive.
function sanitizeSlurmOptions(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return '';
  if (/[\r\n]/.test(trimmed)) return '';
  return trimmed
    .split(/\s+/)
    .map((token) => shellQuote(token))
    .join(' ');
}

/**
 * Merge manifest profiles with admin-configured profile
 * - Combines manifest profiles + admin profiles
 * - De-duplicates
 * - Ensures conda is always present (required for SeqDesk execution)
 * - When skipConda is true, omits the conda profile (for macOS ARM local execution)
 */
export function mergeProfiles(
  manifestProfiles: string[],
  adminProfile?: string,
  options?: { skipConda?: boolean }
): string {
  const skipConda = options?.skipConda ?? false;
  const profiles: string[] = [];
  const seen = new Set<string>();

  const addProfile = (profile: string) => {
    const trimmed = profile.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (skipConda && key === 'conda') return;
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
  // unless explicitly skipped for macOS ARM local execution
  if (!skipConda && !seen.has('conda')) {
    profiles.push('conda');
  }

  return profiles.join(',');
}

function buildRuntimeBootstrap(settings: ExecutionSettings): string {
  const condaEnv = settings.condaEnv?.trim() || 'seqdesk-pipelines';
  const condaBase = settings.condaPath?.trim();
  const lines: string[] = [];

  // condaEnv/condaBase are admin- and config-supplied free-form strings, so
  // shell-quote them rather than interpolating into a bare double-quoted
  // assignment (a value like x"; rm -rf ~; :" would otherwise break out).
  lines.push(`CONDA_ENV=${shellQuote(condaEnv)}`);
  lines.push('NEXTFLOW_RUNNER=(nextflow)');
  lines.push('');

  if (condaBase) {
    lines.push('# Initialize and activate conda environment');
    lines.push(`CONDA_BASE=${shellQuote(condaBase)}`);
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

    const paramEntries = Object.entries(execution.paramMap);
    const orderedParamEntries = [
      ...paramEntries.filter(([, nfFlag]) => nfFlag.trim() === "-params-file"),
      ...paramEntries.filter(([, nfFlag]) => nfFlag.trim() !== "-params-file"),
    ];

    for (const [uiKey, nfFlag] of orderedParamEntries) {
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
      } else if (value === false) {
        // Single-dash Nextflow switches such as -stub are presence-only.
        if (!trimmedFlag.startsWith("-") || trimmedFlag.startsWith("--")) {
          flags.push(`${trimmedFlag} false`);
        }
      } else if (value === null || value === undefined || isBlankString(value)) {
        // null/undefined/blank -> skip
        continue;
      } else {
        // Other values -> add flag with shell-escaped value
        flags.push(`${trimmedFlag} ${shellQuote(String(value))}`);
      }

      // Remove from merged so we don't process it again
      delete merged[uiKey];
    }

    // Process remaining keys that weren't in paramMap
    for (const [key, value] of Object.entries(merged)) {
      // Skip internal/processed keys
      if (key.startsWith('_')) continue;
      if (mappedFlags.has(normalizeParamKey(key))) continue;
      if (!isSafeFlagKey(key)) continue;

      if (value === true) {
        flags.push(`--${key}`);
      } else if (value === false) {
        flags.push(`--${key} false`);
      } else if (value === null || value === undefined || isBlankString(value)) {
        continue;
      } else {
        flags.push(`--${key} ${shellQuote(String(value))}`);
      }
    }
  } else {
    // No paramMap - direct conversion: key -> --key
    for (const [key, value] of Object.entries(merged)) {
      if (key.startsWith('_')) continue;
      if (!isSafeFlagKey(key)) continue;

      if (value === true) {
        flags.push(`--${key}`);
      } else if (value === false) {
        flags.push(`--${key} false`);
      } else if (value === null || value === undefined || isBlankString(value)) {
        continue;
      } else {
        flags.push(`--${key} ${shellQuote(String(value))}`);
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
          flags.push(`${item.flag} ${shellQuote(String(item.value))}`);
        }
      }
    }
  }

  // Preserve order while removing exact duplicates.
  return [...new Set(flags)];
}

/**
 * SeqDesk always emits --input (samplesheet) and --outdir (run output dir) as
 * hardcoded Nextflow args. Strip any user/config-derived occurrences of those
 * flags so they are never passed twice (Nextflow would otherwise see duplicate
 * params).
 */
function stripReservedNextflowFlags(flags: string[]): string[] {
  const reserved = new Set(['--input', '--outdir']);
  return flags.filter((flag) => {
    const flagName = flag.trim().split(/\s+/)[0];
    return !reserved.has(flagName);
  });
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
  assertSafeRunFolder(runFolder);
  const execution = pkg.manifest.execution;
  const traceFile = `${runFolder}/trace.txt`;
  const dagFile = `${runFolder}/dag.dot`;
  const reportFile = `${runFolder}/report.html`;
  const timelineFile = `${runFolder}/timeline.html`;
  const runtimeBootstrap = buildRuntimeBootstrap(settings);

  const runName = buildNextflowRunName(runNumber, runId);
  const nameFlag = `-name ${shellQuote(runName)}`;
  // Merge manifest profiles with admin-configured profile
  const mergedProfiles = mergeProfiles(execution.profiles, settings.nextflowProfile, { skipConda: settings.skipConda });
  const profileFlag = mergedProfiles ? `-profile ${shellQuote(mergedProfiles)}` : '';
  const configFlag = runConfigPath ? `-c ${shellQuote(runConfigPath)}` : '';
  const revisionFlag = !pipelineTarget.isLocal && execution.version ? `-r ${shellQuote(execution.version)}` : '';
  const pipelineLabel = pipelineTarget.isLocal
    ? `${execution.pipeline} (local)`
    : `${execution.pipeline} v${execution.version}`;

  const nextflowArgs = [
    `--input ${shellQuote(samplesheetPath)}`,
    `--outdir ${shellQuote(outputDir)}`,
    `-with-trace ${shellQuote(traceFile)}`,
    `-with-dag ${shellQuote(dagFile)}`,
    `-with-report ${shellQuote(reportFile)}`,
    `-with-timeline ${shellQuote(timelineFile)}`,
    nameFlag,
    revisionFlag,
    configFlag,
    profileFlag,
    ...stripReservedNextflowFlags(flags),
  ].filter(Boolean).join(' \\\n  ');

  const slurmQueue = sanitizeSlurmQueue(settings.slurmQueue, 'cpu');
  const slurmCores =
    typeof settings.slurmCores === 'number' && Number.isFinite(settings.slurmCores) && settings.slurmCores > 0
      ? Math.floor(settings.slurmCores)
      : 4;
  const slurmMemory = sanitizeSlurmMemory(settings.slurmMemory, '64GB');
  const slurmTimeLimit = sanitizeSlurmTimeLimit(settings.slurmTimeLimit, 12);
  const slurmOptions = sanitizeSlurmOptions(settings.slurmOptions);

  return `#!/bin/bash
#SBATCH -p ${slurmQueue}
#SBATCH -c ${slurmCores}
#SBATCH --mem='${slurmMemory}'
#SBATCH -t ${slurmTimeLimit}:0:0
#SBATCH -D "${runFolder}"
#SBATCH --output="/tmp/seqdesk-slurm-%j.out"
#SBATCH --error="/tmp/seqdesk-slurm-%j.err"
${slurmOptions ? `#SBATCH ${slurmOptions}` : ''}

set -euo pipefail

# SLURM opens its own --output/--error as the slurm daemon user (often root),
# which silently fails on a root-squashed NFS run dir, so they point at
# node-local /tmp and are copied back below.
#
# The run dir is created on the submit node ~1s before this job starts; on a
# shared NFS home the compute node may not see the fresh dir yet, so a plain
# mkdir/redirect into it can fail. Retry creating the logs dir + a write probe
# until NFS propagates (up to ~30s) before relying on it. The pipeline logs below
# are then written by this script as the job user, which works on NFS.
for _ in $(seq 1 15); do
  if mkdir -p "${runFolder}/logs" 2>/dev/null && : > "${runFolder}/logs/.nfs-probe" 2>/dev/null; then
    rm -f "${runFolder}/logs/.nfs-probe" 2>/dev/null || true
    break
  fi
  sleep 2
done

# Log file paths (read by pipeline monitor)
STDOUT_LOG="${runFolder}/logs/pipeline.out"
STDERR_LOG="${runFolder}/logs/pipeline.err"

# Always record the real exit code for the pipeline monitor, even when a
# command fails under "set -e" (which would otherwise abort before the marker
# below is reached). Also copy SLURM's node-local logs into the run dir.
trap 'EXIT_CODE=$?; echo "Pipeline completed with exit code: $EXIT_CODE at $(date)" >> "$STDOUT_LOG"; cp -f "/tmp/seqdesk-slurm-$SLURM_JOB_ID.out" "${runFolder}/logs/slurm-$SLURM_JOB_ID.out" 2>/dev/null || true; cp -f "/tmp/seqdesk-slurm-$SLURM_JOB_ID.err" "${runFolder}/logs/slurm-$SLURM_JOB_ID.err" 2>/dev/null || true; exit $EXIT_CODE' EXIT

echo "Starting ${pipelineLabel} pipeline at $(date)" > "$STDOUT_LOG"
echo "" > "$STDERR_LOG"

${runtimeBootstrap}

# Run ${pipelineLabel}
"\${NEXTFLOW_RUNNER[@]}" run ${shellQuote(pipelineTarget.target)} \\
  ${nextflowArgs} \\
  >> "$STDOUT_LOG" 2>> "$STDERR_LOG"
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
  assertSafeRunFolder(runFolder);
  const execution = pkg.manifest.execution;
  const traceFile = `${runFolder}/trace.txt`;
  const dagFile = `${runFolder}/dag.dot`;
  const reportFile = `${runFolder}/report.html`;
  const timelineFile = `${runFolder}/timeline.html`;
  const runtimeBootstrap = buildRuntimeBootstrap(settings);

  const runName = buildNextflowRunName(runNumber, runId);
  const nameFlag = `-name ${shellQuote(runName)}`;
  // Merge manifest profiles with admin-configured profile
  const mergedProfiles = mergeProfiles(execution.profiles, settings.nextflowProfile, { skipConda: settings.skipConda });
  const profileFlag = mergedProfiles ? `-profile ${shellQuote(mergedProfiles)}` : '';
  const configFlag = runConfigPath ? `-c ${shellQuote(runConfigPath)}` : '';
  const revisionFlag = !pipelineTarget.isLocal && execution.version ? `-r ${shellQuote(execution.version)}` : '';
  const pipelineLabel = pipelineTarget.isLocal
    ? `${execution.pipeline} (local)`
    : `${execution.pipeline} v${execution.version}`;

  const nextflowArgs = [
    `--input ${shellQuote(samplesheetPath)}`,
    `--outdir ${shellQuote(outputDir)}`,
    `-with-trace ${shellQuote(traceFile)}`,
    `-with-dag ${shellQuote(dagFile)}`,
    `-with-report ${shellQuote(reportFile)}`,
    `-with-timeline ${shellQuote(timelineFile)}`,
    nameFlag,
    revisionFlag,
    configFlag,
    profileFlag,
    ...stripReservedNextflowFlags(flags),
  ].filter(Boolean).join(' \\\n  ');

  return `#!/bin/bash
set -euo pipefail

# Log file paths
STDOUT_LOG="${runFolder}/logs/pipeline.out"
STDERR_LOG="${runFolder}/logs/pipeline.err"

# Always record the real exit code for the pipeline monitor, even when a
# command fails under "set -e" (which would otherwise abort before the marker
# below is reached).
trap 'EXIT_CODE=$?; echo "Pipeline completed with exit code: $EXIT_CODE at $(date)" >> "$STDOUT_LOG"; exit $EXIT_CODE' EXIT

echo "Starting ${pipelineLabel} pipeline at $(date)" > "$STDOUT_LOG"
echo "" > "$STDERR_LOG"

${runtimeBootstrap}

# Run ${pipelineLabel}
"\${NEXTFLOW_RUNNER[@]}" run ${shellQuote(pipelineTarget.target)} \\
  ${nextflowArgs} \\
  >> "$STDOUT_LOG" 2>> "$STDERR_LOG"
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
    target,
    config,
    executionSettings,
  } = options;
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Load package
    const pkg = getPackage(pipelineId);
    if (!pkg) {
      errors.push(`Pipeline package not found: ${pipelineId}`);
      return { success: false, runId, errors };
    }

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
      target,
      dataBasePath: executionSettings.dataBasePath,
      config,
    });

    if (samplesheet.sampleCount === 0) {
      // No usable samples at all is a hard failure; include the per-sample
      // reasons so the user can see why every sample was rejected.
      errors.push('No valid samples for samplesheet');
      errors.push(...samplesheet.errors);
      return { success: false, runId, errors };
    }

    // Some samples were skipped but the run still has usable samples. These are
    // non-fatal warnings — the run launches with fewer samples than selected, so
    // they must be surfaced rather than silently dropped on the success path.
    if (samplesheet.errors.length > 0) {
      warnings.push(...samplesheet.errors);
    }

    // Build pipeline flags
    const execution = pkg.manifest.execution as ExtendedPackageExecution;
    const runtimeConfig = normalizeConfigForLocalExecution(
      pipelineId,
      execution,
      config,
      executionSettings
    );
    const flags = buildPipelineFlags(execution, runtimeConfig);

    const weblogUrl = buildWeblogUrl(
      executionSettings.weblogUrl,
      runId,
      executionSettings.weblogSecret
    );

    // generateRunNumber reads the current max then increments, so two concurrent
    // prepares for the same pipeline/day can compute the same NNN. runNumber is
    // unique, so the loser's update throws P2002 — recompute and retry rather
    // than failing a perfectly valid run with an opaque error.
    const MAX_RUN_NUMBER_ATTEMPTS = 5;
    let runFolder = '';
    for (let attempt = 0; ; attempt++) {
      const runNumber = await generateRunNumber(pipelineId);
      runFolder = await prepareRunDirectory(
        runNumber,
        executionSettings.pipelineRunDir
      );

      // Write samplesheet
      const samplesheetPath = path.join(runFolder, 'samplesheet.csv');
      await fs.writeFile(samplesheetPath, samplesheet.content);

      // Output directory
      const outputDir = path.join(runFolder, 'output');
      await fs.mkdir(outputDir, { recursive: true });

      // Create run-specific Nextflow config (weblog, etc.)
      const runConfig = buildRunConfig(weblogUrl, executionSettings, pipelineId);
      const runConfigPath = runConfig ? path.join(runFolder, 'nextflow.config') : null;
      if (runConfig && runConfigPath) {
        await fs.writeFile(runConfigPath, runConfig);
      }

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
      try {
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
        break;
      } catch (error) {
        if (isRunNumberConflict(error) && attempt < MAX_RUN_NUMBER_ATTEMPTS - 1) {
          // Another run claimed this number first; drop the stale folder and
          // recompute on the next iteration.
          await fs.rm(runFolder, { recursive: true, force: true }).catch(() => {});
          continue;
        }
        throw error;
      }
    }

    return {
      success: true,
      runId,
      runFolder,
      errors,
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push(`Failed to prepare run: ${message}`);
    return { success: false, runId, errors, warnings };
  }
}
