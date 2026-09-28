import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { checkServerReadiness, parseSinfo, testServer, type Exec } from './pipeline-admin';
import type { ExecutionSettings } from './execution-settings';

const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-admin-'));
const settings = (useSlurm: boolean) => ({ useSlurm, slurmQueue: 'cpu', condaPath: '', condaEnv: '', pipelineRunDir: runDir } as unknown as ExecutionSettings);
// Answers as a real single-node Slurm 24.11 and Nextflow 26.04 gave them on elektra.
const answers: Record<string, { stdout: string; stderr?: string } | Error> = {
  'nextflow -version': { stdout: '\n      N E X T F L O W\n      version 26.04.6 build 5979\n' },
  'java -version': { stdout: '', stderr: 'openjdk version "17.0.13" 2024-10-15' },
  'micromamba --version': { stdout: '2.0.5' },
  'sinfo -h -o %P|%a|%D|%T': { stdout: 'cpu*|up|1|idle\n' },
};
const exec = (extra: typeof answers = {}): Exec => async (file, args) => {
  const key = `${file} ${args.join(' ')}`;
  const found = [...Object.entries(extra), ...Object.entries(answers)].find(([k]) => key.startsWith(k))?.[1];
  if (!found) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
  if (found instanceof Error) throw found;
  return found;
};

describe('whether this Compute server can run pipelines', () => {
  it('lists the checks in words, with SLURM queues from sinfo', async () => {
    const ready = await checkServerReadiness(exec(), settings(true));
    expect(ready.ok).toBe(true);
    expect(ready.checks.map((c) => c.line)).toEqual(['Nextflow 26.04.6', 'Java 17', "micromamba 2.0.5 · builds each step's software", `Run folders go to ${runDir}`, 'SLURM queue cpu is up · 1 node · idle']);
    expect(ready.queues).toEqual([{ name: 'cpu', up: true, nodes: 1, state: 'idle' }]);
  });
  it('says what is missing: a drained queue, no SLURM answer, no Java', async () => {
    expect((await checkServerReadiness(exec({ 'sinfo -h': { stdout: 'cpu*|inact|1|drain\n' } }), settings(true))).checks.at(-1)?.line).toBe('SLURM queue cpu is drain');
    const down = await checkServerReadiness(exec({ 'sinfo -h': Object.assign(new Error('x'), { stderr: 'slurm_load_partitions: Unable to contact slurm controller (connect failure)' }) }), settings(true));
    expect([down.ok, down.checks.at(-1)?.line]).toEqual([false, 'SLURM did not answer: slurm_load_partitions: Unable to contact slurm controller (connect failure)']);
    const noJava = await checkServerReadiness(exec({ 'java -version': Object.assign(new Error('x'), { code: 'ENOENT' }) }), settings(false));
    expect(noJava.checks.find((c) => c.id === 'java')).toEqual({ id: 'java', ok: false, line: 'Java: not found' });
    expect(parseSinfo('cpu*|up|1|idle\ngpu|down|2|down*\n').map((q) => q.name)).toEqual(['cpu', 'gpu']);
    // elektra: the pipeline environment has no micromamba of its own; the kit's is on PATH.
    const kit = { ...settings(true), condaPath: '/data/conda', condaEnv: 'seqdesk-pipelines' } as ExecutionSettings;
    const onPath = await checkServerReadiness(async (file, args) => {
      if (file === 'micromamba') return { stdout: '2.0.5' };
      if (file.endsWith('/nextflow')) throw Object.assign(new Error('x'), { code: 'ENOENT' });
      return exec()(file, args);
    }, kit);
    expect(onPath.checks.find((c) => c.id === 'conda')?.line).toBe("micromamba 2.0.5 · builds each step's software");
  });
});

describe('the pipeline environment’s own Java', () => {
  it('a Mac’s conda openjdk keeps bin/java under lib/jvm: the check finds it and Nextflow gets JAVA_HOME', async () => {
    // Real Mac (Nextflow in a conda env, /usr/bin/java is the "Unable to locate a Java Runtime" stub): every run worked,
    // the admin page said "Java: not found".
    const conda = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-admin-conda-'));
    const env = path.join(conda, 'envs', 'seqdesk-pipelines');
    fs.mkdirSync(path.join(env, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(env, 'lib', 'jvm', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(env, 'bin', 'nextflow'), '');
    fs.writeFileSync(path.join(env, 'lib', 'jvm', 'bin', 'java'), '');
    const seen: { file: string; javaHome?: string }[] = [];
    const mac = async (file: string, args: string[], options?: { env?: Record<string, string> }) => {
      seen.push({ file, javaHome: options?.env?.JAVA_HOME });
      if (file.endsWith('/nextflow')) {
        if (!options?.env?.JAVA_HOME) throw Object.assign(new Error('x'), { stderr: 'Unable to locate a Java Runtime.' });
        return { stdout: 'version 25.10.4 build 1' };
      }
      if (file.endsWith('/lib/jvm/bin/java')) return { stdout: '', stderr: 'openjdk version "17.0.11" 2024-04-16' };
      return exec()(file, args);
    };
    const ready = await checkServerReadiness(mac, { ...settings(false), condaPath: conda, condaEnv: 'seqdesk-pipelines' } as ExecutionSettings);
    expect(ready.checks.filter((c) => ['nextflow', 'java'].includes(c.id)).map((c) => c.line)).toEqual(['Nextflow 25.10.4', 'Java 17']);
    expect(seen.find((c) => c.file.endsWith('/nextflow'))?.javaHome).toBe(path.join(env, 'lib', 'jvm'));
  });
});

describe('test this server', () => {
  it('sends a tiny job through SLURM and reports what it saw', async () => {
    let t = 0;
    const calls: string[] = [];
    const run: Exec = async (file, args) => {
      calls.push(`${file} ${args[0]}`);
      if (file === 'sbatch') { const out = args[args.indexOf('-o') + 1]; fs.writeFileSync(out, 'host node01\ncores 1\nversion 26.04.6\n'); return { stdout: '301\n' }; }
      if (file === 'squeue') return { stdout: '' };
      if (file === 'sacct') return { stdout: 'COMPLETED\n' };
      throw new Error('unexpected');
    };
    const result = await testServer(run, settings(true), { pollMs: 0, now: () => (t += 1000) });
    expect(result).toMatchObject({ ok: true, jobId: '301', sentence: 'SLURM ran the test job', output: ['host node01', 'cores 1', 'version 26.04.6'] });
    expect(calls).toEqual(['sbatch --parsable', 'squeue -h', 'sacct -n']);
  });
  it('a job SLURM refuses or that keeps waiting is said plainly, and a waiting one is cancelled', async () => {
    const refused = await testServer(async () => { throw Object.assign(new Error('x'), { stderr: 'sbatch: error: Batch job submission failed: Required partition not available (inactive or drain)' }); }, settings(true), { pollMs: 0 });
    expect(refused.sentence).toBe('SLURM did not take the test job: the cpu queue is closed for new jobs (drained or inactive)');
    let t = 0;
    const cancelled: string[] = [];
    const waiting = await testServer(async (file, args) => {
      if (file === 'sbatch') return { stdout: '302' };
      if (file === 'squeue') return { stdout: 'PENDING|Resources\n' };
      if (file === 'scancel') { cancelled.push(args[0]); return { stdout: '' }; }
      throw new Error('unexpected');
    }, settings(true), { pollMs: 0, waitMs: 5000, now: () => (t += 1000) });
    expect([waiting.ok, waiting.sentence, cancelled]).toEqual([false, 'The test job was still waiting after 5 s (Resources); it was cancelled', ['302']]);
  });
});
