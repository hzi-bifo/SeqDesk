// MAG Pipeline Adapter
// Implements the PipelineAdapter interface for nf-core/mag
//
// This adapter uses a hybrid approach:
// - Samplesheet generation: uses declarative config from samplesheet.yaml (via SamplesheetGenerator)
// - Output discovery: uses custom code (file patterns vary between nf-core versions)
//
// For new pipelines, prefer defining samplesheet.columns in the JSON definition
// and only write custom code for output discovery.

import path from 'path';
import fs from 'fs/promises';
import { db } from '@/lib/db';
import { mapPlatformForPipeline } from '../metadata-validation';
import { generateSamplesheetFromConfig } from '../samplesheet-generator';
import {
  PipelineAdapter,
  ValidationResult,
  SamplesheetResult,
  SamplesheetOptions,
  DiscoverOutputsResult,
  DiscoverOutputsOptions,
  DiscoveredFile,
  registerAdapter,
} from './types';

/**
 * Parse CheckM summary TSV file for bin quality metrics
 */
async function parseCheckmSummary(
  checkmPath: string
): Promise<Map<string, { completeness: number; contamination: number }>> {
  const metrics = new Map<string, { completeness: number; contamination: number }>();

  try {
    const content = await fs.readFile(checkmPath, 'utf-8');
    const lines = content.trim().split('\n');

    // Skip header
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split('\t');
      if (cols.length >= 3) {
        const binName = cols[0];
        const completeness = parseFloat(cols[1]) || 0;
        const contamination = parseFloat(cols[2]) || 0;
        metrics.set(binName, { completeness, contamination });
      }
    }
  } catch {
    // File may not exist or be readable
  }

  return metrics;
}

/**
 * Find assembly files in MAG output
 * Checks multiple assembler output directories (MEGAHIT, SPAdes)
 * Expected paths:
 *   - Assembly/MEGAHIT/MEGAHIT-{sample}.contigs.fa.gz
 *   - Assembly/SPAdes/SPAdes-{sample}.contigs.fa.gz
 */
async function findAssemblyFiles(
  outputDir: string,
  sampleId: string
): Promise<string[]> {
  const files: string[] = [];

  // Check multiple assembler directories
  const assemblerDirs = ['MEGAHIT', 'SPAdes', 'MetaSPAdes'];

  for (const assembler of assemblerDirs) {
    const assemblyDir = path.join(outputDir, 'Assembly', assembler);

    try {
      const entries = await fs.readdir(assemblyDir);
      for (const entry of entries) {
        // Match patterns like MEGAHIT-sample1.contigs.fa.gz or SPAdes-sample1.contigs.fa.gz
        if (entry.includes(sampleId) && (entry.endsWith('.contigs.fa.gz') || entry.endsWith('.contigs.fa'))) {
          files.push(path.join(assemblyDir, entry));
        }
      }
    } catch {
      // Directory may not exist for this assembler
    }
  }

  return files;
}

/**
 * Find bin files in MAG output
 * Checks multiple binning tools and DAS Tool refined bins
 * Expected paths:
 *   - GenomeBinning/MaxBin2/Assembly_[n]/MEGAHIT-MaxBin2-[sample].[n].fa
 *   - GenomeBinning/MetaBAT2/Assembly_[n]/MEGAHIT-MetaBAT2-[sample].[n].fa
 *   - GenomeBinning/CONCOCT/Assembly_[n]/CONCOCT.[n].fa
 *   - GenomeBinning/DASTool/bins/[sample]_DASTool_bins/[bin].fa (refined - preferred)
 */
async function findBinFiles(
  outputDir: string,
  sampleId: string
): Promise<{ path: string; refined: boolean }[]> {
  const files: { path: string; refined: boolean }[] = [];

  // First, check for DAS Tool refined bins (preferred if available)
  const dasToolBinsDir = path.join(outputDir, 'GenomeBinning', 'DASTool', 'bins');
  try {
    const sampleDirs = await fs.readdir(dasToolBinsDir);
    for (const sampleDir of sampleDirs) {
      if (!sampleDir.includes(sampleId)) continue;

      const fullSampleDir = path.join(dasToolBinsDir, sampleDir);
      try {
        const entries = await fs.readdir(fullSampleDir);
        for (const entry of entries) {
          if (entry.endsWith('.fa') || entry.endsWith('.fasta')) {
            files.push({ path: path.join(fullSampleDir, entry), refined: true });
          }
        }
      } catch {
        // Sub-directory read failed
      }
    }
  } catch {
    // DAS Tool directory doesn't exist
  }

  // If we found refined bins, return those (preferred)
  if (files.length > 0) {
    return files;
  }

  // Otherwise, check individual binner outputs
  const binners = ['MaxBin2', 'MetaBAT2', 'CONCOCT'];

  for (const binner of binners) {
    const binDir = path.join(outputDir, 'GenomeBinning', binner);

    try {
      const assemblyDirs = await fs.readdir(binDir);

      for (const assemblyDir of assemblyDirs) {
        if (!assemblyDir.startsWith('Assembly_')) continue;

        const fullAssemblyDir = path.join(binDir, assemblyDir);
        try {
          const entries = await fs.readdir(fullAssemblyDir);

          for (const entry of entries) {
            // Match patterns for this binner
            if ((entry.includes(sampleId) || binner === 'CONCOCT') &&
                (entry.endsWith('.fa') || entry.endsWith('.fasta'))) {
              files.push({ path: path.join(fullAssemblyDir, entry), refined: false });
            }
          }
        } catch {
          // Sub-directory read failed
        }
      }
    } catch {
      // Binner directory doesn't exist
    }
  }

  return files;
}

/**
 * Find alignment files (BAM) in MAG output
 */
async function findAlignmentFiles(
  outputDir: string,
  sampleId: string
): Promise<string[]> {
  const files: string[] = [];

  const possiblePaths = [
    path.join(outputDir, `${sampleId}.sorted.bam`),
    path.join(outputDir, 'Alignment', `${sampleId}.sorted.bam`),
  ];

  for (const p of possiblePaths) {
    try {
      await fs.access(p);
      files.push(p);
    } catch {
      // File doesn't exist at this path
    }
  }

  return files;
}

/**
 * Find MultiQC report
 */
async function findMultiQCReport(outputDir: string): Promise<string | null> {
  const possiblePaths = [
    path.join(outputDir, 'multiqc', 'multiqc_report.html'),
    path.join(outputDir, 'MultiQC', 'multiqc_report.html'),
  ];

  for (const p of possiblePaths) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // File doesn't exist
    }
  }

  return null;
}

/**
 * MAG Pipeline Adapter Implementation
 */
export const magAdapter: PipelineAdapter = {
  pipelineId: 'mag',

  async validateInputs(
    studyId: string,
    sampleIds?: string[]
  ): Promise<ValidationResult> {
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
  },

  async generateSamplesheet(
    options: SamplesheetOptions
  ): Promise<SamplesheetResult> {
    // Try using the declarative config from samplesheet.yaml first
    const configResult = await generateSamplesheetFromConfig('mag', {
      studyId: options.studyId,
      sampleIds: options.sampleIds,
      dataBasePath: options.dataBasePath,
    });

    if (configResult) {
      // Declarative config worked - return its result
      return {
        content: configResult.content,
        sampleCount: configResult.sampleCount,
        errors: configResult.errors,
      };
    }

    // Fallback to custom code if no config or config failed
    // (This code is kept for backwards compatibility)
    const { studyId, sampleIds, dataBasePath } = options;
    const errors: string[] = [];

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
      return { content: '', sampleCount: 0, errors };
    }

    interface SamplesheetRow {
      sample: string;
      group: string;
      short_reads_1: string;
      short_reads_2: string;
      short_reads_platform: string;
      long_reads: string;
    }

    const rows: SamplesheetRow[] = [];

    for (const sample of samples) {
      const pairedRead = sample.reads.find(r => r.file1 && r.file2);

      if (!pairedRead) {
        errors.push(`Sample ${sample.sampleId}: No paired-end reads found`);
        continue;
      }

      const r1Path = path.join(dataBasePath, pairedRead.file1!);
      const r2Path = path.join(dataBasePath, pairedRead.file2!);
      const group = studyId;

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
        long_reads: '',
      });
    }

    if (rows.length === 0) {
      errors.push('No samples with valid paired-end reads');
      return { content: '', sampleCount: 0, errors };
    }

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
  },

  async discoverOutputs(
    options: DiscoverOutputsOptions
  ): Promise<DiscoverOutputsResult> {
    const { outputDir, samples } = options;
    const files: DiscoveredFile[] = [];
    const errors: string[] = [];

    let assembliesFound = 0;
    let binsFound = 0;
    let artifactsFound = 0;
    let reportsFound = 0;

    // Load CheckM metrics for bin quality
    const checkmPath = path.join(outputDir, 'GenomeBinning', 'QC', 'checkm_summary.tsv');
    const checkmMetrics = await parseCheckmSummary(checkmPath);

    // Process each sample
    for (const sample of samples) {
      // Find assemblies
      const assemblyFiles = await findAssemblyFiles(outputDir, sample.sampleId);
      for (const assemblyFile of assemblyFiles) {
        files.push({
          type: 'assembly',
          name: path.basename(assemblyFile),
          path: assemblyFile,
          sampleId: sample.id,
          sampleName: sample.sampleId,
          fromStep: 'assembly',
          outputId: 'assemblies',
        });
        assembliesFound++;
      }

      // Find bins
      const binFiles = await findBinFiles(outputDir, sample.sampleId);
      for (const binFile of binFiles) {
        const binName = path.basename(binFile.path);
        const metrics = checkmMetrics.get(binName);

        files.push({
          type: 'bin',
          name: binName,
          path: binFile.path,
          sampleId: sample.id,
          sampleName: sample.sampleId,
          fromStep: binFile.refined ? 'bin_refinement' : 'binning',
          outputId: 'bins',
          metadata: {
            ...(metrics ? {
              completeness: metrics.completeness,
              contamination: metrics.contamination,
            } : {}),
            refined: binFile.refined,
          },
        });
        binsFound++;
      }

      // Find alignment files
      const alignmentFiles = await findAlignmentFiles(outputDir, sample.sampleId);
      for (const alignmentFile of alignmentFiles) {
        files.push({
          type: 'artifact',
          name: path.basename(alignmentFile),
          path: alignmentFile,
          sampleId: sample.id,
          sampleName: sample.sampleId,
          fromStep: 'binning_prep',
        });
        artifactsFound++;
      }
    }

    // Find MultiQC report (not sample-specific)
    const multiqcReport = await findMultiQCReport(outputDir);
    if (multiqcReport) {
      files.push({
        type: 'report',
        name: 'multiqc_report.html',
        path: multiqcReport,
        fromStep: 'multiqc',
        outputId: 'multiqc_report',
      });
      reportsFound++;
    }

    return {
      files,
      errors,
      summary: {
        assembliesFound,
        binsFound,
        artifactsFound,
        reportsFound,
      },
    };
  },
};

// Register the adapter
registerAdapter(magAdapter);
