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
vi.mock('./data-study', () => ({ findDataStudy: vi.fn(async () => ({ id: 'study-1' })), readsInData: vi.fn(), readsWords: vi.fn() }));
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

import { listDataRuns } from './pipeline-data-service';

const row = (id: string, status = 'completed') => ({
  id, runNumber: id.toUpperCase(), pipelineId: 'fastqc', status, executionMode: 'slurm', executionProfile: null, queueJobId: null, queueStatus: null, queueReason: null,
  queueUpdatedAt: null, currentStep: null, queuedAt: null, startedAt: null, completedAt: null, createdAt: new Date('2026-09-28T10:00:00Z'), outputTail: null, errorTail: null,
  runFolder: null, inputSampleIds: null, config: null, studyId: 'study-1', user: null, artifacts: [], events: [],
});

describe('the study’s runs for the band', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps an active run and a pinned run that fell out of the newest 50', async () => {
    const newest = Array.from({ length: 50 }, (_, i) => row(`new-${i}`));
    mocks.db.pipelineRun.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.pipelineId) return []; // past durations for the estimate
      if (where.status) return [{ id: 'old-queued' }, { id: 'new-3' }];
      if (where.id) return [row('old-queued', 'queued'), row('old-pinned')];
      return newest;
    });
    mocks.db.exploreDataset.findMany.mockResolvedValue([{ sourceConfig: JSON.stringify({ runIds: ['old-pinned'] }) }, { sourceConfig: 'not json' }]);
    const runs = await listDataRuns('project:p1');
    expect(runs).toHaveLength(52);
    expect(runs.map((r) => r.id)).toEqual(expect.arrayContaining(['old-queued', 'old-pinned']));
    const byId = mocks.db.pipelineRun.findMany.mock.calls.find(([arg]) => (arg as { where: { id?: { in?: unknown } } }).where.id?.in)?.[0] as { where: { id: { in: string[] } } };
    expect(byId.where.id.in.sort()).toEqual(['old-pinned', 'old-queued']);
  });
});
