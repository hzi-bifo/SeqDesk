import fs from "fs/promises";
import path from "path";

import { db } from "@/lib/db";
import { ensureWithinBase } from "@/lib/files";
import { getResolvedDataBasePath } from "@/lib/files/data-base-path";
import { getAdapter, registerAdapter, type DiscoveredFile } from "./adapters/types";
import { createGenericAdapter } from "./generic-adapter";
import { getPackage, type PackageManifest } from "./package-loader";
import type { PipelineTarget } from "./types";

interface CleanupSample {
  id: string;
  sampleId: string;
}

interface CleanupRunOptions {
  runId: string;
  pipelineId: string;
  runFolder: string | null;
  target: PipelineTarget;
  samples: CleanupSample[];
}

function getStringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string
): string | null | undefined {
  const value = metadata?.[key];
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : null;
}

async function safeDeleteDataFile(
  dataBasePath: string,
  relativeOrAbsolutePath: string | null | undefined
): Promise<void> {
  if (!relativeOrAbsolutePath) return;

  try {
    const absolutePath = path.isAbsolute(relativeOrAbsolutePath)
      ? path.resolve(relativeOrAbsolutePath)
      : ensureWithinBase(dataBasePath, relativeOrAbsolutePath);
    await fs.rm(absolutePath, { force: true });
  } catch {
    // Ignore missing files or invalid paths during best-effort cleanup.
  }
}

function parseSelectedSampleIds(value: string | null | undefined): string[] | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "string")) {
      return null;
    }
    return parsed as string[];
  } catch {
    return null;
  }
}

function overlapsAffectedSamples(
  inputSampleIds: string | null | undefined,
  affectedSampleIds: Set<string>
): boolean {
  if (affectedSampleIds.size === 0) return false;

  const selectedSampleIds = parseSelectedSampleIds(inputSampleIds);
  if (!selectedSampleIds || selectedSampleIds.length === 0) {
    return true;
  }

  return selectedSampleIds.some((sampleId) => affectedSampleIds.has(sampleId));
}

function parsePipelineSources(
  value: string | null | undefined
): Record<string, string> | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    );
  } catch {
    return null;
  }
}

function getActivePipelineSourceRunId(
  read: {
    pipelineRunId?: string | null;
    pipelineSources?: string | null;
  },
  pipelineId: string
): string | null {
  const pipelineSources = parsePipelineSources(read.pipelineSources);
  const explicitRunId = pipelineSources?.[pipelineId];
  if (explicitRunId) {
    return explicitRunId;
  }
  return read.pipelineRunId ?? null;
}

/** Read metadata fields that pipelines can write via sample_reads outputs. */
const READ_METADATA_FIELDS = [
  "checksum1",
  "checksum2",
  "readCount1",
  "readCount2",
  "avgQuality1",
  "avgQuality2",
  "fastqcReport1",
  "fastqcReport2",
] as const;

/**
 * Determine if a discovered file produces read files (file1/file2) or only
 * updates metadata fields on an existing Read record.
 */
function isFileProducingOutput(file: DiscoveredFile): boolean {
  return !!getStringMetadata(file.metadata, "file1");
}

/**
 * Get the set of metadata field names that a discovered file writes.
 */
function getMetadataFields(file: DiscoveredFile): string[] {
  return READ_METADATA_FIELDS.filter(
    (key) => getStringMetadata(file.metadata, key) !== undefined
  );
}

async function cleanupMaterializedSampleRead(
  file: DiscoveredFile,
  dataBasePath: string,
  pipelineId: string,
  runId: string
): Promise<boolean> {
  if (!file.sampleId) return false;

  if (isFileProducingOutput(file)) {
    return cleanupFileProducingRead(file, dataBasePath, pipelineId, runId);
  }

  // Metadata-only output (e.g., FASTQ Checksum writes checksum1/checksum2)
  const fields = getMetadataFields(file);
  if (fields.length === 0) return false;

  return cleanupReadMetadataFields(file.sampleId, fields, pipelineId, runId);
}

/**
 * Delete the Read record and its data files when the pipeline created
 * the read files themselves (e.g., Simulate Reads).
 */
async function cleanupFileProducingRead(
  file: DiscoveredFile,
  dataBasePath: string,
  pipelineId: string,
  runId: string
): Promise<boolean> {
  const file1 = getStringMetadata(file.metadata, "file1");
  const file2 = getStringMetadata(file.metadata, "file2");

  if (!file1) return false;

  const currentRead = await db.read.findFirst({
    where: { sampleId: file.sampleId! },
    orderBy: { id: "asc" },
    select: {
      id: true,
      file1: true,
      file2: true,
      pipelineRunId: true,
      pipelineSources: true,
    },
  });

  if (!currentRead) return false;

  const activeSourceRunId = getActivePipelineSourceRunId(currentRead, pipelineId);
  if (activeSourceRunId && activeSourceRunId !== runId) {
    return false;
  }

  if (currentRead.file1 !== file1 || (currentRead.file2 ?? null) !== (file2 ?? null)) {
    return false;
  }

  await safeDeleteDataFile(dataBasePath, currentRead.file1);
  await safeDeleteDataFile(dataBasePath, currentRead.file2);
  await db.read.delete({ where: { id: currentRead.id } });
  return true;
}

/**
 * Null out specific metadata fields on the Read record when the pipeline
 * only wrote metadata (e.g., FASTQ Checksum writes checksum1/checksum2).
 */
async function cleanupReadMetadataFields(
  sampleId: string,
  fields: string[],
  pipelineId: string,
  runId: string
): Promise<boolean> {
  const read = await db.read.findFirst({
    where: { sampleId },
    orderBy: { id: "asc" },
    select: {
      id: true,
      pipelineRunId: true,
      pipelineSources: true,
    },
  });

  if (!read) return false;

  const activeSourceRunId = getActivePipelineSourceRunId(read, pipelineId);
  if (activeSourceRunId && activeSourceRunId !== runId) {
    return false;
  }

  const nullData: Record<string, null> = {};
  for (const field of fields) {
    nullData[field] = null;
  }

  await db.read.update({ where: { id: read.id }, data: nullData });
  return true;
}

/**
 * Output IDs known to only write metadata (checksums, QC reports) to existing
 * Read records rather than creating new read files.
 */
const METADATA_ONLY_OUTPUT_IDS = new Set([
  "sample_checksums",    // fastq-checksum
  "sample_fastqc_reads", // fastqc
]);

/**
 * Determine which Read metadata fields a pipeline's sample_reads outputs write,
 * based on known output IDs.
 */
function getOutputMetadataFields(
  pkg: { manifest: Pick<PackageManifest, "outputs"> }
): string[] {
  const fields: string[] = [];
  for (const output of pkg.manifest.outputs) {
    if (output.destination !== "sample_reads") continue;
    if (output.id === "sample_checksums") {
      fields.push("checksum1", "checksum2");
    } else if (output.id === "sample_fastqc_reads") {
      fields.push("fastqcReport1", "fastqcReport2", "readCount1", "readCount2", "avgQuality1", "avgQuality2");
    }
  }
  return fields;
}

function consumesSampleReads(manifest: Pick<PackageManifest, "inputs">): boolean {
  return manifest.inputs.some((input) => input.source === "sample.reads");
}

export async function cleanupRunOutputData(
  options: CleanupRunOptions
): Promise<void> {
  const pkg = getPackage(options.pipelineId);
  if (!pkg) {
    return;
  }

  const producesSampleReads = pkg.manifest.outputs.some(
    (output) => output.destination === "sample_reads"
  );

  if (!producesSampleReads) {
    return;
  }

  const affectedSampleIds = new Set(options.samples.map((sample) => sample.id));

  // Check if this is the last overlapping run for this pipeline. Sample-scoped
  // runs should not prevent cleanup for unrelated samples, and vice versa.
  const otherRunsWhere: Record<string, unknown> = {
    pipelineId: options.pipelineId,
    id: { not: options.runId },
    status: { in: ["completed", "running", "pending", "queued"] },
  };
  if (options.target.type === "order" && "orderId" in options.target) {
    otherRunsWhere.orderId = options.target.orderId;
  } else if (options.target.type === "study" && "studyId" in options.target) {
    otherRunsWhere.studyId = options.target.studyId;
  }
  const overlappingRuns = await db.pipelineRun.findMany({
    where: otherRunsWhere,
    select: { inputSampleIds: true },
  });
  const isLastRun = !overlappingRuns.some((run) =>
    overlapsAffectedSamples(run.inputSampleIds, affectedSampleIds)
  );

  let readsDeleted = 0;
  let removedReadFiles = false;

  // Try discovery-based cleanup first (precise — only deletes matching files)
  if (options.runFolder) {
    let adapter = getAdapter(options.pipelineId);
    if (!adapter) {
      const genericAdapter = createGenericAdapter(options.pipelineId);
      if (genericAdapter) {
        registerAdapter(genericAdapter);
        adapter = genericAdapter;
      }
    }

    if (adapter) {
      const sampleReadOutputIds = new Set(
        pkg.manifest.outputs
          .filter((output) => output.destination === "sample_reads")
          .map((output) => output.id)
      );

      try {
        const outputDir = path.join(options.runFolder, "output");
        const discovered = await adapter.discoverOutputs({
          runId: options.runId,
          outputDir,
          target: options.target,
          samples: options.samples,
        });

        const resolvedDataBasePath = await getResolvedDataBasePath();
        if (resolvedDataBasePath.dataBasePath) {
          for (const file of discovered.files) {
            if (!file.outputId || !sampleReadOutputIds.has(file.outputId)) {
              continue;
            }
            const deleted = await cleanupMaterializedSampleRead(
              file,
              resolvedDataBasePath.dataBasePath,
              options.pipelineId,
              options.runId
            );
            if (deleted) {
              readsDeleted++;
              if (isFileProducingOutput(file)) {
                removedReadFiles = true;
              }
            }
          }
        }
      } catch {
        // Discovery may fail if run folder is incomplete — fall through to fallback
      }
    }
  }

  // Fallback: if this is the last run and discovery didn't clean up, determine
  // whether this pipeline creates read files or only writes metadata fields.
  if (isLastRun && readsDeleted === 0) {
    const sampleIds = options.samples.map((s) => s.id);
    if (sampleIds.length > 0) {
      // Check if any output produces file1 (i.e., creates the read files).
      // If not, the pipeline only writes metadata — clear those fields instead
      // of deleting the entire Read record.
      const producesFiles = pkg.manifest.outputs.some((output) => {
        if (output.destination !== "sample_reads") return false;
        // Heuristic: outputs with discovery patterns like *.json in a checksums/
        // dir are metadata-only; those that produce actual reads have file1 in
        // their discover script output. Check for known metadata-only ids.
        return !METADATA_ONLY_OUTPUT_IDS.has(output.id);
      });

      if (producesFiles) {
        const resolvedDataBasePath = await getResolvedDataBasePath();
        if (resolvedDataBasePath.dataBasePath) {
          const reads = await db.read.findMany({
            where: { sampleId: { in: sampleIds } },
            select: { id: true, file1: true, file2: true },
          });
          for (const read of reads) {
            await safeDeleteDataFile(resolvedDataBasePath.dataBasePath, read.file1);
            await safeDeleteDataFile(resolvedDataBasePath.dataBasePath, read.file2);
          }
        }
        const result = await db.read.deleteMany({ where: { sampleId: { in: sampleIds } } });
        readsDeleted = result.count ?? sampleIds.length;
        removedReadFiles = readsDeleted > 0;
      } else {
        // Metadata-only pipeline: null out the fields it writes
        const metadataFields = getOutputMetadataFields(pkg);
        if (metadataFields.length > 0) {
          const nullData: Record<string, null> = {};
          for (const field of metadataFields) {
            nullData[field] = null;
          }
          await db.read.updateMany({
            where: { sampleId: { in: sampleIds } },
            data: nullData,
          });
          readsDeleted = sampleIds.length;
        }
      }
    }
  }

  // Cascade-delete dependent pipeline runs when reads are removed
  if (removedReadFiles && isLastRun) {
    await cascadeDeleteDependentRuns(options);
  }
}

/**
 * Find and delete pipeline runs from other pipelines that also write to
 * `sample_reads` for the same order/study. These runs become invalid when
 * the underlying Read records are deleted.
 */
async function cascadeDeleteDependentRuns(
  options: CleanupRunOptions
): Promise<void> {
  const where: Record<string, unknown> = {
    pipelineId: { not: options.pipelineId },
    id: { not: options.runId },
  };
  if (options.target.type === "order" && "orderId" in options.target) {
    where.orderId = options.target.orderId;
  } else if (options.target.type === "study" && "studyId" in options.target) {
    where.studyId = options.target.studyId;
  } else {
    return;
  }

  const dependentRuns = await db.pipelineRun.findMany({
    where,
    select: { id: true, pipelineId: true, runFolder: true, inputSampleIds: true },
  });

  const affectedSampleIds = new Set(options.samples.map((sample) => sample.id));

  // Only cascade to overlapping pipelines that consume sample reads as input.
  const dependentReadPipelines = dependentRuns.filter((run) => {
    if (!overlapsAffectedSamples(run.inputSampleIds, affectedSampleIds)) {
      return false;
    }

    const depPkg = getPackage(run.pipelineId);
    if (!depPkg) return false;
    return consumesSampleReads(depPkg.manifest);
  });

  for (const depRun of dependentReadPipelines) {
    // Clean up related records
    await db.pipelineRunStep.deleteMany({ where: { pipelineRunId: depRun.id } });
    await db.pipelineArtifact.deleteMany({ where: { pipelineRunId: depRun.id } });
    await db.pipelineRun.delete({ where: { id: depRun.id } });

    // Remove run folder if it exists
    if (depRun.runFolder) {
      try {
        await fs.rm(depRun.runFolder, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }
}
