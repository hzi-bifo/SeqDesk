/**
 * Pipelines on an Analysis study's Data, for the collaboration web app (S-25P "pipelines and big runs", S-25L
 * "Library"). Access follows the study (`project:<id>` target), like the rest of Analysis:
 *
 *   GET  data-pipelines?targetKey                           readiness of each enabled pipeline against the study's Data
 *   GET  data-pipelines/runs?targetKey                      the study's pipeline runs as cards
 *   POST data-pipelines/runs            { targetKey, pipelineId, config?, samples? }   start a run on the study's reads
 *   GET  data-pipelines/runs/{id}?targetKey                 one run: plain status, processes, log, provenance
 *   POST data-pipelines/runs/{id}/resume?targetKey  { process?, memory?, time? }      Nextflow -resume in place
 *   POST data-pipelines/runs/{id}/cancel?targetKey
 *   POST data-pipelines/runs/{id}/data?targetKey    { outputId }  a table output into Data, pinned to the run
 *   GET  data-pipelines/runs/{id}/file?targetKey&artifact&preview=1              an output file (MultiQC opens in a tab)
 *   POST data-pipelines/from-step       { targetKey, stepId, output }  a step's latest output saved into Data as a file
 */
import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decideServerCapability } from '@/lib/authorization/api';
import { requireTargetAccess } from '@/lib/explore/authorization';
import { resolveContainedPath } from '@/lib/explore/storage';
import { createPipelineRunForOperator, startPipelineRunForOperator } from '@/lib/pipelines/pipeline-run-service';
import { cancelPipelineRunForOperator } from '@/lib/pipelines/pipeline-run-ops-service';
import { ensureDataStudy } from '@/lib/pipelines/data-study';
import { getDataRun, listDataRuns, pipelineReadiness, runBelongsTo, runOutputToData } from '@/lib/pipelines/pipeline-data-service';
import { resumePipelineRun } from '@/lib/pipelines/run-resume';
import { slurmRefusal } from '@/lib/pipelines/plain-status';
import { storeLibraryFile } from '@/lib/files/library';
import type { IntegrationSession } from './identity';

export const DATA_PIPELINE_CAPABILITIES = ['pipelines.readiness', 'pipelines.data-runs', 'runs.plain-status', 'runs.resume'];

const CONTENT_TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.tsv': 'text/tab-separated-values; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.zip': 'application/zip' };

class RouteError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function handleDataPipelinesRequest(request: Request, session: IntegrationSession, segments: string[], headers: Headers): Promise<Response> {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
  const url = new URL(request.url);
  const method = request.method;
  try {
    const read = async (key: string | null) => {
      if (!key || !/^project:[A-Za-z0-9_-]{1,128}$/.test(key)) throw new RouteError(400, 'Choose an Analysis study.');
      await requireTargetAccess(session, key, 'read');
      return key;
    };
    const write = async (key: string | null) => {
      const targetKey = await read(key);
      await requireTargetAccess(session, targetKey, 'write');
      const run = decideServerCapability(session, 'analysis.run');
      if (!run.allowed) throw new RouteError(403, 'Your SeqDesk account may not run pipelines.');
      return targetKey;
    };
    const body = async () => { const text = await request.text(); if (text.length > 65536) throw new RouteError(413, 'Too large.'); try { return text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { throw new RouteError(400, 'Invalid JSON.'); } };
    const ownRun = async (runId: string, targetKey: string) => { if (!(await runBelongsTo(runId, targetKey))) throw new RouteError(404, 'Run not found in this study.'); };
    const [, sub, runId, action] = segments; // data-pipelines/<sub>/<id>/<action>

    if (!sub && method === 'GET') return json(await pipelineReadiness(await read(url.searchParams.get('targetKey'))));
    if (sub === 'runs' && !runId && method === 'GET') {
      const targetKey = await read(url.searchParams.get('targetKey'));
      return json({ runs: await listDataRuns(targetKey) });
    }
    if (sub === 'runs' && !runId && method === 'POST') {
      const input = await body();
      const targetKey = await write(typeof input.targetKey === 'string' ? input.targetKey : null);
      const pipelineId = typeof input.pipelineId === 'string' ? input.pipelineId : '';
      const samples = Array.isArray(input.samples) ? input.samples.filter((s): s is string => typeof s === 'string').slice(0, 2000) : undefined;
      const { studyId, sampleIds } = await ensureDataStudy({ targetKey, userId: session.user.id, onlySamples: samples });
      if (!sampleIds.length && pipelineId !== 'multiqc') throw new RouteError(409, 'There are no FASTQ reads in this study’s Data yet.');
      const decision = decideServerCapability(session, 'analysis.run');
      const scope = decision.grant?.scope ?? 'own';
      const created = await createPipelineRunForOperator({ body: { pipelineId, studyId, ...(input.config && typeof input.config === 'object' ? { config: input.config } : {}) },
        userId: session.user.id, accessScope: scope, canManageConfig: false });
      const runIdCreated = (created.body as { run?: { id?: string }; runId?: string; id?: string }).run?.id ?? (created.body as { runId?: string }).runId ?? (created.body as { id?: string }).id;
      if (created.status >= 300 || !runIdCreated) return json(created.body, created.status >= 300 ? created.status : 500);
      const started = await startPipelineRunForOperator({ runId: runIdCreated, body: {}, userId: session.user.id, accessScope: scope });
      if (started.status >= 300) {
        // sbatch refusing the job is not a server failure: say why, as the card does (422 so the web app shows it).
        const askedSlurm = async () => {
          const row = await db.pipelineRun.findUnique({ where: { id: runIdCreated }, select: { executionProfile: true } });
          try { const p = JSON.parse(row?.executionProfile ?? '{}')?.slurm ?? {}; return { queue: p.queue ?? null, memory: p.memory ?? null, cores: p.cores ?? null }; } catch { return {}; }
        };
        const refusal = started.status >= 500 ? slurmRefusal(String((started.body as { error?: unknown }).error ?? ''), await askedSlurm()) : null;
        if (refusal) return json({ ...started.body, error: `SLURM did not take the job: ${refusal.words}. The run is kept as failed${refusal.retry ? '; Retry once that is fixed' : ''}.`, runId: runIdCreated }, 422);
        return json({ ...started.body, runId: runIdCreated }, started.status);
      }
      return json({ run: await getDataRun(runIdCreated, targetKey) }, 201);
    }
    if (sub === 'runs' && runId && !action && method === 'GET') {
      const targetKey = await read(url.searchParams.get('targetKey'));
      await ownRun(runId, targetKey);
      return json({ run: await getDataRun(runId, targetKey) });
    }
    if (sub === 'runs' && runId && action === 'resume' && method === 'POST') {
      const targetKey = await write(url.searchParams.get('targetKey'));
      await ownRun(runId, targetKey);
      const input = await body();
      // Fixed in Data: the study's reads are mirrored again before Nextflow resumes (a replaced file reruns its tasks).
      await ensureDataStudy({ targetKey, userId: session.user.id });
      const result = await resumePipelineRun(runId, { process: typeof input.process === 'string' ? input.process : null, memory: typeof input.memory === 'string' ? input.memory : null, time: typeof input.time === 'string' ? input.time : null });
      if (result.status >= 300) return json(result.body, result.status);
      return json({ ...result.body, run: await getDataRun(runId, targetKey) });
    }
    if (sub === 'runs' && runId && action === 'cancel' && method === 'POST') {
      const targetKey = await write(url.searchParams.get('targetKey'));
      await ownRun(runId, targetKey);
      const result = await cancelPipelineRunForOperator(runId);
      return json(result.body, result.status);
    }
    if (sub === 'runs' && runId && action === 'data' && method === 'POST') {
      const targetKey = await write(url.searchParams.get('targetKey'));
      await ownRun(runId, targetKey);
      const input = await body();
      if (typeof input.outputId !== 'string' || !input.outputId) throw new RouteError(400, 'Choose an output.');
      return json(await runOutputToData({ runId, outputId: input.outputId, targetKey, userId: session.user.id }), 201);
    }
    if (sub === 'from-step' && method === 'POST') {
      const input = await body();
      const targetKey = await write(typeof input.targetKey === 'string' ? input.targetKey : null);
      const stepId = typeof input.stepId === 'string' ? input.stepId : '';
      const output = typeof input.output === 'string' ? input.output : '';
      const analysis = await db.exploreAnalysis.findFirst({ where: { id: stepId, targetKey }, select: { id: true, name: true } });
      if (!analysis) throw new RouteError(404, 'Step not found in this study.');
      const artifact = await db.exploreArtifact.findFirst({ where: { run: { analysisId: analysis.id, status: 'completed' }, OR: [{ name: output }, { path: { endsWith: `/${output}` } }, { path: output }] },
        orderBy: { createdAt: 'desc' }, select: { name: true, path: true, run: { select: { runFolder: true, runNumber: true } } } });
      if (!artifact?.run.runFolder) throw new RouteError(404, `${output} has not been made yet; run the step first.`);
      const file = await resolveContainedPath(artifact.run.runFolder, artifact.path).catch(() => { throw new RouteError(404, 'The output file is gone.'); });
      const bytes = await fs.readFile(file);
      const stored = await storeLibraryFile({ targetKey, file: new File([bytes], path.basename(artifact.path)), createdById: session.user.id });
      await db.managedFile.update({ where: { id: stored.id }, data: { description: `From step ${analysis.name}, run ${artifact.run.runNumber}`.slice(0, 1000) } });
      return json({ file: { id: stored.id, name: stored.originalName, sizeBytes: Number(stored.sizeBytes) } }, 201);
    }
    if (sub === 'runs' && runId && action === 'file' && method === 'GET') {
      const targetKey = await read(url.searchParams.get('targetKey'));
      await ownRun(runId, targetKey);
      const artifact = await db.pipelineArtifact.findFirst({ where: { id: url.searchParams.get('artifact') ?? '', pipelineRunId: runId }, select: { path: true, name: true, pipelineRun: { select: { runFolder: true } } } });
      if (!artifact?.pipelineRun?.runFolder) throw new RouteError(404, 'File not found.');
      const file = await resolveContainedPath(artifact.pipelineRun.runFolder, artifact.path).catch(() => { throw new RouteError(404, 'File not found.'); });
      const bytes = await fs.readFile(file).catch(() => { throw new RouteError(404, 'The file is gone from the run folder.'); });
      const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      const out = new Headers(headers);
      out.set('Content-Type', type);
      out.set('X-Content-Type-Options', 'nosniff');
      // A report opens in a tab but runs no script with this origin's rights.
      if (type.startsWith('text/html')) out.set('Content-Security-Policy', "sandbox allow-scripts allow-popups; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:");
      out.set('Content-Disposition', `${url.searchParams.get('preview') === '1' ? 'inline' : 'attachment'}; filename="${(artifact.name ?? path.basename(file)).replace(/["\\\r\n]/g, '_')}"`);
      return new Response(new Uint8Array(bytes), { status: 200, headers: out });
    }
    return json({ error: 'Unknown pipelines operation.' }, 404);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (error instanceof RouteError || (typeof status === 'number' && status >= 400 && status < 500)) return json({ error: (error as Error).message }, status ?? 400);
    console.error('[Analysis pipelines] Request failed', error);
    return json({ error: (error as Error).message || 'The pipelines service failed.' }, 500);
  }
}
