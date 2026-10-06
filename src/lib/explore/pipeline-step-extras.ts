/**
 * What a pipeline step's run carries beyond the plain status (identity sheet 96 f5): each sample's state for the dot
 * grid (from the trace, process × sample tag), whether a failed sample can be left out (only where the stage works
 * sample by sample), the CPU hours the run used, and — for "Leave it out and continue" — the run's samplesheet without
 * the samples left out, so Nextflow's -resume continues with the others and keeps all finished work. Also the tables
 * of a finished run without samples left out while it ran or after it.
 */
import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { getPackage } from "@/lib/pipelines/package-loader";
import type { NextflowTask } from "@/lib/pipelines/nextflow/trace-parser";
import type { PlainStatus } from "@/lib/pipelines/plain-status";
import { parseJsonObject } from "./schema";
import { leaveOutCheck, withoutSamples, type LeaveOutCheck } from "./pipeline-quality";
import type { PipelineSnapshot } from "./pipeline-step-runs";
import { parsePipelineStepConfig, listExclusions } from "./pipeline-steps";
import type { BuiltDataset } from "./builders/types";

export type SampleState = "done" | "running" | "failed" | "waiting";

/** Per sample (by the names the run gave them), its state now: the latest stage any of its tasks reached. Pure. */
export function sampleStates(tasks: NextflowTask[], names: string[]): Array<{ sample: string; state: SampleState; stage: string | null }> {
  if (!names.length) return [];
  const known = new Set(names);
  const owner = (tag: string | null) => {
    if (!tag) return null;
    if (known.has(tag)) return tag;
    for (const match of tag.matchAll(/[_.-]/g)) { const head = tag.slice(0, match.index); if (known.has(head)) return head; }
    return null;
  };
  const latest = new Map<string, NextflowTask>();
  const failed = new Map<string, NextflowTask>();
  for (const task of [...tasks].sort((a, b) => (a.submit?.getTime() ?? 0) - (b.submit?.getTime() ?? 0))) {
    const sample = owner(task.tag);
    if (!sample) continue;
    latest.set(sample, task);
    if (task.status === "FAILED") failed.set(sample, task);
    else if (task.status === "COMPLETED" || task.status === "CACHED") { if (failed.get(sample)?.process === task.process) failed.delete(sample); }
  }
  return names.slice(0, 5000).map((sample) => {
    const bad = failed.get(sample);
    if (bad) return { sample, state: "failed" as const, stage: bad.process.split(":").pop() ?? bad.process };
    const task = latest.get(sample);
    if (!task) return { sample, state: "waiting" as const, stage: null };
    const stage = task.process.split(":").pop() ?? task.process;
    return { sample, state: task.status === "RUNNING" || task.status === "SUBMITTED" ? "running" as const : "done" as const, stage };
  });
}

/** The extras of a snapshot: sample states, leave-out, CPU hours. */
export function snapshotExtras(input: { pipelineId: string; tasks: NextflowTask[]; names: string[]; plain: Pick<PlainStatus, "processes"> | undefined; snapshot: Pick<PipelineSnapshot, "status" | "progress" | "error" | "stages"> }): { sampleStates?: ReturnType<typeof sampleStates>; leaveOut?: LeaveOutCheck | null; cpuHours?: number | null } {
  const states = sampleStates(input.tasks, input.names);
  const cpu = input.plain?.processes?.reduce((sum, process) => sum + (process.cpuHours ?? 0), 0) ?? 0;
  const check = leaveOutCheck(input.pipelineId, input.snapshot);
  return { ...(states.length ? { sampleStates: states } : {}), ...(check ? { leaveOut: check } : {}), ...(cpu ? { cpuHours: Math.round(cpu * 10) / 10 } : {}) };
}

/**
 * The run's samplesheet without some samples (a copy of the original is kept beside it), and its input samples
 * without them, so -resume continues with the others. Returns the samples removed.
 */
export async function dropFromSamplesheet(pipelineRunId: string, samples: string[]): Promise<string[]> {
  if (!samples.length) return [];
  const run = await db.pipelineRun.findUnique({ where: { id: pipelineRunId }, select: { id: true, pipelineId: true, runFolder: true, inputSampleIds: true } });
  if (!run?.runFolder) return [];
  const sheet = getPackage(run.pipelineId)?.samplesheet?.samplesheet;
  const file = path.join(run.runFolder, sheet?.filename ?? "samplesheet.csv");
  const text = await fs.readFile(file, "utf8").catch(() => null);
  if (text === null) return [];
  const separator = (sheet?.format ?? (file.endsWith(".tsv") ? "tsv" : "csv")) === "tsv" ? "\t" : ",";
  const lines = text.split(/\r?\n/);
  const header = lines[0]?.split(separator).map((cell) => cell.replace(/^"|"$/g, "")) ?? [];
  const sampleColumn = sheet?.columns.find((column) => column.source === "sample.sampleId" || column.source === "sample.sampleAlias")?.name ?? header[0];
  const at = Math.max(0, header.indexOf(sampleColumn));
  const drop = new Set(samples);
  const removed: string[] = [];
  const kept = lines.filter((line, index) => {
    if (index === 0 || !line.trim()) return true;
    const name = line.split(separator)[at]?.replace(/^"|"$/g, "") ?? "";
    if (drop.has(name)) { removed.push(name); return false; }
    return true;
  });
  if (!removed.length) return [];
  await fs.writeFile(`${file}.before-leave-out-${Date.now()}`, text, "utf8");
  await fs.writeFile(file, kept.join("\n"), "utf8");
  // The run's input samples follow (the tables are built from them).
  let ids: string[] = [];
  try { const parsed = JSON.parse(run.inputSampleIds ?? "null"); ids = Array.isArray(parsed) ? parsed.map(String) : []; } catch { ids = []; }
  if (ids.length) {
    const left = await db.sample.findMany({ where: { id: { in: ids }, sampleId: { in: removed } }, select: { id: true } });
    const gone = new Set(left.map((sample) => sample.id));
    await db.pipelineRun.update({ where: { id: run.id }, data: { inputSampleIds: JSON.stringify(ids.filter((id) => !gone.has(id))) } });
  }
  await db.pipelineRunEvent.create({ data: { pipelineRunId: run.id, eventType: "note", source: "launcher", message: `Left out: ${removed.join(", ")}; resumed without ${removed.length === 1 ? "it" : "them"}` } }).catch(() => undefined);
  return removed;
}

/** Samples left out of a pipeline step while it ran or after it (in its own configuration or its Choose samples step). */
export async function laterExcludedOf(analysisId: string): Promise<Set<string>> {
  const analysis = await db.exploreAnalysis.findUnique({ where: { id: analysisId }, select: { currentRevisionId: true } }).catch(() => null);
  const revision = analysis?.currentRevisionId ? await db.exploreAnalysisRevision.findUnique({ where: { id: analysis.currentRevisionId } }).catch(() => null) : null;
  const config = parsePipelineStepConfig((revision as { pipeline?: unknown } | null)?.pipeline);
  if (!config) return new Set();
  const fromList = config.samples?.from === "table" ? await listExclusions(config.samples.datasetId) : [];
  return new Set([...(config.exclusions ?? []), ...fromList].filter((entry) => entry.stage !== "before" && (!entry.stepId || entry.stepId === analysisId)).map((entry) => entry.sample));
}

/** A built table without the samples left out. */
export function builtWithout(built: BuiltDataset, samples: Set<string>): BuiltDataset {
  if (!samples.size) return built;
  const filtered = withoutSamples(built.schema, built.rows, samples);
  if (!filtered.removedRows && !filtered.removedColumns.length) return built;
  return { ...built, schema: filtered.schema, rows: filtered.rows, provenance: { ...built.provenance, notes: [...(built.provenance.notes ?? []), `Left out: ${[...samples].join(", ")}`] } };
}

export const resultsOf = (results: string | null | undefined) => parseJsonObject(results ?? null) ?? {};
