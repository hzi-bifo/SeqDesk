// Generic Nextflow Trace File Parser
// Works with any nf-core pipeline

import fs from 'fs/promises';
import path from 'path';

export interface NextflowTask {
  taskId: string;
  hash: string;
  nativeId: string;
  name: string;           // Full name like "NFCORE_MAG:MAG:FASTQC (sample1)"
  process: string;        // Extracted process name like "FASTQC"
  tag: string | null;     // Sample/tag like "sample1"
  status: NextflowTaskStatus;
  exit: number | null;
  submit: Date | null;
  start: Date | null;
  complete: Date | null;
  duration: number | null;  // milliseconds
  realtime: number | null;  // milliseconds
  cpuPercent: number | null;
  peakRss: number | null;   // bytes
  peakVmem: number | null;  // bytes
  workdir: string | null;
}

export type NextflowTaskStatus =
  | 'SUBMITTED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'CACHED'
  | 'FAILED'
  | 'ABORTED';

export interface TraceParseResult {
  tasks: NextflowTask[];
  processes: Map<string, ProcessSummary>;
  overallProgress: number;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface ProcessSummary {
  name: string;
  totalTasks: number;
  completedTasks: number;
  runningTasks: number;
  failedTasks: number;
  cachedTasks: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

/**
 * Parse a Nextflow trace.txt file
 */
export async function parseTraceFile(tracePath: string): Promise<TraceParseResult> {
  const content = await fs.readFile(tracePath, 'utf-8');
  return parseTraceContent(content);
}

/**
 * Parse trace file content (useful for testing or when content is already loaded)
 */
export function parseTraceContent(content: string): TraceParseResult {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return {
      tasks: [],
      processes: new Map(),
      overallProgress: 0,
      startedAt: null,
      completedAt: null,
    };
  }

  // Parse header to get column indices
  const header = lines[0].split('\t');
  const colIndex = new Map<string, number>();
  header.forEach((col, idx) => colIndex.set(col.trim(), idx));

  const tasks: NextflowTask[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols.length < 5) continue;

    const fullName = getCol(cols, colIndex, 'name') || '';
    const { process, tag } = parseProcessName(fullName);

    const task: NextflowTask = {
      taskId: getCol(cols, colIndex, 'task_id') || '',
      hash: getCol(cols, colIndex, 'hash') || '',
      nativeId: getCol(cols, colIndex, 'native_id') || '',
      name: fullName,
      process,
      tag,
      status: parseStatus(getCol(cols, colIndex, 'status')),
      exit: parseIntOrNull(getCol(cols, colIndex, 'exit')),
      submit: parseDateOrNull(getCol(cols, colIndex, 'submit')),
      start: parseDateOrNull(getCol(cols, colIndex, 'start')),
      complete: parseDateOrNull(getCol(cols, colIndex, 'complete')),
      duration: parseDurationOrNull(getCol(cols, colIndex, 'duration')),
      realtime: parseDurationOrNull(getCol(cols, colIndex, 'realtime')),
      cpuPercent: parseFloatOrNull(getCol(cols, colIndex, '%cpu')),
      peakRss: parseBytesOrNull(getCol(cols, colIndex, 'peak_rss')),
      peakVmem: parseBytesOrNull(getCol(cols, colIndex, 'peak_vmem')),
      workdir: getCol(cols, colIndex, 'workdir') || null,
    };

    tasks.push(task);
  }

  // Aggregate by process
  const processes = aggregateByProcess(tasks);

  // Calculate overall progress
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(
    (t) => t.status === 'COMPLETED' || t.status === 'CACHED'
  ).length;
  const overallProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Find earliest start and latest complete
  const startTimes = tasks.map((t) => t.start).filter((d): d is Date => d !== null);
  const completeTimes = tasks.map((t) => t.complete).filter((d): d is Date => d !== null);

  return {
    tasks,
    processes,
    overallProgress,
    startedAt: startTimes.length > 0 ? new Date(Math.min(...startTimes.map((d) => d.getTime()))) : null,
    completedAt: completeTimes.length > 0 ? new Date(Math.max(...completeTimes.map((d) => d.getTime()))) : null,
  };
}

/**
 * Parse process name from full Nextflow task name
 * "NFCORE_MAG:MAG:FASTQC (sample1)" -> { process: "FASTQC", tag: "sample1" }
 */
function parseProcessName(fullName: string): { process: string; tag: string | null } {
  // Extract tag from parentheses
  const tagMatch = fullName.match(/\(([^)]+)\)$/);
  const tag = tagMatch ? tagMatch[1] : null;

  // Remove tag and split by colon
  const nameWithoutTag = fullName.replace(/\s*\([^)]+\)$/, '');
  const parts = nameWithoutTag.split(':');

  // Last part is the process name
  const process = parts[parts.length - 1] || fullName;

  return { process, tag };
}

/**
 * Aggregate tasks by process name
 */
function aggregateByProcess(tasks: NextflowTask[]): Map<string, ProcessSummary> {
  const processes = new Map<string, ProcessSummary>();

  for (const task of tasks) {
    let summary = processes.get(task.process);
    if (!summary) {
      summary = {
        name: task.process,
        totalTasks: 0,
        completedTasks: 0,
        runningTasks: 0,
        failedTasks: 0,
        cachedTasks: 0,
        status: 'pending',
      };
      processes.set(task.process, summary);
    }

    summary.totalTasks++;

    switch (task.status) {
      case 'COMPLETED':
        summary.completedTasks++;
        break;
      case 'CACHED':
        summary.cachedTasks++;
        summary.completedTasks++;
        break;
      case 'RUNNING':
        summary.runningTasks++;
        break;
      case 'FAILED':
      case 'ABORTED':
        summary.failedTasks++;
        break;
    }
  }

  // Determine overall status for each process
  for (const summary of processes.values()) {
    if (summary.failedTasks > 0) {
      summary.status = 'failed';
    } else if (summary.runningTasks > 0) {
      summary.status = 'running';
    } else if (summary.completedTasks === summary.totalTasks) {
      summary.status = 'completed';
    } else {
      summary.status = 'pending';
    }
  }

  return processes;
}

// Helper functions
function getCol(cols: string[], colIndex: Map<string, number>, name: string): string | undefined {
  const idx = colIndex.get(name);
  return idx !== undefined ? cols[idx]?.trim() : undefined;
}

function parseStatus(status: string | undefined): NextflowTaskStatus {
  const validStatuses: NextflowTaskStatus[] = ['SUBMITTED', 'RUNNING', 'COMPLETED', 'CACHED', 'FAILED', 'ABORTED'];
  const upper = (status || '').toUpperCase() as NextflowTaskStatus;
  return validStatuses.includes(upper) ? upper : 'SUBMITTED';
}

function parseIntOrNull(val: string | undefined): number | null {
  if (!val || val === '-') return null;
  const num = parseInt(val, 10);
  return isNaN(num) ? null : num;
}

function parseFloatOrNull(val: string | undefined): number | null {
  if (!val || val === '-') return null;
  const num = parseFloat(val.replace('%', ''));
  return isNaN(num) ? null : num;
}

function parseDateOrNull(val: string | undefined): Date | null {
  if (!val || val === '-') return null;
  const date = new Date(val);
  return isNaN(date.getTime()) ? null : date;
}

function parseDurationOrNull(val: string | undefined): number | null {
  if (!val || val === '-') return null;
  // Duration can be in format "1h 2m 3s" or "1.2s" or milliseconds
  const ms = parseDurationToMs(val);
  return ms;
}

function parseDurationToMs(duration: string): number | null {
  // Try parsing as plain number (milliseconds)
  const plainNum = parseFloat(duration);
  if (!isNaN(plainNum) && !duration.match(/[a-zA-Z]/)) {
    return plainNum;
  }

  // Parse format like "1h 2m 3.4s"
  let totalMs = 0;
  const hourMatch = duration.match(/(\d+(?:\.\d+)?)\s*h/i);
  const minMatch = duration.match(/(\d+(?:\.\d+)?)\s*m(?!s)/i);
  const secMatch = duration.match(/(\d+(?:\.\d+)?)\s*s/i);
  const msMatch = duration.match(/(\d+)\s*ms/i);

  if (hourMatch) totalMs += parseFloat(hourMatch[1]) * 3600000;
  if (minMatch) totalMs += parseFloat(minMatch[1]) * 60000;
  if (secMatch) totalMs += parseFloat(secMatch[1]) * 1000;
  if (msMatch) totalMs += parseInt(msMatch[1], 10);

  return totalMs > 0 ? totalMs : null;
}

function parseBytesOrNull(val: string | undefined): number | null {
  if (!val || val === '-') return null;

  // Handle formats like "1.2 GB", "500 MB", "1024 KB", "2048 B"
  const match = val.match(/^([\d.]+)\s*([KMGTP]?B)?$/i);
  if (!match) return null;

  const num = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();

  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };

  return num * (multipliers[unit] || 1);
}

/**
 * Watch a trace file for changes and call callback with updates
 */
export async function watchTraceFile(
  tracePath: string,
  callback: (result: TraceParseResult) => void,
  intervalMs = 5000
): Promise<() => void> {
  let lastModified = 0;
  let running = true;

  const check = async () => {
    try {
      const stat = await fs.stat(tracePath);
      if (stat.mtimeMs > lastModified) {
        lastModified = stat.mtimeMs;
        const result = await parseTraceFile(tracePath);
        callback(result);
      }
    } catch {
      // File doesn't exist yet or can't be read
    }
  };

  // Initial check
  await check();

  // Set up interval
  const interval = setInterval(() => {
    if (running) check();
  }, intervalMs);

  // Return cleanup function
  return () => {
    running = false;
    clearInterval(interval);
  };
}

/**
 * Find trace file in a Nextflow run directory
 */
export async function findTraceFile(runFolder: string): Promise<string | null> {
  const possiblePaths = [
    path.join(runFolder, 'trace.txt'),
    path.join(runFolder, 'pipeline_info', 'trace.txt'),
    path.join(runFolder, 'results', 'pipeline_info', 'trace.txt'),
  ];

  for (const p of possiblePaths) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // Not found at this path
    }
  }

  return null;
}
