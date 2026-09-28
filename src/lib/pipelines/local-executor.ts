/**
 * Pipeline runs on this server (the local executor) with hard limits and a small admission queue, as SLURM gives a
 * cluster. Each run gets its share of the host (cores, memory, a time limit), enforced for its whole process tree by
 * the same mechanism Analysis steps use (a systemd --user scope, else prlimit, see explore/sandbox/limits.ts) plus
 * `timeout`; runs beyond the host's budget wait with a SLURM-style sentence ("Waiting for 4 cores and 16 GB on this
 * server") until the monitor admits them.
 */
import os from 'os';
import { resourceLimitLines } from '@/lib/explore/sandbox/limits';

export interface LocalRunLimits { cores: number; memoryGb: number; timeHours: number }
export interface LocalBudget { cores: number; memoryGb: number }

const envNumber = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/** What one run may use. SEQDESK_LOCAL_RUN_CORES / _MEMORY_GB / _TIME_HOURS; defaults: half the host, 48 h. */
export function localRunLimits(host = { cores: os.cpus().length, memoryGb: Math.floor(os.totalmem() / 1024 ** 3) }): LocalRunLimits {
  return {
    cores: Math.max(1, Math.floor(envNumber('SEQDESK_LOCAL_RUN_CORES', Math.max(1, Math.floor(host.cores / 2))))),
    memoryGb: Math.max(1, Math.floor(envNumber('SEQDESK_LOCAL_RUN_MEMORY_GB', Math.max(1, Math.floor(host.memoryGb / 2))))),
    timeHours: envNumber('SEQDESK_LOCAL_RUN_TIME_HOURS', 48),
  };
}

/** What all runs together may use. SEQDESK_LOCAL_CORES / _MEMORY_GB; defaults: every core, 90 % of memory. */
export function localBudget(host = { cores: os.cpus().length, memoryGb: Math.floor(os.totalmem() / 1024 ** 3) }): LocalBudget {
  return {
    cores: Math.max(1, Math.floor(envNumber('SEQDESK_LOCAL_CORES', host.cores))),
    memoryGb: Math.max(1, Math.floor(envNumber('SEQDESK_LOCAL_MEMORY_GB', Math.floor(host.memoryGb * 0.9)))),
  };
}

/** The reason code a waiting local run keeps in queueReason, and its words for the card. */
export const localWaitReason = (limits: LocalRunLimits) => `LocalCapacity:${limits.cores}:${limits.memoryGb}`;
export function localWaitWords(reason: string | null | undefined): string | null {
  const m = /^LocalCapacity:(\d+):(\d+)(?::(\d+))?$/.exec(reason ?? '');
  if (!m) return null;
  const ahead = m[3] ? Number(m[3]) : 0;
  return `Waiting for ${m[1]} cores and ${m[2]} GB on this server${ahead ? ` · ${ahead} run${ahead === 1 ? '' : 's'} ahead` : ''}`;
}

/**
 * Whether a run fits next to the runs that hold the host now. A run larger than the whole budget still starts when
 * nothing else runs (it gets the host; its own limits are capped to the budget).
 */
export function admits(budget: LocalBudget, running: LocalRunLimits[], want: LocalRunLimits): boolean {
  if (!running.length) return true;
  const cores = running.reduce((s, r) => s + r.cores, 0);
  const memory = running.reduce((s, r) => s + r.memoryGb, 0);
  return cores + want.cores <= budget.cores && memory + want.memoryGb <= budget.memoryGb;
}

/**
 * Shell lines for the local wrapper: the resource scope (RLIM prefix, a Limits: line in the log) and a time limit.
 * The wrapper runs `${RLIM[@]} ${SEQDESK_TIMEOUT[@]} nextflow …`; `seqdesk_local_limit_words STATUS` explains a
 * memory or time stop in pipeline.err.
 */
export function localLimitLines(limits: LocalRunLimits, runId: string, runFolder: string): string[] {
  const seconds = Math.max(60, Math.round(limits.timeHours * 3600));
  return [
    `RUN_DIR='${runFolder.replace(/'/g, `'\\''`)}'`,
    'mkdir -p "$RUN_DIR/control"',
    ...resourceLimitLines({ cores: limits.cores, memoryGb: limits.memoryGb, pids: 0 }, runId),
    '# The run\'s own time limit; --foreground keeps it in this process group, so Cancel still reaches everything.',
    `SEQDESK_TIMEOUT=(); command -v timeout >/dev/null 2>&1 && SEQDESK_TIMEOUT=(timeout --foreground -s TERM -k 120 ${seconds})`,
    'seqdesk_local_limit_words() {',
    '  local status="$1"',
    '  declare -F seqdesk_explain_limits >/dev/null && seqdesk_explain_limits "$status"',
    `  if [ "$status" -eq 124 ]; then echo "ERROR: time limit (${limits.timeHours} h) reached: DUE TO TIME LIMIT on this server. A facility admin can raise SEQDESK_LOCAL_RUN_TIME_HOURS." >> "$STDERR_LOG"; fi`,
    '  return 0',
    '}',
  ];
}
