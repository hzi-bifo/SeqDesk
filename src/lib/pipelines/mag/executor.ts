// MAG Pipeline Executor
// Handles running nf-core/mag pipeline

import { db } from '@/lib/db';
import { generateMagSamplesheet } from './samplesheet';
import { parseMagResults } from './results';
import path from 'path';
import fs from 'fs/promises';

interface MagConfig {
  stubMode?: boolean;
  skipMegahit?: boolean;
  skipSpades?: boolean;
  skipProkka?: boolean;
  skipBinQc?: boolean;
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
  runtimeMode?: 'local' | 'conda' | 'docker' | 'singularity' | 'apptainer';
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
    nextNum = lastNum + 1;
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

function buildRunConfig(weblogUrl: string | null): string | null {
  if (!weblogUrl) return null;
  return `weblog {\n  enabled = true\n  url = "${weblogUrl}"\n}\n`;
}

function buildMagFlags(config: MagConfig): string[] {
  const flags: string[] = [];

  if (config.stubMode) flags.push('-stub');
  if (config.skipMegahit) flags.push('--skip_megahit');
  if (config.skipSpades) flags.push('--skip_spades');
  if (config.skipProkka) flags.push('--skip_prokka');

  if (config.skipBinQc) {
    flags.push(
      '--skip_binqc',
      '--skip_quast',
      '--skip_gtdbtk',
      '--run_busco false',
      '--run_checkm false',
      '--run_checkm2 false',
      '--run_gunc false'
    );
  }

  const skipGtdbtk = config.skipGtdbtk ?? config.skipGtdb;
  if (!config.skipBinQc && config.skipQuast) flags.push('--skip_quast');
  if (!config.skipBinQc && skipGtdbtk) flags.push('--skip_gtdbtk');
  if (config.gtdbDb) flags.push(`--gtdb_db ${config.gtdbDb}`);

  return flags;
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
#SBATCH -p ${settings.slurmQueue || 'cpu'}
#SBATCH -c ${settings.slurmCores || 4}
#SBATCH --mem='${settings.slurmMemory || '64GB'}'
#SBATCH -t ${settings.slurmTimeLimit || 12}:0:0
#SBATCH -o ${runFolder}/logs/slurm-%j.out
#SBATCH -e ${runFolder}/logs/slurm-%j.err
${settings.slurmOptions ? `#SBATCH ${settings.slurmOptions}` : ''}

${condaActivation}

# Run nf-core/mag (uses default/latest release)
nextflow run nf-core/mag \\
  ${nextflowArgs}

# Capture exit code
EXIT_CODE=$?

echo "Pipeline completed with exit code: $EXIT_CODE"
exit $EXIT_CODE
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
set -e

# Log file paths
STDOUT_LOG="${runFolder}/logs/pipeline.out"
STDERR_LOG="${runFolder}/logs/pipeline.err"

echo "Starting MAG pipeline at $(date)" > "$STDOUT_LOG"
echo "" > "$STDERR_LOG"

${condaActivation}

# Run nf-core/mag (uses default/latest release)
nextflow run nf-core/mag \\
  ${nextflowArgs} \\
  >> "$STDOUT_LOG" 2>> "$STDERR_LOG"

EXIT_CODE=$?
echo "Pipeline completed with exit code: $EXIT_CODE at $(date)" >> "$STDOUT_LOG"
exit $EXIT_CODE
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
    // Generate run number
    const runNumber = await generateRunNumber();

    // Create run directory
    const runFolder = await prepareRunDirectory(
      runNumber,
      executionSettings.pipelineRunDir
    );

    // Generate samplesheet
    const samplesheet = await generateMagSamplesheet({
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
    const weblogUrl = buildWeblogUrl(executionSettings.weblogUrl, runId, executionSettings.weblogSecret);
    const runConfig = buildRunConfig(weblogUrl);
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
}

/**
 * Process completed MAG run and create database records
 */
export async function processCompletedRun(runId: string): Promise<{
  success: boolean;
  assembliesCreated: number;
  binsCreated: number;
  errors: string[];
}> {
  const run = await db.pipelineRun.findUnique({
    where: { id: runId },
    include: {
      study: {
        include: {
          samples: true,
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

  return parseMagResults({
    runId,
    outputDir,
    samples: run.study.samples,
  });
}
