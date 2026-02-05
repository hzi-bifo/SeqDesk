import 'dotenv/config';
import { db } from '../src/lib/db';
import { parseTraceFile, findTraceFile, readTail } from '../src/lib/pipelines/nextflow';
import { findStepByProcess, getStepsForPipeline } from '../src/lib/pipelines/definitions';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type RunStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

const DEFAULT_INTERVAL_MS = 15000;

function normalizeStatus(value?: string): string {
  return value ? value.toLowerCase() : '';
}

async function checkSlurmStatus(jobId: string): Promise<RunStatus | null> {
  try {
    const { stdout } = await execFileAsync('squeue', ['-h', '-j', jobId, '-o', '%T'], {
      timeout: 5000,
    });
    const state = stdout.trim();
    if (state) {
      const normalized = normalizeStatus(state);
      if (normalized.includes('run')) return 'running';
      if (normalized.includes('pending') || normalized.includes('queue')) return 'queued';
    }
  } catch {
    // Fall through to sacct
  }

  try {
    const { stdout } = await execFileAsync('sacct', ['-j', jobId, '-o', 'State', '-n', '-P'], {
      timeout: 5000,
    });
    const state = stdout.split('\n').map((line) => line.trim()).find(Boolean);
    if (!state) return null;
    const normalized = normalizeStatus(state);
    if (normalized.includes('completed')) return 'completed';
    if (normalized.includes('cancel')) return 'cancelled';
    if (normalized.includes('fail') || normalized.includes('timeout') || normalized.includes('out_of_memory')) {
      return 'failed';
    }
  } catch {
    return null;
  }

  return null;
}

async function checkLocalStatus(jobId: string): Promise<RunStatus | null> {
  const pidStr = jobId.replace(/^local-/, '');
  const pid = Number.parseInt(pidStr, 10);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return 'running';
  } catch {
    return 'failed';
  }
}

function deriveStepStatus(status: string, exit?: number): 'pending' | 'running' | 'completed' | 'failed' {
  const normalized = normalizeStatus(status);
  if (normalized.includes('fail') || normalized.includes('error') || (exit !== undefined && exit !== 0)) {
    return 'failed';
  }
  if (normalized.includes('run') || normalized.includes('start') || normalized.includes('submit')) {
    return 'running';
  }
  if (normalized.includes('complete') || normalized.includes('done') || normalized.includes('success')) {
    return 'completed';
  }
  return 'pending';
}

async function syncRun(run: {
  id: string;
  pipelineId: string;
  status: RunStatus;
  runFolder: string | null;
  queueJobId: string | null;
  outputPath: string | null;
  errorPath: string | null;
}) {
  let derivedStatus: RunStatus | null = null;
  let currentStep: string | null = null;
  let progress: number | null = null;

  const pipelineSteps = getStepsForPipeline(run.pipelineId);
  const totalSteps = pipelineSteps.length;

  if (run.runFolder) {
    const tracePath = await findTraceFile(run.runFolder);
    if (tracePath) {
      const trace = await parseTraceFile(tracePath);
      const stepMap = new Map<string, {
        stepName: string;
        status: 'pending' | 'running' | 'completed' | 'failed';
        startedAt?: Date;
        completedAt?: Date;
      }>();

      for (const task of trace.tasks) {
        const stepDef = findStepByProcess(run.pipelineId, task.process);
        const stepId = stepDef?.id || task.process;
        const stepName = stepDef?.name || task.process;

        if (!stepMap.has(stepId)) {
          stepMap.set(stepId, { stepName, status: 'pending' });
        }

        const entry = stepMap.get(stepId)!;
        const nextStatus = deriveStepStatus(task.status, task.exit);
        if (entry.status !== 'failed') {
          if (nextStatus === 'failed') entry.status = 'failed';
          else if (nextStatus === 'running') entry.status = 'running';
          else if (nextStatus === 'completed' && entry.status === 'pending') entry.status = 'completed';
        }

        const startedAt = task.start || task.submit;
        if (startedAt && (!entry.startedAt || startedAt < entry.startedAt)) {
          entry.startedAt = startedAt;
        }
        if (task.complete && (!entry.completedAt || task.complete > entry.completedAt)) {
          entry.completedAt = task.complete;
        }
      }

      for (const [stepId, entry] of stepMap) {
        await db.pipelineRunStep.upsert({
          where: {
            pipelineRunId_stepId: {
              pipelineRunId: run.id,
              stepId,
            },
          },
          create: {
            pipelineRunId: run.id,
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

      const runningSteps = Array.from(stepMap.values()).filter((s) => s.status === 'running');
      if (runningSteps.length > 0) {
        currentStep = runningSteps[0].stepName;
        derivedStatus = 'running';
      } else if (stepMap.size > 0 && Array.from(stepMap.values()).every((s) => s.status === 'completed')) {
        derivedStatus = 'completed';
        currentStep = 'Completed';
      } else if (Array.from(stepMap.values()).some((s) => s.status === 'failed')) {
        derivedStatus = 'failed';
        currentStep = 'Failed';
      }

      const completedSteps = Array.from(stepMap.values()).filter((s) => s.status === 'completed').length;
      if (totalSteps > 0) {
        progress = Math.min(99, Math.round((completedSteps / totalSteps) * 100));
      } else {
        progress = trace.overallProgress;
      }
    }
  }

  if (!derivedStatus && run.queueJobId) {
    if (run.queueJobId.startsWith('local-')) {
      derivedStatus = await checkLocalStatus(run.queueJobId);
    } else {
      derivedStatus = await checkSlurmStatus(run.queueJobId);
    }
  }

  if (derivedStatus) {
    const update: Record<string, unknown> = { status: derivedStatus };
    if (currentStep) update.currentStep = currentStep;
    if (progress !== null) update.progress = progress;
    if (derivedStatus === 'completed' || derivedStatus === 'failed' || derivedStatus === 'cancelled') {
      update.completedAt = new Date();
    }
    if (derivedStatus === 'running' && run.status !== 'running') {
      update.startedAt = new Date();
    }

    const outputTail = await readTail(run.outputPath);
    if (outputTail) update.outputTail = outputTail;
    const errorTail = await readTail(run.errorPath);
    if (errorTail) update.errorTail = errorTail;

    await db.pipelineRun.update({
      where: { id: run.id },
      data: update,
    });
  }
}

async function runOnce() {
  const runs = await db.pipelineRun.findMany({
    where: { status: { in: ['pending', 'queued', 'running'] } },
    select: {
      id: true,
      pipelineId: true,
      status: true,
      runFolder: true,
      queueJobId: true,
      outputPath: true,
      errorPath: true,
    },
  });

  for (const run of runs) {
    try {
      await syncRun({ ...run, status: run.status as RunStatus });
    } catch (error) {
      console.error('[pipeline-monitor] Failed to sync run', run.id, error);
    }
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const once = args.has('--once');
  const interval = Number(process.env.PIPELINE_MONITOR_INTERVAL_MS || DEFAULT_INTERVAL_MS);

  if (once) {
    await runOnce();
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`[pipeline-monitor] running every ${interval}ms`);
  await runOnce();
  setInterval(runOnce, interval);
}

main().catch((error) => {
  console.error('[pipeline-monitor] fatal', error);
  process.exit(1);
});
