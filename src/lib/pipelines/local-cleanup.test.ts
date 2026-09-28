import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { killLocalLeftovers, leftoversOf, parsePs, waitForExit } from './local-cleanup';

const PS = [
  '  100   100 bash /runs/FASTQC-1--id-x/run.sh',
  '  101   100 /usr/bin/java -Xmx512m -jar fastqc /runs/FASTQC-1--id-x/work/91/163381/ERR10419931_1.fastq.gz',
  '  200   200 /usr/bin/java -Xmx512m fastqc /runs/FASTQC-10--id-y/work/aa/bb/reads.fastq.gz',
  '  300   300 node next-server',
].join('\n');

describe('leftovers of a local run', () => {
  it('finds them by the run folder in their command line, not by the number prefix of another run', () => {
    expect(parsePs(PS)).toHaveLength(4);
    expect(leftoversOf(parsePs(PS), '/runs/FASTQC-1--id-x').map((p) => p.pid)).toEqual([100, 101]);
    expect(leftoversOf(parsePs(PS), '/runs/FASTQC-1--id-x', 100).map((p) => p.pid)).toEqual([101]);
  });

  it('asks nicely first and kills only what is still there afterwards', async () => {
    const sent: [number, string][] = [];
    let call = 0;
    const gone = await killLocalLeftovers('/runs/FASTQC-1--id-x', {
      ps: async () => (call++ === 0 ? PS : PS.split('\n').filter((l) => !l.startsWith('  100 ')).join('\n')),
      kill: (pid, signal) => { sent.push([pid, signal]); },
      wait: async () => undefined,
    });
    expect(gone).toEqual([100, 101]);
    expect(sent).toEqual([[100, 'SIGTERM'], [101, 'SIGTERM'], [101, 'SIGKILL']]);
  });

  it('does nothing without a run folder or without leftovers', async () => {
    const deps = { ps: async () => PS, kill: () => { throw new Error('nothing to kill'); }, wait: async () => undefined };
    expect(await killLocalLeftovers(null, deps)).toEqual([]);
    expect(await killLocalLeftovers('/runs/nothing-here', deps)).toEqual([]);
  });

  it('waitForExit reports a process that is still there', async () => {
    expect(await waitForExit(1, 0, { wait: async () => undefined }, () => true)).toBe(false);
    expect(await waitForExit(1, 0, { wait: async () => undefined }, () => false)).toBe(true);
  });
});

describe('leftovers of a local run, for real', () => {
  const folders: string[] = [];
  afterEach(() => { for (const f of folders.splice(0)) fs.rmSync(f, { recursive: true, force: true }); });

  it('stops a task that stayed behind after its Nextflow was killed', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-leftover-'));
    folders.push(folder);
    fs.mkdirSync(path.join(folder, 'work', 'ab'), { recursive: true });
    const task = path.join(folder, 'work', 'ab', '.command.sh');
    fs.writeFileSync(task, '#!/bin/bash\nsleep 300\n', { mode: 0o755 });
    // A task like Nextflow's: its own process (the shell running .command.sh), no parent left to stop it.
    const child = spawn('bash', [task], { detached: true, stdio: 'ignore' });
    child.unref();
    const pid = child.pid!;
    const alive = (p: number) => { try { process.kill(p, 0); return true; } catch { return false; } };
    expect(alive(pid)).toBe(true);
    const gone = await killLocalLeftovers(folder, undefined, 500);
    expect(gone).toContain(pid);
    for (let i = 0; i < 20 && alive(pid); i += 1) await new Promise((r) => setTimeout(r, 100));
    // The child is a zombie until reaped by its parent (this test process); ps then shows it as defunct.
    const state = (() => { try { return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim(); } catch { return ''; } })();
    expect(state === '' || state.startsWith('Z')).toBe(true);
  });
});
