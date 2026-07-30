import fs from 'fs/promises';
import path from 'path';
import { db } from '@/lib/db';

const MAX_STAGED_FILES = 1_000;
const MAX_STAGED_BYTES = 2 * 1024 * 1024 * 1024;

export interface PriorRunArtifactStagingSpec {
  scope: 'study';
  configKey: string;
  sources: Record<string, string[]>;
}

export interface StagePriorRunArtifactsOptions {
  currentRunId: string;
  studyId: string;
  runFolder: string;
  spec: PriorRunArtifactStagingSpec;
}

export interface StagedPriorRunArtifact {
  pipelineRunId: string;
  pipelineId: string;
  artifactId: string;
  outputId: string;
  sourcePath: string;
  stagedPath: string;
  size: number;
}

export interface StagePriorRunArtifactsResult {
  inputDirectory: string;
  inventoryPath: string;
  artifacts: StagedPriorRunArtifact[];
  totalBytes: number;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function safePathSegment(value: string, fallback: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+$/, '');
  return safe || fallback;
}

async function resolveRegularArtifactPath(
  storedPath: string,
  priorRunFolder: string,
  context: string
): Promise<{ path: string; size: number }> {
  const canonicalRunFolder = await fs.realpath(priorRunFolder).catch(() => null);
  if (!canonicalRunFolder) {
    throw new Error(`${context}: prior run folder is missing or inaccessible: ${priorRunFolder}`);
  }

  const candidate = path.isAbsolute(storedPath)
    ? storedPath
    : path.resolve(canonicalRunFolder, storedPath);
  const stat = await fs.lstat(candidate).catch(() => null);
  if (!stat) {
    throw new Error(`${context}: artifact file is missing: ${candidate}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${context}: artifact must be a regular non-symlink file: ${candidate}`);
  }

  const canonicalArtifact = await fs.realpath(candidate);
  if (!isPathInside(canonicalRunFolder, canonicalArtifact)) {
    throw new Error(
      `${context}: artifact escapes its prior run folder (${canonicalArtifact} is not under ${canonicalRunFolder})`
    );
  }
  if (!Number.isSafeInteger(stat.size) || stat.size <= 0) {
    throw new Error(`${context}: artifact is empty or has an invalid size: ${canonicalArtifact}`);
  }

  return { path: canonicalArtifact, size: stat.size };
}

/**
 * Copy declared artifacts from completed runs of the same study into the new
 * run folder. Copies are used deliberately: the prepared run remains
 * self-contained and a compute node never has to follow an application-host
 * symlink outside the submitted run directory.
 */
export async function stagePriorRunArtifacts(
  options: StagePriorRunArtifactsOptions
): Promise<StagePriorRunArtifactsResult> {
  const { currentRunId, studyId, runFolder, spec } = options;
  const sourceEntries = Object.entries(spec.sources).filter(
    ([pipelineId, outputIds]) => pipelineId.trim() && outputIds.length > 0
  );
  if (sourceEntries.length === 0) {
    throw new Error('Prior-run artifact staging has no configured source outputs');
  }

  const allowedOutputs = new Map(
    sourceEntries.map(([pipelineId, outputIds]) => [pipelineId, new Set(outputIds)])
  );
  const priorRuns = await db.pipelineRun.findMany({
    where: {
      id: { not: currentRunId },
      status: 'completed',
      pipelineId: { in: sourceEntries.map(([pipelineId]) => pipelineId) },
      OR: [
        { studyId },
        {
          order: {
            is: {
              samples: {
                some: { studyId },
              },
            },
          },
        },
      ],
    },
    orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      pipelineId: true,
      studyId: true,
      runFolder: true,
      order: {
        select: {
          samples: {
            where: { studyId },
            select: { id: true },
          },
        },
      },
      artifacts: {
        select: {
          id: true,
          outputId: true,
          path: true,
          sampleId: true,
        },
      },
    },
  });

  const inputDirectory = path.join(runFolder, 'prior-run-inputs');
  await fs.mkdir(inputDirectory, { recursive: true, mode: 0o750 });

  const artifacts: StagedPriorRunArtifact[] = [];
  let totalBytes = 0;
  for (const priorRun of priorRuns) {
    if (!priorRun.runFolder) continue;
    const allowed = allowedOutputs.get(priorRun.pipelineId);
    if (!allowed) continue;
    const matchingOrderSampleIds = new Set(
      priorRun.order?.samples.map((sample) => sample.id) ?? []
    );

    for (const artifact of priorRun.artifacts) {
      if (!artifact.outputId || !allowed.has(artifact.outputId)) continue;
      const belongsToStudy =
        priorRun.studyId === studyId ||
        (artifact.sampleId !== null &&
          matchingOrderSampleIds.has(artifact.sampleId));
      if (!belongsToStudy) continue;
      const context =
        `Prior-run input ${priorRun.pipelineId}/${priorRun.id}/${artifact.id}` +
        ` (${artifact.outputId})`;
      const resolved = await resolveRegularArtifactPath(
        artifact.path,
        priorRun.runFolder,
        context
      );

      if (artifacts.length + 1 > MAX_STAGED_FILES) {
        throw new Error(
          `Prior-run artifact staging exceeds the ${MAX_STAGED_FILES}-file safety limit`
        );
      }
      if (totalBytes + resolved.size > MAX_STAGED_BYTES) {
        throw new Error(
          `Prior-run artifact staging exceeds the ${MAX_STAGED_BYTES}-byte safety limit`
        );
      }

      const destinationDirectory = path.join(
        inputDirectory,
        safePathSegment(priorRun.pipelineId, 'pipeline'),
        safePathSegment(priorRun.id, 'run'),
        safePathSegment(artifact.id, 'artifact')
      );
      await fs.mkdir(destinationDirectory, { recursive: true, mode: 0o750 });
      const stagedPath = path.join(destinationDirectory, path.basename(resolved.path));
      await fs.copyFile(resolved.path, stagedPath);
      await fs.chmod(stagedPath, 0o640);

      totalBytes += resolved.size;
      artifacts.push({
        pipelineRunId: priorRun.id,
        pipelineId: priorRun.pipelineId,
        artifactId: artifact.id,
        outputId: artifact.outputId,
        sourcePath: resolved.path,
        stagedPath,
        size: resolved.size,
      });
    }
  }

  if (artifacts.length === 0) {
    const expected = sourceEntries
      .map(([pipelineId, outputIds]) => `${pipelineId}: ${outputIds.join(', ')}`)
      .join('; ');
    throw new Error(
      `No usable QC artifacts from completed runs were found for study ${studyId}. ` +
        `Run a supported QC pipeline first (${expected}).`
    );
  }

  const inventoryPath = path.join(runFolder, 'prior-run-inputs.json');
  await fs.writeFile(
    inventoryPath,
    `${JSON.stringify(
      {
        version: 1,
        studyId,
        currentRunId,
        inputDirectory,
        totalBytes,
        artifacts,
      },
      null,
      2
    )}\n`,
    { encoding: 'utf8', mode: 0o640 }
  );

  return { inputDirectory, inventoryPath, artifacts, totalBytes };
}
