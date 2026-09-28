import { describe, expect, it, vi } from 'vitest';

import { executorFor, type ExecutorDeps } from './executors';
import { reconcileRun } from './run-reconciler';

const trace = { derived: null, currentStep: null, progress: null, failuresAborted: false };
const deps = (over: Partial<ExecutorDeps> = {}): ExecutorDeps => ({
  snapshot: vi.fn(async () => ({ state: 'RUNNING', reason: null, source: 'squeue' as const, identityVerified: true })),
  waitingTaskReason: vi.fn(async () => null),
  endedTaskJob: vi.fn(async () => null),
  readTail: vi.fn(async () => null),
  cancelLeftovers: vi.fn(async () => []),
  ...over,
});

describe('one executor interface for this server and SLURM', () => {
  it('picks the executor from the run’s job id', () => {
    expect([executorFor({ queueJobId: '38' }).kind, executorFor({ queueJobId: 'local-4242' }).kind, executorFor({ queueJobId: null }).kind]).toEqual(['slurm', 'local', 'none']);
  });
  it('SLURM: a task job SLURM ended badly (real elektra OOM evidence) reaches the reconciler as “ended:memory”', async () => {
    const d = deps({
      endedTaskJob: vi.fn(async () => ({ jobId: '39', process: 'RUN_FASTQC', state: 'FAILED', exitCode: '0:9', workDir: '/runs/r/work/aa/bb' })),
      readTail: vi.fn(async () => 'slurmstepd: error: StepId=39.batch exceeded memory limit (6526939136 > 4294967296), being killed\nslurmstepd: error: Exceeded job memory limit'),
    });
    const evidence = await executorFor({ queueJobId: '38' }, d).evidence({ id: 'r', runFolder: '/runs/r', queueJobId: '38' });
    expect(evidence).toMatchObject({ slurm: true, endedTask: 'ended:memory:RUN_FASTQC' });
    expect(reconcileRun({ run: { status: 'running' }, trace, ...evidence }).queue).toEqual({ status: 'RUNNING', reason: 'ended:memory:RUN_FASTQC' });
  });
  it('local: the process snapshot only, and the same reconciler', async () => {
    const d = deps({ snapshot: vi.fn(async () => ({ state: 'EXITED', reason: null, source: 'local' as const, identityVerified: true, exitCode: 0, pid: 4242 })) });
    const evidence = await executorFor({ queueJobId: 'local-4242' }, d).evidence({ id: 'r', runFolder: '/runs/r', queueJobId: 'local-4242' });
    expect(evidence).toEqual({ scheduler: expect.objectContaining({ state: 'EXITED' }), slurm: false, waitingTaskReason: null, endedTask: null });
    expect(d.waitingTaskReason).not.toHaveBeenCalled();
    expect(reconcileRun({ run: { status: 'running' }, trace, ...evidence }).status).toBe('completed');
  });
  it('cleanup cancels SLURM task jobs; a local run has nothing left to clean', async () => {
    const d = deps();
    await executorFor({ queueJobId: '38' }, d).cleanup({ id: 'r', runFolder: '/runs/r', queueJobId: '38' });
    await executorFor({ queueJobId: 'local-1' }, d).cleanup({ id: 'r', runFolder: '/runs/r', queueJobId: 'local-1' });
    expect(d.cancelLeftovers).toHaveBeenCalledTimes(1);
  });
});
