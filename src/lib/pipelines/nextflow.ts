import fs from 'fs/promises';
import path from 'path';

export interface TraceTask {
  process: string;
  status: string;
  exit?: number;
  submit?: Date;
  start?: Date;
  complete?: Date;
  tag?: string;
}

export interface TraceProcessSummary {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  totalTasks: number;
}

export interface TraceResult {
  tasks: TraceTask[];
  processes: Map<string, TraceProcessSummary>;
  overallProgress: number;
  startedAt?: Date;
  completedAt?: Date;
}

function parseTraceDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function normalizeStatus(value?: string): string {
  if (!value) return '';
  return value.toLowerCase();
}

function summarizeProcessStatuses(tasks: TraceTask[]): TraceProcessSummary {
  let hasRunning = false;
  let hasFailed = false;
  let hasCompleted = false;

  for (const task of tasks) {
    const status = normalizeStatus(task.status);
    if (
      status.includes('fail') ||
      status.includes('error') ||
      status.includes('aborted') ||
      (task.exit !== undefined && task.exit !== 0)
    ) {
      hasFailed = true;
    } else if (status.includes('run') || status.includes('start') || status.includes('submit')) {
      hasRunning = true;
    } else if (
      status.includes('complete') ||
      status.includes('done') ||
      status.includes('success') ||
      status.includes('cache')
    ) {
      hasCompleted = true;
    }
  }

  let status: TraceProcessSummary['status'] = 'pending';
  if (hasFailed) status = 'failed';
  else if (hasRunning) status = 'running';
  else if (hasCompleted) status = 'completed';

  return { name: tasks[0]?.process || 'unknown', status, totalTasks: tasks.length };
}

function isSuccessStatus(status: string): boolean {
  return (
    status.includes('complete') ||
    status.includes('done') ||
    status.includes('success') ||
    status.includes('cache')
  );
}

/**
 * Collapse retried tasks (a FAILED attempt row plus a later COMPLETED/CACHED retry
 * row for the same logical task) to one row per logical identity (process + tag),
 * preferring a terminal-success row over an earlier failed attempt. Used only for
 * progress aggregation; the returned task list keeps every row.
 */
function dedupeRetriedTasks(tasks: TraceTask[]): TraceTask[] {
  const byIdentity = new Map<string, TraceTask>();

  for (const task of tasks) {
    const identity = `${task.process}\u0000${task.tag ?? ''}`;
    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, task);
      continue;
    }
    // Prefer a success row over a non-success (e.g. failed) attempt.
    if (!isSuccessStatus(normalizeStatus(existing.status)) && isSuccessStatus(normalizeStatus(task.status))) {
      byIdentity.set(identity, task);
    }
  }

  return Array.from(byIdentity.values());
}

export async function findTraceFile(runFolder: string): Promise<string | null> {
  const direct = path.join(runFolder, 'trace.txt');
  try {
    await fs.access(direct);
    return direct;
  } catch {
    // fallback to search
  }

  try {
    const entries = await fs.readdir(runFolder);
    const match = entries.find((entry) => entry.startsWith('trace') && entry.endsWith('.txt'));
    return match ? path.join(runFolder, match) : null;
  } catch {
    return null;
  }
}

export async function parseTraceFile(tracePath: string): Promise<TraceResult> {
  const content = await fs.readFile(tracePath, 'utf8');
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    return { tasks: [], processes: new Map(), overallProgress: 0 };
  }

  const header = lines[0].split('\t');
  const idx = (name: string) => header.indexOf(name);
  const get = (cols: string[], name: string) => {
    const pos = idx(name);
    return pos >= 0 ? cols[pos] : undefined;
  };

  const tasks: TraceTask[] = [];

  for (const line of lines.slice(1)) {
    const cols = line.split('\t');
    const process = (get(cols, 'process') || get(cols, 'name') || '').trim();
    if (!process) continue;

    const status = (get(cols, 'status') || get(cols, 'state') || '').trim();
    const exitRaw = get(cols, 'exit');
    const exit = exitRaw ? Number.parseInt(exitRaw, 10) : undefined;

    tasks.push({
      process,
      status,
      exit: Number.isNaN(exit) ? undefined : exit,
      submit: parseTraceDate(get(cols, 'submit')),
      start: parseTraceDate(get(cols, 'start')),
      complete: parseTraceDate(get(cols, 'complete')),
      tag: get(cols, 'tag')?.trim(),
    });
  }

  const processes = new Map<string, TraceProcessSummary>();
  const tasksByProcess = new Map<string, TraceTask[]>();

  for (const task of tasks) {
    if (!tasksByProcess.has(task.process)) {
      tasksByProcess.set(task.process, []);
    }
    tasksByProcess.get(task.process)!.push(task);
  }

  for (const [processName, processTasks] of tasksByProcess) {
    const summary = summarizeProcessStatuses(processTasks);
    processes.set(processName, summary);
  }

  const dedupedTasks = dedupeRetriedTasks(tasks);
  const total = dedupedTasks.length || 1;
  const completed = dedupedTasks.filter((task) => {
    const status = normalizeStatus(task.status);
    return (
      status.includes('complete') ||
      status.includes('done') ||
      status.includes('success') ||
      status.includes('cache')
    );
  }).length;
  const overallProgress = Math.round((completed / total) * 100);

  const startedAt = tasks
    .map((t) => t.start || t.submit)
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  const completedAt = tasks
    .map((t) => t.complete)
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return { tasks, processes, overallProgress, startedAt, completedAt };
}

export async function readTail(filePath?: string | null, maxLines = 100): Promise<string | null> {
  if (!filePath) return null;
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    return lines.slice(-maxLines).join('\n');
  } catch {
    return null;
  }
}
