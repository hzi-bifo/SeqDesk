import fs from "fs/promises";
import path from "path";

import { db } from "@/lib/db";

import { createGenericAdapter } from "./generic-adapter";
import { getAdapter, registerAdapter } from "./adapters";
import { resolveOutputs, saveRunResults } from "./output-resolver";
import { getPackage } from "./package-loader";
import { processSubmgRunResults } from "./submg/submg-runner";
import type { DiscoverOutputsResult } from "./adapters/types";
import type { PipelineTarget } from "./types";

// Bounded settle-retry for the run-scoped summary NFS-flush race.
// A run-scoped output (manifest scope:'run', e.g. fastqc 'summary') is written by
// the LAST process, AFTER the per-sample outputs. When a finalizer (the background
// monitor OR /sync) scans outputDir at the instant the run flips to completed, that
// late file may not yet be flushed/visible on the shared NFS, so simpleGlob returns
// 0 matches -> 0 DiscoveredFiles -> no PipelineArtifact row. A miss is silent (not an
// error), so the finalizer marks the run terminal and -- because runOnce only selects
// non-terminal runs -- it is NEVER revisited and the row is permanently absent.
// We re-scan a few times (only while a declared run-scoped output is still missing)
// so the late file is picked up. Re-discovery is idempotent: createArtifact skips an
// existing (run, path) row and saveRunResults overwrites the results JSON, so the
// extra scans cannot duplicate per-sample artifacts.
const RUN_SCOPED_SETTLE_ATTEMPTS = 3;
const RUN_SCOPED_SETTLE_DELAY_MS = 1000;

function getDeclaredRunScopedOutputIds(pipelineId: string): string[] {
  const pkg = getPackage(pipelineId);
  if (!pkg) return [];
  return pkg.manifest.outputs
    .filter((output) => output.scope === "run")
    .map((output) => output.id);
}

function allRunScopedOutputsDiscovered(
  discovered: DiscoverOutputsResult,
  declaredRunScopedOutputIds: string[]
): boolean {
  if (declaredRunScopedOutputIds.length === 0) return true;
  const discoveredOutputIds = new Set(
    discovered.files.map((file) => file.outputId).filter(Boolean)
  );
  return declaredRunScopedOutputIds.every((id) => discoveredOutputIds.has(id));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRunTarget(run: {
  targetType?: string | null;
  studyId?: string | null;
  orderId?: string | null;
}): PipelineTarget | null {
  if (run.targetType === "order" && run.orderId) {
    return { type: "order", orderId: run.orderId };
  }
  if (run.studyId) {
    return { type: "study", studyId: run.studyId };
  }
  return null;
}

export async function processCompletedPipelineRun(runId: string, pipelineId: string): Promise<void> {
  if (pipelineId === "submg") {
    await processSubmgRunResults(runId);
    return;
  }

  let adapter = getAdapter(pipelineId);
  if (!adapter) {
    const genericAdapter = createGenericAdapter(pipelineId);
    if (genericAdapter) {
      registerAdapter(genericAdapter);
      adapter = genericAdapter;
    }
  }

  if (!adapter) {
    return;
  }

  const run = await db.pipelineRun.findUnique({
    where: { id: runId },
    include: {
      study: {
        include: {
          samples: {
            select: { id: true, sampleId: true },
          },
        },
      },
      order: {
        include: {
          samples: {
            select: { id: true, sampleId: true },
          },
        },
      },
    },
  });

  if (!run || !run.runFolder) {
    return;
  }

  const target = getRunTarget(run);
  const samples = run.targetType === "order" ? run.order?.samples || [] : run.study?.samples || [];
  if (samples.length === 0) {
    return;
  }

  const outputDir = path.join(run.runFolder, "output");
  const discoverOptions = {
    runId,
    outputDir,
    target: target || undefined,
    samples: samples.map((sample) => ({ id: sample.id, sampleId: sample.sampleId })),
  };

  // Re-scan up to RUN_SCOPED_SETTLE_ATTEMPTS times while a declared run-scoped
  // output is still absent, to absorb the NFS-flush race on the late summary file.
  // When no run-scoped outputs are declared (e.g. read-cleaning, or in unit tests
  // that register no package), this loop scans exactly once.
  const declaredRunScopedOutputIds = getDeclaredRunScopedOutputIds(pipelineId);
  let discovered = await adapter.discoverOutputs(discoverOptions);
  for (
    let attempt = 1;
    attempt < RUN_SCOPED_SETTLE_ATTEMPTS &&
    !allRunScopedOutputsDiscovered(discovered, declaredRunScopedOutputIds);
    attempt++
  ) {
    await delay(RUN_SCOPED_SETTLE_DELAY_MS);
    discovered = await adapter.discoverOutputs(discoverOptions);
  }

  const result = await resolveOutputs(pipelineId, runId, discovered);
  await saveRunResults(runId, result);
}

export async function inferPipelineExitCode(runFolder: string): Promise<number | null> {
  const stdoutPath = path.join(runFolder, "logs", "pipeline.out");
  const stderrPath = path.join(runFolder, "logs", "pipeline.err");

  // ONLY the canonical marker written by the run wrapper's EXIT trap is
  // authoritative. generic-executor installs
  //   trap 'echo "Pipeline completed with exit code: $? at ..." >> pipeline.out' EXIT
  // so this line is appended exactly once, on actual process exit, and carries
  // the real exit status even when a command aborts under `set -e`. Its presence
  // therefore means "the run wrapper has finished"; its absence means "still
  // running" (or hard-killed without running the trap).
  //
  // We deliberately do NOT scrape generic "exit code: N" / "exited with code N"
  // substrings. Nextflow streams task error reports, conda/mamba solver output,
  // and tool logs into this same pipeline.out / pipeline.err WHILE the run is
  // still executing, and any of those can contain such a substring (commonly
  // "...exit code: 0"). Matching them made the monitor infer EXITED mid-run and
  // finalize the run as completed before Nextflow had done its real work — e.g.
  // metaxpath was marked "completed" while still building its conda env, with
  // classification never executed (a false-green run + gate).
  const marker = /Pipeline completed with exit code:\s*(\d+)/i;

  const readAndMatch = async (filePath: string): Promise<number | null> => {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split(/\r?\n/).slice(-80).join("\n");
      const match = lines.match(marker);
      if (match?.[1]) {
        const parsed = Number.parseInt(match[1], 10);
        if (!Number.isNaN(parsed)) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return null;
  };

  // The trap only ever writes the marker to pipeline.out; pipeline.err is checked
  // purely as a defensive fallback for the same authoritative marker.
  const stdoutCode = await readAndMatch(stdoutPath);
  if (stdoutCode !== null) {
    return stdoutCode;
  }

  return await readAndMatch(stderrPath);
}
