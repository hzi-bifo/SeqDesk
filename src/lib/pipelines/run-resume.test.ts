/**
 * Resume starts the new attempt without the failed attempt's trace.txt (kept as trace.before-resume-N.txt): until
 * Nextflow writes the resumed attempt's own trace, the old one would show the failed attempt as this one's progress.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ run: null as Record<string, unknown> | null, updates: [] as unknown[], events: [] as unknown[], claims: [] as unknown[], spawned: [] as unknown[][], sbatch: null as null | { out: string; err: string; code: number } }));

vi.mock('@/lib/db', () => ({
  db: {
    pipelineRun: {
      findUnique: vi.fn(async () => state.run),
      updateMany: vi.fn(async (args: unknown) => { state.claims.push(args); return { count: 1 }; }),
      update: vi.fn(async (args: unknown) => { state.updates.push(args); return {}; }),
    },
    pipelineRunEvent: {
      count: vi.fn(async () => 0),
      create: vi.fn(async (args: unknown) => { state.events.push(args); return {}; }),
    },
  },
}));
vi.mock('child_process', async (importOriginal) => {
  const { EventEmitter } = await import('events');
  return { ...(await importOriginal<typeof import('child_process')>()), spawn: vi.fn((...args: unknown[]) => {
    state.spawned.push(args);
    if (args[0] !== 'sbatch' || !state.sbatch) return { pid: 4242, unref: () => undefined, on: () => undefined };
    // MOCKED sbatch: prints what state.sbatch says, then exits with its code.
    const answer = state.sbatch;
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    process.nextTick(() => { if (answer.out) child.stdout.emit('data', answer.out); if (answer.err) child.stderr.emit('data', answer.err); child.emit('close', answer.code); });
    return child;
  }) };
});
vi.mock('./launch-identity', () => ({ writePipelineLaunchIdentity: vi.fn(async () => undefined) }));
vi.mock('./pipeline-run-service', () => ({ finalizeLocalRun: vi.fn(async () => undefined) }));

import { resumePipelineRun } from './run-resume';

let folder: string | null = null;
afterEach(async () => { if (folder) await fs.rm(folder, { recursive: true, force: true }); folder = null; Object.assign(state, { updates: [], events: [], claims: [], spawned: [], sbatch: null }); });

describe('resumePipelineRun', () => {
  it('keeps the failed attempt\'s trace aside and starts without one', async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-'));
    await fs.mkdir(path.join(folder, 'logs'));
    await fs.writeFile(path.join(folder, 'run.sh'), [
      '#!/bin/bash',
      'echo "Starting fastqc pipeline at $(date)" > "$STDOUT_LOG"',
      '"${NEXTFLOW_RUNNER[@]}" run \'/pipelines/fastqc\' \\',
      '  -name FASTQC-7-abc \\',
      `  -with-trace '${folder}/trace.txt' \\`,
      '  >> "$STDOUT_LOG" 2>> "$STDERR_LOG"',
      '',
    ].join('\n'));
    const oldTrace = 'task_id\thash\tnative_id\tprocess\ttag\tname\tstatus\n1\tab/cdef\t1\tRUN_FASTQC\tS1\tRUN_FASTQC (S1)\tFAILED\n';
    await fs.writeFile(path.join(folder, 'trace.txt'), oldTrace);
    state.run = { id: 'run-1', pipelineId: 'fastqc', status: 'failed', runFolder: folder, executionMode: 'local', runNumber: 'FASTQC-7' };

    const result = await resumePipelineRun('run-1', { time: '1 min' });

    expect(result).toMatchObject({ status: 200, body: { resumed: 1, status: 'running' } });
    await expect(fs.stat(path.join(folder, 'trace.txt'))).rejects.toThrow();
    expect(await fs.readFile(path.join(folder, 'trace.before-resume-1.txt'), 'utf8')).toBe(oldTrace);
  });
});

describe('resumePipelineRun on SLURM (MOCKED sbatch)', () => {
  const slurmScript = (dir: string) => [
    '#!/bin/bash',
    '#SBATCH --job-name=seqdesk-run-2',
    '#SBATCH -t 2:0:0',
    `#SBATCH -D "${dir}"`,
    'echo "Starting fastqc pipeline at $(date)" > "$STDOUT_LOG"',
    'echo "" > "$STDERR_LOG"',
    "SEQDESK_RUN_NAME='FASTQC-8-abc'",
    '"${NEXTFLOW_RUNNER[@]}" run \'/pipelines/fastqc\' \\',
    '  -name "$SEQDESK_RUN_NAME" \\',
    `  -with-trace '${dir}/trace.txt' \\`,
    '  >> "$STDOUT_LOG" 2>> "$STDERR_LOG"',
    '',
  ].join('\n');
  async function failedSlurmRun() {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-slurm-'));
    await fs.mkdir(path.join(folder, 'logs'));
    await fs.writeFile(path.join(folder, 'run.sh'), slurmScript(folder));
    state.run = { id: 'run-2', pipelineId: 'fastqc', status: 'failed', runFolder: folder, executionMode: 'slurm', runNumber: 'FASTQC-8' };
    return folder;
  }

  it('submits a new job with -resume and the longer time, keeps it queued with the new job id', async () => {
    const dir = await failedSlurmRun();
    state.sbatch = { out: '4819300\n', err: '', code: 0 };

    const result = await resumePipelineRun('run-2', { time: '4 h' });

    expect(result).toMatchObject({ status: 200, body: { resumed: 1, status: 'queued', jobId: '4819300' } });
    expect(state.spawned.find((call) => call[0] === 'sbatch')).toEqual(['sbatch', ['--parsable', path.join(dir, 'run.resume-1.sh')], { cwd: dir }]);
    const script = await fs.readFile(path.join(dir, 'run.resume-1.sh'), 'utf8');
    expect(script).toContain('-resume');
    expect(script).toContain('#SBATCH -t 5:0:0'); // the head job outlives a task that now may take 4 h
    expect(script).toContain("SEQDESK_RUN_NAME='FASTQC-8-abc-r1'");
    expect(await fs.readFile(path.join(dir, 'resume-1.config'), 'utf8')).toContain('time = 4.h');
    // Claimed as queued on SLURM (not running), the old reason gone; then the new job id is kept.
    expect(state.claims[0]).toMatchObject({ data: { status: 'queued', queueStatus: 'PENDING', queueReason: null, currentStep: 'Waiting for scheduler' } });
    expect(state.updates).toContainEqual({ where: { id: 'run-2' }, data: { queueJobId: '4819300' } });
  });

  it('a resume SLURM refuses fails the run again with sbatch\'s words', async () => {
    await failedSlurmRun();
    state.sbatch = { out: '', err: 'sbatch: error: Batch job submission failed: Invalid partition name specified\n', code: 1 };

    const result = await resumePipelineRun('run-2', { memory: '8 GB' });

    expect(result.status).toBe(500);
    expect(state.updates).toContainEqual(expect.objectContaining({ data: expect.objectContaining({ status: 'failed', errorTail: expect.stringContaining('sbatch refused the resume: sbatch: error: Batch job submission failed: Invalid partition name specified') }) }));
  });

  it('a running or queued run is not resumed', async () => {
    await failedSlurmRun();
    state.run = { ...state.run!, status: 'queued' };
    expect(await resumePipelineRun('run-2', {})).toMatchObject({ status: 409 });
    expect(state.spawned).toEqual([]);
  });
});
