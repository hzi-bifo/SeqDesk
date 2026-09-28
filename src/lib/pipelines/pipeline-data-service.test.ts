import { beforeEach, describe, expect, it, vi } from 'vitest';

// The band's run list (found on elektra: a study with 56 runs lost an active, long-queued run from the newest 50).
const mocks = vi.hoisted(() => ({
  db: {
    pipelineRun: { findMany: vi.fn() },
    exploreDataset: { findMany: vi.fn() },
    pipelineRunStep: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock('@/lib/db', () => ({ db: mocks.db }));
vi.mock('./data-study', () => ({ findDataStudy: vi.fn(async () => ({ id: 'study-1' })), readsInData: vi.fn(async () => ({ files: [], pairs: [], words: '' })), readsWords: vi.fn(), readsChangeWords: vi.fn(() => null) }));
vi.mock('./package-loader', () => ({ getPackage: () => null }));
vi.mock('./registry', () => ({ PIPELINE_REGISTRY: {} }));
vi.mock('./enablement', () => ({ getPipelineEnabled: vi.fn() }));
vi.mock('./execution-settings', () => ({ getExecutionSettings: vi.fn() }));
vi.mock('./database-downloads', () => ({ getPipelineDatabaseStatuses: vi.fn() }));
vi.mock('./pipeline-readiness-service', () => ({ parsePipelineConfig: vi.fn() }));
vi.mock('@/lib/explore/build', () => ({ runBuilder: vi.fn() }));
vi.mock('@/lib/explore/datasets', () => ({ createDataset: vi.fn(), writeDatasetVersion: vi.fn() }));
vi.mock('@/lib/explore/builders/pipeline-table', () => ({ resolveTableSpec: vi.fn() }));
vi.mock('@/lib/explore/pipeline-output-types', () => ({ outputFileView: vi.fn(() => ({ kind: 'file' })) }));
vi.mock('@/lib/pipelines/definitions', () => ({ getStepsForPipeline: () => [] }));

import fs from 'fs';
import os from 'os';
import path from 'path';
import { failedTaskError, listDataRuns } from './pipeline-data-service';

const row = (id: string, status = 'completed') => ({
  id, runNumber: id.toUpperCase(), pipelineId: 'fastqc', status, executionMode: 'slurm', executionProfile: null, queueJobId: null, queueStatus: null, queueReason: null,
  queueUpdatedAt: null, currentStep: null, queuedAt: null, startedAt: null, completedAt: null, createdAt: new Date('2026-09-28T10:00:00Z'), outputTail: null, errorTail: null,
  runFolder: null, inputSampleIds: null, config: null, studyId: 'study-1', userId: id.startsWith('old') ? 'sam' : 'lena', study: { userId: 'lena' }, user: null, artifacts: [], events: [],
});

describe('the study’s runs for the band', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps an active run and a pinned run that fell out of the newest 50', async () => {
    const newest = Array.from({ length: 50 }, (_, i) => row(`new-${i}`));
    mocks.db.pipelineRun.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.pipelineId) return []; // past durations for the estimate
      if (where.OR) return [{ id: 'old-queued' }, { id: 'new-3' }];
      if (where.id) return [row('old-queued', 'queued'), row('old-pinned')];
      return newest;
    });
    mocks.db.exploreDataset.findMany.mockResolvedValue([{ sourceConfig: JSON.stringify({ runIds: ['old-pinned'] }) }, { sourceConfig: 'not json' }]);
    const runs = await listDataRuns('project:p1');
    expect(runs).toHaveLength(52);
    expect(runs.map((r) => r.id)).toEqual(expect.arrayContaining(['old-queued', 'old-pinned']));
    const byId = mocks.db.pipelineRun.findMany.mock.calls.find(([arg]) => (arg as { where: { id?: { in?: unknown } } }).where.id?.in)?.[0] as { where: { id: { in: string[] } } };
    expect(byId.where.id.in.sort()).toEqual(['old-pinned', 'old-queued']);
    // Active, or ended in the last day (a long-queued run that just finished keeps its card and its notice).
    const activeQuery = mocks.db.pipelineRun.findMany.mock.calls.find(([arg]) => (arg as { where: { OR?: unknown } }).where.OR)?.[0] as { where: { OR: Record<string, unknown>[] } };
    expect(activeQuery.where.OR).toEqual([{ status: { in: ['pending', 'queued', 'running'] } }, { completedAt: { gte: expect.any(Date) } }]);
  });

  it('says per run whether the one asking may cancel or resume it', async () => {
    mocks.db.pipelineRun.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (where.pipelineId || where.OR || where.id ? [] : [row('r1', 'running')]));
    mocks.db.exploreDataset.findMany.mockResolvedValue([]);
    expect((await listDataRuns('project:p1', { id: 'lena', installation: false }))[0].canManage).toBe(true);
    expect((await listDataRuns('project:p1', { id: 'sam', installation: false }))[0].canManage).toBe(false);
    expect((await listDataRuns('project:p1', { id: 'sam', installation: true }))[0].canManage).toBe(true);
  });
});

describe('the failed task’s own error', () => {
  it('is found from the trace’s hash column (a Mac trace has no path in it), so the card can say what the tool said', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'failed-task-'));
    const work = path.join(folder, 'work', 'a7', '044e64d74926baf0c1a3d4b95fe1ae');
    fs.mkdirSync(work, { recursive: true });
    fs.writeFileSync(path.join(work, '.command.err'), 'Failed to process file ERR10419931_1.fastq.gz\nuk.ac.babraham.FastQC.Sequence.SequenceFormatException: Unexpected end of ZLIB input stream\n');
    const trace = 'task_id\thash\tnative_id\tprocess\ttag\tname\tstatus\texit\n1\ta7/044e64\t95761\tRUN_FASTQC\tERR10419931\tRUN_FASTQC (ERR10419931)\tFAILED\t1\n';
    expect(await failedTaskError(folder, trace)).toContain('Failed to process file ERR10419931_1.fastq.gz');
    fs.rmSync(folder, { recursive: true, force: true });
  });
});
