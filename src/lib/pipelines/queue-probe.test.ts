import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  options: [] as unknown[],
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
  ) => { mocks.options.push(_options); return mocks.execFile(file, args, callback); },
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

  it('a resumed local run is verified by the script the Resume started, not only run.sh', async () => {
    // Regression (Mac local run): Resume starts `bash <run folder>/run.resume-N.sh`, which the probe called "another
    // process", so the monitor lost track of the resumed run.
    mocks.inferPipelineExitCode.mockResolvedValue(null);
    mocks.execFile.mockImplementation((file, _args, callback) => {
      callback(null, { stdout: file === 'ps' ? 'bash /runs/run-1/run.resume-2.sh\n' : '', stderr: '' });
    });
    const snapshot = await readIdentityCheckedQueueSnapshot({ jobId: 'local-42', runId: 'run-1', runFolder: '/runs/run-1' });
    expect(snapshot).toMatchObject({ identityVerified: true, state: 'RUNNING', source: 'local', pid: 42 });
    // Another run's resume script is still another process.
    mocks.execFile.mockImplementation((file, _args, callback) => {
      callback(null, { stdout: file === 'ps' ? 'bash /runs/run-2/run.resume-1.sh\n' : '', stderr: '' });
    });
    const other = await readIdentityCheckedQueueSnapshot({ jobId: 'local-42', runId: 'run-1', runFolder: '/runs/run-1' });
    expect(other.identityVerified).toBe(false);
  });

  it('does not relax exact local argv identity across a real symlink', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'seqdesk-queue-probe-local-')
    );
    const physicalRoot = path.join(tempRoot, 'physical-runs');
    const configuredRoot = path.join(tempRoot, 'configured-runs');
    const physicalRunFolder = path.join(physicalRoot, 'run-1');
    const configuredRunFolder = path.join(configuredRoot, 'run-1');

    try {
      await fs.mkdir(physicalRunFolder, { recursive: true });
      await fs.writeFile(path.join(physicalRunFolder, 'run.sh'), '#!/bin/sh\n');
      await fs.symlink(physicalRoot, configuredRoot, 'dir');
      mocks.execFile.mockImplementation((file, _args, callback) => {
        if (file === 'ps') {
          callback(null, {
            stdout: `bash ${physicalRunFolder}/run.sh\n`,
            stderr: '',
          });
          return;
        }
        callback(null, { stdout: '', stderr: '' });
      });

      const snapshot = await readIdentityCheckedQueueSnapshot({
        jobId: 'local-42',
        runId: 'run-1',
        runFolder: configuredRunFolder,
      });

      expect(snapshot).toMatchObject({
        identityVerified: false,
        state: 'UNKNOWN',
        source: 'local',
      });
      expect(snapshot.reason).toContain('another process');
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
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

  it('matches a scheduler WorkDir across a real run-root symlink', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'seqdesk-queue-probe-slurm-')
    );
    const physicalRoot = path.join(tempRoot, 'physical-runs');
    const configuredRoot = path.join(tempRoot, 'configured-runs');
    const physicalRunFolder = path.join(physicalRoot, 'run-1');
    const configuredRunFolder = path.join(configuredRoot, 'run-1');

    try {
      await fs.mkdir(physicalRunFolder, { recursive: true });
      await fs.symlink(physicalRoot, configuredRoot, 'dir');
      mocks.execFile.mockImplementation((file, _args, callback) => {
        if (file === 'squeue') {
          callback(null, {
            stdout:
              '123|cpu|seqdesk-run-1|runner|RUNNING|00:01|1|node-1|' +
              `${physicalRunFolder}\n`,
            stderr: '',
          });
          return;
        }
        callback(null, { stdout: '', stderr: '' });
      });

      const snapshot = await readIdentityCheckedQueueSnapshot({
        jobId: '123',
        runId: 'run-1',
        runFolder: configuredRunFolder,
      });

      expect(snapshot).toMatchObject({
        identityVerified: true,
        state: 'RUNNING',
        source: 'squeue',
      });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
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

describe('scheduler command timeouts', () => {
  it('give a busy controller and accounting database time to answer', async () => {
    // sacct took 12 s on a real Slurm under load; with 5 s a finished run waited for confirmation for ever.
    const { readIdentityCheckedQueueSnapshot, SACCT_TIMEOUT_MS, SQUEUE_TIMEOUT_MS } = await import('./queue-probe');
    expect(SQUEUE_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
    expect(SACCT_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
    mocks.options.length = 0;
    mocks.execFile.mockImplementation((_file: string, _args: readonly string[], callback: (e: Error | null, r?: { stdout: string; stderr: string }) => void) => callback(null, { stdout: '', stderr: '' }));
    await readIdentityCheckedQueueSnapshot({ jobId: '4819227', runId: 'run-1', runFolder: '/runs/run-1' });
    expect(mocks.options).toEqual(expect.arrayContaining([expect.objectContaining({ timeout: SQUEUE_TIMEOUT_MS }), expect.objectContaining({ timeout: SACCT_TIMEOUT_MS })]));
  });
});
