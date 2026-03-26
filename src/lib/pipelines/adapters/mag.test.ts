import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- hoisted mocks --------------------------------------------------------
const mocks = vi.hoisted(() => ({
  db: {
    sample: {
      findMany: vi.fn(),
    },
  },
  fs: {
    readFile: vi.fn(),
    readdir: vi.fn(),
    access: vi.fn(),
  },
  mapPlatformForPipeline: vi.fn(),
  resolveOrderPlatform: vi.fn(),
  generateSamplesheetFromConfig: vi.fn(),
  registerAdapter: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: mocks.db }));
vi.mock('fs/promises', () => ({
  default: {
    readFile: mocks.fs.readFile,
    readdir: mocks.fs.readdir,
    access: mocks.fs.access,
  },
}));
vi.mock('../metadata-validation', () => ({
  mapPlatformForPipeline: mocks.mapPlatformForPipeline,
}));
vi.mock('../order-platform', () => ({
  resolveOrderPlatform: mocks.resolveOrderPlatform,
}));
vi.mock('../samplesheet-generator', () => ({
  generateSamplesheetFromConfig: mocks.generateSamplesheetFromConfig,
}));
vi.mock('./types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./types')>();
  return {
    ...actual,
    registerAdapter: mocks.registerAdapter,
  };
});

// Import after mocks
import { magAdapter } from './mag';

// ---- helpers ---------------------------------------------------------------
function studyTarget(studyId = 'study-1', sampleIds?: string[]) {
  return { type: 'study' as const, studyId, sampleIds };
}

function orderTarget(orderId = 'order-1') {
  return { type: 'order' as const, orderId };
}

// ---- tests: validateInputs -------------------------------------------------
describe('magAdapter.validateInputs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects non-study targets', async () => {
    const result = await magAdapter.validateInputs(orderTarget());
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('MAG can only run on study targets');
  });

  it('returns invalid when no samples are found', async () => {
    mocks.db.sample.findMany.mockResolvedValue([]);

    const result = await magAdapter.validateInputs(studyTarget());
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('No samples found');
  });

  it('reports samples without reads', async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      { sampleId: 'S1', reads: [] },
    ]);

    const result = await magAdapter.validateInputs(studyTarget());
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain('S1');
    expect(result.issues[0]).toContain('No reads assigned');
  });

  it('reports samples without paired-end reads', async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      { sampleId: 'S1', reads: [{ file1: '/r1.fq', file2: null }] },
    ]);

    const result = await magAdapter.validateInputs(studyTarget());
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain('No paired-end reads');
  });

  it('validates successfully with paired-end reads', async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      { sampleId: 'S1', reads: [{ file1: '/r1.fq', file2: '/r2.fq' }] },
    ]);

    const result = await magAdapter.validateInputs(studyTarget());
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('applies sampleIds filter when provided', async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      { sampleId: 'S1', reads: [{ file1: '/r1.fq', file2: '/r2.fq' }] },
    ]);

    await magAdapter.validateInputs(studyTarget('study-1', ['id-1', 'id-2']));

    expect(mocks.db.sample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studyId: 'study-1', id: { in: ['id-1', 'id-2'] } },
      })
    );
  });
});

// ---- tests: generateSamplesheet --------------------------------------------
describe('magAdapter.generateSamplesheet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects non-study targets', async () => {
    const result = await magAdapter.generateSamplesheet({
      target: orderTarget(),
      dataBasePath: '/data',
    });
    expect(result.sampleCount).toBe(0);
    expect(result.errors).toContain('MAG can only run on study targets');
  });

  it('uses declarative config when available', async () => {
    mocks.generateSamplesheetFromConfig.mockResolvedValue({
      content: 'sample\nS1',
      sampleCount: 1,
      errors: [],
    });

    const result = await magAdapter.generateSamplesheet({
      target: studyTarget(),
      dataBasePath: '/data',
    });

    expect(result.content).toBe('sample\nS1');
    expect(result.sampleCount).toBe(1);
    expect(mocks.db.sample.findMany).not.toHaveBeenCalled();
  });

  it('falls back to custom code when config returns null', async () => {
    mocks.generateSamplesheetFromConfig.mockResolvedValue(null);
    mocks.db.sample.findMany.mockResolvedValue([
      {
        sampleId: 'S1',
        reads: [{ file1: 'reads/r1.fq.gz', file2: 'reads/r2.fq.gz' }],
        order: { id: 'o1', platform: 'ILLUMINA', customFields: {} },
      },
    ]);
    mocks.resolveOrderPlatform.mockReturnValue('ILLUMINA');
    mocks.mapPlatformForPipeline.mockReturnValue('ILLUMINA');

    const result = await magAdapter.generateSamplesheet({
      target: studyTarget(),
      dataBasePath: '/data',
    });

    expect(result.sampleCount).toBe(1);
    expect(result.content).toContain('S1');
    expect(result.content).toContain('/data/reads/r1.fq.gz');
    expect(result.content).toContain('short_reads_1');
  });

  it('reports error for samples without paired reads in fallback', async () => {
    mocks.generateSamplesheetFromConfig.mockResolvedValue(null);
    mocks.db.sample.findMany.mockResolvedValue([
      {
        sampleId: 'S1',
        reads: [{ file1: 'r1.fq', file2: null }],
        order: { id: 'o1', platform: 'ILLUMINA', customFields: {} },
      },
    ]);

    const result = await magAdapter.generateSamplesheet({
      target: studyTarget(),
      dataBasePath: '/data',
    });

    expect(result.sampleCount).toBe(0);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('No paired-end reads found'),
        expect.stringContaining('No samples with valid paired-end reads'),
      ])
    );
  });

  it('reports error for unsupported platform in fallback', async () => {
    mocks.generateSamplesheetFromConfig.mockResolvedValue(null);
    mocks.db.sample.findMany.mockResolvedValue([
      {
        sampleId: 'S1',
        reads: [{ file1: 'r1.fq', file2: 'r2.fq' }],
        order: { id: 'o1', platform: 'UNKNOWN', customFields: {} },
      },
    ]);
    mocks.resolveOrderPlatform.mockReturnValue('UNKNOWN');
    mocks.mapPlatformForPipeline.mockReturnValue(null);

    const result = await magAdapter.generateSamplesheet({
      target: studyTarget(),
      dataBasePath: '/data',
    });

    expect(result.errors[0]).toContain('Unsupported sequencing platform');
  });

  it('returns error when no samples found in fallback', async () => {
    mocks.generateSamplesheetFromConfig.mockResolvedValue(null);
    mocks.db.sample.findMany.mockResolvedValue([]);

    const result = await magAdapter.generateSamplesheet({
      target: studyTarget(),
      dataBasePath: '/data',
    });

    expect(result.sampleCount).toBe(0);
    expect(result.errors).toContain('No samples found for the specified criteria');
  });
});

// ---- tests: discoverOutputs ------------------------------------------------
describe('magAdapter.discoverOutputs', () => {
  beforeEach(() => vi.clearAllMocks());

  const baseSamples = [{ id: 'db-1', sampleId: 'SAMPLE-1' }];

  it('discovers assembly files from MEGAHIT directory', async () => {
    // parseCheckmSummary will fail (no file)
    mocks.fs.readFile.mockRejectedValue(new Error('ENOENT'));

    // findAssemblyFiles: MEGAHIT exists with a matching file
    mocks.fs.readdir.mockImplementation(async (dir: string) => {
      if (dir.includes('Assembly/MEGAHIT')) {
        return ['MEGAHIT-SAMPLE-1.contigs.fa.gz'];
      }
      throw new Error('ENOENT');
    });
    // findAlignmentFiles, findMultiQCReport
    mocks.fs.access.mockRejectedValue(new Error('ENOENT'));

    const result = await magAdapter.discoverOutputs({
      runId: 'run-1',
      outputDir: '/out',
      samples: baseSamples,
    });

    expect(result.summary.assembliesFound).toBe(1);
    expect(result.files[0].type).toBe('assembly');
    expect(result.files[0].name).toBe('MEGAHIT-SAMPLE-1.contigs.fa.gz');
    expect(result.files[0].sampleId).toBe('db-1');
  });

  it('discovers assembly files from SPAdes directory', async () => {
    mocks.fs.readFile.mockRejectedValue(new Error('ENOENT'));
    mocks.fs.readdir.mockImplementation(async (dir: string) => {
      if (dir.includes('Assembly/SPAdes')) {
        return ['SPAdes-SAMPLE-1.contigs.fa.gz'];
      }
      throw new Error('ENOENT');
    });
    mocks.fs.access.mockRejectedValue(new Error('ENOENT'));

    const result = await magAdapter.discoverOutputs({
      runId: 'run-1',
      outputDir: '/out',
      samples: baseSamples,
    });

    expect(result.summary.assembliesFound).toBe(1);
    expect(result.files[0].name).toBe('SPAdes-SAMPLE-1.contigs.fa.gz');
  });

  it('discovers DAS Tool refined bins (preferred)', async () => {
    mocks.fs.readFile.mockRejectedValue(new Error('ENOENT'));
    mocks.fs.readdir.mockImplementation(async (dir: string) => {
      if (dir.includes('DASTool/bins') && !dir.includes('SAMPLE-1_DASTool')) {
        return ['SAMPLE-1_DASTool_bins'];
      }
      if (dir.includes('SAMPLE-1_DASTool_bins')) {
        return ['bin.1.fa', 'bin.2.fa'];
      }
      throw new Error('ENOENT');
    });
    mocks.fs.access.mockRejectedValue(new Error('ENOENT'));

    const result = await magAdapter.discoverOutputs({
      runId: 'run-1',
      outputDir: '/out',
      samples: baseSamples,
    });

    expect(result.summary.binsFound).toBe(2);
    expect(result.files.filter(f => f.type === 'bin')).toHaveLength(2);
    expect(result.files.filter(f => f.type === 'bin').every(f => f.metadata?.refined === true)).toBe(true);
  });

  it('falls back to individual binners when no DAS Tool bins', async () => {
    mocks.fs.readFile.mockRejectedValue(new Error('ENOENT'));
    mocks.fs.readdir.mockImplementation(async (dir: string) => {
      // No DAS Tool
      if (dir.includes('DASTool')) throw new Error('ENOENT');
      // MaxBin2 has files
      if (dir.includes('GenomeBinning/MaxBin2') && !dir.includes('Assembly_')) {
        return ['Assembly_1'];
      }
      if (dir.includes('MaxBin2/Assembly_1')) {
        return ['MEGAHIT-MaxBin2-SAMPLE-1.001.fa'];
      }
      // No other binners
      throw new Error('ENOENT');
    });
    mocks.fs.access.mockRejectedValue(new Error('ENOENT'));

    const result = await magAdapter.discoverOutputs({
      runId: 'run-1',
      outputDir: '/out',
      samples: baseSamples,
    });

    expect(result.summary.binsFound).toBe(1);
    const bin = result.files.find(f => f.type === 'bin')!;
    expect(bin.metadata?.refined).toBe(false);
    expect(bin.fromStep).toBe('binning');
  });

  it('includes checkm metrics when available', async () => {
    mocks.fs.readFile.mockResolvedValue(
      'Bin Id\tCompleteness\tContamination\nbin.1.fa\t92.5\t3.2\n'
    );
    // DAS Tool bins
    mocks.fs.readdir.mockImplementation(async (dir: string) => {
      if (dir.includes('DASTool/bins') && !dir.includes('SAMPLE-1_DASTool')) {
        return ['SAMPLE-1_DASTool_bins'];
      }
      if (dir.includes('SAMPLE-1_DASTool_bins')) {
        return ['bin.1.fa'];
      }
      throw new Error('ENOENT');
    });
    mocks.fs.access.mockRejectedValue(new Error('ENOENT'));

    const result = await magAdapter.discoverOutputs({
      runId: 'run-1',
      outputDir: '/out',
      samples: baseSamples,
    });

    const bin = result.files.find(f => f.type === 'bin')!;
    expect(bin.metadata?.completeness).toBe(92.5);
    expect(bin.metadata?.contamination).toBe(3.2);
  });

  it('discovers alignment files', async () => {
    mocks.fs.readFile.mockRejectedValue(new Error('ENOENT'));
    mocks.fs.readdir.mockRejectedValue(new Error('ENOENT'));
    // findAlignmentFiles: direct path exists
    mocks.fs.access.mockImplementation(async (p: string) => {
      if (p.includes('Alignment/SAMPLE-1.sorted.bam')) return;
      throw new Error('ENOENT');
    });

    const result = await magAdapter.discoverOutputs({
      runId: 'run-1',
      outputDir: '/out',
      samples: baseSamples,
    });

    expect(result.summary.artifactsFound).toBe(1);
    expect(result.files.find(f => f.type === 'artifact')?.name).toBe('SAMPLE-1.sorted.bam');
  });

  it('discovers MultiQC report from multiqc directory', async () => {
    mocks.fs.readFile.mockRejectedValue(new Error('ENOENT'));
    mocks.fs.readdir.mockRejectedValue(new Error('ENOENT'));
    mocks.fs.access.mockImplementation(async (p: string) => {
      if (p.includes('multiqc/multiqc_report.html')) return;
      throw new Error('ENOENT');
    });

    const result = await magAdapter.discoverOutputs({
      runId: 'run-1',
      outputDir: '/out',
      samples: baseSamples,
    });

    expect(result.summary.reportsFound).toBe(1);
    expect(result.files.find(f => f.type === 'report')?.name).toBe('multiqc_report.html');
  });

  it('discovers MultiQC report from MultiQC directory (uppercase)', async () => {
    mocks.fs.readFile.mockRejectedValue(new Error('ENOENT'));
    mocks.fs.readdir.mockRejectedValue(new Error('ENOENT'));
    mocks.fs.access.mockImplementation(async (p: string) => {
      if (p.includes('MultiQC/multiqc_report.html')) return;
      throw new Error('ENOENT');
    });

    const result = await magAdapter.discoverOutputs({
      runId: 'run-1',
      outputDir: '/out',
      samples: baseSamples,
    });

    expect(result.summary.reportsFound).toBe(1);
  });

  it('returns empty results when no outputs exist', async () => {
    mocks.fs.readFile.mockRejectedValue(new Error('ENOENT'));
    mocks.fs.readdir.mockRejectedValue(new Error('ENOENT'));
    mocks.fs.access.mockRejectedValue(new Error('ENOENT'));

    const result = await magAdapter.discoverOutputs({
      runId: 'run-1',
      outputDir: '/out',
      samples: baseSamples,
    });

    expect(result.files).toHaveLength(0);
    expect(result.summary.assembliesFound).toBe(0);
    expect(result.summary.binsFound).toBe(0);
    expect(result.summary.artifactsFound).toBe(0);
    expect(result.summary.reportsFound).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('handles multiple samples', async () => {
    mocks.fs.readFile.mockRejectedValue(new Error('ENOENT'));
    mocks.fs.readdir.mockImplementation(async (dir: string) => {
      if (dir.includes('Assembly/MEGAHIT')) {
        return [
          'MEGAHIT-S1.contigs.fa.gz',
          'MEGAHIT-S2.contigs.fa.gz',
        ];
      }
      throw new Error('ENOENT');
    });
    mocks.fs.access.mockRejectedValue(new Error('ENOENT'));

    const result = await magAdapter.discoverOutputs({
      runId: 'run-1',
      outputDir: '/out',
      samples: [
        { id: 'db-1', sampleId: 'S1' },
        { id: 'db-2', sampleId: 'S2' },
      ],
    });

    expect(result.summary.assembliesFound).toBe(2);
    const sampleIds = result.files.map(f => f.sampleId);
    expect(sampleIds).toContain('db-1');
    expect(sampleIds).toContain('db-2');
  });

  it('handles CONCOCT bins which may not match sample ID', async () => {
    mocks.fs.readFile.mockRejectedValue(new Error('ENOENT'));
    mocks.fs.readdir.mockImplementation(async (dir: string) => {
      if (dir.includes('DASTool')) throw new Error('ENOENT');
      if (dir.includes('Assembly/')) throw new Error('ENOENT');
      if (dir.includes('GenomeBinning/CONCOCT') && !dir.includes('Assembly_')) {
        return ['Assembly_1'];
      }
      if (dir.includes('CONCOCT/Assembly_1')) {
        return ['CONCOCT.001.fa', 'CONCOCT.002.fa'];
      }
      // Other binners
      throw new Error('ENOENT');
    });
    mocks.fs.access.mockRejectedValue(new Error('ENOENT'));

    const result = await magAdapter.discoverOutputs({
      runId: 'run-1',
      outputDir: '/out',
      samples: baseSamples,
    });

    // CONCOCT bins match regardless of sample name (binner === 'CONCOCT')
    expect(result.summary.binsFound).toBe(2);
  });
});

// ---- tests: adapter identity -----------------------------------------------
describe('adapter identity', () => {
  it('has pipelineId set to mag', () => {
    expect(magAdapter.pipelineId).toBe('mag');
  });
});
