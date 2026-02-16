// Pipeline Metadata Validation
// Checks if required metadata is present before running pipelines

import { db } from '@/lib/db';
import { resolveAssemblySelection } from '@/lib/pipelines/assembly-selection';

export interface MetadataIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
  fixUrl?: string;
}

export interface MetadataValidationResult {
  valid: boolean;
  issues: MetadataIssue[];
  metadata: {
    platform?: string;
    instrumentModel?: string;
    libraryStrategy?: string;
  };
}

// Define what metadata each pipeline requires
const PIPELINE_REQUIREMENTS: Record<string, {
  required: string[];
  optional: string[];
  platformMapping?: Record<string, string>;
}> = {
  mag: {
    required: ['platform'],
    optional: ['instrumentModel', 'libraryStrategy'],
  },
  submg: {
    required: ['studyAccession', 'sampleMetadata', 'taxId', 'checksums', 'assemblies'],
    optional: ['bins'],
  },
};

const MAG_SHORT_READ_PLATFORM_OPTIONS = [
  'ILLUMINA',
  'BGISEQ',
  'LS454',
  'ION_TORRENT',
  'DNBSEQ',
  'ELEMENT',
  'ULTIMA',
  'VELA_DIAGNOSTICS',
  'GENAPSYS',
  'GENEMIND',
  'TAPESTRI',
];

const MAG_SHORT_READ_PLATFORM_MAPPING: Record<string, string> = {
  // Standard form values (from prisma/seed.mjs)
  'illumina': 'ILLUMINA',
  'ion_torrent': 'ION_TORRENT',
  'bgi': 'BGISEQ',
  'bgiseq': 'BGISEQ',
  'dnbseq': 'DNBSEQ',
  // Common variations
  'hiseq': 'ILLUMINA',
  'miseq': 'ILLUMINA',
  'novaseq': 'ILLUMINA',
  'nextseq': 'ILLUMINA',
  'ls454': 'LS454',
  '454': 'LS454',
  'element': 'ELEMENT',
  'ultima': 'ULTIMA',
  'vela_diagnostics': 'VELA_DIAGNOSTICS',
  'genapsys': 'GENAPSYS',
  'genemind': 'GENEMIND',
  'tapestri': 'TAPESTRI',
};

const MAG_LONG_READ_PLATFORM_MATCHES = [
  'oxford_nanopore',
  'nanopore',
  'ont',
  'minion',
  'gridion',
  'promethion',
  'pacbio',
  'pacbio_smrt',
  'sequel',
  'revio',
];

function isLongReadPlatform(value: string): boolean {
  return MAG_LONG_READ_PLATFORM_MATCHES.some((entry) => value.includes(entry));
}

/**
 * Validate that a study has all required metadata for a specific pipeline
 */
export async function validatePipelineMetadata(
  studyId: string,
  pipelineId: string
): Promise<MetadataValidationResult> {
  const issues: MetadataIssue[] = [];
  const metadata: MetadataValidationResult['metadata'] = {};

  // Get study with samples and their orders
  const study = await db.study.findUnique({
    where: { id: studyId },
    include: {
      samples: {
        include: {
          reads: {
            select: {
              file1: true,
              file2: true,
              checksum1: true,
              checksum2: true,
            },
          },
          assemblies: {
            select: {
              id: true,
              assemblyFile: true,
              createdByPipelineRunId: true,
              createdByPipelineRun: {
                select: {
                  id: true,
                  runNumber: true,
                  createdAt: true,
                },
              },
            },
          },
          bins: {
            select: { id: true },
          },
          order: {
            select: {
              id: true,
              platform: true,
              instrumentModel: true,
              libraryStrategy: true,
              librarySelection: true,
              librarySource: true,
            },
          },
        },
      },
    },
  });

  if (!study) {
    return {
      valid: false,
      issues: [{ field: 'study', message: 'Study not found', severity: 'error' }],
      metadata,
    };
  }

  if (study.samples.length === 0) {
    return {
      valid: false,
      issues: [{ field: 'samples', message: 'No samples in study', severity: 'error' }],
      metadata,
    };
  }

  // Get pipeline requirements
  const requirements = PIPELINE_REQUIREMENTS[pipelineId];
  if (!requirements) {
    // No specific requirements defined, assume valid
    return { valid: true, issues: [], metadata };
  }

  if (pipelineId === 'submg') {
    if (!study.studyAccessionId) {
      issues.push({
        field: 'studyAccessionId',
        message: 'Study must have an ENA accession (PRJ*) before SubMG submission',
        severity: 'error',
      });
    }

    for (const sample of study.samples) {
      if (!sample.checklistData) {
        issues.push({
          field: 'checklistData',
          message: `Sample ${sample.sampleId} is missing metadata (checklist data)`,
          severity: 'error',
        });
      }

      if (!sample.taxId) {
        issues.push({
          field: 'taxId',
          message: `Sample ${sample.sampleId} is missing TAX_ID`,
          severity: 'error',
        });
      }

      const pairedReads = sample.reads.filter((read) => Boolean(read.file1 && read.file2));
      if (pairedReads.length === 0) {
        issues.push({
          field: 'reads',
          message: `Sample ${sample.sampleId} is missing paired-end read files`,
          severity: 'error',
        });
      } else if (pairedReads.some((read) => !read.checksum1 || !read.checksum2)) {
        issues.push({
          field: 'checksums',
          message: `Sample ${sample.sampleId} has paired reads without MD5 checksums`,
          severity: 'error',
        });
      }

      const selectedAssembly = resolveAssemblySelection(sample, {
        strictPreferred: true,
      }).assembly;
      if (!selectedAssembly?.assemblyFile) {
        issues.push({
          field: 'assemblies',
          message: sample.preferredAssemblyId
            ? `Sample ${sample.sampleId} has an invalid preferred assembly selection (update it in Study Pipelines)`
            : `Sample ${sample.sampleId} has no assembly file`,
          severity: 'error',
        });
      }

      if (sample.bins.length === 0) {
        issues.push({
          field: 'bins',
          message: `Sample ${sample.sampleId} has no bins (optional, but recommended)`,
          severity: 'warning',
        });
      }
    }

    return {
      valid: issues.filter((issue) => issue.severity === 'error').length === 0,
      issues,
      metadata,
    };
  }

  // Collect metadata from all orders
  const orders = new Map<string, typeof study.samples[0]['order']>();
  for (const sample of study.samples) {
    if (sample.order) {
      orders.set(sample.order.id, sample.order);
    }
  }

  // Check if any order has platform info
  let hasValidPlatform = false;
  let platformValue: string | undefined;
  let hasLongReadPlatform = false;

  for (const order of orders.values()) {
    if (order.platform) {
      platformValue = order.platform;
      metadata.platform = order.platform;
      metadata.instrumentModel = order.instrumentModel || undefined;
      metadata.libraryStrategy = order.libraryStrategy || undefined;

      const mappedPlatform = mapPlatformForPipeline(order.platform, pipelineId);
      if (mappedPlatform) {
        hasValidPlatform = true;
        break;
      }

      const normalizedPlatform = order.platform.toLowerCase().trim().replace(/[_\s-]+/g, '_');
      if (isLongReadPlatform(normalizedPlatform)) {
        hasLongReadPlatform = true;
      }
    }
  }

  // Check required fields
  if (requirements.required.includes('platform')) {
    if (!platformValue) {
      issues.push({
        field: 'platform',
        message: 'Sequencing platform is required for this pipeline',
        severity: 'error',
        fixUrl: orders.size > 0
          ? `/dashboard/orders/${Array.from(orders.keys())[0]}/edit`
          : undefined,
      });
    } else if (!hasValidPlatform) {
      issues.push({
        field: 'platform',
        message: hasLongReadPlatform
          ? `Platform "${platformValue}" indicates long-read data. MAG currently expects short reads with one of: ${MAG_SHORT_READ_PLATFORM_OPTIONS.join(', ')}.`
          : `Platform "${platformValue}" not recognized. Expected one of: ${MAG_SHORT_READ_PLATFORM_OPTIONS.join(', ')}.`,
        severity: 'error',
        fixUrl: orders.size > 0
          ? `/dashboard/orders/${Array.from(orders.keys())[0]}/edit`
          : undefined,
      });
    }
  }

  return {
    valid: issues.filter(i => i.severity === 'error').length === 0,
    issues,
    metadata,
  };
}

/**
 * Get the platform value for nf-core samplesheet from order metadata
 */
export function mapPlatformForPipeline(
  platform: string | undefined | null,
  pipelineId: string
): string | null {
  if (!platform) return null;

  if (pipelineId === 'mag') {
    const normalizedPlatform = platform.toLowerCase().trim().replace(/[_\s-]+/g, '_');

    if (isLongReadPlatform(normalizedPlatform)) {
      return null;
    }

    if (MAG_SHORT_READ_PLATFORM_MAPPING[normalizedPlatform]) {
      return MAG_SHORT_READ_PLATFORM_MAPPING[normalizedPlatform];
    }

    for (const [key, value] of Object.entries(MAG_SHORT_READ_PLATFORM_MAPPING)) {
      if (normalizedPlatform.includes(key) || key.includes(normalizedPlatform)) {
        return value;
      }
    }

    return null;
  }

  return platform;
}
