import * as childProcess from 'child_process';
import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import { promisify } from 'util';

import { db } from '@/lib/db';
import { PIPELINE_REGISTRY } from '@/lib/pipelines';
import { findStepByProcess, getStepsForPipeline } from '@/lib/pipelines/definitions';
import { getPipelineEnabled } from '@/lib/pipelines/enablement';
import { getExecutionSettings } from '@/lib/pipelines/execution-settings';
import { notifyPipelineRunTerminalInApp } from '@/lib/notifications/in-app';
import { getAllPackages } from '@/lib/pipelines/package-loader';
import { inferPipelineExitCode, processCompletedPipelineRun } from '@/lib/pipelines/run-completion';
import { findTraceFile, parseTraceFile } from '@/lib/pipelines/nextflow';
import { getPipelineRunTargetKey } from '@/lib/pipelines/result-files';

const spawn = childProcess.spawn;
const unavailableExecFile = (((
  _file: string,
  _args: readonly string[],
  callback: (error: Error) => void
) => callback(new Error('execFile is unavailable'))) as unknown) as typeof childProcess.execFile;
const execFileAsync = promisify(childProcess.execFile || unavailableExecFile);

const MAX_COMMAND_OUTPUT = 16_000;
const MAX_FILE_OUTPUT = 16_000;
const MAX_TAIL_BYTES = 256 * 1024;
const MAX_TAIL_LINES = 150;

type QueueSource = 'local' | 'squeue' | 'sacct' | null;

type QueueSnapshot = {
  state: string | null;
  reason: string | null;
  source: QueueSource;
};

type CommandResult = {
  command: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
};

type DebugFileInfo = {
  path: string;
  exists: boolean;
  size?: number;
  updatedAt?: string;
  tail?: string | null;
};

export type DebugBundle = {
  generatedAt: string;
  run: {
    id: string;
    runNumber: string;
    pipelineId: string;
    status: string;
    statusSource: string | null;
    currentStep: string | null;
    progress: number | null;
    queueJobId: string | null;
    queueStatus: string | null;
    queueReason: string | null;
    createdAt: Date;
    queuedAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    lastEventAt: Date | null;
    runFolder: string | null;
    outputPath: string | null;
    errorPath: string | null;
    outputTail: string | null;
    errorTail: string | null;
    config: Record<string, unknown> | null;
  };
  target: {
    type: 'study' | 'order';
    id: string;
    title: string;
    orderNumber?: string | null;
    selectedSamples: Array<{
      id: string;
      sampleId: string;
      readCount: number;
      reads: Array<{
        id: string;
        file1: string | null;
        file2: string | null;
        checksum1: string | null;
        checksum2: string | null;
      }>;
    }>;
    selectedSampleCount: number;
  } | null;
  study: {
    id: string;
    title: string;
    selectedSamples: Array<{
      id: string;
      sampleId: string;
      readCount: number;
      reads: Array<{
        id: string;
        file1: string | null;
        file2: string | null;
        checksum1: string | null;
        checksum2: string | null;
      }>;
    }>;
    selectedSampleCount: number;
  } | null;
  executionSettings: {
    useSlurm: boolean;
    slurmQueue: string;
    slurmCores: number;
    slurmMemory: string;
    slurmTimeLimit: number;
    slurmOptions: string;
    runtimeMode: 'conda';
    condaPath: string;
    condaEnv: string;
    nextflowProfile: string;
    pipelineRunDir: string;
    weblogUrl: string;
    weblogSecretConfigured: boolean;
    condaScriptPath: string | null;
    condaScriptExists: boolean | null;
  };
  hostDiagnostics: {
    commandChecks: CommandResult[];
    condaChecks: CommandResult[];
    queueChecks: CommandResult[];
  };
  files: DebugFileInfo[];
  collectionCommand: string;
  notes: string[];
};

export type PipelineOpsResponse<TBody = Record<string, unknown>> = {
  status: number;
  body: TBody;
};

function isMeaningfulActiveStepLabel(value: string | null | undefined): value is string {
  const trimmed = value?.trim();
  if (!trimmed) return false;

  const normalized = trimmed.toLowerCase();
  return ![
    '-',
    'queued',
    'processing...',
    'waiting for scheduler',
    'running on compute node',
    'finalizing...',
    'finalizing outputs...',
    'completed',
    'failed',
    'cancelled',
    'canceled',
  ].includes(normalized);
}

function jsonResponse<TBody extends Record<string, unknown>>(
  body: TBody,
  status = 200
): PipelineOpsResponse<TBody> {
  return { status, body };
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parseSampleIds(value: string | null): string[] | null {
  const parsed = parseJson<unknown>(value);
  if (!Array.isArray(parsed)) return null;
  if (parsed.some((id) => typeof id !== 'string')) return null;
  return parsed as string[];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getFileSize(filePath: string | null | undefined): Promise<number | null> {
  if (!filePath) return null;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    return stat.size;
  } catch {
    return null;
  }
}

function inferRunOutputType(filePath: string): 'report' | 'qc' | 'dag' | 'log' | 'data' {
  const lower = filePath.toLowerCase();
  const baseName = path.basename(lower);
  if (baseName === 'dag.dot' || lower.endsWith('.dot')) return 'dag';
  if (lower.endsWith('.html') || lower.endsWith('.pdf')) return 'report';
  if (lower.includes('/qc/') || lower.includes('/quality/')) return 'qc';
  if (
    lower.endsWith('.log') ||
    lower.endsWith('.out') ||
    lower.endsWith('.err') ||
    baseName === 'trace.txt'
  ) {
    return 'log';
  }
  return 'data';
}

async function scanRunOutputFiles(
  runFolder: string | null,
  options: { maxFiles?: number; maxDepth?: number } = {}
): Promise<Array<{
  id: string;
  name: string;
  path: string;
  type: 'report' | 'qc' | 'dag' | 'log' | 'data';
  size?: number;
}>> {
  if (!runFolder) return [];

  const outputDir = path.join(runFolder, 'output');
  const maxFiles = options.maxFiles ?? 1000;
  const maxDepth = options.maxDepth ?? 10;
  const files: Array<{
    id: string;
    name: string;
    path: string;
    type: 'report' | 'qc' | 'dag' | 'log' | 'data';
    size?: number;
  }> = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (files.length >= maxFiles || depth > maxDepth) return;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      if (entry.name.startsWith('.')) continue;

      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;

      const relativePath = path.relative(outputDir, absolutePath);
      const size = await getFileSize(absolutePath);
      files.push({
        id: `output:${relativePath}`,
        name: entry.name,
        path: absolutePath,
        type: inferRunOutputType(absolutePath),
        size: size ?? undefined,
      });
    }
  }

  await walk(outputDir, 0);
  return files;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

async function extractPipelineCommand(scriptPath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(scriptPath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const startIndex = lines.findIndex((line) => {
      const trimmed = line.trim();
      return (
        trimmed.startsWith('"${NEXTFLOW_RUNNER[@]}" run ') ||
        trimmed.startsWith('"$SUBMG_BIN" submit ')
      );
    });

    if (startIndex < 0) return null;

    const commandLines: string[] = [];
    for (let idx = startIndex; idx < lines.length; idx += 1) {
      const trimmed = lines[idx].trim();
      if (!trimmed) {
        if (commandLines.length > 0) break;
        continue;
      }
      commandLines.push(trimmed);
      if (!trimmed.endsWith('\\')) break;
    }

    if (commandLines.length === 0) return null;

    return commandLines
      .map((line) => line.replace(/\\\s*$/, '').trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return null;
  }
}

async function buildExecutionCommands(
  runFolder: string | null,
  queueJobId: string | null
): Promise<{
  scriptPath: string | null;
  launchCommand: string | null;
  scriptCommand: string | null;
  pipelineCommand: string | null;
}> {
  if (!runFolder) {
    return {
      scriptPath: null,
      launchCommand: null,
      scriptCommand: null,
      pipelineCommand: null,
    };
  }

  const scriptPath = path.join(runFolder, 'run.sh');
  const scriptExists = await fileExists(scriptPath);
  const isLocalRun = Boolean(queueJobId?.startsWith('local-'));
  const launchCommand = isLocalRun
    ? `cd ${shellQuote(runFolder)} && bash ${shellQuote(scriptPath)}`
    : `cd ${shellQuote(runFolder)} && sbatch --parsable ${shellQuote(scriptPath)}`;

  return {
    scriptPath,
    launchCommand,
    scriptCommand: `bash ${shellQuote(scriptPath)}`,
    pipelineCommand: scriptExists ? await extractPipelineCommand(scriptPath) : null,
  };
}

function normalizeQueueState(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return normalized || null;
}

function isTerminalQueueState(value: string | null | undefined): boolean {
  const normalized = normalizeQueueState(value);
  if (!normalized) return false;
  if (normalized === 'UNKNOWN') return false;

  if (
    normalized === 'COMPLETED' ||
    normalized === 'EXITED' ||
    normalized === 'REVOKED' ||
    normalized === 'TIMEOUT' ||
    normalized === 'OUT_OF_MEMORY' ||
    normalized === 'NODE_FAIL' ||
    normalized === 'BOOT_FAIL' ||
    normalized === 'PREEMPTED' ||
    normalized === 'DEADLINE'
  ) {
    return true;
  }

  return (
    normalized.startsWith('CANCELLED') ||
    normalized.startsWith('CANCELED') ||
    normalized.startsWith('FAILED')
  );
}

function isActiveQueueState(value: string | null | undefined): boolean {
  const normalized = normalizeQueueState(value);
  if (!normalized || normalized === 'UNKNOWN') return false;
  return !isTerminalQueueState(normalized);
}

function isCancelledQueueState(value: string | null | undefined): boolean {
  const normalized = normalizeQueueState(value);
  if (!normalized) return false;
  return (
    normalized.startsWith('CANCELLED') ||
    normalized.startsWith('CANCELED') ||
    normalized === 'REVOKED'
  );
}

function isFailedQueueState(value: string | null | undefined): boolean {
  const normalized = normalizeQueueState(value);
  if (!normalized) return false;
  return (
    normalized.startsWith('FAILED') ||
    normalized === 'TIMEOUT' ||
    normalized === 'OUT_OF_MEMORY' ||
    normalized === 'NODE_FAIL' ||
    normalized === 'BOOT_FAIL' ||
    normalized === 'PREEMPTED' ||
    normalized === 'DEADLINE'
  );
}

function firstNonEmptyLine(value: string): string {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0] || '';
}

async function readQueueSnapshot(
  jobId: string | null | undefined,
  runFolder?: string | null
): Promise<QueueSnapshot> {
  const normalizedJobId = (jobId || '').trim();
  if (!normalizedJobId) {
    return { state: null, reason: null, source: null };
  }

  if (normalizedJobId.startsWith('local-')) {
    // The exit marker wins over PID liveness: once the pipeline has written a
    // terminal exit code the run is finished, even if `ps` still reports the PID.
    // The OS can recycle a finished pipeline's PID to an unrelated live process,
    // which would otherwise be read as RUNNING and pin a completed run.
    if (runFolder) {
      const exitCode = await inferPipelineExitCode(runFolder);
      if (exitCode !== null) {
        return { state: 'EXITED', reason: null, source: 'local' };
      }
    }
    const pid = Number(normalizedJobId.replace('local-', ''));
    if (!Number.isInteger(pid) || pid <= 0) {
      return { state: null, reason: null, source: 'local' };
    }
    try {
      await execFileAsync('ps', ['-p', String(pid), '-o', 'pid='], { timeout: 5000 });
      return { state: 'RUNNING', reason: null, source: 'local' };
    } catch {
      return { state: 'EXITED', reason: null, source: 'local' };
    }
  }

  if (!/^\d+$/.test(normalizedJobId)) {
    return { state: null, reason: null, source: null };
  }

  try {
    const { stdout } = await execFileAsync(
      'squeue',
      ['-j', normalizedJobId, '-h', '-o', '%T|%R'],
      { timeout: 5000 }
    );
    const line = firstNonEmptyLine(stdout);
    if (line) {
      const [state, reason] = line.split('|');
      return {
        state: state?.trim() || 'UNKNOWN',
        reason: reason?.trim() || null,
        source: 'squeue',
      };
    }
  } catch {
    // Ignore and try sacct.
  }

  try {
    const { stdout } = await execFileAsync(
      'sacct',
      ['-X', '-P', '-j', normalizedJobId, '--format=JobID,State,Reason', '--noheader'],
      { timeout: 5000 }
    );
    const rows = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [rowJobId, rowState, rowReason] = line.split('|');
        return {
          jobId: rowJobId?.trim() || '',
          state: rowState?.trim() || '',
          reason: rowReason?.trim() || null,
        };
      });

    const primary =
      rows.find((row) => row.jobId === normalizedJobId) ||
      rows.find((row) => row.jobId.startsWith(`${normalizedJobId}.`)) ||
      rows[0];

    if (primary) {
      return {
        state: primary.state || 'UNKNOWN',
        reason: primary.reason,
        source: 'sacct',
      };
    }
  } catch {
    // Ignore and fall through.
  }

  return { state: null, reason: null, source: null };
}

async function countMaterializedOutputs(runId: string): Promise<number> {
  const [assemblies, bins, artifacts] = await Promise.all([
    db.assembly.count({ where: { createdByPipelineRunId: runId } }),
    db.bin.count({ where: { createdByPipelineRunId: runId } }),
    db.pipelineArtifact.count({ where: { pipelineRunId: runId } }),
  ]);
  return assemblies + bins + artifacts;
}

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const hidden = value.length - maxChars;
  return `${value.slice(0, maxChars)}\n...[truncated ${hidden} chars]`;
}

async function readTail(filePath: string, size: number): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - size);
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer;
  } finally {
    await handle.close();
  }
}

async function readTailLines(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    const bytes = Math.min(MAX_TAIL_BYTES, stat.size);
    const buffer = await readTail(filePath, bytes);
    const lines = buffer
      .toString('utf-8')
      .split(/\r?\n/)
      .slice(-MAX_TAIL_LINES)
      .join('\n');
    return clip(lines, MAX_FILE_OUTPUT);
  } catch {
    return null;
  }
}

async function inspectFile(filePath: string): Promise<DebugFileInfo> {
  try {
    const stat = await fs.stat(filePath);
    const isTextLike = /\.(out|err|log|txt|sh|csv|yaml|yml|json|config|dot)$/i.test(
      filePath
    );
    return {
      path: filePath,
      exists: true,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      tail: isTextLike ? await readTailLines(filePath) : null,
    };
  } catch {
    return {
      path: filePath,
      exists: false,
    };
  }
}

async function runShell(command: string, timeoutMs = 8_000): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    return {
      command,
      ok: true,
      stdout: clip((stdout || '').trim(), MAX_COMMAND_OUTPUT),
      stderr: clip((stderr || '').trim(), MAX_COMMAND_OUTPUT),
    };
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    return {
      command,
      ok: false,
      stdout: clip((err.stdout || '').trim(), MAX_COMMAND_OUTPUT),
      stderr: clip((err.stderr || '').trim(), MAX_COMMAND_OUTPUT),
      error: err.message,
    };
  }
}

function valueOrDash(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function section(title: string): string {
  return `\n=== ${title} ===\n`;
}

function formatCommandResult(result: CommandResult): string {
  return [
    `Command: ${result.command}`,
    `OK: ${result.ok ? 'yes' : 'no'}`,
    result.error ? `Error: ${result.error}` : null,
    result.stdout ? `STDOUT:\n${result.stdout}` : 'STDOUT: (empty)',
    result.stderr ? `STDERR:\n${result.stderr}` : 'STDERR: (empty)',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function resolvePipelineOperator(userEmail?: string): Promise<PipelineOpsResponse> {
  const where = userEmail
    ? { email: userEmail, role: 'FACILITY_ADMIN' }
    : { role: 'FACILITY_ADMIN' };
  const user = await db.user.findFirst({
    where,
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, firstName: true, lastName: true, role: true },
  });

  if (!user) {
    return jsonResponse(
      userEmail
        ? { error: `No FACILITY_ADMIN user found for ${userEmail}` }
        : { error: 'No FACILITY_ADMIN user exists. Create an admin before running pipelines from the CLI.' },
      400
    );
  }

  return jsonResponse({ user });
}

export async function listPipelineCatalogForOperator(args: {
  catalog?: 'study' | 'order' | 'all';
  enabledOnly?: boolean;
}): Promise<PipelineOpsResponse> {
  const catalog = args.catalog || 'all';
  const packages = new Map(getAllPackages().map((pkg) => [pkg.id, pkg]));
  const items = await Promise.all(
    Object.values(PIPELINE_REGISTRY).map(async (definition) => {
      const enabled = await getPipelineEnabled(definition.id);
      const scopes = definition.input.supportedScopes;
      const supportsStudy = scopes.includes('study') || scopes.includes('sample') || scopes.includes('samples');
      const supportsOrder = scopes.includes('order');
      const pkg = packages.get(definition.id);
      return {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        enabled,
        scopes,
        catalog: {
          study: supportsStudy,
          order: supportsOrder,
        },
        packageVersion: pkg?.manifest.package.version ?? null,
        packageSource: pkg?.basePath ?? null,
      };
    })
  );

  const filtered = items.filter((item) => {
    if (args.enabledOnly && !item.enabled) return false;
    if (catalog === 'study') return item.catalog.study;
    if (catalog === 'order') return item.catalog.order;
    return true;
  });

  return jsonResponse({ pipelines: filtered });
}

export async function getPipelineRunDetailsForOperator(runId: string): Promise<PipelineOpsResponse> {
  const run = await db.pipelineRun.findUnique({
    where: { id: runId },
    include: {
      study: {
        select: {
          id: true,
          title: true,
          userId: true,
          samples: {
            select: {
              id: true,
              sampleId: true,
              reads: {
                where: { isActive: true },
                orderBy: [{ dataClass: 'asc' }, { id: 'asc' }],
                select: {
                  id: true,
                  file1: true,
                  file2: true,
                  checksum1: true,
                  checksum2: true,
                  dataClass: true,
                  isActive: true,
                },
              },
            },
          },
        },
      },
      order: {
        select: {
          id: true,
          name: true,
          orderNumber: true,
          userId: true,
          samples: {
            select: {
              id: true,
              sampleId: true,
              reads: {
                where: { isActive: true },
                orderBy: [{ dataClass: 'asc' }, { id: 'asc' }],
                select: {
                  id: true,
                  file1: true,
                  file2: true,
                  checksum1: true,
                  checksum2: true,
                  dataClass: true,
                  isActive: true,
                },
              },
            },
          },
        },
      },
      user: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      steps: {
        orderBy: { stepId: 'asc' },
      },
      assembliesCreated: {
        select: {
          id: true,
          assemblyName: true,
          assemblyFile: true,
          sample: { select: { sampleId: true } },
        },
      },
      binsCreated: {
        select: {
          id: true,
          binName: true,
          binAccession: true,
          binFile: true,
          completeness: true,
          contamination: true,
          sample: { select: { sampleId: true } },
        },
      },
      artifacts: {
        select: {
          id: true,
          type: true,
          name: true,
          path: true,
          sampleId: true,
          size: true,
          outputId: true,
          checksum: true,
          producedByStepId: true,
          metadata: true,
        },
      },
      events: {
        orderBy: { occurredAt: 'desc' },
        take: 100,
        select: {
          id: true,
          eventType: true,
          processName: true,
          stepId: true,
          status: true,
          message: true,
          source: true,
          occurredAt: true,
        },
      },
    },
  });

  if (!run) {
    return jsonResponse({ error: 'Run not found' }, 404);
  }

  const selectedSampleIds = parseSampleIds(run.inputSampleIds);
  const selectedSampleIdSet = selectedSampleIds ? new Set(selectedSampleIds) : null;
  const definition = PIPELINE_REGISTRY[run.pipelineId];
  const targetKey = getPipelineRunTargetKey(run);
  const selection = targetKey
    ? await db.pipelineResultSelection.findUnique({
        where: {
          pipelineId_targetKey: {
            pipelineId: run.pipelineId,
            targetKey,
          },
        },
        include: {
          selectedBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      })
    : null;
  const isSelectedFinal = selection?.selectedRunId === run.id;
  const inputFiles: {
    id: string;
    name: string;
    path: string;
    type: 'read_1' | 'read_2' | 'samplesheet';
    sampleId?: string;
    checksum?: string;
    size?: number;
    dataClass?: string;
  }[] = [];
  const targetSamples = run.targetType === 'order' ? run.order?.samples || [] : run.study?.samples || [];

  for (const sample of targetSamples) {
    if (selectedSampleIdSet && !selectedSampleIdSet.has(sample.id)) {
      continue;
    }
    for (const read of sample.reads ?? []) {
      if (read.file1) {
        inputFiles.push({
          id: `${read.id}_r1`,
          name: read.file1.split('/').pop() || read.file1,
          path: read.file1,
          type: 'read_1',
          sampleId: sample.sampleId,
          checksum: read.checksum1 || undefined,
          dataClass: read.dataClass,
        });
      }
      if (read.file2) {
        inputFiles.push({
          id: `${read.id}_r2`,
          name: read.file2.split('/').pop() || read.file2,
          path: read.file2,
          type: 'read_2',
          sampleId: sample.sampleId,
          checksum: read.checksum2 || undefined,
          dataClass: read.dataClass,
        });
      }
    }
  }

  if (run.runFolder) {
    inputFiles.push({
      id: 'samplesheet',
      name: 'samplesheet.csv',
      path: `${run.runFolder}/samplesheet.csv`,
      type: 'samplesheet',
    });
  }

  const detectedLogFiles: {
    id: string;
    name: string;
    path: string;
    type: 'log';
    size?: number;
  }[] = [];
  const runOutputFiles = await scanRunOutputFiles(run.runFolder);

  if (run.runFolder && run.queueJobId && /^\d+$/.test(run.queueJobId)) {
    const outPath = path.join(run.runFolder, 'logs', `slurm-${run.queueJobId}.out`);
    const errPath = path.join(run.runFolder, 'logs', `slurm-${run.queueJobId}.err`);
    if (await fileExists(outPath)) {
      detectedLogFiles.push({
        id: `slurm:${run.queueJobId}:out`,
        name: `slurm-${run.queueJobId}.out`,
        path: outPath,
        type: 'log',
      });
    }
    if (errPath !== outPath && (await fileExists(errPath))) {
      detectedLogFiles.push({
        id: `slurm:${run.queueJobId}:err`,
        name: `slurm-${run.queueJobId}.err`,
        path: errPath,
        type: 'log',
      });
    }
  }

  const executionCommands = await buildExecutionCommands(run.runFolder, run.queueJobId);
  const sizeProbePaths = new Set<string>();

  for (const file of inputFiles) sizeProbePaths.add(file.path);
  for (const file of detectedLogFiles) sizeProbePaths.add(file.path);
  for (const file of runOutputFiles) sizeProbePaths.add(file.path);
  for (const artifact of run.artifacts) sizeProbePaths.add(artifact.path);
  for (const assembly of run.assembliesCreated) {
    if (assembly.assemblyFile) sizeProbePaths.add(assembly.assemblyFile);
  }
  for (const bin of run.binsCreated) {
    if (bin.binFile) sizeProbePaths.add(bin.binFile);
  }
  if (run.outputPath) sizeProbePaths.add(run.outputPath);
  if (run.errorPath) sizeProbePaths.add(run.errorPath);
  if (run.runFolder) {
    sizeProbePaths.add(path.join(run.runFolder, 'trace.txt'));
    sizeProbePaths.add(path.join(run.runFolder, 'report.html'));
    sizeProbePaths.add(path.join(run.runFolder, 'timeline.html'));
    sizeProbePaths.add(path.join(run.runFolder, 'dag.dot'));
  }

  const sizePairs = await Promise.all(
    Array.from(sizeProbePaths).map(async (filePath) => [
      filePath,
      await getFileSize(filePath),
    ] as const)
  );

  const fileSizeByPath: Record<string, number> = {};
  for (const [filePath, size] of sizePairs) {
    if (size != null) {
      fileSizeByPath[filePath] = size;
    }
  }

  const serializedArtifacts = run.artifacts.map((a) => ({
    ...a,
    size: a.size != null ? Number(a.size) : fileSizeByPath[a.path] ?? null,
  }));

  return jsonResponse({
    run: {
      ...run,
      pipelineName: definition?.name || run.pipelineId,
      pipelineIcon: definition?.icon || 'CircleDot',
      pipelineDescription: definition?.description,
      isSelectedFinal,
      isUserVisible: isSelectedFinal,
      selectedFinal: selection
        ? {
            selectedRunId: selection.selectedRunId,
            selectedAt: selection.selectedAt,
            selectedBy: selection.selectedBy,
          }
        : null,
      config: parseJson<Record<string, unknown>>(run.config),
      results: parseJson<Record<string, unknown>>(run.results),
      inputSampleIds: selectedSampleIds,
      inputFiles: inputFiles.map((file) => ({ ...file, size: fileSizeByPath[file.path] })),
      runOutputFiles,
      detectedLogFiles: detectedLogFiles.map((file) => ({
        ...file,
        size: fileSizeByPath[file.path],
      })),
      fileSizeByPath,
      outputPathSize: run.outputPath ? fileSizeByPath[run.outputPath] ?? null : null,
      errorPathSize: run.errorPath ? fileSizeByPath[run.errorPath] ?? null : null,
      artifacts: serializedArtifacts,
      executionCommands,
    },
  });
}

export async function getPipelineRunOutputsForOperator(runId: string): Promise<PipelineOpsResponse> {
  const details = await getPipelineRunDetailsForOperator(runId);
  if (details.status !== 200) return details;
  const run = (details.body as { run: Record<string, unknown> }).run;
  return jsonResponse({
    runId,
    artifacts: run.artifacts,
    assembliesCreated: run.assembliesCreated,
    binsCreated: run.binsCreated,
    runOutputFiles: run.runOutputFiles,
  });
}

export async function getPipelineRunLogsForOperator(
  runId: string,
  args: { type?: string; tail?: number } = {}
): Promise<PipelineOpsResponse> {
  const logType = args.type || 'output';
  const tailLines = Number.isFinite(args.tail) ? Number(args.tail) : 100;
  const run = await db.pipelineRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      runFolder: true,
      outputPath: true,
      errorPath: true,
      outputTail: true,
      errorTail: true,
      status: true,
      progress: true,
      currentStep: true,
    },
  });

  if (!run) {
    return jsonResponse({ error: 'Run not found' }, 404);
  }

  let content = '';
  let fromFile = false;
  const logPath = logType === 'error' ? run.errorPath : run.outputPath;
  const cachedTail = logType === 'error' ? run.errorTail : run.outputTail;

  if (logPath && run.runFolder) {
    try {
      const fullPath = path.isAbsolute(logPath) ? logPath : path.join(run.runFolder, logPath);
      const fileContent = await fs.readFile(fullPath, 'utf-8');
      const lines = fileContent.split('\n');
      const startIndex = Math.max(0, lines.length - tailLines);
      content = lines.slice(startIndex).join('\n');
      fromFile = true;
    } catch {
      content = cachedTail || '';
    }
  } else {
    content = cachedTail || '';
  }

  let steps: { process: string; status: string; tasks: number }[] = [];
  let traceProgress: number | null = null;

  if (run.status === 'running' && run.runFolder) {
    try {
      const tracePath = await findTraceFile(run.runFolder);
      if (tracePath) {
        const traceResult = await parseTraceFile(tracePath);
        traceProgress = traceResult.overallProgress;
        steps = Array.from(traceResult.processes.values()).map((p) => ({
          process: p.name,
          status: p.status,
          tasks: p.totalTasks,
        }));
      }
    } catch {
      // Trace parsing failure should not block log output.
    }
  }

  return jsonResponse({
    content,
    fromFile,
    status: run.status,
    progress: traceProgress ?? run.progress,
    currentStep: run.currentStep,
    steps,
  });
}

export async function syncPipelineRunForOperator(runId: string): Promise<PipelineOpsResponse> {
  const run = await db.pipelineRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      runFolder: true,
      status: true,
      pipelineId: true,
      currentStep: true,
      startedAt: true,
      completedAt: true,
      lastEventAt: true,
      lastTraceAt: true,
      queueJobId: true,
    },
  });

  if (!run) {
    return jsonResponse({ error: 'Run not found' }, 404);
  }

  if (!run.runFolder) {
    return jsonResponse({ error: 'Run folder not set' }, 400);
  }

  const tracePath = await findTraceFile(run.runFolder);

  if (!tracePath) {
    const now = new Date();
    const updateData: Record<string, unknown> = {};
    const queueSnapshot = await readQueueSnapshot(run.queueJobId, run.runFolder);
    const queueState = queueSnapshot.state;
    const queueReason = queueSnapshot.reason;
    const queueSource = queueSnapshot.source;

    if (queueState) {
      updateData.queueStatus = queueState;
      updateData.queueReason = queueReason || undefined;
      updateData.queueUpdatedAt = now;
    }

    const normalizedQueueState = normalizeQueueState(queueState);
    const isCompletedQueueState = normalizedQueueState === 'COMPLETED';
    const isExitedLocalState = normalizedQueueState === 'EXITED';
    const queueCancelled = isCancelledQueueState(normalizedQueueState);
    const queueFailed = isFailedQueueState(normalizedQueueState);
    const nextActiveStatus =
      normalizedQueueState === 'PENDING' || normalizedQueueState === 'CONFIGURING'
        ? 'queued'
        : isActiveQueueState(normalizedQueueState)
          ? 'running'
          : null;

    if (nextActiveStatus && (run.status === 'pending' || run.status === 'queued')) {
      updateData.status = nextActiveStatus;
      updateData.currentStep =
        nextActiveStatus === 'queued' ? 'Waiting for scheduler' : 'Running on compute node';
      if (nextActiveStatus === 'running') {
        updateData.startedAt = run.startedAt || now;
      }
      updateData.lastEventAt = now;
      updateData.statusSource = 'queue';
    }

    const inTerminalCandidateState = ['pending', 'queued', 'running'].includes(run.status);
    const shouldFinalize =
      inTerminalCandidateState &&
      (isCompletedQueueState || isExitedLocalState || queueCancelled || queueFailed);
    let resolvedOutputsInThisSync = false;

    if (shouldFinalize) {
      let inferredExitCode: number | null = null;
      if (isCompletedQueueState || isExitedLocalState) {
        inferredExitCode = await inferPipelineExitCode(run.runFolder);
      }

      const consideredSuccessful =
        isCompletedQueueState || (isExitedLocalState && inferredExitCode === 0);
      if (consideredSuccessful) {
        let outputsReady = true;
        if (run.pipelineId === 'mag') {
          try {
            await processCompletedPipelineRun(runId, run.pipelineId);
            resolvedOutputsInThisSync = true;
            outputsReady = (await countMaterializedOutputs(runId)) > 0;
          } catch (processError) {
            console.error('[Sync Pipeline Run Service] Post-completion processing failed:', processError);
            outputsReady = false;
          }
        }

        if (!outputsReady) {
          updateData.status = 'running';
          updateData.progress = 99;
          updateData.currentStep = 'Finalizing outputs...';
          updateData.completedAt = null;
          updateData.statusSource = 'queue';
          updateData.lastEventAt = now;
          updateData.queueStatus = queueState || 'COMPLETED';
        } else {
          updateData.status = 'completed';
          updateData.progress = 100;
          updateData.currentStep = 'Completed';
          updateData.completedAt = now;
          updateData.statusSource = 'queue';
          updateData.lastEventAt = now;
          updateData.queueStatus = queueState || 'COMPLETED';
        }
      } else if (queueCancelled) {
        updateData.status = 'cancelled';
        updateData.currentStep = 'Cancelled';
        updateData.completedAt = now;
        updateData.statusSource = 'queue';
        updateData.lastEventAt = now;
      } else {
        updateData.status = 'failed';
        updateData.currentStep = 'Failed';
        updateData.completedAt = now;
        updateData.statusSource = 'queue';
        updateData.lastEventAt = now;
      }
    }

    const nextStatus =
      typeof updateData.status === 'string' ? (updateData.status as string) : run.status;

    if (Object.keys(updateData).length > 0) {
      await db.pipelineRun.update({ where: { id: runId }, data: updateData });
    }
    await notifyPipelineRunTerminalInApp(runId, run.status, nextStatus);

    if (nextStatus === 'completed' && run.status !== 'completed' && !resolvedOutputsInThisSync) {
      try {
        await processCompletedPipelineRun(runId, run.pipelineId);
      } catch (processError) {
        console.error('[Sync Pipeline Run Service] Post-completion processing failed:', processError);
      }
    }

    return jsonResponse({
      success: true,
      message: 'No trace file found yet',
      synced: false,
      status: nextStatus,
      queueStatus: queueState,
      queueSource,
    });
  }

  const traceResult = await parseTraceFile(tracePath);
  const stepSignals = new Map<string, {
    stepName: string;
    hasFailure: boolean;
    hasRunning: boolean;
    hasCompletion: boolean;
    startedAt?: Date;
    completedAt?: Date;
  }>();

  const normalizeStatus = (value?: string) => (value ? value.toLowerCase() : '');
  const hasNonZeroExit = (exitCode: unknown): boolean =>
    typeof exitCode === 'number' && Number.isFinite(exitCode) && exitCode !== 0;

  for (const task of traceResult.tasks) {
    const stepDef = findStepByProcess(run.pipelineId, task.process);
    const stepId = stepDef?.id || task.process;
    const stepName = stepDef?.name || task.process;

    if (!stepSignals.has(stepId)) {
      stepSignals.set(stepId, {
        stepName,
        hasFailure: false,
        hasRunning: false,
        hasCompletion: false,
      });
    }

    const entry = stepSignals.get(stepId)!;
    const status = normalizeStatus(task.status);

    if (status.includes('fail') || hasNonZeroExit(task.exit)) {
      entry.hasFailure = true;
    } else if (status.includes('run') || status.includes('start') || status.includes('submit')) {
      entry.hasRunning = true;
    } else if (
      status.includes('complete') ||
      status.includes('done') ||
      status.includes('success') ||
      status.includes('cache')
    ) {
      entry.hasCompletion = true;
    }

    const startedAt = task.start || task.submit;
    if (startedAt && (!entry.startedAt || startedAt < entry.startedAt)) {
      entry.startedAt = startedAt;
    }

    if (task.complete && (!entry.completedAt || task.complete > entry.completedAt)) {
      entry.completedAt = task.complete;
    }
  }

  const steps = new Map<string, {
    stepName: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    startedAt?: Date;
    completedAt?: Date;
  }>();

  for (const [stepId, entry] of stepSignals) {
    const status: 'pending' | 'running' | 'completed' | 'failed' =
      entry.hasFailure
        ? 'failed'
        : entry.hasRunning
          ? 'running'
          : entry.hasCompletion
            ? 'completed'
            : 'pending';

    steps.set(stepId, {
      stepName: entry.stepName,
      status,
      startedAt: entry.startedAt,
      completedAt: entry.completedAt,
    });
  }

  const latestEventAt = traceResult.tasks
    .flatMap((task) => [task.submit, task.start, task.complete].filter((t): t is Date => !!t))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const hasFailures = traceResult.tasks.some((task) => {
    const status = normalizeStatus(task.status);
    return (
      status.includes('fail') ||
      status.includes('error') ||
      status.includes('aborted') ||
      hasNonZeroExit(task.exit)
    );
  });
  const hasRunning = traceResult.tasks.some((task) => {
    const status = normalizeStatus(task.status);
    return status.includes('run') || status.includes('start') || status.includes('submit');
  });
  const hasTasks = traceResult.tasks.length > 0;

  for (const [stepId, entry] of steps) {
    await db.pipelineRunStep.upsert({
      where: {
        pipelineRunId_stepId: {
          pipelineRunId: runId,
          stepId,
        },
      },
      create: {
        pipelineRunId: runId,
        stepId,
        stepName: entry.stepName,
        status: entry.status,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt,
      },
      update: {
        status: entry.status,
        stepName: entry.stepName,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt,
      },
    });
  }

  const runningStepLabels = Array.from(steps.values())
    .filter((s) => s.status === 'running')
    .map((s) => s.stepName);

  const pipelineSteps = getStepsForPipeline(run.pipelineId);
  const totalSteps = pipelineSteps.length;
  const completedSteps = Array.from(steps.values()).filter((s) => s.status === 'completed').length;
  const completedKnownSteps =
    totalSteps > 0
      ? pipelineSteps.filter((step) => steps.get(step.id)?.status === 'completed').length
      : completedSteps;
  const progress =
    totalSteps > 0
      ? Math.min(99, Math.round((completedKnownSteps / totalSteps) * 100))
      : traceResult.overallProgress;

  const traceCompletedKnownWork =
    hasTasks &&
    traceResult.overallProgress === 100 &&
    (totalSteps === 0 || completedKnownSteps >= totalSteps);
  const currentStep =
    runningStepLabels.length > 0
      ? `Running: ${runningStepLabels.join(', ')}`
      : traceCompletedKnownWork
        ? 'Completed'
        : isMeaningfulActiveStepLabel(run.currentStep)
          ? run.currentStep
          : 'Processing...';
  const traceQueueSnapshot = await readQueueSnapshot(run.queueJobId, run.runFolder);
  const queueIsActive = isActiveQueueState(traceQueueSnapshot.state);
  const workflowCompletionObserved =
    queueIsActive && traceResult.overallProgress === 100
      ? Boolean(
          await db.pipelineRunEvent.findFirst({
            where: {
              pipelineRunId: runId,
              OR: [
                { eventType: { contains: 'workflow_complete' } },
                { eventType: { contains: 'workflow_finish' } },
              ],
            },
            select: { id: true },
            orderBy: { occurredAt: 'desc' },
          })
        )
      : false;
  const workflowCompletionReadyToFinalize =
    workflowCompletionObserved && progress >= 90;

  // Once a run is terminal (completed/failed/cancelled), a later re-sync must NOT
  // resurrect it to a non-terminal status: a stale/wedged trace task still reading
  // "running", or a queue snapshot that momentarily looks active, would otherwise
  // un-complete a finished run (and null its completedAt). Mirrors the weblog path's
  // runIsTerminal guard. (Surfaced by a slow pipeline whose post-completion re-sync
  // flipped a completed run back to running.)
  const runWasTerminal = ['completed', 'failed', 'cancelled'].includes(run.status);

  let nextStatus = run.status;
  let resolvedOutputsInThisSync = false;
  if (hasRunning && !runWasTerminal) {
    nextStatus = 'running';
  } else if (traceCompletedKnownWork) {
    nextStatus = 'completed';
  } else if (hasFailures) {
    nextStatus = 'failed';
  }

  const normalizedQueueState = normalizeQueueState(traceQueueSnapshot.state);
  const queueCompleted = normalizedQueueState === 'COMPLETED';
  const queueExitedLocal = normalizedQueueState === 'EXITED';
  const queueCancelled = isCancelledQueueState(normalizedQueueState);
  const queueFailed = isFailedQueueState(normalizedQueueState);
  const inferredExitCode = await inferPipelineExitCode(run.runFolder);
  let statusDeterminedByQueue = false;

  if (nextStatus === 'failed' && !hasRunning) {
    const workflowExitSucceeded =
      queueCompleted ||
      (queueExitedLocal && inferredExitCode === 0) ||
      inferredExitCode === 0;
    if (workflowExitSucceeded) {
      nextStatus = 'completed';
      statusDeterminedByQueue = true;
    }
  }

  if (!hasRunning && nextStatus === run.status) {
    const workflowExitSucceeded =
      queueCompleted ||
      (queueExitedLocal && inferredExitCode === 0) ||
      inferredExitCode === 0;
    if (workflowExitSucceeded) {
      nextStatus = 'completed';
      statusDeterminedByQueue = true;
    }
  }

  if (!hasRunning && queueCancelled) {
    nextStatus = 'cancelled';
    statusDeterminedByQueue = true;
  } else if (!hasRunning && queueFailed) {
    nextStatus = 'failed';
    statusDeterminedByQueue = true;
  }

  // A terminal run is protected from queue re-activation ONLY when the trace agrees
  // the work is actually finished. If the scheduler still reports the job active AND
  // the trace shows work outstanding (partial known steps), the "terminal" status was
  // premature, so demote it back to running. The bug-#5 guard still holds for the
  // genuine case (a complete trace + a momentarily-lingering wrapper job must stay
  // completed, not flip back to running and lose its completedAt).
  const forceRunningFromQueue =
    (nextStatus === 'completed' || nextStatus === 'failed') &&
    queueIsActive &&
    (!runWasTerminal || !traceCompletedKnownWork);
  if (forceRunningFromQueue) {
    nextStatus = 'running';
    statusDeterminedByQueue = true;
  }

  const activeQueueCurrentStep =
    runningStepLabels.length > 0
      ? `Running: ${runningStepLabels.join(', ')}`
      : workflowCompletionReadyToFinalize
        ? 'Finalizing...'
        : isMeaningfulActiveStepLabel(run.currentStep)
          ? run.currentStep
          : 'Running on compute node';

  if (nextStatus === 'completed' && run.pipelineId === 'mag') {
    try {
      await processCompletedPipelineRun(runId, run.pipelineId);
      resolvedOutputsInThisSync = true;
      const outputCount = await countMaterializedOutputs(runId);
      if (outputCount === 0) {
        nextStatus = 'running';
      }
    } catch (processError) {
      console.error('[Sync Pipeline Run Service] Post-completion processing failed:', processError);
      nextStatus = 'running';
    }
  }

  const updateData: Record<string, unknown> = {
    progress: nextStatus === 'completed' ? 100 : progress,
    currentStep:
      forceRunningFromQueue
        ? activeQueueCurrentStep
        : nextStatus === 'completed'
          ? 'Completed'
          : nextStatus === 'failed'
            ? 'Failed'
            : nextStatus === 'cancelled'
              ? 'Cancelled'
              : currentStep,
    statusSource: statusDeterminedByQueue || forceRunningFromQueue ? 'queue' : 'trace',
  };

  if (traceQueueSnapshot.state) {
    updateData.queueStatus = traceQueueSnapshot.state;
    updateData.queueReason = traceQueueSnapshot.reason || undefined;
    updateData.queueUpdatedAt = new Date();
  }

  if (latestEventAt && (!run.lastEventAt || latestEventAt > run.lastEventAt)) {
    updateData.lastEventAt = latestEventAt;
  }
  if (latestEventAt && (!run.lastTraceAt || latestEventAt > run.lastTraceAt)) {
    updateData.lastTraceAt = latestEventAt;
  }

  if (forceRunningFromQueue) {
    updateData.completedAt = null;
    updateData.lastEventAt = new Date();
    updateData.progress = Math.min(99, progress);
  } else if (nextStatus === 'running' && traceCompletedKnownWork) {
    updateData.currentStep = 'Finalizing outputs...';
    updateData.progress = 99;
    updateData.completedAt = null;
  }

  if (traceResult.startedAt && !run.startedAt) {
    updateData.startedAt = traceResult.startedAt;
  }

  if (nextStatus !== run.status) {
    updateData.status = nextStatus;
  }

  if (nextStatus === 'completed' && !run.completedAt) {
    updateData.completedAt = traceResult.completedAt || latestEventAt || new Date();
  }

  if (nextStatus === 'failed' && !run.completedAt) {
    updateData.completedAt = latestEventAt || new Date();
  }

  if (nextStatus === 'cancelled' && !run.completedAt) {
    updateData.completedAt = latestEventAt || new Date();
  }

  await db.pipelineRun.update({
    where: { id: runId },
    data: updateData,
  });
  await notifyPipelineRunTerminalInApp(runId, run.status, nextStatus);

  if (nextStatus === 'completed' && run.status !== 'completed' && !resolvedOutputsInThisSync) {
    try {
      await processCompletedPipelineRun(runId, run.pipelineId);
    } catch (processError) {
      console.error('[Sync Pipeline Run Service] Post-completion processing failed:', processError);
    }
  }

  return jsonResponse({
    success: true,
    synced: true,
    progress: traceResult.overallProgress,
    processes: traceResult.processes.size,
    tasks: traceResult.tasks.length,
    currentStep,
  });
}

export async function cancelPipelineRunForOperator(runId: string): Promise<PipelineOpsResponse> {
  const run = await db.pipelineRun.findUnique({
    where: { id: runId },
  });

  if (!run) {
    return jsonResponse({ error: 'Run not found' }, 404);
  }

  if (!['pending', 'queued', 'running'].includes(run.status)) {
    return jsonResponse({ error: 'Cannot cancel a completed or failed run' }, 400);
  }

  const queueJobId = run.queueJobId;

  const cancelLocalJob = (jobId: string) => {
    const pidStr = jobId.replace(/^local-/, '');
    const pid = Number.parseInt(pidStr, 10);
    if (!Number.isFinite(pid) || pid <= 0) {
      throw new Error('Invalid local job ID');
    }

    try {
      process.kill(-pid, 'SIGTERM');
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ESRCH') {
        return;
      }
      if (error.code === 'EINVAL' || error.code === 'EPERM') {
        try {
          process.kill(pid, 'SIGTERM');
        } catch (inner) {
          const innerError = inner as NodeJS.ErrnoException;
          if (innerError.code === 'ESRCH') {
            return;
          }
          throw inner;
        }
        return;
      }
      throw err;
    }
  };

  const cancelSlurmJob = async (jobId: string) =>
    new Promise<void>((resolve, reject) => {
      const proc = spawn('scancel', [jobId]);
      let stderr = '';

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr || `scancel exited with code ${code}`));
        }
      });

      proc.on('error', reject);
    });

  let forceStop = false;

  if (queueJobId) {
    try {
      if (queueJobId.startsWith('local-')) {
        cancelLocalJob(queueJobId);
      } else {
        await cancelSlurmJob(queueJobId);
      }
    } catch (err) {
      console.warn('[Pipeline Run Service] Kill failed, force-stopping:', err);
      forceStop = true;
    }
  } else if (run.status === 'running') {
    forceStop = true;
  }

  const newStatus = forceStop ? 'failed' : 'cancelled';

  // Guard the write to non-terminal states: the run may have completed (monitor,
  // weblog, or finalizeLocalRun) between the status read above and now. An
  // unconditional update would clobber a genuine `completed` outcome — and its
  // ingested outputs — with `cancelled`/`failed`. If nothing was updated, the run
  // already reached a terminal state, so report that instead.
  const { count } = await db.pipelineRun.updateMany({
    where: { id: runId, status: { in: ['pending', 'queued', 'running'] } },
    data: {
      status: newStatus,
      completedAt: new Date(),
      statusSource: 'manual',
      lastEventAt: new Date(),
    },
  });

  if (count === 0) {
    const current = await db.pipelineRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    return jsonResponse({ success: true, status: current?.status ?? newStatus, alreadyFinalized: true });
  }

  return jsonResponse({ success: true, status: newStatus });
}

export function buildDebugBundleText(bundle: DebugBundle): string {
  const lines: string[] = [];

  lines.push('SeqDesk Debug Bundle');
  lines.push(`GeneratedAt: ${bundle.generatedAt}`);

  lines.push(section('Run'));
  lines.push(`RunID: ${bundle.run.id}`);
  lines.push(`RunNumber: ${bundle.run.runNumber}`);
  lines.push(`Pipeline: ${bundle.run.pipelineId}`);
  lines.push(`Status: ${bundle.run.status}`);
  lines.push(`StatusSource: ${valueOrDash(bundle.run.statusSource)}`);
  lines.push(`CurrentStep: ${valueOrDash(bundle.run.currentStep)}`);
  lines.push(`Progress: ${valueOrDash(bundle.run.progress)}`);
  lines.push(`QueueJobID: ${valueOrDash(bundle.run.queueJobId)}`);
  lines.push(`QueueStatus: ${valueOrDash(bundle.run.queueStatus)}`);
  lines.push(`QueueReason: ${valueOrDash(bundle.run.queueReason)}`);
  lines.push(`CreatedAt: ${valueOrDash(bundle.run.createdAt)}`);
  lines.push(`QueuedAt: ${valueOrDash(bundle.run.queuedAt)}`);
  lines.push(`StartedAt: ${valueOrDash(bundle.run.startedAt)}`);
  lines.push(`CompletedAt: ${valueOrDash(bundle.run.completedAt)}`);
  lines.push(`LastEventAt: ${valueOrDash(bundle.run.lastEventAt)}`);
  lines.push(`RunFolder: ${valueOrDash(bundle.run.runFolder)}`);
  lines.push(`OutputPath: ${valueOrDash(bundle.run.outputPath)}`);
  lines.push(`ErrorPath: ${valueOrDash(bundle.run.errorPath)}`);

  lines.push(section('TargetAndSamples'));
  if (!bundle.target) {
    lines.push('Target: -');
  } else {
    lines.push(`TargetType: ${bundle.target.type}`);
    lines.push(`TargetID: ${bundle.target.id}`);
    lines.push(`TargetTitle: ${bundle.target.title}`);
    if (bundle.target.orderNumber) {
      lines.push(`OrderNumber: ${bundle.target.orderNumber}`);
    }
    lines.push(`SelectedSampleCount: ${bundle.target.selectedSampleCount}`);
    for (const sample of bundle.target.selectedSamples) {
      lines.push(`Sample: ${sample.sampleId} (${sample.id}) reads=${sample.readCount}`);
      for (const read of sample.reads) {
        lines.push(`  ReadID: ${read.id}`);
        lines.push(`    file1: ${valueOrDash(read.file1)}`);
        lines.push(`    file2: ${valueOrDash(read.file2)}`);
        lines.push(`    checksum1: ${valueOrDash(read.checksum1)}`);
        lines.push(`    checksum2: ${valueOrDash(read.checksum2)}`);
      }
    }
  }

  lines.push(section('ExecutionSettings'));
  lines.push(`UseSlurm: ${bundle.executionSettings.useSlurm}`);
  lines.push(`SlurmQueue: ${bundle.executionSettings.slurmQueue}`);
  lines.push(`SlurmCores: ${bundle.executionSettings.slurmCores}`);
  lines.push(`SlurmMemory: ${bundle.executionSettings.slurmMemory}`);
  lines.push(`SlurmTimeLimit: ${bundle.executionSettings.slurmTimeLimit}`);
  lines.push(`SlurmOptions: ${valueOrDash(bundle.executionSettings.slurmOptions)}`);
  lines.push(`RuntimeMode: ${bundle.executionSettings.runtimeMode}`);
  lines.push(`CondaPath: ${valueOrDash(bundle.executionSettings.condaPath)}`);
  lines.push(`CondaEnv: ${valueOrDash(bundle.executionSettings.condaEnv)}`);
  lines.push(`NextflowProfile: ${valueOrDash(bundle.executionSettings.nextflowProfile)}`);
  lines.push(`PipelineRunDir: ${valueOrDash(bundle.executionSettings.pipelineRunDir)}`);
  lines.push(`WeblogURL: ${valueOrDash(bundle.executionSettings.weblogUrl)}`);
  lines.push(`WeblogSecretConfigured: ${bundle.executionSettings.weblogSecretConfigured}`);
  lines.push(`CondaScriptPath: ${valueOrDash(bundle.executionSettings.condaScriptPath)}`);
  lines.push(`CondaScriptExists: ${valueOrDash(bundle.executionSettings.condaScriptExists)}`);

  lines.push(section('HostDiagnostics'));
  for (const result of bundle.hostDiagnostics.commandChecks) {
    lines.push(formatCommandResult(result));
    lines.push('');
  }

  lines.push(section('CondaDiagnostics'));
  for (const result of bundle.hostDiagnostics.condaChecks) {
    lines.push(formatCommandResult(result));
    lines.push('');
  }

  lines.push(section('QueueDiagnostics'));
  if (bundle.hostDiagnostics.queueChecks.length === 0) {
    lines.push('No queue diagnostics available.');
  } else {
    for (const result of bundle.hostDiagnostics.queueChecks) {
      lines.push(formatCommandResult(result));
      lines.push('');
    }
  }

  lines.push(section('Files'));
  for (const file of bundle.files) {
    lines.push(`Path: ${file.path}`);
    lines.push(`Exists: ${file.exists ? 'yes' : 'no'}`);
    lines.push(`Size: ${valueOrDash(file.size)}`);
    lines.push(`UpdatedAt: ${valueOrDash(file.updatedAt)}`);
    if (file.tail) {
      lines.push('Tail:');
      lines.push(file.tail);
    }
    lines.push('');
  }

  lines.push(section('CollectionCommand'));
  lines.push(bundle.collectionCommand);

  lines.push(section('Notes'));
  for (const note of bundle.notes) {
    lines.push(`- ${note}`);
  }

  lines.push(section('RunConfigJSON'));
  lines.push(JSON.stringify(bundle.run.config || {}, null, 2));

  lines.push(section('OutputTail'));
  lines.push(bundle.run.outputTail || '(empty)');

  lines.push(section('ErrorTail'));
  lines.push(bundle.run.errorTail || '(empty)');

  return lines.join('\n').trim() + '\n';
}

function buildCollectionCommand(input: {
  runId: string;
  runFolder: string | null;
  queueJobId: string | null;
  condaPath: string;
  condaEnv: string;
}): string {
  const scriptLines = [
    'set -o pipefail',
    `RUN_ID=${shellQuote(input.runId)}`,
    `RUN_FOLDER=${shellQuote(input.runFolder || '')}`,
    `QUEUE_JOB_ID=${shellQuote(input.queueJobId || '')}`,
    `CONDA_BASE=${shellQuote(input.condaPath || '')}`,
    `CONDA_ENV=${shellQuote(input.condaEnv || 'seqdesk-pipelines')}`,
    'OUT="$HOME/seqdesk-sessioninfo-${RUN_ID}-$(date +%Y%m%d-%H%M%S).txt"',
    '{',
    'echo "=== SeqDesk Session Info ==="',
    'echo "Generated: $(date -Iseconds)"',
    'echo "Hostname: $(hostname 2>/dev/null || echo unknown)"',
    'echo "User: $(whoami 2>/dev/null || echo unknown)"',
    'echo "Kernel: $(uname -a 2>/dev/null || echo unknown)"',
    'echo ""',
    'for cmd in conda nextflow sbatch squeue sacct; do',
    '  if command -v "$cmd" >/dev/null 2>&1; then',
    '    echo "$cmd: $(command -v "$cmd")"',
    '  else',
    '    echo "$cmd: missing"',
    '  fi',
    'done',
    'echo ""',
    'if command -v sbatch >/dev/null 2>&1; then sbatch --version || true; fi',
    'if command -v squeue >/dev/null 2>&1; then squeue --version || true; fi',
    'if command -v sacct >/dev/null 2>&1; then sacct --version || true; fi',
    'echo ""',
    'if [ -n "$CONDA_BASE" ]; then',
    '  echo "Conda base: $CONDA_BASE"',
    '  if [ -f "$CONDA_BASE/etc/profile.d/conda.sh" ]; then',
    '    echo "conda.sh: present"',
    '  else',
    '    echo "conda.sh: missing"',
    '  fi',
    'fi',
    'if command -v conda >/dev/null 2>&1; then',
    '  conda --version || true',
    '  conda env list || true',
    '  if [ -n "$CONDA_ENV" ]; then',
    '    conda run -n "$CONDA_ENV" nextflow -version || true',
    '    conda run -n "$CONDA_ENV" java -version || true',
    '  fi',
    'fi',
    'if [ -n "$QUEUE_JOB_ID" ]; then',
    '  echo ""',
    '  echo "Queue job: $QUEUE_JOB_ID"',
    '  if command -v squeue >/dev/null 2>&1; then',
    '    squeue -j "$QUEUE_JOB_ID" -h -o "%i|%T|%R|%M|%N" || true',
    '  fi',
    '  if command -v sacct >/dev/null 2>&1; then',
    '    sacct -j "$QUEUE_JOB_ID" --format=JobID,State,ExitCode,Elapsed,NodeList%30 --noheader -P || true',
    '  fi',
    'fi',
    'if [ -n "$RUN_FOLDER" ] && [ -d "$RUN_FOLDER" ]; then',
    '  echo ""',
    '  echo "Run folder: $RUN_FOLDER"',
    '  ls -lah "$RUN_FOLDER" || true',
    '  ls -lah "$RUN_FOLDER/logs" || true',
    '  for file in "$RUN_FOLDER/run.sh" "$RUN_FOLDER/samplesheet.csv" "$RUN_FOLDER/nextflow.config" "$RUN_FOLDER/logs/pipeline.out" "$RUN_FOLDER/logs/pipeline.err"; do',
    '    if [ -f "$file" ]; then',
    '      echo ""',
    '      echo "----- $file (tail -n 200) -----"',
    '      tail -n 200 "$file" || true',
    '    fi',
    '  done',
    '  if [ -n "$QUEUE_JOB_ID" ]; then',
    '    for file in "$RUN_FOLDER/logs/slurm-${QUEUE_JOB_ID}.out" "$RUN_FOLDER/logs/slurm-${QUEUE_JOB_ID}.err"; do',
    '      if [ -f "$file" ]; then',
    '        echo ""',
    '        echo "----- $file (tail -n 200) -----"',
    '        tail -n 200 "$file" || true',
    '      fi',
    '    done',
    '  fi',
    'fi',
    '} > "$OUT" 2>&1',
    'echo "$OUT"',
  ];

  return `bash -lc ${shellQuote(scriptLines.join('\n'))}`;
}

export async function getPipelineDebugBundleForOperator(
  runId: string
): Promise<PipelineOpsResponse<DebugBundle | { error: string }>> {
  const run = await db.pipelineRun.findUnique({
    where: { id: runId },
    include: {
      order: {
        select: {
          id: true,
          name: true,
          orderNumber: true,
          userId: true,
          samples: {
            select: {
              id: true,
              sampleId: true,
              reads: {
                select: {
                  id: true,
                  file1: true,
                  file2: true,
                  checksum1: true,
                  checksum2: true,
                },
              },
            },
          },
        },
      },
      study: {
        select: {
          id: true,
          title: true,
          userId: true,
          samples: {
            select: {
              id: true,
              sampleId: true,
              reads: {
                select: {
                  id: true,
                  file1: true,
                  file2: true,
                  checksum1: true,
                  checksum2: true,
                },
              },
            },
          },
        },
      },
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
  });

  if (!run) {
    return jsonResponse({ error: 'Run not found' }, 404);
  }

  const executionSettings = await getExecutionSettings();
  const selectedSampleIds = parseJson<string[]>(run.inputSampleIds);
  const selectedSampleSet =
    Array.isArray(selectedSampleIds) && selectedSampleIds.length > 0
      ? new Set(selectedSampleIds)
      : null;

  const targetSamples =
    run.targetType === 'order' ? run.order?.samples || [] : run.study?.samples || [];

  const selectedSamples = targetSamples
    .filter((sample) => !selectedSampleSet || selectedSampleSet.has(sample.id))
    .map((sample) => ({
      id: sample.id,
      sampleId: sample.sampleId,
      readCount: sample.reads.length,
      reads: sample.reads.map((read) => ({
        id: read.id,
        file1: read.file1,
        file2: read.file2,
        checksum1: read.checksum1,
        checksum2: read.checksum2,
      })),
    }));

  const runFolder = run.runFolder;
  const queueJobId = run.queueJobId;
  const queueIsNumeric = Boolean(queueJobId && /^\d+$/.test(queueJobId));

  const candidateFiles = new Set<string>();
  if (runFolder) {
    candidateFiles.add(path.join(runFolder, 'run.sh'));
    candidateFiles.add(path.join(runFolder, 'samplesheet.csv'));
    candidateFiles.add(path.join(runFolder, 'nextflow.config'));
    candidateFiles.add(path.join(runFolder, 'trace.txt'));
    candidateFiles.add(path.join(runFolder, 'logs', 'pipeline.out'));
    candidateFiles.add(path.join(runFolder, 'logs', 'pipeline.err'));
    if (queueIsNumeric && queueJobId) {
      candidateFiles.add(path.join(runFolder, 'logs', `slurm-${queueJobId}.out`));
      candidateFiles.add(path.join(runFolder, 'logs', `slurm-${queueJobId}.err`));
    }
  }

  const files = await Promise.all(
    Array.from(candidateFiles).map((filePath) => inspectFile(filePath))
  );

  const commandChecks = await Promise.all([
    runShell('hostname'),
    runShell('uname -a'),
    runShell('whoami'),
    runShell('date -Iseconds'),
    runShell(
      'for cmd in conda nextflow sbatch squeue sacct; do if command -v "$cmd" >/dev/null 2>&1; then echo "$cmd=$(command -v "$cmd")"; else echo "$cmd=missing"; fi; done'
    ),
    runShell('if command -v sbatch >/dev/null 2>&1; then sbatch --version; else echo sbatch missing; fi'),
    runShell('if command -v squeue >/dev/null 2>&1; then squeue --version; else echo squeue missing; fi'),
    runShell('if command -v sacct >/dev/null 2>&1; then sacct --version; else echo sacct missing; fi'),
  ]);

  const condaChecks = await Promise.all([
    runShell('if command -v conda >/dev/null 2>&1; then conda --version; else echo conda missing; fi', 12_000),
    runShell('if command -v conda >/dev/null 2>&1; then conda env list; else echo conda missing; fi', 20_000),
    runShell(
      `if command -v conda >/dev/null 2>&1; then conda run -n ${shellQuote(
        executionSettings.condaEnv || 'seqdesk-pipelines'
      )} nextflow -version; else echo conda missing; fi`,
      20_000
    ),
    runShell(
      `if command -v conda >/dev/null 2>&1; then conda run -n ${shellQuote(
        executionSettings.condaEnv || 'seqdesk-pipelines'
      )} java -version; else echo conda missing; fi`,
      20_000
    ),
  ]);

  const queueChecks: CommandResult[] = [];
  if (queueIsNumeric && queueJobId) {
    queueChecks.push(
      await runShell(`squeue -j ${shellQuote(queueJobId)} -h -o '%i|%T|%R|%M|%N'`, 8_000),
      await runShell(
        `sacct -j ${shellQuote(
          queueJobId
        )} --format=JobID,State,ExitCode,Elapsed,NodeList%30 --noheader -P`,
        12_000
      )
    );
  }

  const condaScriptPath = executionSettings.condaPath
    ? path.join(executionSettings.condaPath, 'etc', 'profile.d', 'conda.sh')
    : null;

  const bundle: DebugBundle = {
    generatedAt: new Date().toISOString(),
    run: {
      id: run.id,
      runNumber: run.runNumber,
      pipelineId: run.pipelineId,
      status: run.status,
      statusSource: run.statusSource,
      currentStep: run.currentStep,
      progress: run.progress,
      queueJobId: run.queueJobId,
      queueStatus: run.queueStatus,
      queueReason: run.queueReason,
      createdAt: run.createdAt,
      queuedAt: run.queuedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      lastEventAt: run.lastEventAt,
      runFolder: run.runFolder,
      outputPath: run.outputPath,
      errorPath: run.errorPath,
      outputTail: run.outputTail,
      errorTail: run.errorTail,
      config: parseJson<Record<string, unknown>>(run.config),
    },
    target:
      run.targetType === 'order' && run.order
        ? {
            type: 'order',
            id: run.order.id,
            title: run.order.name ?? run.order.orderNumber,
            orderNumber: run.order.orderNumber,
            selectedSamples,
            selectedSampleCount: selectedSamples.length,
          }
        : run.study
          ? {
              type: 'study',
              id: run.study.id,
              title: run.study.title,
              selectedSamples,
              selectedSampleCount: selectedSamples.length,
            }
          : null,
    study: run.study
      ? {
          id: run.study.id,
          title: run.study.title,
          selectedSamples,
          selectedSampleCount: selectedSamples.length,
        }
      : null,
    executionSettings: {
      useSlurm: executionSettings.useSlurm,
      slurmQueue: executionSettings.slurmQueue,
      slurmCores: executionSettings.slurmCores,
      slurmMemory: executionSettings.slurmMemory,
      slurmTimeLimit: executionSettings.slurmTimeLimit,
      slurmOptions: executionSettings.slurmOptions,
      runtimeMode: executionSettings.runtimeMode,
      condaPath: executionSettings.condaPath,
      condaEnv: executionSettings.condaEnv,
      nextflowProfile: executionSettings.nextflowProfile,
      pipelineRunDir: executionSettings.pipelineRunDir,
      weblogUrl: executionSettings.weblogUrl || '',
      weblogSecretConfigured: Boolean(executionSettings.weblogSecret),
      condaScriptPath,
      condaScriptExists: condaScriptPath ? await fileExists(condaScriptPath) : null,
    },
    hostDiagnostics: {
      commandChecks,
      condaChecks,
      queueChecks,
    },
    files,
    collectionCommand: buildCollectionCommand({
      runId: run.id,
      runFolder: run.runFolder,
      queueJobId: run.queueJobId,
      condaPath: executionSettings.condaPath,
      condaEnv: executionSettings.condaEnv,
    }),
    notes: [
      'Run this collection command on the same host where SeqDesk launches pipelines.',
      'Attach the generated text file and this JSON when reporting pipeline issues.',
    ],
  };

  return jsonResponse(bundle);
}
