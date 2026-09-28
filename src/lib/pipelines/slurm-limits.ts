/**
 * How many jobs this server's SLURM user may have at once. Nextflow's SLURM executor needs the run's own job plus one
 * job per task; with a limit of one, the task jobs wait behind the run's job for ever (seen on a real Slurm with
 * MaxJobs=1: AssocMaxJobsLimit). Then the run keeps all its steps inside its own job (Nextflow's local executor).
 */
import * as childProcess from 'child_process';
import os from 'os';

export type LimitExec = (file: string, args: string[]) => Promise<{ stdout: string }>;
// Looked up when called, so a module that mocks child_process without execFile can still load this one.
const defaultExec: LimitExec = (file, args) => new Promise((resolve, reject) => {
  if (typeof childProcess.execFile !== 'function') { reject(new Error('execFile is unavailable')); return; }
  childProcess.execFile(file, args, { timeout: 20_000 }, (error, stdout) => (error ? reject(error) : resolve({ stdout: String(stdout) })));
});

const numbers = (text: string) => text.split(/[|\n]/).map((v) => v.trim()).filter((v) => /^\d+$/.test(v)).map(Number).filter((n) => n > 0);

/** The smallest job or submit limit on the user's association and its QOS; null when limits are not enforced or unknown. */
export async function slurmJobSlots(exec: LimitExec = defaultExec, user = os.userInfo().username): Promise<number | null> {
  try {
    const { stdout: config } = await exec('scontrol', ['show', 'config']);
    const enforce = /AccountingStorageEnforce\s*=\s*(\S+)/.exec(config)?.[1] ?? 'none';
    if (!/limits|safe/i.test(enforce)) return null;
    const { stdout: assoc } = await exec('sacctmgr', ['-n', '-P', 'show', 'assoc', `user=${user}`, 'format=MaxJobs,MaxSubmit,GrpJobs,GrpSubmit,QOS']);
    const limits = assoc.split('\n').filter(Boolean).flatMap((line) => numbers(line.split('|').slice(0, 4).join('|')));
    const qosNames = [...new Set(assoc.split('\n').flatMap((line) => (line.split('|')[4] ?? '').split(',')).map((q) => q.trim()).filter(Boolean))];
    if (qosNames.length) {
      const { stdout: qos } = await exec('sacctmgr', ['-n', '-P', 'show', 'qos', ...qosNames, 'format=MaxJobsPU,MaxSubmitPU,GrpJobs,GrpSubmit']);
      limits.push(...numbers(qos));
    }
    return limits.length ? Math.min(...limits) : null;
  } catch {
    return null;
  }
}

/** Whether a run must keep its steps inside its own SLURM job. */
export const needsInlineSlurm = (slots: number | null) => slots != null && slots <= 1;
