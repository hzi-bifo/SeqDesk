// Output Resolver
// Central place for writing pipeline outputs to the database.
//
// Uses outputs from:
// - Package manifest (pipelines/<id>/manifest.json)
//
// This is the ONLY place that writes pipeline outputs to the DB.
// Pipeline adapters discover outputs but do not write to DB.

import fs from 'fs/promises';
import path from 'path';
import { db } from '@/lib/db';
import { ensureWithinBase } from '@/lib/files';
import { getResolvedDataBasePath } from '@/lib/files/data-base-path';
import { getPackage, PackageOutput } from './package-loader';
import { DiscoveredFile, DiscoverOutputsResult } from './adapters/types';
import {
  inferPipelineResultContract,
  READ_NUMBER_WRITEBACK_FIELDS,
  READ_STRING_WRITEBACK_FIELDS,
  type PackageOutputWriteback,
  type ReadWritebackField,
} from './package-contracts';
import {
  isProtectedReadDataClass,
  normalizeReadDataClass,
} from '@/lib/sequencing/constants';

/**
 * Detect a Prisma unique-constraint violation (P2002). Concurrent resolution
 * (weblog workflow_complete racing monitor/sync finalize) can pass the
 * findFirst idempotency check and then both call create; the DB-level
 * @@unique on (pipelineRunId, path) / (run, sample, file) makes the loser
 * throw P2002. We treat that as an idempotent skip, not an error.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Result of resolving outputs to database records
 */
export interface ResolveResult {
  success: boolean;
  assembliesCreated: number;
  binsCreated: number;
  artifactsCreated: number;
  pendingWritebacks?: number;
  errors: string[];
  warnings: string[];
}

/**
 * Map of destination types to their handlers
 */
type DestinationHandler = (
  file: DiscoveredFile,
  runId: string,
  output: ResolvedOutputContract,
  pipelineId: string
) => Promise<{ success: boolean; error?: string; skipped?: boolean }>;

interface ResolvedOutputContract {
  id: string;
  destination?: PackageOutput['destination'];
  fromStep?: string;
  writeback?: PackageOutput['writeback'];
}

type ReadWritebackValue = string | number | null;
type ReadWritebackData = Partial<Record<ReadWritebackField, ReadWritebackValue>>;

async function getFileSizeBytes(filePath: string): Promise<bigint | null> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() ? BigInt(stat.size) : null;
  } catch {
    return null;
  }
}

function mergePipelineSource(
  existing: string | null | undefined,
  pipelineId: string,
  runId: string
): string {
  let sources: Record<string, string> = {};
  if (existing) {
    try { sources = JSON.parse(existing); } catch { /* ignore */ }
  }
  sources[pipelineId] = runId;
  return JSON.stringify(sources);
}

function getStringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string
): string | null | undefined {
  const value = metadata?.[key];
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : null;
}

function getNumberMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string
): number | null | undefined {
  const value = metadata?.[key];
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function getBooleanMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string
): boolean | undefined {
  const value = metadata?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

async function copyReadFileToStorage(
  dataBasePath: string,
  targetRelativePath: string,
  sourcePath: string
): Promise<void> {
  const targetAbsolutePath = ensureWithinBase(dataBasePath, targetRelativePath);
  await fs.mkdir(path.dirname(targetAbsolutePath), { recursive: true });
  if (path.resolve(sourcePath) === targetAbsolutePath) {
    return;
  }
  await fs.copyFile(sourcePath, targetAbsolutePath);
}

async function safeDeleteReadFile(
  dataBasePath: string,
  relativeOrAbsolutePath: string | null | undefined
): Promise<void> {
  if (!relativeOrAbsolutePath) return;

  try {
    const absolutePath = path.isAbsolute(relativeOrAbsolutePath)
      ? path.resolve(relativeOrAbsolutePath)
      : ensureWithinBase(dataBasePath, relativeOrAbsolutePath);

    const resolvedBase = path.resolve(dataBasePath);
    if (
      absolutePath !== resolvedBase &&
      !absolutePath.startsWith(`${resolvedBase}${path.sep}`)
    ) {
      return;
    }

    await fs.unlink(absolutePath);
  } catch {
    // Ignore missing files and path validation errors during cleanup.
  }
}

// A discovered read's source path must live inside the run folder before we copy
// it into a sample's storage. Without this, a discovery script (or a tampered
// discovery manifest in the output dir) could point sourceFile1/2 at an absolute
// path outside the run (e.g. another order's data or a system file) and have it
// copied in as the sample's reads. Mirrors assertSourceInsideRun in
// pending-writebacks.ts, which guards the staged-promote path.
function assertSourceInsideRun(runFolder: string | null, sourcePath: string): void {
  if (!runFolder) {
    throw new Error("run folder is not available");
  }
  const resolvedRunFolder = path.resolve(runFolder);
  const resolvedSource = path.resolve(sourcePath);
  if (
    resolvedSource !== resolvedRunFolder &&
    !resolvedSource.startsWith(`${resolvedRunFolder}${path.sep}`)
  ) {
    throw new Error(`source file is outside the run folder: ${sourcePath}`);
  }
}

async function replaceSampleReads(
  sampleId: string,
  dataBasePath: string,
  readData: {
    file1: string;
    file2: string | null;
    checksum1: string | null | undefined;
    checksum2: string | null | undefined;
    readCount1: number | null | undefined;
    readCount2: number | null | undefined;
    avgQuality1: number | null | undefined;
    avgQuality2: number | null | undefined;
    fastqcReport1: string | null | undefined;
    fastqcReport2: string | null | undefined;
    pipelineRunId?: string | null;
    pipelineSources?: string | null;
    dataClass?: string | null;
  }
): Promise<void> {
  const existingReads = await db.read.findMany({
    where: { sampleId },
    select: {
      id: true,
      file1: true,
      file2: true,
      dataClass: true,
    },
  });
  // Protected raw/unknown reads are preserved (kept active and untouched); only
  // non-protected reads (e.g. previously written cleaned reads) are replaced.
  const deletableReads = existingReads.filter(
    (read) => !isProtectedReadDataClass(read.dataClass)
  );

  // Create the new active read and remove the replaced rows in one transaction
  // so a crash can never leave the sample with no active read. The new read's
  // files are already copied to storage by the caller, so the row points at
  // on-disk data the moment it is created.
  const newRead = await db.$transaction(async (tx) => {
    const created = await tx.read.create({
      data: {
        sampleId,
        file1: readData.file1,
        file2: readData.file2,
        checksum1: readData.checksum1 ?? null,
        checksum2: readData.checksum2 ?? null,
        readCount1: readData.readCount1 ?? null,
        readCount2: readData.readCount2 ?? null,
        avgQuality1: readData.avgQuality1 ?? null,
        avgQuality2: readData.avgQuality2 ?? null,
        fastqcReport1: readData.fastqcReport1 ?? null,
        fastqcReport2: readData.fastqcReport2 ?? null,
        pipelineRunId: readData.pipelineRunId ?? null,
        pipelineSources: readData.pipelineSources ?? null,
        dataClass: normalizeReadDataClass(readData.dataClass),
        dataClassSource: 'pipeline',
        isActive: true,
        classifiedAt: new Date(),
      },
    });

    if (deletableReads.length > 0) {
      await tx.read.deleteMany({
        where: { id: { in: deletableReads.map((read) => read.id) } },
      });
    }

    return created;
  });

  // Delete the replaced files only after the new read row is committed, and
  // never delete a path the new read itself now points at (an in-place rewrite).
  const newReadFiles = new Set(
    [newRead.file1, newRead.file2].filter((value): value is string => Boolean(value))
  );
  for (const read of deletableReads) {
    if (read.file1 && !newReadFiles.has(read.file1)) {
      await safeDeleteReadFile(dataBasePath, read.file1);
    }
    if (read.file2 && !newReadFiles.has(read.file2)) {
      await safeDeleteReadFile(dataBasePath, read.file2);
    }
  }
}

/**
 * Create an Assembly record (with idempotency check)
 */
async function createAssembly(
  file: DiscoveredFile,
  runId: string,
  output: ResolvedOutputContract,
  pipelineId: string
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  void output;
  void pipelineId;

  if (!file.sampleId) {
    return { success: false, error: `Assembly ${file.name}: No sample ID` };
  }

  try {
    // Check if assembly already exists for this run + sample + file
    const existing = await db.assembly.findFirst({
      where: {
        createdByPipelineRunId: runId,
        sampleId: file.sampleId,
        assemblyFile: file.path,
      },
    });

    if (existing) {
      return { success: true, skipped: true };
    }

    await db.assembly.create({
      data: {
        assemblyName: file.name,
        assemblyFile: file.path,
        sampleId: file.sampleId,
        createdByPipelineRunId: runId,
      },
    });
    return { success: true };
  } catch (error) {
    // A concurrent resolution created the same (run, sample, file) assembly
    // between our findFirst and create; the unique constraint rejected ours.
    if (isUniqueConstraintViolation(error)) {
      return { success: true, skipped: true };
    }
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to create assembly: ${msg}` };
  }
}

/**
 * Create a Bin record (with idempotency check)
 */
async function createBin(
  file: DiscoveredFile,
  runId: string,
  output: ResolvedOutputContract,
  pipelineId: string
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  void output;
  void pipelineId;

  if (!file.sampleId) {
    return { success: false, error: `Bin ${file.name}: No sample ID` };
  }

  try {
    // Check if bin already exists for this run + sample + file
    const existing = await db.bin.findFirst({
      where: {
        createdByPipelineRunId: runId,
        sampleId: file.sampleId,
        binFile: file.path,
      },
    });

    if (existing) {
      return { success: true, skipped: true };
    }

    await db.bin.create({
      data: {
        binName: file.name,
        binFile: file.path,
        completeness: (file.metadata?.completeness as number) ?? null,
        contamination: (file.metadata?.contamination as number) ?? null,
        sampleId: file.sampleId,
        createdByPipelineRunId: runId,
      },
    });
    return { success: true };
  } catch (error) {
    // A concurrent resolution created the same (run, sample, file) bin between
    // our findFirst and create; the unique constraint rejected ours.
    if (isUniqueConstraintViolation(error)) {
      return { success: true, skipped: true };
    }
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to create bin: ${msg}` };
  }
}

/**
 * Create a PipelineArtifact record (with idempotency check)
 */
async function createArtifact(
  file: DiscoveredFile,
  runId: string,
  output: ResolvedOutputContract,
  pipelineId: string
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  void pipelineId;
  try {
    // Check if artifact already exists for this run + path
    const existing = await db.pipelineArtifact.findFirst({
      where: {
        pipelineRunId: runId,
        path: file.path,
      },
    });

    if (existing) {
      return { success: true, skipped: true };
    }

    const size = await getFileSizeBytes(file.path);

    await db.pipelineArtifact.create({
      data: {
        type: file.type === 'report' ? 'report' : file.type === 'qc' ? 'qc' : 'data',
        name: file.name,
        path: file.path,
        size,
        outputId: output.id,
        sampleId: file.sampleId || null,
        pipelineRunId: runId,
        producedByStepId: file.fromStep || output.fromStep,
        // Persist parsed metadata from adapters
        metadata: file.metadata ? JSON.stringify(file.metadata) : null,
      },
    });
    return { success: true };
  } catch (error) {
    // A concurrent resolution created the same (run, path) artifact between our
    // findFirst and create; the unique constraint rejected ours. Treat as an
    // idempotent skip so the candidate is not double-counted as pending.
    if (isUniqueConstraintViolation(error)) {
      return { success: true, skipped: true };
    }
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to create artifact: ${msg}` };
  }
}

function hasConfiguredReadWriteback(
  output: ResolvedOutputContract
): output is ResolvedOutputContract & { writeback: PackageOutputWriteback } {
  return output.writeback?.target === 'Read';
}

function getConfiguredReadWritebackValue(
  metadata: Record<string, unknown> | undefined,
  metadataKey: string,
  readField: ReadWritebackField
): ReadWritebackValue | undefined {
  if (!metadata || !(metadataKey in metadata)) {
    return undefined;
  }

  if ((READ_NUMBER_WRITEBACK_FIELDS as readonly string[]).includes(readField)) {
    return getNumberMetadata(metadata, metadataKey);
  }

  if ((READ_STRING_WRITEBACK_FIELDS as readonly string[]).includes(readField)) {
    return getStringMetadata(metadata, metadataKey);
  }

  return undefined;
}

function extractConfiguredReadWritebackData(
  metadata: Record<string, unknown> | undefined,
  writeback: PackageOutputWriteback
): ReadWritebackData {
  const data: ReadWritebackData = {};

  for (const [metadataKey, readField] of Object.entries(writeback.fields)) {
    const value = getConfiguredReadWritebackValue(metadata, metadataKey, readField);
    if (value !== undefined) {
      data[readField] = value;
    }
  }

  return data;
}

function extractLegacyReadWritebackData(
  metadata: Record<string, unknown> | undefined
): ReadWritebackData {
  const data: ReadWritebackData = {};

  for (const key of ['file1', 'file2', 'checksum1', 'checksum2', 'fastqcReport1', 'fastqcReport2'] as const) {
    const value = getStringMetadata(metadata, key);
    if (value !== undefined) {
      data[key] = value;
    }
  }

  for (const key of ['readCount1', 'readCount2', 'avgQuality1', 'avgQuality2'] as const) {
    const value = getNumberMetadata(metadata, key);
    if (value !== undefined) {
      data[key] = value;
    }
  }

  return data;
}

async function updateSampleRead(
  file: DiscoveredFile,
  runId: string,
  output: ResolvedOutputContract,
  pipelineId: string
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  if (!file.sampleId) {
    return { success: false, error: `Sample read output ${file.name}: No sample ID` };
  }

  const metadata = file.metadata;
  const writebackData = hasConfiguredReadWriteback(output)
    ? extractConfiguredReadWritebackData(metadata, output.writeback)
    : extractLegacyReadWritebackData(metadata);
  const file1 = typeof writebackData.file1 === 'string' ? writebackData.file1 : null;
  const file2 = typeof writebackData.file2 === 'string' ? writebackData.file2 : null;
  const sourceFile1 = getStringMetadata(metadata, 'sourceFile1');
  const sourceFile2 = getStringMetadata(metadata, 'sourceFile2');
  const outputDataClass = normalizeReadDataClass(getStringMetadata(metadata, 'dataClass'));
  const replaceExistingPreference = getBooleanMetadata(metadata, 'replaceExisting');
  const replaceExisting =
    replaceExistingPreference === undefined
      ? output.writeback?.mode === 'replace'
      : replaceExistingPreference === true;
  const hasFileWriteback = Boolean(file1 && sourceFile1);

  if (hasFileWriteback) {
    const resolvedDataBasePath = await getResolvedDataBasePath();

    if (!resolvedDataBasePath.dataBasePath) {
      return {
        success: false,
        error: `Sample read output ${file.name}: Data base path is not configured`,
      };
    }

    // Check if sample already has read files linked
    let existingRead: { id: string; file1: string | null; pipelineSources?: string | null } | null = null;
    try {
      existingRead = await db.read.findFirst({
        where: { sampleId: file.sampleId, isActive: true },
        select: { id: true, file1: true, pipelineSources: true },
        orderBy: [{ dataClass: 'asc' }, { id: 'asc' }],
      });
    } catch {
      existingRead = await db.read.findFirst({
        where: { sampleId: file.sampleId },
        select: { id: true, file1: true },
        orderBy: { id: 'asc' },
      });
    }
    const sampleAlreadyHasReads = Boolean(existingRead?.file1);

    // When replaceExisting is off and the sample already has reads, keep the
    // existing read files and source untouched. The pipeline output stays in
    // the run folder as an artifact but doesn't become active.
    if (!replaceExisting && sampleAlreadyHasReads) {
      return { success: true, skipped: true };
    }

    // Confirm the source files come from this run's folder before copying them
    // into the sample's permanent storage.
    const runRecord = await db.pipelineRun.findUnique({
      where: { id: runId },
      select: { runFolder: true },
    });
    try {
      assertSourceInsideRun(runRecord?.runFolder ?? null, sourceFile1!);
      if (file2 && sourceFile2) {
        assertSourceInsideRun(runRecord?.runFolder ?? null, sourceFile2);
      }
    } catch (error) {
      return {
        success: false,
        error: `Sample read output ${file.name}: ${
          error instanceof Error ? error.message : "source outside run folder"
        }`,
      };
    }

    try {
      await copyReadFileToStorage(
        resolvedDataBasePath.dataBasePath,
        file1!,
        sourceFile1!
      );

      if (file2 && sourceFile2) {
        await copyReadFileToStorage(
          resolvedDataBasePath.dataBasePath,
          file2,
          sourceFile2
        );
      }

      const newSources = mergePipelineSource(
        existingRead?.pipelineSources ?? null, pipelineId, runId
      );

      if (replaceExisting) {
        await replaceSampleReads(file.sampleId, resolvedDataBasePath.dataBasePath, {
          file1: file1!,
          file2: file2 ?? null,
          checksum1:
            typeof writebackData.checksum1 === 'string' || writebackData.checksum1 === null
              ? writebackData.checksum1
              : undefined,
          checksum2:
            typeof writebackData.checksum2 === 'string' || writebackData.checksum2 === null
              ? writebackData.checksum2
              : undefined,
          readCount1:
            typeof writebackData.readCount1 === 'number' || writebackData.readCount1 === null
              ? writebackData.readCount1
              : undefined,
          readCount2:
            typeof writebackData.readCount2 === 'number' || writebackData.readCount2 === null
              ? writebackData.readCount2
              : undefined,
          avgQuality1:
            typeof writebackData.avgQuality1 === 'number' || writebackData.avgQuality1 === null
              ? writebackData.avgQuality1
              : undefined,
          avgQuality2:
            typeof writebackData.avgQuality2 === 'number' || writebackData.avgQuality2 === null
              ? writebackData.avgQuality2
              : undefined,
          fastqcReport1:
            typeof writebackData.fastqcReport1 === 'string' || writebackData.fastqcReport1 === null
              ? writebackData.fastqcReport1
              : undefined,
          fastqcReport2:
            typeof writebackData.fastqcReport2 === 'string' || writebackData.fastqcReport2 === null
              ? writebackData.fastqcReport2
              : undefined,
          pipelineRunId: runId,
          pipelineSources: newSources,
          dataClass: outputDataClass,
        });
        return { success: true };
      }

      // No existing reads — create a new Read record with the pipeline output
      if (!existingRead) {
        await db.read.create({
          data: {
            sampleId: file.sampleId,
            file1: file1!,
            file2: file2 ?? null,
            checksum1:
              typeof writebackData.checksum1 === 'string' ? writebackData.checksum1 : null,
            checksum2:
              typeof writebackData.checksum2 === 'string' ? writebackData.checksum2 : null,
            readCount1:
              typeof writebackData.readCount1 === 'number' ? writebackData.readCount1 : null,
            readCount2:
              typeof writebackData.readCount2 === 'number' ? writebackData.readCount2 : null,
            avgQuality1:
              typeof writebackData.avgQuality1 === 'number' ? writebackData.avgQuality1 : null,
            avgQuality2:
              typeof writebackData.avgQuality2 === 'number' ? writebackData.avgQuality2 : null,
            fastqcReport1:
              typeof writebackData.fastqcReport1 === 'string' ? writebackData.fastqcReport1 : null,
            fastqcReport2:
              typeof writebackData.fastqcReport2 === 'string' ? writebackData.fastqcReport2 : null,
            pipelineRunId: runId,
            pipelineSources: newSources,
            dataClass: outputDataClass,
            dataClassSource: 'pipeline',
            isActive: true,
            classifiedAt: new Date(),
          },
        });
        return { success: true };
      }

      // Existing read without files — update it with the new file paths
      await db.read.update({
        where: { id: existingRead.id },
        data: {
          file1: file1!,
          file2: file2 ?? null,
          checksum1:
            typeof writebackData.checksum1 === 'string' ? writebackData.checksum1 : null,
          checksum2:
            typeof writebackData.checksum2 === 'string' ? writebackData.checksum2 : null,
          readCount1:
            typeof writebackData.readCount1 === 'number' ? writebackData.readCount1 : null,
          readCount2:
            typeof writebackData.readCount2 === 'number' ? writebackData.readCount2 : null,
          avgQuality1:
            typeof writebackData.avgQuality1 === 'number' ? writebackData.avgQuality1 : null,
          avgQuality2:
            typeof writebackData.avgQuality2 === 'number' ? writebackData.avgQuality2 : null,
          fastqcReport1:
            typeof writebackData.fastqcReport1 === 'string' ? writebackData.fastqcReport1 : null,
          fastqcReport2:
            typeof writebackData.fastqcReport2 === 'string' ? writebackData.fastqcReport2 : null,
          pipelineRunId: runId,
          pipelineSources: newSources,
          dataClass: outputDataClass,
          dataClassSource: 'pipeline',
          isActive: true,
          classifiedAt: new Date(),
        },
      });
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: `Failed to materialize sample reads: ${msg}` };
    }
  }

  // Metadata-only update (no file writeback) — e.g., checksums, QC reports
  let read: { id: string; pipelineSources?: string | null } | null = null;
  try {
    read = await db.read.findFirst({
      where: { sampleId: file.sampleId, isActive: true },
      select: { id: true, pipelineSources: true },
      orderBy: { id: 'asc' },
    });
  } catch {
    // Fallback: pipelineSources column may not exist yet
    read = await db.read.findFirst({
      where: { sampleId: file.sampleId },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
  }

  if (!read) {
    return {
      success: false,
      error: `Sample read output ${file.name}: No canonical Read record found for sample`,
    };
  }

  const data: Record<string, string | number | null> = {};

  for (const [key, value] of Object.entries(writebackData)) {
    if (key === 'file1' || key === 'file2') {
      continue;
    }
    if (value !== undefined) {
      data[key] = value;
    }
  }

  if (Object.keys(data).length === 0) {
    return { success: true, skipped: true };
  }

  // Track which pipeline run produced this metadata
  try {
    data.pipelineSources = mergePipelineSource(read.pipelineSources ?? null, pipelineId, runId);
  } catch {
    // pipelineSources may not be available yet — continue without it
  }

  try {
    await db.read.update({
      where: { id: read.id },
      data,
    });
    return { success: true };
  } catch (error) {
    // If pipelineSources column doesn't exist, retry without it
    if (data.pipelineSources !== undefined) {
      try {
        const dataWithoutSources = { ...data };
        delete dataWithoutSources.pipelineSources;
        if (Object.keys(dataWithoutSources).length > 0) {
          await db.read.update({
            where: { id: read.id },
            data: dataWithoutSources,
          });
          return { success: true };
        }
      } catch {
        // Fall through to error
      }
    }
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to update sample read metadata: ${msg}` };
  }
}

/**
 * Map destination types to handler functions
 */
const skipDownloadOnly: DestinationHandler = async () => ({ success: true });

const destinationHandlers: Record<string, DestinationHandler> = {
  // Sample-scoped outputs
  sample_reads: updateSampleRead,
  sample_assemblies: createAssembly,
  sample_bins: createBin,
  sample_qc: createArtifact,
  sample_metadata: createArtifact,
  sample_annotations: createArtifact,
  // Study-scoped outputs
  study_report: createArtifact,
  // Order-scoped outputs
  order_report: createArtifact,
  order_files: createArtifact,
  // Run-scoped outputs
  run_artifact: createArtifact,
  // Download only (no DB record)
  download_only: skipDownloadOnly,
};

/**
 * Find the output definition that matches a discovered file
 */
/**
 * Find the package output that matches a discovered file
 */
function findMatchingPackageOutput(
  file: DiscoveredFile,
  outputs: PackageOutput[]
): ResolvedOutputContract | null {
  if (file.outputId) {
    const byId = outputs.find(o => o.id === file.outputId);
    if (byId) return byId;
  }

  const scopePriority = file.sampleId
    ? ['sample', 'study', 'order', 'run']
    : ['study', 'order', 'run', 'sample'];

  const destinationPriorityByType: Record<DiscoveredFile['type'], PackageOutput['destination'][]> = {
    assembly: ['sample_assemblies'],
    bin: ['sample_bins'],
    report: ['study_report', 'order_report', 'run_artifact'],
    qc: ['sample_qc', 'study_report', 'run_artifact'],
    artifact: ['run_artifact', 'order_files', 'download_only'],
  };

  const destinationPriority = destinationPriorityByType[file.type] || [];

  for (const scope of scopePriority) {
    for (const destination of destinationPriority) {
      const match = outputs.find(o => o.scope === scope && o.destination === destination);
      if (match) return match;
    }
  }

  for (const destination of destinationPriority) {
    const match = outputs.find(o => o.destination === destination);
    if (match) return match;
  }

  return null;
}

/**
 * Resolve discovered outputs to database records
 *
 * @param pipelineId - The pipeline ID (e.g., "mag")
 * @param runId - The pipeline run ID
 * @param discovered - The discovered outputs from the adapter
 * @returns Result with counts and any errors
 */
export async function resolveOutputs(
  pipelineId: string,
  runId: string,
  discovered: DiscoverOutputsResult
): Promise<ResolveResult> {
  const result: ResolveResult = {
    success: true,
    assembliesCreated: 0,
    binsCreated: 0,
    artifactsCreated: 0,
    errors: [],
    warnings: [],
  };

  const pkg = getPackage(pipelineId);
  if (!pkg) {
    result.success = false;
    result.errors.push(`Pipeline package not found: ${pipelineId}`);
    return result;
  }

  const packageOutputs = pkg.manifest.outputs || [];

  // Process each discovered file
  for (const file of discovered.files) {
    // Find matching output definition
    let output: ResolvedOutputContract | null = null;

    output = findMatchingPackageOutput(file, packageOutputs);

    if (!output) {
      result.warnings.push(`No output definition found for ${file.type}: ${file.name}`);
      // Default to creating an artifact
      const artifactResult = await createArtifact(file, runId, {
        id: file.type,
        fromStep: file.fromStep || 'unknown',
      }, pipelineId);
    if (artifactResult.success) {
      result.artifactsCreated++;
    }
    if (artifactResult.error) {
      result.warnings.push(artifactResult.error);
    }
      continue;
    }

    // Get the handler for this destination
    const destination = output.destination || 'download_only';
    const handler = destinationHandlers[destination];

    if (!handler) {
      result.warnings.push(`Unknown destination type: ${destination}`);
      continue;
    }

    // Execute the handler
    const handlerResult = await handler(file, runId, output, pipelineId);
    const resultContract = inferPipelineResultContract(output);

    if (handlerResult.success) {
      // Only count a candidate as newly pending when its artifact was actually
      // created. Re-resolving a completed run (manual re-resolve, duplicate
      // completion, or a weblog re-fire) finds the existing artifacts and skips
      // them; counting those again would resurface candidates that may already
      // have been promoted, breaking the review badge/panel.
      if (resultContract.kind === 'sample_read_candidate' && !handlerResult.skipped) {
        result.pendingWritebacks = (result.pendingWritebacks ?? 0) + 1;
      }

      switch (destination) {
        case 'sample_assemblies':
          result.assembliesCreated++;
          break;
        case 'sample_bins':
          result.binsCreated++;
          break;
        case 'sample_reads':
        case 'download_only':
          break;
        default:
          result.artifactsCreated++;
      }
    }
    if (handlerResult.error) {
      result.errors.push(handlerResult.error);
    }
  }

  // Add any errors from discovery
  result.errors.push(...discovered.errors);

  // Update success flag - only true when there are no errors
  result.success = result.errors.length === 0;

  return result;
}

/**
 * Save the resolve result to the pipeline run record
 */
export async function saveRunResults(
  runId: string,
  result: ResolveResult
): Promise<void> {
  // result.pendingWritebacks is the number of candidate artifacts *newly created*
  // by THIS resolution pass (resolveOutputs only counts non-skipped candidates).
  // It is a delta, not an absolute total. Re-resolving a completed run skips
  // already-created candidates, so:
  //   - undefined  => no new candidates this pass; keep the stored total as-is
  //                   (promotion owns lowering it via persistPendingWritebackCount).
  //   - 0          => same as undefined (no new candidates).
  //   - N (> 0)    => N brand-new candidates were staged; ADD them to the stored
  //                   total instead of clobbering it, so a partial re-resolution
  //                   that creates some new candidates does not erase the count of
  //                   candidates staged (and possibly already promoted) earlier.
  let pendingWritebacks = result.pendingWritebacks;
  if (pendingWritebacks === undefined || pendingWritebacks === 0) {
    pendingWritebacks = await readStoredPendingWritebacks(runId);
  } else {
    const stored = await readStoredPendingWritebacks(runId);
    pendingWritebacks = (stored ?? 0) + pendingWritebacks;
  }

  const results = {
    assembliesCreated: result.assembliesCreated,
    binsCreated: result.binsCreated,
    artifactsCreated: result.artifactsCreated,
    pendingWritebacks,
    errors: result.errors.length > 0 ? result.errors : undefined,
    warnings: result.warnings.length > 0 ? result.warnings : undefined,
  };

  await db.pipelineRun.update({
    where: { id: runId },
    data: {
      results: JSON.stringify(results),
    },
  });
}

/**
 * Read the persisted pendingWritebacks total from a run's results JSON.
 * Returns undefined when the run has no results, the JSON is unreadable/legacy,
 * or pendingWritebacks is absent. Promotion lowers this total; resolution adds
 * to it (see saveRunResults).
 */
async function readStoredPendingWritebacks(
  runId: string
): Promise<number | undefined> {
  try {
    const existing = await db.pipelineRun.findUnique({
      where: { id: runId },
      select: { results: true },
    });
    if (existing?.results) {
      const parsed = JSON.parse(existing.results) as { pendingWritebacks?: unknown };
      if (typeof parsed.pendingWritebacks === 'number') {
        return parsed.pendingWritebacks;
      }
    }
  } catch {
    // Ignore unreadable/legacy results JSON.
  }
  return undefined;
}
