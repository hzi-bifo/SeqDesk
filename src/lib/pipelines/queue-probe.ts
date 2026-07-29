import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';

import { inferPipelineExitCode } from '@/lib/pipelines/run-completion';
import { buildSeqDeskSlurmJobName } from '@/lib/pipelines/run-directory';

const execFileAsync = promisify(execFile);

export type QueueSource = 'local' | 'squeue' | 'sacct' | null;

export type QueueJobDetails = {
  jobId: string;
  partition?: string;
  name?: string;
  user?: string;
  elapsed?: string;
  nodes?: string;
  nodeList?: string;
  exitCode?: string;
};

export type QueueSnapshot = {
  state: string | null;
  reason: string | null;
  source: QueueSource;
  identityVerified: boolean;
  exitCode?: number | null;
  pid?: number;
  details?: QueueJobDetails;
};

export type QueueProbeInput = {
  jobId: string | null | undefined;
  runId: string;
  runFolder?: string | null;
};

export type QueueWaitOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
};

export type QueueWaitResult = {
  outcome: 'terminal' | 'timeout' | 'unknown';
  snapshot: QueueSnapshot;
};

const TERMINAL_QUEUE_STATES = new Set([
  'BOOT_FAIL',
  'COMPLETED',
  'DEADLINE',
  'EXITED',
  'NODE_FAIL',
  'OUT_OF_MEMORY',
  'PREEMPTED',
  'REVOKED',
  'TIMEOUT',
]);

export function normalizeQueueState(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase().replace(/\+$/, '');
  return normalized || null;
}

export function isTerminalQueueState(
  value: string | null | undefined
): boolean {
  const normalized = normalizeQueueState(value);
  if (!normalized || normalized === 'UNKNOWN') return false;
  return (
    TERMINAL_QUEUE_STATES.has(normalized) ||
    normalized.startsWith('CANCELLED') ||
    normalized.startsWith('CANCELED') ||
    normalized.startsWith('FAILED')
  );
}

/**
 * SLURM adds new non-terminal states over time. Once an exact job identity has
 * returned a concrete state, treating every non-terminal value as active is
 * safer than accidentally interpreting a new state as completion.
 */
export function isActiveQueueState(
  value: string | null | undefined
): boolean {
  const normalized = normalizeQueueState(value);
  return Boolean(
    normalized &&
      normalized !== 'UNKNOWN' &&
      !isTerminalQueueState(normalized)
  );
}

export function isCancelledQueueState(
  value: string | null | undefined
): boolean {
  const normalized = normalizeQueueState(value);
  if (!normalized) return false;
  return (
    normalized.startsWith('CANCELLED') ||
    normalized.startsWith('CANCELED') ||
    normalized === 'REVOKED'
  );
}

export function isFailedQueueState(
  value: string | null | undefined
): boolean {
  const normalized = normalizeQueueState(value);
  if (!normalized) return false;
  return (
    normalized.startsWith('FAILED') ||
    normalized === 'TIMEOUT' ||
    normalized === 'OUT_OF_MEMORY' ||
    normalized === 'NODE_FAIL' ||
    normalized === 'BOOT_FAIL' ||
    normalized === 'PREEMPTED' ||
    normalized === 'DEADLINE'
  );
}

export function isQueueSnapshotRetryable(snapshot: QueueSnapshot): boolean {
  const normalized = normalizeQueueState(snapshot.state);
  return (
    !snapshot.identityVerified ||
    !normalized ||
    normalized === 'UNKNOWN'
  );
}

export function queueSnapshotToRunStatus(
  snapshot: QueueSnapshot
): 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | null {
  if (isQueueSnapshotRetryable(snapshot)) return null;
  const state = normalizeQueueState(snapshot.state);
  if (!state) return null;

  if (state === 'COMPLETED') return 'completed';
  if (state === 'EXITED') {
    if (snapshot.exitCode === 0) return 'completed';
    if (typeof snapshot.exitCode === 'number') return 'failed';
    return null;
  }
  if (isCancelledQueueState(state)) return 'cancelled';
  if (isFailedQueueState(state)) return 'failed';
  if (state === 'PENDING' || state === 'CONFIGURING') return 'queued';
  if (isActiveQueueState(state)) return 'running';
  return null;
}

function firstNonEmptyLine(value: string): string {
  return (
    value
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) || ''
  );
}

function parseDisplayedProcessArgs(command: string): string[] | null {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;
  let tokenStarted = false;

  for (const char of command) {
    if (escaping) {
      current += char;
      escaping = false;
      tokenStarted = true;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaping = true;
      tokenStarted = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      tokenStarted = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (tokenStarted) {
        args.push(current);
        current = '';
        tokenStarted = false;
      }
      continue;
    }
    current += char;
    tokenStarted = true;
  }

  if (escaping) current += '\\';
  if (quote) return null;
  if (tokenStarted) args.push(current);
  return args;
}

function unverifiedQueueIdentity(
  source: Exclude<QueueSource, null>,
  reason: string,
  extras: Partial<QueueSnapshot> = {}
): QueueSnapshot {
  return {
    state: 'UNKNOWN',
    reason,
    source,
    identityVerified: false,
    ...extras,
  };
}

function exactWorkDirMatches(
  candidate: string | null | undefined,
  expected: string
): boolean {
  if (!candidate?.trim()) return false;
  return path.resolve(candidate.trim()) === expected;
}

export async function readIdentityCheckedQueueSnapshot({
  jobId,
  runId,
  runFolder,
}: QueueProbeInput): Promise<QueueSnapshot> {
  const normalizedJobId = (jobId || '').trim();
  if (!normalizedJobId) {
    return {
      state: null,
      reason: null,
      source: null,
      identityVerified: false,
    };
  }

  if (normalizedJobId.startsWith('local-')) {
    const pid = Number(normalizedJobId.replace(/^local-/, ''));
    if (!Number.isInteger(pid) || pid <= 0) {
      return unverifiedQueueIdentity(
        'local',
        'Stored local job ID is invalid'
      );
    }
    if (!runFolder) {
      return unverifiedQueueIdentity(
        'local',
        'Stored local job identity is missing its run folder',
        { pid }
      );
    }

    const exitCode = await inferPipelineExitCode(runFolder);
    if (exitCode !== null) {
      return {
        state: 'EXITED',
        reason: null,
        source: 'local',
        identityVerified: true,
        exitCode,
        pid,
      };
    }

    try {
      const { stdout } = await execFileAsync(
        'ps',
        ['-ww', '-p', String(pid), '-o', 'args='],
        { timeout: 5000 }
      );
      const command = stdout.trim();
      if (!command) {
        return unverifiedQueueIdentity(
          'local',
          'Stored local job identity is missing its process arguments',
          { pid }
        );
      }
      const expectedScript = path.resolve(runFolder, 'run.sh');
      const processArgs = parseDisplayedProcessArgs(command);
      if (!processArgs?.some((argument) => argument === expectedScript)) {
        return unverifiedQueueIdentity(
          'local',
          'Stored PID belongs to another process',
          { pid }
        );
      }
      return {
        state: 'RUNNING',
        reason: null,
        source: 'local',
        identityVerified: true,
        exitCode: null,
        pid,
      };
    } catch (error) {
      const commandExitCode = (error as { code?: unknown }).code;
      if (commandExitCode === 1 || commandExitCode === '1') {
        return unverifiedQueueIdentity(
          'local',
          'Local process exited before its canonical exit marker was observed',
          { pid }
        );
      }
      return unverifiedQueueIdentity(
        'local',
        'Stored local job identity could not be inspected',
        { pid }
      );
    }
  }

  if (!/^\d+$/.test(normalizedJobId)) {
    return unverifiedQueueIdentity(
      'squeue',
      'Stored SLURM job ID has an invalid format'
    );
  }
  if (!runFolder) {
    return unverifiedQueueIdentity(
      'squeue',
      'Stored SLURM job identity is missing its run folder'
    );
  }

  const expectedJobName = buildSeqDeskSlurmJobName(runId);
  const expectedWorkDir = path.resolve(runFolder);

  try {
    const { stdout } = await execFileAsync(
      'squeue',
      [
        '-j',
        normalizedJobId,
        '-h',
        '-o',
        '%i|%P|%.128j|%u|%T|%M|%D|%R|%.1024Z',
      ],
      { timeout: 5000 }
    );
    const line = firstNonEmptyLine(stdout);
    if (line) {
      const fields = line.split('|');
      // The four-field shape is retained for compatibility with older SLURM
      // clients and fixtures: State|Reason|JobName|WorkDir.
      const legacy = fields.length === 4;
      const rowJobId = legacy ? normalizedJobId : fields[0]?.trim();
      const partition = legacy ? undefined : fields[1]?.trim();
      const jobName = fields[2]?.trim();
      const user = legacy ? undefined : fields[3]?.trim();
      const state = (legacy ? fields[0] : fields[4])?.trim();
      const elapsed = legacy ? undefined : fields[5]?.trim();
      const nodes = legacy ? undefined : fields[6]?.trim();
      const reason = (legacy ? fields[1] : fields[7])?.trim();
      const workDir = (legacy ? fields[3] : fields[8])?.trim();

      if (rowJobId !== normalizedJobId) {
        return unverifiedQueueIdentity(
          'squeue',
          'Stored SLURM job ID belongs to another scheduler row'
        );
      }
      if (jobName !== expectedJobName) {
        return unverifiedQueueIdentity(
          'squeue',
          jobName
            ? 'Stored SLURM job ID belongs to another SeqDesk run'
            : 'Stored SLURM job identity is missing its job name'
        );
      }
      if (!workDir) {
        return unverifiedQueueIdentity(
          'squeue',
          'Stored SLURM job identity is missing its work directory'
        );
      }
      if (!exactWorkDirMatches(workDir, expectedWorkDir)) {
        return unverifiedQueueIdentity(
          'squeue',
          'Stored SLURM job ID belongs to another work directory'
        );
      }

      return {
        state: normalizeQueueState(state) || 'UNKNOWN',
        reason: reason || null,
        source: 'squeue',
        identityVerified: true,
        details: {
          jobId: normalizedJobId,
          partition,
          name: jobName,
          user,
          elapsed,
          nodes,
          nodeList: reason,
        },
      };
    }
  } catch {
    // Fall through to accounting, which remains authoritative after squeue
    // drops a terminal job.
  }

  try {
    const { stdout } = await execFileAsync(
      'sacct',
      [
        '-X',
        '-P',
        '-j',
        normalizedJobId,
        '--format=JobID,State%32,Reason,JobName%128,WorkDir%1024,Elapsed,ExitCode',
        '--noheader',
      ],
      { timeout: 5000 }
    );
    const rows = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const fields = line.split('|');
        return {
          jobId: fields[0]?.trim() || '',
          state: fields[1]?.trim() || '',
          reason: fields[2]?.trim() || null,
          jobName: fields[3]?.trim() || null,
          workDir: fields[4]?.trim() || null,
          elapsed: fields[5]?.trim() || undefined,
          exitCode: fields[6]?.trim() || undefined,
        };
      });
    const primary = rows.find((row) => row.jobId === normalizedJobId);

    if (primary) {
      if (primary.jobName !== expectedJobName) {
        return unverifiedQueueIdentity(
          'sacct',
          primary.jobName
            ? 'Stored SLURM job ID belongs to another SeqDesk run'
            : 'Stored SLURM job identity is missing its job name'
        );
      }
      if (!primary.workDir) {
        return unverifiedQueueIdentity(
          'sacct',
          'Stored SLURM job identity is missing its work directory'
        );
      }
      if (!exactWorkDirMatches(primary.workDir, expectedWorkDir)) {
        return unverifiedQueueIdentity(
          'sacct',
          'Stored SLURM job ID belongs to another work directory'
        );
      }

      return {
        state: normalizeQueueState(primary.state) || 'UNKNOWN',
        reason: primary.reason,
        source: 'sacct',
        identityVerified: true,
        details: {
          jobId: primary.jobId,
          name: primary.jobName,
          elapsed: primary.elapsed,
          exitCode: primary.exitCode,
        },
      };
    }
  } catch {
    // Report an unknown state below. Callers must keep it retryable.
  }

  return unverifiedQueueIdentity(
    'sacct',
    'Stored SLURM job identity was not found in squeue or sacct'
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForIdentityCheckedQueueTerminal(
  input: QueueProbeInput,
  options: QueueWaitOptions = {}
): Promise<QueueWaitResult> {
  const timeoutMs = Math.max(0, options.timeoutMs ?? 10_000);
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 250);
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = await readIdentityCheckedQueueSnapshot(input);

  while (true) {
    if (
      lastSnapshot.identityVerified &&
      isTerminalQueueState(lastSnapshot.state)
    ) {
      return { outcome: 'terminal', snapshot: lastSnapshot };
    }
    if (Date.now() >= deadline) {
      return {
        outcome: isQueueSnapshotRetryable(lastSnapshot)
          ? 'unknown'
          : 'timeout',
        snapshot: lastSnapshot,
      };
    }
    await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    lastSnapshot = await readIdentityCheckedQueueSnapshot(input);
  }
}
