import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { classifyFailure, durationWords, firstErrorLines, parseSacct, parseSqueue, plainRunStatus, redactLog, slurmReasonWords } from './plain-status';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '__fixtures__', 'plain-status', name), 'utf8');
const now = new Date('2026-09-28T12:00:00Z');

describe('scheduler lines', () => {
  it('parses squeue and sacct output', () => {
    expect(parseSqueue(fixture('squeue-resources.txt'))).toEqual([{ jobId: '4819227', state: 'PENDING', exitCode: null, signal: null, reason: 'Resources', nodes: '(null)' }]);
    const oom = parseSacct(fixture('sacct-oom.txt'));
    expect(oom.map((l) => [l.jobId, l.state, l.exitCode, l.signal])).toEqual([['4819391', 'OUT_OF_MEMORY', 0, 125], ['4819391.batch', 'OUT_OF_MEMORY', 0, 137]]);
    expect(parseSacct('JobID|State|ExitCode|Reason|NodeList\n')).toEqual([]);
  });
  it('says SLURM reasons in words', () => {
    expect(slurmReasonWords('Resources', '256 GB')).toBe('Waiting for a free node with 256 GB');
    expect(slurmReasonWords('Priority')).toMatch(/^Waiting in the queue/);
    expect(slurmReasonWords('QOSMaxJobsPerUserLimit')).toMatch(/maximum of jobs/);
    expect(slurmReasonWords('(ReqNodeNotAvail, UnavailableNodes:hpc-c17)')).toMatch(/down or reserved/);
    expect(slurmReasonWords(null)).toBe('Waiting in the queue');
  });
});

describe('failure kinds (the S-25P table)', () => {
  it.each([
    ['exit 137 · oom_kill', { texts: [fixture('log-oom.txt')], exitCodes: [137] }, 'memory'],
    ['OUT_OF_MEMORY state alone', { texts: [''], slurmStates: ['OUT_OF_MEMORY'] }, 'memory'],
    ['TIMEOUT', { texts: ['slurmstepd: error: *** JOB 4819544 ON hpc-c03 CANCELLED AT 2026-09-28 DUE TO TIME LIMIT ***'], slurmStates: ['TIMEOUT'] }, 'time'],
    ['exit 140', { texts: [''], exitCodes: [140] }, 'time'],
    ['samplesheet validation', { texts: [fixture('log-input.txt')] }, 'input'],
    ['db path not found', { texts: [fixture('log-database.txt')] }, 'database'],
    ['conda', { texts: [fixture('log-conda.txt')] }, 'software'],
    ['NODE_FAIL', { texts: [''], slurmStates: ['NODE_FAIL'], exitCodes: [143] }, 'node'],
    ['anything else', { texts: [fixture('log-unknown.txt')], exitCodes: [1] }, 'unknown'],
  ] as const)('%s', (_label, input, kind) => {
    expect(classifyFailure(input as unknown as Parameters<typeof classifyFailure>[0])).toBe(kind);
  });
});

describe('redaction', () => {
  it('strips conda channel credentials and tokens from log lines', () => {
    const clean = redactLog(fixture('log-conda.txt'));
    expect(clean).not.toMatch(/hunter2|tk-abc123SECRET/);
    expect(redactLog('export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwx')).not.toMatch(/ghp_abc/);
    expect(redactLog('api_key=abc123def')).toBe('api_key=REDACTED');
  });
  it('picks the first lines of the real error', () => {
    const lines = firstErrorLines([fixture('log-oom.txt')]);
    expect(lines[0]).toMatch(/Error executing process/);
    expect(lines.join('\n')).toMatch(/exit status \(137\)/);
    expect(lines.length).toBeLessThanOrEqual(3);
  });
});

describe('plainRunStatus', () => {
  it('failed: out of memory, with the sample, Resume with double memory and what is kept', () => {
    const status = plainRunStatus({ now, run: { status: 'failed', executionMode: 'slurm', queueJobId: '4819391', askedMemory: '64 GB', errorTail: fixture('log-oom.txt'),
      startedAt: '2026-09-28T09:14:00Z', completedAt: '2026-09-28T11:16:30Z' }, trace: fixture('trace-oom.txt'), sacct: fixture('sacct-oom.txt') });
    expect(status.shape).toBe('needs-you');
    expect(status.error?.kind).toBe('memory');
    expect(status.sentence).toBe('Assembly ran out of memory on sample M7_d3');
    expect(status.action).toMatchObject({ kind: 'resume', label: 'Resume with 128 GB', memory: '128 GB' });
    expect(status.keeps).toMatchObject({ finishedSteps: 2, restartsAt: 'assembly' });
    expect(status.stages.map((s) => [s.name, s.state])).toEqual([['FASTP', 'done'], ['BOWTIE2_HOST_REMOVAL', 'done'], ['MEGAHIT', 'failed']]);
    expect(status.processes.find((p) => p.name === 'MEGAHIT')).toMatchObject({ tasks: 2, done: 1, failed: 1 });
  });
  it('failed: time limit → Resume with twice the hours', () => {
    const status = plainRunStatus({ now, run: { status: 'failed', executionMode: 'slurm', timeLimitHours: 12, errorTail: 'slurmstepd: error: *** JOB 4819544 CANCELLED DUE TO TIME LIMIT ***' }, sacct: fixture('sacct-timeout.txt') });
    expect(status.error?.kind).toBe('time');
    expect(status.action).toMatchObject({ kind: 'resume', label: 'Resume with 24 h', time: '24h' });
  });
  it('failed: input, database, software, node and unknown have their own action', () => {
    const kinds = [
      [{ errorTail: fixture('log-input.txt') }, 'input', 'fix-data'],
      [{ errorTail: fixture('log-database.txt') }, 'database', 'ask-admin'],
      [{ errorTail: fixture('log-conda.txt') }, 'software', 'retry'],
      [{ errorTail: fixture('log-unknown.txt') }, 'unknown', 'show-log'],
    ] as const;
    for (const [run, kind, action] of kinds) {
      const status = plainRunStatus({ now, run: { status: 'failed', ...run } });
      expect([status.error?.kind, status.action?.kind]).toEqual([kind, action]);
      expect(status.error?.firstLines.join('\n')).not.toMatch(/hunter2|SECRET/);
    }
    const node = plainRunStatus({ now, run: { status: 'failed', executionMode: 'slurm' }, sacct: fixture('sacct-nodefail.txt') });
    expect([node.error?.kind, node.sentence]).toEqual(['node', 'Node hpc-c17 failed during a step']);
  });
  it('local time limit: the task stays running in the trace and Nextflow names it in the log', () => {
    const log = "ERROR ~ Error executing process > 'RUN_FASTQC (ERR10419931)'\n\nCaused by:\n  process hasn't exited";
    const nfLog = "java.lang.IllegalThreadStateException: process hasn't exited\n\tat nextflow.executor.local.LocalTaskHandler.checkIfCompleted(LocalTaskHandler.groovy:220)";
    const trace = 'task_id\thash\tnative_id\tprocess\ttag\tname\tstatus\texit\n1\t2c/675315\t30512\tRUN_FASTQC\tERR10419931\tRUN_FASTQC (ERR10419931)\tRUNNING\t-\n';
    const status = plainRunStatus({ now, run: { status: 'failed', executionMode: 'local', outputTail: log }, taskError: nfLog, trace });
    expect([status.error?.kind, status.sentence, status.action?.kind]).toEqual(['time', 'FastQC hit the time limit', 'resume']);
    expect(status.stages).toEqual([{ name: 'RUN_FASTQC', state: 'failed' }]);
    expect(classifyFailure({ texts: ["process hasn't exited"] })).toBe('unknown');
  });
  it('queued on SLURM says the reason in words and offers one action', () => {
    const resources = plainRunStatus({ now, run: { status: 'queued', executionMode: 'slurm', queueJobId: '4819227', queueStatus: 'PENDING', queueReason: 'Resources', askedMemory: '256 GB', queuedAt: '2026-09-28T11:00:00Z' } });
    expect([resources.shape, resources.word]).toEqual(['waiting', 'Queued']);
    expect(resources.sentence).toBe('Waiting for a free node with 256 GB · waiting 1 h');
    expect(resources.action?.kind).toBe('ask-less-memory');
    const qos = plainRunStatus({ now, run: { status: 'queued', executionMode: 'slurm', queueJobId: '1', queueStatus: 'PENDING', queueReason: 'QOSMaxJobsPerUserLimit' } });
    expect(qos.action?.kind).toBe('see-jobs');
  });
  it('running: step of steps, estimate only from past runs', () => {
    const run = { status: 'running', executionMode: 'local', startedAt: '2026-09-28T11:59:00Z' };
    const none = plainRunStatus({ now, run, trace: fixture('trace-running.txt') });
    expect(none.sentence).toBe('Running · step 2 of 2: collecting statistics · no estimate yet');
    const past = plainRunStatus({ now, run, trace: fixture('trace-running.txt'), pastSeconds: [300, 360, 420] });
    expect(past.sentence).toBe('Running · step 2 of 2: collecting statistics · ~5 min left');
  });
  it('finished, cancelled and preparing', () => {
    expect(plainRunStatus({ now, run: { status: 'completed', startedAt: '2026-09-28T09:00:00Z', completedAt: '2026-09-28T12:12:00Z', outputCount: 3 } }).sentence).toBe('Finished in 3 h 12 · 3 outputs in Data');
    const cancelled = plainRunStatus({ now, run: { status: 'cancelled' }, trace: fixture('trace-oom.txt') });
    expect([cancelled.sentence, cancelled.action?.label]).toEqual(['Cancelled at assembly · 2 finished steps are kept', 'Run again']);
    expect(plainRunStatus({ now, run: { status: 'running', executionMode: 'local', outputTail: 'Creating env using conda: bioconda::seqkit=2.8.0' } }).shape).toBe('preparing');
    expect(plainRunStatus({ now, run: { status: 'pending' } }).sentence).toBe('Preparing to start');
  });
  it('words for durations', () => {
    expect([durationWords(38), durationWords(600), durationWords(11520), durationWords(7200)]).toEqual(['38 s', '10 min', '3 h 12', '2 h']);
  });
});
