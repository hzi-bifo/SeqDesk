"use client";

import { PageNotice } from "@/components/ui/page-notice";
import {
  assessPipelineInputCompatibility,
  type PipelineCompatibilitySample,
  type PipelineInputRequirements,
} from "@/lib/pipelines/input-compatibility";

export function PipelineInputCompatibilityNotice({ pipeline, samples }: {
  pipeline: PipelineInputRequirements | null;
  samples: PipelineCompatibilitySample[];
}) {
  if (!pipeline) return null;
  const compatibility = assessPipelineInputCompatibility(pipeline, samples);
  if (compatibility.status === "compatible") return null;

  return (
    <PageNotice variant="info" title={compatibility.summary} className="rounded-xl border">
      <div className="space-y-1">
        {compatibility.reasons.map(({ reason, count }) => (
          <p key={reason}>{count} sample{count === 1 ? "" : "s"}: {reason}.</p>
        ))}
        <p>Known input mismatches are excluded from sample selection. Unknown compatibility can still be checked when starting a run.</p>
      </div>
    </PageNotice>
  );
}
