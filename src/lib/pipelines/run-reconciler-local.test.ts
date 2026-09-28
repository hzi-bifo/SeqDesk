/**
 * The run reconciler and the plain sentences on REAL evidence from runs on this server (a Mac, Nextflow's local
 * executor, Sep 2026): __fixtures__/local-mac/runs.json holds each run's trace.txt, the end of its logs and the lines of
 * its .nextflow.log that name a time limit (host and home folder renamed, nothing else edited). Counterpart of
 * run-reconciler.test.ts, which does the same for SLURM (elektra).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { parseTraceFile } from './nextflow';
import { plainRunStatus } from './plain-status';
import type { QueueSnapshot } from './queue-probe';
import { reconcileRun, summarizeTrace } from './run-reconciler';

type Evidence = { run: string; trace: string | null; outputTail: string | null; errorTail: string | null; nextflowLog?: string | null; exitCode?: number; resumedTimeLimitSeconds?: number; dbErrorTail?: string };
const runs = JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', 'local-mac', 'runs.json'), 'utf8')) as Record<string, Evidence>;
const now = new Date('2026-09-28T20:00:00Z');

async function traceOf(text: string | null) {
  if (!text) return { derived: null, currentStep: null, progress: null, failuresAborted: false };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reconciler-local-')), 'trace.txt');
  fs.writeFileSync(file, text);
  const trace = await parseTraceFile(file);
  return summarizeTrace('fastqc', trace.tasks, trace.overallProgress);
}
const exited = (exitCode: number): QueueSnapshot => ({ state: 'EXITED', reason: null, source: 'local', identityVerified: true, exitCode, pid: 42 });
const vanished: QueueSnapshot = { state: 'UNKNOWN', reason: 'Local process exited before its canonical exit marker was observed', source: 'local', identityVerified: false, pid: 42 };

// scenario → [the snapshot the monitor reads, the status the reconciler decides, the card's sentence, the card's action]
const TABLE: [string, QueueSnapshot, string, RegExp, string][] = [
  ['completed', exited(0), 'completed', /^Finished in/, 'open-outputs'],
  ['nextflow-killed', exited(137), 'failed', /^Nextflow itself was stopped before it finished \(exit 137\)/, 'resume'],
  ['wrapper-killed', vanished, 'failed', /^The run stopped when its process on this server ended/, 'resume'],
  ['time-limit-resume', exited(1), 'failed', /^FastQC hit the 1 s time limit$/, 'resume'],
];

describe('the run reconciler on real local evidence', () => {
  it.each(TABLE)('%s → %s', async (scenario, scheduler, status, sentence, action) => {
    const evidence = runs[scenario];
    expect(evidence, scenario).toBeTruthy();
    const next = reconcileRun({ run: { status: 'running' }, trace: await traceOf(evidence.trace), scheduler, slurm: false });
    expect(next.status).toBe(status);
    expect(next.finalize).toBe(status === 'completed');
    const plain = plainRunStatus({ now, trace: evidence.trace, taskError: evidence.nextflowLog ?? null, run: {
      status: next.status!, executionMode: 'local', queueJobId: 'local-42', outputTail: evidence.outputTail,
      errorTail: [evidence.dbErrorTail ?? evidence.errorTail, next.note].filter(Boolean).join('\n') || null,
      startedAt: '2026-09-28T19:59:00Z', completedAt: '2026-09-28T19:59:30Z', outputCount: status === 'completed' ? 3 : 0, resumedTimeLimitSeconds: evidence.resumedTimeLimitSeconds ?? null } });
    expect(plain.sentence).toMatch(sentence);
    expect(plain.action?.kind).toBe(action);
  });

  it('a cancelled run keeps its sentence and offers Run again', async () => {
    const evidence = runs['cancelled-running'];
    const plain = plainRunStatus({ now, trace: evidence.trace, run: { status: 'cancelled', executionMode: 'local', queueJobId: 'local-42', outputTail: evidence.outputTail, errorTail: evidence.errorTail, startedAt: '2026-09-28T19:59:00Z', completedAt: '2026-09-28T19:59:30Z' } });
    expect([plain.shape, plain.action?.kind]).toEqual(['cancelled', 'run-again']);
    expect(plain.sentence).toMatch(/^Cancelled at FastQC/);
  });
});
