/**
 * Generic Pipeline Adapter
 *
 * Creates a PipelineAdapter implementation based on manifest configuration.
 * This allows new pipelines to be added without writing custom TypeScript code.
 *
 * The adapter uses:
 * - manifest.inputs for validation
 * - samplesheet.yaml for samplesheet generation
 * - manifest.outputs + parsers for output discovery
 */

import path from 'path';
import fs from 'fs/promises';
import { db } from '@/lib/db';
import { resolveAssemblySelection } from '@/lib/pipelines/assembly-selection';

/**
 * Simple glob implementation for finding files matching a pattern
 * Supports ** for recursive matching and * for single directory level
 */
async function simpleGlob(pattern: string): Promise<string[]> {
  const matches: string[] = [];

  // Split pattern into directory and file parts
  const parts = pattern.split('/');
  const baseParts: string[] = [];
  let patternStart = 0;

  // Find the base directory (before any wildcards)
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].includes('*') || parts[i].includes('?') || parts[i].includes('{')) {
      patternStart = i;
      break;
    }
    baseParts.push(parts[i]);
    patternStart = i + 1;
  }

  const baseDir = baseParts.length > 0 ? baseParts.join('/') : '.';
  const filePattern = parts.slice(patternStart).join('/');

  // Convert glob pattern to regex
  const regexPattern = filePattern
    .replace(/\*\*/g, '{{RECURSIVE}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/{{RECURSIVE}}/g, '.*')
    // Expand brace patterns like {A,B} to regex alternation (A|B)
    .replace(/\{([^}]+)\}/g, (_, content) => `(${content.replace(/,/g, '|')})`);

  const regex = new RegExp(`^${regexPattern}$`);

  // Recursively find matching files
  async function findFiles(dir: string, relativePath: string = ''): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        const entryRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await findFiles(entryPath, entryRelative);
        } else if (regex.test(entryRelative)) {
          matches.push(entryPath);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  try {
    const baseStat = await fs.stat(baseDir);
    if (baseStat.isDirectory()) {
      await findFiles(baseDir);
    }
  } catch {
    // Base directory doesn't exist
  }

  return matches;
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function resolveMappedValue(
  value: string,
  mapping: Record<string, string>
): string | null {
  const candidate = value.trim();
  if (!candidate) return null;

  const mapped =
    mapping[candidate] ??
    mapping[candidate.toLowerCase()] ??
    mapping[candidate.toUpperCase()];

  return mapped ?? null;
}

function hasChecklistData(value: string | null): boolean {
  if (!hasNonEmptyString(value)) {
    return false;
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.length > 0;
    }
    if (parsed && typeof parsed === 'object') {
      return Object.keys(parsed).length > 0;
    }
    return false;
  } catch {
    return false;
  }
}
import {
  getPackage,
  getAllPackages,
  type PackageOutput,
} from './package-loader';
import { resolveOrderPlatform } from './order-platform';
import { generateSamplesheetFromConfig } from './samplesheet-generator';
import { runAllParsers, type ParsedData, type ParsedRow } from './parser-runtime';
import {
  type PipelineAdapter,
  type ValidationResult,
  type SamplesheetResult,
  type SamplesheetOptions,
  type DiscoverOutputsResult,
  type DiscoverOutputsOptions,
  type DiscoveredFile,
  getAdapter,
  registerAdapter,
} from './adapters/types';

/**
 * Map output destination to DiscoveredFile type
 */
function destinationToType(
  destination: string
): 'assembly' | 'bin' | 'artifact' | 'report' | 'qc' {
  switch (destination) {
    case 'sample_assemblies':
      return 'assembly';
    case 'sample_bins':
      return 'bin';
    case 'study_report':
    case 'order_report':
      return 'report';
    case 'sample_qc':
      return 'qc';
    default:
      return 'artifact';
  }
}

/**
 * Extract sample identifier from a file path based on matching strategy
 */
function extractSampleId(
  filePath: string,
  outputDir: string,
  matchBy?: 'filename' | 'parent_dir' | 'path',
  samples?: Array<{ id: string; sampleId: string }>
): { dbId: string; sampleId: string } | null {
  if (!samples || samples.length === 0 || !matchBy) {
    return null;
  }

  const fileName = path.basename(filePath);
  const parentDir = path.basename(path.dirname(filePath));
  const relativePath = path.relative(outputDir, filePath);

  for (const sample of samples) {
    let matches = false;

    switch (matchBy) {
      case 'filename':
        matches = fileName.includes(sample.sampleId);
        break;
      case 'parent_dir':
        matches = parentDir.includes(sample.sampleId);
        break;
      case 'path':
        matches = relativePath.includes(sample.sampleId);
        break;
    }

    if (matches) {
      return { dbId: sample.id, sampleId: sample.sampleId };
    }
  }

  return null;
}

/**
 * Apply parsed metadata to a discovered file
 */
function applyParsedMetadata(
  file: DiscoveredFile,
  output: PackageOutput,
  parsedData: Map<string, ParsedData>
): void {
  if (!output.parsed) return;

  const parserData = parsedData.get(output.parsed.from);
  if (!parserData || parserData.rows.size === 0) return;

  const fileName = path.basename(file.path);
  const baseName = fileName.replace(/\.(fa|fasta|fa\.gz|fasta\.gz|fna|fna\.gz|tsv|csv|json)$/i, '');
  const candidates = [
    file.sampleName,
    file.sampleId,
    baseName,
    fileName,
  ].filter((value): value is string => Boolean(value));

  let matchedRow: ParsedRow | undefined;

  // Try direct lookup by candidate key
  for (const candidate of candidates) {
    const direct = parserData.rows.get(candidate);
    if (direct) {
      matchedRow = direct;
      break;
    }
  }

  // Use output.parsed.matchBy to find a matching row if direct lookup failed
  if (!matchedRow && output.parsed.matchBy) {
    for (const row of parserData.rows.values()) {
      const rowMatchValue = row[output.parsed.matchBy];
      if (rowMatchValue === null || rowMatchValue === undefined) continue;
      if (candidates.includes(String(rowMatchValue))) {
        matchedRow = row;
        break;
      }
    }
  }

  if (!matchedRow) return;

  // Apply the mapping
  const metadata: Record<string, unknown> = file.metadata || {};
  for (const [targetField, sourceField] of Object.entries(output.parsed.map)) {
    if (matchedRow[sourceField] !== undefined && matchedRow[sourceField] !== null) {
      metadata[targetField] = matchedRow[sourceField];
    }
  }

  file.metadata = metadata;
}

/**
 * Discover outputs for a single output definition
 */
async function discoverOutput(
  output: PackageOutput,
  outputDir: string,
  samples: Array<{ id: string; sampleId: string }>,
  parsedData: Map<string, ParsedData>
): Promise<DiscoveredFile[]> {
  const files: DiscoveredFile[] = [];
  const type = destinationToType(output.destination);

  // Try primary pattern
  let matches: string[] = [];
  const primaryPattern = path.join(outputDir, output.discovery.pattern);

  try {
    matches = await simpleGlob(primaryPattern);
  } catch {
    // Pattern failed
  }

  // Try fallback pattern if no matches
  if (matches.length === 0 && output.discovery.fallbackPattern) {
    const fallbackPattern = path.join(outputDir, output.discovery.fallbackPattern);
    try {
      matches = await simpleGlob(fallbackPattern);
    } catch {
      // Fallback also failed
    }
  }

  // Process matches
  for (const match of matches) {
    const fileName = path.basename(match);
    const sampleMatch = extractSampleId(
      match,
      outputDir,
      output.discovery.matchSampleBy,
      samples
    );

    const discoveredFile: DiscoveredFile = {
      type,
      name: fileName,
      path: match,
      outputId: output.id,
      fromStep: output.fromStep,
      ...(sampleMatch && {
        sampleId: sampleMatch.dbId,
        sampleName: sampleMatch.sampleId,
      }),
    };

    // Apply parsed metadata if configured
    applyParsedMetadata(discoveredFile, output, parsedData);

    files.push(discoveredFile);
  }

  return files;
}

/**
 * Create a generic adapter for a pipeline package
 *
 * @param packageId - The pipeline package ID
 * @returns A PipelineAdapter implementation, or null if package not found
 */
export function createGenericAdapter(packageId: string): PipelineAdapter | null {
  const pkg = getPackage(packageId);
  if (!pkg) {
    return null;
  }

  const adapter: PipelineAdapter = {
    pipelineId: packageId,

    async validateInputs(
      studyId: string,
      sampleIds?: string[]
    ): Promise<ValidationResult> {
      const issues: string[] = [];

      const whereClause: { studyId: string; id?: { in: string[] } } = { studyId };
      if (sampleIds && sampleIds.length > 0) {
        whereClause.id = { in: sampleIds };
      }

      const [study, samples] = await Promise.all([
        db.study.findUnique({
          where: { id: studyId },
          select: {
            id: true,
            studyAccessionId: true,
          },
        }),
        db.sample.findMany({
          where: whereClause,
          include: {
            reads: true,
            assemblies: true,
            bins: true,
            order: {
              select: {
                platform: true,
                customFields: true,
              },
            },
          },
        }),
      ]);

      if (!study) {
        issues.push('Study not found');
        return { valid: false, issues };
      }

      if (samples.length === 0) {
        issues.push('No samples found');
        return { valid: false, issues };
      }

      // Check manifest inputs requirements
      for (const input of pkg.manifest.inputs) {
        if (!input.required) continue;

        if (input.scope === 'sample' && input.source === 'sample.reads') {
          const paired = input.filters?.paired === true;
          const checksums = input.filters?.checksums === true;

          for (const sample of samples) {
            if (sample.reads.length === 0) {
              issues.push(`Sample ${sample.sampleId}: No reads assigned`);
              continue;
            }

            const readsToValidate = paired
              ? sample.reads.filter((r) => r.file1 && r.file2)
              : sample.reads;

            if (paired && readsToValidate.length === 0) {
              issues.push(
                `Sample ${sample.sampleId}: No paired-end reads (R1+R2) found`
              );
              continue;
            }

            if (checksums) {
              const hasMissingChecksums = readsToValidate.some((read) => {
                if (!hasNonEmptyString(read.checksum1)) return true;
                if (paired && !hasNonEmptyString(read.checksum2)) return true;
                return false;
              });

              if (hasMissingChecksums) {
                issues.push(
                  `Sample ${sample.sampleId}: Read checksums are required`
                );
              }
            }
          }
        }

        if (input.scope === 'order' && input.source === 'order.platform') {
          for (const sample of samples) {
            const platform = resolveOrderPlatform(sample.order);
            if (!platform) {
              issues.push(
                `Sample ${sample.sampleId}: Sequencing platform is required (set Order platform or Sequencing Technologies selection)`
              );
              continue;
            }

            const transform = input.transform;
            const strictMapTransform =
              transform?.type === 'map_value' &&
              transform.strict === true &&
              !!transform.mapping;

            if (strictMapTransform) {
              const mapping = transform.mapping;
              if (!mapping) {
                continue;
              }
              const mappedPlatform = resolveMappedValue(platform, mapping);
              if (!mappedPlatform) {
                const allowedTargets = Array.from(
                  new Set(Object.values(mapping))
                ).join(', ');
                issues.push(
                  `Sample ${sample.sampleId}: Unsupported sequencing platform "${platform}" for this pipeline${allowedTargets ? ` (expected mapping to: ${allowedTargets})` : ''}`
                );
              }
            }
          }
        }

        if (input.scope === 'sample' && input.source === 'sample.assemblies') {
          for (const sample of samples) {
            const selectedAssembly = resolveAssemblySelection(sample, {
              strictPreferred: true,
            }).assembly;
            if (!selectedAssembly?.assemblyFile) {
              issues.push(
                sample.preferredAssemblyId
                  ? `Sample ${sample.sampleId}: Preferred assembly selection is invalid (update it in Study Analysis)`
                  : `Sample ${sample.sampleId}: Assembly file is required`
              );
            }
          }
        }

        if (input.scope === 'sample' && input.source === 'sample.bins') {
          for (const sample of samples) {
            const hasBinFile = sample.bins.some((bin) =>
              hasNonEmptyString(bin.binFile)
            );
            if (!hasBinFile) {
              issues.push(`Sample ${sample.sampleId}: At least one bin file is required`);
            }
          }
        }

        if (input.scope === 'sample' && input.source === 'sample.taxId') {
          for (const sample of samples) {
            if (!hasNonEmptyString(sample.taxId)) {
              issues.push(`Sample ${sample.sampleId}: taxId is required`);
            }
          }
        }

        if (input.scope === 'sample' && input.source === 'sample.checklistData') {
          for (const sample of samples) {
            if (!hasChecklistData(sample.checklistData)) {
              issues.push(
                `Sample ${sample.sampleId}: Checklist data is required and must be valid JSON`
              );
            }
          }
        }

        if (input.scope === 'study' && input.source === 'study.studyAccessionId') {
          if (!hasNonEmptyString(study.studyAccessionId)) {
            issues.push('Study accession (PRJ*) is required');
          }
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
      // Use the declarative samplesheet generator
      const result = await generateSamplesheetFromConfig(packageId, {
        studyId: options.studyId,
        sampleIds: options.sampleIds,
        dataBasePath: options.dataBasePath,
      });

      if (result) {
        return {
          content: result.content,
          sampleCount: result.sampleCount,
          errors: result.errors,
        };
      }

      // No samplesheet config - return error
      return {
        content: '',
        sampleCount: 0,
        errors: [`No samplesheet configuration found for pipeline: ${packageId}`],
      };
    },

    async discoverOutputs(
      options: DiscoverOutputsOptions
    ): Promise<DiscoverOutputsResult> {
      const { outputDir, samples } = options;
      const allFiles: DiscoveredFile[] = [];
      const errors: string[] = [];

      // Run all parsers first
      const parsedData = await runAllParsers(packageId, outputDir);

      // Collect parser errors
      for (const [, data] of parsedData) {
        errors.push(...data.errors);
      }

      // Process each output definition
      for (const output of pkg.manifest.outputs) {
        // Skip outputs that depend on other outputs (handle dependency order)
        // For now, just process all - a more sophisticated approach would sort by dependencies

        const discovered = await discoverOutput(
          output,
          outputDir,
          samples,
          parsedData
        );
        allFiles.push(...discovered);
      }

      // Compute summary
      let assembliesFound = 0;
      let binsFound = 0;
      let artifactsFound = 0;
      let reportsFound = 0;

      for (const file of allFiles) {
        switch (file.type) {
          case 'assembly':
            assembliesFound++;
            break;
          case 'bin':
            binsFound++;
            break;
          case 'report':
            reportsFound++;
            break;
          default:
            artifactsFound++;
        }
      }

      return {
        files: allFiles,
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

  return adapter;
}

/**
 * Register generic adapters for all loaded packages
 *
 * This should be called after packages are loaded to make adapters available.
 * Note: If a custom adapter is already registered, it takes precedence.
 */
export function registerGenericAdapters(): void {
  for (const pkg of getAllPackages()) {
    // Skip if a custom adapter is already registered
    if (getAdapter(pkg.id)) {
      continue;
    }

    const adapter = createGenericAdapter(pkg.id);
    if (adapter) {
      registerAdapter(adapter);
    }
  }
}
