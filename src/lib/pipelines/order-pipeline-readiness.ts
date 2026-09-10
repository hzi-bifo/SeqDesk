import {
  assessPipelineSampleCompatibility,
  type PipelineCompatibilitySample,
  type PipelineInputRequirements,
} from "./input-compatibility";

export type OrderPipelineSampleReadiness = {
  ready: boolean;
  reason?: string;
};

export function getOrderPipelineSampleReadiness({
  pipeline,
  sample,
}: {
  pipeline: PipelineInputRequirements | null;
  sample: PipelineCompatibilitySample;
}): OrderPipelineSampleReadiness {
  if (!pipeline) return { ready: false, reason: "Pipeline not loaded" };

  const compatibility = assessPipelineSampleCompatibility(pipeline, sample);
  if (compatibility.status === "incompatible") {
    return { ready: false, reason: compatibility.reason };
  }
  // Unknown compatibility is advisory; existing launch validation remains the
  // authority for packages or older data without complete input declarations.
  return { ready: true };
}
