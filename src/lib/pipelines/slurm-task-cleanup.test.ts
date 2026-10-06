import { describe, expect, it } from 'vitest';

import { cancelLeftoverSlurmTaskJobs, endedTaskJob, taskJobsOfRun, waitingTaskReason } from './slurm-task-cleanup';

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

  it('names why the run’s task jobs wait while none of them runs', () => {
    const drained = 'Nodes required for job are DOWN, DRAINED or reserved for jobs in higher priority partitions';
    expect(waitingTaskReason([`35|RUNNING|None|   ${RUN}`, `37|PENDING|${drained}|   ${RUN}/work/ac/841b18`].join('\n'), RUN)).toBe(drained);
    // One task running: nothing waits that the person needs to hear about. Other runs' tasks do not count.
    expect(waitingTaskReason([`37|PENDING|Resources|   ${RUN}/work/ac/84`, `38|RUNNING|None|   ${RUN}/work/fe/74`].join('\n'), RUN)).toBeNull();
    expect(waitingTaskReason(`39|PENDING|Resources|   /data/runs/other/work/aa/bb`, RUN)).toBeNull();
  });

  it('finds a task job SLURM ended badly that no later attempt replaced', () => {
    const lines = [`38|seqdesk-run|RUNNING|0:0|${RUN}`, `39|nf-RUN_FASTQC_(ERR1)|FAILED|0:9|${RUN}/work/aa/bb`];
    expect(endedTaskJob(lines.join('\n'), RUN)).toMatchObject({ jobId: '39', process: 'RUN_FASTQC', state: 'FAILED', exitCode: '0:9' });
    // Nextflow retried it: the retry runs, nothing to say.
    expect(endedTaskJob([...lines, `41|nf-RUN_FASTQC_(ERR1)|RUNNING|0:0|${RUN}/work/cc/dd`].join('\n'), RUN)).toBeNull();
    expect(endedTaskJob(`40|nf-X_(a)|OUT_OF_MEMORY|0:125|/data/runs/other/work/aa/bb`, RUN)).toBeNull();
  });

  it('after a Resume, task jobs the earlier attempt left ended are not news: only those after the run\'s own job count', () => {
    // Attempt 1: head 38 timed out, its FastQC task 39 was cancelled with it. Resume: head 45, nothing ended yet.
    const lines = [`38|seqdesk-run|TIMEOUT|0:0|${RUN}`, `39|nf-RUN_FASTQC_(ERR1)|CANCELLED by 504|0:15|${RUN}/work/aa/bb`, `45|seqdesk-run|RUNNING|0:0|${RUN}`];
    expect(endedTaskJob(lines.join('\n'), RUN)).toMatchObject({ jobId: '39' });
    expect(endedTaskJob(lines.join('\n'), RUN, '45')).toBeNull();
    expect(endedTaskJob([...lines, `46|nf-RUN_FASTQC_(ERR1)|OUT_OF_MEMORY|0:125|${RUN}/work/cc/dd`].join('\n'), RUN, '45')).toMatchObject({ jobId: '46', state: 'OUT_OF_MEMORY' });
  });
});
