import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { admits, localBudget, localLimitLines, localRunLimits, localWaitReason, localWaitWords } from './local-executor';

describe('runs on this server share it', () => {
  it('each run gets half the host by default, the budget is the host', () => {
    expect(localRunLimits({ cores: 16, memoryGb: 62 })).toEqual({ cores: 8, memoryGb: 31, timeHours: 48 });
    expect(localBudget({ cores: 16, memoryGb: 62 })).toEqual({ cores: 16, memoryGb: 55 });
  });
  it('admits a run while it fits beside the running ones; the first always starts', () => {
    const budget = { cores: 16, memoryGb: 55 };
    const run = { cores: 8, memoryGb: 24, timeHours: 48 };
    expect(admits(budget, [], { ...run, cores: 64 })).toBe(true);
    expect(admits(budget, [run], run)).toBe(true);
    expect(admits(budget, [run, run], run)).toBe(false);
    expect(localWaitWords(localWaitReason(run))).toBe('Waiting for 8 cores and 24 GB on this server');
    expect(localWaitWords(`${localWaitReason(run)}:2`)).toBe('Waiting for 8 cores and 24 GB on this server · 2 runs ahead');
    expect(localWaitWords('Resources')).toBeNull();
  });
  it('the wrapper stops a run at its time limit and says so', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'local-limits-'));
    fs.mkdirSync(path.join(folder, 'logs'));
    const lines = localLimitLines({ cores: 0, memoryGb: 0, timeHours: 0 }, 'run-1', folder).join('\n').replace(/timeout --foreground -s TERM -k 120 60/, 'timeout --foreground -s TERM -k 2 1');
    const script = `set -uo pipefail\nSTDOUT_LOG="${folder}/logs/pipeline.out"; STDERR_LOG="${folder}/logs/pipeline.err"\n${lines}\n\${RLIM[@]+"\${RLIM[@]}"} \${SEQDESK_TIMEOUT[@]+"\${SEQDESK_TIMEOUT[@]}"} sleep 20\nS=$?; seqdesk_local_limit_words $S; exit $S`;
    let status = 0;
    try { execFileSync('bash', ['-c', script]); } catch (e) { status = (e as { status: number }).status; }
    if (!fs.existsSync('/usr/bin/timeout') && !fs.existsSync('/bin/timeout') && !fs.existsSync('/opt/homebrew/bin/timeout')) return; // no coreutils timeout here
    expect(status).toBe(124);
    expect(fs.readFileSync(path.join(folder, 'logs', 'pipeline.err'), 'utf8')).toMatch(/time limit \(0 h\) reached: DUE TO TIME LIMIT on this server/);
  });
});
