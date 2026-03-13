// Pipeline Metadata Validation
// Checks if required metadata is present before running pipelines

import { db } from '@/lib/db';
import { resolveAssemblySelection } from '@/lib/pipelines/assembly-selection';
import { getPackage } from '@/lib/pipelines/package-loader';
import {
  resolveOrderPlatform,
  resolveOrderSequencingTechnologyId,
} from '@/lib/pipelines/order-platform';
import type { PipelineTarget } from '@/lib/pipelines/types';
import { isOrderTarget, isStudyTarget } from '@/lib/pipelines/target';

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

interface SubmgRequiredSampleField {
  label: string;
  aliases: string[];
}

const SUBMG_REQUIRED_SAMPLE_METADATA_FIELDS: SubmgRequiredSampleField[] = [
  {
    label: 'collection date',
    aliases: ['collection date', 'collection_date'],
  },
  {
    label: 'geographic location (country and/or sea)',
    aliases: [
      'geographic location (country and/or sea)',
      'geographic_location',
      'geographic location',
    ],
  },
];

const TEST_STUDY_ACCESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type RunAtMode = 'all' | 'selected-technologies';

interface PipelineRuntimeConfig {
  runAt: RunAtMode;
  allowedSequencingTechnologies: string[];
}

const DEFAULT_PIPELINE_RUNTIME_CONFIG: PipelineRuntimeConfig = {
  runAt: 'all',
  allowedSequencingTechnologies: [],
};

function parsePipelineRuntimeConfig(
  rawConfig: string | null | undefined
): PipelineRuntimeConfig {
  if (!rawConfig) return { ...DEFAULT_PIPELINE_RUNTIME_CONFIG };

  try {
    const parsed = JSON.parse(rawConfig) as {
      runAt?: unknown;
      allowedSequencingTechnologies?: unknown;
    };
    const runAt =
      parsed.runAt === 'selected-technologies' ? 'selected-technologies' : 'all';
    const allowedSequencingTechnologies = Array.isArray(parsed.allowedSequencingTechnologies)
      ? parsed.allowedSequencingTechnologies
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
      : [];

    return {
      runAt,
      allowedSequencingTechnologies,
    };
  } catch {
    return { ...DEFAULT_PIPELINE_RUNTIME_CONFIG };
  }
}

function isLongReadPlatform(value: string): boolean {
  return MAG_LONG_READ_PLATFORM_MATCHES.some((entry) => value.includes(entry));
}

function normalizeChecklistFieldKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^mixs\s+/, '');
}

function hasChecklistValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => hasChecklistValue(entry));
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferredKeys = ['value', 'label', 'name', 'text'];
    for (const key of preferredKeys) {
      if (hasChecklistValue(record[key])) return true;
    }
    return Object.values(record).some((entry) => hasChecklistValue(entry));
  }

  return false;
}

function extractChecklistFieldSet(rawChecklistData: string | null): Set<string> {
  const fields = new Set<string>();
  if (!rawChecklistData) return fields;

  try {
    const parsed = JSON.parse(rawChecklistData) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (hasChecklistValue(value)) {
        fields.add(normalizeChecklistFieldKey(key));
      }
    }
  } catch {
    // Ignore malformed checklist JSON here; existing "checklistData missing" checks cover this path.
  }

  return fields;
}

function hasRequiredChecklistField(
  checklistFieldSet: Set<string>,
  requiredField: SubmgRequiredSampleField
): boolean {
  return requiredField.aliases.some((alias) =>
    checklistFieldSet.has(normalizeChecklistFieldKey(alias))
  );
}

/**
 * Validate that a study has all required metadata for a specific pipeline
 */
function normalizeValidationTarget(
  targetOrStudyId: PipelineTarget | string,
  sampleIds?: string[]
): PipelineTarget {
  if (typeof targetOrStudyId === 'string') {
    return { type: 'study', studyId: targetOrStudyId, sampleIds };
  }

  if (sampleIds && (!targetOrStudyId.sampleIds || targetOrStudyId.sampleIds.length === 0)) {
    return {
      ...targetOrStudyId,
      sampleIds,
    };
  }

  return targetOrStudyId;
}

export async function validatePipelineMetadata(
  targetOrStudyId: PipelineTarget | string,
  pipelineId: string,
  sampleIds?: string[]
): Promise<MetadataValidationResult> {
  const target = normalizeValidationTarget(targetOrStudyId, sampleIds);
  const issues: MetadataIssue[] = [];
  const metadata: MetadataValidationResult['metadata'] = {};
  const sampleFilter =
    Array.isArray(target.sampleIds) && target.sampleIds.length > 0
      ? { id: { in: target.sampleIds } }
      : undefined;

  const runtimeConfig = parsePipelineRuntimeConfig(
    (
      await db.pipelineConfig.findUnique({
        where: { pipelineId },
        select: { config: true },
      })
    )?.config ?? null
  );

  const sampleInclude = {
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
        customFields: true,
        instrumentModel: true,
        libraryStrategy: true,
        librarySelection: true,
        librarySource: true,
      },
    },
  } as const;

  const [study, order] = await Promise.all([
    isStudyTarget(target)
      ? db.study.findUnique({
          where: { id: target.studyId },
          include: {
            samples: {
              ...(sampleFilter ? { where: sampleFilter } : {}),
              include: sampleInclude,
            },
          },
        })
      : Promise.resolve(null),
    isOrderTarget(target)
      ? db.order.findUnique({
          where: { id: target.orderId },
          include: {
            samples: {
              ...(sampleFilter ? { where: sampleFilter } : {}),
              include: sampleInclude,
            },
          },
        })
      : Promise.resolve(null),
  ]);

  if (isStudyTarget(target) && !study) {
    return {
      valid: false,
      issues: [{ field: 'study', message: 'Study not found', severity: 'error' }],
      metadata,
    };
  }

  if (isOrderTarget(target) && !order) {
    return {
      valid: false,
      issues: [{ field: 'order', message: 'Order not found', severity: 'error' }],
      metadata,
    };
  }

  const samples = isStudyTarget(target)
    ? study?.samples ?? []
    : order?.samples ?? [];

  if (samples.length === 0) {
    return {
      valid: false,
      issues: [{
        field: 'samples',
        message: isStudyTarget(target) ? 'No samples in study' : 'No samples in order',
        severity: 'error',
      }],
      metadata,
    };
  }

  if (isOrderTarget(target)) {
    const pkg = getPackage(pipelineId);
    const studyScopedInputs = pkg?.manifest.inputs.filter(
      (input) => input.required && (input.scope === 'study' || input.source.startsWith('study.'))
    ) ?? [];
    if (studyScopedInputs.length > 0) {
      for (const input of studyScopedInputs) {
        issues.push({
          field: input.id,
          message: `${pipelineId.toUpperCase()} requires study-scoped input ${input.source} and cannot run on an order target`,
          severity: 'error',
        });
      }
      return {
        valid: false,
        issues,
        metadata,
      };
    }
  }

  // Collect metadata from all orders (with sample IDs for better error messages)
  const orders = new Map<
    string,
    {
      order: NonNullable<(typeof samples)[number]['order']>;
      sampleIds: string[];
    }
  >();
  const samplesWithoutOrder = new Set<string>();
  for (const sample of samples) {
    if (sample.order) {
      const existing = orders.get(sample.order.id);
      if (existing) {
        existing.sampleIds.push(sample.sampleId);
      } else {
        orders.set(sample.order.id, {
          order: sample.order,
          sampleIds: [sample.sampleId],
        });
      }
    } else {
      samplesWithoutOrder.add(sample.sampleId);
    }
  }

  const restrictedTechnologyIds = new Set(runtimeConfig.allowedSequencingTechnologies);
  const technologyRestrictionActive = restrictedTechnologyIds.size > 0;

  if (technologyRestrictionActive) {
    const disallowedTechnologyIds = new Set<string>();
    let hasMissingTechnologySelection = samplesWithoutOrder.size > 0;

    for (const { order } of orders.values()) {
      const technologyId = resolveOrderSequencingTechnologyId(order);
      if (!technologyId) {
        hasMissingTechnologySelection = true;
        continue;
      }
      if (!restrictedTechnologyIds.has(technologyId)) {
        disallowedTechnologyIds.add(technologyId);
      }
    }

    if (hasMissingTechnologySelection) {
      issues.push({
        field: 'allowedSequencingTechnologies',
        message: `${pipelineId.toUpperCase()} is restricted to selected sequencing technologies in pipeline settings. Some selected samples are missing order/technology selection metadata.`,
        severity: 'error',
      });
    }

    if (disallowedTechnologyIds.size > 0) {
      const used = Array.from(disallowedTechnologyIds).join(', ');
      const allowed = Array.from(restrictedTechnologyIds).join(', ');
      issues.push({
        field: 'allowedSequencingTechnologies',
        message: `${pipelineId.toUpperCase()} is restricted to selected sequencing technologies. Found disallowed technology IDs: ${used}. Allowed: ${allowed}.`,
        severity: 'error',
      });
    }
  }

  // Get pipeline requirements
  const requirements = PIPELINE_REQUIREMENTS[pipelineId] ?? {
    required: [],
    optional: [],
  };

  if (pipelineId === 'submg') {
    if (!study) {
      return {
        valid: false,
        issues: [{
          field: 'study',
          message: 'SubMG can only run on study targets',
          severity: 'error',
        }],
        metadata,
      };
    }

    const enaTestMode =
      (
        await db.siteSettings.findUnique({
          where: { id: 'singleton' },
          select: { enaTestMode: true },
        })
      )?.enaTestMode !== false;

    if (!study.studyAccessionId) {
      issues.push({
        field: 'studyAccessionId',
        message: 'Study must have an ENA accession (PRJ*) before SubMG submission',
        severity: 'error',
      });
    }

    if (enaTestMode) {
      if (!study.testRegisteredAt) {
        issues.push({
          field: 'studyAccessionId',
          message:
            'ENA target is Test server, but this study was not registered on ENA Test. Register the study on Test first (or switch ENA target to Production).',
          severity: 'error',
        });
      } else {
        const registrationAgeMs = Date.now() - new Date(study.testRegisteredAt).getTime();
        if (registrationAgeMs > TEST_STUDY_ACCESSION_MAX_AGE_MS) {
          issues.push({
            field: 'studyAccessionId',
            message: `ENA Test registration is older than 24 hours (${study.testRegisteredAt.toISOString()}) and may be expired. Re-register the study on ENA Test before SubMG submission.`,
            severity: 'error',
          });
        }
      }
    }

    for (const sample of samples) {
      const checklistFieldSet = extractChecklistFieldSet(sample.checklistData);
      const missingChecklistFields = SUBMG_REQUIRED_SAMPLE_METADATA_FIELDS
        .filter((field) => !hasRequiredChecklistField(checklistFieldSet, field))
        .map((field) => field.label);

      if (!sample.checklistData) {
        issues.push({
          field: 'sampleMetadata',
          message: `Sample ${sample.sampleId} is missing required metadata fields for SubMG: ${missingChecklistFields.join(', ')}`,
          severity: 'error',
        });
      } else if (missingChecklistFields.length > 0) {
        issues.push({
          field: 'sampleMetadata',
          message: `Sample ${sample.sampleId} is missing required metadata fields for SubMG: ${missingChecklistFields.join(', ')}`,
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
            ? `Sample ${sample.sampleId} has an invalid preferred assembly selection (update it in Study Analysis)`
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

  let hasAnyResolvedPlatform = false;
  let hasAnyMappedPlatform = false;
  const missingPlatformSamples = new Set<string>();
  const longReadPlatforms = new Set<string>();
  const unsupportedPlatforms = new Set<string>();
  const firstOrderId = Array.from(orders.keys())[0];

  for (const { order, sampleIds: sampleLabels } of orders.values()) {
    const resolvedPlatform = resolveOrderPlatform(order);
    if (!resolvedPlatform) {
      for (const sampleId of sampleLabels) {
        missingPlatformSamples.add(sampleId);
      }
      continue;
    }

    hasAnyResolvedPlatform = true;
    if (!metadata.platform) {
      metadata.platform = resolvedPlatform;
      metadata.instrumentModel = order.instrumentModel || undefined;
      metadata.libraryStrategy = order.libraryStrategy || undefined;
    }

    const mappedPlatform = mapPlatformForPipeline(resolvedPlatform, pipelineId);
    if (mappedPlatform) {
      hasAnyMappedPlatform = true;
      continue;
    }

    const normalizedPlatform = resolvedPlatform.toLowerCase().trim().replace(/[_\s-]+/g, '_');
    if (isLongReadPlatform(normalizedPlatform)) {
      longReadPlatforms.add(resolvedPlatform);
    } else {
      unsupportedPlatforms.add(resolvedPlatform);
    }
  }

  // Check required fields
  if (requirements.required.includes('platform')) {
    if (!hasAnyResolvedPlatform) {
      issues.push({
        field: 'platform',
        message:
          'Sequencing platform is required for this pipeline (set the system "Sequencing Platform" field or select a technology in "Sequencing Technologies").',
        severity: 'error',
        fixUrl: firstOrderId
          ? `/orders/${firstOrderId}/edit`
          : undefined,
      });
    } else {
      const missingSamples = new Set([
        ...Array.from(samplesWithoutOrder),
        ...Array.from(missingPlatformSamples),
      ]);
      if (missingSamples.size > 0) {
        const samples = Array.from(missingSamples).slice(0, 5).join(', ');
        const moreCount = missingSamples.size - Math.min(missingSamples.size, 5);
        issues.push({
          field: 'platform',
          message:
            moreCount > 0
              ? `Some selected samples are missing sequencing platform metadata (${samples}, +${moreCount} more).`
              : `Some selected samples are missing sequencing platform metadata (${samples}).`,
          severity: 'error',
          fixUrl: firstOrderId
            ? `/orders/${firstOrderId}/edit`
            : undefined,
        });
      }

      if (
        !technologyRestrictionActive &&
        (!hasAnyMappedPlatform || longReadPlatforms.size > 0 || unsupportedPlatforms.size > 0)
      ) {
        const longReadList = Array.from(longReadPlatforms);
        const unsupportedList = Array.from(unsupportedPlatforms);
        let message = '';

        if (longReadList.length > 0) {
          message = `Platform(s) ${longReadList.map((value) => `"${value}"`).join(', ')} indicate long-read data. MAG currently expects short reads with one of: ${MAG_SHORT_READ_PLATFORM_OPTIONS.join(', ')}.`;
          if (unsupportedList.length > 0) {
            message += ` Also found unsupported platform(s): ${unsupportedList.map((value) => `"${value}"`).join(', ')}.`;
          }
        } else if (unsupportedList.length > 0) {
          message = `Platform(s) ${unsupportedList.map((value) => `"${value}"`).join(', ')} not recognized. Expected one of: ${MAG_SHORT_READ_PLATFORM_OPTIONS.join(', ')}.`;
        } else {
          message = `Sequencing platform is not recognized. Expected one of: ${MAG_SHORT_READ_PLATFORM_OPTIONS.join(', ')}.`;
        }

        issues.push({
          field: 'platform',
          message,
          severity: 'error',
          fixUrl: firstOrderId
            ? `/orders/${firstOrderId}/edit`
            : undefined,
        });
      }
    }
  }

  if (
    pipelineId === 'mag' &&
    runtimeConfig.runAt === 'selected-technologies' &&
    runtimeConfig.allowedSequencingTechnologies.length === 0
  ) {
    issues.push({
      field: 'allowedSequencingTechnologies',
      message:
        'MAG is configured to run only on selected sequencing technologies, but none are selected in pipeline settings.',
      severity: 'warning',
    });
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
