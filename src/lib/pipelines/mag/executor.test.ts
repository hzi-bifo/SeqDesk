import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- hoisted mocks --------------------------------------------------------
const mocks = vi.hoisted(() => ({
  db: {
    pipelineRun: {
      findMany: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  },
  adapters: {
    getAdapter: vi.fn(),
  },
  outputResolver: {
    resolveOutputs: vi.fn(),
    saveRunResults: vi.fn(),
  },
  fs: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    chmod: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: mocks.db }));
vi.mock('@/lib/pipelines/adapters', () => ({
  getAdapter: mocks.adapters.getAdapter,
}));
vi.mock('@/lib/pipelines/adapters/mag', () => ({}));
vi.mock('@/lib/pipelines/output-resolver', () => ({
  resolveOutputs: mocks.outputResolver.resolveOutputs,
  saveRunResults: mocks.outputResolver.saveRunResults,
}));
vi.mock('fs/promises', () => ({
  default: {
    mkdir: mocks.fs.mkdir,
    writeFile: mocks.fs.writeFile,
    chmod: mocks.fs.chmod,
  },
}));

// ---- import after mocks ----------------------------------------------------
import {
  generateRunNumber,
  prepareMagRun,
  updateRunStatus,
  processCompletedRun,
} from './executor';

// ---- helpers ---------------------------------------------------------------
function baseExecutionSettings() {
  return {
    useSlurm: false,
    pipelineRunDir: '/runs',
    dataBasePath: '/data',
  };
}

function baseStartRunOptions(overrides?: Record<string, unknown>) {
  return {
    runId: 'run-1',
    studyId: 'study-1',
    config: {},
    executionSettings: baseExecutionSettings(),
    userId: 'user-1',
    ...overrides,
  };
}

function makeMockAdapter(overrides?: Record<string, unknown>) {
  return {
    pipelineId: 'mag',
    generateSamplesheet: vi.fn().mockResolvedValue({
      content: 'sample,group\nS1,G1',
      sampleCount: 1,
      errors: [],
    }),
    discoverOutputs: vi.fn().mockResolvedValue({
      files: [],
      errors: [],
      summary: { assembliesFound: 0, binsFound: 0, artifactsFound: 0, reportsFound: 0 },
    }),
    validateInputs: vi.fn().mockResolvedValue({ valid: true, issues: [] }),
    ...overrides,
  };
}

// ---- tests -----------------------------------------------------------------
describe('generateRunNumber', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns MAG-YYYYMMDD-001 when no runs exist', async () => {
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);

    const result = await generateRunNumber();

    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    expect(result).toBe(`MAG-${todayStr}-001`);
  });

  it('increments the run number from existing runs', async () => {
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    mocks.db.pipelineRun.findMany.mockResolvedValue([
      { runNumber: `MAG-${todayStr}-005` },
    ]);

    const result = await generateRunNumber();
    expect(result).toBe(`MAG-${todayStr}-006`);
  });

  it('pads run numbers to three digits', async () => {
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);

    const result = await generateRunNumber();
    expect(result).toMatch(/-\d{3}$/);
  });
});

describe('prepareMagRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);
    mocks.db.pipelineRun.update.mockResolvedValue({});
    mocks.fs.mkdir.mockResolvedValue(undefined);
    mocks.fs.writeFile.mockResolvedValue(undefined);
    mocks.fs.chmod.mockResolvedValue(undefined);
  });

  it('returns error when adapter is not registered', async () => {
    mocks.adapters.getAdapter.mockReturnValue(undefined);

    const result = await prepareMagRun(baseStartRunOptions() as any);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('MAG adapter not registered');
  });

  it('returns error when samplesheet has zero samples', async () => {
    const adapter = makeMockAdapter({
      generateSamplesheet: vi.fn().mockResolvedValue({
        content: '',
        sampleCount: 0,
        errors: ['No samples found'],
      }),
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    const result = await prepareMagRun(baseStartRunOptions() as any);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('No valid samples for samplesheet');
  });

  it('propagates samplesheet errors but succeeds when sampleCount > 0', async () => {
    const adapter = makeMockAdapter({
      generateSamplesheet: vi.fn().mockResolvedValue({
        content: 'sample,group\nS1,G1',
        sampleCount: 1,
        errors: ['Warning: platform fallback used'],
      }),
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    const result = await prepareMagRun(baseStartRunOptions() as any);

    expect(result.success).toBe(true);
    expect(result.errors).toContain('Warning: platform fallback used');
  });

  it('creates run directory with logs subdirectory', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    await prepareMagRun(baseStartRunOptions() as any);

    // Should create the main run dir and logs subdir
    expect(mocks.fs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining('/runs/MAG-'),
      { recursive: true }
    );
    expect(mocks.fs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining('/logs'),
      { recursive: true }
    );
  });

  it('writes samplesheet and run script', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    await prepareMagRun(baseStartRunOptions() as any);

    // Should write samplesheet.csv
    const writeFileCalls = mocks.fs.writeFile.mock.calls;
    const samplesheetWrite = writeFileCalls.find((c: unknown[]) =>
      (c[0] as string).endsWith('samplesheet.csv')
    );
    expect(samplesheetWrite).toBeDefined();
    expect(samplesheetWrite![1]).toBe('sample,group\nS1,G1');

    // Should write run.sh
    const scriptWrite = writeFileCalls.find((c: unknown[]) =>
      (c[0] as string).endsWith('run.sh')
    );
    expect(scriptWrite).toBeDefined();
  });

  it('makes run.sh executable', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    await prepareMagRun(baseStartRunOptions() as any);

    expect(mocks.fs.chmod).toHaveBeenCalledWith(
      expect.stringContaining('run.sh'),
      0o755
    );
  });

  it('updates the pipeline run record in DB', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    await prepareMagRun(baseStartRunOptions() as any);

    expect(mocks.db.pipelineRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({
          status: 'queued',
          runNumber: expect.stringMatching(/^MAG-/),
          runFolder: expect.stringContaining('/runs/MAG-'),
        }),
      })
    );
  });

  it('generates SLURM script when useSlurm is true', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    const options = baseStartRunOptions({
      executionSettings: {
        ...baseExecutionSettings(),
        useSlurm: true,
        slurmQueue: 'batch',
        slurmCores: 8,
        slurmMemory: '32GB',
        slurmTimeLimit: 24,
      },
    });

    await prepareMagRun(options as any);

    const scriptWrite = mocks.fs.writeFile.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('run.sh')
    );
    expect(scriptWrite).toBeDefined();
    const script = scriptWrite![1] as string;
    expect(script).toContain('#SBATCH');
    expect(script).toContain('-p batch');
    expect(script).toContain('-c 8');
    expect(script).toContain("--mem='32GB'");
  });

  it('generates local script when useSlurm is false', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    await prepareMagRun(baseStartRunOptions() as any);

    const scriptWrite = mocks.fs.writeFile.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('run.sh')
    );
    const script = scriptWrite![1] as string;
    expect(script).not.toContain('#SBATCH');
    expect(script).toContain('set -euo pipefail');
  });

  it('includes MAG config flags in script', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    const options = baseStartRunOptions({
      config: { skipMegahit: true, skipSpades: true },
    });

    await prepareMagRun(options as any);

    const scriptWrite = mocks.fs.writeFile.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('run.sh')
    );
    const script = scriptWrite![1] as string;
    expect(script).toContain('--skip_megahit');
    expect(script).toContain('--skip_spades');
  });

  it('writes nextflow.config when weblogUrl is provided', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    const options = baseStartRunOptions({
      executionSettings: {
        ...baseExecutionSettings(),
        weblogUrl: 'https://example.com/weblog',
      },
    });

    await prepareMagRun(options as any);

    const configWrite = mocks.fs.writeFile.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('nextflow.config')
    );
    expect(configWrite).toBeDefined();
    expect(configWrite![1]).toContain('weblog');
  });

  it('includes stub flag when stubMode is true', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    const options = baseStartRunOptions({
      config: { stubMode: true },
    });

    await prepareMagRun(options as any);

    const scriptWrite = mocks.fs.writeFile.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('run.sh')
    );
    const script = scriptWrite![1] as string;
    expect(script).toContain('-stub');
  });

  it('handles skipBinQc by also skipping quast and gtdbtk', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    const options = baseStartRunOptions({
      config: { skipBinQc: true },
    });

    await prepareMagRun(options as any);

    const scriptWrite = mocks.fs.writeFile.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('run.sh')
    );
    const script = scriptWrite![1] as string;
    expect(script).toContain('--skip_binqc');
    expect(script).toContain('--skip_quast');
    expect(script).toContain('--skip_gtdbtk');
  });

  it('catches unexpected errors and returns failure', async () => {
    mocks.adapters.getAdapter.mockReturnValue(makeMockAdapter());
    mocks.fs.mkdir.mockRejectedValue(new Error('EACCES: permission denied'));

    const result = await prepareMagRun(baseStartRunOptions() as any);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Failed to prepare run');
    expect(result.errors[0]).toContain('permission denied');
  });

  it('includes conda runtime bootstrap when condaPath is set', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    const options = baseStartRunOptions({
      executionSettings: {
        ...baseExecutionSettings(),
        runtimeMode: 'conda',
        condaPath: '/opt/conda',
        condaEnv: 'myenv',
      },
    });

    await prepareMagRun(options as any);

    const scriptWrite = mocks.fs.writeFile.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('run.sh')
    );
    const script = scriptWrite![1] as string;
    expect(script).toContain('CONDA_BASE="/opt/conda"');
    expect(script).toContain('CONDA_ENV="myenv"');
    expect(script).toContain('conda activate');
  });

  it('includes -profile flag when nextflowProfile is set', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    const options = baseStartRunOptions({
      executionSettings: {
        ...baseExecutionSettings(),
        nextflowProfile: 'conda',
      },
    });

    await prepareMagRun(options as any);

    const scriptWrite = mocks.fs.writeFile.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('run.sh')
    );
    const script = scriptWrite![1] as string;
    expect(script).toContain('-profile conda');
  });
});

describe('updateRunStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets startedAt when transitioning to running without progress', async () => {
    mocks.db.pipelineRun.update.mockResolvedValue({});

    await updateRunStatus('run-1', 'running');

    expect(mocks.db.pipelineRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({
        status: 'running',
        startedAt: expect.any(Date),
      }),
    });
  });

  it('does not set startedAt when running with progress', async () => {
    mocks.db.pipelineRun.update.mockResolvedValue({});

    await updateRunStatus('run-1', 'running', { progress: 50 });

    const data = mocks.db.pipelineRun.update.mock.calls[0][0].data;
    expect(data.startedAt).toBeUndefined();
    expect(data.progress).toBe(50);
  });

  it('sets completedAt when status is completed', async () => {
    mocks.db.pipelineRun.update.mockResolvedValue({});

    await updateRunStatus('run-1', 'completed');

    expect(mocks.db.pipelineRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({
        status: 'completed',
        completedAt: expect.any(Date),
      }),
    });
  });

  it('sets completedAt when status is failed', async () => {
    mocks.db.pipelineRun.update.mockResolvedValue({});

    await updateRunStatus('run-1', 'failed', {
      errorTail: 'OOM killed',
    });

    const data = mocks.db.pipelineRun.update.mock.calls[0][0].data;
    expect(data.completedAt).toBeInstanceOf(Date);
    expect(data.errorTail).toBe('OOM killed');
  });

  it('passes all detail fields to db update', async () => {
    mocks.db.pipelineRun.update.mockResolvedValue({});

    await updateRunStatus('run-1', 'running', {
      progress: 75,
      currentStep: 'assembly',
      outputTail: 'Building...',
      errorTail: '',
    });

    const data = mocks.db.pipelineRun.update.mock.calls[0][0].data;
    expect(data.progress).toBe(75);
    expect(data.currentStep).toBe('assembly');
    expect(data.outputTail).toBe('Building...');
  });
});

describe('processCompletedRun', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when adapter is not registered', async () => {
    mocks.adapters.getAdapter.mockReturnValue(undefined);

    const result = await processCompletedRun('run-1');

    expect(result.success).toBe(false);
    expect(result.errors).toContain('MAG adapter not registered');
  });

  it('returns error when run is not found', async () => {
    mocks.adapters.getAdapter.mockReturnValue(makeMockAdapter());
    mocks.db.pipelineRun.findUnique.mockResolvedValue(null);

    const result = await processCompletedRun('run-1');

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Run not found or missing data');
  });

  it('returns error when run has no runFolder', async () => {
    mocks.adapters.getAdapter.mockReturnValue(makeMockAdapter());
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      runFolder: null,
      study: { samples: [] },
    });

    const result = await processCompletedRun('run-1');

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Run not found or missing data');
  });

  it('discovers outputs and resolves them on success', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      runFolder: '/runs/MAG-20250101-001',
      study: {
        samples: [{ id: 'sample-db-1', sampleId: 'SAMPLE-1' }],
      },
    });
    mocks.outputResolver.resolveOutputs.mockResolvedValue({
      success: true,
      assembliesCreated: 1,
      binsCreated: 3,
      errors: [],
    });
    mocks.outputResolver.saveRunResults.mockResolvedValue(undefined);

    const result = await processCompletedRun('run-1');

    expect(result.success).toBe(true);
    expect(result.assembliesCreated).toBe(1);
    expect(result.binsCreated).toBe(3);
    expect(adapter.discoverOutputs).toHaveBeenCalledWith({
      runId: 'run-1',
      outputDir: '/runs/MAG-20250101-001/output',
      samples: [{ id: 'sample-db-1', sampleId: 'SAMPLE-1' }],
    });
    expect(mocks.outputResolver.resolveOutputs).toHaveBeenCalledWith(
      'mag',
      'run-1',
      expect.any(Object)
    );
    expect(mocks.outputResolver.saveRunResults).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ success: true })
    );
  });

  it('propagates errors from output resolver', async () => {
    mocks.adapters.getAdapter.mockReturnValue(makeMockAdapter());
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: 'run-1',
      runFolder: '/runs/MAG-20250101-001',
      study: { samples: [] },
    });
    mocks.outputResolver.resolveOutputs.mockResolvedValue({
      success: false,
      assembliesCreated: 0,
      binsCreated: 0,
      errors: ['No assemblies found'],
    });
    mocks.outputResolver.saveRunResults.mockResolvedValue(undefined);

    const result = await processCompletedRun('run-1');

    expect(result.success).toBe(false);
    expect(result.errors).toContain('No assemblies found');
  });
});
