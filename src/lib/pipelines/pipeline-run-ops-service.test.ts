import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    user: {
      findFirst: vi.fn(),
    },
  },
  getPipelineEnabled: vi.fn(),
  getAllPackages: vi.fn(),
  registry: {
    'study-pipe': {
      id: 'study-pipe',
      name: 'Study Pipe',
      description: 'Study scoped',
      input: {
        supportedScopes: ['study'],
      },
    },
    'order-pipe': {
      id: 'order-pipe',
      name: 'Order Pipe',
      description: 'Order scoped',
      input: {
        supportedScopes: ['order'],
      },
    },
  },
}));

vi.mock('@/lib/db', () => ({
  db: mocks.db,
}));

vi.mock('@/lib/pipelines', () => ({
  PIPELINE_REGISTRY: mocks.registry,
}));

vi.mock('@/lib/pipelines/enablement', () => ({
  getPipelineEnabled: mocks.getPipelineEnabled,
}));

vi.mock('@/lib/pipelines/package-loader', () => ({
  getAllPackages: mocks.getAllPackages,
}));

import {
  listPipelineCatalogForOperator,
  resolvePipelineOperator,
} from './pipeline-run-ops-service';

describe('pipeline run operator services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPipelineEnabled.mockResolvedValue(true);
    mocks.getAllPackages.mockReturnValue([]);
  });

  it('uses the first facility admin when no user email is supplied', async () => {
    mocks.db.user.findFirst.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.org',
      role: 'FACILITY_ADMIN',
    });

    const result = await resolvePipelineOperator();

    expect(result.status).toBe(200);
    expect(mocks.db.user.findFirst).toHaveBeenCalledWith({
      where: { role: 'FACILITY_ADMIN' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });
    expect(result.body.user).toMatchObject({ id: 'admin-1' });
  });

  it('selects the requested facility admin by email', async () => {
    mocks.db.user.findFirst.mockResolvedValue({
      id: 'admin-2',
      email: 'ops@example.org',
      role: 'FACILITY_ADMIN',
    });

    const result = await resolvePipelineOperator('ops@example.org');

    expect(result.status).toBe(200);
    expect(mocks.db.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'ops@example.org', role: 'FACILITY_ADMIN' },
      })
    );
  });

  it('fails clearly when no facility admin exists', async () => {
    mocks.db.user.findFirst.mockResolvedValue(null);

    const result = await resolvePipelineOperator();

    expect(result.status).toBe(400);
    expect(result.body.error).toContain('No FACILITY_ADMIN user exists');
  });

  it('filters catalog entries by target type and enabled state', async () => {
    mocks.getPipelineEnabled.mockImplementation(async (pipelineId: string) =>
      pipelineId === 'study-pipe'
    );

    const result = await listPipelineCatalogForOperator({
      catalog: 'study',
      enabledOnly: true,
    });

    expect(result.status).toBe(200);
    expect(result.body.pipelines).toEqual([
      expect.objectContaining({
        id: 'study-pipe',
        enabled: true,
        catalog: { study: true, order: false },
      }),
    ]);
  });
});
