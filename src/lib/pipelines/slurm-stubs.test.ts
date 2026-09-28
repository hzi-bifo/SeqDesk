/**
 * The SLURM path without a cluster: STUB sbatch/squeue/sacct (scripts/test-slurm-stubs, test only) print canned
 * scheduler output per state, and the plain status reads it like real output. Also the pure parts of Resume and of
 * pairing FASTQ files in Data into samples.
 */
import { execFileSync } from 'child_process';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseSacct, parseSqueue, plainRunStatus } from './plain-status';
import { normalizeOverrides, resumeConfig, resumeScript } from './run-resume';
import { pairFastqFiles, readsWords } from './data-study';

const STUBS = path.join(__dirname, '..', '..', '..', 'scripts', 'test-slurm-stubs');
const run = (command: string, state: string, args: string[] = []) =>
  execFileSync(path.join(STUBS, command), args, { env: { ...process.env, SLURM_STUB_STATE: state }, encoding: 'utf8' });
const now = new Date('2026-09-28T12:00:00Z');

describe('STUB SLURM commands (test only)', () => {
  it('sbatch prints a job id', () => { expect(run('sbatch', 'running', ['--parsable', 'run.sh']).trim()).toBe('4819227'); });
  it.each([
    ['pending-priority', 'Waiting in the queue · other jobs go first', 'cancel'],
    ['pending-resources', 'Waiting for a free node with 256 GB', 'ask-less-memory'],
    ['pending-qos', 'Waiting: your lab already has its maximum of jobs running', 'see-jobs'],
  ])('queued (%s) from squeue', (state, sentence, action) => {
    const [line] = parseSqueue(run('squeue', state));
    const status = plainRunStatus({ now, run: { status: 'queued', executionMode: 'slurm', queueJobId: line.jobId, queueStatus: line.state, queueReason: line.reason, askedMemory: '256 GB' } });
    expect([status.word, status.sentence, status.action?.kind]).toEqual(['Queued', sentence, action]);
  });
  it('running from squeue', () => {
    const [line] = parseSqueue(run('squeue', 'running'));
    const status = plainRunStatus({ now, run: { status: 'running', executionMode: 'slurm', queueJobId: line.jobId, queueStatus: line.state, startedAt: '2026-09-28T11:00:00Z' } });
    expect(status.shape).toBe('running');
  });
  it.each([['oom', 'memory', 'resume'], ['timeout', 'time', 'resume'], ['node-fail', 'node', 'resume']])('failed (%s) from sacct', (state, kind, action) => {
    const sacct = run('sacct', state);
    expect(parseSacct(sacct).length).toBe(2);
    const status = plainRunStatus({ now, run: { status: 'failed', executionMode: 'slurm', queueJobId: '4819227', askedMemory: '64 GB', timeLimitHours: 12 }, sacct });
    expect([status.error?.kind, status.action?.kind]).toEqual([kind, action]);
  });
  it('a finished job has left the queue', () => { expect(parseSqueue(run('squeue', 'completed'))).toEqual([]); });
});

describe('Resume', () => {
  const runSh = `#!/bin/bash
#SBATCH -t 12:0:0
echo "Starting nf-core/mag v3.0.0 pipeline at $(date)" > "$STDOUT_LOG"
echo "" > "$STDERR_LOG"

# Run nf-core/mag v3.0.0
"\${NEXTFLOW_RUNNER[@]}" run 'nf-core/mag' \\
  --input '/runs/MAG-002/samplesheet.csv' \\
  -name MAG-002-cmabc \\
  -with-trace '/runs/MAG-002/trace.txt' \\
  >> "$STDOUT_LOG" 2>> "$STDERR_LOG"
`;
  it('adds -resume and the config, appends logs and raises the head job time', () => {
    const script = resumeScript(runSh, '/runs/MAG-002/resume-1.config', 24);
    expect(script).toContain(`run 'nf-core/mag' \\\n  -resume \\\n  -c '/runs/MAG-002/resume-1.config' \\\n  --input`);
    expect(script).toContain('echo "Resuming nf-core/mag v3.0.0 pipeline at $(date)" >> "$STDOUT_LOG"');
    expect(script).toContain('echo "" >> "$STDERR_LOG"');
    expect(script).toContain('#SBATCH -t 25:0:0');
    expect(script).toContain("-name 'MAG-002-cmabc-r1'");
    expect(resumeScript(runSh, '/x', null, 3)).toContain("-name 'MAG-002-cmabc-r3'");
    expect(() => resumeScript('#!/bin/bash\necho hi\n', '/x')).toThrow(/no Nextflow command/);
  });
  it('writes memory/time for one step, and always lets the reports be overwritten', () => {
    const config = resumeConfig(normalizeOverrides({ process: 'MEGAHIT', memory: '256 GB', time: '24 h' }));
    expect(config).toContain('trace.overwrite = true');
    expect(config).toContain("withName: '.*:?MEGAHIT' {\n    memory = 256.GB\n    time = 24.h");
    expect(resumeConfig(normalizeOverrides({}))).not.toContain('process {');
    expect(() => normalizeOverrides({ memory: 'lots' })).toThrow(/128 GB/);
    expect(() => normalizeOverrides({ process: "x'; rm -rf" })).toThrow();
    expect(normalizeOverrides({ time: '2 d' }).hours).toBe(48);
    expect(normalizeOverrides({ time: '30 s' }).time).toBe('30.s');
    expect(normalizeOverrides({ time: '10 min' }).time).toBe('10.m');
  });
});

describe('FASTQ files in Data → samples', () => {
  const f = (name: string) => ({ id: name, name, sizeBytes: 1 });
  it('pairs _1/_2 and _R1_001/_R2_001, keeps single files single', () => {
    const pairs = pairFastqFiles([f('ERR10419931_1.fastq.gz'), f('ERR10419931_2.fastq.gz'), f('M7_R1_001.fq.gz'), f('M7_R2_001.fq.gz'), f('long.fastq'), f('notes.txt')]);
    expect(pairs.map((p) => [p.sampleId, p.r1.name, p.r2?.name ?? null])).toEqual([
      ['ERR10419931', 'ERR10419931_1.fastq.gz', 'ERR10419931_2.fastq.gz'], ['long', 'long.fastq', null], ['M7', 'M7_R1_001.fq.gz', 'M7_R2_001.fq.gz']]);
    expect(readsWords(pairs)).toBe('2 FASTQ pairs + 1 single FASTQ file');
    expect(readsWords([])).toBe('no FASTQ files');
  });
});
