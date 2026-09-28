import { beforeEach, describe, expect, it, vi } from 'vitest';

// Who may cancel, resume and start a pipeline run on a study's Data (found with a second lab member on a real Slurm:
// Sam could cancel Lena's run but got "This Compute server is not connected to your lab" when starting his own).
const mocks = vi.hoisted(() => ({
  db: {
    pipelineRun: { findUnique: vi.fn() },
    study: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    pipelineRunEvent: { create: vi.fn(async () => ({})), findFirst: (...a: unknown[]) => mocks.events(...a) },
  },
  decide: vi.fn(),
  cancel: vi.fn(),
  resume: vi.fn(),
  create: vi.fn(),
  start: vi.fn(),
  readsInData: vi.fn(async (): Promise<{ files: { id: string; name: string; sizeBytes: number }[]; pairs: unknown[]; words: string }> => ({ files: [], pairs: [], words: '' })),
  events: vi.fn(async (..._args: unknown[]): Promise<{ payload: string } | null> => null),
}));
vi.mock('@/lib/db', () => ({ db: mocks.db }));
vi.mock('@/lib/authorization/api', () => ({ decideServerCapability: mocks.decide }));
vi.mock('@/lib/explore/authorization', () => ({ requireTargetAccess: vi.fn(async () => undefined) }));
vi.mock('@/lib/explore/storage', () => ({ resolveContainedPath: vi.fn() }));
vi.mock('@/lib/pipelines/pipeline-run-service', () => ({ createPipelineRunForOperator: mocks.create, startPipelineRunForOperator: mocks.start }));
vi.mock('@/lib/pipelines/pipeline-run-ops-service', () => ({ cancelPipelineRunForOperator: mocks.cancel }));
vi.mock('@/lib/pipelines/data-study', async (importOriginal) => ({ ...(await importOriginal<object>()),
  ensureDataStudy: vi.fn(async () => ({ studyId: 'study-1', sampleIds: ['s1'], pairs: [] })), readsInData: mocks.readsInData }));
vi.mock('@/lib/pipelines/pipeline-data-service', () => ({
  getDataRun: vi.fn(async () => ({ id: 'run-1' })), listDataRuns: vi.fn(), pipelineReadiness: vi.fn(), runBelongsTo: vi.fn(async () => true), runOutputToData: vi.fn(),
}));
vi.mock('@/lib/pipelines/run-resume', () => ({ resumePipelineRun: mocks.resume }));
vi.mock('@/lib/files/library', () => ({ storeLibraryFile: vi.fn() }));
vi.mock('@/lib/integration/config', () => ({ integrationConfig: () => null }));

import { handleDataPipelinesRequest } from './pipelines';

const session = (id: string) => ({ user: { id } }) as never;
const call = (userId: string, method: string, segments: string[], body?: unknown) =>
  handleDataPipelinesRequest(new Request(`http://compute/api/integration/v1/${segments.join('/')}?targetKey=project:p1`, { method, body: body ? JSON.stringify(body) : undefined }),
    session(userId), segments, new Headers());

describe('data-pipelines: a run is managed by whoever owns the study’s Data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decide.mockReturnValue({ allowed: true, grant: { scope: 'own' } });
    mocks.db.pipelineRun.findUnique.mockImplementation(async ({ select }: { select: Record<string, unknown> }) => (select.status ? { status: 'running' } : { userId: 'lena', study: { userId: 'lena' } }));
    mocks.db.user.findUnique.mockResolvedValue({ firstName: 'Lena', lastName: 'Lead', email: 'lena@lab' });
    mocks.db.study.findUnique.mockResolvedValue({ userId: 'lena' });
    mocks.cancel.mockResolvedValue({ status: 200, body: { success: true } });
    mocks.resume.mockResolvedValue({ status: 200, body: { resumed: 1 } });
  });

  it('another member can neither cancel nor resume it, and is told who can', async () => {
    const cancel = await call('sam', 'POST', ['data-pipelines', 'runs', 'run-1', 'cancel'], {});
    expect(cancel.status).toBe(409);
    expect((await cancel.json()).error).toBe('Only Lena Lead or a SeqDesk admin can cancel this run.');
    expect(mocks.cancel).not.toHaveBeenCalled();
    const resume = await call('sam', 'POST', ['data-pipelines', 'runs', 'run-1', 'resume'], {});
    expect((await resume.json()).error).toBe('Only Lena Lead or a SeqDesk admin can resume this run.');
    expect(mocks.resume).not.toHaveBeenCalled();
  });

  it('the owner and an installation-wide grant can', async () => {
    expect((await call('lena', 'POST', ['data-pipelines', 'runs', 'run-1', 'cancel'], {})).status).toBe(200);
    mocks.decide.mockReturnValue({ allowed: true, grant: { scope: 'installation' } });
    expect((await call('sam', 'POST', ['data-pipelines', 'runs', 'run-1', 'cancel'], {})).status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledTimes(2);
  });

  it('a run folder Compute may not write is said at start, as a 422 the web app shows', async () => {
    mocks.create.mockResolvedValue({ status: 201, body: { run: { id: 'run-9' } } });
    mocks.start.mockResolvedValue({ status: 400, body: { error: 'Failed to prepare run', details: ["Failed to prepare run: EACCES: permission denied, mkdir '/e2e/runs/FASTQC-1--id-x'"] } });
    const started = await call('lena', 'POST', ['data-pipelines', 'runs'], { targetKey: 'project:p1', pipelineId: 'fastqc' });
    expect(started.status).toBe(422);
    expect((await started.json()).error).toBe('Compute may not write its run folder (/e2e/runs): permission denied. The run is kept as failed; ask the admin.');
  });

  it('starting on someone else’s study Data says whose it is, not "not connected"', async () => {
    mocks.create.mockResolvedValue({ status: 403, body: { error: 'Forbidden' } });
    const started = await call('sam', 'POST', ['data-pipelines', 'runs'], { targetKey: 'project:p1', pipelineId: 'fastqc' });
    expect(started.status).toBe(409);
    expect((await started.json()).error).toBe('Only Lena Lead or a SeqDesk admin can start pipelines on this study’s Data.');
  });

  it('the admin part is for this Compute server’s admin only', async () => {
    const denied = await call('lena', 'GET', ['data-pipelines', 'admin']);
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toBe('Only this Compute server’s admin can change its pipelines.');
  });

  it('Resume after the reads in Data changed says so and points to Run again; force resumes anyway', async () => {
    mocks.events.mockResolvedValue({ payload: JSON.stringify({ files: [{ id: 'f1', name: 'a_1.fastq.gz', size: 10 }, { id: 'f2', name: 'a_2.fastq.gz', size: 10 }] }) });
    mocks.readsInData.mockResolvedValue({ files: [{ id: 'f1', name: 'a_1.fastq.gz', sizeBytes: 10 }, { id: 'f2', name: 'a_2.fastq.gz', sizeBytes: 10 }, { id: 'f3', name: 'b_1.fastq.gz', sizeBytes: 9 }, { id: 'f4', name: 'b_2.fastq.gz', sizeBytes: 9 }], pairs: [], words: '' });
    const refused = await call('lena', 'POST', ['data-pipelines', 'runs', 'run-1', 'resume'], {});
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'reads_changed', error: 'The reads in Data changed since this run (2 files added). Resume would use the reads it started with; Run again uses the new ones.' });
    expect(mocks.resume).not.toHaveBeenCalled();
    expect((await call('lena', 'POST', ['data-pipelines', 'runs', 'run-1', 'resume'], { force: true })).status).toBe(200);
    expect(mocks.resume).toHaveBeenCalledTimes(1);
  });
});
