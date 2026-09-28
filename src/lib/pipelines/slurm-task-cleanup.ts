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
