/**
 * Pipelines on this Compute server, for its admin in the web app's Library (S-25L, admin part): which pipelines are
 * on, whether the server can run them (Nextflow, Java, conda; SLURM reachable with its queues, or the local machine),
 * and a "test this server" job that goes the whole way through the executor and reports back in plain words.
 * Replaces switching pipelines on by inserting PipelineConfig rows.
 */
import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { getExecutionSettings, type ExecutionSettings } from './execution-settings';
import { slurmRefusal, durationWords } from './plain-status';

const run = promisify(execFile);
export type Exec = (file: string, args: string[], options?: { timeout?: number; cwd?: string; env?: Record<string, string> }) => Promise<{ stdout: string; stderr?: string }>;
const defaultExec: Exec = (file, args, options) => run(file, args, { timeout: options?.timeout ?? 20_000, cwd: options?.cwd, maxBuffer: 1 << 20, ...(options?.env ? { env: { ...process.env, ...options.env } } : {}) });

export interface ReadinessCheck { id: string; ok: boolean; line: string }
export interface ServerReadiness { mode: 'slurm' | 'local'; ok: boolean; checks: ReadinessCheck[]; queues: { name: string; up: boolean; nodes: number; state: string }[] }

async function tryRun(exec: Exec, file: string, args: string[], timeout = 20_000, env?: Record<string, string>): Promise<{ ok: boolean; text: string }> {
  try {
    const { stdout, stderr } = await exec(file, args, { timeout, ...(env ? { env } : {}) });
    return { ok: true, text: `${stdout}\n${stderr ?? ''}`.trim() };
  } catch (error) {
    const e = error as { code?: unknown; stderr?: string; message?: string };
    return { ok: false, text: e.code === 'ENOENT' ? 'not found' : (e.stderr || e.message || 'failed').trim().split('\n')[0] };
  }
}

/** The pipeline environment's own tools when there is one (the runs use it), else whatever is on PATH. */
function tool(settings: ExecutionSettings, name: string): string {
  return settings.condaPath && settings.condaEnv ? path.join(settings.condaPath, 'envs', settings.condaEnv, 'bin', name) : name;
}
async function exists(file: string) { return fs.access(file).then(() => true, () => false); }
/** The pipeline environment's JAVA_HOME (<env>/lib/jvm) when it has a Java there, else ''. */
async function environmentJavaHome(s: ExecutionSettings): Promise<string> {
  const home = s.condaPath && s.condaEnv ? path.join(s.condaPath, 'envs', s.condaEnv, 'lib', 'jvm') : '';
  return home && await exists(path.join(home, 'bin', 'java')) ? home : '';
}

/** `sinfo -h -o "%P|%a|%D|%T"` → queues (the default queue keeps its name without the trailing *). */
export function parseSinfo(text: string): ServerReadiness['queues'] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const [name = '', avail = '', nodes = '0', state = ''] = line.split('|');
    return { name: name.replace(/\*$/, ''), up: avail === 'up', nodes: Number(nodes) || 0, state };
  });
}

export async function checkServerReadiness(exec: Exec = defaultExec, settings?: ExecutionSettings): Promise<ServerReadiness> {
  const s = settings ?? await getExecutionSettings();
  const checks: ReadinessCheck[] = [];
  const nextflowPath = tool(s, 'nextflow');
  // An activated conda environment puts its Java on the path (JAVA_HOME=<env>/lib/jvm, where a Mac's openjdk keeps
  // bin/java); the runs activate it, so the check must find the same Java, not the system's stub ("Unable to locate a Java Runtime").
  const javaHome = await environmentJavaHome(s);
  const javaEnv = javaHome ? { JAVA_HOME: javaHome } : undefined;
  const nextflow = (await exists(nextflowPath)) || nextflowPath === 'nextflow' ? await tryRun(exec, nextflowPath, ['-version'], 60_000, javaEnv) : { ok: false, text: `not found at ${nextflowPath}` };
  const version = /version\s+(\d+\.\d+\.\d+)/.exec(nextflow.text)?.[1];
  checks.push({ id: 'nextflow', ok: nextflow.ok && !!version, line: nextflow.ok && version ? `Nextflow ${version}` : `Nextflow: ${nextflow.text}` });
  const javaPath = javaHome && !(await exists(tool(s, 'java'))) ? path.join(javaHome, 'bin', 'java') : tool(s, 'java');
  const java = await tryRun(exec, javaPath, ['-version']);
  const javaVersion = /version "?(\d+)/.exec(java.text)?.[1];
  checks.push({ id: 'java', ok: java.ok && Number(javaVersion) >= 11, line: java.ok ? `Java ${javaVersion ?? '?'}${Number(javaVersion) >= 11 ? '' : ' · Nextflow needs 11 or newer'}` : `Java: ${java.text}` });
  // The environment's own micromamba, the one on PATH (the Linux kit's), then the conda install's conda.
  const candidates: [string, string][] = [[tool(s, 'micromamba'), 'micromamba'], ['micromamba', 'micromamba'], ...(s.condaPath ? [[path.join(s.condaPath, 'bin', 'conda'), 'conda'] as [string, string]] : []), ['conda', 'conda']];
  let conda = { ok: false, text: 'not found' }, condaName = 'conda';
  for (const [file, name] of candidates) {
    const found = await tryRun(exec, file, ['--version']);
    if (found.ok) { conda = found; condaName = name; break; }
  }
  checks.push({ id: 'conda', ok: conda.ok || !!s.skipConda, line: conda.ok ? `${condaName} ${conda.text.split('\n')[0].replace(/^conda\s+/, '')} · builds each step's software` : s.skipConda ? 'conda is off for this server' : 'Neither micromamba nor conda was found; steps cannot get their software' });
  const runDir = s.pipelineRunDir;
  const writable = runDir ? await fs.access(runDir, (await import('fs')).constants.W_OK).then(() => true, () => false) : false;
  checks.push({ id: 'run-folder', ok: writable, line: writable ? `Run folders go to ${runDir}` : `Compute cannot write its run folder ${runDir || '(not set)'}` });
  let queues: ServerReadiness['queues'] = [];
  if (s.useSlurm) {
    const sinfo = await tryRun(exec, 'sinfo', ['-h', '-o', '%P|%a|%D|%T']);
    queues = sinfo.ok ? parseSinfo(sinfo.text) : [];
    const mine = queues.find((q) => q.name === s.slurmQueue);
    checks.push({ id: 'slurm', ok: sinfo.ok && !!mine?.up,
      line: !sinfo.ok ? `SLURM did not answer: ${sinfo.text}` : !mine ? `SLURM has no queue called ${s.slurmQueue}` : mine.up ? `SLURM queue ${mine.name} is up · ${mine.nodes} node${mine.nodes === 1 ? '' : 's'} · ${mine.state}` : `SLURM queue ${mine.name} is ${mine.state || 'down'}` });
  } else {
    checks.push({ id: 'local', ok: true, line: `Runs on this server · ${os.cpus().length} cores · ${Math.round(os.totalmem() / 1024 ** 3)} GB` });
  }
  return { mode: s.useSlurm ? 'slurm' : 'local', ok: checks.every((c) => c.ok), checks, queues };
}

export interface ServerTest { ok: boolean; sentence: string; jobId: string | null; seconds: number; output: string[] }

/**
 * A tiny job through the real executor: on SLURM an sbatch of one core for a minute that prints where it ran and the
 * Nextflow it finds; locally the same commands here. Waits up to `waitMs` for the answer.
 */
export async function testServer(exec: Exec = defaultExec, settings?: ExecutionSettings, options: { waitMs?: number; pollMs?: number; now?: () => number } = {}): Promise<ServerTest> {
  const s = settings ?? await getExecutionSettings();
  const now = options.now ?? Date.now;
  const started = now();
  const dir = await fs.mkdtemp(path.join(s.pipelineRunDir || os.tmpdir(), '.seqdesk-server-test-'));
  const outFile = path.join(dir, 'test.out');
  const javaHome = await environmentJavaHome(s);
  const script = `${javaHome ? `export JAVA_HOME=${JSON.stringify(javaHome)}; ` : ''}echo "host $(hostname)"; echo "cores \${SLURM_CPUS_ON_NODE:-$(nproc)}"; (${tool(s, 'nextflow')} -version 2>/dev/null | grep -m1 -o 'version [0-9.]*') || echo "nextflow not found"`;
  const finish = async (result: Omit<ServerTest, 'seconds' | 'output'>) => {
    const output = (await fs.readFile(outFile, 'utf8').catch(() => '')).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 10);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return { ...result, output, seconds: Math.round((now() - started) / 1000) };
  };
  if (!s.useSlurm) {
    const local = await tryRun(exec, 'bash', ['-c', `${script} > ${JSON.stringify(outFile)} 2>&1`], 90_000);
    return finish({ ok: local.ok, jobId: null, sentence: local.ok ? 'This server ran the test itself' : `The test failed here: ${local.text}` });
  }
  const submit = await tryRun(exec, 'sbatch', ['--parsable', '-J', 'seqdesk-server-test', '-p', s.slurmQueue, '-c', '1', '--mem=200M', '-t', '2', '-o', outFile, '-D', dir, '--wrap', script]);
  if (!submit.ok) {
    const refusal = slurmRefusal(`sbatch: error: ${submit.text}`, { queue: s.slurmQueue, cores: 1, memory: '200MB' });
    return finish({ ok: false, jobId: null, sentence: `SLURM did not take the test job: ${refusal?.words ?? submit.text}` });
  }
  const jobId = /^(\d+)/.exec(submit.text)?.[1] ?? null;
  const waitMs = options.waitMs ?? 90_000;
  let state = 'PENDING', reason = '';
  while (now() - started < waitMs) {
    const q = await tryRun(exec, 'squeue', ['-h', '-j', String(jobId), '-o', '%T|%r']);
    const line = q.ok ? q.text.split('\n')[0] : '';
    if (line) { [state, reason] = line.split('|'); }
    else {
      const acct = await tryRun(exec, 'sacct', ['-n', '-P', '-X', '-j', String(jobId), '-o', 'State'], 45_000);
      state = acct.ok ? acct.text.split('\n')[0].split(/\s+/)[0] || state : state;
      if (!/^(PENDING|RUNNING|CONFIGURING|COMPLETING)$/.test(state)) break;
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 2000));
  }
  if (state === 'COMPLETED') return finish({ ok: true, jobId, sentence: 'SLURM ran the test job' });
  if (/^(PENDING|RUNNING|CONFIGURING|COMPLETING)$/.test(state)) {
    await tryRun(exec, 'scancel', [String(jobId)]);
    return finish({ ok: false, jobId, sentence: state === 'PENDING' ? `The test job was still waiting after ${durationWords(waitMs / 1000)}${reason && reason !== 'None' ? ` (${reason})` : ''}; it was cancelled` : `The test job did not finish within ${durationWords(waitMs / 1000)}; it was cancelled` });
  }
  return finish({ ok: false, jobId, sentence: `The test job ended as ${state}` });
}
