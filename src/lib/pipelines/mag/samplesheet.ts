// MAG Pipeline Samplesheet Generation
// Generates CSV samplesheet for nf-core/mag

import path from 'path';
import { db } from '@/lib/db';
import { mapPlatformForPipeline } from '../metadata-validation';

interface SamplesheetRow {
  sample: string;
  group: string;
  short_reads_1: string;
  short_reads_2: string;
  short_reads_platform: string;  // Required: 'illumina' or 'nanopore'
  long_reads: string;
}

interface GenerateOptions {
  studyId: string;
  sampleIds?: string[];  // If provided, only include these samples
  dataBasePath: string;  // Base path for sequencing files
}

/**
 * Generate a samplesheet CSV for nf-core/mag pipeline
 *
 * Format:
 * sample,group,short_reads_1,short_reads_2,long_reads
 * sample1,group1,/path/R1.fastq.gz,/path/R2.fastq.gz,
 */
export async function generateMagSamplesheet(
  options: GenerateOptions
): Promise<{ content: string; sampleCount: number; errors: string[] }> {
  const { studyId, sampleIds, dataBasePath } = options;
  const errors: string[] = [];

  // Build sample query
  const whereClause: { studyId: string; id?: { in: string[] } } = { studyId };
  if (sampleIds && sampleIds.length > 0) {
    whereClause.id = { in: sampleIds };
  }

  // Fetch samples with their reads and order platform info
  const samples = await db.sample.findMany({
    where: whereClause,
    include: {
      reads: true,
      order: {
        select: {
          id: true,
          platform: true,
        },
      },
    },
    orderBy: { sampleId: 'asc' },
  });

  if (samples.length === 0) {
    errors.push('No samples found for the specified criteria');
    return { content: '', sampleCount: 0, errors };
  }

  const rows: SamplesheetRow[] = [];

  for (const sample of samples) {
    // Find the first read pair with both R1 and R2
    const pairedRead = sample.reads.find(r => r.file1 && r.file2);

    if (!pairedRead) {
      errors.push(`Sample ${sample.sampleId}: No paired-end reads found`);
      continue;
    }

    // Construct absolute paths
    const r1Path = path.join(dataBasePath, pairedRead.file1!);
    const r2Path = path.join(dataBasePath, pairedRead.file2!);

    // Group by study (all samples in same study get same group)
    const group = studyId;

    // Get platform from order, map to nf-core/mag format
    const platform = mapPlatformForPipeline(sample.order?.platform, 'mag');
    if (!platform) {
      errors.push(`Sample ${sample.sampleId}: Unsupported sequencing platform for short reads`);
      continue;
    }

    rows.push({
      sample: sample.sampleId,
      group,
      short_reads_1: r1Path,
      short_reads_2: r2Path,
      short_reads_platform: platform,
      long_reads: '',  // Not supporting long reads yet
    });
  }

  if (rows.length === 0) {
    errors.push('No samples with valid paired-end reads');
    return { content: '', sampleCount: 0, errors };
  }

  // Generate CSV content (nf-core/mag v3+ requires short_reads_platform)
  const header = 'sample,group,short_reads_1,short_reads_2,short_reads_platform,long_reads';
  const dataRows = rows.map(row =>
    `${row.sample},${row.group},${row.short_reads_1},${row.short_reads_2},${row.short_reads_platform},${row.long_reads}`
  );
  const content = [header, ...dataRows].join('\n');

  return {
    content,
    sampleCount: rows.length,
    errors,
  };
}

/**
 * Validate that all required files exist for MAG pipeline
 */
export async function validateMagInputs(
  studyId: string,
  sampleIds?: string[]
): Promise<{ valid: boolean; issues: string[] }> {
  const issues: string[] = [];

  const whereClause: { studyId: string; id?: { in: string[] } } = { studyId };
  if (sampleIds && sampleIds.length > 0) {
    whereClause.id = { in: sampleIds };
  }

  const samples = await db.sample.findMany({
    where: whereClause,
    include: {
      reads: true,
    },
  });

  if (samples.length === 0) {
    issues.push('No samples found');
    return { valid: false, issues };
  }

  for (const sample of samples) {
    if (sample.reads.length === 0) {
      issues.push(`Sample ${sample.sampleId}: No reads assigned`);
      continue;
    }

    const pairedRead = sample.reads.find(r => r.file1 && r.file2);
    if (!pairedRead) {
      issues.push(`Sample ${sample.sampleId}: No paired-end reads (R1+R2) found`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
