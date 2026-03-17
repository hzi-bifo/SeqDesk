import fs from "fs/promises";
import path from "path";

import { db } from "@/lib/db";
import { ensureWithinBase } from "@/lib/files";
import { getResolvedDataBasePath } from "@/lib/files/data-base-path";
import { getAdapter, registerAdapter, type DiscoveredFile } from "./adapters/types";
import { createGenericAdapter } from "./generic-adapter";
import { getPackage } from "./package-loader";
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

async function cleanupMaterializedSampleRead(
  file: DiscoveredFile,
  dataBasePath: string
): Promise<void> {
  if (!file.sampleId) return;

  const file1 = getStringMetadata(file.metadata, "file1");
  const file2 = getStringMetadata(file.metadata, "file2");

  if (!file1) {
    return;
  }

  const currentRead = await db.read.findFirst({
    where: { sampleId: file.sampleId },
    orderBy: { id: "asc" },
    select: {
      id: true,
      file1: true,
      file2: true,
    },
  });

  if (!currentRead) {
    return;
  }

  if (currentRead.file1 !== file1 || (currentRead.file2 ?? null) !== (file2 ?? null)) {
    return;
  }

  await safeDeleteDataFile(dataBasePath, currentRead.file1);
  await safeDeleteDataFile(dataBasePath, currentRead.file2);
  await db.read.delete({
    where: { id: currentRead.id },
  });
}

export async function cleanupRunOutputData(
  options: CleanupRunOptions
): Promise<void> {
  if (!options.runFolder) {
    return;
  }

  const pkg = getPackage(options.pipelineId);
  if (!pkg) {
    return;
  }

  const sampleReadOutputIds = new Set(
    pkg.manifest.outputs
      .filter((output) => output.destination === "sample_reads")
      .map((output) => output.id)
  );

  if (sampleReadOutputIds.size === 0) {
    return;
  }

  let adapter = getAdapter(options.pipelineId);
  if (!adapter) {
    const genericAdapter = createGenericAdapter(options.pipelineId);
    if (genericAdapter) {
      registerAdapter(genericAdapter);
      adapter = genericAdapter;
    }
  }

  if (!adapter) {
    return;
  }

  const outputDir = path.join(options.runFolder, "output");
  const discovered = await adapter.discoverOutputs({
    runId: options.runId,
    outputDir,
    target: options.target,
    samples: options.samples,
  });

  const resolvedDataBasePath = await getResolvedDataBasePath();
  if (!resolvedDataBasePath.dataBasePath) {
    return;
  }

  for (const file of discovered.files) {
    if (!file.outputId || !sampleReadOutputIds.has(file.outputId)) {
      continue;
    }

    await cleanupMaterializedSampleRead(file, resolvedDataBasePath.dataBasePath);
  }
}
