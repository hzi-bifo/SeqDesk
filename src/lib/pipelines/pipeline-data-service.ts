/**
 * Pipelines from an Analysis study's Data (S-25P, S-25L), for the integration API:
 *
 *   readiness      each enabled pipeline checked against the study's Data: required inputs found, missing
 *                  reference databases, and an estimate from past runs at a similar size ("no estimate yet")
 *   runs           the study's pipeline runs as cards: plain status, stages, outputs and their versions in Data
 *   run view       one run's record: plain status, processes from the trace, first error lines, provenance
 *   start          a run on the study's reads (mirrored into the backing SeqDesk study, data-study.ts)
 *   output → Data  a finished run's table output becomes a dataset in the study's Data pinned to that run
 *
 * Pipelines are not recipe steps: recipes and pipelines exchange data only through Data, as versioned tables pinned
 * to a run. Everything the web sees of a log passes redactLog (conda channel credentials, token shapes).
 */
import fs from 'fs/promises';
import path from 'path';
import { db } from '@/lib/db';
import { PIPELINE_REGISTRY } from './registry';
import { getPipelineEnabled } from './enablement';
import { getPackage } from './package-loader';
import { getExecutionSettings } from './execution-settings';
import { getPipelineDatabaseStatuses } from './database-downloads';
import { parsePipelineConfig } from './pipeline-readiness-service';
import { findDataStudy, readsInData, readsWords, type DataReadPair } from './data-study';
import { durationWords, memoryWords, plainRunStatus, redactLog, type PlainStatus } from './plain-status';
import { runBuilder } from '@/lib/explore/build';
import { createDataset, writeDatasetVersion } from '@/lib/explore/datasets';
import { resolveTableSpec } from '@/lib/explore/builders/pipeline-table';
import { outputFileView } from '@/lib/explore/pipeline-output-types';
import { readTail } from './nextflow';
import { parseTraceContent } from './nextflow/trace-parser';

/** What a pipeline does, in the drawer's groups. */
const GROUPS: Record<string, { group: string; typical: string }> = {
  mag: { group: 'Genomes from reads', typical: 'hours' },
  fastqc: { group: 'Check reads', typical: 'minutes' },
  'reads-qc': { group: 'Check reads', typical: 'minutes' },
  nanoplot: { group: 'Check reads', typical: 'minutes' },
  multiqc: { group: 'Check reads', typical: 'minutes' },
  'fastq-checksum': { group: 'Check reads', typical: 'minutes' },
  'read-cleaning': { group: 'Clean reads', typical: 'under an hour' },
  'kraken2-bracken': { group: 'Who is there', typical: 'about an hour' },
  metaphlan: { group: 'Who is there', typical: 'about an hour' },
  'cami-opal': { group: 'Benchmarks', typical: 'minutes' },
  submg: { group: 'Submission', typical: 'under an hour' },
};
const HIDDEN = new Set(['_example', 'study-demo-report', 'simulate-reads']);
const QC_SOURCES = ['fastqc', 'nanoplot'];

export type PipelineReadiness = {
  id: string; name: string; version: string; description: string; group: string; typical: string; where: string;
  state: 'ready' | 'not-yet' | 'blocked';
  /** One readiness line: "Ready with 1 FASTQ pair · about 6 min", "Needs a FastQC run on these reads first". */
  line: string;
  found: string[]; missing: string[];
  estimate: { seconds: number | null; words: string };
  inputs: { id: string; label: string; found: string | null; optional: boolean }[];
  outputs: { id: string; label: string; kind: string }[];
  settings: { key: string; title: string; description?: string; type: string; default?: unknown; enum?: unknown[] }[];
  citation?: string | null; license?: string | null; homepage?: string | null;
};

const sampleCount = (raw: string | null) => { try { const v = JSON.parse(raw ?? 'null'); return Array.isArray(v) ? v.length : null; } catch { return null; } };

/** Durations of past finished runs of a pipeline at a similar size (half to twice the samples). */
export async function pastDurations(pipelineId: string, samples: number | null): Promise<number[]> {
  const runs = await db.pipelineRun.findMany({ where: { pipelineId, status: 'completed', startedAt: { not: null }, completedAt: { not: null } },
    select: { startedAt: true, completedAt: true, inputSampleIds: true }, orderBy: { completedAt: 'desc' }, take: 40 });
  return runs.filter((run) => { const n = sampleCount(run.inputSampleIds); return samples == null || n == null || (n >= samples / 2 && n <= samples * 2); })
    .map((run) => Math.round((run.completedAt!.getTime() - run.startedAt!.getTime()) / 1000)).filter((s) => s > 0);
}

const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

function looksLong(pairs: DataReadPair[]) { return pairs.some((p) => /ont|nanopore|pacbio|hifi|long|minion|promethion/i.test(p.r1.name)); }

function outputKind(output: { id: string; type?: string; discovery?: { pattern?: string } }, pipelineId: string): string {
  const { spec } = resolveTableSpec(pipelineId, output.id);
  if (spec) return 'table';
  const pattern = output.discovery?.pattern ?? '';
  if (/\.html$/i.test(pattern) || output.type === 'report') return 'report';
  return outputFileView(pattern || output.id).kind;
}

/** The pipelines this server offers for Analysis studies (enabled, study-capable, not internal). */
export async function dataPipelines() {
  const list = [];
  for (const definition of Object.values(PIPELINE_REGISTRY)) {
    if (HIDDEN.has(definition.id) || !definition.input.supportedScopes.includes('study')) continue;
    if (!(await getPipelineEnabled(definition.id))) continue;
    const pkg = getPackage(definition.id);
    if (!pkg) continue;
    list.push({ definition, pkg });
  }
  return list;
}

export async function pipelineReadiness(targetKey: string): Promise<{ reads: string; where: string; pipelines: PipelineReadiness[] }> {
  const [{ pairs }, settings, dataStudy] = await Promise.all([readsInData(targetKey), getExecutionSettings(), findDataStudy(targetKey)]);
  const where = settings.useSlurm ? 'SLURM' : 'this server';
  const priorQc = dataStudy ? await db.pipelineRun.findMany({ where: { studyId: dataStudy.id, status: 'completed', pipelineId: { in: QC_SOURCES } }, select: { runNumber: true, pipelineId: true }, orderBy: { completedAt: 'desc' } }) : [];
  const result: PipelineReadiness[] = [];
  for (const { definition, pkg } of await dataPipelines()) {
    const manifest = pkg.manifest;
    const found: string[] = [], missing: string[] = [];
    const inputs: PipelineReadiness['inputs'] = [];
    const requires = (pkg.registry as { requires?: Record<string, boolean> }).requires ?? {};
    const long = manifest.sequencingCompatibility?.readLengthClass === 'long';
    for (const input of manifest.inputs) {
      if (input.source === 'sample.reads') {
        const ok = pairs.length > 0 && (!long || looksLong(pairs));
        inputs.push({ id: input.id, label: long ? 'Long reads' : 'Reads', found: ok ? readsWords(pairs) : null, optional: !input.required });
        if (ok) found.push(readsWords(pairs));
        else if (input.required) missing.push(!pairs.length ? 'Needs FASTQ reads in Data' : 'Not for this data: no long reads');
      } else if (input.id === 'samples' && definition.id === 'multiqc') {
        const qc = priorQc[0];
        inputs.push({ id: 'qc', label: 'FastQC or NanoPlot results', found: qc ? `${qc.pipelineId === 'fastqc' ? 'FastQC' : 'NanoPlot'} · ${qc.runNumber}` : null, optional: false });
        if (qc) found.push(`${qc.pipelineId === 'fastqc' ? 'FastQC' : 'NanoPlot'} results from ${qc.runNumber}`);
        else missing.push('Needs a FastQC run on these reads first');
      }
    }
    for (const [need, words] of [['assemblies', 'assemblies'], ['bins', 'genome bins'], ['studyAccession', 'an ENA study accession'], ['sampleMetadata', 'sample metadata']] as const) {
      if (requires[need]) missing.push(`Not for this data yet: needs ${words}`);
    }
    const config = parsePipelineConfig((await db.pipelineConfig.findUnique({ where: { pipelineId: definition.id }, select: { config: true } }))?.config);
    const databases = await getPipelineDatabaseStatuses(definition.id, config, settings.pipelineRunDir, (settings as { pipelineDatabaseDir?: string | null }).pipelineDatabaseDir).catch(() => []);
    const blocked = databases.filter((d) => d.status !== 'downloaded');
    for (const database of blocked) missing.push(`Needs the ${database.label} database on ${where === 'SLURM' ? 'the cluster' : 'this server'}`);
    const durations = await pastDurations(definition.id, pairs.length || null);
    const seconds = median(durations);
    const estimate = { seconds, words: seconds == null ? 'no estimate yet' : `about ${durationWords(seconds)}` };
    const state: PipelineReadiness['state'] = blocked.length ? 'blocked' : missing.length ? 'not-yet' : 'ready';
    const line = state === 'ready' ? `Ready with ${found.join(' + ') || 'this study’s Data'} · ${estimate.words}${where === 'SLURM' ? ' on SLURM' : ''}` : missing[0];
    const schema = definition.configSchema?.properties ?? {};
    result.push({
      id: definition.id, name: manifest.package.name, version: manifest.package.version, description: manifest.package.description,
      group: GROUPS[definition.id]?.group ?? 'Other', typical: GROUPS[definition.id]?.typical ?? '', where, state, line, found, missing, estimate, inputs,
      outputs: manifest.outputs.filter((o) => o.destination !== 'sample_reads' && !/writeback/i.test(o.id)).map((o) => ({ id: o.id, label: o.result?.preview?.label ?? o.id.replace(/[_-]+/g, ' '), kind: outputKind(o as never, definition.id) })),
      settings: Object.entries(schema).filter(([, p]) => { const placement = (p as { 'x-seqdesk'?: { placement?: string } })['x-seqdesk']?.placement; return placement !== 'hidden' && placement !== 'derived' && placement !== 'admin'; })
        .map(([key, p]) => { const prop = p as { title?: string; description?: string; type?: string; default?: unknown; enum?: unknown[] }; return { key, title: prop.title ?? key, description: prop.description, type: prop.type ?? 'string', default: prop.default, enum: prop.enum }; }),
      citation: (manifest.package as { citation?: string }).citation ?? null, license: (manifest.package as { license?: string }).license ?? null,
      homepage: (manifest.package as { homepage?: string }).homepage ?? null,
    });
  }
  const order = ['Genomes from reads', 'Check reads', 'Clean reads', 'Who is there', 'Benchmarks', 'Submission', 'Other'];
  result.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || Number(a.state !== 'ready') - Number(b.state !== 'ready') || a.name.localeCompare(b.name));
  return { reads: readsWords(pairs), where, pipelines: result };
}

// ------------------------------------------------------------------ runs

type RunRow = Awaited<ReturnType<typeof loadRuns>>[number];
async function loadRuns(where: { id?: string; studyId?: string }) {
  return db.pipelineRun.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50, select: {
    id: true, runNumber: true, pipelineId: true, status: true, executionMode: true, executionProfile: true, queueJobId: true, queueStatus: true, queueReason: true,
    currentStep: true, queuedAt: true, startedAt: true, completedAt: true, createdAt: true, outputTail: true, errorTail: true, runFolder: true, inputSampleIds: true,
    config: true, user: { select: { id: true, firstName: true, lastName: true, email: true } },
    artifacts: { select: { id: true, outputId: true, path: true, name: true, size: true, sampleId: true, type: true } },
    events: { where: { eventType: 'resumed' }, select: { occurredAt: true, message: true }, orderBy: { occurredAt: 'asc' } },
  } });
}

function slurmOf(profile: string | null) {
  try { const p = JSON.parse(profile ?? '{}'); return p && typeof p === 'object' ? (p.slurm as { memory?: string; timeLimit?: number; queue?: string; cores?: number } | undefined) ?? null : null; } catch { return null; }
}

async function readHead(file: string, bytes = 16_384): Promise<string> {
  const handle = await fs.open(file, 'r').catch(() => null);
  if (!handle) return '';
  try { const buffer = Buffer.alloc(bytes); const { bytesRead } = await handle.read(buffer, 0, bytes, 0); return buffer.subarray(0, bytesRead).toString('utf8'); } finally { await handle.close(); }
}

/** Where the run's provenance comes from: Nextflow's own log, the conda cache and the package. */
async function provenanceOf(run: RunRow) {
  const pkg = getPackage(run.pipelineId);
  const log = run.runFolder ? await readHead(path.join(run.runFolder, '.nextflow.log')) : '';
  const nextflowVersion = /N E X T F L O W\s+~\s+version\s+([\d.]+)/.exec(log)?.[1] ?? /version\s+(\d+\.\d+\.\d+)/.exec(`${log}\n${run.outputTail ?? ''}`)?.[1] ?? null;
  const revision = /revision:\s*([0-9a-f]{6,40})/.exec(`${log}\n${run.outputTail ?? ''}`)?.[1] ?? null;
  const condaDir = run.runFolder ? path.join(run.runFolder, 'work', 'conda') : null;
  const envs = condaDir ? (await fs.readdir(condaDir).catch(() => [] as string[])).filter((name) => /^env-/.test(name) && !name.endsWith('.lock')) : [];
  const slurm = run.executionMode === 'slurm';
  return {
    pipelineId: run.pipelineId, pipelineName: pkg?.manifest.package.name ?? run.pipelineId, pipelineVersion: pkg?.manifest.package.version ?? null,
    workflowVersion: pkg?.manifest.execution.version ?? null, nextflowVersion, revision: revision ?? (pkg?.manifest.execution.pipeline?.startsWith('./') ? 'bundled package' : null),
    runId: run.id, runNumber: run.runNumber,
    environments: envs.map((name) => ({ name, digest: name.replace(/^env-/, '').slice(0, 32) })),
    isolation: `Runs on ${slurm ? 'SLURM' : 'this server'} · network for environment setup`,
  };
}

function outputsOf(run: RunRow) {
  const pkg = getPackage(run.pipelineId);
  const groups = new Map<string, { id: string; label: string; kind: string; files: { id: string; name: string; path: string; size: number | null; sample: string | null }[] }>();
  for (const artifact of run.artifacts) {
    const outputId = artifact.outputId ?? 'files';
    const output = pkg?.manifest.outputs.find((o) => o.id === outputId);
    if (output?.destination === 'sample_reads') continue;
    let group = groups.get(outputId);
    if (!group) {
      group = { id: outputId, label: output?.result?.preview?.label ?? outputId.replace(/[_-]+/g, ' '), kind: output ? outputKind(output as never, run.pipelineId) : outputFileView(artifact.path).kind, files: [] };
      groups.set(outputId, group);
    }
    group.files.push({ id: artifact.id, name: artifact.name ?? path.basename(artifact.path), path: artifact.path, size: artifact.size == null ? null : Number(artifact.size), sample: artifact.sampleId });
  }
  return [...groups.values()];
}

async function failedTaskError(runFolder: string | null, trace: string | null): Promise<string | null> {
  if (!runFolder || !trace) return null;
  const failed = trace.split(/\r?\n/).find((line) => /\tFAILED\t/.test(line));
  const workdir = failed?.split('\t').find((cell) => /\/work\/[0-9a-f]{2}\//.test(cell));
  if (!workdir) return null;
  const inside = path.resolve(workdir).startsWith(path.resolve(runFolder));
  if (!inside) return null;
  return [await readTail(path.join(workdir, '.command.err'), 40), await readTail(path.join(workdir, '.command.log'), 20)].filter(Boolean).join('\n') || null;
}

/** One run as a card/record: plain status, outputs, provenance, datasets made from it. */
export async function runView(run: RunRow, options: { detail?: boolean; targetKey?: string } = {}) {
  const trace = run.runFolder ? await fs.readFile(path.join(run.runFolder, 'trace.txt'), 'utf8').catch(() => null) : null;
  const slurm = slurmOf(run.executionProfile);
  const samples = sampleCount(run.inputSampleIds);
  const [past, taskError] = await Promise.all([pastDurations(run.pipelineId, samples), run.status === 'failed' ? failedTaskError(run.runFolder, trace) : null]);
  // Local runs have no asked memory: Resume offers twice the failed task's peak.
  let askedMemory = slurm?.memory ?? null;
  if (!askedMemory && trace && run.status === 'failed') {
    const peak = Math.max(0, ...parseTraceContent(trace).tasks.filter((t) => t.status === 'FAILED').map((t) => t.peakRss ?? 0));
    askedMemory = memoryWords(Math.max(peak, 1024 ** 3)) || '1 GB';
  }
  const outputs = outputsOf(run);
  const status: PlainStatus = plainRunStatus({ run: { ...run, askedMemory, timeLimitHours: slurm?.timeLimit ?? null, outputCount: outputs.length }, trace, taskError, pastSeconds: past });
  const pkg = getPackage(run.pipelineId);
  const datasets = options.targetKey ? await db.exploreDataset.findMany({ where: { targetKey: options.targetKey, kind: 'pipeline-table', sourceConfig: { contains: `"runIds":["${run.id}"]` } }, select: { id: true, name: true, sourceConfig: true, currentVersionId: true, versions: { select: { number: true }, orderBy: { number: 'desc' }, take: 1 } } }) : [];
  const person = run.user ? [run.user.firstName, run.user.lastName].filter(Boolean).join(' ') || run.user.email : null;
  const base = {
    id: run.id, runNumber: run.runNumber, pipelineId: run.pipelineId, pipelineName: pkg?.manifest.package.name ?? run.pipelineId, version: pkg?.manifest.package.version ?? null,
    status: run.status, where: run.executionMode === 'slurm' ? 'SLURM' : 'this server', samples, startedBy: person,
    createdAt: run.createdAt.toISOString(), startedAt: run.startedAt?.toISOString() ?? null, completedAt: run.completedAt?.toISOString() ?? null,
    resumed: run.events.length, plain: { ...status, processes: options.detail ? status.processes : [] },
    outputs: outputs.map((output) => {
      const dataset = datasets.find((d) => { try { return JSON.parse(d.sourceConfig ?? '{}').outputId === output.id; } catch { return false; } });
      return { ...output, dataset: dataset ? { id: dataset.id, name: dataset.name, version: dataset.versions[0]?.number ?? null } : null };
    }),
    asked: slurm ? { cores: slurm.cores ?? null, memory: slurm.memory ?? null, timeHours: slurm.timeLimit ?? null, queue: slurm.queue ?? null } : null,
  };
  if (!options.detail) return base;
  const logLines = redactLog([run.outputTail ?? '', run.errorTail ?? ''].join('\n')).split(/\r?\n/).filter((l) => l.trim()).slice(-40);
  return { ...base, provenance: await provenanceOf(run), log: logLines, workFolder: run.runFolder ? path.join(run.runFolder, 'work') : null, queueJobId: run.queueJobId,
    config: (() => { try { return JSON.parse(run.config ?? '{}'); } catch { return {}; } })() };
}

export async function listDataRuns(targetKey: string) {
  const study = await findDataStudy(targetKey);
  if (!study) return [];
  const runs = await loadRuns({ studyId: study.id });
  return Promise.all(runs.map((run) => runView(run, { targetKey })));
}

export async function getDataRun(runId: string, targetKey?: string) {
  const [run] = await loadRuns({ id: runId });
  return run ? runView(run, { detail: true, targetKey }) : null;
}

/** Whether a run belongs to the Data of this Analysis study (its backing study). */
export async function runBelongsTo(runId: string, targetKey: string): Promise<boolean> {
  const study = await findDataStudy(targetKey);
  if (!study) return false;
  return !!(await db.pipelineRun.findFirst({ where: { id: runId, studyId: study.id }, select: { id: true } }));
}

// ------------------------------------------------------------------ output → Data

/**
 * A finished run's table output as a dataset in the study's Data, pinned to that run: one dataset per (output, run),
 * named "<label> · <run number>". A newer run makes a new dataset; each analysis decides which one it reads.
 */
export async function runOutputToData(input: { runId: string; outputId: string; targetKey: string; userId: string }) {
  const run = await db.pipelineRun.findUnique({ where: { id: input.runId }, select: { id: true, runNumber: true, pipelineId: true, status: true, studyId: true } });
  if (!run?.studyId) throw Object.assign(new Error('Run not found.'), { status: 404 });
  if (run.status !== 'completed') throw Object.assign(new Error('Only a finished run’s outputs can go to Data.'), { status: 409 });
  const built = await runBuilder('pipeline-table', { target: { type: 'study', id: run.studyId }, targetKey: `study:${run.studyId}`, userId: input.userId, installation: false, isFacilityAdmin: false },
    { pipelineId: run.pipelineId, outputId: input.outputId, runIds: [run.id] });
  if (!built) throw Object.assign(new Error('This output has no table in this run.'), { status: 404 });
  const sourceConfig = { ...built.sourceConfig, runIds: [run.id], pipelineRun: { id: run.id, runNumber: run.runNumber } };
  const json = JSON.stringify(sourceConfig);
  let dataset = await db.exploreDataset.findFirst({ where: { targetKey: input.targetKey, kind: built.kind, sourceConfig: json }, select: { id: true } });
  if (!dataset) {
    const { output } = resolveTableSpec(run.pipelineId, input.outputId);
    const label = output?.result?.preview?.label ?? built.name;
    dataset = await createDataset({ targetKey: input.targetKey, kind: built.kind, tableKind: built.tableKind, name: `${label} · ${run.runNumber}`.slice(0, 200),
      description: `${built.description ? `${built.description} ` : ''}From pipeline run ${run.runNumber}.`.slice(0, 1000), sensitivity: built.sensitivity, roles: built.roles, sourceConfig, createdById: input.userId });
  }
  const [row] = await loadRuns({ id: run.id });
  const provenance = { ...built.provenance, pipeline: await provenanceOf(row) } as typeof built.provenance;
  const version = await writeDatasetVersion({ datasetId: dataset.id, schema: built.schema, rows: built.rows, provenance, buildSource: 'auto', createdById: input.userId, keys: built.keys });
  return { datasetId: dataset.id, version: version.number, rows: version.rowCount, warnings: built.warnings };
}
