import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { pipelineRun: { findMany: mocks.findMany, count: mocks.count } } }));

import { localAdmissionWait } from './pipeline-run-service';

const share = { cores: 8, memoryGb: 24, timeHours: 48 };
const profile = (cores: number, memoryGb: number) => ({ executionProfile: JSON.stringify({ local: { cores, memoryGb, timeHours: 48 } }) });

describe('the local admission queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SEQDESK_LOCAL_CORES = '16';
    process.env.SEQDESK_LOCAL_MEMORY_GB = '55';
  });
  it('starts a run that fits beside the running ones', async () => {
    mocks.findMany.mockResolvedValue([profile(8, 24)]);
    mocks.count.mockResolvedValue(0);
    expect(await localAdmissionWait('r3', share)).toBeNull();
  });
  it('holds a run that would oversubscribe the server, and one behind others already waiting', async () => {
    mocks.findMany.mockResolvedValue([profile(8, 24), profile(8, 24)]);
    mocks.count.mockResolvedValue(0);
    expect(await localAdmissionWait('r3', share)).toBe('LocalCapacity:8:24');
    mocks.findMany.mockResolvedValue([]);
    mocks.count.mockResolvedValue(2);
    expect(await localAdmissionWait('r4', share)).toBe('LocalCapacity:8:24:2');
  });
  it('starts the run when the queue cannot be read (as before the queue existed)', async () => {
    mocks.findMany.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await localAdmissionWait('r5', share)).toBeNull();
  });
});
