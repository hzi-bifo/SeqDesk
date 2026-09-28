import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sampleFindMany: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { sample: { findMany: mocks.sampleFindMany } } }));

import { linkedReadRecords, readsAndRecordsWords } from './data-study';
import { withTargetStudy } from '../workbench/import-jobs';

describe('imported read records in an Analysis study', () => {
  beforeEach(() => vi.clearAllMocks());
  it('are the samples linked to its data study with an active read that is not a mirrored Data file', async () => {
    mocks.sampleFindMany.mockResolvedValue([
      { id: 's-sra', sampleId: 'SAMN12613329', sampleTitle: 'x', reads: [{ id: 'r1', file1: '/imports/SRR10008722_1.fastq.gz', file2: '/imports/SRR10008722_2.fastq.gz' }] },
      { id: 's-empty', sampleId: 'S2', sampleTitle: 'y', reads: [] },
    ]);
    expect(await linkedReadRecords('study-1')).toEqual([{ sampleId: 's-sra', label: 'SAMN12613329', paired: true, readId: 'r1' }]);
    const where = mocks.sampleFindMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ studyId: 'study-1' }, { studyMemberships: { some: { studyId: 'study-1' } } }]);
    expect(mocks.sampleFindMany.mock.calls[0][0].select.reads.where).toEqual({ isActive: true, NOT: { dataClassSource: 'analysis_data' } });
  });
  it('are counted in the drawer beside the Data files', () => {
    const pair = { sampleId: 'a', r1: { id: '1', name: 'a_1.fastq.gz', sizeBytes: 1 }, r2: { id: '2', name: 'a_2.fastq.gz', sizeBytes: 1 } };
    expect(readsAndRecordsWords([pair], [{ paired: true }, { paired: false }])).toBe('1 FASTQ pair + 2 imported read records');
    expect(readsAndRecordsWords([], [{ paired: true }])).toBe('1 imported read record');
    expect(readsAndRecordsWords([], [])).toBe('no FASTQ files');
  });
  it('an import that targets a study puts every read record of it there', () => {
    const result = { scientificImports: [{ studyKey: 'PRJNA1', targetStudyId: undefined }, { studyKey: 'PRJNA2', targetStudyId: 'kept' }] } as never;
    const joined = withTargetStudy(result, JSON.stringify({ accessions: ['SRR10008722'], targetStudyId: 'data-study-1' })) as { scientificImports: { targetStudyId?: string }[] };
    expect(joined.scientificImports.map((s) => s.targetStudyId)).toEqual(['data-study-1', 'kept']);
    expect(withTargetStudy(result, JSON.stringify({ accessions: [] }))).toBe(result);
  });
});
