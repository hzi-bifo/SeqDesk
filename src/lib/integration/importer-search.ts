/**
 * Connector search for the public-record importers (Zenodo, UniProt, PDB). Queries are built only
 * from `searchWords(q)` (letters, digits, inner hyphens), so user text never reaches the sources'
 * query languages as operators, fields or wildcards. A Zenodo link or DOI is looked up directly:
 * only its numeric record id is used.
 */
import { fetchSourceJson, isRecord, num, text } from '@/lib/workbench/importers/public-record-download';
import { fetchZenodoRecord, parseZenodoRecordRef, zenodoDetail } from '@/lib/workbench/importers/zenodo-record';
import { mapUniprotEntry } from '@/lib/workbench/importers/uniprot-entry';
import { mapPdbEntry, PDB_ID } from '@/lib/workbench/importers/pdb-entry';

export type SearchHit = { id: string; title: string; detail: string; value: string };
export type SearchGroup = { kind: string; connector: string; source: string; total: number | null; hits: SearchHit[]; error?: string };

const TIMEOUT = 12_000;
const ROWS = 5;

function zenodoHit(record: unknown): SearchHit | null {
  if (!isRecord(record)) return null;
  const id = String(num(record.id) ?? '');
  if (!/^\d{1,12}$/.test(id)) return null;
  const metadata = isRecord(record.metadata) ? record.metadata : {};
  return { id, value: id, title: text(metadata.title) ?? `Zenodo record ${id}`, detail: ['Zenodo', zenodoDetail(record)].filter(Boolean).join(' · ') };
}

export async function searchZenodo(q: string, words: string[]): Promise<SearchGroup> {
  const group: SearchGroup = { kind: 'doi', connector: 'zenodo-record', source: 'Zenodo', total: null, hits: [] };
  const trimmed = q.trim();
  const direct = /^\d{5,12}$/.test(trimmed) || /zenodo/i.test(trimmed) ? parseZenodoRecordRef(trimmed) : null;
  if (direct) {
    try {
      const hit = zenodoHit(await fetchZenodoRecord(direct, TIMEOUT));
      if (hit) return { ...group, total: 1, hits: [hit] };
    } catch (error) {
      // A link or DOI that names no record falls back to a word search; other failures are reported.
      if (!(error instanceof Error && /has no record/.test(error.message))) throw error;
    }
  }
  if (!words.length) return { ...group, total: 0 };
  const found = await fetchSourceJson(`https://zenodo.org/api/records?${new URLSearchParams({ q: words.join(' '), size: String(ROWS), sort: 'bestmatch' })}`, { source: 'Zenodo', timeoutMs: TIMEOUT });
  const hits = isRecord(found?.body) && isRecord(found.body.hits) ? found.body.hits : {};
  const list = Array.isArray(hits.hits) ? hits.hits : [];
  group.hits = list.map(zenodoHit).filter((hit): hit is SearchHit => Boolean(hit)).slice(0, ROWS);
  group.total = num(hits.total) ?? (isRecord(hits.total) ? num(hits.total.value) ?? null : null) ?? group.hits.length;
  return group;
}

export async function searchUniprot(words: string[]): Promise<SearchGroup> {
  const group: SearchGroup = { kind: 'proteins', connector: 'uniprot-entry', source: 'UniProt', total: null, hits: [] };
  const params = new URLSearchParams({ query: words.join(' AND '), size: String(ROWS), fields: 'accession,protein_name,gene_names,organism_name,length,reviewed' });
  const found = await fetchSourceJson(`https://rest.uniprot.org/uniprotkb/search?${params}`, { source: 'UniProt', timeoutMs: TIMEOUT });
  const results = isRecord(found?.body) && Array.isArray(found.body.results) ? found.body.results : [];
  group.hits = results.flatMap(result => {
    try {
      const entry = mapUniprotEntry(isRecord(result) ? text(result.primaryAccession) ?? '' : '', result);
      return [{ id: entry.accession, value: entry.accession, title: entry.record.title, detail: ['UniProt', entry.accession, entry.record.detail].filter(Boolean).join(' · ') }];
    } catch {
      return [];
    }
  }).slice(0, ROWS);
  const total = Number(found?.headers.get('x-total-results'));
  group.total = Number.isSafeInteger(total) && total >= 0 ? total : group.hits.length;
  return group;
}

const PDB_TITLES = 'query($ids:[String!]!){entries(entry_ids:$ids){rcsb_id struct{title} exptl{method} rcsb_entry_info{resolution_combined} rcsb_accession_info{initial_release_date}}}';

export async function searchPdb(words: string[]): Promise<SearchGroup> {
  const group: SearchGroup = { kind: 'structures', connector: 'pdb-entry', source: 'RCSB PDB', total: null, hits: [] };
  const search = await fetchSourceJson('https://search.rcsb.org/rcsbsearch/v2/query', {
    source: 'RCSB PDB', timeoutMs: TIMEOUT,
    init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      query: { type: 'terminal', service: 'full_text', parameters: { value: words.join(' ') } },
      return_type: 'entry',
      request_options: { paginate: { start: 0, rows: ROWS }, results_content_type: ['experimental'], sort: [{ sort_by: 'score', direction: 'desc' }] },
    }) },
  });
  // RCSB answers 204 when nothing matches.
  if (!search) return { ...group, total: 0 };
  const body = isRecord(search.body) ? search.body : {};
  const ids = (Array.isArray(body.result_set) ? body.result_set : [])
    .map(row => isRecord(row) ? text(row.identifier)?.toUpperCase() : undefined)
    .filter((id): id is string => Boolean(id && PDB_ID.test(id))).slice(0, ROWS);
  group.total = num(body.total_count) ?? ids.length;
  if (!ids.length) return group;
  const details = new Map<string, SearchHit>();
  try {
    const titles = await fetchSourceJson('https://data.rcsb.org/graphql', {
      source: 'RCSB PDB', timeoutMs: TIMEOUT,
      init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: PDB_TITLES, variables: { ids } }) },
    });
    const entries = isRecord(titles?.body) && isRecord(titles.body.data) && Array.isArray(titles.body.data.entries) ? titles.body.data.entries : [];
    for (const entry of entries) {
      const id = isRecord(entry) ? text(entry.rcsb_id)?.toUpperCase() : undefined;
      if (!id || !ids.includes(id)) continue;
      const record = mapPdbEntry(id, entry);
      details.set(id, { id, value: id, title: record.title, detail: ['PDB', id, record.detail].filter(Boolean).join(' · ') });
    }
  } catch {
    // Titles are a courtesy; the ids alone are still importable.
  }
  group.hits = ids.map(id => details.get(id) ?? { id, value: id, title: id, detail: `PDB · ${id}` });
  return group;
}
