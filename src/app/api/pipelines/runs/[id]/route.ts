import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { PIPELINE_REGISTRY } from '@/lib/pipelines';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { isDemoSession } from '@/lib/demo/server';

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

// GET - Get run details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const run = await db.pipelineRun.findUnique({
      where: { id },
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
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    // Non-admins can only see runs for their own studies/orders
    if (
      session.user.role !== 'FACILITY_ADMIN' &&
      run.study?.userId !== session.user.id &&
      run.order?.userId !== session.user.id
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const parseJson = <T>(value: string | null): T | null => {
      if (!value) return null;
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    };

    const parseSampleIds = (value: string | null): string[] | null => {
      const parsed = parseJson<unknown>(value);
      if (!Array.isArray(parsed)) return null;
      if (parsed.some((id) => typeof id !== 'string')) return null;
      return parsed as string[];
    };

    const selectedSampleIds = parseSampleIds(run.inputSampleIds);
    const selectedSampleIdSet = selectedSampleIds ? new Set(selectedSampleIds) : null;

    // Enrich with pipeline metadata
    const definition = PIPELINE_REGISTRY[run.pipelineId];

    // Collect input files from samples' reads
    const inputFiles: {
      id: string;
      name: string;
      path: string;
      type: 'read_1' | 'read_2' | 'samplesheet';
      sampleId?: string;
      checksum?: string;
      size?: number;
    }[] = [];

    const targetSamples = run.targetType === 'order' ? run.order?.samples || [] : run.study?.samples || [];

    // Add reads as input files
    if (targetSamples.length > 0) {
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
            });
          }
        }
      }
    }

    // Add samplesheet if run folder exists
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

    const executionCommands = await buildExecutionCommands(
      run.runFolder,
      run.queueJobId
    );

    const sizeProbePaths = new Set<string>();

    for (const file of inputFiles) {
      sizeProbePaths.add(file.path);
    }
    for (const file of detectedLogFiles) {
      sizeProbePaths.add(file.path);
    }
    for (const artifact of run.artifacts) {
      sizeProbePaths.add(artifact.path);
    }
    for (const assembly of run.assembliesCreated) {
      if (assembly.assemblyFile) {
        sizeProbePaths.add(assembly.assemblyFile);
      }
    }
    for (const bin of run.binsCreated) {
      if (bin.binFile) {
        sizeProbePaths.add(bin.binFile);
      }
    }
    if (run.outputPath) {
      sizeProbePaths.add(run.outputPath);
    }
    if (run.errorPath) {
      sizeProbePaths.add(run.errorPath);
    }
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

    const inputFilesWithSize = inputFiles.map((file) => ({
      ...file,
      size: fileSizeByPath[file.path],
    }));

    const detectedLogFilesWithSize = detectedLogFiles.map((file) => ({
      ...file,
      size: fileSizeByPath[file.path],
    }));

    // Convert BigInt fields to numbers so JSON.stringify doesn't throw
    const serializedArtifacts = run.artifacts.map((a) => ({
      ...a,
      size: a.size != null ? Number(a.size) : fileSizeByPath[a.path] ?? null,
    }));

    const response = {
      ...run,
      pipelineName: definition?.name || run.pipelineId,
      pipelineIcon: definition?.icon || 'CircleDot',
      pipelineDescription: definition?.description,
      config: parseJson<Record<string, unknown>>(run.config),
      results: parseJson<Record<string, unknown>>(run.results),
      inputSampleIds: selectedSampleIds,
      inputFiles: inputFilesWithSize,
      detectedLogFiles: detectedLogFilesWithSize,
      fileSizeByPath,
      outputPathSize: run.outputPath ? fileSizeByPath[run.outputPath] ?? null : null,
      errorPathSize: run.errorPath ? fileSizeByPath[run.errorPath] ?? null : null,
      artifacts: serializedArtifacts,
      executionCommands,
    };

    return NextResponse.json({ run: response });
  } catch (error) {
    console.error('[Pipeline Run API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch run details' },
      { status: 500 }
    );
  }
}

// DELETE - Cancel a run
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (isDemoSession(session)) {
      return NextResponse.json(
        { error: 'Pipeline execution is disabled in the public demo.' },
        { status: 403 }
      );
    }

    const { id } = await params;

    const run = await db.pipelineRun.findUnique({
      where: { id },
    });

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    // Can only cancel pending, queued, or running runs
    if (!['pending', 'queued', 'running'].includes(run.status)) {
      return NextResponse.json(
        { error: 'Cannot cancel a completed or failed run' },
        { status: 400 }
      );
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

    // Determine whether this is a force-stop (no process to kill) or a normal cancel
    let forceStop = false;

    if (queueJobId) {
      try {
        if (queueJobId.startsWith('local-')) {
          cancelLocalJob(queueJobId);
        } else {
          await cancelSlurmJob(queueJobId);
        }
      } catch (err) {
        // Process is already dead — treat as force-stop
        console.warn('[Pipeline Run API] Kill failed, force-stopping:', err);
        forceStop = true;
      }
    } else if (run.status === 'running') {
      // Running but no queueJobId — stuck run
      forceStop = true;
    }

    // Force-stopped (stuck) runs are marked "failed"; normal cancels are "cancelled"
    const newStatus = forceStop ? 'failed' : 'cancelled';

    await db.pipelineRun.update({
      where: { id },
      data: {
        status: newStatus,
        completedAt: new Date(),
        statusSource: 'manual',
        lastEventAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Pipeline Run API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to cancel run' },
      { status: 500 }
    );
  }
}
