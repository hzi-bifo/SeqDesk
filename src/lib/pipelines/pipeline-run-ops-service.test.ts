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
  finalizeCompletedPipelineRun: vi.fn(),
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
  finalizeCompletedPipelineRun: mocks.finalizeCompletedPipelineRun,
  processCompletedPipelineRun: mocks.processCompletedPipelineRun,
}));

vi.mock('@/lib/notifications/in-app', () => ({
  notifyPipelineRunTerminalInApp: mocks.notifyPipelineRunTerminalInApp,
}));

import {
  cancelPipelineRunForOperator,
  getPipelineRunDetailsForOperator,
  listPipelineCatalogForOperator,
  resolvePipelineOperator,
  syncPipelineRunForOperator,
} from './pipeline-run-ops-service';

function firstPipelineRunWrite(): { data: Record<string, unknown> } {
  const directCall = mocks.db.pipelineRun.update.mock.calls[0];
  const guardedCall = mocks.db.pipelineRun.updateMany.mock.calls[0];
  const directOrder =
    mocks.db.pipelineRun.update.mock.invocationCallOrder[0] ??
    Number.POSITIVE_INFINITY;
  const guardedOrder =
    mocks.db.pipelineRun.updateMany.mock.invocationCallOrder[0] ??
    Number.POSITIVE_INFINITY;
  const write =
    directOrder < guardedOrder ? directCall?.[0] : guardedCall?.[0];

  if (!write) {
    throw new Error('Expected a pipeline run write');
  }

  return write as { data: Record<string, unknown> };
}

describe('pipeline run operator services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPipelineEnabled.mockResolvedValue(true);
    mocks.getAllPackages.mockReturnValue([]);
    mocks.notifyPipelineRunTerminalInApp.mockResolvedValue(undefined);
    mocks.finalizeCompletedPipelineRun.mockResolvedValue('completed');
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

  it('exposes per-run read attribution for both order and study targets', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue(null);

    await getPipelineRunDetailsForOperator('run-1');

    const query = mocks.db.pipelineRun.findUnique.mock.calls[0][0];
    const studyReadSelect =
      query.include.study.select.samples.select.reads.select;
    const orderReadSelect =
      query.include.order.select.samples.select.reads.select;
    expect(studyReadSelect).toMatchObject({
      pipelineRunId: true,
      pipelineSources: true,
    });
    expect(orderReadSelect).toMatchObject({
      pipelineRunId: true,
      pipelineSources: true,
    });
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
  const stubLocalJobActive = (runFolder = '/runs/run-1') => {
    mocks.inferPipelineExitCode
      .mockResolvedValueOnce(null)
      .mockResolvedValue(143);
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'ps') {
        callback(null, {
          stdout: `bash ${runFolder}/run.sh\n`,
          stderr: '',
        });
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });
  };

  const stubSlurmJobActive = (runFolder = '/runs/run-1') => {
    let probeCount = 0;
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        probeCount += 1;
        callback(null, {
          stdout:
            `${probeCount === 1 ? 'RUNNING' : 'CANCELLED'}|None|` +
            `seqdesk-run-1|${runFolder}\n`,
          stderr: '',
        });
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.pipelineRun.update.mockResolvedValue({});
    mocks.inferPipelineExitCode.mockResolvedValue(null);
    mocks.execFile.mockImplementation((_file, _args, callback) => {
      callback(null, { stdout: '', stderr: '' });
    });
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
      runFolder: '/runs/run-1',
    });
    stubLocalJobActive();
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

    const result = await cancelPipelineRunForOperator('run-1');

    expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGTERM');
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('cancelled');
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledTimes(3);
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'run-1',
          status: { in: ['pending', 'queued', 'running'] },
        }),
        data: expect.objectContaining({
          statusSource: 'cancelling',
          currentStep: 'Cancelling...',
        }),
      })
    );
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'run-1',
          statusSource: 'cancelling',
          lastEventAt: expect.any(Date),
        }),
        data: expect.objectContaining({
          lastEventAt: expect.any(Date),
        }),
      })
    );
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'run-1',
          status: { in: ['pending', 'queued', 'running'] },
          statusSource: 'cancelling',
          lastEventAt: expect.any(Date),
        }),
        data: expect.objectContaining({ status: 'cancelled', statusSource: 'manual' }),
      })
    );
    const renewedAt =
      mocks.db.pipelineRun.updateMany.mock.calls[1]?.[0]?.data?.lastEventAt;
    expect(
      mocks.db.pipelineRun.updateMany.mock.calls[2]?.[0]?.where?.lastEventAt
    ).toBe(renewedAt);
    killSpy.mockRestore();
  });

  it('signals a job ID that the launcher persisted immediately before cancellation claimed', async () => {
    mocks.db.pipelineRun.findUnique
      .mockResolvedValueOnce({
        id: 'run-1',
        status: 'running',
        statusSource: 'launcher',
        queueJobId: null,
        runFolder: '/runs/run-1',
      })
      .mockResolvedValueOnce({
        id: 'run-1',
        status: 'running',
        statusSource: 'cancelling',
        queueJobId: 'local-777',
        runFolder: '/runs/run-1',
      });
    stubLocalJobActive();
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

    const result = await cancelPipelineRunForOperator('run-1');

    expect(killSpy).toHaveBeenCalledWith(-777, 'SIGTERM');
    expect(result.body.status).toBe('cancelled');
    killSpy.mockRestore();
  });

  it('treats an already-dead local process group (ESRCH) as a clean cancel', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'queued',
      queueJobId: 'local-99',
      runFolder: '/runs/run-1',
    });
    stubLocalJobActive();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('no such process') as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    });

    const result = await cancelPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('cancelled');
    killSpy.mockRestore();
  });

  it('refuses to signal a local PID when the run folder is missing', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      statusSource: 'launcher',
      currentStep: 'Running',
      queueJobId: 'local-4242',
      runFolder: null,
    });
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

    const result = await cancelPipelineRunForOperator('run-1');

    expect(result.status).toBe(409);
    expect(result.body.error).toContain('missing its run folder');
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it('requires the local run script to be an exact argv token', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      statusSource: 'launcher',
      currentStep: 'Running',
      queueJobId: 'local-4242',
      runFolder: '/runs/run-1',
    });
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'ps') {
        callback(null, {
          stdout:
            'bash /runs/run-1/run.sh.backup --note=/runs/run-1/run.sh\n',
          stderr: '',
        });
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

    const result = await cancelPipelineRunForOperator('run-1');

    expect(result.status).toBe(409);
    expect(result.body.error).toContain('another process');
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it('refuses to signal a local PID when ps returns blank arguments', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      statusSource: 'launcher',
      currentStep: 'Running',
      queueJobId: 'local-4242',
      runFolder: '/runs/run-1',
    });
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'ps') {
        callback(null, { stdout: '\n', stderr: '' });
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

    const result = await cancelPipelineRunForOperator('run-1');

    expect(result.status).toBe(409);
    expect(result.body.error).toContain('missing its process arguments');
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it('refuses to signal a local PID when ps cannot inspect it', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      statusSource: 'launcher',
      currentStep: 'Running',
      queueJobId: 'local-4242',
      runFolder: '/runs/run-1',
    });
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'ps') {
        const error = new Error(
          'operation not permitted'
        ) as NodeJS.ErrnoException;
        error.code = 'EPERM';
        callback(error);
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

    const result = await cancelPipelineRunForOperator('run-1');

    expect(result.status).toBe(409);
    expect(result.body.error).toContain('could not be inspected');
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it('keeps ps exit code 1 retryable without a canonical exit marker', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'queued',
      statusSource: 'launcher',
      queueJobId: 'local-4242',
      runFolder: '/runs/run-1',
    });
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'ps') {
        const error = new Error('process not found') as Error & {
          code: number;
        };
        error.code = 1;
        callback(error);
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

    const result = await cancelPipelineRunForOperator('run-1');

    expect(result.status).toBe(409);
    expect(result.body.status).toBe('queued');
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it('falls back to single-pid kill when group kill is unsupported (EPERM)', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      queueJobId: 'local-555',
      runFolder: '/runs/run-1',
    });
    stubLocalJobActive();
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

  it('refuses to signal when the local job ID cannot be verified', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      queueJobId: 'local-notapid',
      runFolder: '/runs/run-1',
    });

    const result = await cancelPipelineRunForOperator('run-1');

    expect(result.status).toBe(409);
    expect(result.body.status).toBe('running');
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'run-1',
          status: { in: ['pending', 'queued', 'running'] },
          statusSource: 'cancelling',
        }),
        data: expect.objectContaining({
          statusSource: 'manual',
          errorTail: expect.stringContaining('invalid'),
        }),
      })
    );
  });

  it('cancels a SLURM job when scancel exits 0', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      queueJobId: '123456',
      runFolder: '/runs/run-1',
    });
    stubSlurmJobActive();
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

  it('returns 409 and releases the claim when the exact job stays active', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      statusSource: 'launcher',
      currentStep: 'Running',
      queueJobId: '123456',
      runFolder: '/runs/run-1',
    });
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        callback(null, {
          stdout: 'COMPLETING|None|seqdesk-run-1|/runs/run-1\n',
          stderr: '',
        });
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });
    mocks.spawn.mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
      };
      proc.stderr = new EventEmitter();
      queueMicrotask(() => proc.emit('close', 0));
      return proc;
    });

    const result = await cancelPipelineRunForOperator('run-1', {
      queueWait: { timeoutMs: 0, pollIntervalMs: 0 },
    });

    expect(result.status).toBe(409);
    expect(result.body.error).toContain('timed out');
    const terminalWrite = mocks.db.pipelineRun.updateMany.mock.calls.find(
      (call) => call[0]?.data?.status === 'cancelled'
    );
    expect(terminalWrite).toBeUndefined();
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          statusSource: 'launcher',
          errorTail: expect.stringContaining('timed out'),
        }),
      })
    );
  });

  it('accepts an equivalent normalized SLURM work directory', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      queueJobId: '123456',
      runFolder: '/runs/run-1',
    });
    let probeCount = 0;
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        probeCount += 1;
        callback(null, {
          stdout:
            `${probeCount === 1 ? 'RUNNING' : 'CANCELLED'}|None|` +
            'seqdesk-run-1|/runs/other/../run-1/\n',
          stderr: '',
        });
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });
    mocks.spawn.mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
      };
      proc.stderr = new EventEmitter();
      queueMicrotask(() => proc.emit('close', 0));
      return proc;
    });

    const result = await cancelPipelineRunForOperator('run-1');

    expect(result.status).toBe(200);
    expect(mocks.spawn).toHaveBeenCalledWith('scancel', ['123456']);
  });

  it('leaves the run reconcilable when scancel fails', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      queueJobId: '123456',
      runFolder: '/runs/run-1',
    });
    stubSlurmJobActive();
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

    expect(result.status).toBe(409);
    expect(result.body.status).toBe('running');
    expect(result.body.error).toContain('remains active for reconciliation');
  });

  it('terminates a hung scancel child and releases the cancellation claim', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      statusSource: 'launcher',
      currentStep: 'Running on compute node',
      queueJobId: '123456',
      runFolder: '/runs/run-1',
    });
    stubSlurmJobActive();
    const childKill = vi.fn().mockReturnValue(true);
    mocks.spawn.mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
        kill: (signal: string) => boolean;
      };
      proc.stderr = new EventEmitter();
      proc.kill = childKill;
      // Deliberately emit neither close nor error.
      return proc;
    });

    const result = await cancelPipelineRunForOperator('run-1', {
      scancelTimeoutMs: 0,
    });

    expect(childKill).toHaveBeenCalledWith('SIGTERM');
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      status: 'running',
      statusSource: 'launcher',
    });
    expect(result.body.error).toContain('scancel timed out after 0ms');
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          statusSource: 'launcher',
          currentStep: 'Running on compute node',
          errorTail: expect.stringContaining('scancel timed out after 0ms'),
        }),
      })
    );
    const terminalWrite = mocks.db.pipelineRun.updateMany.mock.calls.find(
      (call) => call[0]?.data?.status === 'cancelled'
    );
    expect(terminalWrite).toBeUndefined();
  });

  it.each([
    {
      label: 'missing job name',
      snapshot: 'RUNNING|None||/runs/run-1\n',
      error: 'missing its job name',
    },
    {
      label: 'wrong job name',
      snapshot: 'RUNNING|None|seqdesk-another-run|/runs/run-1\n',
      error: 'another SeqDesk run',
    },
    {
      label: 'missing work directory',
      snapshot: 'RUNNING|None|seqdesk-run-1|\n',
      error: 'missing its work directory',
    },
    {
      label: 'wrong work directory',
      snapshot: 'RUNNING|None|seqdesk-run-1|/srv/another-job\n',
      error: 'another work directory',
    },
  ])(
    'refuses to scancel a SLURM ID with $label',
    async ({ snapshot, error }) => {
      mocks.db.pipelineRun.findUnique.mockResolvedValue({
        id: 'run-1',
        status: 'running',
        statusSource: 'launcher',
        currentStep: 'Running',
        queueJobId: '123456',
        runFolder: '/runs/run-1',
      });
      mocks.execFile.mockImplementation((file, _args, callback) => {
        if (file === 'squeue') {
          callback(null, {
            stdout: snapshot,
            stderr: '',
          });
          return;
        }
        callback(null, { stdout: '', stderr: '' });
      });

      const result = await cancelPipelineRunForOperator('run-1');

      expect(result.status).toBe(409);
      expect(result.body.error).toContain(error);
      expect(mocks.spawn).not.toHaveBeenCalled();
    }
  );

  it('refuses to scancel a SLURM ID when the run folder is missing', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      statusSource: 'launcher',
      currentStep: 'Running',
      queueJobId: '123456',
      runFolder: null,
    });

    const result = await cancelPipelineRunForOperator('run-1');

    expect(result.status).toBe(409);
    expect(result.body.error).toContain('missing its run folder');
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('verifies SLURM identity through sacct before scancelling', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      queueJobId: '123456',
      runFolder: '/runs/run-1',
    });
    let accountingProbeCount = 0;
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        callback(null, { stdout: '', stderr: '' });
        return;
      }
      if (file === 'sacct') {
        accountingProbeCount += 1;
        callback(null, {
          stdout:
            `123456|${accountingProbeCount === 1 ? 'RUNNING' : 'CANCELLED'}|` +
            'None|seqdesk-run-1|/runs/run-1||\n',
          stderr: '',
        });
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });
    mocks.spawn.mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
      };
      proc.stderr = new EventEmitter();
      queueMicrotask(() => proc.emit('close', 0));
      return proc;
    });

    const result = await cancelPipelineRunForOperator('run-1');

    expect(result.status).toBe(200);
    expect(mocks.spawn).toHaveBeenCalledWith('scancel', ['123456']);
    expect(mocks.execFile).toHaveBeenCalledWith(
      'sacct',
      expect.arrayContaining([
        '--format=JobID,State%32,Reason,JobName%128,WorkDir%1024,Elapsed,ExitCode',
      ]),
      expect.any(Function)
    );
  });

  it('rejects mismatched SLURM identity returned by sacct', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      queueJobId: '123456',
      runFolder: '/runs/run-1',
    });
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        callback(null, { stdout: '', stderr: '' });
        return;
      }
      if (file === 'sacct') {
        callback(null, {
          stdout:
            '123456|RUNNING|None|seqdesk-another-run|/runs/run-1\n',
          stderr: '',
        });
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });

    const result = await cancelPipelineRunForOperator('run-1');

    expect(result.status).toBe(409);
    expect(result.body.error).toContain('another SeqDesk run');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('keeps a running launch claim without a queue job ID retryable', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      statusSource: 'launcher',
      currentStep: 'Running on compute node',
      queueJobId: null,
    });

    const result = await cancelPipelineRunForOperator('run-1');

    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      status: 'running',
      statusSource: 'launcher',
    });
    expect(result.body.error).toContain('no queue job ID');
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          statusSource: 'launcher',
          currentStep: 'Running on compute node',
        }),
      })
    );
    const terminalWrite = mocks.db.pipelineRun.updateMany.mock.calls.find(
      (call) => call[0]?.data?.status === 'cancelled'
    );
    expect(terminalWrite).toBeUndefined();
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

  it('does not signal a job when completion wins the cancellation claim race', async () => {
    mocks.db.pipelineRun.findUnique
      .mockResolvedValueOnce({
        id: 'run-1',
        status: 'running',
        queueJobId: 'local-4242',
      })
      .mockResolvedValueOnce({ status: 'completed', statusSource: 'queue' });
    mocks.db.pipelineRun.updateMany.mockResolvedValueOnce({ count: 0 });
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

    const result = await cancelPipelineRunForOperator('run-1');

    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledTimes(1);
    expect(killSpy).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(result.body.status).toBe('completed');
    expect(result.body.alreadyFinalized).toBe(true);
    killSpy.mockRestore();
  });

  it.each(['finalizing', 'cancelling'])(
    'returns 409 when an active %s owner wins the initial cancellation claim',
    async (statusSource) => {
      mocks.db.pipelineRun.findUnique
        .mockResolvedValueOnce({
          id: 'run-1',
          status: 'queued',
          queueJobId: 'local-4242',
          runFolder: '/runs/run-1',
        })
        .mockResolvedValueOnce({
          status: 'queued',
          statusSource,
        });
      mocks.db.pipelineRun.updateMany.mockResolvedValueOnce({ count: 0 });
      const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

      const result = await cancelPipelineRunForOperator('run-1');

      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({
        status: 'queued',
        statusSource,
      });
      expect(result.body.alreadyFinalized).not.toBe(true);
      expect(mocks.execFile).not.toHaveBeenCalled();
      expect(killSpy).not.toHaveBeenCalled();
      expect(mocks.spawn).not.toHaveBeenCalled();
      killSpy.mockRestore();
    }
  );

  it('rereads and returns 409 when cancellation loses its renewal to an active owner', async () => {
    mocks.db.pipelineRun.findUnique
      .mockResolvedValueOnce({
        id: 'run-1',
        status: 'queued',
        statusSource: 'launcher',
        queueJobId: 'local-4242',
        runFolder: '/runs/run-1',
      })
      .mockResolvedValueOnce({
        id: 'run-1',
        status: 'queued',
        statusSource: 'cancelling',
        queueJobId: 'local-4242',
        runFolder: '/runs/run-1',
      })
      .mockResolvedValueOnce({
        status: 'queued',
        statusSource: 'finalizing',
      });
    mocks.db.pipelineRun.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

    const result = await cancelPipelineRunForOperator('run-1');

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      status: 'queued',
      statusSource: 'finalizing',
    });
    expect(mocks.db.pipelineRun.findUnique).toHaveBeenCalledTimes(3);
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(killSpy).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    killSpy.mockRestore();
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
    mocks.db.pipelineRun.updateMany.mockResolvedValue({ count: 1 });
    mocks.notifyPipelineRunTerminalInApp.mockResolvedValue(undefined);
    mocks.finalizeCompletedPipelineRun.mockResolvedValue('completed');
    mocks.processCompletedPipelineRun.mockResolvedValue(undefined);
    mocks.inferPipelineExitCode.mockResolvedValue(null);
    mocks.findTraceFile.mockResolvedValue(null);
  });

  // Drives readQueueSnapshot's squeue branch to return a specific state.
  const stubSqueueState = (state: string, reason = '') => {
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        callback(null, {
          stdout:
            `${state}|${reason}|seqdesk-run-1|/runs/run-1\n`,
          stderr: '',
        });
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
    const update = firstPipelineRunWrite();
    expect(update.data).toMatchObject({
      status: 'running',
      currentStep: 'Running on compute node',
      statusSource: 'queue',
    });
  });

  it('does not resurrect a cancellation that wins while active queue state is read', async () => {
    mocks.db.pipelineRun.findUnique
      .mockResolvedValueOnce({ ...baseRun, status: 'queued' })
      .mockResolvedValueOnce({ status: 'cancelled' });
    mocks.db.pipelineRun.updateMany.mockResolvedValue({ count: 0 });
    stubSqueueState('RUNNING');

    const result = await syncPipelineRunForOperator('run-1');

    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'run-1',
          status: { in: ['pending', 'queued', 'running'] },
        }),
        data: expect.objectContaining({ status: 'running' }),
      })
    );
    expect(mocks.db.pipelineRun.update).not.toHaveBeenCalled();
    expect(mocks.notifyPipelineRunTerminalInApp).not.toHaveBeenCalled();
    expect(result.body.status).toBe('cancelled');
  });

  it('keeps a pending run queued while SLURM reports PENDING', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...baseRun, status: 'pending' });
    stubSqueueState('PENDING', 'Priority');

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('queued');
    const update = firstPipelineRunWrite();
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
    expect(mocks.finalizeCompletedPipelineRun).toHaveBeenCalledWith(
      'run-1',
      'order-pipe',
      expect.objectContaining({
        completedAt: expect.any(Date),
        statusSource: 'queue',
        lastEventAt: expect.any(Date),
        queueStatus: 'COMPLETED',
        queueUpdatedAt: expect.any(Date),
      })
    );
    expect(mocks.processCompletedPipelineRun).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.update).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.updateMany).not.toHaveBeenCalled();
  });

  it('keeps a non-mag run retryable when output resolution fails at queue completion', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...baseRun, status: 'running' });
    mocks.finalizeCompletedPipelineRun.mockRejectedValue(new Error('summary not ready'));
    stubSqueueState('COMPLETED');

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('running');
    const update = firstPipelineRunWrite();
    expect(update.data).toMatchObject({
      status: 'running',
      progress: 99,
      currentStep: 'Finalizing outputs...',
    });
  });

  it('reprocesses outputs when an already-completed run is synced', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...baseRun,
      status: 'completed',
      completedAt: new Date('2026-03-03T11:00:00Z'),
    });
    mocks.findTraceFile.mockResolvedValue(null);

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('completed');
    expect(mocks.processCompletedPipelineRun).toHaveBeenCalledWith('run-1', 'order-pipe');
    expect(mocks.finalizeCompletedPipelineRun).not.toHaveBeenCalled();
  });

  it('marks the run cancelled when SLURM reports a CANCELLED state', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...baseRun, status: 'running' });
    stubSqueueState('CANCELLED by 1000');

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('cancelled');
    const update = firstPipelineRunWrite();
    expect(update.data).toMatchObject({ status: 'cancelled', currentStep: 'Cancelled' });
    expect(mocks.finalizeCompletedPipelineRun).not.toHaveBeenCalled();
    expect(mocks.processCompletedPipelineRun).not.toHaveBeenCalled();
  });

  it('marks the run failed when SLURM reports a TIMEOUT state', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...baseRun, status: 'running' });
    stubSqueueState('TIMEOUT');

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('failed');
    const update = firstPipelineRunWrite();
    expect(update.data).toMatchObject({ status: 'failed', currentStep: 'Failed' });
  });

  it('holds a mag run in finalizing when outputs are not yet materialized', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...baseRun,
      status: 'running',
      pipelineId: 'mag',
    });
    mocks.inferPipelineExitCode.mockResolvedValue(0);
    mocks.finalizeCompletedPipelineRun.mockRejectedValue(
      new Error('materialized outputs are not ready')
    );
    stubSqueueState('COMPLETED');

    const result = await syncPipelineRunForOperator('run-1');

    expect(mocks.finalizeCompletedPipelineRun).toHaveBeenCalledWith(
      'run-1',
      'mag',
      expect.objectContaining({ statusSource: 'queue' })
    );
    expect(mocks.processCompletedPipelineRun).not.toHaveBeenCalled();
    expect(result.body.status).toBe('running');
    const update = firstPipelineRunWrite();
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
    expect(mocks.finalizeCompletedPipelineRun).toHaveBeenCalledWith(
      'run-1',
      'mag',
      expect.objectContaining({ statusSource: 'queue' })
    );
    expect(mocks.db.pipelineRun.update).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.updateMany).not.toHaveBeenCalled();
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
    expect(mocks.finalizeCompletedPipelineRun).toHaveBeenCalledWith(
      'run-1',
      'order-pipe',
      expect.objectContaining({
        statusSource: 'queue',
        queueStatus: 'EXITED',
      })
    );
    expect(mocks.db.pipelineRun.update).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.updateMany).not.toHaveBeenCalled();
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
    expect(mocks.finalizeCompletedPipelineRun).toHaveBeenCalledWith(
      'run-1',
      'order-pipe',
      expect.objectContaining({
        statusSource: 'queue',
        queueStatus: 'EXITED',
      })
    );
    expect(mocks.db.pipelineRun.update).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.updateMany).not.toHaveBeenCalled();
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
    const update = firstPipelineRunWrite();
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
          stdout:
            '123456|COMPLETED|None|seqdesk-run-1|/runs/run-1\n',
          stderr: '',
        });
      } else {
        callback(null, { stdout: '', stderr: '' });
      }
    });

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('completed');
    expect(result.body.queueSource).toBe('sacct');
    expect(mocks.finalizeCompletedPipelineRun).toHaveBeenCalledWith(
      'run-1',
      'order-pipe',
      expect.objectContaining({
        statusSource: 'queue',
        queueStatus: 'COMPLETED',
      })
    );
  });

  it('continues holding a mag run running when post-completion processing throws', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...baseRun,
      status: 'running',
      pipelineId: 'mag',
    });
    mocks.finalizeCompletedPipelineRun.mockRejectedValue(
      new Error('processing exploded')
    );
    stubSqueueState('COMPLETED');

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).toBe('running');
    const update = firstPipelineRunWrite();
    expect(update.data).toMatchObject({ status: 'running', currentStep: 'Finalizing outputs...' });
  });

  it('does not apply stale queue data when centralized finalization loses its claim', async () => {
    mocks.db.pipelineRun.findUnique
      .mockResolvedValueOnce({ ...baseRun, status: 'running' })
      .mockResolvedValueOnce({ status: 'cancelled' });
    mocks.finalizeCompletedPipelineRun.mockResolvedValue('claim-unavailable');
    stubSqueueState('COMPLETED');

    const result = await syncPipelineRunForOperator('run-1');

    expect(mocks.finalizeCompletedPipelineRun).toHaveBeenCalledWith(
      'run-1',
      'order-pipe',
      expect.objectContaining({ statusSource: 'queue' })
    );
    expect(mocks.db.pipelineRun.update).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.updateMany).not.toHaveBeenCalled();
    expect(mocks.notifyPipelineRunTerminalInApp).not.toHaveBeenCalled();
    expect(result.body.status).toBe('cancelled');
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
    queueJobId: null,
  };

  // A minimal TraceResult builder. `order-pipe` has no package step defs, so
  // findStepByProcess returns null and getStepsForPipeline returns [], meaning
  // progress falls back to traceResult.overallProgress.
  const trace = (overrides: Partial<{
    tasks: Array<{
      process: string;
      tag?: string;
      taskId?: string;
      attempt?: number;
      status: string;
      exit?: number;
      submit?: Date;
      start?: Date;
      complete?: Date;
    }>;
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
    mocks.db.pipelineRun.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.pipelineRunStep.upsert.mockResolvedValue({});
    mocks.db.pipelineRunEvent.findFirst.mockResolvedValue(null);
    mocks.notifyPipelineRunTerminalInApp.mockResolvedValue(undefined);
    mocks.finalizeCompletedPipelineRun.mockResolvedValue('completed');
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
    const update = firstPipelineRunWrite();
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

    const update = firstPipelineRunWrite();
    // status is only written when it changes; it must NOT be flipped to running.
    expect(update.data.status).not.toBe('running');
    expect(update.data.completedAt ?? undefined).not.toBeNull();
  });

  it.each(['failed', 'cancelled'] as const)(
    'preserves an already-%s run when a later trace and exit marker look successful',
    async (status) => {
      const completedAt = new Date('2026-03-03T11:00:00Z');
      mocks.db.pipelineRun.findUnique.mockResolvedValue({
        ...traceRun,
        status,
        completedAt,
      });
      mocks.inferPipelineExitCode.mockResolvedValue(0);
      mocks.parseTraceFile.mockResolvedValue(
        trace({
          tasks: [
            {
              process: 'ALIGN',
              taskId: '1',
              attempt: 1,
              status: 'COMPLETED',
              exit: 0,
              complete: completedAt,
            },
          ],
          overallProgress: 100,
          completedAt,
        })
      );

      await syncPipelineRunForOperator('run-1');

      const update = firstPipelineRunWrite();
      expect(update.data.status).toBeUndefined();
      expect(update.data.currentStep).toBe(
        status === 'failed' ? 'Failed' : 'Cancelled'
      );
      expect(update.data.completedAt).toBeUndefined();
      expect(mocks.finalizeCompletedPipelineRun).not.toHaveBeenCalled();
      expect(mocks.processCompletedPipelineRun).not.toHaveBeenCalled();
    }
  );

  it('preserves a completed trace-backed run when best-effort output repair fails', async () => {
    const completedAt = new Date('2026-03-03T11:00:00Z');
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...traceRun,
      status: 'completed',
      completedAt,
    });
    mocks.inferPipelineExitCode.mockResolvedValue(0);
    mocks.processCompletedPipelineRun.mockRejectedValue(
      new Error('historical output was archived')
    );
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [
          {
            process: 'ALIGN',
            status: 'COMPLETED',
            complete: completedAt,
          },
        ],
        overallProgress: 100,
        completedAt,
      })
    );

    await syncPipelineRunForOperator('run-1');

    expect(mocks.processCompletedPipelineRun).toHaveBeenCalledWith(
      'run-1',
      'order-pipe'
    );
    const update = firstPipelineRunWrite();
    expect(update.data.status).not.toBe('running');
    expect(update.data.completedAt ?? completedAt).toEqual(completedAt);
  });

  it('completes the run when all trace tasks finished and the exit marker confirms success', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...traceRun,
      status: 'running',
    });
    // order-pipe has no step defs (totalSteps === 0), so a 100% trace alone is NOT proof of
    // completion (it is trivially 100% mid-run). A real finished run also has the wrapper's
    // canonical exit marker; that positive evidence is what finalizes it.
    mocks.inferPipelineExitCode.mockResolvedValue(0);
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [
          { process: 'ALIGN', status: 'COMPLETED', complete: new Date('2026-03-03T11:00:00Z') },
        ],
        overallProgress: 100,
        completedAt: new Date('2026-03-03T11:00:00Z'),
      })
    );

    await syncPipelineRunForOperator('run-1');

    expect(mocks.finalizeCompletedPipelineRun).toHaveBeenCalledWith(
      'run-1',
      'order-pipe',
      expect.objectContaining({
        completedAt: new Date('2026-03-03T11:00:00Z'),
        statusSource: 'queue',
        lastEventAt: new Date('2026-03-03T11:00:00Z'),
      })
    );
    expect(mocks.processCompletedPipelineRun).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.update).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.updateMany).not.toHaveBeenCalled();
  });

  it('does not apply stale trace data when centralized finalization loses its claim', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...traceRun,
      status: 'running',
    });
    mocks.inferPipelineExitCode.mockResolvedValue(0);
    mocks.finalizeCompletedPipelineRun.mockResolvedValue('claim-unavailable');
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [
          {
            process: 'ALIGN',
            status: 'COMPLETED',
            complete: new Date('2026-03-03T11:00:00Z'),
          },
        ],
        overallProgress: 100,
        completedAt: new Date('2026-03-03T11:00:00Z'),
      })
    );

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.synced).toBe(true);
    expect(mocks.finalizeCompletedPipelineRun).toHaveBeenCalledWith(
      'run-1',
      'order-pipe',
      expect.objectContaining({ statusSource: 'queue' })
    );
    expect(mocks.db.pipelineRun.update).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.updateMany).not.toHaveBeenCalled();
    expect(mocks.notifyPipelineRunTerminalInApp).not.toHaveBeenCalled();
  });

  it('treats a successful retry as completion instead of preserving the failed attempt', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...traceRun,
      status: 'running',
    });
    mocks.getStepsForPipeline.mockReturnValue([
      { id: 'align', name: 'Align' },
    ]);
    mocks.findStepByProcess.mockReturnValue({
      id: 'align',
      name: 'Align',
    });
    mocks.inferPipelineExitCode.mockResolvedValue(0);
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [
          {
            process: 'ALIGN',
            tag: 'sample-1',
            taskId: '1',
            attempt: 1,
            status: 'FAILED',
            exit: 1,
            complete: new Date('2026-03-03T10:59:00Z'),
          },
          {
            process: 'ALIGN',
            tag: 'sample-1',
            taskId: '2',
            attempt: 2,
            status: 'COMPLETED',
            exit: 0,
            complete: new Date('2026-03-03T11:00:00Z'),
          },
        ],
        overallProgress: 100,
        completedAt: new Date('2026-03-03T11:00:00Z'),
      })
    );

    await syncPipelineRunForOperator('run-1');

    expect(mocks.db.pipelineRunStep.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: 'completed' }),
      })
    );
    expect(mocks.finalizeCompletedPipelineRun).toHaveBeenCalledWith(
      'run-1',
      'order-pipe',
      expect.objectContaining({
        completedAt: new Date('2026-03-03T11:00:00Z'),
        statusSource: 'trace',
      })
    );
    expect(mocks.db.pipelineRun.update).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'blank', tag: undefined },
    { label: 'reused', tag: 'same-sample' },
  ])(
    'does not let a completed $label-tag sibling hide a failed task',
    async ({ tag }) => {
      mocks.db.pipelineRun.findUnique.mockResolvedValue({
        ...traceRun,
        status: 'running',
      });
      mocks.getStepsForPipeline.mockReturnValue([
        { id: 'align', name: 'Align' },
      ]);
      mocks.findStepByProcess.mockReturnValue({
        id: 'align',
        name: 'Align',
      });
      mocks.inferPipelineExitCode.mockResolvedValue(0);
      mocks.parseTraceFile.mockResolvedValue(
        trace({
          tasks: [
            {
              process: 'ALIGN',
              tag,
              taskId: '1',
              attempt: 1,
              status: 'FAILED',
              exit: 1,
            },
            {
              process: 'ALIGN',
              tag,
              taskId: '2',
              attempt: 1,
              status: 'COMPLETED',
              exit: 0,
            },
          ],
          overallProgress: 50,
        })
      );

      await syncPipelineRunForOperator('run-1');

      expect(mocks.db.pipelineRunStep.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'failed' }),
        })
      );
      expect(firstPipelineRunWrite()).toEqual(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            currentStep: 'Failed',
          }),
        })
      );
      expect(mocks.processCompletedPipelineRun).not.toHaveBeenCalled();
    }
  );

  it('lets a non-zero workflow exit override an otherwise completed trace', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...traceRun,
      status: 'running',
    });
    mocks.getStepsForPipeline.mockReturnValue([
      { id: 'align', name: 'Align' },
    ]);
    mocks.findStepByProcess.mockReturnValue({
      id: 'align',
      name: 'Align',
    });
    mocks.inferPipelineExitCode.mockResolvedValue(2);
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [
          {
            process: 'ALIGN',
            taskId: '1',
            attempt: 1,
            status: 'COMPLETED',
            exit: 0,
          },
        ],
        overallProgress: 100,
      })
    );

    await syncPipelineRunForOperator('run-1');

    expect(firstPipelineRunWrite()).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          currentStep: 'Failed',
        }),
      })
    );
    expect(mocks.processCompletedPipelineRun).not.toHaveBeenCalled();
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

    const update = firstPipelineRunWrite();
    expect(update.data).toMatchObject({ status: 'failed', currentStep: 'Failed' });
    expect(result.body.synced).toBe(true);
  });

  it('keeps a trace failure retryable while the stored SLURM identity is unverified', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...traceRun,
      status: 'running',
      queueJobId: '123456',
    });
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        callback(null, {
          stdout:
            'FAILED|None|seqdesk-another-run|/runs/run-1\n',
          stderr: '',
        });
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [
          {
            process: 'ALIGN',
            status: 'FAILED',
            exit: 1,
            complete: new Date('2026-03-03T11:30:00Z'),
          },
        ],
        overallProgress: 40,
      })
    );

    const result = await syncPipelineRunForOperator('run-1');

    const update = firstPipelineRunWrite();
    expect(update.data).toMatchObject({
      currentStep: 'Waiting for scheduler confirmation...',
      statusSource: 'queue',
      completedAt: null,
    });
    expect(update.data.status).toBeUndefined();
    expect(mocks.finalizeCompletedPipelineRun).not.toHaveBeenCalled();
    expect(mocks.notifyPipelineRunTerminalInApp).not.toHaveBeenCalledWith(
      'run-1',
      'running',
      'failed'
    );
    expect(result.body.synced).toBe(true);
  });

  it('does not hide a trace task failure when the wrapper job reports COMPLETED', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...traceRun,
      status: 'running',
      queueJobId: '123456',
    });
    // Trace says failed, but the scheduler insists the job COMPLETED cleanly.
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        callback(null, {
          stdout:
            'COMPLETED||seqdesk-run-1|/runs/run-1\n',
          stderr: '',
        });
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

    const update = firstPipelineRunWrite();
    expect(update.data).toMatchObject({ status: 'failed', statusSource: 'trace' });
    expect(result.body.synced).toBe(true);
  });

  it('forces the run back to running when the queue is still active despite a completed trace', async () => {
    // Start from "queued" so the forced status change is recorded in updateData.
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...traceRun,
      status: 'queued',
      queueJobId: '123456',
    });
    // order-pipe has no step defs, so the exit marker (not the 100% trace alone) is what
    // would finalize it — forceRunningFromQueue must then still demote it while the queue is active.
    mocks.inferPipelineExitCode.mockResolvedValue(0);
    // Queue still RUNNING -> forceRunningFromQueue path.
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        callback(null, {
          stdout:
            'RUNNING||seqdesk-run-1|/runs/run-1\n',
          stderr: '',
        });
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

    const update = firstPipelineRunWrite();
    expect(update.data).toMatchObject({ status: 'running', statusSource: 'queue' });
    expect(update.data.completedAt).toBeNull();
    expect(result.body.synced).toBe(true);
  });

  it('keeps an already-completed run completed when the trace is finished and only the wrapper job lingers', async () => {
    // Regression: forceRunningFromQueue must NOT demote a run that was ALREADY completed
    // when the trace shows the work is finished (overallProgress 100, no running task) and
    // only the SEQDESK_SLURM_INLINE_EXECUTOR wrapper job is momentarily still active. The
    // defined-step accounting (getStepsForPipeline) not name-matching the trace task list
    // must not, on its own, un-complete a finished run. Surfaced by metaxpath + reads-qc,
    // whose trace task names don't all map to package step defs (traceCompletedKnownWork
    // is false even at 100%).
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...traceRun,
      status: 'completed',
      queueJobId: '123456',
      completedAt: new Date('2026-03-03T11:00:00Z'),
    });
    // Defined steps the trace task names don't match => completedKnownSteps < totalSteps
    // => traceCompletedKnownWork is false even though the workflow is at 100%.
    mocks.getStepsForPipeline.mockReturnValue([
      { id: 'STEP_A', name: 'Step A' },
      { id: 'STEP_B', name: 'Step B' },
    ]);
    // Scheduler still reports the wrapper job RUNNING (queueIsActive = true).
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        callback(null, {
          stdout:
            'RUNNING||seqdesk-run-1|/runs/run-1\n',
          stderr: '',
        });
      } else {
        callback(new Error('no sacct'));
      }
    });
    // Trace: every task COMPLETED, overall 100, nothing running.
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [{ process: 'CLASSIFY', status: 'COMPLETED', complete: new Date('2026-03-03T11:00:00Z') }],
        overallProgress: 100,
      })
    );

    await syncPipelineRunForOperator('run-1');

    const update = firstPipelineRunWrite();
    // Must stay completed: status not flipped to running, completedAt preserved.
    expect(update?.data?.status).not.toBe('running');
    expect(update?.data?.completedAt ?? undefined).not.toBeNull();
  });

  it('holds a completed mag trace run running when materialized outputs are empty', async () => {
    // Start from "queued" so the demotion to running is recorded in updateData.
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...traceRun,
      status: 'queued',
      pipelineId: 'mag',
    });
    // No step defs mocked (totalSteps === 0), so the exit marker is what finalizes the trace
    // run; the mag output-materialization guard then holds it in running until outputs exist.
    mocks.inferPipelineExitCode.mockResolvedValue(0);
    mocks.finalizeCompletedPipelineRun.mockRejectedValue(
      new Error('materialized outputs are not ready')
    );
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [{ process: 'ASSEMBLY', status: 'COMPLETED', complete: new Date() }],
        overallProgress: 100,
      })
    );

    const result = await syncPipelineRunForOperator('run-1');

    expect(mocks.finalizeCompletedPipelineRun).toHaveBeenCalledWith(
      'run-1',
      'mag',
      expect.objectContaining({ statusSource: 'queue' })
    );
    expect(mocks.processCompletedPipelineRun).not.toHaveBeenCalled();
    const update = firstPipelineRunWrite();
    // No outputs => demoted back to running/finalizing.
    expect(update.data.status).toBe('running');
    expect(result.body.synced).toBe(true);
  });

  it('does NOT complete a no-step-def run on a trivially-100% trace without exit evidence', async () => {
    // Regression (metaxpath conda-gap false completion): metaxpath has no package step defs
    // (totalSteps === 0) and builds a per-process conda env after INPUT_CHECK. In that gap the
    // trace holds a single COMPLETED task, so overallProgress is trivially 100 while the
    // workflow is still going and no exit marker exists yet. The run must STAY running — not
    // finalize as completed via the trace (statusSource=trace), which is what shipped before.
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...traceRun,
      status: 'running',
      queueJobId: '123456',
    });
    mocks.getStepsForPipeline.mockReturnValue([]); // private pipeline: full DAG unknown
    mocks.inferPipelineExitCode.mockResolvedValue(null); // no canonical exit marker yet
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [{ process: 'INPUT_CHECK', status: 'COMPLETED', complete: new Date('2026-03-03T10:00:00Z') }],
        overallProgress: 100,
      })
    );

    const result = await syncPipelineRunForOperator('run-1');

    expect(result.body.status).not.toBe('completed');
    const update = firstPipelineRunWrite();
    expect(update?.data?.status).not.toBe('completed');
    expect(update?.data?.completedAt ?? undefined).toBeUndefined();
  });

  it('completes a no-step-def run once the canonical exit marker reports success', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...traceRun, status: 'running' });
    mocks.getStepsForPipeline.mockReturnValue([]);
    mocks.inferPipelineExitCode.mockResolvedValue(0); // wrapper exited 0 -> real completion
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [
          { process: 'INPUT_CHECK', status: 'COMPLETED' },
          { process: 'CLASSIFY', status: 'COMPLETED', complete: new Date('2026-03-03T11:00:00Z') },
        ],
        overallProgress: 100,
        completedAt: new Date('2026-03-03T11:00:00Z'),
      })
    );

    await syncPipelineRunForOperator('run-1');

    expect(mocks.finalizeCompletedPipelineRun).toHaveBeenCalledWith(
      'run-1',
      'order-pipe',
      expect.objectContaining({
        completedAt: new Date('2026-03-03T11:00:00Z'),
        statusSource: 'queue',
      })
    );
    expect(mocks.db.pipelineRun.update).not.toHaveBeenCalled();
    expect(mocks.db.pipelineRun.updateMany).not.toHaveBeenCalled();
  });

  it('fails a no-step-def run when the canonical exit marker reports a non-zero code', async () => {
    // fix: a non-zero marker is authoritative failure even with no failed trace task (e.g. the
    // per-process conda env build failed before any task ran) — the run must not hang in running.
    mocks.db.pipelineRun.findUnique.mockResolvedValue({ ...traceRun, status: 'running' });
    mocks.getStepsForPipeline.mockReturnValue([]);
    mocks.inferPipelineExitCode.mockResolvedValue(127);
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [{ process: 'INPUT_CHECK', status: 'COMPLETED' }],
        overallProgress: 100,
      })
    );

    await syncPipelineRunForOperator('run-1');

    const update = firstPipelineRunWrite();
    expect(update.data).toMatchObject({ status: 'failed', currentStep: 'Failed' });
  });

  it('demotes a falsely-completed LOCAL run with no exit marker while its PID is alive', async () => {
    // metaxpath false-completion: a local run was marked completed while only INPUT_CHECK had
    // run (trace 1/1 = 100% trivially) and Nextflow is still building conda. With the local PID
    // alive and NO canonical exit marker, the run has outstanding work and must be demoted back
    // to running — overallProgress=100 from a single early task is not proof of completion.
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...traceRun,
      status: 'completed',
      completedAt: new Date('2026-03-03T11:00:00Z'),
      queueJobId: 'local-4242',
    });
    mocks.getStepsForPipeline.mockReturnValue([]);
    mocks.inferPipelineExitCode.mockResolvedValue(null); // no marker -> run.sh still running
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'ps') {
        callback(null, {
          stdout: 'bash /runs/run-1/run.sh\n',
          stderr: '',
        });
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [{ process: 'INPUT_CHECK', status: 'COMPLETED', complete: new Date('2026-03-03T10:00:00Z') }],
        overallProgress: 100,
      })
    );

    await syncPipelineRunForOperator('run-1');

    const update = firstPipelineRunWrite();
    expect(update.data).toMatchObject({ status: 'running' });
    expect(update.data.completedAt).toBeNull();
  });

  it('does not resurrect a completed LOCAL run when its PID was recycled', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...traceRun,
      status: 'completed',
      completedAt: new Date('2026-03-03T11:00:00Z'),
      queueJobId: 'local-4242',
    });
    mocks.getStepsForPipeline.mockReturnValue([]);
    mocks.inferPipelineExitCode.mockResolvedValue(null);
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'ps') {
        callback(null, {
          stdout: 'node /srv/unrelated-worker.js\n',
          stderr: '',
        });
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [{ process: 'INPUT_CHECK', status: 'COMPLETED' }],
        overallProgress: 100,
      })
    );

    await syncPipelineRunForOperator('run-1');

    const update = firstPipelineRunWrite();
    expect(update.data.status).not.toBe('running');
    expect(update.data.completedAt).not.toBeNull();
  });

  it('keeps a completed LOCAL run completed once its exit marker exists (PID may linger)', async () => {
    // Counterpart: a genuinely finished local run HAS the canonical marker, so even if the PID
    // briefly lingers it must stay completed (no demotion).
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...traceRun,
      status: 'completed',
      completedAt: new Date('2026-03-03T11:00:00Z'),
      queueJobId: 'local-4242',
    });
    mocks.getStepsForPipeline.mockReturnValue([]);
    mocks.inferPipelineExitCode.mockResolvedValue(0); // marker present -> genuinely finished
    mocks.parseTraceFile.mockResolvedValue(
      trace({
        tasks: [{ process: 'INPUT_CHECK', status: 'COMPLETED', complete: new Date('2026-03-03T10:00:00Z') }],
        overallProgress: 100,
      })
    );

    await syncPipelineRunForOperator('run-1');

    const update = firstPipelineRunWrite();
    expect(update?.data?.status).not.toBe('running');
    expect(update?.data?.completedAt ?? undefined).not.toBeNull();
  });

  it('marks a trace run cancelled when the queue reports CANCELLED and no task runs', async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      ...traceRun,
      status: 'running',
      queueJobId: '123456',
    });
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        callback(null, {
          stdout:
            'CANCELLED||seqdesk-run-1|/runs/run-1\n',
          stderr: '',
        });
      } else {
        callback(new Error('no sacct'));
      }
    });
    // No tasks => hasRunning false, nextStatus stays queued until queue forces cancel.
    mocks.parseTraceFile.mockResolvedValue(trace({ tasks: [], overallProgress: 0 }));

    const result = await syncPipelineRunForOperator('run-1');

    const update = firstPipelineRunWrite();
    expect(update.data).toMatchObject({ status: 'cancelled', currentStep: 'Cancelled' });
    expect(update.data.completedAt).toBeTruthy();
    expect(result.body.synced).toBe(true);
  });
});
