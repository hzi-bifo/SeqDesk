"use client";

import type { OrderProgressCompletionStatus } from "@/lib/orders/progress-status";
import type { PipelineRunStatus } from "@/lib/pipelines/types";

export interface PipelineProgressRunSummary {
  pipelineId: string;
  status: PipelineRunStatus;
}

export function getPipelineProgressStatuses(
  runs: PipelineProgressRunSummary[]
): Record<string, OrderProgressCompletionStatus> {
  const groupedRuns = new Map<string, PipelineProgressRunSummary[]>();

  for (const run of runs) {
    const existing = groupedRuns.get(run.pipelineId);
    if (existing) {
      existing.push(run);
    } else {
      groupedRuns.set(run.pipelineId, [run]);
    }
  }

  const statuses: Record<string, OrderProgressCompletionStatus> = {};

  for (const [pipelineId, pipelineRuns] of groupedRuns.entries()) {
    const hasActiveRun = pipelineRuns.some(
      (run) =>
        run.status === "pending" ||
        run.status === "queued" ||
        run.status === "running"
    );
    const hasCompletedRun = pipelineRuns.some(
      (run) => run.status === "completed"
    );
    const hasAttemptedRun = pipelineRuns.some(
      (run) => run.status === "failed" || run.status === "cancelled"
    );

    statuses[pipelineId] = hasActiveRun
      ? "partial"
      : hasCompletedRun
        ? "complete"
        : hasAttemptedRun
          ? "partial"
          : "empty";
  }

  return statuses;
}
