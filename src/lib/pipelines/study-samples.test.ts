import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ samples: vi.fn(), getPackage: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { sample: { findMany: mocks.samples } } }));
vi.mock('./package-loader', () => ({ getPackage: mocks.getPackage }));
import { getPipelineSampleWhere, studySampleSelectionIssues } from './target';
import { loadStudyPipelineSamples, loadStudyRunSamples, mergeStudySamples, scopePipelineStudyTarget } from './study-samples';

describe('study pipeline cohort selection', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.samples.mockResolvedValue([]); mocks.getPackage.mockReturnValue(null); });
  const membership = { OR: [{ studyId: 'study' }, { studyMemberships: { some: { studyId: 'study' } } }] };

  it('uses the union of primary samples and memberships, restricted by selected database IDs', () => {
    expect(getPipelineSampleWhere({ type: 'study', studyId: 'study', sampleIds: ['case', 'control', 'case'] })).toEqual({ ...membership, id: { in: ['case', 'control'] } });
    expect(getPipelineSampleWhere({ type: 'study', studyId: 'study', sampleIds: [] })).toEqual({ ...membership, id: { in: [] } });
  });
  it('rejects a cohort that shrank during preparation and ambiguous output names', () => {
    expect(studySampleSelectionIssues({ type: 'study', studyId: 'study', sampleIds: ['case', 'control'] }, [{ id: 'case', sampleId: 'CASE' }])[0]).toContain('no longer available');
    expect(studySampleSelectionIssues({ type: 'study', studyId: 'study' }, [{ id: 'case', sampleId: 'same' }, { id: 'control', sampleId: 'same' }])[0]).toContain('duplicate sample codes');
  });
  it('does not transfer sample ownership through membership', async () => {
    await loadStudyPipelineSamples({ type: 'study', studyId: 'study' }, { userId: 'owner', installation: false });
    expect(mocks.samples.mock.calls[0][0].where).toEqual({ AND: [membership, { OR: [{ order: { userId: 'owner' } }, { orderId: null, study: { userId: 'owner' } }] }] });
  });
  it('allows installation-scoped operators to use mixed-owner memberships', async () => {
    await loadStudyPipelineSamples({ type: 'study', studyId: 'study' }, { userId: 'admin', installation: true });
    expect(mocks.samples.mock.calls[0][0].where).toEqual({ AND: [membership, {}] });
  });
  it('merges duplicate links by database ID, never by display/sample code', () => {
    const primary = { id: 'case', sampleId: 'S1' }, control = { id: 'control', sampleId: 'S1' };
    expect(mergeStudySamples({ samples: [primary], cohortMembers: [{ sample: primary }, { sample: control }] })).toEqual([primary, control]);
    expect(mergeStudySamples({ samples: [primary], cohortMembers: [{ sample: control }] }, true)).toEqual([primary]);
  });
  it('keeps submission pipelines primary-only, including new manifest packages', () => {
    const target = { type: 'study' as const, studyId: 'study' };
    expect(scopePipelineStudyTarget(target, 'metaphlan')).toEqual(target);
    expect(getPipelineSampleWhere(scopePipelineStudyTarget(target, 'submg'))).toEqual({ studyId: 'study' });
    mocks.getPackage.mockReturnValue({ registry: { category: 'submission' } });
    expect(getPipelineSampleWhere(scopePipelineStudyTarget(target, 'another-publisher'))).toEqual({ studyId: 'study' });
  });
  it('resolves a completed run against its frozen IDs even after unlinking', async () => {
    await loadStudyRunSamples({ inputSampleIds: JSON.stringify(['case', 'control', 'control']) });
    expect(mocks.samples.mock.calls[0][0].where).toEqual({ id: { in: ['case', 'control'] } });
  });
  it.each(['invalid', '[]', '{}', '[null]', '[""]'])('fails closed for corrupt historical selection %s', async inputSampleIds => {
    await expect(loadStudyRunSamples({ inputSampleIds })).rejects.toThrow();
    expect(mocks.samples).not.toHaveBeenCalled();
  });
});
