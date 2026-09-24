import { describe, it, expect } from 'vitest';
import { applyTableChanges } from './table-edit';
import type { ExploreSchema } from './types';
const schema: ExploreSchema = { columns: [{ key: 'id', label: 'ID', type: 'string' }, { key: 'value', label: 'Value', type: 'number' }] };
describe('table corrections', () => {
  it('changes the addressed row without truncating unseen rows or mutating inputs', () => {
    const rows = Array.from({ length: 2100 }, (_, i) => ({ id: `S${i}`, value: String(i) }));
    const next = applyTableChanges(rows, schema, [{ row: 501, column: 'value', value: '0.5459999999999999' }]);
    expect(next).toHaveLength(2100);
    expect(next[501].value).toBe('0.5459999999999999');
    expect(rows[501].value).toBe('501');
    expect(next[2099]).toEqual(rows[2099]);
  });
  it('rejects invalid coordinates, values and repeated edits', () => {
    const rows = [{ id: 'S1', value: '1' }];
    for (const change of [{ row: -1, column: 'value', value: '1' }, { row: 1, column: 'value', value: '1' }, { row: 0, column: 'missing', value: '1' }, { row: 0, column: 'value', value: 'NaN' }, { row: 0, column: 'value', value: {} }]) expect(() => applyTableChanges(rows, schema, [change])).toThrow();
    const edit = { row: 0, column: 'value', value: '2' };
    expect(() => applyTableChanges(rows, schema, [edit, edit])).toThrow('Duplicate');
  });
});
