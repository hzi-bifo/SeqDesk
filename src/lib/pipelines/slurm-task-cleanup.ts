/**
 * Nextflow submits one SLURM job per task (nf-PROCESS_(tag)). When the run's own job ends without Nextflow having
 * cancelled them — scancel of the head job, the head's time limit, a node that died — those task jobs keep running and
 * holding the allocation. Found on a real single-node Slurm: a cancelled run's nf-RUN_FASTQC kept running for minutes.
 *
 * The task jobs are found by their working directory, which Nextflow puts under the run folder's `work/`; nothing
 * else is ever touched.
 */
import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type Exec = (file: string, args: string[]) => Promise<{ stdout: string }>;
const run: Exec = (file, args) => execFileAsync(file, args, { timeout: 10_000 });

/** Job ids of the squeue rows (`%i|%T|%.1024Z`) that are still active and work under the run folder's work directory. */
export function taskJobsOfRun(squeueOutput: string, runFolder: string): string[] {
  const work = `${path.resolve(runFolder)}/work/`;
  return squeueOutput.split(/\r?\n/).flatMap((line) => {
    const [id = '', state = '', workDir = ''] = line.split('|').map((field) => field.trim());
    if (!/^\d+$/.test(id) || !workDir) return [];
    if (/^(COMPLETED|CANCELLED|FAILED|TIMEOUT|OUT_OF_MEMORY|NODE_FAIL|BOOT_FAIL|PREEMPTED|DEADLINE)/i.test(state)) return [];
    return path.resolve(workDir).startsWith(work) || `${path.resolve(workDir)}/` === work ? [id] : [];
  });
}

/** scancel the run's leftover task jobs; returns their ids. Best effort: a scheduler error leaves them to the next pass. */
export async function cancelLeftoverSlurmTaskJobs(runFolder: string | null | undefined, exec: Exec = run): Promise<string[]> {
  if (!runFolder) return [];
  try {
    const { stdout } = await exec('squeue', ['--me', '-h', '-o', '%i|%T|%.1024Z']);
    const ids = taskJobsOfRun(stdout, runFolder);
    if (ids.length) await exec('scancel', ids);
    return ids;
  } catch (error) {
    console.warn('[pipelines] Could not cancel leftover SLURM task jobs for', runFolder, (error as Error).message);
    return [];
  }
}

/**
 * While the run's own job runs, why its task jobs wait: the pending reason of its first waiting task job when none of
 * them runs (a drained node, a full cluster), else null. The card says "Running · step 2 of 2 · waiting: …" with it.
 */
export function waitingTaskReason(squeueOutput: string, runFolder: string): string | null {
  const work = `${path.resolve(runFolder)}/work/`;
  const tasks = squeueOutput.split(/\r?\n/).flatMap((line) => {
    const [id = '', state = '', reason = '', workDir = ''] = line.split('|').map((field) => field.trim());
    return /^\d+$/.test(id) && workDir && path.resolve(workDir).startsWith(work) ? [{ state: state.toUpperCase(), reason }] : [];
  });
  if (!tasks.length || tasks.some((task) => task.state === 'RUNNING' || task.state === 'COMPLETING')) return null;
  return tasks.find((task) => task.state === 'PENDING' && task.reason && task.reason !== 'None')?.reason ?? null;
}

export async function readWaitingTaskReason(runFolder: string | null | undefined, exec: Exec = run): Promise<string | null> {
  if (!runFolder) return null;
  try {
    const { stdout } = await exec('squeue', ['--me', '-h', '-t', 'PENDING,RUNNING,CONFIGURING,COMPLETING', '-o', '%i|%T|%r|%.1024Z']);
    return waitingTaskReason(stdout, runFolder);
  } catch {
    return null;
  }
}

/**
 * A task job of the run that SLURM already ended badly while Nextflow has not noticed yet (it waits for the task's
 * exit file, up to exitReadTimeout): from `sacct -X -P -o JobID,JobName,State,ExitCode,WorkDir` lines. A later attempt
 * of the same task that runs or completed hides the earlier failure (Nextflow retries). With the run's own job id,
 * only task jobs submitted after it count: after a Resume the task jobs the earlier attempt left ended (cancelled
 * with it, or the failure that stopped it) are history, not news about the attempt that runs now (seen against a
 * simulated SLURM: a resumed run said "FastQC was cancelled outside SeqDesk" until Nextflow resubmitted FastQC).
 */
export function endedTaskJob(sacctOutput: string, runFolder: string, afterJobId?: string | null): { jobId: string; process: string; state: string; exitCode: string; workDir: string } | null {
  const work = `${path.resolve(runFolder)}/work/`;
  const after = afterJobId && /^\d+$/.test(afterJobId) ? Number(afterJobId) : null;
  const rows = sacctOutput.split(/\r?\n/).flatMap((line) => {
    const [jobId = '', name = '', state = '', exitCode = '', workDir = ''] = line.split('|').map((field) => field.trim());
    if (!/^\d+$/.test(jobId) || !workDir || !path.resolve(workDir).startsWith(work)) return [];
    if (after != null && Number(jobId) <= after) return [];
    return [{ jobId, name, process: name.replace(/^nf-/, '').replace(/_\(.*\)$/, ''), state: state.split(/\s+/)[0].toUpperCase(), exitCode, workDir }];
  });
  for (const row of [...rows].reverse()) {
    if (!/^(FAILED|OUT_OF_MEMORY|TIMEOUT|CANCELLED|NODE_FAIL)$/.test(row.state)) continue;
    const later = rows.filter((r) => r.name === row.name && Number(r.jobId) > Number(row.jobId));
    if (later.some((r) => /^(RUNNING|PENDING|COMPLETED|CONFIGURING)$/.test(r.state))) continue;
    return { jobId: row.jobId, process: row.process, state: row.state, exitCode: row.exitCode, workDir: row.workDir };
  }
  return null;
}

export async function readEndedTaskJob(runFolder: string | null | undefined, since: Date | null | undefined, exec: Exec = run, afterJobId?: string | null) {
  if (!runFolder) return null;
  try {
    const start = (since ?? new Date(Date.now() - 86_400_000)).toISOString().slice(0, 19);
    const { stdout } = await exec('sacct', ['--me', '-X', '-n', '-P', '-S', start, '-o', 'JobID,JobName%200,State,ExitCode,WorkDir%1024']);
    return endedTaskJob(stdout, runFolder, afterJobId);
  } catch {
    return null;
  }
}
