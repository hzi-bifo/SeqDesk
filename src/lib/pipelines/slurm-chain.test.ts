/**
 * The SLURM path of a run from the scheduler's own words to the card: mocked squeue/sacct output (in the formats
 * queue-probe asks for) goes through the real identity-checked probe, the reconciler and the plain status, as the
 * monitor does it. One test per scheduler situation a pipeline step meets: pending with a reason, running, completed,
 * failed by exit code, OUT_OF_MEMORY, TIMEOUT, NODE_FAIL, cancelled, a job that never starts (PartitionTimeLimit),
 * and a scheduler that does not answer (squeue down, sacct missing or slow).
 *
 * MOCKED: no SLURM runs here; execFile answers with recorded-shape scheduler lines.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Job = { state: string; reason?: string; exit?: string; name?: string; workDir?: string; inQueue?: boolean; inAccounting?: boolean };
const sched = vi.hoisted(() => ({
  job: null as null | Job,
  squeueError: null as null | string,
  sacctError: null as null | string,
  calls: [] as Array<{ file: string; args: string[]; timeout?: number }>,
}));

const RUN_ID = 'cmrun1';
const FOLDER = '/data/runs/FASTQC-20261006-001--id-cmrun1';
const JOB = '4819227';

vi.mock('child_process', () => ({
  execFile: (file: string, args: string[], options: { timeout?: number }, callback: (error: Error | null, result?: { stdout: string; stderr: string }) => void) => {
    sched.calls.push({ file, args, timeout: options?.timeout });
    const job = sched.job;
    const name = job?.name ?? `seqdesk-${RUN_ID}`;
    const workDir = job?.workDir ?? FOLDER;
    if (file === 'squeue') {
      if (sched.squeueError) return callback(Object.assign(new Error(sched.squeueError), { code: 1 }));
      if (!job || job.inQueue === false || !['PENDING', 'RUNNING', 'CONFIGURING', 'COMPLETING'].includes(job.state)) {
        // A job SLURM no longer lists: squeue -j fails once the job is purged.
        return callback(Object.assign(new Error('slurm_load_jobs error: Invalid job id specified'), { code: 1 }));
      }
      // -o '%i|%P|%.128j|%u|%T|%M|%D|%R|%.1024Z' (right-justified, padded fields as squeue prints them)
      const reasonOrNodes = job.state === 'PENDING' ? `(${job.reason ?? 'None'})` : 'hpc-c17';
      return callback(null, { stdout: `${JOB}|cpu|${name.padStart(128)}|seqdesk|${job.state}|1:05|1|${reasonOrNodes}|${workDir.padStart(1024)}\n`, stderr: '' });
    }
    if (file === 'sacct') {
      if (sched.sacctError) return callback(Object.assign(new Error(sched.sacctError), { code: sched.sacctError === 'ENOENT' ? 'ENOENT' : 1 }));
      if (!job || job.inAccounting === false) return callback(null, { stdout: '', stderr: '' });
      // -X -P --format=JobID,State%32,Reason,JobName%128,WorkDir%1024,Elapsed,ExitCode --noheader
      return callback(null, { stdout: `${JOB}|${job.state}|${job.reason ?? 'None'}|${name}|${workDir}|00:42:10|${job.exit ?? '0:0'}\n`, stderr: '' });
    }
    return callback(new Error(`unexpected command ${file}`));
  },
}));
vi.mock('@/lib/pipelines/run-completion', () => ({ inferPipelineExitCode: vi.fn(async () => null) }));

import { readIdentityCheckedQueueSnapshot, SACCT_TIMEOUT_MS, SQUEUE_TIMEOUT_MS } from './queue-probe';
import { reconcileRun } from './run-reconciler';
import { plainRunStatus } from './plain-status';

const now = new Date('2026-10-06T12:00:00Z');
const asked = { askedMemory: '4 GB', askedCores: 2, timeLimitHours: 2, queue: 'cpu' };

/** One monitor pass: probe -> reconcile -> the fields the monitor writes -> the card. */
async function pass(runStatus: 'queued' | 'running', job: Job | null, extra: Record<string, unknown> = {}) {
  sched.job = job;
  const scheduler = await readIdentityCheckedQueueSnapshot({ jobId: JOB, runId: RUN_ID, runFolder: FOLDER });
  const next = reconcileRun({ run: { status: runStatus }, trace: { derived: null, currentStep: null, progress: null, failuresAborted: false }, scheduler, slurm: true });
  const status = next.status ?? runStatus;
  const card = plainRunStatus({ now, run: {
    // The monitor writes queue fields only from a verified answer; otherwise the run keeps the ones it had.
    status, executionMode: 'slurm', queueJobId: JOB, queueStatus: next.queue ? next.queue.status : runStatus === 'running' ? 'RUNNING' : 'PENDING', queueReason: next.queue?.reason ?? null,
    currentStep: next.currentStep, queuedAt: '2026-10-06T11:58:00Z', startedAt: status === 'queued' ? null : '2026-10-06T11:20:00Z', ...asked, ...extra,
  } });
  return { scheduler, next, card };
}

beforeEach(() => { sched.job = null; sched.squeueError = null; sched.sacctError = null; sched.calls = []; });

describe('SLURM, from squeue/sacct to the card (MOCKED scheduler)', () => {
  it.each([
    ['Priority', 'Waiting in the queue · other jobs go first · waiting 2 min', 'cancel'],
    ['Resources', 'Waiting for a free node with 2 cores and 4 GB · waiting 2 min', 'cancel'],
    ['QOSMaxJobsPerUserLimit', 'Waiting: your lab already has its maximum of jobs running · waiting 2 min', 'cancel'],
    ['AssocGrpCpuLimit', 'Waiting: your lab is using its share of cores · waiting 2 min', 'cancel'],
  ])('pending (%s): queued, the reason in words, Cancel', async (reason, sentence, action) => {
    const { scheduler, next, card } = await pass('queued', { state: 'PENDING', reason });
    expect(scheduler).toMatchObject({ source: 'squeue', identityVerified: true, state: 'PENDING', reason: `(${reason})` });
    expect(next).toMatchObject({ status: 'queued', queue: { status: 'PENDING', reason } });
    expect([card.shape, card.word, card.sentence, card.action?.kind]).toEqual(['waiting', 'Queued', sentence, action]);
  });

  it('a job over the queue’s time limit never starts (PartitionTimeLimit): Needs you, ask the admin, not "waiting"', async () => {
    const { next, card } = await pass('queued', { state: 'PENDING', reason: 'PartitionTimeLimit' });
    expect(next.status).toBe('queued');
    expect(card).toMatchObject({ shape: 'needs-you', word: 'Needs you', sentence: 'Won’t start: it asks for more time (2 h) than the cpu queue allows · waiting 2 min',
      action: { kind: 'ask-admin' }, error: { kind: 'time', firstLines: ['SLURM: PartitionTimeLimit'] } });
    // The lab's QOS per-job limits are the same: the job never starts as it is.
    expect((await pass('queued', { state: 'PENDING', reason: 'QOSMaxWallDurationPerJobLimit' })).card.sentence).toMatch(/^Won’t start: it asks for more time \(2 h\) than your lab may use for one job/);
    expect((await pass('queued', { state: 'PENDING', reason: 'QOSMaxCpuPerJobLimit' })).card).toMatchObject({ shape: 'needs-you', sentence: expect.stringMatching(/^Won’t start: it asks for more cores or memory/) });
    // A limit per user (other jobs of the lab) passes by itself: still waiting.
    expect((await pass('queued', { state: 'PENDING', reason: 'QOSMaxJobsPerUserLimit' })).card.shape).toBe('waiting');
  });

  it('a task job that never starts while the run’s own job runs: the running card says so and asks the admin', () => {
    const card = plainRunStatus({ now, run: { status: 'running', executionMode: 'slurm', queueJobId: JOB, queueStatus: 'RUNNING', queueReason: 'PartitionTimeLimit', startedAt: '2026-10-06T11:20:00Z', ...asked } });
    expect(card).toMatchObject({ shape: 'running', action: { kind: 'ask-admin' } });
    expect(card.sentence).toContain('· the next step won’t start: it asks for more time (2 h) than the cpu queue allows');
  });

  it('running: running, Cancel; a stale check says how old it is', async () => {
    const { next, card } = await pass('queued', { state: 'RUNNING' });
    expect(next).toMatchObject({ status: 'running', queue: { status: 'RUNNING', reason: null }, transition: { from: 'queued', to: 'running' } });
    expect([card.shape, card.action?.kind]).toEqual(['running', 'cancel']);
    const stale = plainRunStatus({ now, run: { status: 'running', executionMode: 'slurm', queueJobId: JOB, queueStatus: 'RUNNING', startedAt: '2026-10-06T11:20:00Z', checkedAt: '2026-10-06T11:50:00Z' } });
    expect(stale.sentence).toMatch(/status last checked 10 min ago$/);
  });

  it('completed: squeue has dropped the job, sacct (authoritative) says COMPLETED, the run finalizes', async () => {
    const { scheduler, next } = await pass('running', { state: 'COMPLETED', inQueue: false });
    expect(scheduler).toMatchObject({ source: 'sacct', identityVerified: true, state: 'COMPLETED' });
    expect(next).toMatchObject({ status: 'completed', finalize: true, transition: { from: 'running', to: 'completed' } });
  });

  it.each([
    ['FAILED', '1:0', 'unknown', 'show-log', /^Failed at a step$/],
    ['OUT_OF_MEMORY', '0:125', 'memory', 'resume', /ran out of memory$/],
    ['TIMEOUT', '0:0', 'time', 'resume', /hit the 2 h time limit$/],
    ['NODE_FAIL', '0:0', 'node', 'resume', /^A compute node failed during a step$/],
  ])('ended %s (%s): failed, error kind %s, one fix (%s)', async (state, exit, kind, fix, sentence) => {
    const { next, card } = await pass('running', { state, exit, inQueue: false });
    expect(next).toMatchObject({ status: 'failed', queue: { status: state } });
    expect(card).toMatchObject({ shape: 'needs-you', error: { kind }, action: { kind: fix } });
    expect(card.sentence).toMatch(sentence);
    if (state === 'OUT_OF_MEMORY') expect(card.action).toMatchObject({ label: 'Resume with 8 GB', memory: '8 GB' });
    if (state === 'TIMEOUT') expect(card.action).toMatchObject({ label: 'Resume with 4 h', time: '4h' });
  });

  it('cancelled outside SeqDesk ("CANCELLED by 1000"): cancelled, no stale queue fields', async () => {
    const { next, card } = await pass('running', { state: 'CANCELLED by 1000', exit: '0:15', inQueue: false });
    expect(next).toMatchObject({ status: 'cancelled', queue: { status: null, reason: null } });
    expect(plainRunStatus({ now, run: { status: 'cancelled', executionMode: 'slurm', queueJobId: JOB } }).action?.kind).toBe('run-again');
    expect(card.shape).toBe('cancelled');
  });

  it('a job id SLURM now gives another run (recycled ids) is never read as this run’s end', async () => {
    const { scheduler, next } = await pass('running', { state: 'COMPLETED', inQueue: false, name: 'seqdesk-otherrun' });
    expect(scheduler.identityVerified).toBe(false);
    expect(next).toMatchObject({ status: null, finalize: false, transition: null });
  });

  it('squeue fails (controller down): accounting answers instead', async () => {
    sched.squeueError = 'slurm_load_jobs error: Unable to contact slurm controller (connect failure)';
    const { scheduler, next } = await pass('running', { state: 'RUNNING' });
    expect(scheduler).toMatchObject({ source: 'sacct', identityVerified: true, state: 'RUNNING' });
    expect(next.status).toBe('running');
  });

  it.each([
    ['sacct is not installed', 'ENOENT'],
    ['accounting storage is disabled', 'sacct: error: Slurm accounting storage is disabled'],
    ['accounting is too slow (timed out)', 'Command failed: sacct (killed after timeout)'],
  ])('job gone from squeue and %s: nothing changes, the run is looked at again soon', async (_label, error) => {
    sched.sacctError = error;
    const { scheduler, next, card } = await pass('running', { state: 'COMPLETED', inQueue: false });
    expect(scheduler).toMatchObject({ identityVerified: false, state: 'UNKNOWN' });
    // No new status (null: the monitor writes nothing), no queue fields, another look in 15 s.
    expect(next).toMatchObject({ status: null, queue: null, nextCheckSeconds: 15, transition: null });
    expect(card.shape).toBe('running');
  });

  it('every task ended but SLURM does not confirm the job yet: "waiting for SLURM to confirm", never finished early', async () => {
    sched.sacctError = 'ENOENT';
    sched.job = { state: 'COMPLETED', inQueue: false };
    const scheduler = await readIdentityCheckedQueueSnapshot({ jobId: JOB, runId: RUN_ID, runFolder: FOLDER });
    const next = reconcileRun({ run: { status: 'running' }, trace: { derived: 'completed', currentStep: 'Completed', progress: 100, failuresAborted: false }, scheduler, slurm: true });
    expect(next).toMatchObject({ status: 'running', finalize: false, currentStep: 'Waiting for scheduler confirmation...' });
    const card = plainRunStatus({ now, run: { status: 'running', executionMode: 'slurm', queueJobId: JOB, queueStatus: 'RUNNING', currentStep: next.currentStep, startedAt: '2026-10-06T11:20:00Z' } });
    expect(card.sentence).toBe('All steps ended · waiting for SLURM to confirm the job (SLURM is not answering)');
  });

  it('gives a busy controller and accounting database their time (squeue 20 s, sacct 45 s by default)', async () => {
    sched.squeueError = 'down';
    await pass('running', { state: 'RUNNING' });
    expect(sched.calls.find((c) => c.file === 'squeue')?.timeout).toBe(SQUEUE_TIMEOUT_MS);
    expect(sched.calls.find((c) => c.file === 'sacct')?.timeout).toBe(SACCT_TIMEOUT_MS);
    expect([SQUEUE_TIMEOUT_MS, SACCT_TIMEOUT_MS]).toEqual([20_000, 45_000]);
  });
});
