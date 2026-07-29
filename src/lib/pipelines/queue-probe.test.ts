import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  inferPipelineExitCode: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: (
    file: string,
    args: readonly string[],
    _options: unknown,
    callback: (
      error: Error | null,
      result?: { stdout: string; stderr: string }
    ) => void
  ) => mocks.execFile(file, args, callback),
}));

vi.mock('@/lib/pipelines/run-completion', () => ({
  inferPipelineExitCode: mocks.inferPipelineExitCode,
}));

import {
  isActiveQueueState,
  isQueueSnapshotRetryable,
  queueSnapshotToRunStatus,
  readIdentityCheckedQueueSnapshot,
  waitForIdentityCheckedQueueTerminal,
} from './queue-probe';

describe('identity-checked queue probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inferPipelineExitCode.mockResolvedValue(null);
    mocks.execFile.mockImplementation((_file, _args, callback) => {
      callback(null, { stdout: '', stderr: '' });
    });
  });

  it('requires the exact local run.sh path as one argv token', async () => {
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

    const snapshot = await readIdentityCheckedQueueSnapshot({
      jobId: 'local-42',
      runId: 'run-1',
      runFolder: '/runs/run-1',
    });

    expect(snapshot.identityVerified).toBe(false);
    expect(snapshot.state).toBe('UNKNOWN');
    expect(snapshot.reason).toContain('another process');
  });

  it('accepts an exact local run.sh argv and reports it active', async () => {
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

    const snapshot = await readIdentityCheckedQueueSnapshot({
      jobId: 'local-42',
      runId: 'run-1',
      runFolder: '/runs/run-1',
    });

    expect(snapshot).toMatchObject({
      identityVerified: true,
      state: 'RUNNING',
      source: 'local',
      pid: 42,
    });
    expect(queueSnapshotToRunStatus(snapshot)).toBe('running');
  });

  it('uses the canonical local exit marker before inspecting a recycled PID', async () => {
    mocks.inferPipelineExitCode.mockResolvedValue(0);

    const snapshot = await readIdentityCheckedQueueSnapshot({
      jobId: 'local-42',
      runId: 'run-1',
      runFolder: '/runs/run-1',
    });

    expect(snapshot).toMatchObject({
      identityVerified: true,
      state: 'EXITED',
      exitCode: 0,
    });
    expect(queueSnapshotToRunStatus(snapshot)).toBe('completed');
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it.each(['CONFIGURING', 'COMPLETING', 'SUSPENDED', 'STAGE_OUT'])(
    'treats exact SLURM state %s as active',
    async (state) => {
      mocks.execFile.mockImplementation((file, _args, callback) => {
        if (file === 'squeue') {
          callback(null, {
            stdout:
              `123|cpu|seqdesk-run-1|runner|${state}|00:01|1|node-1|` +
              '/runs/run-1\n',
            stderr: '',
          });
          return;
        }
        callback(null, { stdout: '', stderr: '' });
      });

      const snapshot = await readIdentityCheckedQueueSnapshot({
        jobId: '123',
        runId: 'run-1',
        runFolder: '/runs/run-1',
      });

      expect(snapshot.identityVerified).toBe(true);
      expect(isActiveQueueState(snapshot.state)).toBe(true);
      expect(queueSnapshotToRunStatus(snapshot)).toBe(
        state === 'CONFIGURING' ? 'queued' : 'running'
      );
    }
  );

  it('rejects a recycled SLURM ID with a different exact job name', async () => {
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        callback(null, {
          stdout:
            '123|cpu|seqdesk-other-run|runner|RUNNING|00:01|1|node-1|' +
            '/runs/run-1\n',
          stderr: '',
        });
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });

    const snapshot = await readIdentityCheckedQueueSnapshot({
      jobId: '123',
      runId: 'run-1',
      runFolder: '/runs/run-1',
    });

    expect(snapshot.identityVerified).toBe(false);
    expect(isQueueSnapshotRetryable(snapshot)).toBe(true);
    expect(queueSnapshotToRunStatus(snapshot)).toBeNull();
  });

  it('verifies terminal accounting rows by exact job name and normalized WorkDir', async () => {
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        callback(null, { stdout: '', stderr: '' });
        return;
      }
      callback(null, {
        stdout:
          '123|COMPLETED|None|seqdesk-run-1|/runs/other/../run-1|00:10|0:0\n',
        stderr: '',
      });
    });

    const snapshot = await readIdentityCheckedQueueSnapshot({
      jobId: '123',
      runId: 'run-1',
      runFolder: '/runs/run-1',
    });

    expect(snapshot).toMatchObject({
      identityVerified: true,
      state: 'COMPLETED',
      source: 'sacct',
    });
    expect(queueSnapshotToRunStatus(snapshot)).toBe('completed');
  });

  it('keeps missing scheduler records unknown and retryable', async () => {
    const snapshot = await readIdentityCheckedQueueSnapshot({
      jobId: '123',
      runId: 'run-1',
      runFolder: '/runs/run-1',
    });

    expect(snapshot.state).toBe('UNKNOWN');
    expect(snapshot.identityVerified).toBe(false);
    expect(isQueueSnapshotRetryable(snapshot)).toBe(true);
  });

  it('waits until the same exact SLURM identity is terminal', async () => {
    let probeCount = 0;
    mocks.execFile.mockImplementation((file, _args, callback) => {
      if (file === 'squeue') {
        probeCount += 1;
        callback(null, {
          stdout:
            `123|cpu|seqdesk-run-1|runner|` +
            `${probeCount === 1 ? 'COMPLETING' : 'CANCELLED'}|` +
            '00:01|1|node-1|/runs/run-1\n',
          stderr: '',
        });
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });

    const result = await waitForIdentityCheckedQueueTerminal(
      {
        jobId: '123',
        runId: 'run-1',
        runFolder: '/runs/run-1',
      },
      { timeoutMs: 20, pollIntervalMs: 0 }
    );

    expect(result.outcome).toBe('terminal');
    expect(result.snapshot.state).toBe('CANCELLED');
  });
});
