/**
 * Connectors for the collaboration web app (Continual Science, Data › Connectors): the Workbench importers
 * (CAMI benchmarks, ENA FASTQ by accession, NCBI genomes by taxon, Zenodo records, PDB structures,
 * AlphaFold models, UniProt entries) reached through the integration API.
 * Nothing here is new behaviour: preview, fingerprints, idempotency keys, jobs, storage waits and cancellation
 * are the Workbench's own, and the same capability check ("workbench.import") applies to the mapped account.
 *
 *   GET  importers                                     list with preflight
 *   GET  importers/search?q                            one search across the enabled connectors' sources
 *   POST importers/{providerId}/preview                 preview + fingerprint
 *   GET  importers/cami-benchmark/samples?collection&dataset&technology
 *   GET  importers/cami-benchmark/files?dataset&technology
 *   GET  imports[?collection]                          this account's jobs
 *   POST imports                                        start (Idempotency-Key header or body requestKey, previewFingerprint)
 *   POST imports/{jobId}/cancel
 *   GET  imports/{jobId}/files                         a finished import's verified files (and which can be tables)
 *   POST imports/{jobId}/tables                        { targetKey, storedFilename, name?, roles? } -> Analysis table with provenance
 */
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { db } from '@/lib/db';
import { getWorkbenchImporter, listWorkbenchImporters, serializeWorkbenchImporter } from '@/lib/workbench/importers/registry';
import { authorizeWorkbenchRequest } from '@/lib/workbench/server';
import { importPreviewFingerprint } from '@/lib/workbench/import-preview-fingerprint';
import { requireRawReadImporter } from '@/lib/modules/input-modules.server';
import { createWorkbenchImportJob, runWorkbenchImportJob } from '@/lib/workbench/import-jobs';
import { resolveWorkbenchStorageBase } from '@/lib/workbench/storage';
import { getOrCreateDefaultWorkbenchWorkspace, listWorkbenchImportJobs, serializeWorkbenchImportJob } from '@/lib/workbench/workspaces';
import { importCollectionSchema } from '@/lib/workbench/import-collection';
import { ImportSelectionConflict } from '@/lib/workbench/import-conflict';
import { scientificRecordId } from '@/lib/workbench/scientific-publication';
import { importFileAsTable, listImportFiles } from '@/lib/workbench/import-tables';
import { ExploreRouteError } from '@/lib/explore/route-error';
import { camiFilesQuerySchema, camiSampleQuerySchema } from '@/lib/workbench/cami-sample-types';
import { getCamiSampleStatuses } from '@/lib/workbench/cami-sample-status.server';
import { getCamiSampleFileInfo } from '@/lib/workbench/cami-file-info.server';
import type { IntegrationSession } from './identity';
import { searchPdb, searchUniprot, searchZenodo, type SearchGroup } from './importer-search';

export const IMPORTER_CAPABILITIES = ['imports.read', 'imports.create', 'imports.search'];

const SEARCH_TIMEOUT = 12_000;

/** Free-text words only: the archives' query languages must never see quotes, wildcards or operators from the user. */
export function searchWords(q: string): string[] {
  return q.toLowerCase().split(/[^\p{L}\p{N}-]+/u).map(w => w.replace(/^-+|-+$/g, '')).filter(w => w.length >= 2).slice(0, 5);
}

async function searchEna(words: string[]): Promise<SearchGroup> {
  const group: SearchGroup = { kind: 'reads', connector: 'ena-fastq-accession', source: 'ENA', total: null, hits: [] };
  const query = words.map(w => `study_title="*${w}*"`).join(' AND ');
  const base = 'https://www.ebi.ac.uk/ena/portal/api';
  const signal = AbortSignal.timeout(SEARCH_TIMEOUT);
  const [rows, count] = await Promise.all([
    fetch(`${base}/search?${new URLSearchParams({ result: 'study', query, fields: 'study_accession,secondary_study_accession,study_title,scientific_name,first_public', limit: '6', format: 'json' })}`, { signal }),
    fetch(`${base}/count?${new URLSearchParams({ result: 'study', query })}`, { signal }),
  ]);
  if (!rows.ok) throw new Error(`ENA search failed (HTTP ${rows.status})`);
  const text = await rows.text();
  const list = (text.trim() ? JSON.parse(text) : []) as Array<Record<string, string>>;
  const total = count.ok ? Number((await count.text()).trim().split(/\s+/).pop()) : NaN;
  group.total = Number.isFinite(total) ? total : list.length;
  group.hits = list.filter(r => r.study_accession).map(r => ({
    id: r.study_accession, value: r.study_accession, title: r.study_title || r.study_accession,
    detail: ['ENA', r.study_accession, r.secondary_study_accession, r.scientific_name, r.first_public?.slice(0, 4)].filter(Boolean).join(' · '),
  }));
  return group;
}

async function searchTaxa(words: string[]): Promise<SearchGroup> {
  const group: SearchGroup = { kind: 'genomes', connector: 'ncbi-genomes-taxon', source: 'NCBI Taxonomy', total: null, hits: [] };
  const response = await fetch(`https://api.ncbi.nlm.nih.gov/datasets/v2/taxonomy/taxon_suggest/${encodeURIComponent(words.join(' '))}?tax_rank_filter=higher_taxon`, { signal: AbortSignal.timeout(SEARCH_TIMEOUT) });
  if (!response.ok) throw new Error(`NCBI search failed (HTTP ${response.status})`);
  const value = await response.json() as { sci_name_and_ids?: Array<{ sci_name?: string; tax_id?: string; rank?: string; group_name?: string }> };
  const list = (value.sci_name_and_ids ?? []).filter(t => t.sci_name && t.tax_id);
  group.total = list.length;
  group.hits = list.slice(0, 6).map(t => ({ id: String(t.tax_id), value: String(t.sci_name), title: String(t.sci_name), detail: ['NCBI Taxonomy', t.tax_id, t.rank?.toLowerCase(), t.group_name].filter(Boolean).join(' · ') }));
  return group;
}

export async function handleImportersRequest(request: Request, session: IntegrationSession, path: string[], headers: Headers): Promise<Response> {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
  const access = authorizeWorkbenchRequest(session, 'workbench.import');
  if (!access.allowed) {
    const denied = await access.response.json().catch(() => ({ error: 'Forbidden' }));
    return json({ error: denied.error === 'Forbidden' ? 'Your SeqDesk account cannot import data.' : denied.error }, access.response.status);
  }
  const userId = access.userId;
  const method = request.method;
  const url = new URL(request.url);
  const enabled = async (providerId: string) => { try { await requireRawReadImporter(providerId); return true; } catch { return false; } };

  try {
    if (path[0] === 'importers' && path.length === 1 && method === 'GET') {
      const importers = await Promise.all(listWorkbenchImporters().map(async (provider) => {
        if (!(await enabled(provider.id))) return null;
        return serializeWorkbenchImporter(provider, await provider.preflight());
      }));
      return json({ importers: importers.filter(Boolean) });
    }
    if (path[0] === 'importers' && path[1] === 'search' && path.length === 2 && method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').slice(0, 500);
      const words = searchWords(q);
      if (!words.length) return json({ groups: [] });
      const searches: Array<{ connector: string; kind: string; source: string; run: () => Promise<SearchGroup> }> = [
        { connector: 'ena-fastq-accession', kind: 'reads', source: 'ENA', run: () => searchEna(words) },
        { connector: 'ncbi-genomes-taxon', kind: 'genomes', source: 'NCBI Taxonomy', run: () => searchTaxa(words) },
        { connector: 'zenodo-record', kind: 'doi', source: 'Zenodo', run: () => searchZenodo(q, words) },
        { connector: 'uniprot-entry', kind: 'proteins', source: 'UniProt', run: () => searchUniprot(words) },
        { connector: 'pdb-entry', kind: 'structures', source: 'RCSB PDB', run: () => searchPdb(words) },
      ];
      const groups = await Promise.all(searches.map(async ({ connector, kind, source, run }) => {
        if (!(await enabled(connector))) return null;
        try { return await run(); }
        catch (error) { return { kind, connector, source, total: null, hits: [], error: error instanceof Error && error.name !== 'TimeoutError' ? error.message : 'The source did not answer in time.' }; }
      }));
      return json({ groups: groups.filter(Boolean) });
    }
    if (path[0] === 'importers' && path[1] === 'cami-benchmark' && path.length === 3 && method === 'GET') {
      if (!(await enabled('cami-benchmark'))) return json({ error: 'The CAMI importer is turned off on this server.' }, 403);
      const params = Object.fromEntries(url.searchParams);
      if (path[2] === 'samples') {
        const query = camiSampleQuerySchema.safeParse(params);
        if (!query.success) return json({ error: 'Invalid CAMI collection or selection.' }, 400);
        return json({ samples: await getCamiSampleStatuses(userId, query.data) });
      }
      if (path[2] === 'files') {
        const query = camiFilesQuerySchema.safeParse(params);
        if (!query.success) return json({ error: 'Invalid CAMI dataset or technology.' }, 400);
        return json({ files: await getCamiSampleFileInfo(query.data) });
      }
    }
    if (path[0] === 'importers' && path.length === 3 && path[2] === 'preview' && method === 'POST') {
      const provider = getWorkbenchImporter(path[1]);
      if (!provider || !(await enabled(provider.id))) return json({ error: 'This connector is not available on this server.' }, 404);
      const preflight = await provider.preflight();
      if (!preflight.ok) return json({ error: preflight.message, details: preflight.details }, 400);
      const input = provider.inputSchema.parse(await request.json());
      const preview = await provider.preview(input);
      return json({ preview: { ...preview, fingerprint: importPreviewFingerprint(provider.id, input, preview) } });
    }
    if (path[0] === 'imports' && path.length === 1 && method === 'GET') {
      const collection = url.searchParams.get('collection') ?? undefined;
      if (collection && !/^[a-f0-9-]{36}$/i.test(collection)) return json({ error: 'Invalid collection.' }, 400);
      return json({ jobs: await (collection ? listWorkbenchImportJobs(userId, collection) : listWorkbenchImportJobs(userId)) });
    }
    if (path[0] === 'imports' && path.length === 1 && method === 'POST') {
      const body = await request.json();
      // The collaboration proxy forwards only a fixed set of headers, so the key may also come in the body.
      const idempotencyKey = request.headers.get('idempotency-key') ?? (typeof body?.requestKey === 'string' ? body.requestKey : null);
      if (idempotencyKey && !/^[a-zA-Z0-9_-]{16,128}$/.test(idempotencyKey)) return json({ error: 'Invalid import request key.' }, 400);
      const provider = getWorkbenchImporter(typeof body?.providerId === 'string' ? body.providerId : '');
      if (!provider || !(await enabled(provider.id))) return json({ error: 'This connector is not available on this server.' }, 404);
      const preflight = await provider.preflight();
      if (!preflight.ok) return json({ error: preflight.message, details: preflight.details }, 400);
      try { await resolveWorkbenchStorageBase(); }
      catch (error) { return json({ error: error instanceof Error ? error.message : 'Import storage is not configured on this server.' }, 400); }
      const input = provider.inputSchema.parse(body.input ?? {});
      const rawCollection = (input as { collection?: unknown }).collection;
      const collection = rawCollection === undefined ? null : importCollectionSchema.safeParse(rawCollection);
      if (collection && !collection.success) return json({ error: 'Name the destination before importing (1–500 characters).' }, 400);
      if (provider.id !== 'ncbi-genomes-taxon' && !collection) return json({ error: 'Name the destination before importing.' }, 400);
      const preview = await provider.preview(input);
      if (body.previewFingerprint !== importPreviewFingerprint(provider.id, input, preview)) {
        return json({ error: 'The selection changed or was not reviewed. Preview it again.' }, 409);
      }
      if (preview.summary.selectedCount === 0) return json({ error: 'The preview found nothing to import.' }, 400);
      const { job } = await createWorkbenchImportJob({ userId, providerId: provider.id, input, preview, ...(idempotencyKey ? { idempotencyKey } : {}) });
      void runWorkbenchImportJob(job.id).catch(() => { console.error('[integration] Immediate import dispatch failed; the worker retries queued work.'); });
      return json({ job, ...(collection?.success ? { collectionOrderId: scientificRecordId('data', userId, 'collection', collection.data.key) } : {}) }, 202);
    }
    if (path[0] === 'imports' && path.length === 3 && path[2] === 'cancel' && method === 'POST') {
      const workspace = await getOrCreateDefaultWorkbenchWorkspace(userId);
      const job = await db.workbenchImportJob.findFirst({ where: { id: path[1], workspaceId: workspace.id } });
      if (!job) return json({ error: 'Import not found.' }, 404);
      if (job.status !== 'queued' && job.status !== 'running') return json({ error: 'This import has already finished.' }, 409);
      const changed = await db.workbenchImportJob.updateMany({
        where: { id: job.id, workspaceId: workspace.id, status: job.status },
        data: job.status === 'running' ? { phase: 'cancelling' } : { status: 'cancelled', phase: 'cancelled', progress: 0, finishedAt: new Date() },
      });
      if (changed.count !== 1) return json({ error: 'The import changed; refresh and try again.' }, 409);
      const updated = await db.workbenchImportJob.findFirst({ where: { id: job.id, workspaceId: workspace.id } });
      return json({ job: updated ? serializeWorkbenchImportJob(updated) : null });
    }
    if (path[0] === 'imports' && path.length === 3 && path[2] === 'files' && method === 'GET') {
      return json(await listImportFiles(userId, path[1]));
    }
    if (path[0] === 'imports' && path.length === 3 && path[2] === 'tables' && method === 'POST') {
      const body = await request.json().catch(() => null) as Record<string, unknown> | null;
      const targetKey = typeof body?.targetKey === 'string' ? body.targetKey : '';
      const storedFilename = typeof body?.storedFilename === 'string' ? body.storedFilename : '';
      if (!targetKey || !storedFilename) return json({ error: 'Choose a study and a file.' }, 400);
      const roles = body?.roles && typeof body.roles === 'object' ? Object.fromEntries(Object.entries(body.roles as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string> : undefined;
      const result = await importFileAsTable(session as never, path[1], { targetKey, storedFilename, ...(typeof body?.name === 'string' && body.name.trim() ? { name: body.name.trim().slice(0, 200) } : {}), ...(roles ? { roles } : {}) });
      return json(result.body, result.status);
    }
    return json({ error: 'Unknown connector route.' }, 404);
  } catch (error) {
    if (error instanceof ImportSelectionConflict) return json({ error: error.message }, 409);
    if (error instanceof ExploreRouteError) return json({ error: error.message }, error.status);
    if (error instanceof ZodError) {
      const field = String(error.issues[0]?.path[0] ?? '');
      const words: Record<string, string> = {
        accession: 'Use a run (SRR…/ERR…), SRA sample (SRS…), study (SRP…) or project (PRJNA…/PRJEB…) accession.',
        taxon: 'Name a taxon (at least 2 characters) or give its NCBI taxon ID.',
        sample: 'That sample is not in this CAMI dataset.',
        record: 'Use a Zenodo record number, a zenodo.org/records/… link or a 10.5281/zenodo.… DOI.',
        ids: 'Use 1 to 20 four-character PDB IDs such as 1LM8.',
        accessions: 'Use UniProt accessions such as P69905 (up to 20 for AlphaFold, 50 for UniProt).',
        maxFiles: 'Choose between 1 and 100 files.',
      };
      return json({ error: words[field] ?? 'Invalid connector input.', issues: error.issues }, 400);
    }
    return json({ error: error instanceof Error ? error.message : 'The connector request failed.' }, 500);
  }
}
