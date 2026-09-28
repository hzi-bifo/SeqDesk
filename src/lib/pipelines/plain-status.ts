/**
 * A pipeline run in plain words (Analysis sheet S-25P "pipelines and big runs"): one sentence and one action for the
 * card, the stage strip, the per-process table from the Nextflow trace, and — for a failure — the kind of error with
 * the first lines of the real error and what Resume keeps.
 *
 * Pure: every input is text or a record the caller already read (trace.txt, the run's log tails, the failed task's
 * .command.err, squeue/sacct lines). The error kind follows fixed rules over the scheduler state, exit codes and the
 * task's error text, never a guess: anything the rules do not cover is "unknown" and opens the log.
 */
import { parseTraceContent, type NextflowTask } from './nextflow/trace-parser';
import { stripChannelCredentials } from '@/lib/explore/conda-credentials';

export type RunShape = 'preparing' | 'waiting' | 'running' | 'finished' | 'cancelled' | 'needs-you';
export type ErrorKind = 'memory' | 'time' | 'input' | 'database' | 'software' | 'node' | 'unknown';
export type ActionKind = 'cancel' | 'resume' | 'retry' | 'open-outputs' | 'run-again' | 'show-log' | 'fix-data' | 'ask-admin' | 'ask-less-memory' | 'see-jobs';
export type StageState = 'done' | 'running' | 'failed' | 'waiting';

export interface PlainAction { kind: ActionKind; label: string; memory?: string; time?: string }
export interface PlainStage { name: string; state: StageState }
export interface PlainProcess {
  name: string;
  status: 'done' | 'running' | 'failed' | 'waiting';
  tasks: number; done: number; running: number; failed: number;
  cpuHours: number | null; peakBytes: number | null; seconds: number | null;
}
export interface PlainError { kind: ErrorKind; sentence: string; firstLines: string[]; process: string | null; sample: string | null; exitCode: number | null }
export interface PlainKeeps { finishedSteps: number; tasks: number; restartsAt: string | null; words: string }
export interface PlainStatus {
  shape: RunShape;
  /** The state word beside the shape: Preparing, Queued, Running, Finished, Cancelled, Needs you. */
  word: string;
  sentence: string;
  action: PlainAction | null;
  stages: PlainStage[];
  processes: PlainProcess[];
  error: PlainError | null;
  keeps: PlainKeeps | null;
  queue: { jobId: string | null; state: string | null; reason: string | null } | null;
  estimate: { seconds: number | null; words: string };
  elapsedSeconds: number | null;
}

export interface PlainRunInput {
  status: string; // pending | queued | running | completed | failed | cancelled
  executionMode?: string | null; // local | slurm
  queueJobId?: string | null;
  queueStatus?: string | null;
  queueReason?: string | null;
  currentStep?: string | null;
  queuedAt?: Date | string | null;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  outputTail?: string | null;
  errorTail?: string | null;
  /** Memory asked per task (e.g. "64 GB"), for "Waiting for a free node with …" and Resume. */
  askedMemory?: string | null;
  /** SLURM time limit in hours. */
  timeLimitHours?: number | null;
  /** The per-step time limit a Resume set ("time 1.m"), in seconds; it wins over timeLimitHours in the time sentence. */
  resumedTimeLimitSeconds?: number | null;
  /** SLURM queue (partition) and cores asked for, for "SLURM did not take the job" and the queue sentence. */
  queue?: string | null;
  askedCores?: number | null;
  outputCount?: number | null;
}

export interface PlainContext {
  run: PlainRunInput;
  trace?: string | null;
  /** The failed task's .command.err (and .command.log), when the caller could read it. */
  taskError?: string | null;
  /** `sacct -n -P -o JobID,State,ExitCode,Reason,NodeList` lines for the run's job, when available. */
  sacct?: string | null;
  /** Durations (seconds) of past finished runs of the same pipeline at a similar size; empty means no estimate. */
  pastSeconds?: number[];
  now?: Date;
}

// ------------------------------------------------------------------ redaction

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{16,}\b/g, 'REDACTED'],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, 'REDACTED'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'REDACTED'],
  [/\b(authorization:\s*bearer\s+)[^\s"']+/gi, '$1REDACTED'],
  [/\b((?:api[_-]?key|token|secret|password|passwd)\s*[=:]\s*)[^\s"'&]+/gi, '$1REDACTED'],
];

/** Strip conda channel credentials and common token shapes from log text before it leaves the server. */
export function redactLog(text: string): string {
  let clean = stripChannelCredentials(text);
  for (const [pattern, replacement] of SECRET_PATTERNS) clean = clean.replace(pattern, replacement);
  return clean;
}

// ------------------------------------------------------------------ scheduler lines

export interface SlurmLine { jobId: string; state: string; exitCode: number | null; signal: number | null; reason: string | null; nodes: string | null }

/** `sacct -n -P -o JobID,State,ExitCode,Reason,NodeList` → one record per line (steps included). */
export function parseSacct(text: string | null | undefined): SlurmLine[] {
  if (!text) return [];
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    const [jobId = '', state = '', exit = '', reason = '', nodes = ''] = line.split('|');
    if (!jobId || /^JobID$/i.test(jobId)) return [];
    const [code, signal] = exit.split(':').map((part) => (part === '' ? null : Number.parseInt(part, 10)));
    return [{ jobId, state: state.split(/\s+/)[0].toUpperCase(), exitCode: Number.isFinite(code) ? code ?? null : null,
      signal: Number.isFinite(signal) ? signal ?? null : null, reason: reason && reason !== 'None' ? reason : null, nodes: nodes && nodes !== 'None assigned' ? nodes : null }];
  });
}

/** `squeue -h -o "%i|%T|%r|%P|%N"` → one record per line. */
export function parseSqueue(text: string | null | undefined): SlurmLine[] {
  if (!text) return [];
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    const [jobId = '', state = '', reason = '', , nodes = ''] = line.split('|');
    if (!jobId || /^JOBID$/i.test(jobId)) return [];
    return [{ jobId, state: state.toUpperCase(), exitCode: null, signal: null, reason: reason && reason !== 'None' ? reason : null, nodes: nodes || null }];
  });
}

/** A SLURM pending reason in words, for the card. The code itself stays in Details. */
export function slurmReasonWords(reason: string | null | undefined, askedMemory?: string | null): string {
  const code = (reason ?? '').replace(/[()]/g, '').trim();
  if (!code || code === 'None') return 'Waiting in the queue';
  if (/^Priority$/i.test(code)) return 'Waiting in the queue · other jobs go first';
  if (/^Resources$/i.test(code)) return askedMemory ? `Waiting for a free node with ${askedMemory}` : 'Waiting for a free node';
  if (/MaxJobsPer(User|Account)|AssocMaxJobs|QOSMaxJobs|AssocGrpJobs/i.test(code)) return 'Waiting: your lab already has its maximum of jobs running';
  if (/MaxCpu|GrpCpu|MaxTRES|GrpTRES|AssocGrpCpu/i.test(code)) return 'Waiting: your lab is using its share of cores';
  if (/^Dependency$/i.test(code)) return 'Waiting for another job to finish first';
  if (/^BeginTime$/i.test(code)) return 'Waiting for its start time';
  // Slurm 24 prints some reasons as sentences ("Nodes required for job are DOWN, DRAINED or reserved for jobs in …").
  if (/ReqNodeNotAvail|NodeDown|PartitionDown|PartitionInactive|Nodes required for job are DOWN/i.test(code)) return 'Waiting: the nodes it needs are down or reserved';
  if (/JobHeld|Held/i.test(code)) return 'Held in the queue until someone releases it';
  if (/Reservation/i.test(code)) return 'Waiting for a reservation';
  return 'Waiting in the queue';
}

/**
 * Why sbatch refused a job, in words (null when the text is not an sbatch refusal). The run never reached the queue,
 * so there is no job id, no trace and no scheduler state: the refusal is all there is to say.
 */
export function slurmRefusal(text: string | null | undefined, asked: { queue?: string | null; memory?: string | null; cores?: number | null } = {}): { words: string; retry: boolean } | null {
  const raw = /(?:Batch job submission failed:|sbatch: error:)\s*([^\n]+)/.exec(text ?? '')?.[1]?.trim()
    ?? (/Failed to run sbatch|sbatch exited with code|sbatch did not return a job id/.test(text ?? '') ? '' : null);
  if (raw == null) return null;
  const queue = asked.queue ? `the ${asked.queue} queue` : 'the queue';
  if (/inactive or drain|partition not available/i.test(raw)) return { words: `${queue} is closed for new jobs (drained or inactive)`, retry: true };
  if (/Invalid partition/i.test(raw)) return { words: `there is no queue called ${asked.queue ?? 'that'} on this cluster`, retry: false };
  if (/Memory specification can not be satisfied|Requested node configuration is not available|More processors requested than permitted|exceeded? .*limit/i.test(raw)) {
    const what = [asked.cores ? `${asked.cores} cores` : '', asked.memory ? memoryWords(memoryBytes(asked.memory)) || asked.memory : ''].filter(Boolean).join(' and ');
    return { words: `no node in ${queue} has ${what || 'the cores and memory asked for'}`, retry: false };
  }
  if (/MaxSubmit|QOSMax|AssocMax/i.test(raw)) return { words: 'your lab already has its maximum of jobs in the queue', retry: true };
  if (/Invalid account|Invalid qos|Invalid wckey/i.test(raw)) return { words: 'the SLURM account or QOS set for this server is not valid', retry: false };
  if (/Unable to contact slurm controller|Socket timed out|Connection refused|Zero Bytes were transmitted/i.test(raw)) return { words: 'the SLURM controller did not answer', retry: true };
  return { words: raw ? raw.replace(/\.$/, '') : 'sbatch did not say why', retry: false };
}

// ------------------------------------------------------------------ failure kind

const RULES: { kind: ErrorKind; test: (s: Signals) => boolean }[] = [
  { kind: 'memory', test: (s) => s.states.includes('OUT_OF_MEMORY') || s.exits.includes(137) || /oom[_-]?kill|out[ _-]of[ _-]memory|OutOfMemoryError|Cannot allocate memory|MemoryError|std::bad_alloc|exceeded (?:its )?memory|Killed\s+(?:\S+\s+)?\(core dumped\)?/i.test(s.text) },
  // Nextflow's local executor stops a task over its `time` limit and then fails with "process hasn't exited" from
  // LocalTaskHandler.checkIfCompleted (its time-limit branch); on SLURM the job state says TIMEOUT.
  { kind: 'time', test: (s) => s.states.includes('TIMEOUT') || s.exits.includes(140) || /DUE TO TIME LIMIT|exceeded running time limit|time limit exceeded|TIMEOUT/.test(s.text)
    || (/process hasn't exited/.test(s.text) && /LocalTaskHandler\.checkIfCompleted/.test(s.text)) },
  { kind: 'node', test: (s) => s.states.includes('NODE_FAIL') || s.states.includes('BOOT_FAIL') || /NODE_FAIL|node failure|lost connection to (?:the )?node|Node \S+ not responding/i.test(s.text) || (s.exits.includes(143) && /CANCELLED D/i.test(s.text)) },
  { kind: 'database', test: (s) => /database (?:is )?not (?:found|installed)|db(?: path)? not found|(?:--\w*_?db|kraken2?_db|db_path)\b[^\n]*(?:not found|does not exist|missing)|no such database/i.test(s.text) },
  { kind: 'software', test: (s) => /Failed to create Conda environment|CondaHTTPError|CondaError|PackagesNotFoundError|ResolvePackageNotFound|UnsatisfiableError|Solving environment: failed|conda: command not found|Failed to pull (?:singularity|docker|apptainer)|Error pulling (?:image|container)|container (?:pull|image) (?:failed|not found)|mamba.*(?:error|failed)/i.test(s.text) },
  { kind: 'input', test: (s) => /Validation of pipeline parameters failed|samplesheet|Missing required value|not a valid FASTQ|Cannot find any reads|MissingInputFile|No files match pattern|input file[^\n]*(?:not found|missing|empty)|Input file does not exist|unexpected end of file|gzip: .*(?:unexpected end|not in gzip format)/i.test(s.text) },
];

interface Signals { states: string[]; exits: number[]; text: string }

/** The kind of a failure from the scheduler state, exit codes and error text; "unknown" when no rule matches. */
export function classifyFailure(input: { texts: (string | null | undefined)[]; exitCodes?: (number | null | undefined)[]; slurmStates?: (string | null | undefined)[] }): ErrorKind {
  const signals: Signals = {
    states: (input.slurmStates ?? []).filter((v): v is string => !!v).map((v) => v.split(/\s+/)[0].toUpperCase()),
    exits: (input.exitCodes ?? []).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)),
    text: input.texts.filter(Boolean).join('\n'),
  };
  return RULES.find((rule) => rule.test(signals))?.kind ?? 'unknown';
}

// ------------------------------------------------------------------ words

const LOWER_WORDS: Record<string, string> = {
  MEGAHIT: 'assembly', SPADES: 'assembly', METASPADES: 'assembly', QUAST: 'assembly check', METABAT2: 'binning', MAXBIN2: 'binning', CONCOCT: 'binning',
  CHECKM: 'bin check', CHECKM2: 'bin check', GTDBTK: 'taxonomy', GTDBTK_CLASSIFYWF: 'taxonomy', PROKKA: 'annotation', BAKTA: 'annotation',
  FASTQC: 'FastQC', FASTQC_RAW: 'FastQC', FASTP: 'trimming', MULTIQC: 'MultiQC', BOWTIE2_HOST_REMOVAL: 'host removal', KRAKEN2: 'Kraken2', BRACKEN: 'Bracken',
  RUN_FASTQC: 'FastQC', SUMMARIZE_FASTQC: 'the FastQC summary', MULTIQC_STUDY: 'MultiQC', SEQKIT_STATS: 'read statistics', COLLECT_STATS: 'collecting statistics', GENERATE_REPORT: 'the report', NANOPLOT: 'NanoPlot',
};
/** A process name in words for sentences ("assembly"), falling back to the process name itself. */
export function stageWords(process: string | null | undefined): string {
  if (!process) return 'a step';
  const short = process.split(':').pop()!.toUpperCase();
  return LOWER_WORDS[short] ?? short;
}
const capital = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

export function durationWords(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

const toDate = (v: Date | string | null | undefined) => (v ? new Date(v) : null);
const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

/** Parse "64 GB", "64.GB", "65536 MB" or "64G" into bytes. */
export function memoryBytes(value: string | null | undefined): number | null {
  const m = /^\s*([\d.]+)\s*(k|m|g|t)?i?b?\s*$/i.exec((value ?? '').replace('.GB', ' GB'));
  if (!m) return null;
  const unit = { k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 }[(m[2] ?? 'b').toLowerCase() as 'k'] ?? 1;
  return Number.parseFloat(m[1]) * unit;
}
export function memoryWords(bytes: number | null | undefined): string {
  if (!bytes || !Number.isFinite(bytes)) return '';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1024) return `${+(gb / 1024).toFixed(1)} TB`;
  if (gb >= 1) return `${gb >= 10 ? Math.round(gb) : +gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

// ------------------------------------------------------------------ processes

function processRows(tasks: NextflowTask[]): { rows: PlainProcess[]; failed: NextflowTask | null } {
  const order: string[] = [];
  const byProcess = new Map<string, NextflowTask[]>();
  const sorted = [...tasks].sort((a, b) => (a.submit?.getTime() ?? 0) - (b.submit?.getTime() ?? 0) || Number(a.taskId) - Number(b.taskId));
  for (const task of sorted) {
    const name = task.process || task.name;
    if (!byProcess.has(name)) { byProcess.set(name, []); order.push(name); }
    byProcess.get(name)!.push(task);
  }
  let failed: NextflowTask | null = null;
  const rows = order.map((name) => {
    // The last attempt per tag wins (retries).
    const latest = new Map<string, NextflowTask>();
    for (const task of byProcess.get(name)!) latest.set(task.tag ?? task.hash ?? task.taskId, task);
    const list = [...latest.values()];
    const done = list.filter((t) => t.status === 'COMPLETED' || t.status === 'CACHED').length;
    const running = list.filter((t) => t.status === 'RUNNING' || t.status === 'SUBMITTED').length;
    const failures = list.filter((t) => t.status === 'FAILED' || t.status === 'ABORTED');
    if (!failed && failures.length) failed = failures.find((t) => t.status === 'FAILED') ?? failures[0];
    const cpu = list.reduce((sum, t) => sum + ((t.realtime ?? 0) / 3_600_000) * ((t.cpuPercent ?? 100) / 100), 0);
    const peak = list.reduce<number | null>((max, t) => (t.peakRss != null && (max == null || t.peakRss > max) ? t.peakRss : max), null);
    const starts = list.map((t) => t.start?.getTime()).filter((v): v is number => !!v);
    const ends = list.map((t) => t.complete?.getTime()).filter((v): v is number => !!v);
    const status: PlainProcess['status'] = failures.length ? 'failed' : running ? 'running' : done === list.length ? 'done' : 'waiting';
    return { name, status, tasks: list.length, done, running, failed: failures.length, cpuHours: cpu ? +cpu.toFixed(1) : null, peakBytes: peak,
      seconds: starts.length && ends.length ? Math.round((Math.max(...ends) - Math.min(...starts)) / 1000) : null };
  });
  return { rows, failed };
}

/** The first lines of the real error: Nextflow's "Error executing process" block, or error-looking lines. */
export function firstErrorLines(texts: (string | null | undefined)[], max = 3): string[] {
  // Nextflow's log prefixes a timestamp, thread, level and logger; ANSI colours come from the console log.
  const lines = texts.filter(Boolean).flatMap((text) => redactLog(text!).split(/\r?\n/))
    .map((l) => l.replace(/\u001b\[[0-9;?]*[A-Za-z]|\u001b\]8;;[^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '').replace(/^[A-Z][a-z]{2}-\d{2} [\d:.]+ \[[^\]]+\] [A-Z]+\s+\S+ - /, '').replace(/\s+$/, ''))
    .filter((l) => l.trim());
  const picked: string[] = [];
  const push = (line: string) => { const clean = line.trim().slice(0, 240); if (clean && !picked.includes(clean) && picked.length < max) picked.push(clean); };
  const block = lines.findIndex((l) => /Error executing process|Process `[^`]+` terminated|ERROR ~/.test(l));
  if (block >= 0) {
    push(lines[block]);
    for (const l of lines.slice(block + 1)) if (/error|exit status|Caused by|Missing|not found|failed|Killed|oom|Command exit/i.test(l)) push(l);
  }
  for (const l of lines) if (/error|exception|failed|killed|oom_kill|CANCELLED|not found|No such file/i.test(l) && !/^\s*at /.test(l)) push(l);
  if (!picked.length) for (const l of lines.slice(-max)) push(l);
  return picked;
}

// ------------------------------------------------------------------ Nextflow's console progress

export interface LogProgress { submitted: number; processes: { name: string; done: number; total: number }[]; steps: number }

/**
 * The last progress block of Nextflow's console log ("executor >  slurm (2)" and one "[ab/cdef12] NAME (tag) | 1 of 2"
 * line per process). trace.txt only gets a row when a task ends, so while the first task runs this is the only sign
 * that work was handed to the executor. Long names come shortened with "…"; those take the full name from an earlier
 * line, or none.
 */
export function logProgress(text: string | null | undefined): LogProgress | null {
  if (!text) return null;
  const lines = text.replace(/\u001b\]8;;[^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n/);
  let start = -1;
  for (let i = lines.length - 1; i >= 0 && start < 0; i -= 1) if (/^executor >\s+\S+ \(\d+\)/.test(lines[i].trim())) start = i;
  if (start < 0) return null;
  const submitted = Number(/\((\d+)\)/.exec(lines[start])![1]);
  const processes: LogProgress['processes'] = [];
  for (const line of lines.slice(start + 1)) {
    const m = /^\[[^\]]*\]\s+(?:process > )?(\S+)(?:\s+\([^)]*\))?\s*(?:\|\s*(\d+) of (\d+))?/.exec(line.trim());
    if (!m) break;
    processes.push({ name: m[1], done: Number(m[2] ?? 0), total: Number(m[3] ?? 0) });
  }
  // A shortened name ("SUMM…ZE_FASTQC") is the full name an earlier, wider line of the log gave ("SUMMARIZE_FASTQC").
  const full = [...new Set(lines.map((line) => /^\[[^\]]*\]\s+(?:process > )?([A-Za-z0-9_:.-]+)(?=\s|$)/.exec(line.trim())?.[1]).filter((n): n is string => !!n))];
  for (const p of processes) if (p.name.includes('…')) {
    const [head, tail] = p.name.split('…');
    p.name = full.find((n) => n.startsWith(head) && n.endsWith(tail) && n.length > head.length + tail.length) ?? '';
  }
  // Nextflow redraws the block and may leave out a process it has not reached; the first block lists them all.
  let steps = 0, run = 0;
  for (const line of lines) { run = /^\[[^\]]*\]\s+\S+/.test(line.trim()) ? run + 1 : 0; steps = Math.max(steps, run); }
  return { submitted, processes, steps: Math.max(steps, processes.length) };
}

// ------------------------------------------------------------------ the status

function estimateOf(past: number[] | undefined): { seconds: number | null; words: string } {
  const value = median((past ?? []).filter((v) => Number.isFinite(v) && v > 0));
  return value == null ? { seconds: null, words: 'no estimate yet' } : { seconds: value, words: `about ${durationWords(value)}` };
}

function errorSentence(kind: ErrorKind, process: string | null, sample: string | null, exitCode: number | null, lines: string[], run: PlainRunInput, nodes: string | null, cancelledOutside = false): { sentence: string; action: PlainAction } {
  const stage = stageWords(process);
  const onSample = sample ? ` on sample ${sample}` : '';
  switch (kind) {
    case 'memory': {
      const asked = memoryBytes(run.askedMemory);
      const more = asked ? memoryWords(asked * 2) : null;
      return { sentence: `${capital(stage)} ran out of memory${onSample}`, action: { kind: 'resume', label: more ? `Resume with ${more}` : 'Resume with more memory', ...(more ? { memory: more } : {}) } };
    }
    case 'time': {
      // The limit the failed attempt ran under: a Resume's own ("1 min"), else the server's hours.
      const seconds = run.resumedTimeLimitSeconds ?? (run.timeLimitHours ? run.timeLimitHours * 3600 : null);
      if (!seconds) return { sentence: `${capital(stage)} hit the time limit`, action: { kind: 'resume', label: 'Resume with more time' } };
      const twice = seconds * 2;
      const next = twice % 3600 === 0 ? `${twice / 3600}h` : twice >= 60 ? `${Math.ceil(twice / 60)} min` : `${twice} s`;
      return { sentence: `${capital(stage)} hit the ${durationWords(seconds)} time limit`, action: { kind: 'resume', label: `Resume with ${next.replace(/h$/, ' h')}`, time: next } };
    }
    case 'input': {
      const detail = lines.find((l) => /Missing required value|not a valid|no reverse|Cannot find|No such file|samplesheet/i.test(l));
      return { sentence: detail ? `The input did not pass the check: ${detail.replace(/^.*?(?:ERROR ~|\*)\s*/, '').slice(0, 140)}` : 'The input did not pass the pipeline’s check', action: { kind: 'fix-data', label: 'Fix in Data' } };
    }
    case 'database':
      return { sentence: 'A reference database is not installed on this server', action: { kind: 'ask-admin', label: 'Ask the admin' } };
    case 'software':
      return { sentence: `Couldn’t install the environment for ${process ? process.split(':').pop() : 'a step'}`, action: { kind: 'retry', label: 'Retry' } };
    case 'node':
      return { sentence: `${nodes ? `Node ${nodes}` : 'A compute node'} failed during ${stage}`, action: { kind: 'resume', label: 'Resume' } };
    default:
      // Someone ran scancel on one of the run's task jobs: slurmstepd's line is in its .command.log.
      if (cancelledOutside) {
        return { sentence: `${capital(stage)} was stopped outside SeqDesk: its SLURM job was cancelled`, action: { kind: 'resume', label: 'Resume' } };
      }
      return { sentence: `Failed at ${process ? process.split(':').pop() : 'a step'}${exitCode != null ? ` · exit code ${exitCode}` : ''}`, action: { kind: 'show-log', label: 'Show the log' } };
  }
}

export function plainRunStatus(context: PlainContext): PlainStatus {
  const { run } = context;
  const now = context.now ?? new Date();
  const tasks = context.trace ? parseTraceContent(context.trace).tasks : [];
  const { rows, failed: traced } = processRows(tasks);
  let failed = traced;
  const estimate = estimateOf(context.pastSeconds);
  const started = toDate(run.startedAt), ended = toDate(run.completedAt), queued = toDate(run.queuedAt);
  const elapsedSeconds = started ? Math.round(((ended ?? now).getTime() - started.getTime()) / 1000) : null;
  const status = run.status.toLowerCase();
  const slurm = run.executionMode === 'slurm';
  const sacct = parseSacct(context.sacct);
  const queueState = (run.queueStatus ?? '').toUpperCase();
  const queue = slurm || run.queueJobId ? { jobId: run.queueJobId ?? null, state: run.queueStatus ?? null, reason: run.queueReason ?? null } : null;
  const stages: PlainStage[] = rows.map((row) => ({ name: row.name.split(':').pop()!, state: row.status === 'done' ? 'done' : row.status === 'running' ? 'running' : row.status === 'failed' ? 'failed' : 'waiting' }));
  const doneSteps = rows.filter((row) => row.status === 'done').length;
  const doneTasks = rows.reduce((sum, row) => sum + row.done, 0);
  const firstOpen = rows.find((row) => row.status !== 'done');
  const keeps: PlainKeeps | null = rows.length && (status === 'failed' || status === 'cancelled')
    ? { finishedSteps: doneSteps, tasks: doneTasks, restartsAt: firstOpen ? stageWords(firstOpen.name) : null,
      words: `${doneSteps} finished step${doneSteps === 1 ? '' : 's'}${firstOpen ? `, restarts at ${stageWords(firstOpen.name)}` : ''}` }
    : null;
  const base = { stages, processes: rows, queue, estimate, elapsedSeconds, keeps, error: null as PlainError | null };

  if (status === 'completed') {
    const outputs = run.outputCount ? ` · ${run.outputCount} output${run.outputCount === 1 ? '' : 's'} in Data` : '';
    return { ...base, shape: 'finished', word: 'Finished', sentence: `Finished in ${durationWords(elapsedSeconds) || 'moments'}${outputs}`, action: { kind: 'open-outputs', label: 'Open outputs' } };
  }
  if (status === 'cancelled') {
    const at = firstOpen ? ` at ${stageWords(firstOpen.name)}` : '';
    return { ...base, shape: 'cancelled', word: 'Cancelled', sentence: `Cancelled${at}${doneSteps ? ` · ${doneSteps} finished step${doneSteps === 1 ? ' is' : 's are'} kept` : ''}`, action: { kind: 'run-again', label: 'Run again' } };
  }
  if (status === 'failed' && slurm && !run.queueJobId && !tasks.length) {
    const refusal = slurmRefusal(run.errorTail, { queue: run.queue, memory: run.askedMemory, cores: run.askedCores });
    if (refusal) {
      const sentence = `SLURM did not take the job: ${refusal.words}`;
      const lines = firstErrorLines([run.errorTail]);
      return { ...base, shape: 'needs-you', word: 'Needs you', sentence, action: refusal.retry ? { kind: 'retry', label: 'Retry' } : { kind: 'ask-admin', label: 'Ask the admin' },
        error: { kind: 'unknown', sentence, firstLines: lines, process: null, sample: null, exitCode: null } };
    }
  }
  if (status === 'failed') {
    const failedLine = sacct.find((line) => line.state !== 'COMPLETED') ?? null;
    const texts = [context.taskError, run.errorTail, run.outputTail];
    // A task the executor stopped (time limit, lost node) can stay "running" in the trace: the log names it.
    const named = /Error executing process > '([^'(]+?)(?: \(([^)]+)\))?'/.exec(texts.filter(Boolean).join('\n'));
    if (!failed && named) {
      const name = named[1].trim().split(':').pop()!;
      failed = { process: name, name: named[1].trim(), tag: named[2] ?? null, exit: null } as unknown as NextflowTask;
      for (const row of rows) if (row.name === name && row.status !== 'done') row.status = 'failed';
      for (const stage of stages) if (stage.name === name && stage.state !== 'done') stage.state = 'failed';
    }
    for (const stage of stages) if (stage.state === 'running') stage.state = 'failed';
    const exitCode = failed?.exit ?? failedLine?.exitCode ?? null;
    const kind = classifyFailure({ texts, exitCodes: [failed?.exit, ...sacct.map((l) => l.exitCode), ...sacct.map((l) => (l.signal === 9 ? 137 : null))], slurmStates: [...sacct.map((l) => l.state), queueState] });
    const lines = firstErrorLines([context.taskError, run.errorTail, run.outputTail]);
    const cancelledOutside = /\*\*\* JOB \d+ ON \S+ CANCELLED AT /.test(texts.filter(Boolean).join('\n'));
    // Nextflow's own sbatch for a task was refused (the controller was down, the queue closed): say that, with Resume.
    const all = texts.filter(Boolean).join('\n');
    if (/Failed to submit process to grid scheduler/.test(all)) {
      const refusal = slurmRefusal(all, { queue: run.queue, memory: run.askedMemory, cores: run.askedCores });
      const stage = stageWords(failed?.process ?? failed?.name ?? null);
      const sentence = `Couldn’t hand ${stage} to SLURM: ${refusal?.words ?? 'sbatch refused it'}`;
      const lines = firstErrorLines([all]);
      return { ...base, shape: 'needs-you', word: 'Needs you', sentence, action: refusal && !refusal.retry ? { kind: 'ask-admin', label: 'Ask the admin' } : { kind: 'resume', label: 'Resume' },
        error: { kind: 'unknown', sentence, firstLines: lines, process: failed?.process ?? null, sample: failed?.tag ?? null, exitCode: null } };
    }
    const { sentence, action } = errorSentence(kind, failed?.process ?? failed?.name ?? null, failed?.tag ?? null, exitCode, lines, run, failedLine?.nodes ?? null, cancelledOutside);
    return { ...base, shape: 'needs-you', word: 'Needs you', sentence, action,
      error: { kind, sentence, firstLines: lines, process: failed?.process ?? null, sample: failed?.tag ?? null, exitCode } };
  }
  if (status === 'running' && (tasks.length || !slurm || queueState === 'RUNNING')) {
    const current = rows.find((row) => row.status === 'running') ?? firstOpen;
    const index = current ? rows.indexOf(current) + 1 : rows.length;
    // trace.txt only lists processes that ended a task: once they are all done, the console log names the next one.
    const progress = current ? null : logProgress(run.outputTail);
    const logged = progress?.processes.findIndex((p) => p.total > p.done) ?? -1;
    const where = current ? ` · step ${index} of ${rows.length}: ${stageWords(current.name)}`
      : progress && logged >= 0 ? ` · step ${logged + 1} of ${progress.steps}${progress.processes[logged].name ? `: ${stageWords(progress.processes[logged].name)}` : ''}` : '';
    // On SLURM the run's job runs while its task jobs may wait (the monitor keeps their reason).
    const reasonWords = slurm && run.queueReason ? slurmReasonWords(run.queueReason) : '';
    const waiting = reasonWords ? ` · ${reasonWords.charAt(0).toLowerCase()}${reasonWords.slice(1)}` : '';
    const left = estimate.seconds != null && elapsedSeconds != null
      ? (estimate.seconds > elapsedSeconds ? ` · ~${durationWords(estimate.seconds - elapsedSeconds)} left` : ' · taking longer than past runs')
      : ` · ${estimate.words}`;
    // Every log says "Launching `main.nf`" and names its conda; only a log where no task has been handed to the
    // executor yet is still preparing (building environments), not one whose first task is running.
    if (!tasks.length && !progress?.submitted && /conda|environment|Launching|Preparing/i.test(`${run.currentStep ?? ''} ${run.outputTail ?? ''}`)) {
      return { ...base, shape: 'preparing', word: 'Preparing', sentence: 'Preparing software · first run only', action: { kind: 'cancel', label: 'Cancel' } };
    }
    // Every task ended but squeue no longer lists the job and sacct did not answer: the monitor waits for SLURM to
    // say how the job ended before it finishes the run (and writes its outputs to Data).
    if (/Waiting for scheduler confirmation/i.test(run.currentStep ?? '')) {
      return { ...base, shape: 'running', word: 'Running', sentence: `All steps ended · waiting for SLURM to confirm the job${slurm ? ' (SLURM is not answering)' : ''}`, action: { kind: 'cancel', label: 'Cancel' } };
    }
    return { ...base, shape: 'running', word: 'Running', sentence: `Running${where}${waiting || left}`, action: { kind: 'cancel', label: 'Cancel' } };
  }
  // pending / queued (or running on SLURM without a started task yet)
  if (slurm && queue && (queueState === 'PENDING' || queueState === 'CONFIGURING' || !queueState)) {
    const words = slurmReasonWords(run.queueReason, [run.askedCores ? `${run.askedCores} cores` : '', run.askedMemory ? memoryWords(memoryBytes(run.askedMemory)) || run.askedMemory : ''].filter(Boolean).join(' and ') || null);
    const waited = queued ? Math.round((now.getTime() - queued.getTime()) / 1000) : null;
    const resources = /Resources/i.test(run.queueReason ?? '');
    return { ...base, shape: 'waiting', word: 'Queued', sentence: `${words}${waited != null && waited > 60 ? ` · waiting ${durationWords(waited)}` : ''}`,
      action: resources && run.askedMemory ? { kind: 'ask-less-memory', label: 'Ask for less memory?' } : /MaxJobs|GrpJobs/i.test(run.queueReason ?? '') ? { kind: 'see-jobs', label: 'See the lab’s jobs' } : { kind: 'cancel', label: 'Cancel' } };
  }
  return { ...base, shape: 'preparing', word: 'Preparing', sentence: run.currentStep && !/^Launching$/i.test(run.currentStep) ? `Preparing · ${run.currentStep}` : 'Preparing to start', action: { kind: 'cancel', label: 'Cancel' } };
}
