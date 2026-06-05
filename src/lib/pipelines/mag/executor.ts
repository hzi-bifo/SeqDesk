// MAG Pipeline Executor
// Handles running nf-core/mag pipeline

import { db } from '@/lib/db';
import { notifyPipelineRunTerminalInApp } from '@/lib/notifications/in-app';
import { getAdapter } from '@/lib/pipelines/adapters';
// Import to trigger adapter registration
import '@/lib/pipelines/adapters/mag';
import { resolveOutputs, saveRunResults } from '@/lib/pipelines/output-resolver';
import path from 'path';
import fs from 'fs/promises';

interface MagConfig {
  stubMode?: boolean;
  skipMegahit?: boolean;
  skipSpades?: boolean;
  skipProkka?: boolean;
  skipBinQc?: boolean;
  skipConcoct?: boolean;
  skipGtdb?: boolean;
  skipGtdbtk?: boolean;
  skipQuast?: boolean;
  gtdbDb?: string;
}

interface ExecutionSettings {
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

interface StartRunOptions {
  runId: string;
  studyId: string;
  sampleIds?: string[];
  config: MagConfig;
  executionSettings: ExecutionSettings;
  userId: string;
}

/**
 * Generate run number in format MAG-YYYYMMDD-NNN
 */
export async function generateRunNumber(): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `MAG-${dateStr}-`;

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
 * Generate SLURM script for MAG pipeline
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

function escapeNextflowString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, ' ');
}

// Wrap a value as a single POSIX shell token. Safe values are emitted verbatim;
// anything else is single-quoted with embedded single quotes escaped via the
// standard '\'' dance. This prevents config values from becoming shell syntax
// when written into run.sh.
function shellQuote(value: string): string {
  if (value === '') return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
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

function buildRunConfig(
  weblogUrl: string | null,
  settings: ExecutionSettings
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
  // Force a compatible interpreter + setuptools for the CONCOCT subworkflow tasks.
  sections.push(
    [
      `process {`,
      `  withName: 'NFCORE_MAG:MAG:BINNING:FASTA_BINNING_CONCOCT:CONCOCT_.*' {`,
      `    conda = 'bioconda::concoct=1.1.0 conda-forge::python=3.10 conda-forge::setuptools'`,
      `  }`,
      `}`,
    ].join('\n')
  );

  if (sections.length === 0) return null;
  return `${sections.join('\n\n')}\n`;
}

function buildMagFlags(config: MagConfig): string[] {
  const flags: string[] = [];

  if (config.stubMode) flags.push('-stub');
  if (config.skipMegahit) flags.push('--skip_megahit');
  if (config.skipSpades) flags.push('--skip_spades');
  if (config.skipProkka) flags.push('--skip_prokka');
  if (config.skipConcoct) flags.push('--skip_concoct');

  if (config.skipBinQc) {
    flags.push(
      '--skip_binqc',
      '--skip_quast',
      '--skip_gtdbtk'
    );
  }

  const skipGtdbtk = config.skipGtdbtk ?? config.skipGtdb;
  if (!config.skipBinQc && config.skipQuast) flags.push('--skip_quast');
  if (!config.skipBinQc && skipGtdbtk) flags.push('--skip_gtdbtk');
  if (config.gtdbDb) flags.push(`--gtdb_db ${shellQuote(String(config.gtdbDb))}`);

  return flags;
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

function generateSlurmScript(
  runFolder: string,
  samplesheetPath: string,
  outputDir: string,
  config: MagConfig,
  settings: ExecutionSettings,
  runConfigPath: string | null,
  runNumber: string,
  runId: string
): string {
  const flags = buildMagFlags(config);

  const traceFile = `${runFolder}/trace.txt`;
  const dagFile = `${runFolder}/dag.dot`;
  const reportFile = `${runFolder}/report.html`;
  const timelineFile = `${runFolder}/timeline.html`;
  const runtimeBootstrap = buildRuntimeBootstrap(settings);

  const runName = buildNextflowRunName(runNumber, runId);
  const nameFlag = `-name ${runName}`;
  const profileFlag = settings.nextflowProfile ? `-profile ${settings.nextflowProfile}` : '';
  const configFlag = runConfigPath ? `-c ${runConfigPath}` : '';

  const nextflowArgs = [
    `--input ${samplesheetPath}`,
    `--outdir ${outputDir}`,
    `-with-trace ${traceFile}`,
    `-with-dag ${dagFile}`,
    `-with-report ${reportFile}`,
    `-with-timeline ${timelineFile}`,
    nameFlag,
    configFlag,
    profileFlag,
    ...flags,
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
# node-local /tmp and are copied back below. Create the logs dir on the compute
# node itself too: a just-created NFS subdir may not be visible to the node yet,
# and slurmd cannot create it under root-squash. The pipeline logs below are
# written by this script as the job user, which DOES work on NFS.
mkdir -p "${runFolder}/logs"

# Log file paths (read by pipeline monitor)
STDOUT_LOG="${runFolder}/logs/pipeline.out"
STDERR_LOG="${runFolder}/logs/pipeline.err"

# Always record the real exit code for the pipeline monitor, even when a
# command fails under "set -e" (which would otherwise abort before the marker
# below is reached). Also copy SLURM's node-local logs into the run dir.
trap 'EXIT_CODE=$?; echo "Pipeline completed with exit code: $EXIT_CODE at $(date)" >> "$STDOUT_LOG"; cp -f "/tmp/seqdesk-slurm-$SLURM_JOB_ID.out" "${runFolder}/logs/slurm-$SLURM_JOB_ID.out" 2>/dev/null || true; cp -f "/tmp/seqdesk-slurm-$SLURM_JOB_ID.err" "${runFolder}/logs/slurm-$SLURM_JOB_ID.err" 2>/dev/null || true; exit $EXIT_CODE' EXIT

echo "Starting nf-core/mag pipeline at $(date)" > "$STDOUT_LOG"
echo "" > "$STDERR_LOG"

${runtimeBootstrap}

# Run nf-core/mag (uses default/latest release)
"\${NEXTFLOW_RUNNER[@]}" run nf-core/mag \\
  ${nextflowArgs} \\
  >> "$STDOUT_LOG" 2>> "$STDERR_LOG"
`;
}

/**
 * Generate local execution script (for non-SLURM environments)
 */
function generateLocalScript(
  runFolder: string,
  samplesheetPath: string,
  outputDir: string,
  config: MagConfig,
  settings: ExecutionSettings,
  runConfigPath: string | null,
  runNumber: string,
  runId: string
): string {
  const flags = buildMagFlags(config);

  const traceFile = `${runFolder}/trace.txt`;
  const dagFile = `${runFolder}/dag.dot`;
  const reportFile = `${runFolder}/report.html`;
  const timelineFile = `${runFolder}/timeline.html`;
  const runtimeBootstrap = buildRuntimeBootstrap(settings);

  const runName = buildNextflowRunName(runNumber, runId);
  const nameFlag = `-name ${runName}`;
  const profileFlag = settings.nextflowProfile ? `-profile ${settings.nextflowProfile}` : '';
  const configFlag = runConfigPath ? `-c ${runConfigPath}` : '';

  const nextflowArgs = [
    `--input ${samplesheetPath}`,
    `--outdir ${outputDir}`,
    `-with-trace ${traceFile}`,
    `-with-dag ${dagFile}`,
    `-with-report ${reportFile}`,
    `-with-timeline ${timelineFile}`,
    nameFlag,
    configFlag,
    profileFlag,
    ...flags,
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

echo "Starting MAG pipeline at $(date)" > "$STDOUT_LOG"
echo "" > "$STDERR_LOG"

${runtimeBootstrap}

# Run nf-core/mag (uses default/latest release)
"\${NEXTFLOW_RUNNER[@]}" run nf-core/mag \\
  ${nextflowArgs} \\
  >> "$STDOUT_LOG" 2>> "$STDERR_LOG"
`;
}

/**
 * Start a MAG pipeline run
 *
 * This creates the run record, generates the samplesheet and scripts,
 * but does NOT actually execute the pipeline (that's handled by a background worker)
 */
export async function prepareMagRun(
  options: StartRunOptions
): Promise<{
  success: boolean;
  runId: string;
  runFolder?: string;
  errors: string[];
}> {
  const { runId, studyId, sampleIds, config, executionSettings, userId } = options;
  const errors: string[] = [];

  try {
    // Generate samplesheet using adapter
    const adapter = getAdapter('mag');
    if (!adapter) {
      errors.push('MAG adapter not registered');
      return { success: false, runId, errors };
    }

    const samplesheet = await adapter.generateSamplesheet({
      target: {
        type: 'study',
        studyId,
        sampleIds,
      },
      dataBasePath: executionSettings.dataBasePath,
    });

    if (samplesheet.errors.length > 0) {
      errors.push(...samplesheet.errors);
    }

    if (samplesheet.sampleCount === 0) {
      errors.push('No valid samples for samplesheet');
      return { success: false, runId, errors };
    }

    const weblogUrl = buildWeblogUrl(executionSettings.weblogUrl, runId, executionSettings.weblogSecret);

    // generateRunNumber reads the current max then increments, so two concurrent
    // prepares for the same day can compute the same NNN. runNumber is unique, so
    // the loser's update throws P2002 — recompute and retry rather than failing a
    // perfectly valid run with an opaque error.
    const MAX_RUN_NUMBER_ATTEMPTS = 5;
    let runFolder = '';
    for (let attempt = 0; ; attempt++) {
      const runNumber = await generateRunNumber();

      // Create run directory
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
      const runConfig = buildRunConfig(weblogUrl, executionSettings);
      const runConfigPath = runConfig ? path.join(runFolder, 'nextflow.config') : null;
      if (runConfig && runConfigPath) {
        await fs.writeFile(runConfigPath, runConfig);
      }

      // Generate execution script
      const script = executionSettings.useSlurm
        ? generateSlurmScript(runFolder, samplesheetPath, outputDir, config, executionSettings, runConfigPath, runNumber, runId)
        : generateLocalScript(runFolder, samplesheetPath, outputDir, config, executionSettings, runConfigPath, runNumber, runId);

      const scriptPath = path.join(runFolder, 'run.sh');
      await fs.writeFile(scriptPath, script);
      await fs.chmod(scriptPath, 0o755);

      // Update run record with folder and paths
      // Steps will be populated dynamically from the Nextflow trace file
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
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push(`Failed to prepare run: ${message}`);
    return { success: false, runId, errors };
  }
}

/**
 * Update run status from external execution
 * Called by background worker or webhook
 */
export async function updateRunStatus(
  runId: string,
  status: 'running' | 'completed' | 'failed',
  details?: {
    progress?: number;
    currentStep?: string;
    outputTail?: string;
    errorTail?: string;
  }
): Promise<void> {
  const existing = await db.pipelineRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  const updateData: Record<string, unknown> = { status };

  if (status === 'running' && !details?.progress) {
    updateData.startedAt = new Date();
  }

  if (status === 'completed' || status === 'failed') {
    updateData.completedAt = new Date();
  }

  if (details) {
    if (details.progress !== undefined) updateData.progress = details.progress;
    if (details.currentStep) updateData.currentStep = details.currentStep;
    if (details.outputTail) updateData.outputTail = details.outputTail;
    if (details.errorTail) updateData.errorTail = details.errorTail;
  }

  await db.pipelineRun.update({
    where: { id: runId },
    data: updateData,
  });
  await notifyPipelineRunTerminalInApp(runId, existing?.status, status);
}

/**
 * Process completed MAG run and create database records
 * Uses the adapter + output resolver pattern
 */
export async function processCompletedRun(runId: string): Promise<{
  success: boolean;
  assembliesCreated: number;
  binsCreated: number;
  errors: string[];
}> {
  const adapter = getAdapter('mag');
  if (!adapter) {
    return {
      success: false,
      assembliesCreated: 0,
      binsCreated: 0,
      errors: ['MAG adapter not registered'],
    };
  }

  const run = await db.pipelineRun.findUnique({
    where: { id: runId },
    include: {
      study: {
        include: {
          samples: {
            select: {
              id: true,
              sampleId: true,
            },
          },
        },
      },
    },
  });

  if (!run || !run.runFolder || !run.study) {
    return {
      success: false,
      assembliesCreated: 0,
      binsCreated: 0,
      errors: ['Run not found or missing data'],
    };
  }

  const outputDir = path.join(run.runFolder, 'output');

  // Discover outputs using adapter
  const discovered = await adapter.discoverOutputs({
    runId,
    outputDir,
    samples: run.study.samples,
  });

  // Resolve outputs to DB records
  const result = await resolveOutputs('mag', runId, discovered);

  // Save results summary to run
  await saveRunResults(runId, result);

  return {
    success: result.success,
    assembliesCreated: result.assembliesCreated,
    binsCreated: result.binsCreated,
    errors: result.errors,
  };
}
