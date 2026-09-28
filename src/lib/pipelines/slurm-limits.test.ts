import { describe, expect, it } from 'vitest';

import { needsInlineSlurm, slurmJobSlots, type LimitExec } from './slurm-limits';

// As Slurm 24.11 on elektra answered with MaxJobs=1 set on the user and AccountingStorageEnforce=associations,limits.
const answers = (enforce: string, assoc: string, qos = ''): LimitExec => async (file, args) => {
  if (file === 'scontrol') return { stdout: `AccountingStorageEnforce = ${enforce}\nClusterName = seqdesk-test\n` };
  if (args.includes('assoc')) return { stdout: assoc };
  if (args.includes('qos')) return { stdout: qos };
  throw new Error('unexpected');
};

describe('how many jobs SLURM lets this server have', () => {
  it('reads the association and QOS limits when they are enforced', async () => {
    expect(await slurmJobSlots(answers('associations,limits', '1||||normal\n'), 'pmuench')).toBe(1);
    expect(await slurmJobSlots(answers('associations,limits', '||||normal\n', '4|10||\n'), 'pmuench')).toBe(4);
    expect(await slurmJobSlots(answers('associations,limits', '||||\n'), 'pmuench')).toBeNull();
  });
  it('ignores limits SLURM does not enforce, and a SLURM that does not answer', async () => {
    expect(await slurmJobSlots(answers('none', '1||||normal\n'), 'pmuench')).toBeNull();
    expect(await slurmJobSlots(async () => { throw new Error('sacctmgr: error: Problem talking to the database'); }, 'pmuench')).toBeNull();
  });
  it('one slot means the run keeps its steps in its own job', () => {
    expect([needsInlineSlurm(1), needsInlineSlurm(2), needsInlineSlurm(null)]).toEqual([true, false, false]);
  });
});
