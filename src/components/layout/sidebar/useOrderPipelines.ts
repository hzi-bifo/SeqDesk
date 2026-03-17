"use client";

import { useEffect, useState } from "react";
import type { OrderProgressCompletionStatus } from "@/lib/orders/progress-status";
import type { PipelineRunStatus } from "@/lib/pipelines/types";

export interface OrderPipelineNavItem {
  pipelineId: string;
  name: string;
  status: OrderProgressCompletionStatus;
}

interface OrderPipelineDefinition {
  pipelineId: string;
  name: string;
}

interface PipelineRunSummary {
  pipelineId: string;
  status: PipelineRunStatus;
}

const cache = new Map<string, OrderPipelineDefinition[]>();

export function getOrderPipelineProgressStatuses(
  runs: PipelineRunSummary[]
): Record<string, OrderProgressCompletionStatus> {
  const groupedRuns = new Map<string, PipelineRunSummary[]>();

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
    const hasCompletedRun = pipelineRuns.some((run) => run.status === "completed");
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

async function fetchOrderPipelineDefinitions(): Promise<OrderPipelineDefinition[]> {
  const cacheKey = "order-pipelines";
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const res = await fetch("/api/admin/settings/pipelines?enabled=true");
  if (!res.ok) {
    throw new Error("Failed to fetch pipeline definitions");
  }

  const data = (await res.json()) as {
    pipelines?: {
      pipelineId: string;
      name: string;
      enabled: boolean;
      input?: { supportedScopes?: string[] };
    }[];
  };

  const items: OrderPipelineDefinition[] = (data.pipelines ?? [])
    .filter(
      (pipeline) =>
        pipeline.enabled && pipeline.input?.supportedScopes?.includes("order")
    )
    .map((pipeline) => ({ pipelineId: pipeline.pipelineId, name: pipeline.name }));

  cache.set(cacheKey, items);
  return items;
}

/**
 * Fetches enabled order-scoped pipelines for the sidebar nav.
 * Only fetches when showAdminControls is true and orderId is provided.
 */
export function useOrderPipelines(
  showAdminControls: boolean,
  orderId: string | null
): OrderPipelineNavItem[] {
  const [fetchedPipelines, setFetchedPipelines] = useState<OrderPipelineNavItem[]>([]);

  useEffect(() => {
    if (!showAdminControls || !orderId) {
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      try {
        const [definitions, runsRes] = await Promise.all([
          fetchOrderPipelineDefinitions(),
          fetch(`/api/pipelines/runs?orderId=${orderId}&limit=200`),
        ]);

        const runsPayload = runsRes.ok
          ? (await runsRes.json()) as { runs?: PipelineRunSummary[] }
          : null;
        const statusByPipeline = getOrderPipelineProgressStatuses(
          runsPayload?.runs ?? []
        );

        if (!cancelled) {
          setFetchedPipelines(
            definitions.map((pipeline) => ({
              ...pipeline,
              status: statusByPipeline[pipeline.pipelineId] ?? "empty",
            }))
          );
        }
      } catch {
        if (!cancelled) {
          setFetchedPipelines([]);
        }
      }
    };

    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [showAdminControls, orderId]);

  return showAdminControls && orderId ? fetchedPipelines : [];
}
