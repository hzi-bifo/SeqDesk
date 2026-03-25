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
  capabilities?: {
    requiresLinkedReads?: boolean;
  };
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

  const res = await fetch("/api/admin/settings/pipelines?enabled=true&catalog=order");
  if (!res.ok) {
    throw new Error("Failed to fetch pipeline definitions");
  }

  const data = (await res.json()) as {
    pipelines?: {
      pipelineId: string;
      name: string;
      enabled: boolean;
      capabilities?: {
        requiresLinkedReads?: boolean;
      };
    }[];
  };

  const items: OrderPipelineDefinition[] = (data.pipelines ?? [])
    .filter((pipeline) => pipeline.enabled)
    .map((pipeline) => ({
      pipelineId: pipeline.pipelineId,
      name: pipeline.name,
      capabilities: pipeline.capabilities,
    }));

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
        const [definitions, runsRes, seqRes] = await Promise.all([
          fetchOrderPipelineDefinitions(),
          fetch(`/api/pipelines/runs?orderId=${orderId}&limit=200`),
          fetch(`/api/orders/${orderId}/sequencing`),
        ]);

        const runsPayload = runsRes.ok
          ? (await runsRes.json()) as { runs?: PipelineRunSummary[] }
          : null;
        const seqPayload = seqRes.ok
          ? (await seqRes.json()) as { summary?: { readsLinkedSamples: number } }
          : null;
        const hasLinkedReads = (seqPayload?.summary?.readsLinkedSamples ?? 0) > 0;
        const statusByPipeline = getOrderPipelineProgressStatuses(
          runsPayload?.runs ?? []
        );

        // Pipelines that require linked reads (input.requiresReads or
        // outputs targeting sample_reads) should show "empty" when no
        // reads are linked, even if past runs exist.
        const readDependentPipelines = new Set(
          definitions
            .filter((pipeline) => pipeline.capabilities?.requiresLinkedReads === true)
            .map((p) => p.pipelineId)
        );

        if (!cancelled) {
          setFetchedPipelines(
            definitions.map((pipeline) => {
              let status = statusByPipeline[pipeline.pipelineId] ?? "empty";
              if (
                !hasLinkedReads &&
                readDependentPipelines.has(pipeline.pipelineId) &&
                status === "complete"
              ) {
                status = "empty";
              }
              return {
                pipelineId: pipeline.pipelineId,
                name: pipeline.name,
                status,
              };
            })
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
