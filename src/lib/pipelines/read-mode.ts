import type { PipelinePerSampleInput, PipelineReadMode } from "./types";

type PipelinePerSampleInputLike = Pick<PipelinePerSampleInput, "reads" | "pairedEnd" | "readMode">;

export function resolvePipelineReadMode(
  perSample: PipelinePerSampleInputLike | null | undefined
): PipelineReadMode | null {
  if (!perSample?.reads) {
    return null;
  }

  if (perSample.readMode === "single_or_paired" || perSample.readMode === "paired_only") {
    return perSample.readMode;
  }

  return perSample.pairedEnd ? "paired_only" : "single_or_paired";
}

export function pipelineRequiresPairedReads(
  perSample: PipelinePerSampleInputLike | null | undefined
): boolean {
  return resolvePipelineReadMode(perSample) === "paired_only";
}

export function normalizePipelinePerSampleInput<T extends PipelinePerSampleInputLike>(
  perSample: T
): T & { pairedEnd: boolean; readMode?: PipelineReadMode } {
  const readMode = resolvePipelineReadMode(perSample);

  return {
    ...perSample,
    pairedEnd: readMode === "paired_only",
    ...(readMode ? { readMode } : {}),
  };
}
