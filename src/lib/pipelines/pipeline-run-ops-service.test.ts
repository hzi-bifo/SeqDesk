import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const mocks = vi.hoisted(() => ({
  db: {
    user: {
      findFirst: vi.fn(),
    },
    pipelineRun: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    pipelineRunEvent: {
      findFirst: vi.fn(),
    },
    assembly: { count: vi.fn() },
    bin: { count: vi.fn() },
    pipelineArtifact: { count: vi.fn() },
  },
  getPipelineEnabled: vi.fn(),
  getAllPackages: vi.fn(),
  findTraceFile: vi.fn(),
  parseTraceFile: vi.fn(),
  inferPipelineExitCode: vi.fn(),
  processCompletedPipelineRun: vi.fn(),
  notifyPipelineRunTerminalInApp: vi.fn(),
  // child_process collaborators captured at module load.
  execFile: vi.fn(),
  spawn: vi.fn(),
  registry: {
    'study-pipe': {
      id: 'study-pipe',
      name: 'Study Pipe',
      description: 'Study scoped',
      input: {
        supportedScopes: ['study'],
      },
    },
    'order-pipe': {
      id: 'order-pipe',
      name: 'Order Pipe',
      description: 'Order scoped',
      input: {
        supportedScopes: ['order'],
      },
    },
  },
}));

vi.mock('child_process', () => ({
  // promisify(execFile) expects a node-style callback; route every call through
  // the controllable mock so queue-snapshot lookups can be steered per test.
  execFile: (
    file: string,
    args: readonly string[],
    _options: unknown,
    callback: (error: Error | null, result?: { stdout: string; stderr: string }) => void
  ) => mocks.execFile(file, args, callback),
  spawn: (...args: unknown[]) => mocks.spawn(...args),
}));

vi.mock('@/lib/db', () => ({
  db: mocks.db,
}));

vi.mock('@/lib/pipelines', () => ({
  PIPELINE_REGISTRY: mocks.registry,
}));

vi.mock('@/lib/pipelines/enablement', () => ({
  getPipelineEnabled: mocks.getPipelineEnabled,
}));

vi.mock('@/lib/pipelines/package-loader', () => ({
  getAllPackages: mocks.getAllPackages,
}));

vi.mock('@/lib/pipelines/nextflow', () => ({
  findTraceFile: mocks.findTraceFile,
  parseTraceFile: mocks.parseTraceFile,
}));

vi.mock('@/lib/pipelines/run-completion', () => ({
  inferPipelineExitCode: mocks.inferPipelineExitCode,
  processCompletedPipelineRun: mocks.processCompletedPipelineRun,
}));

vi.mock('@/lib/notifications/in-app', () => ({
  notifyPipelineRunTerminalInApp: mocks.notifyPipelineRunTerminalInApp,
}));

import {
  cancelPipelineRunForOperator,
  listPipelineCatalogForOperator,
  resolvePipelineOperator,
  syncPipelineRunForOperator,
} from './pipeline-run-ops-service';

describe('pipeline run operator services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPipelineEnabled.mockResolvedValue(true);
    mocks.getAllPackages.mockReturnValue([]);
    mocks.notifyPipelineRunTerminalInApp.mockResolvedValue(undefined);
    mocks.processCompletedPipelineRun.mockResolvedValue(undefined);
    mocks.inferPipelineExitCode.mockResolvedValue(null);
    mocks.db.pipelineRun.update.mockResolvedValue({});
    mocks.db.pipelineRunEvent.findFirst.mockResolvedValue(null);
    mocks.db.assembly.count.mockResolvedValue(0);
    mocks.db.bin.count.mockResolvedValue(0);
    mocks.db.pipelineArtifact.count.mockResolvedValue(0);
    // Default: every queue probe (ps/squeue/sacct) returns no output.
    mocks.execFile.mockImplementation((_file, _args, callback) => {
      callback(null, { stdout: '', stderr: '' });
    });
  });

  it('uses the first facility admin when no user email is supplied', async () => {
    mocks.db.user.findFirst.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.org',
      role: 'FACILITY_ADMIN',
    });

    const result = await resolvePipelineOperator();

    expect(result.status).toBe(200);
    expect(mocks.db.user.findFirst).toHaveBeenCalledWith({
      where: { role: 'FACILITY_ADMIN' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });
    expect(result.body.user).toMatchObject({ id: 'admin-1' });
  });

  it('selects the requested facility admin by email', async () => {
    mocks.db.user.findFirst.mockResolvedValue({
      id: 'admin-2',
      email: 'ops@example.org',
      role: 'FACILITY_ADMIN',
    });

    const result = await resolvePipelineOperator('ops@example.org');

    expect(result.status).toBe(200);
    expect(mocks.db.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'ops@example.org', role: 'FACILITY_ADMIN' },
      })
    );
  });

  it('fails clearly when no facility admin exists', async () => {
    mocks.db.user.findFirst.mockResolvedValue(null);

    const result = await resolvePipelineOperator();

    expect(result.status).toBe(400);
    expect(result.body.error).toContain('No FACILITY_ADMIN user exists');
  });

  it('filters catalog entries by target type and enabled state', async () => {
    mocks.getPipelineEnabled.mockImplementation(async (pipelineId: string) =>
      pipelineId === 'study-pipe'
    );

    const result = await listPipelineCatalogForOperator({
      catalog: 'study',
      enabledOnly: true,
    });

    expect(result.status).toBe(200);
    expect(result.body.pipelines).toEqual([
      expect.objectContaining({
        id: 'study-pipe',
        enabled: true,
        catalog: { study: true, order: false },
      }),
    ]);
  });
});

describe('cancelPipelineRunForOperator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.pipelineRun.update.mockResolvedValue({});
  });

  it('returns 404 when the run does not exist', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue(null);

    const result = await cancelPipelineRunForOperator('missing');

    expect(result.status).toBe(404);
    expect(result.body.error).toBe('Run not found');
    expect(mocks.db.pipelineRun.update).not.toHaveBeenCalled();
  });

  it('refuses to cancel a run that already reached a terminal state', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'completed',
      queueJobId: null,
    });

    const result = await cancelPipelineRunForOperator('run-1');

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Cannot cancel a completed or failed run');
    expect(mocks.db.pipelineRun.update).not.toHaveBeenCalled();
  });

  it('kills the process group for a local job and marks it cancelled', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      queueJobId: 'local-4242',
    });
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

    const result = await cancelPipelineRunForOperator('run-1');

    expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGTERM');
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('cancelled');
    expect(mocks.db.pipelineRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({ status: 'cancelled', statusSource: 'manual' }),
      })
    );
    killSpy.mockRestore();
  });

  it('treats an already-dead local process group (ESRCH) as a clean cancel', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'queued',
      queueJobId: 'local-99',
    });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('no such process') as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    });

    const result = await cancelPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('cancelled');
    killSpy.mockRestore();
  });

  it('falls back to single-pid kill when group kill is unsupported (EPERM)', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      queueJobId: 'local-555',
    });
    const calls: Array<[number, string]> = [];
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      calls.push([pid as number, signal as string]);
      if ((pid as number) < 0) {
        const err = new Error('operation not permitted') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      return true;
    });

    const result = await cancelPipelineRunForOperator('run-1');

    expect(calls).toEqual([
      [-555, 'SIGTERM'],
      [555, 'SIGTERM'],
    ]);
    expect(result.body.status).toBe('cancelled');
    killSpy.mockRestore();
  });

  it('force-stops (failed) when the local job ID is not a valid pid', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      queueJobId: 'local-notapid',
    });

    const result = await cancelPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('failed');
    expect(mocks.db.pipelineRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  it('cancels a SLURM job when scancel exits 0', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      queueJobId: '123456',
    });
    mocks.spawn.mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
      proc.stderr = new EventEmitter();
      queueMicrotask(() => proc.emit('close', 0));
      return proc;
    });

    const result = await cancelPipelineRunForOperator('run-1');

    expect(mocks.spawn).toHaveBeenCalledWith('scancel', ['123456']);
    expect(result.body.status).toBe('cancelled');
  });

  it('force-stops when scancel fails for a SLURM job', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      queueJobId: '123456',
    });
    mocks.spawn.mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
      proc.stderr = new EventEmitter();
      queueMicrotask(() => {
        proc.stderr.emit('data', Buffer.from('job already finished'));
        proc.emit('close', 1);
      });
      return proc;
    });

    const result = await cancelPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('failed');
  });

  it('force-stops a running job that has no queue job ID', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      queueJobId: null,
    });

    const result = await cancelPipelineRunForOperator('run-1');

    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(result.body.status).toBe('failed');
  });

  it('cancels a pending job with no queue job ID without force-stopping', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'pending',
      queueJobId: null,
    });

    const result = await cancelPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('cancelled');
  });
});

describe('syncPipelineRunForOperator (no trace file)', () => {
  const baseRun = {
    id: 'run-1',
    runFolder: '/runs/run-1',
    status: 'queued',
    pipelineId: 'order-pipe',
    currentStep: 'Waiting for scheduler',
    startedAt: null,
    completedAt: null,
    lastEventAt: null,
    lastTraceAt: null,
    queueJobId: '123456',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.pipelineRun.update.mockResolvedValue({});
    mocks.notifyPipelineRunTerminalInApp.mockResolvedValue(undefined);
    mocks.processCompletedPipelineRun.mockResolvedValue(undefined);
    mocks.inferPipelineExitCode.mockResolvedValue(null);
    mocks.findTraceFile.mockResolvedValue(null);
  });

  // Drives readQueueSnapshot's squeue branch to return a specific state.
  const stubSqueueState = (state: string, reason = '') => {
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        callback(null, { stdout: `${state}|${reason}\n`, stderr: '' });
      } else {
        callback(new Error('no sacct'));
      }
    });
  };

  it('returns 404 when the run does not exist', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue(null);

    const result = await syncPipelineRunForOperator('missing');

    expect(result.status).toBe(404);
    expect(result.body.error).toBe('Run not found');
  });

  it('returns 400 when the run has no run folder', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...baseRun, runFolder: null });

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Run folder not set');
    expect(mocks.findTraceFile).not.toHaveBeenCalled();
  });

  it('promotes a queued run to running when SLURM reports it active', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...baseRun, status: 'queued' });
    stubSqueueState('RUNNING');

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('running');
    expect(result.body.synced).toBe(false);
    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(update.data).toMatchObject({
      status: 'running',
      currentStep: 'Running on compute node',
      statusSource: 'queue',
    });
  });

  it('keeps a pending run queued while SLURM reports PENDING', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...baseRun, status: 'pending' });
    stubSqueueState('PENDING', 'Priority');

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('queued');
    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(update.data).toMatchObject({
      status: 'queued',
      currentStep: 'Waiting for scheduler',
      queueStatus: 'PENDING',
      queueReason: 'Priority',
    });
  });

  it('finalizes a non-mag run as completed when SLURM reports COMPLETED', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...baseRun, status: 'running' });
    stubSqueueState('COMPLETED');

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('completed');
    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(update.data).toMatchObject({
      status: 'completed',
      progress: 100,
      currentStep: 'Completed',
    });
    // Non-mag completed runs still get post-completion processing once.
    expect(mocks.processCompletedPipelineRun).toHaveBeenCalledWith('run-1', 'order-pipe');
  });

  it('marks the run cancelled when SLURM reports a CANCELLED state', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...baseRun, status: 'running' });
    stubSqueueState('CANCELLED by 1000');

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('cancelled');
    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(update.data).toMatchObject({ status: 'cancelled', currentStep: 'Cancelled' });
    expect(mocks.processCompletedPipelineRun).not.toHaveBeenCalled();
  });

  it('marks the run failed when SLURM reports a TIMEOUT state', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...baseRun, status: 'running' });
    stubSqueueState('TIMEOUT');

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('failed');
    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(update.data).toMatchObject({ status: 'failed', currentStep: 'Failed' });
  });

  it('holds a mag run in finalizing when outputs are not yet materialized', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...baseRun,
      status: 'running',
      pipelineId: 'mag',
    });
    mocks.inferPipelineExitCode.mockResolvedValue(0);
    mocks.db.assembly.count.mockResolvedValue(0);
    mocks.db.bin.count.mockResolvedValue(0);
    mocks.db.pipelineArtifact.count.mockResolvedValue(0);
    stubSqueueState('COMPLETED');

    const result = await syncPipelineRunForOperator('run-1');

    expect(mocks.processCompletedPipelineRun).toHaveBeenCalledWith('run-1', 'mag');
    expect(result.body.status).toBe('running');
    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(update.data).toMatchObject({
      status: 'running',
      progress: 99,
      currentStep: 'Finalizing outputs...',
    });
  });

  it('completes a mag run once outputs are materialized', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...baseRun,
      status: 'running',
      pipelineId: 'mag',
    });
    mocks.db.assembly.count.mockResolvedValue(2);
    stubSqueueState('COMPLETED');

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('completed');
    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(update.data).toMatchObject({ status: 'completed', progress: 100 });
  });

  it('reports no change when there is no queue job and no trace', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...baseRun,
      status: 'running',
      queueJobId: null,
    });

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.synced).toBe(false);
    expect(result.body.status).toBe('running');
    // No status change => no DB update issued.
    expect(mocks.db.pipelineRun.update).not.toHaveBeenCalled();
  });
});
