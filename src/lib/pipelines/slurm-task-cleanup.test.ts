import { describe, expect, it } from 'vitest';

import { cancelLeftoverSlurmTaskJobs, taskJobsOfRun } from './slurm-task-cleanup';

const RUN = '/data/runs/FASTQC-20260928-008--id-abc';
// squeue --me -h -o '%i|%T|%.1024Z' (the WorkDir column is right-aligned and padded)
const SQUEUE = [
  `32|RUNNING|   ${RUN}`,
  `33|RUNNING|   ${RUN}/work/ef/b65bae5d71e03ac5a753e9745c4cb9`,
  `34|PENDING|   ${RUN}/work/1a/22`,
  `35|RUNNING|   /data/runs/FASTQC-20260928-008--id-abcdef/work/aa/bb`,
  `36|RUNNING|   /data/runs/other/work/aa/bb`,
  `37|COMPLETED|   ${RUN}/work/cc/dd`,
].join('\n');

describe('leftover SLURM task jobs of a run', () => {
  it('picks only active jobs working under the run folder’s work directory', () => {
    // Not the run's own job (its WorkDir is the run folder), not a run whose folder name merely starts the same.
    expect(taskJobsOfRun(SQUEUE, RUN)).toEqual(['33', '34']);
    expect(taskJobsOfRun(SQUEUE, `${RUN}/`)).toEqual(['33', '34']);
    expect(taskJobsOfRun('', RUN)).toEqual([]);
  });

  it('scancels them in one call and survives a scheduler that does not answer', async () => {
    const calls: string[][] = [];
    const exec = async (file: string, args: string[]) => { calls.push([file, ...args]); return { stdout: file === 'squeue' ? SQUEUE : '' }; };
    await expect(cancelLeftoverSlurmTaskJobs(RUN, exec)).resolves.toEqual(['33', '34']);
    expect(calls).toEqual([['squeue', '--me', '-h', '-o', '%i|%T|%.1024Z'], ['scancel', '33', '34']]);

    const down = async () => { throw new Error('slurm_load_jobs error: Unable to contact slurm controller'); };
    await expect(cancelLeftoverSlurmTaskJobs(RUN, down)).resolves.toEqual([]);
    await expect(cancelLeftoverSlurmTaskJobs(null, exec)).resolves.toEqual([]);
  });
});
