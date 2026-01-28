/**
 * Generic Samplesheet Generator
 *
 * Generates pipeline samplesheets based on declarative configuration.
 * Uses package-based YAML config (pipelines/<id>/samplesheet.yaml).
 *
 * This allows new pipelines to define their samplesheet format declaratively
 * without writing custom TypeScript code.
 *
 * Usage:
 *   const generator = new SamplesheetGenerator('mag');
 *   const result = await generator.generate({ studyId, dataBasePath });
 */

import { db } from '@/lib/db';
import { getPackageSamplesheet, type SamplesheetConfig as PackageSamplesheetConfig } from './package-loader';
import path from 'path';

type PackageSamplesheet = PackageSamplesheetConfig['samplesheet'];
type PackageColumn = PackageSamplesheet['columns'][number];

export interface GenerateOptions {
  studyId: string;
  sampleIds?: string[];
  dataBasePath: string;
}

export interface GenerateResult {
  content: string;
  sampleCount: number;
  errors: string[];
  warnings: string[];
}

/**
 * Resolve a source path like "read.file1" or "sample.reads[paired].file1" to actual data
 */
function selectRead(
  reads: Array<{ file1: string | null; file2: string | null }>,
  filters?: Record<string, unknown>
): { file1: string | null; file2: string | null } | null {
  const paired = typeof filters?.paired === 'boolean' ? filters.paired : undefined;

  if (paired === true) {
    return reads.find(r => r.file1 && r.file2) || null;
  }

  if (paired === false) {
    return reads.find(r => r.file1 && !r.file2) || null;
  }

  return reads.find(r => r.file1) || null;
}

function resolveSource(
  column: PackageColumn,
  context: {
    sample: {
      sampleId: string;
      reads: Array<{ file1: string | null; file2: string | null }>;
    };
    study: { id: string; title?: string };
    order: { platform?: string | null } | null;
    dataBasePath: string;
  }
): string | null {
  const { sample, study, order } = context;
  const source = column.source;

  if (!source) return null;

  // Parse the source path
  if (source === 'sample.sampleId') {
    return sample.sampleId;
  }

  if (source === 'study.id') {
    return study.id;
  }

  if (source === 'study.title') {
    return study.title || study.id;
  }

  if (source === 'order.platform') {
    return order?.platform || null;
  }

  // Handle reads with filters like "read.file1" + filters
  if (source.startsWith('read.')) {
    const field = source.split('.')[1];
    const matchingRead = selectRead(sample.reads, column.filters);
    if (!matchingRead) return null;
    const value = field === 'file1' ? matchingRead.file1 : matchingRead.file2;
    return value || null;
  }

  // Legacy-style sources like "sample.reads[paired].file1"
  const readsMatch = source.match(/^sample\.reads\[(\w+)\]\.(\w+)$/);
  if (readsMatch) {
    const [, filter, field] = readsMatch;
    const matchingRead = selectRead(sample.reads, { paired: filter === 'paired' ? true : filter === 'single' ? false : undefined });
    if (!matchingRead) return null;
    const value = field === 'file1' ? matchingRead.file1 : matchingRead.file2;
    return value || null;
  }

  return null;
}

/**
 * Apply a transform to a value
 */
function applyTransform(
  value: string | null,
  transform: PackageColumn['transform'] | undefined,
  dataBasePath: string
): string | null {
  if (!value || !transform) return value;

  switch (transform.type) {
    case 'map_value': {
      const mapping = transform.mapping || {};
      return mapping[value] ?? mapping[value.toLowerCase()] ?? mapping[value.toUpperCase()] ?? value;
    }
    case 'to_upper':
      return value.toUpperCase();
    case 'to_lower':
      return value.toLowerCase();
    case 'prepend_path': {
      const base = (transform.base || '').replace('${DATA_BASE_PATH}', dataBasePath);
      return base ? path.join(base, value) : value;
    }
    default:
      return value;
  }
}

/**
 * Generic samplesheet generator based on pipeline definition
 */
export class SamplesheetGenerator {
  private pipelineId: string;
  private config: PackageSamplesheetConfig | null = null;

  constructor(pipelineId: string) {
    this.pipelineId = pipelineId;
    this.loadConfig();
  }

  private loadConfig(): void {
    this.config = getPackageSamplesheet(this.pipelineId);
  }

  /**
   * Check if this pipeline has a samplesheet configuration
   */
  hasConfig(): boolean {
    return !!this.config?.samplesheet?.columns?.length;
  }

  /**
   * Get the samplesheet configuration
   */
  getConfig(): PackageSamplesheetConfig | null {
    return this.config;
  }

  /**
   * Generate the samplesheet CSV content
   */
  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const { studyId, sampleIds, dataBasePath } = options;
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!this.config) {
      errors.push(`No samplesheet configuration found for pipeline: ${this.pipelineId}`);
      return { content: '', sampleCount: 0, errors, warnings };
    }

    const sheet = this.config.samplesheet;

    // Fetch samples with related data
    const whereClause: { studyId: string; id?: { in: string[] } } = { studyId };
    if (sampleIds && sampleIds.length > 0) {
      whereClause.id = { in: sampleIds };
    }

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
      return { content: '', sampleCount: 0, errors, warnings };
    }

    // Get study info
    const study = await db.study.findUnique({
      where: { id: studyId },
      select: { id: true, title: true },
    });

    if (!study) {
      errors.push('Study not found');
      return { content: '', sampleCount: 0, errors, warnings };
    }

    // Generate rows
    const rows: string[][] = [];

    for (const sample of samples) {
      const context = {
        sample: {
          sampleId: sample.sampleId,
          reads: sample.reads.map(r => ({
            file1: r.file1,
            file2: r.file2,
          })),
        },
        study,
        order: sample.order,
        dataBasePath,
      };

      // Build row values
      const row: string[] = [];
      let skipSample = false;

      for (const column of sheet.columns) {
        let value = resolveSource(column, context);

        // Apply transform
        value = applyTransform(value, column.transform, dataBasePath);

        // Handle required/default
        if (value === null) {
          if (column.required) {
            errors.push(`Sample ${sample.sampleId}: Missing required value for column '${column.name}'`);
            skipSample = true;
            break;
          }
          value = column.default ?? '';
        }

        row.push(value);
      }

      if (!skipSample) {
        rows.push(row);
      }
    }

    if (rows.length === 0) {
      errors.push('No samples with valid data for samplesheet');
      return { content: '', sampleCount: 0, errors, warnings };
    }

    // Build CSV content
    const delimiter = sheet.format === 'tsv' ? '\t' : ',';
    const header = sheet.columns.map(c => c.name).join(delimiter);
    const dataRows = rows.map(row => row.join(delimiter));
    const content = [header, ...dataRows].join('\n');

    return {
      content,
      sampleCount: rows.length,
      errors,
      warnings,
    };
  }

  /**
   * Get a human-readable description of the samplesheet format
   */
  describeFormat(): string {
    if (!this.config) {
      return 'No samplesheet configuration available';
    }

    const lines = ['Samplesheet columns:'];
    for (const col of this.config.samplesheet.columns) {
      const reqStr = col.required ? ' (required)' : '';
      const defaultStr = col.default !== undefined ? ` [default: "${col.default}"]` : '';
      const source = col.source ?? 'manual';
      lines.push(`  - ${col.name}: ${col.description || source}${reqStr}${defaultStr}`);
    }

    return lines.join('\n');
  }
}

/**
 * Helper to check if a pipeline has a samplesheet configuration
 */
export function hasSamplesheetConfig(pipelineId: string): boolean {
  const generator = new SamplesheetGenerator(pipelineId);
  return generator.hasConfig();
}

/**
 * Generate samplesheet using declarative config (if available)
 * Falls back to false if no config exists
 */
export async function generateSamplesheetFromConfig(
  pipelineId: string,
  options: GenerateOptions
): Promise<GenerateResult | null> {
  const generator = new SamplesheetGenerator(pipelineId);
  if (!generator.hasConfig()) {
    return null; // Caller should use pipeline-specific adapter
  }
  return generator.generate(options);
}
