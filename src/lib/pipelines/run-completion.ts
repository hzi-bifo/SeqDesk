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

  const patterns = [
    /Pipeline completed with exit code:\s*(\d+)/i,
    /exit code[:=]\s*(\d+)/i,
    /exited with code\s*(\d+)/i,
  ];

  const readAndMatch = async (filePath: string): Promise<number | null> => {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split(/\r?\n/).slice(-80).join("\n");
      for (const pattern of patterns) {
        const match = lines.match(pattern);
        if (!match?.[1]) continue;
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

  const stdoutCode = await readAndMatch(stdoutPath);
  if (stdoutCode !== null) {
    return stdoutCode;
  }

  const stderrCode = await readAndMatch(stderrPath);
  if (stderrCode !== null) {
    return stderrCode;
  }

  return null;
}
