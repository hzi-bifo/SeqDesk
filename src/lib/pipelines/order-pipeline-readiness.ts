import { pipelineRequiresPairedReads } from "@/lib/pipelines/read-mode";
import { READ_CLEANING_PIPELINE_ID } from "@/lib/pipelines/simulate-reads-config";
import { isProtectedReadDataClass } from "@/lib/sequencing/constants";

type OrderPipelineReadinessPipeline = {
  pipelineId?: string;
  input: {
    perSample: {
      reads: boolean;
      pairedEnd: boolean;
      readMode?: "single_or_paired" | "paired_only";
    };
  };
};

type OrderPipelineReadinessSample = {
  read?: {
    file1?: string | null;
    file2?: string | null;
    dataClass?: string | null;
    filesMissing?: boolean | null;
  } | null;
};

export type OrderPipelineSampleReadiness = {
  ready: boolean;
  reason?: string;
};

export function getOrderPipelineSampleReadiness({
  pipeline,
  sample,
}: {
  pipeline: OrderPipelineReadinessPipeline | null;
  sample: OrderPipelineReadinessSample;
}): OrderPipelineSampleReadiness {
  if (!pipeline) return { ready: false, reason: "Pipeline not loaded" };

  if (pipeline.input.perSample.reads && !sample.read?.file1) {
    return { ready: false, reason: "Missing reads" };
  }

  if (
    pipeline.pipelineId === READ_CLEANING_PIPELINE_ID &&
    !isProtectedReadDataClass(sample.read?.dataClass)
  ) {
    return { ready: false, reason: "Needs raw or unknown reads" };
  }

  if (pipelineRequiresPairedReads(pipeline.input.perSample) && !sample.read?.file2) {
    return { ready: false, reason: "Missing R2 file" };
  }

  if (pipeline.input.perSample.reads && sample.read?.filesMissing) {
    return { ready: false, reason: "Files missing" };
  }

  return { ready: true };
}
