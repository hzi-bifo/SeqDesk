import type { PipelineRunStatus } from "@/lib/pipelines/types";

export type PipelineProgressIndicatorStatus =
  | "empty"
  | "active"
  | "complete"
  | "failed";

export interface PipelineProgressRunSummary {
  pipelineId: string;
  status: PipelineRunStatus;
  createdAt?: string | Date | null;
}

export function getPipelineProgressStatuses(
  runs: PipelineProgressRunSummary[]
): Record<string, PipelineProgressIndicatorStatus> {
  const groupedRuns = new Map<string, PipelineProgressRunSummary[]>();

  for (const run of runs) {
    const existing = groupedRuns.get(run.pipelineId);
    if (existing) {
      existing.push(run);
    } else {
      groupedRuns.set(run.pipelineId, [run]);
    }
  }

  const statuses: Record<string, PipelineProgressIndicatorStatus> = {};

  for (const [pipelineId, pipelineRuns] of groupedRuns.entries()) {
    const hasActiveRun = pipelineRuns.some(
      (run) =>
        run.status === "pending" ||
        run.status === "queued" ||
        run.status === "running"
    );
    if (hasActiveRun) {
      statuses[pipelineId] = "active";
      continue;
    }

    const latestRun = [...pipelineRuns].sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : Number.NaN;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : Number.NaN;
      if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
      return bTime - aTime;
    })[0];

    if (latestRun?.status === "completed") {
      statuses[pipelineId] = "complete";
    } else if (
      latestRun?.status === "failed" ||
      latestRun?.status === "cancelled"
    ) {
      statuses[pipelineId] = "failed";
    } else {
      statuses[pipelineId] = "empty";
    }
  }

  return statuses;
}

export function getPipelineProgressIndicatorClassName(
  status: PipelineProgressIndicatorStatus
): string {
  switch (status) {
    case "complete":
      return "bg-emerald-500";
    case "active":
      return "bg-blue-500";
    case "failed":
      return "bg-red-500";
    default:
      return "bg-slate-300";
  }
}

export function getPipelineProgressIndicatorLabel(
  status: PipelineProgressIndicatorStatus
): string {
  switch (status) {
    case "complete":
      return "Pipeline completed";
    case "active":
      return "Pipeline queued or running";
    case "failed":
      return "Pipeline failed or cancelled";
    default:
      return "Pipeline not run";
  }
}
