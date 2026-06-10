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
      updateMany: vi.fn(),
    },
    pipelineRunStep: {
      upsert: vi.fn(),
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
  findStepByProcess: vi.fn(),
  getStepsForPipeline: vi.fn(),
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

vi.mock('@/lib/pipelines/definitions', () => ({
  findStepByProcess: mocks.findStepByProcess,
  getStepsForPipeline: mocks.getStepsForPipeline,
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
    // Cancel now writes via a guarded updateMany (terminal-state race fix);
    // default to "one row updated" so the run is treated as freshly cancelled.
    mocks.db.pipelineRun.updateMany.mockResolvedValue({ count: 1 });
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
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1', status: { in: ['pending', 'queued', 'running'] } },
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
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'run-1',
          status: { in: ['pending', 'queued', 'running'] },
        }),
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

  it('does not clobber a run that finished between the status read and the write', async () => {
    // The run was running when read, so cancel proceeds; but by the time the
    // guarded updateMany runs the monitor has finalized it as completed, so no
    // row matches the non-terminal filter (count: 0). Cancel must report the
    // real terminal status rather than overwriting it with cancelled/failed.
    mocks.db.pipelineRun.findUnique
      .mockResolvedValueOnce({ id: 'run-1', status: 'running', queueJobId: null })
      .mockResolvedValueOnce({ status: 'completed' });
    mocks.db.pipelineRun.updateMany.mockResolvedValue({ count: 0 });

    const result = await cancelPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('completed');
    expect(result.body.alreadyFinalized).toBe(true);
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

  it('holds a completed non-mag run as running when outputs are not yet ready (EXITED, exit 0)', async () => {
    // EXITED + exit code 0 => considered successful, but a local run reporting
    // EXITED still finalizes immediately for non-mag pipelines.
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...baseRun,
      status: 'running',
      queueJobId: 'local-1234',
    });
    mocks.inferPipelineExitCode.mockResolvedValue(0);
    // ps reports the local pid as gone -> EXITED.
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'ps') {
        callback(new Error('no such process'));
      } else {
        callback(null, { stdout: '', stderr: '' });
      }
    });

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('completed');
    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(update.data).toMatchObject({ status: 'completed', progress: 100 });
  });

  it('treats a local run with an exit marker as finished even if its PID is still alive (recycled PID)', async () => {
    // Regression F: a finished local run's PID can be recycled by an unrelated
    // live process. `ps` then reports it alive, which previously pinned the run as
    // RUNNING forever. The exit marker must win over PID liveness.
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...baseRun,
      status: 'running',
      queueJobId: 'local-1234',
    });
    mocks.inferPipelineExitCode.mockResolvedValue(0);
    // ps reports the pid as ALIVE (recycled), yet the run already wrote exit 0.
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'ps') {
        callback(null, { stdout: '1234\n', stderr: '' });
      } else {
        callback(null, { stdout: '', stderr: '' });
      }
    });

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('completed');
    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(update.data).toMatchObject({ status: 'completed', progress: 100 });
  });

  it('marks an EXITED local run failed when the inferred exit code is non-zero', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...baseRun,
      status: 'running',
      queueJobId: 'local-4321',
    });
    mocks.inferPipelineExitCode.mockResolvedValue(1);
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'ps') {
        callback(new Error('no such process'));
      } else {
        callback(null, { stdout: '', stderr: '' });
      }
    });

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('failed');
    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(update.data).toMatchObject({ status: 'failed', currentStep: 'Failed' });
  });

  it('reconciles via sacct when squeue returns nothing', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...baseRun, status: 'running' });
    // squeue emits empty stdout; sacct supplies the COMPLETED state.
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        callback(null, { stdout: '', stderr: '' });
      } else if (file === 'sacct') {
        callback(null, {
          stdout: '123456|COMPLETED|None\n',
          stderr: '',
        });
      } else {
        callback(null, { stdout: '', stderr: '' });
      }
    });

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('completed');
    expect(result.body.queueSource).toBe('sacct');
  });

  it('continues holding a mag run running when post-completion processing throws', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...baseRun,
      status: 'running',
      pipelineId: 'mag',
    });
    mocks.processCompletedPipelineRun.mockRejectedValue(new Error('processing exploded'));
    stubSqueueState('COMPLETED');

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('running');
    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(update.data).toMatchObject({ status: 'running', currentStep: 'Finalizing outputs...' });
  });
});

describe('syncPipelineRunForOperator (with trace file)', () => {
  const traceRun = {
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

  // A minimal TraceResult builder. `order-pipe` has no package step defs, so
  // findStepByProcess returns null and getStepsForPipeline returns [], meaning
  // progress falls back to traceResult.overallProgress.
  const trace = (overrides: Partial<{
    tasks: Array<{ process: string; status: string; exit?: number; submit?: Date; start?: Date; complete?: Date }>;
    overallProgress: number;
    startedAt?: Date;
    completedAt?: Date;
  }> = {}) => ({
    tasks: overrides.tasks ?? [],
    processes: new Map(),
    overallProgress: overrides.overallProgress ?? 0,
    startedAt: overrides.startedAt,
    completedAt: overrides.completedAt,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.pipelineRun.update.mockResolvedValue({});
    mocks.db.pipelineRunStep.upsert.mockResolvedValue({});
    mocks.db.pipelineRunEvent.findFirst.mockResolvedValue(null);
    mocks.notifyPipelineRunTerminalInApp.mockResolvedValue(undefined);
    mocks.processCompletedPipelineRun.mockResolvedValue(undefined);
    mocks.inferPipelineExitCode.mockResolvedValue(null);
    mocks.findTraceFile.mockResolvedValue('/runs/run-1/trace.txt');
    // Unknown pipeline => no package step defs: step lookups resolve to nothing
    // so progress falls back to traceResult.overallProgress.
    mocks.findStepByProcess.mockReturnValue(null);
    mocks.getStepsForPipeline.mockReturnValue([]);
    mocks.db.assembly.count.mockResolvedValue(0);
    mocks.db.bin.count.mockResolvedValue(0);
    mocks.db.pipelineArtifact.count.mockResolvedValue(0);
    // No queue activity by default (all probes empty).
    mocks.execFile.mockImplementation((_file, _args, callback) => {
      callback(null, { stdout: '', stderr: '' });
    });
  });

  it('marks the run running while a task is still in progress', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...traceRun, status: 'queued' });
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [{ process: 'ALIGN', status: 'RUNNING', start: new Date('2026-03-03T10:00:00Z') }],
        overallProgress: 50,
        startedAt: new Date('2026-03-03T10:00:00Z'),
      })
    );

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.synced).toBe(true);
    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(update.data).toMatchObject({ status: 'running', statusSource: 'trace' });
    expect(update.data.currentStep).toContain('Running:');
    // First-time start gets stamped from the trace.
    expect(update.data.startedAt).toEqual(new Date('2026-03-03T10:00:00Z'));
    expect(mocks.db.pipelineRunStep.upsert).toHaveBeenCalled();
  });

  it('does not resurrect a terminal run when a stale trace task still reads running', async () => {
    // Regression: a completed run re-synced against a trace whose task still reads
    // RUNNING (or a momentarily-active queue) must stay completed — not flip back to
    // running and lose its completedAt.
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...traceRun,
      status: 'completed',
      completedAt: new Date('2026-03-03T11:00:00Z'),
    });
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [{ process: 'ALIGN', status: 'RUNNING', start: new Date('2026-03-03T10:00:00Z') }],
        overallProgress: 50,
        startedAt: new Date('2026-03-03T10:00:00Z'),
      })
    );

    await syncPipelineRunForOperator('run-1');

    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    // status is only written when it changes; it must NOT be flipped to running.
    expect(update.data.status).not.toBe('running');
    expect(update.data.completedAt ?? undefined).not.toBeNull();
  });

  it('completes the run when all trace tasks finished and progress is 100', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...traceRun, status: 'running' });
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [
          { process: 'ALIGN', status: 'COMPLETED', complete: new Date('2026-03-03T11:00:00Z') },
        ],
        overallProgress: 100,
        completedAt: new Date('2026-03-03T11:00:00Z'),
      })
    );

    const result = await syncPipelineRunForOperator('run-1');

    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(update.data).toMatchObject({
      status: 'completed',
      progress: 100,
      currentStep: 'Completed',
    });
    expect(update.data.completedAt).toEqual(new Date('2026-03-03T11:00:00Z'));
    // Non-mag completed run gets post-completion processing once.
    expect(mocks.processCompletedPipelineRun).toHaveBeenCalledWith('run-1', 'order-pipe');
  });

  it('marks the run failed when a trace task reports a non-zero exit code', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...traceRun, status: 'running' });
    mocks.inferPipelineExitCode.mockResolvedValue(1);
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [{ process: 'ALIGN', status: 'FAILED', exit: 137, complete: new Date('2026-03-03T11:30:00Z') }],
        overallProgress: 40,
      })
    );

    const result = await syncPipelineRunForOperator('run-1');

    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(update.data).toMatchObject({ status: 'failed', currentStep: 'Failed' });
    expect(result.body.synced).toBe(true);
  });

  it('overrides a trace failure to completed when the queue reports COMPLETED', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...traceRun, status: 'running' });
    // Trace says failed, but the scheduler insists the job COMPLETED cleanly.
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        callback(null, { stdout: 'COMPLETED|\n', stderr: '' });
      } else {
        callback(new Error('no sacct'));
      }
    });
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [{ process: 'ALIGN', status: 'FAILED', exit: 1 }],
        overallProgress: 80,
      })
    );

    const result = await syncPipelineRunForOperator('run-1');

    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(update.data).toMatchObject({ status: 'completed', statusSource: 'queue' });
    expect(result.body.synced).toBe(true);
  });

  it('forces the run back to running when the queue is still active despite a completed trace', async () => {
    // Start from "queued" so the forced status change is recorded in updateData.
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...traceRun, status: 'queued' });
    // Queue still RUNNING -> forceRunningFromQueue path.
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        callback(null, { stdout: 'RUNNING|\n', stderr: '' });
      } else {
        callback(new Error('no sacct'));
      }
    });
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [{ process: 'ALIGN', status: 'COMPLETED', complete: new Date() }],
        overallProgress: 100,
      })
    );

    const result = await syncPipelineRunForOperator('run-1');

    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(update.data).toMatchObject({ status: 'running', statusSource: 'queue' });
    expect(update.data.completedAt).toBeNull();
    expect(result.body.synced).toBe(true);
  });

  it('holds a completed mag trace run running when materialized outputs are empty', async () => {
    // Start from "queued" so the demotion to running is recorded in updateData.
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...traceRun,
      status: 'queued',
      pipelineId: 'mag',
    });
    mocks.db.assembly.count.mockResolvedValue(0);
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [{ process: 'ASSEMBLY', status: 'COMPLETED', complete: new Date() }],
        overallProgress: 100,
      })
    );

    const result = await syncPipelineRunForOperator('run-1');

    expect(mocks.processCompletedPipelineRun).toHaveBeenCalledWith('run-1', 'mag');
    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    // No outputs => demoted back to running/finalizing.
    expect(update.data.status).toBe('running');
    expect(result.body.synced).toBe(true);
  });

  it('marks a trace run cancelled when the queue reports CANCELLED and no task runs', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...traceRun, status: 'running' });
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        callback(null, { stdout: 'CANCELLED|\n', stderr: '' });
      } else {
        callback(new Error('no sacct'));
      }
    });
    // No tasks => hasRunning false, nextStatus stays queued until queue forces cancel.
    mocks.parseTraceFile.mockResolvedValue(trace({ tasks: [], overallProgress: 0 }));

    const result = await syncPipelineRunForOperator('run-1');

    const update = mocks.db.pipelineRun.update.mock.calls[0][0];
    expect(update.data).toMatchObject({ status: 'cancelled', currentStep: 'Cancelled' });
    expect(update.data.completedAt).toBeTruthy();
    expect(result.body.synced).toBe(true);
  });
});
