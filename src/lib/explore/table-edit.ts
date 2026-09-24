import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { fetchAllDatasetRows, writeDatasetVersion } from './datasets';
import { applyEditsToRows, listActiveEdits } from './edits';
import { parseRoles, parseSchema } from './schema';
import { ExploreRouteError } from './route-error';
import type { ExploreCell, ExploreSchema } from './types';

export function applyTableChanges(rows: Record<string, ExploreCell>[], schema: ExploreSchema, changes: unknown) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 2000) throw new ExploreRouteError(400, 'Provide between 1 and 2000 cell changes');
  const next = rows.map(row => ({ ...row }));
  const seen = new Set<string>();
  for (const change of changes) {
    if (!change || !Number.isInteger(change.row) || change.row < 0 || change.row >= rows.length || typeof change.column !== 'string') throw new ExploreRouteError(400, 'Invalid cell address');
    const column = schema.columns.find(column => column.key === change.column);
    if (!column || column.key.endsWith('_db_id') || column.type === 'json') throw new ExploreRouteError(400, 'This column cannot be edited');
    const key = JSON.stringify([change.row, change.column]);
    if (seen.has(key)) throw new ExploreRouteError(400, 'Duplicate cell change');
    seen.add(key);
    const value = change.value;
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new ExploreRouteError(400, 'Invalid cell value');
    if (typeof value === 'string' && value.length > 20000) throw new ExploreRouteError(400, 'Cell text is too long');
    if (value === null) {
      if (column.nullable === false) throw new ExploreRouteError(400, `${column.label} cannot be empty`);
    } else if (column.type === 'number') {
      if (!['string', 'number'].includes(typeof value) || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(value)) || !Number.isFinite(Number(value))) throw new ExploreRouteError(400, `${column.label} needs a finite number`);
    } else if (column.type === 'boolean' && typeof value !== 'boolean') throw new ExploreRouteError(400, `${column.label} needs true or false`);
    else if (column.type === 'date' && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) throw new ExploreRouteError(400, `${column.label} needs a date`);
    else if (column.type === 'string' && typeof value !== 'string') throw new ExploreRouteError(400, `${column.label} needs text`);
    next[change.row][change.column] = value;
  }
  return next;
}

/** The original upload and older versions are retained. Copies keep source provenance. */
export async function editTable(datasetId: string, userId: string, body: Record<string, unknown>, copy = false) {
  if (typeof body.expectedVersionId !== 'string') throw new ExploreRouteError(400, 'The source version is required');
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "ExploreDataset" WHERE id = ${datasetId} FOR UPDATE`;
    const dataset = await tx.exploreDataset.findUnique({ where: { id: datasetId } });
    if (!dataset || !dataset.currentVersionId) throw new ExploreRouteError(404, 'Table not found');
    if (dataset.currentVersionId !== body.expectedVersionId) throw new ExploreRouteError(409, 'The table changed. Reload before editing it.');
    const version = await tx.exploreDatasetVersion.findUniqueOrThrow({ where: { id: dataset.currentVersionId } });
    const edits = await listActiveEdits(dataset.id);
    if (!copy && (dataset.kind !== 'external' || edits.length)) throw new ExploreRouteError(409, 'Create an editable copy of this table first.');
    const schema = parseSchema(version.schema);
    const sourceRows = await fetchAllDatasetRows(version.id);
    const rows = applyEditsToRows(sourceRows, edits).map(row => row.data);
    const next = copy ? rows : applyTableChanges(rows, schema, body.changes);
    const roles = parseRoles(dataset.roles);
    const target = copy ? await tx.exploreDataset.create({ data: {
      targetKey: dataset.targetKey, kind: 'external', name: `${dataset.name.slice(0, 180)} (editable copy)`,
      tableKind: dataset.tableKind, description: `Editable copy of ${dataset.name}, version ${version.number}`,
      roles: dataset.roles, sensitivity: dataset.sensitivity, createdById: userId,
      sourceConfig: JSON.stringify({ copiedFrom: dataset.id, versionId: version.id }),
    } }) : dataset;
    const result = await writeDatasetVersion({ datasetId: target.id, schema, rows: next,
      provenance: { builtAt: new Date().toISOString(), builder: copy ? 'table-copy@1' : 'table-edit@1',
        sources: [{ type: 'dataset-version', id: version.id, checksum: version.contentHash, label: dataset.name }],
        notes: [copy ? 'Editable copy; original results retained.' : `${(body.changes as unknown[]).length} cell corrections; original upload retained.`] },
      buildSource: 'manual', createdById: userId, storageSuffix: randomUUID(),
      keys: { sample: roles.sample, subject: roles.subject, key: roles.taxon_id ?? roles.taxon },
    }, tx);
    return { datasetId: target.id, version: result };
  }, { timeout: 60000 });
}
