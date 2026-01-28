// Pipeline Registry - defines available pipelines
// Currently only MAG pipeline is implemented

import { PipelineDefinition } from './types';

export const PIPELINE_REGISTRY: Record<string, PipelineDefinition> = {
  mag: {
    id: 'mag',
    name: 'MAG Pipeline',
    description: 'Metagenome assembly and binning using nf-core/mag',
    category: 'analysis',
    version: '3.0.0',
    website: 'https://nf-co.re/mag',

    requires: {
      reads: true,
      assemblies: false,
      bins: false,
      checksums: false,
      studyAccession: false,
      sampleMetadata: false,
    },

    outputs: [
      {
        type: 'data',
        name: 'assemblies',
        description: 'MEGAHIT assemblies',
        model: 'Assembly',
        visibility: 'both',
        downloadable: true,
      },
      {
        type: 'data',
        name: 'bins',
        description: 'Genome bins from MaxBin2',
        model: 'Bin',
        visibility: 'both',
        downloadable: true,
      },
      {
        type: 'data',
        name: 'alignments',
        description: 'Read alignments (BAM files)',
        visibility: 'admin',
        downloadable: false,
      },
      {
        type: 'metric',
        name: 'bin_quality',
        description: 'CheckM completeness and contamination scores',
        model: 'Bin',
        visibility: 'both',
      },
      {
        type: 'report',
        name: 'qc_report',
        description: 'MultiQC report',
        visibility: 'both',
        downloadable: true,
      },
    ],

    visibility: {
      showToUser: true,
      userCanStart: false,  // Only admins can start
    },

    input: {
      supportedScopes: ['study', 'samples'],
      minSamples: 1,
      perSample: {
        reads: true,
        pairedEnd: true,  // Requires paired-end reads
      },
    },

    samplesheet: {
      format: 'csv',
      generator: 'generateMagSamplesheet',
    },

    configSchema: {
      type: 'object',
      properties: {
        stubMode: {
          type: 'boolean',
          title: 'Stub Mode',
          description: 'Run in stub mode (for testing, skips actual processing)',
          default: false,
        },
        skipMegahit: {
          type: 'boolean',
          title: 'Skip MEGAHIT',
          description: 'Skip MEGAHIT assembler',
          default: false,
        },
        skipSpades: {
          type: 'boolean',
          title: 'Skip SPAdes',
          description: 'Skip SPAdes assembler (enabled by default)',
          default: true,
        },
        skipProkka: {
          type: 'boolean',
          title: 'Skip Prokka',
          description: 'Skip annotation',
          default: true,
        },
        skipBinQc: {
          type: 'boolean',
          title: 'Skip Bin QC',
          description: 'Skip bin quality control',
          default: false,
        },
        skipQuast: {
          type: 'boolean',
          title: 'Skip QUAST',
          description: 'Skip QUAST bin summary (auto-skipped when Bin QC is skipped)',
          default: false,
        },
        skipGtdb: {
          type: 'boolean',
          title: 'Skip GTDB-Tk',
          description: 'Skip GTDB-Tk classification and database download',
          default: false,
        },
        gtdbDb: {
          type: 'string',
          title: 'GTDB-Tk Database Path',
          description: 'Path to a GTDB-Tk database directory or .tar.gz archive (optional)',
          default: '',
        },
      },
    },

    defaultConfig: {
      stubMode: false,
      skipMegahit: false,
      skipSpades: true,
      skipProkka: true,
      skipBinQc: false,
      skipQuast: false,
      skipGtdb: false,
      gtdbDb: '',
    },

    icon: 'Dna',
  },

  // Future pipelines can be added here:
  // fastqc: { ... },
  // submg: { ... },
};

// Get pipeline definition by ID
export function getPipelineDefinition(pipelineId: string): PipelineDefinition | undefined {
  return PIPELINE_REGISTRY[pipelineId];
}

// Get all enabled pipelines (based on PipelineConfig in database)
export function getAllPipelineIds(): string[] {
  return Object.keys(PIPELINE_REGISTRY);
}

// Check if a pipeline can run on a study
export function canRunPipeline(
  pipelineId: string,
  study: {
    samples: Array<{
      reads: Array<{ file1: string | null; file2: string | null }>;
      assemblies: Array<{ id: string }>;
      bins: Array<{ id: string }>;
    }>;
    studyAccessionId: string | null;
  }
): { canRun: boolean; issues: string[] } {
  const pipeline = PIPELINE_REGISTRY[pipelineId];
  if (!pipeline) {
    return { canRun: false, issues: ['Pipeline not found'] };
  }

  const issues: string[] = [];

  // Check sample count
  if (pipeline.input.minSamples && study.samples.length < pipeline.input.minSamples) {
    issues.push(`Requires at least ${pipeline.input.minSamples} sample(s)`);
  }
  if (pipeline.input.maxSamples && study.samples.length > pipeline.input.maxSamples) {
    issues.push(`Maximum ${pipeline.input.maxSamples} sample(s) allowed`);
  }

  // Check requirements
  if (pipeline.requires.studyAccession && !study.studyAccessionId) {
    issues.push('Study must have an ENA accession number');
  }

  // Check per-sample requirements
  for (const sample of study.samples) {
    if (pipeline.input.perSample.reads) {
      const hasReads = sample.reads.some(r => r.file1);
      if (!hasReads) {
        issues.push('All samples must have reads assigned');
        break;
      }
    }

    if (pipeline.input.perSample.pairedEnd) {
      const hasPairedReads = sample.reads.some(r => r.file1 && r.file2);
      if (!hasPairedReads) {
        issues.push('All samples must have paired-end reads');
        break;
      }
    }

    if (pipeline.input.perSample.assemblies) {
      if (sample.assemblies.length === 0) {
        issues.push('All samples must have assemblies');
        break;
      }
    }

    if (pipeline.input.perSample.bins) {
      if (sample.bins.length === 0) {
        issues.push('All samples must have bins');
        break;
      }
    }
  }

  if (pipeline.requires.reads) {
    const anyReads = study.samples.some(s => s.reads.some(r => r.file1));
    if (!anyReads) {
      issues.push('Study must have samples with reads');
    }
  }

  if (pipeline.requires.assemblies) {
    const anyAssemblies = study.samples.some(s => s.assemblies.length > 0);
    if (!anyAssemblies) {
      issues.push('Study must have samples with assemblies');
    }
  }

  return {
    canRun: issues.length === 0,
    issues,
  };
}
