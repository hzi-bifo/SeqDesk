import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { classifyFailure, durationWords, firstErrorLines, logProgress, parseSacct, prepareFailureWords, parseSqueue, plainRunStatus, redactLog, slurmReasonWords, slurmRefusal } from './plain-status';

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
  it('strips Nextflow log prefixes and colours from the first lines', () => {
    const lines = firstErrorLines(["Sep-28 09:49:17.433 [Task monitor] ERROR nextflow.processor.TaskProcessor - Error executing process > 'RUN_FASTQC (ERR10419931)'", '\u001b[31mERROR ~ boom\u001b[39m\u001b[K']);
    expect(lines).toEqual(["Error executing process > 'RUN_FASTQC (ERR10419931)'", 'ERROR ~ boom']);
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
    expect(status.sentence).toBe('A step hit the 12 h time limit');
  });
  it('failed: the time limit a Resume set is the one it hit', () => {
    // Real Slurm: Resume with "1 min"; Nextflow's --signal B:USR2@30 ends the task job with exit 140 before SLURM's TIMEOUT.
    const trace = ['task_id\thash\tnative_id\tprocess\ttag\tname\tstatus\texit\tattempt\tsubmit\tstart\tcomplete\tduration\trealtime\t%cpu\tpeak_rss\tpeak_vmem\trchar\twchar',
      '1\t63/10d94b\t46\tRUN_FASTQC\tERR10419931\tRUN_FASTQC (ERR10419931)\tFAILED\t140\t1\t2026-09-28 12:08:11.000\t2026-09-28 12:08:11.000\t2026-09-28 12:08:41.000\t30s\t30s\t1.0\t2 MB\t5 MB\t0\t0'].join('\n');
    const status = plainRunStatus({ now, trace, run: { status: 'failed', executionMode: 'slurm', timeLimitHours: 1, resumedTimeLimitSeconds: 60 } });
    expect(status.error?.kind).toBe('time');
    expect([status.sentence, status.action?.label, status.action?.time]).toEqual(['FastQC hit the 1 min time limit', 'Resume with 2 min', '2 min']);
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
    // "Resources" is cores or memory: Cancel stays the visible action; less memory only when SLURM names memory.
    expect(resources.action?.kind).toBe('cancel');
    expect(plainRunStatus({ now, run: { status: 'queued', executionMode: 'slurm', queueJobId: '2', queueStatus: 'PENDING', queueReason: 'MaxMemPerLimit', askedMemory: '256 GB' } }).action?.kind).toBe('ask-less-memory');
    const qos = plainRunStatus({ now, run: { status: 'queued', executionMode: 'slurm', queueJobId: '1', queueStatus: 'PENDING', queueReason: 'QOSMaxJobsPerUserLimit' } });
    expect([qos.sentence, qos.action?.kind]).toEqual(['Waiting: your lab already has its maximum of jobs running', 'cancel']);
  });
  it('running: step of steps, estimate only from past runs', () => {
    const run = { status: 'running', executionMode: 'local', startedAt: '2026-09-28T11:59:00Z' };
    const none = plainRunStatus({ now, run, trace: fixture('trace-running.txt') });
    expect(none.sentence).toBe('Running · step 2 of 2: collecting statistics · no estimate yet');
    const past = plainRunStatus({ now, run, trace: fixture('trace-running.txt'), pastSeconds: [300, 360, 420] });
    expect(past.sentence).toBe('Running · step 2 of 2: collecting statistics · ~5 min left');
  });
  it('running on SLURM before the first task ends: the console log, not "Preparing software"', () => {
    // Nextflow's console log as a SLURM run writes it while RUN_FASTQC runs; trace.txt has no row until a task ends.
    const link = (hash: string) => `[\u001b]8;;file:///runs/FASTQC-1/work/${hash}/b65bae5d71e03ac5a753e9745c4cb9\u0007${hash}/b65bae\u001b]8;;\u0007]`;
    const tail = ['Starting ./workflow (local) pipeline at Mon Sep 28 11:32:55 AM CEST 2026', 'Using nextflow: /conda/envs/seqdesk-pipelines/bin/nextflow', '',
      ' N E X T F L O W   ~  version 26.04.6', '', 'Launching `/pipelines/fastqc/workflow/main.nf` [FASTQC-1] revision: 83ff1a4f58', '',
      '[-        ] RUN_FASTQC       -', '[-        ] SUMMARIZE_FASTQC -', '', 'executor >  slurm (1)',
      `${link('ef')} RUN_FASTQC (ERR10419931) | 0 of 1`, '[-        ] SUMMARIZE_FASTQC         -', ''].join('\n');
    expect(logProgress(tail)).toEqual({ submitted: 1, processes: [{ name: 'RUN_FASTQC', done: 0, total: 1 }, { name: 'SUMMARIZE_FASTQC', done: 0, total: 0 }], steps: 2 });
    // A redrawn block that leaves out the process not reached yet still counts both steps.
    expect(plainRunStatus({ now, run: { status: 'running', executionMode: 'slurm', queueStatus: 'RUNNING', outputTail: tail.replace('[-        ] SUMMARIZE_FASTQC         -\n', '') } }).sentence).toBe('Running · step 1 of 2: FastQC · no estimate yet');
    const running = plainRunStatus({ now, run: { status: 'running', executionMode: 'slurm', queueJobId: '30', queueStatus: 'RUNNING', startedAt: '2026-09-28T11:59:00Z', outputTail: tail }, trace: 'task_id\thash\n' });
    expect([running.shape, running.sentence]).toEqual(['running', 'Running · step 1 of 2: FastQC · no estimate yet']);
    // Shortened names keep no name; before any task is submitted it is still preparing.
    expect(logProgress(`executor >  slurm (2)\n${link('ac')} SUMM…ZE_FASTQC (fastqc-summary) | 0 of 1`)?.processes).toEqual([{ name: '', done: 0, total: 1 }]);
    const later = `${tail}\nexecutor >  slurm (2)\n${link('ef')} RUN_FASTQC (ERR10419931)       | 1 of 1 ✔\n${link('ac')} SUMM…ZE_FASTQC (fastqc-summary) | 0 of 1\n`;
    expect(logProgress(later)?.processes.map((p) => p.name)).toEqual(['RUN_FASTQC', 'SUMMARIZE_FASTQC']);
    const before = tail.split('executor >')[0];
    expect(plainRunStatus({ now, run: { status: 'running', executionMode: 'slurm', queueStatus: 'RUNNING', outputTail: before } }).shape).toBe('preparing');
  });
  it('running on SLURM while its next task job waits for a drained node', () => {
    // Real Slurm 24.11: RUN_FASTQC is done (in the trace), SUMMARIZE_FASTQC's job waits; the monitor keeps its reason.
    const trace = fixture('trace-running.txt').split('\n')[0];
    const tail = ['executor >  slurm (2)', '[fe/7415e1] RUN_FASTQC (ERR10419931)       | 1 of 1 ✔', '[ac/841b18] SUMMARIZE_FASTQC (fastqc-summary) | 0 of 1'].join('\n');
    const run = { status: 'running', executionMode: 'slurm', queueJobId: '35', queueStatus: 'RUNNING', startedAt: '2026-09-28T11:57:00Z', outputTail: tail,
      queueReason: 'Nodes required for job are DOWN, DRAINED or reserved for jobs in higher priority partitions' };
    expect(plainRunStatus({ now, run, trace, pastSeconds: [30] }).sentence).toBe('Running · step 2 of 2: the FastQC summary · waiting: the nodes it needs are down or reserved');
    expect(plainRunStatus({ now, run: { ...run, queueReason: null }, trace, pastSeconds: [30] }).sentence).toBe('Running · step 2 of 2: the FastQC summary · taking longer than past runs');
  });
  it('a task job cancelled with scancel is said as such, with Resume', () => {
    const trace = ['task_id\thash\tnative_id\tprocess\ttag\tname\tstatus\texit\tattempt\tsubmit\tstart\tcomplete\tduration\trealtime\t%cpu\tpeak_rss\tpeak_vmem\trchar\twchar',
      '1\tb1/aa22cc\t48\tRUN_FASTQC\tERR10419931\tRUN_FASTQC (ERR10419931)\tFAILED\t143\t1\t2026-09-28 12:10:40.000\t2026-09-28 12:10:40.000\t2026-09-28 12:10:59.000\t19s\t19s\t1.0\t2 MB\t5 MB\t0\t0'].join('\n');
    const status = plainRunStatus({ now, trace, run: { status: 'failed', executionMode: 'slurm', queueJobId: '47' },
      taskError: 'slurmstepd: error: *** JOB 48 ON pmuench-X399-DESIGNARE-EX CANCELLED AT 2026-09-28T12:10:59 ***' });
    expect([status.sentence, status.action?.kind]).toEqual(['FastQC was stopped outside SeqDesk: its SLURM job was cancelled', 'resume']);
  });
  it('Nextflow could not submit a task because the controller was down: Resume, in words', () => {
    // Real Slurm: slurmctld stopped while RUN_FASTQC ran; Nextflow's sbatch for SUMMARIZE_FASTQC failed.
    const errorTail = ["ERROR ~ Error executing process > 'SUMMARIZE_FASTQC (fastqc-summary)'", '', 'Caused by:', '  Failed to submit process to grid scheduler for execution', '',
      'Command executed:', '', '  sbatch .command.run', '', 'Command exit status:', '  1', '', 'Command output:',
      '  sbatch: error: Batch job submission failed: Unable to contact slurm controller (connect failure)'].join('\n');
    const status = plainRunStatus({ now, run: { status: 'failed', executionMode: 'slurm', queueJobId: '66', errorTail } });
    expect([status.sentence, status.action?.kind]).toEqual(['Couldn’t hand the FastQC summary to SLURM: the SLURM controller did not answer', 'resume']);
  });
  it('every task ended but SLURM cannot confirm the job yet (slurmdbd down)', () => {
    const run = { status: 'running', executionMode: 'slurm', queueJobId: '68', queueStatus: 'RUNNING', currentStep: 'Waiting for scheduler confirmation...', startedAt: '2026-09-28T11:50:00Z' };
    expect(plainRunStatus({ now, run, trace: fixture('trace-running.txt'), pastSeconds: [30] }).sentence).toBe('All steps ended · waiting for SLURM to confirm the job (SLURM is not answering)');
  });
  it('a task job SLURM already ended is said at once, before Nextflow notices', () => {
    const run = { status: 'running', executionMode: 'slurm', queueJobId: '38', queueStatus: 'RUNNING', startedAt: '2026-09-28T11:58:00Z', queueReason: 'ended:memory:RUN_FASTQC' };
    expect(plainRunStatus({ now, run }).sentence).toBe('FastQC ran out of memory · Nextflow is still noticing');
    expect(plainRunStatus({ now, run: { ...run, queueReason: 'ended:cancelled:RUN_FASTQC' } }).sentence).toBe('FastQC was cancelled outside SeqDesk · Nextflow is still noticing');
  });
  it('an active run whose status nobody checked for a while says how old it is', () => {
    const run = { status: 'running', executionMode: 'slurm', queueJobId: '38', queueStatus: 'RUNNING', startedAt: '2026-09-28T11:50:00Z', outputTail: 'executor >  slurm (1)\n[ab/cdef12] RUN_FASTQC (s1) | 0 of 1' };
    expect(plainRunStatus({ now, run: { ...run, checkedAt: '2026-09-28T11:59:30Z' } }).sentence).not.toMatch(/last checked/);
    expect(plainRunStatus({ now, run: { ...run, checkedAt: '2026-09-28T11:52:00Z' } }).sentence).toMatch(/ · status last checked 8 min ago$/);
    expect(plainRunStatus({ now, run: { ...run, status: 'completed', checkedAt: '2026-09-28T10:00:00Z' } }).sentence).not.toMatch(/last checked/);
  });
  it('the step count keeps the pipeline’s declared steps when the log tail lost the first block', () => {
    const run = { status: 'running', executionMode: 'slurm', queueJobId: '38', queueStatus: 'RUNNING', outputTail: 'executor >  slurm (1)\n[ab/cdef12] RUN_FASTQC (s1) | 0 of 1', declaredSteps: 2 };
    expect(plainRunStatus({ now, run }).sentence).toBe('Running · step 1 of 2: FastQC · no estimate yet');
  });
  it('a requeued job (node failure) says so instead of "Waiting for its start time"', () => {
    const run = { status: 'queued', executionMode: 'slurm', queueJobId: '99', queueStatus: 'PENDING', queueReason: 'BeginTime', startedAt: '2026-09-28T11:51:00Z', queuedAt: '2026-09-28T11:58:00Z' };
    expect(plainRunStatus({ now, run }).sentence).toBe('SLURM put it back in the queue (its node failed or it was requeued); it resumes shortly · waiting 2 min');
    expect(plainRunStatus({ now, run: { ...run, startedAt: null } }).sentence).toBe('Waiting for its start time · waiting 2 min');
  });
  it('Nextflow itself killed (kill -9 of its Java) says so, with Resume', () => {
    const outputTail = ['executor >  slurm (1)', '[7b/360c6c] RUN_FASTQC (ERR10419931) | 0 of 1', '[-        ] SUMMARIZE_FASTQC         -', 'Pipeline completed with exit code: 137 at Mon Sep 28 02:26:33 PM CEST 2026'].join('\n');
    const status = plainRunStatus({ now, run: { status: 'failed', executionMode: 'slurm', queueJobId: '110', outputTail } });
    expect([status.sentence, status.action?.kind]).toEqual(['Nextflow itself was stopped before it finished (exit 137) · Resume continues where it stopped', 'resume']);
  });
  it('a run whose folder was deleted says it cannot go on, with Run again', () => {
    const run = { status: 'running', executionMode: 'slurm', queueJobId: '112', queueStatus: 'RUNNING', folderMissing: true };
    expect([plainRunStatus({ now, run }).sentence, plainRunStatus({ now, run }).action?.kind]).toEqual(['Its run folder is gone, so it cannot go on or be resumed · Run it again', 'run-again']);
    expect(plainRunStatus({ now, run: { ...run, status: 'completed' } }).shape).toBe('finished');
  });
  it('a run folder Compute may not write says so, not "Failed at a step"', () => {
    const errorTail = "Failed to prepare run: EACCES: permission denied, mkdir '/data/e2e/runs/FASTQC-20260928-035--id-cmul89h3n'";
    const status = plainRunStatus({ now, run: { status: 'failed', executionMode: 'slurm', queueJobId: null, errorTail } });
    expect([status.sentence, status.action?.kind]).toEqual(['Compute may not write its run folder (/data/e2e/runs): permission denied', 'ask-admin']);
    expect(prepareFailureWords("Failed to prepare run: ENOSPC: no space left on device, write '/x/y--id-z'")).toBe('The disk for run folders is full (/x)');
  });
  it('a task job held by a job limit says the run’s own job counts too', () => {
    // Real Slurm, MaxJobs=1 with limits enforced: the run's job runs, nf-RUN_FASTQC waits with AssocMaxJobsLimit.
    const run = { status: 'running', executionMode: 'slurm', queueJobId: '117', queueStatus: 'RUNNING', queueReason: 'AssocMaxJobsLimit', outputTail: 'executor >  slurm (1)\n[ab/cdef12] RUN_FASTQC (s1) | 0 of 1', declaredSteps: 2 };
    expect(plainRunStatus({ now, run }).sentence).toBe('Running · step 1 of 2: FastQC · waiting: your lab already has its maximum of jobs running (this run’s own job counts too; ask the admin if it does not move)');
  });
  it('sbatch refused the job: says why, not "Failed at a step"', () => {
    // As a real Slurm 24.11 answered, the run kept the launcher's message as its error tail and has no job id.
    const drained = 'sbatch exited with code 1: sbatch: error: Batch job submission failed: Required partition not available (inactive or drain)';
    const run = { status: 'failed', executionMode: 'slurm', queueJobId: null, errorTail: drained, queue: 'cpu', askedMemory: '4GB', askedCores: 2 };
    const status = plainRunStatus({ now, run });
    expect([status.shape, status.sentence, status.action?.kind]).toEqual(['needs-you', 'SLURM did not take the job: the cpu queue is closed for new jobs (drained or inactive)', 'retry']);
    expect(status.error?.firstLines[0]).toMatch(/Required partition not available/);
    const asked = { queue: 'cpu', memory: '500GB', cores: 2 };
    expect(slurmRefusal('sbatch: error: Batch job submission failed: Requested node configuration is not available', asked)).toEqual({ words: 'no node in the cpu queue has 2 cores and 500 GB', retry: false });
    expect(slurmRefusal('sbatch: error: Memory specification can not be satisfied\nsbatch: error: Batch job submission failed: Requested node configuration is not available', asked)?.words).toBe('no node in the cpu queue has 2 cores and 500 GB');
    expect(slurmRefusal('sbatch exited with code 1: sbatch: error: invalid partition specified: gpu\nsbatch: error: Batch job submission failed: Invalid partition name specified', { queue: 'gpu' })?.words).toBe('there is no queue called gpu on this cluster');
    expect(slurmRefusal('Failed to run sbatch: spawn sbatch ENOENT')?.words).toBe('sbatch did not say why');
    expect(slurmRefusal('Error executing process > FASTQC')).toBeNull();
    // A queued run's sentence says what it waits for in the same words.
    expect(plainRunStatus({ now, run: { status: 'queued', executionMode: 'slurm', queueJobId: '35', queueStatus: 'PENDING', queueReason: 'Resources', askedMemory: '4GB', askedCores: 2 } }).sentence).toBe('Waiting for a free node with 2 cores and 4 GB');
  });
  it('finished, cancelled and preparing', () => {
    expect(plainRunStatus({ now, run: { status: 'completed', startedAt: '2026-09-28T09:00:00Z', completedAt: '2026-09-28T12:12:00Z', outputCount: 3 } }).sentence).toBe('Finished in 3 h 12 min · 3 outputs in Data');
    const cancelled = plainRunStatus({ now, run: { status: 'cancelled' }, trace: fixture('trace-oom.txt') });
    expect([cancelled.sentence, cancelled.action?.label]).toEqual(['Cancelled at assembly · 2 finished steps are kept', 'Run again']);
    expect(plainRunStatus({ now, run: { status: 'running', executionMode: 'local', outputTail: 'Creating env using conda: bioconda::seqkit=2.8.0' } }).shape).toBe('preparing');
    expect(plainRunStatus({ now, run: { status: 'pending' } }).sentence).toBe('Preparing to start');
  });
  it('words for durations', () => {
    expect([durationWords(38), durationWords(600), durationWords(11520), durationWords(7200)]).toEqual(['38 s', '10 min', '3 h 12 min', '2 h']);
  });
});
