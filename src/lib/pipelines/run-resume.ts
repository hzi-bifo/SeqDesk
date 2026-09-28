/**
 * Resume a failed or cancelled pipeline run (S-25P "The Resume dialog"): Nextflow's -resume in the same run folder
 * (the same work directory and session history), so finished tasks are reused and only what failed and what follows
 * runs again. Optional memory/time overrides go into a small config for one process (or every process), and the
 * SLURM head job's own limits follow the time override. The run keeps its number; its events record each resume.
 */
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { db } from '@/lib/db';
import { writePipelineLaunchIdentity } from './launch-identity';
import { finalizeLocalRun } from './pipeline-run-service';

export interface ResumeOverrides { process?: string | null; memory?: string | null; time?: string | null }

const PROCESS = /^[A-Za-z0-9_:.*-]{1,120}$/;
const MEMORY = /^\s*(\d{1,5}(?:\.\d{1,2})?)\s*(MB|GB|TB)\s*$/i;
const TIME = /^\s*(\d{1,4})\s*(s|m|min|h|d)\s*$/i;

/** Validated overrides, normalized for Nextflow ("128.GB", "24.h"); throws with words the person can act on. */
export function normalizeOverrides(input: ResumeOverrides): { process: string | null; memory: string | null; time: string | null; hours: number | null } {
  const process = input.process?.trim() || null;
  if (process && !PROCESS.test(process)) throw new Error('The step name is not valid.');
  let memory: string | null = null, time: string | null = null, hours: number | null = null;
  if (input.memory) {
    const m = MEMORY.exec(input.memory);
    if (!m) throw new Error('Memory must look like “128 GB”.');
    memory = `${m[1]}.${m[2].toUpperCase()}`;
  }
  if (input.time) {
    const t = TIME.exec(input.time);
    if (!t) throw new Error('Time must look like “24 h”.');
    const unit = t[2].toLowerCase() === 'min' ? 'm' : t[2].toLowerCase();
    time = `${t[1]}.${unit}`;
    hours = unit === 'h' ? Number(t[1]) : unit === 'd' ? Number(t[1]) * 24 : unit === 'm' ? Math.ceil(Number(t[1]) / 60) : 1;
  }
  return { process, memory, time, hours };
}

/** The config added on resume: overwrite the run's reports, and raise memory/time for one step (or all). */
export function resumeConfig(overrides: ReturnType<typeof normalizeOverrides>): string {
  const lines = ['// Written by SeqDesk when this run was resumed.', 'trace.overwrite = true', 'report.overwrite = true', 'timeline.overwrite = true', 'dag.overwrite = true'];
  const settings = [overrides.memory ? `memory = ${overrides.memory}` : '', overrides.time ? `time = ${overrides.time}` : ''].filter(Boolean);
  if (settings.length) {
    const selector = overrides.process ? `'${overrides.process.includes(':') ? overrides.process : `.*:?${overrides.process}`}'` : `'.*'`;
    lines.push('process {', `  withName: ${selector} {`, ...settings.map((s) => `    ${s}`), '  }', '}');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The resume script: the run's own run.sh with `-resume` and the resume config added to the Nextflow command, logs
 * appended instead of truncated, and (for SLURM) the head job's time limit raised when the time override asks for it.
 */
export function resumeScript(runSh: string, configPath: string, hours?: number | null, attempt = 1): string {
  const quoted = `'${configPath.replace(/'/g, `'\\''`)}'`;
  let found = false;
  let script = runSh.replace(/("\$\{NEXTFLOW_RUNNER\[@\]\}"\s+run\s+\S+\s+\\\n)/, (match) => { found = true; return `${match}  -resume \\\n  -c ${quoted} \\\n`; });
  if (!found) throw new Error('This run’s script has no Nextflow command to resume.');
  script = script
    .replace(/^echo "Starting (.*) pipeline at \$\(date\)" > "\$STDOUT_LOG"$/m, 'echo "Resuming $1 pipeline at $(date)" >> "$STDOUT_LOG"')
    .replace(/^echo "" > "\$STDERR_LOG"$/m, 'echo "" >> "$STDERR_LOG"');
  // Nextflow refuses a run name its history already has; -resume picks the last session of this folder by itself.
  // SLURM scripts keep the name in SEQDESK_RUN_NAME (a requeued job changes it); older scripts pass -name 'X'.
  if (/^SEQDESK_RUN_NAME='?[A-Za-z0-9._-]+'?$/m.test(script)) {
    script = script.replace(/^SEQDESK_RUN_NAME='?([A-Za-z0-9._-]+)'?$/m, (_m, name: string) => `SEQDESK_RUN_NAME='${name.replace(/-r\d+$/, '')}-r${attempt}'`);
  } else {
    script = script.replace(/-name '?([A-Za-z0-9._-]+)'?/, (_m, name: string) => `-name '${name.replace(/-r\d+$/, '')}-r${attempt}'`);
  }
  if (hours) script = script.replace(/^#SBATCH -t \d+:0:0$/m, (line) => { const current = Number(/-t (\d+)/.exec(line)![1]); return `#SBATCH -t ${Math.max(current, hours + 1)}:0:0`; });
  return script;
}

export type ResumeResult = { status: number; body: Record<string, unknown> };

/** Resume a failed/cancelled run in place. The caller has checked access. */
export async function resumePipelineRun(runId: string, input: ResumeOverrides): Promise<ResumeResult> {
  let overrides: ReturnType<typeof normalizeOverrides>;
  try { overrides = normalizeOverrides(input); } catch (error) { return { status: 400, body: { error: (error as Error).message } }; }
  const run = await db.pipelineRun.findUnique({ where: { id: runId }, select: { id: true, pipelineId: true, status: true, runFolder: true, executionMode: true, runNumber: true } });
  if (!run) return { status: 404, body: { error: 'Run not found.' } };
  if (run.status !== 'failed' && run.status !== 'cancelled') return { status: 409, body: { error: `Only a failed or cancelled run can be resumed (this one is ${run.status}).` } };
  if (!run.runFolder) return { status: 409, body: { error: 'This run has no run folder to resume from.' } };
  const runSh = await fs.readFile(path.join(run.runFolder, 'run.sh'), 'utf8').catch(() => null);
  if (!runSh) return { status: 409, body: { error: 'This run’s script is gone; start a new run instead.' } };
  const count = await db.pipelineRunEvent.count({ where: { pipelineRunId: runId, eventType: 'resumed' } });
  const n = count + 1;
  const configPath = path.join(run.runFolder, `resume-${n}.config`);
  let script: string;
  try { script = resumeScript(runSh, configPath, overrides.hours, n); } catch (error) { return { status: 409, body: { error: (error as Error).message } }; }
  // Keep what the failed attempt wrote: the trace and logs are overwritten/appended by the resumed attempt.
  for (const [from, to] of [['trace.txt', `trace.before-resume-${n}.txt`], ['logs/pipeline.out', `logs/pipeline.before-resume-${n}.out`], ['logs/pipeline.err', `logs/pipeline.before-resume-${n}.err`]]) {
    await fs.copyFile(path.join(run.runFolder, from), path.join(run.runFolder, to)).catch(() => undefined);
  }
  await fs.writeFile(configPath, resumeConfig(overrides));
  const scriptPath = path.join(run.runFolder, `run.resume-${n}.sh`);
  await fs.writeFile(scriptPath, script, { mode: 0o755 });
  const slurm = run.executionMode === 'slurm';
  const claimed = await db.pipelineRun.updateMany({
    // A cancel that is still stopping processes owns the row; resuming now would lose the resumed attempt's end.
    where: { id: runId, status: { in: ['failed', 'cancelled'] }, OR: [{ statusSource: null }, { statusSource: { notIn: ['cancelling', 'finalizing'] } }] },
    data: { status: slurm ? 'queued' : 'running', currentStep: slurm ? 'Waiting for scheduler' : 'Resuming', statusSource: 'launcher',
      completedAt: null, errorTail: null, queueStatus: slurm ? 'PENDING' : 'RUNNING', queueReason: null, queueUpdatedAt: new Date(), lastEventAt: new Date(), ...(slurm ? { queuedAt: new Date() } : {}) },
  });
  if (!claimed.count) return { status: 409, body: { error: 'The run is still stopping or someone else resumed it a moment ago. Try again in a few seconds.' } };
  await db.pipelineRunEvent.create({ data: { pipelineRunId: runId, eventType: 'resumed', status: 'info', source: 'launcher',
    message: `Resumed (${n})${overrides.memory ? ` · memory ${overrides.memory}` : ''}${overrides.time ? ` · time ${overrides.time}` : ''}${overrides.process ? ` · ${overrides.process}` : ''}`,
    payload: JSON.stringify({ n, ...overrides }) } });
  try {
    if (slurm) {
      const jobId = await new Promise<string>((resolve, reject) => {
        const child = spawn('sbatch', ['--parsable', scriptPath], { cwd: run.runFolder! });
        let out = '', err = '';
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err += d; });
        child.on('error', reject);
        child.on('close', (code) => { const id = /^(\d+)/.exec(out.trim())?.[1]; if (code === 0 && id) resolve(id); else reject(new Error(`sbatch refused the resume: ${(err || out).trim().slice(0, 300)}`)); });
      });
      await writePipelineLaunchIdentity({ runFolder: run.runFolder, runId, kind: 'slurm', numericId: jobId });
      await db.pipelineRun.update({ where: { id: runId }, data: { queueJobId: jobId } });
      return { status: 200, body: { resumed: n, status: 'queued', jobId } };
    }
    const child = spawn('bash', [scriptPath], { cwd: run.runFolder, stdio: 'ignore', detached: true });
    child.unref();
    child.on('close', (code) => { void finalizeLocalRun(runId, run.pipelineId, code); });
    child.on('error', () => { void finalizeLocalRun(runId, run.pipelineId, 1); });
    if (!child.pid) throw new Error('The resumed pipeline did not start.');
    await writePipelineLaunchIdentity({ runFolder: run.runFolder, runId, kind: 'local', numericId: child.pid });
    await db.pipelineRun.update({ where: { id: runId }, data: { queueJobId: `local-${child.pid}` } });
    return { status: 200, body: { resumed: n, status: 'running' } };
  } catch (error) {
    await db.pipelineRun.update({ where: { id: runId }, data: { status: 'failed', currentStep: 'Failed', completedAt: new Date(), errorTail: (error as Error).message.slice(0, 2000), statusSource: 'launcher' } });
    return { status: 500, body: { error: (error as Error).message } };
  }
}
