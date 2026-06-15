import fs from "fs/promises";
import path from "path";

import { db } from "@/lib/db";

import { createGenericAdapter } from "./generic-adapter";
import { getAdapter, registerAdapter } from "./adapters";
import { resolveOutputs, saveRunResults } from "./output-resolver";
import { processSubmgRunResults } from "./submg/submg-runner";
import type { PipelineTarget } from "./types";

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
  const discovered = await adapter.discoverOutputs({
    runId,
    outputDir,
    target: target || undefined,
    samples: samples.map((sample) => ({ id: sample.id, sampleId: sample.sampleId })),
  });

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
