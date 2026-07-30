import { execFileSync } from 'node:child_process';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- hoisted mocks --------------------------------------------------------
const mocks = vi.hoisted(() => ({
  db: {
    pipelineRun: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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
    realpath: vi.fn(),
    lstat: vi.fn(),
    writeFile: vi.fn(),
    chmod: vi.fn(),
    rm: vi.fn(),
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
    realpath: mocks.fs.realpath,
    lstat: mocks.fs.lstat,
    writeFile: mocks.fs.writeFile,
    chmod: mocks.fs.chmod,
    rm: mocks.fs.rm,
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

function baseStartRunOptions(
  overrides?: Record<string, unknown>
): Parameters<typeof prepareMagRun>[0] {
  return {
    runId: 'run-1',
    studyId: 'study-1',
    config: {},
    executionSettings: baseExecutionSettings(),
    userId: 'user-1',
    ...overrides,
  } as Parameters<typeof prepareMagRun>[0];
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

  it('keeps incrementing past 999 instead of stalling', async () => {
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    mocks.db.pipelineRun.findMany.mockResolvedValue([
      { runNumber: `MAG-${todayStr}-999` },
    ]);

    const result = await generateRunNumber();
    expect(result).toBe(`MAG-${todayStr}-1000`);
  });
});

describe('prepareMagRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);
    mocks.db.pipelineRun.update.mockResolvedValue({});
    mocks.db.pipelineRun.updateMany.mockResolvedValue({ count: 1 });
    mocks.fs.mkdir.mockResolvedValue(undefined);
    mocks.fs.realpath.mockImplementation(async (filePath: string) => filePath);
    mocks.fs.lstat.mockResolvedValue({
      isDirectory: () => true,
      isSymbolicLink: () => false,
    });
    mocks.fs.writeFile.mockResolvedValue(undefined);
    mocks.fs.chmod.mockResolvedValue(undefined);
    mocks.fs.rm.mockResolvedValue(undefined);
  });

  it('returns error when adapter is not registered', async () => {
    mocks.adapters.getAdapter.mockReturnValue(undefined);

    const result = await prepareMagRun(baseStartRunOptions());

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

    const result = await prepareMagRun(baseStartRunOptions());

    expect(result.success).toBe(false);
    expect(result.errors).toContain('No valid samples for samplesheet');
  });

  it('fails when samplesheet generation skips any selected sample', async () => {
    const adapter = makeMockAdapter({
      generateSamplesheet: vi.fn().mockResolvedValue({
        content: 'sample,group\nS1,G1',
        sampleCount: 1,
        errors: ['Warning: platform fallback used'],
      }),
    });
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    const result = await prepareMagRun(baseStartRunOptions());

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Warning: platform fallback used');
    expect(mocks.db.pipelineRun.updateMany).not.toHaveBeenCalled();
  });

  it('creates run directory with logs subdirectory', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    await prepareMagRun(baseStartRunOptions());

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

  it('isolates concurrent preparations that calculate the same run number', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    const [first, second] = await Promise.all([
      prepareMagRun(
        baseStartRunOptions({
          runId: 'run-concurrent-a',
        }) as Parameters<typeof prepareMagRun>[0]
      ),
      prepareMagRun(
        baseStartRunOptions({
          runId: 'run-concurrent-b',
        }) as Parameters<typeof prepareMagRun>[0]
      ),
    ]);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.runFolder).not.toBe(second.runFolder);

    const updateCalls = mocks.db.pipelineRun.updateMany.mock.calls;
    expect(updateCalls[0][0].data.runNumber).toBe(
      updateCalls[1][0].data.runNumber
    );
    expect(updateCalls[0][0].data.runFolder).not.toBe(
      updateCalls[1][0].data.runFolder
    );
  });

  it('writes samplesheet and run script', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    await prepareMagRun(baseStartRunOptions());

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

    await prepareMagRun(baseStartRunOptions());

    expect(mocks.fs.chmod).toHaveBeenCalledWith(
      expect.stringContaining('run.sh'),
      0o755
    );
  });

  it('updates the pipeline run record in DB', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    await prepareMagRun(baseStartRunOptions());

    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'run-1',
          status: 'queued',
          OR: expect.arrayContaining([
            { statusSource: null },
            {
              statusSource: {
                notIn: ['finalizing', 'cancelling'],
              },
            },
          ]),
        }),
        data: expect.objectContaining({
          runNumber: expect.stringMatching(/^MAG-/),
          runFolder: expect.stringContaining('/runs/MAG-'),
        }),
      })
    );
    expect(
      mocks.db.pipelineRun.updateMany.mock.calls[0][0].data.status
    ).toBeUndefined();
  });

  it('uses the canonical directory returned after creating the run folder', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);
    mocks.fs.realpath.mockImplementation(async (filePath: string) =>
      filePath.replace(/^\/runs/, '/physical/runs')
    );

    const result = await prepareMagRun(baseStartRunOptions());

    expect(result.success).toBe(true);
    expect(result.runFolder).toMatch(/^\/physical\/runs\/MAG-/);
    const persistedRunFolder = mocks.db.pipelineRun.updateMany.mock.calls.find(
      (call) => call[0]?.data?.runFolder
    )?.[0].data.runFolder;
    expect(persistedRunFolder).toBe(result.runFolder);
    expect(mocks.fs.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/physical\/runs\/MAG-.*\/run\.sh$/),
      expect.stringContaining(result.runFolder!)
    );
  });

  it('does not resurrect a run cancelled while MAG preparation writes its folder', async () => {
    mocks.adapters.getAdapter.mockReturnValue(makeMockAdapter());
    mocks.db.pipelineRun.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await prepareMagRun(baseStartRunOptions());

    expect(result.success).toBe(false);
    expect(result.errors).toContain(
      'Run was cancelled or finalized during preparation'
    );
    expect(mocks.fs.rm).toHaveBeenCalledWith(
      expect.stringMatching(/MAG-.*--id-run-1$/),
      { recursive: true, force: true }
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
        slurmOptions: '--job-name=admin-name -J other-name --exclusive',
      },
    });

    await prepareMagRun(options);

    const scriptWrite = mocks.fs.writeFile.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('run.sh')
    );
    expect(scriptWrite).toBeDefined();
    const script = scriptWrite![1] as string;
    expect(script).toContain('#SBATCH');
    expect(script).toContain('#SBATCH --job-name=seqdesk-run-1');
    expect(script.match(/^#SBATCH --job-name=/gm)).toHaveLength(1);
    expect(script).toContain('-p batch');
    expect(script).toContain('-c 8');
    expect(script).toContain("--mem='32GB'");
    expect(script).toContain('#SBATCH --exclusive');
    expect(script).toContain('#SBATCH -D "/runs/');
    expect(script).not.toContain('admin-name');
    expect(script).not.toContain('other-name');
    expect(script).toContain("SEQDESK_PIPELINE_RUN_ID='run-1'");
    expect(script).toContain(
      'SLURM_ATTESTATION_FILE="$RUN_FOLDER/logs/slurm-$SLURM_JOB_ID.attestation"'
    );
    expect(script).toContain('slurm_job_id=%s');
    expect(script).toContain('phase=completed');
    expect(
      script.match(/^write_seqdesk_slurm_completion_attestation$/gm)
    ).toHaveLength(1);
    expect(
      script.lastIndexOf('write_seqdesk_slurm_completion_attestation')
    ).toBeGreaterThan(script.indexOf('"${NEXTFLOW_RUNNER[@]}" run'));
  });

  it('generates local script when useSlurm is false', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    await prepareMagRun(baseStartRunOptions());

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

    await prepareMagRun(options);

    const scriptWrite = mocks.fs.writeFile.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('run.sh')
    );
    const script = scriptWrite![1] as string;
    expect(script).toContain('--skip_megahit');
    expect(script).toContain('--skip_spades');
  });

  it('shell-quotes the gtdb_db path so it cannot inject commands', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    const options = baseStartRunOptions({
      config: { gtdbDb: '/db/gtdb; rm -rf /' },
      executionSettings: {
        ...baseExecutionSettings(),
        pipelineRunDir: "/runs with space/O'Brien",
        nextflowProfile: 'profile with space',
        weblogUrl: 'https://seqdesk.example/api/pipelines/weblog',
      },
    });

    await prepareMagRun(options);

    const scriptWrite = mocks.fs.writeFile.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('run.sh')
    );
    const script = scriptWrite![1] as string;
    expect(script).toContain("--gtdb_db '/db/gtdb; rm -rf /'");
    expect(script).not.toContain('--gtdb_db /db/gtdb; rm -rf /');
    expect(script).toContain(
      `RUN_FOLDER='/runs with space/O'\\''Brien/`
    );
    expect(script).toContain(
      `--input '/runs with space/O'\\''Brien/`
    );
    expect(script).toContain("/samplesheet.csv'");
    expect(script).toContain("-profile 'profile with space'");
    expect(script).toContain(
      `-c '/runs with space/O'\\''Brien/`
    );
    expect(script).toContain("/nextflow.config'");
    expect(() =>
      execFileSync('bash', ['-n'], { input: script })
    ).not.toThrow();
  });

  it('rejects malformed SLURM header values instead of injecting them', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    const options = baseStartRunOptions({
      executionSettings: {
        ...baseExecutionSettings(),
        useSlurm: true,
        slurmQueue: 'evil queue; rm -rf /',
        slurmMemory: "32GB'; rm -rf /; echo '",
        slurmOptions: '--job-name=evil -J other --gres=gpu:1\nmalicious line',
      },
    });

    await prepareMagRun(options);

    const scriptWrite = mocks.fs.writeFile.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('run.sh')
    );
    const script = scriptWrite![1] as string;
    expect(script).toContain('#SBATCH -p cpu');
    expect(script).toContain("#SBATCH --mem='64GB'");
    expect(script.match(/^#SBATCH --job-name=/gm)).toHaveLength(1);
    expect(script).toContain('#SBATCH --job-name=seqdesk-run-1');
    expect(script).not.toContain('rm -rf /');
    expect(script).not.toContain('malicious line');

    const blocked = await prepareMagRun(
      baseStartRunOptions({
        runId: 'run-owned-path',
        executionSettings: {
          ...baseExecutionSettings(),
          useSlurm: true,
          slurmOptions: '--error=/tmp/hijacked.err --exclusive',
        },
      })
    );
    expect(blocked.success).toBe(false);
    expect(blocked.errors.join('\n')).toMatch(
      /overrides SeqDesk-owned WorkDir or capture-log paths/
    );
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

    await prepareMagRun(options);

    const configWrite = mocks.fs.writeFile.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('nextflow.config')
    );
    expect(configWrite).toBeDefined();
    expect(configWrite![1]).toContain('weblog');
    expect(configWrite![1]).toContain("trace.fields = '");
    expect(configWrite![1]).toContain('process,tag,name,status,exit,attempt,');
  });

  it('includes stub flag when stubMode is true', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    const options = baseStartRunOptions({
      config: { stubMode: true },
    });

    await prepareMagRun(options);

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

    await prepareMagRun(options);

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

    const result = await prepareMagRun(baseStartRunOptions());

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Failed to prepare run');
    expect(result.errors[0]).toContain('permission denied');
    // The configured root failed before this call created the generated leaf,
    // so cleanup must not remove any pre-existing path.
    expect(mocks.fs.rm).not.toHaveBeenCalled();
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

    await prepareMagRun(options);

    const scriptWrite = mocks.fs.writeFile.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('run.sh')
    );
    const script = scriptWrite![1] as string;
    expect(script).toContain('CONDA_BASE=/opt/conda');
    expect(script).toContain('CONDA_ENV=myenv');
    expect(script).toContain('CONDA_ENV_SELECTOR=-n');
    expect(script).toContain('conda activate');
  });

  it('uses the prefix selector for a shared Conda environment path', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    const options = baseStartRunOptions({
      executionSettings: {
        ...baseExecutionSettings(),
        condaPath: '/opt/conda',
        condaEnv: '/shared/conda/envs/seqdesk',
      },
    });

    await prepareMagRun(options);

    const scriptWrite = mocks.fs.writeFile.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('run.sh')
    );
    const script = scriptWrite![1] as string;
    expect(script).toContain('CONDA_ENV=/shared/conda/envs/seqdesk');
    expect(script).toContain('CONDA_ENV_SELECTOR=-p');
    expect(script).toContain(
      'conda run "$CONDA_ENV_SELECTOR" "$CONDA_ENV" nextflow'
    );
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

    await prepareMagRun(options);

    const scriptWrite = mocks.fs.writeFile.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('run.sh')
    );
    const script = scriptWrite![1] as string;
    expect(script).toContain('-profile conda');
  });

  it('records the exit code via an EXIT trap so failures still write the marker (local)', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    await prepareMagRun(baseStartRunOptions());

    const scriptWrite = mocks.fs.writeFile.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('run.sh')
    );
    const script = scriptWrite![1] as string;
    // The marker must be written from a trap so "set -e" cannot skip it on failure.
    expect(script).toContain(
      `trap 'EXIT_CODE=$?; echo "Pipeline completed with exit code: $EXIT_CODE at $(date)" >> "$STDOUT_LOG"; exit $EXIT_CODE' EXIT`
    );
    // The dead post-command capture must be gone.
    expect(script).not.toContain('EXIT_CODE=$?\necho');
  });

  it('records the exit code via an EXIT trap so failures still write the marker (slurm)', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    const options = baseStartRunOptions({
      executionSettings: {
        ...baseExecutionSettings(),
        useSlurm: true,
      },
    });

    await prepareMagRun(options);

    const scriptWrite = mocks.fs.writeFile.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('run.sh')
    );
    const script = scriptWrite![1] as string;
    expect(script).toContain('#SBATCH');
    expect(script).toContain(
      'trap finalize_seqdesk_slurm_wrapper EXIT'
    );
    expect(script).toContain('SEQDESK_WRAPPER_EXIT_CODE=$?');
    expect(
      script.indexOf('trap finalize_seqdesk_slurm_wrapper EXIT')
    ).toBeLessThan(script.indexOf('for _ in $(seq 1 15)'));
    expect(script).not.toContain('EXIT_CODE=$?\necho');
    expect(script).not.toContain("trap '");
    // SLURM's own logs go to node-local /tmp (root-squash safe).
    expect(script).toContain('#SBATCH --output="/tmp/seqdesk-slurm-%j.out"');
  });

  it('retries run-number allocation when a concurrent run claims the number first', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    // First findMany returns the max for both racers; after the first claim
    // succeeds, the next findMany reflects it so the retry computes 009.
    mocks.db.pipelineRun.findMany
      .mockResolvedValueOnce([{ runNumber: `MAG-${todayStr}-007` }])
      .mockResolvedValueOnce([{ runNumber: `MAG-${todayStr}-008` }]);

    const conflict = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['runNumber'] },
    });
    mocks.db.pipelineRun.updateMany
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ count: 1 });

    const result = await prepareMagRun(baseStartRunOptions());

    expect(result.success).toBe(true);
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledTimes(2);
    // The stale folder from the losing attempt is removed before retrying.
    expect(mocks.fs.rm).toHaveBeenCalledTimes(1);
    const finalCall = mocks.db.pipelineRun.updateMany.mock.calls[1][0];
    expect(finalCall.data.runNumber).toBe(`MAG-${todayStr}-009`);
    expect(result.runFolder).toContain(finalCall.data.runNumber);
  });

  it('surfaces non-runNumber unique violations instead of retrying', async () => {
    const adapter = makeMockAdapter();
    mocks.adapters.getAdapter.mockReturnValue(adapter);

    const conflict = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['someOtherField'] },
    });
    mocks.db.pipelineRun.updateMany.mockRejectedValue(conflict);

    const result = await prepareMagRun(baseStartRunOptions());

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Failed to prepare run');
    // No retry: update is attempted exactly once, but its run-ID-scoped folder
    // is still removed before the failure is returned.
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.fs.rm).toHaveBeenCalledTimes(1);
  });

  it('removes the final folder when run-number collision retries are exhausted', async () => {
    mocks.adapters.getAdapter.mockReturnValue(makeMockAdapter());
    const conflict = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['runNumber'] },
    });
    mocks.db.pipelineRun.updateMany.mockRejectedValue(conflict);

    const result = await prepareMagRun(baseStartRunOptions());

    expect(result.success).toBe(false);
    expect(mocks.db.pipelineRun.updateMany).toHaveBeenCalledTimes(5);
    expect(mocks.fs.rm).toHaveBeenCalledTimes(5);
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
