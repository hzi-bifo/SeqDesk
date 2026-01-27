// MAG Pipeline Results Parser
// Parses outputs from nf-core/mag and creates database records

import { db } from '@/lib/db';
import path from 'path';
import fs from 'fs/promises';

interface Sample {
  id: string;
  sampleId: string;
}

interface ParseOptions {
  runId: string;
  outputDir: string;
  samples: Sample[];
}

interface ParseResult {
  success: boolean;
  assembliesCreated: number;
  binsCreated: number;
  errors: string[];
}

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
 *
 * Expected path: Assembly/MEGAHIT/MEGAHIT-{sample}.contigs.fa.gz
 */
async function findAssemblyFiles(
  outputDir: string,
  sampleId: string
): Promise<string[]> {
  const assemblyDir = path.join(outputDir, 'Assembly', 'MEGAHIT');
  const files: string[] = [];

  try {
    const entries = await fs.readdir(assemblyDir);
    for (const entry of entries) {
      // Match patterns like MEGAHIT-sample1.contigs.fa.gz
      if (entry.includes(sampleId) && entry.endsWith('.contigs.fa.gz')) {
        files.push(path.join(assemblyDir, entry));
      }
    }
  } catch {
    // Directory may not exist
  }

  return files;
}

/**
 * Find bin files in MAG output
 *
 * Expected path: GenomeBinning/MaxBin2/Assembly_[n]/MEGAHIT-MaxBin2-[sample].[n].fa
 */
async function findBinFiles(
  outputDir: string,
  sampleId: string
): Promise<string[]> {
  const binDir = path.join(outputDir, 'GenomeBinning', 'MaxBin2');
  const files: string[] = [];

  try {
    // List Assembly_* directories
    const assemblyDirs = await fs.readdir(binDir);

    for (const assemblyDir of assemblyDirs) {
      if (!assemblyDir.startsWith('Assembly_')) continue;

      const fullAssemblyDir = path.join(binDir, assemblyDir);
      const entries = await fs.readdir(fullAssemblyDir);

      for (const entry of entries) {
        // Match patterns like MEGAHIT-MaxBin2-sample1.001.fa
        if (entry.includes(sampleId) && entry.endsWith('.fa')) {
          files.push(path.join(fullAssemblyDir, entry));
        }
      }
    }
  } catch {
    // Directory may not exist
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

  try {
    // BAM files might be in various locations
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
  } catch {
    // Error during search
  }

  return files;
}

/**
 * Parse MAG pipeline results and create database records
 */
export async function parseMagResults(options: ParseOptions): Promise<ParseResult> {
  const { runId, outputDir, samples } = options;
  const errors: string[] = [];

  let assembliesCreated = 0;
  let binsCreated = 0;

  // Try to load CheckM summary for bin quality
  const checkmPath = path.join(outputDir, 'GenomeBinning', 'QC', 'checkm_summary.tsv');
  const checkmMetrics = await parseCheckmSummary(checkmPath);

  // Process each sample
  for (const sample of samples) {
    // Find and create assembly records
    const assemblyFiles = await findAssemblyFiles(outputDir, sample.sampleId);

    for (const assemblyFile of assemblyFiles) {
      try {
        await db.assembly.create({
          data: {
            assemblyName: path.basename(assemblyFile),
            assemblyFile: assemblyFile,
            sampleId: sample.id,
            createdByPipelineRunId: runId,
          },
        });
        assembliesCreated++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Failed to create assembly for ${sample.sampleId}: ${msg}`);
      }
    }

    // Find and create bin records
    const binFiles = await findBinFiles(outputDir, sample.sampleId);

    for (const binFile of binFiles) {
      const binName = path.basename(binFile);
      const metrics = checkmMetrics.get(binName);

      try {
        await db.bin.create({
          data: {
            binName,
            binFile: binFile,
            completeness: metrics?.completeness || null,
            contamination: metrics?.contamination || null,
            sampleId: sample.id,
            createdByPipelineRunId: runId,
          },
        });
        binsCreated++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Failed to create bin for ${sample.sampleId}: ${msg}`);
      }
    }

    // Find alignment files and create artifacts
    const alignmentFiles = await findAlignmentFiles(outputDir, sample.sampleId);

    for (const alignmentFile of alignmentFiles) {
      try {
        await db.pipelineArtifact.create({
          data: {
            type: 'alignment',
            name: path.basename(alignmentFile),
            path: alignmentFile,
            sampleId: sample.id,
            pipelineRunId: runId,
            producedByStepId: 'binning_prep',
          },
        });
      } catch (error) {
        // Log but don't fail for alignment artifacts
        const msg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Warning: Failed to create alignment artifact: ${msg}`);
      }
    }
  }

  // Update run with results summary
  const results = {
    assembliesCreated,
    binsCreated,
    errors: errors.length > 0 ? errors : undefined,
  };

  await db.pipelineRun.update({
    where: { id: runId },
    data: {
      results: JSON.stringify(results),
    },
  });

  // Update step statuses
  await db.pipelineRunStep.updateMany({
    where: { pipelineRunId: runId },
    data: { status: 'completed', completedAt: new Date() },
  });

  return {
    success: errors.length === 0 || (assembliesCreated > 0 || binsCreated > 0),
    assembliesCreated,
    binsCreated,
    errors,
  };
}

/**
 * Get summary of a completed run's outputs
 */
export async function getRunOutputSummary(runId: string): Promise<{
  assemblies: number;
  bins: number;
  artifacts: number;
  avgCompleteness: number | null;
  avgContamination: number | null;
}> {
  const [assemblies, bins, artifacts] = await Promise.all([
    db.assembly.count({ where: { createdByPipelineRunId: runId } }),
    db.bin.findMany({
      where: { createdByPipelineRunId: runId },
      select: { completeness: true, contamination: true },
    }),
    db.pipelineArtifact.count({ where: { pipelineRunId: runId } }),
  ]);

  // Calculate average completeness and contamination
  const binsWithMetrics = bins.filter(b => b.completeness !== null);
  const avgCompleteness = binsWithMetrics.length > 0
    ? binsWithMetrics.reduce((sum, b) => sum + (b.completeness || 0), 0) / binsWithMetrics.length
    : null;
  const avgContamination = binsWithMetrics.length > 0
    ? binsWithMetrics.reduce((sum, b) => sum + (b.contamination || 0), 0) / binsWithMetrics.length
    : null;

  return {
    assemblies,
    bins: bins.length,
    artifacts,
    avgCompleteness,
    avgContamination,
  };
}
