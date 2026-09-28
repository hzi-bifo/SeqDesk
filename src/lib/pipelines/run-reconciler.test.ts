/**
 * The run reconciler's transition table on REAL evidence from a single-node Slurm 24.11 (elektra, Sep 2026): for each
 * scenario of the SLURM bug hunt, __fixtures__/elektra-slurm/runs.json holds the run's trace.txt, the end of its
 * Nextflow console log and pipeline.err, and `sacct -n -P -o JobID,State,ExitCode,Reason,NodeList` for the run's job
 * and its task jobs (host and home folder renamed, nothing else edited). squeue.txt holds pending reasons as printed.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { parseTraceFile } from './nextflow';
import { parseSacct, plainRunStatus } from './plain-status';
import type { QueueSnapshot } from './queue-probe';
import { historyLines, queueFieldsFrom, reconcileRun, summarizeTrace, transitionEvent } from './run-reconciler';

type Evidence = { run: string; trace: string | null; outputTail: string | null; errorTail: string | null; sacct: string | null };
const FIXTURES = path.join(__dirname, '__fixtures__', 'elektra-slurm');
const runs = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'runs.json'), 'utf8')) as Record<string, Evidence>;
const now = new Date('2026-09-28T12:40:00Z');

async function traceOf(text: string | null) {
  if (!text) return { derived: null, currentStep: null, progress: null, failuresAborted: false };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reconciler-')), 'trace.txt');
  fs.writeFileSync(file, text);
  const trace = await parseTraceFile(file);
  return summarizeTrace('fastqc', trace.tasks, trace.overallProgress);
}
/** The run's own job as sacct saw it: the first line whose id has no step suffix. */
function headJob(evidence: Evidence): QueueSnapshot {
  const head = parseSacct(evidence.sacct).find((line) => /^\d+$/.test(line.jobId))!;
  return { state: head.state, reason: head.reason, source: 'sacct', identityVerified: true, exitCode: head.exitCode };
}

// scenario → [the status the reconciler decides from a running run, the card's sentence (start), the card's action]
const TABLE: [string, string, RegExp, string][] = [
  ['completed', 'completed', /^Finished in/, 'open-outputs'],
  ['requeued-resumed', 'completed', /^Finished in/, 'open-outputs'],
  ['scancel-head', 'cancelled', /^Cancelled at FastQC/, 'run-again'],
  ['max-jobs-cancelled', 'cancelled', /^Cancelled/, 'run-again'],
  ['oom', 'failed', /^FastQC ran out of memory on sample ERR10419931$/, 'resume'],
  ['time-limit-1min', 'failed', /^FastQC hit the/, 'resume'],
  ['scancel-child', 'failed', /^FastQC was stopped outside SeqDesk: its SLURM job was cancelled$/, 'resume'],
  ['ctld-down-submit', 'failed', /^Couldn’t hand the FastQC summary to SLURM: the SLURM controller did not answer$/, 'resume'],
  ['nextflow-killed', 'failed', /^Nextflow itself was stopped before it finished \(exit 137\)/, 'resume'],
  ['conda-failed', 'failed', /^Couldn’t install the environment for RUN_FASTQC$/, 'retry'],
];

describe('the run reconciler on real SLURM evidence', () => {
  it.each(TABLE)('%s → %s', async (scenario, status, sentence, action) => {
    const evidence = runs[scenario];
    expect(evidence, scenario).toBeTruthy();
    const trace = await traceOf(evidence.trace);
    const next = reconcileRun({ run: { status: 'running' }, trace, scheduler: headJob(evidence), slurm: true });
    expect(next.status).toBe(status);
    expect(next.transition).toEqual({ from: 'running', to: status });
    expect(next.nextCheckSeconds).toBeNull();
    expect(next.finalize).toBe(status === 'completed');
    if (status === 'cancelled') expect(next.queue).toEqual({ status: null, reason: null });
    const plain = plainRunStatus({ now, trace: evidence.trace, sacct: evidence.sacct, run: {
      status: next.status!, executionMode: 'slurm', queueJobId: headJob(evidence).state ? '1' : null, outputTail: evidence.outputTail, errorTail: evidence.errorTail,
      startedAt: '2026-09-28T12:30:00Z', completedAt: '2026-09-28T12:35:00Z', outputCount: status === 'completed' ? 3 : 0, askedMemory: '4GB', timeLimitHours: 1,
      resumedTimeLimitSeconds: scenario === 'time-limit-1min' ? 60 : null } });
    expect(plain.sentence).toMatch(sentence);
    expect(plain.action?.kind).toBe(action);
  });

  it('keeps a finished-looking run open while SLURM cannot confirm its job', async () => {
    const trace = await traceOf(runs.completed.trace);
    const next = reconcileRun({ run: { status: 'running' }, trace, scheduler: { state: 'UNKNOWN', reason: 'Stored SLURM job identity was not found in squeue or sacct', source: 'sacct', identityVerified: false }, slurm: true });
    expect([next.status, next.currentStep, next.transition, next.nextCheckSeconds]).toEqual(['running', 'Waiting for scheduler confirmation...', null, 15]);
  });

  it('records the pending reason as squeue printed it, and why task jobs wait while the run’s job runs', () => {
    const lines = fs.readFileSync(path.join(FIXTURES, 'squeue.txt'), 'utf8').trim().split('\n');
    for (const line of lines) {
      const [, state, reason] = line.split('|');
      const next = reconcileRun({ run: { status: 'queued' }, trace: { derived: null, currentStep: null, progress: null, failuresAborted: false },
        scheduler: { state, reason, source: 'squeue', identityVerified: true }, slurm: true });
      expect([next.status, next.queue]).toEqual(['queued', { status: 'PENDING', reason }]);
      expect(next.nextCheckSeconds).toBe(30);
    }
    const drained = lines[lines.length - 1].split('|')[2];
    const running = reconcileRun({ run: { status: 'queued' }, trace: { derived: null, currentStep: null, progress: null, failuresAborted: false },
      scheduler: { state: 'RUNNING', reason: null, source: 'squeue', identityVerified: true }, slurm: true, waitingTaskReason: drained });
    expect([running.status, running.queue, running.transition]).toEqual(['running', { status: 'RUNNING', reason: drained }, { from: 'queued', to: 'running' }]);
  });

  it('writes one event per transition and shows them as the run’s history', () => {
    const event = transitionEvent('run-1', 'running', 'cancelled', 'manual');
    expect(event).toMatchObject({ pipelineRunId: 'run-1', eventType: 'state', status: 'cancelled', message: 'running → cancelled' });
    expect(historyLines([{ occurredAt: new Date('2026-09-28T12:19:00Z'), eventType: 'state', message: 'queued → running' },
      { occurredAt: new Date('2026-09-28T12:20:00Z'), eventType: 'weblog', message: 'x' }])).toEqual(['12:19 queued → running']);
  });

  it('the legacy sync route keeps the scheduler fields by the same rule', () => {
    expect(queueFieldsFrom({ state: 'PENDING', reason: '(Resources)', source: 'squeue', identityVerified: true }, { slurm: true })).toEqual({ status: 'PENDING', reason: 'Resources' });
    expect(queueFieldsFrom({ state: 'RUNNING', reason: 'None', source: 'squeue', identityVerified: true }, { slurm: true, waitingTaskReason: 'AssocMaxJobsLimit' })).toEqual({ status: 'RUNNING', reason: 'AssocMaxJobsLimit' });
    expect(queueFieldsFrom({ state: 'UNKNOWN', reason: 'x', source: 'sacct', identityVerified: false }, { slurm: true })).toBeNull();
    expect(queueFieldsFrom({ state: 'RUNNING', reason: null, source: 'squeue', identityVerified: true }, { slurm: true, status: 'cancelled' })).toEqual({ status: null, reason: null });
  });

  it('a local run whose process vanished without its exit code fails with words, instead of waiting for ever', () => {
    const vanished = { state: 'UNKNOWN', reason: 'Local process exited before its canonical exit marker was observed', source: 'local' as const, identityVerified: false, pid: 4242 };
    const next = reconcileRun({ run: { status: 'running' }, trace: { derived: 'running', currentStep: 'FastQC', progress: 10, failuresAborted: false }, scheduler: vanished, slurm: false });
    expect([next.status, next.note]).toEqual(['failed', expect.stringMatching(/ended without writing its exit code/)]);
    const plain = plainRunStatus({ now, run: { status: 'failed', executionMode: 'local', queueJobId: 'local-4242', errorTail: next.note } });
    expect([plain.sentence, plain.action?.kind]).toEqual(['The run stopped when its process on this server ended (a restart or a kill) · Resume continues where it stopped', 'resume']);
  });
});
