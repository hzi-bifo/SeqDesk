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
 *   GET  data-pipelines/runs/{id}/file?targetKey&artifact&preview=1              an output file
 *   POST data-pipelines/runs/{id}/file-link?targetKey&artifact                   a 5-minute link to one output file (MultiQC opens in a tab)
 *   GET  data-pipelines/admin                          pipelines on this server and whether it can run them (admin)
 *   POST data-pipelines/admin/pipelines/{id}  { enabled }   turn a pipeline on or off (admin)
 *   POST data-pipelines/admin/test                     a tiny job through the executor (admin)
 *   GET  data-pipelines/reads?targetKey                 imported read records this study uses in place
 *   POST data-pipelines/reads/link   { targetKey, accessions }   link read records already in SeqDesk, by sample
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
import { dataStudyFor, ensureDataStudy, readsChangedSinceRun, findDataStudy, linkedReadRecords, readsInData, readsSnapshot } from '@/lib/pipelines/data-study';
import { sequencingEntryScope } from '@/lib/sequencing/entry-access';
import { analysisPipelineDefinitions, getDataRun, listDataRuns, pipelineReadiness, runBelongsTo, runOutputToData } from '@/lib/pipelines/pipeline-data-service';
import { resumePipelineRun } from '@/lib/pipelines/run-resume';
import { prepareFailureWords, slurmRefusal } from '@/lib/pipelines/plain-status';
import { PIPELINE_FILE_LINK_TTL_MS, pipelineFileToken } from '@/lib/pipelines/pipeline-file-link';
import { integrationConfig } from '@/lib/integration/config';
import { getPipelineEnabled, parsePipelineAllowlist, resolvePipelineEnabled } from '@/lib/pipelines/enablement';
import { getBlockingReadinessDetails } from '@/lib/pipelines/pipeline-readiness-service';
import { listInstalledManagedPipelineStatuses, updateManagedPipeline } from '@/lib/pipelines/pipeline-management-service';
import { checkServerReadiness, testServer } from '@/lib/pipelines/pipeline-admin';
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
    // SeqDesk's own rule for a pipeline run: the study's owner (or an installation-wide grant) starts it, and the same
    // person cancels or resumes it. Before, another member could cancel a colleague's run but not start one.
    const scope = () => decideServerCapability(session, 'analysis.run').grant?.scope ?? 'own';
    const viewer = () => ({ id: session.user.id, installation: scope() === 'installation' });
    const ownerName = async (userId: string | null | undefined) => {
      const user = userId ? await db.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, email: true } }) : null;
      return user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email : 'its owner';
    };
    const mayManageRun = async (runId: string, verb: string) => {
      if (scope() === 'installation') return;
      const run = await db.pipelineRun.findUnique({ where: { id: runId }, select: { userId: true, study: { select: { userId: true } } } });
      const owner = run?.study?.userId ?? run?.userId;
      if (owner && owner !== session.user.id) throw new RouteError(409, `Only ${await ownerName(owner)} or a SeqDesk admin can ${verb} this run.`);
    };
    const [, sub, runId, action] = segments; // data-pipelines/<sub>/<id>/<action>

    if (!sub && method === 'GET') {
      const readinessKey = await read(url.searchParams.get('targetKey'));
      const readiness = await pipelineReadiness(readinessKey);
      // Say up front what a Start would answer: only the study's owner or an installation-wide grant starts pipelines.
      if (scope() !== 'installation') {
        const data = await findDataStudy(readinessKey);
        const owner = data ? (await db.study.findUnique({ where: { id: data.id }, select: { userId: true } }))?.userId : null;
        if (owner && owner !== session.user.id) return json({ ...readiness, canStart: false, startNote: `Only ${await ownerName(owner)} or a SeqDesk admin can start pipelines on this study’s Data.` });
      }
      return json(readiness);
    }
    if (sub === 'reads' && !runId && method === 'GET') {
      // The imported read records this study uses in place (ENA, SRA), beside the FASTQ files in its Data.
      const targetKey = await read(url.searchParams.get('targetKey'));
      const study = await findDataStudy(targetKey);
      return json({ records: study ? await linkedReadRecords(study.id) : [] });
    }
    if (sub === 'reads' && runId === 'link' && method === 'POST') {
      // Link read records that are already in SeqDesk to this study by sample (a run or sample accession, or a
      // SeqDesk sample id). Nothing is copied; the records keep their owner and their own study.
      const input = await body();
      const targetKey = await write(typeof input.targetKey === 'string' ? input.targetKey : null);
      const keys = (Array.isArray(input.accessions) ? input.accessions : []).filter((v): v is string => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(v)).slice(0, 200);
      if (!keys.length) throw new RouteError(400, 'Name the runs or samples to link (for example SRR10008722 or SAMN12613329).');
      const scope = decideServerCapability(session, 'analysis.run').grant?.scope === 'installation';
      const samples = await db.sample.findMany({
        where: { AND: [sequencingEntryScope(session.user.id, scope), { OR: [{ id: { in: keys } }, { sampleAccessionNumber: { in: keys } }, { sampleId: { in: keys } }, { reads: { some: { runAccessionNumber: { in: keys } } } }] }] },
        select: { id: true, sampleId: true, reads: { where: { NOT: { file1: null } }, select: { id: true, file1: true }, take: 1 } },
      });
      // Imported records are stored inactive; any read with a file counts, and ensureDataStudy picks it at start.
      const usable = samples.filter((s) => s.reads[0]?.file1);
      if (!usable.length) throw new RouteError(404, `No read records you can use were found for ${keys.join(', ')}.`);
      const study = await dataStudyFor(targetKey, session.user.id);
      for (const sample of usable) {
        await db.studySample.upsert({ where: { studyId_sampleId: { studyId: study.id, sampleId: sample.id } }, update: {}, create: { studyId: study.id, sampleId: sample.id } });
      }
      return json({ linked: usable.map((s) => s.sampleId), records: await linkedReadRecords(study.id) }, 201);
    }
    if (sub === 'admin') {
      // The Compute server's admin (a SeqDesk facility admin) turns pipelines on and checks the server from the web app.
      if ((session.user as { role?: string }).role !== 'FACILITY_ADMIN') throw new RouteError(403, 'Only this Compute server’s admin can change its pipelines.');
      if (!runId && method === 'GET') {
        // Only pipelines that can serve an Analysis study; order-only ones (checksums, ENA submission) stay in SeqDesk's own admin.
        const defs = analysisPipelineDefinitions();
        const [statuses, rows, settings] = await Promise.all([
          listInstalledManagedPipelineStatuses({ pipelineIds: defs.map((d) => d.id) }).catch(() => []),
          db.pipelineConfig.findMany({ where: { pipelineId: { in: defs.map((d) => d.id) } }, select: { pipelineId: true, enabled: true } }),
          db.siteSettings.findUnique({ where: { id: 'singleton' }, select: { extraSettings: true } }),
        ]);
        const allowlist = parsePipelineAllowlist(settings?.extraSettings);
        const pipelines = await Promise.all(defs.map(async (d) => {
          const status = statuses.find((st) => st.pipelineId === d.id || st.id === d.id);
          const readiness = status?.readiness ?? null;
          const row = rows.find((r) => r.pipelineId === d.id);
          return { id: d.id, name: d.name, version: d.version ?? null, description: d.description, enabled: await getPipelineEnabled(d.id),
            // Whether it could be switched on now, and what is missing (MAG without its GTDB-Tk database).
            ready: readiness ? readiness.canEnable : true, blocking: readiness ? getBlockingReadinessDetails(readiness).slice(0, 3) : [],
            // The server's default when no one has chosen, and whether someone has.
            defaultEnabled: resolvePipelineEnabled(d.id, null, allowlist), chosen: !!row };
        }));
        return json({ readiness: await checkServerReadiness(), pipelines: pipelines.sort((a, b) => a.name.localeCompare(b.name)) });
      }
      if (runId === 'pipelines' && action && method === 'POST') {
        const input = await body();
        if (typeof input.enabled !== 'boolean' && input.enabled !== 'default') throw new RouteError(400, 'Say whether the pipeline is on.');
        if (!analysisPipelineDefinitions().some((d) => d.id === action)) throw new RouteError(404, 'No such pipeline for Analysis on this server.');
        if (input.enabled === 'default') {
          // Back to the server's default is always possible: it is the state the pipeline had before anyone chose, so it
          // needs no readiness check (a pipeline that is on by default and not ready fails its runs with its own words).
          const settings = await db.siteSettings.findUnique({ where: { id: 'singleton' }, select: { extraSettings: true } });
          const enabled = resolvePipelineEnabled(action, null, parsePipelineAllowlist(settings?.extraSettings));
          await db.pipelineConfig.updateMany({ where: { pipelineId: action }, data: { enabled } });
          return json({ id: action, enabled: await getPipelineEnabled(action), default: true });
        }
        try {
          await updateManagedPipeline({ pipelineId: action, enabled: input.enabled });
        } catch (error) {
          // "Pipeline is not ready to enable" alone gives the admin nothing to do; its details say what is missing.
          const e = error as { status?: number; details?: string[]; message?: string };
          if (typeof e.status === 'number' && e.status >= 400 && e.status < 500) throw new RouteError(409, `${e.message ?? 'Could not change the pipeline'}${e.details?.length ? `: ${e.details.slice(0, 3).map((d) => d.replace(/\.$/, '')).join('; ')}` : ''}.`);
          throw error;
        }
        return json({ id: action, enabled: await getPipelineEnabled(action) });
      }
      if (runId === 'test' && !action && method === 'POST') return json(await testServer());
    }
    if (sub === 'runs' && !runId && method === 'GET') {
      const targetKey = await read(url.searchParams.get('targetKey'));
      return json({ runs: await listDataRuns(targetKey, viewer()) });
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
      if (created.status === 403 && (created.body as { error?: unknown }).error === 'Forbidden') {
        // The study's Data belongs to whoever set it up; say so instead of a bare 403 the web app reads as "not connected".
        const study = await db.study.findUnique({ where: { id: studyId }, select: { userId: true } });
        return json({ error: `Only ${await ownerName(study?.userId)} or a SeqDesk admin can start pipelines on this study’s Data.` }, 409);
      }
      if (created.status >= 300 || !runIdCreated) return json(created.body, created.status >= 300 ? created.status : 500);
      // Keep which reads the run starts from: a Resume after they changed in Data says so (it would use these).
      const { files: startFiles } = await readsInData(targetKey);
      await db.pipelineRunEvent.create({ data: { pipelineRunId: runIdCreated, eventType: 'inputs', source: 'launcher', message: `${startFiles.length} FASTQ file${startFiles.length === 1 ? '' : 's'}`, payload: JSON.stringify(readsSnapshot(startFiles)) } }).catch(() => undefined);
      const started = await startPipelineRunForOperator({ runId: runIdCreated, body: {}, userId: session.user.id, accessScope: scope });
      if (started.status >= 300) {
        // sbatch refusing the job is not a server failure: say why, as the card does (422 so the web app shows it).
        const askedSlurm = async () => {
          const row = await db.pipelineRun.findUnique({ where: { id: runIdCreated }, select: { executionProfile: true } });
          try { const p = JSON.parse(row?.executionProfile ?? '{}')?.slurm ?? {}; return { queue: p.queue ?? null, memory: p.memory ?? null, cores: p.cores ?? null }; } catch { return {}; }
        };
        const told = started.body as { error?: unknown; details?: unknown };
        const prepared = prepareFailureWords([told.error, ...(Array.isArray(told.details) ? told.details : [])].map((v) => String(v ?? '')).join('\n'));
        if (prepared) return json({ ...started.body, error: `${prepared}. The run is kept as failed; ask the admin.`, runId: runIdCreated }, 422);
        const refusal = started.status >= 500 ? slurmRefusal(String((started.body as { error?: unknown }).error ?? ''), await askedSlurm()) : null;
        if (refusal) return json({ ...started.body, error: `SLURM did not take the job: ${refusal.words}. The run is kept as failed${refusal.retry ? '; Retry once that is fixed' : ''}.`, runId: runIdCreated }, 422);
        return json({ ...started.body, runId: runIdCreated }, started.status);
      }
      return json({ run: await getDataRun(runIdCreated, targetKey) }, 201);
    }
    if (sub === 'runs' && runId && !action && method === 'GET') {
      const targetKey = await read(url.searchParams.get('targetKey'));
      await ownRun(runId, targetKey);
      return json({ run: await getDataRun(runId, targetKey, viewer()) });
    }
    if (sub === 'runs' && runId && action === 'resume' && method === 'POST') {
      const targetKey = await write(url.searchParams.get('targetKey'));
      await ownRun(runId, targetKey);
      const input = await body();
      await mayManageRun(runId, 'resume');
      // Resume uses the reads the run started with. If Data changed since, say so and point to Run again (force: true
      // resumes anyway, on the old reads).
      if (input.force !== true) {
        const changed = await readsChangedSinceRun(runId, targetKey);
        if (changed) return json({ error: `The reads in Data changed since this run (${changed}). Resume would use the reads it started with; Run again uses the new ones.`, code: 'reads_changed' }, 409);
      }
      // Fixed in Data: the study's reads are mirrored again before Nextflow resumes (a replaced file reruns its tasks).
      await ensureDataStudy({ targetKey, userId: session.user.id });
      const result = await resumePipelineRun(runId, { process: typeof input.process === 'string' ? input.process : null, memory: typeof input.memory === 'string' ? input.memory : null, time: typeof input.time === 'string' ? input.time : null });
      if (result.status >= 300) return json(result.body, result.status);
      return json({ ...result.body, run: await getDataRun(runId, targetKey) });
    }
    if (sub === 'runs' && runId && action === 'cancel' && method === 'POST') {
      const targetKey = await write(url.searchParams.get('targetKey'));
      await ownRun(runId, targetKey);
      // A second Cancel (a double click, a teammate a moment later) finds the run cancelled: that is what was asked.
      const current = await db.pipelineRun.findUnique({ where: { id: runId }, select: { status: true } });
      if (current?.status === 'cancelled') return json({ success: true, status: 'cancelled', already: true });
      await mayManageRun(runId, 'cancel');
      const result = await cancelPipelineRunForOperator(runId);
      if (result.status === 400 && (current?.status === 'completed' || current?.status === 'failed')) {
        return json({ error: current.status === 'completed' ? 'This run already finished; there is nothing to cancel.' : 'This run already stopped with an error; there is nothing to cancel.' }, 409);
      }
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
    if (sub === 'runs' && runId && action === 'file-link' && method === 'POST') {
      // A link a browser tab opens by itself: the report runs sandboxed on Compute's origin, not framed in the app.
      const targetKey = await read(url.searchParams.get('targetKey'));
      await ownRun(runId, targetKey);
      const artifactId = url.searchParams.get('artifact') ?? '';
      const artifact = await db.pipelineArtifact.findFirst({ where: { id: artifactId, pipelineRunId: runId, pipelineRun: { status: 'completed' } }, select: { id: true } });
      if (!artifact) throw new RouteError(404, 'File not found.');
      const config = integrationConfig();
      const base = process.env.NEXTAUTH_URL;
      if (!config || !base) throw new RouteError(409, 'This Compute server has no public address for reports (NEXTAUTH_URL).');
      const link = new URL(`/share/pipeline-files/${pipelineFileToken(config.secret, runId, artifact.id)}`, base);
      return json({ url: link.toString(), expiresInSeconds: PIPELINE_FILE_LINK_TTL_MS / 1000 });
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
