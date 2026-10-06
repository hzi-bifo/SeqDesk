/**
 * Table imports that outlive a request. A large file takes minutes to read; the request that starts it returns
 * at once with a job, the web app asks for its progress sentence and can cancel it. Jobs live in this process
 * (a restart ends them; the half-written table is removed by the import itself when it stops).
 */
import { randomUUID } from "node:crypto";

export type ImportJobState = "running" | "done" | "failed" | "cancelled";

export interface ImportJob {
  id: string;
  targetKey: string;
  userId: string;
  fileName: string;
  sizeBytes: number;
  state: ImportJobState;
  rows: number;
  /** Rows the file probably has (from the preview estimate), for a percentage. */
  expectedRows: number | null;
  startedAt: number;
  finishedAt: number | null;
  datasetId: string | null;
  error: string | null;
  warnings: string[];
  /** The caller's own key for this import: asking again with it (a lost response, a second click) finds this job instead of starting another. */
  requestKey: string | null;
  controller: AbortController;
}

const jobs = new Map<string, ImportJob>();
const KEEP_FINISHED_MS = 60 * 60 * 1000;

function prune(now = Date.now()) {
  for (const [id, job] of jobs) if (job.finishedAt && now - job.finishedAt > KEEP_FINISHED_MS) jobs.delete(id);
}

export function createImportJob(input: { targetKey: string; userId: string; fileName: string; sizeBytes: number; expectedRows: number | null; requestKey?: string | null }): ImportJob {
  prune();
  const job: ImportJob = { id: randomUUID(), ...input, requestKey: input.requestKey ?? null, state: "running", rows: 0, startedAt: Date.now(), finishedAt: null, datasetId: null, error: null, warnings: [], controller: new AbortController() };
  jobs.set(job.id, job);
  return job;
}

/** The job this person already started with this key for this target, unless it ended without a table (then a new one may start). */
export function findImportJobByKey(userId: string, targetKey: string, requestKey: string): ImportJob | null {
  for (const job of jobs.values()) {
    if (job.requestKey === requestKey && job.userId === userId && job.targetKey === targetKey && job.state !== "failed" && job.state !== "cancelled") return job;
  }
  return null;
}

export function getImportJob(id: string): ImportJob | null {
  return jobs.get(id) ?? null;
}

export function finishImportJob(job: ImportJob, outcome: { state: Exclude<ImportJobState, "running">; datasetId?: string | null; error?: string | null; warnings?: string[] }) {
  job.state = outcome.state;
  job.datasetId = outcome.datasetId ?? job.datasetId;
  job.error = outcome.error ?? null;
  if (outcome.warnings) job.warnings = outcome.warnings;
  job.finishedAt = Date.now();
}

export function cancelImportJob(job: ImportJob) {
  if (job.state === "running") job.controller.abort();
}

const count = (n: number) => n.toLocaleString("en-US");

function duration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

/** One sentence for the person waiting: what is happening and how far along it is. */
export function importJobSentence(job: ImportJob, now = Date.now()): string {
  const elapsed = (job.finishedAt ?? now) - job.startedAt;
  if (job.state === "done") return `Imported ${count(job.rows)} rows in ${duration(elapsed)}.`;
  if (job.state === "cancelled") return "Import cancelled; nothing was kept.";
  if (job.state === "failed") return `Import stopped: ${job.error ?? "unknown error"}. Nothing was kept.`;
  if (job.rows === 0) return `Reading ${job.fileName}…`;
  if (job.expectedRows && job.expectedRows > job.rows) {
    const share = job.rows / job.expectedRows;
    const left = share > 0.05 ? ` · about ${duration((elapsed / share) * (1 - share))} left` : "";
    return `Read ${count(job.rows)} of about ${count(job.expectedRows)} rows (${Math.round(share * 100)}%)${left}.`;
  }
  return `Read ${count(job.rows)} rows so far.`;
}

export function serializeImportJob(job: ImportJob) {
  return {
    id: job.id, state: job.state, fileName: job.fileName, sizeBytes: job.sizeBytes, rows: job.rows, expectedRows: job.expectedRows,
    startedAt: new Date(job.startedAt).toISOString(), finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
    datasetId: job.datasetId, error: job.error, warnings: job.warnings, sentence: importJobSentence(job),
  };
}
