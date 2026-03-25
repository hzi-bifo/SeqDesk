"use client";

import { useEffect, useState } from "react";
import type { OrderProgressCompletionStatus } from "@/lib/orders/progress-status";
import type { PipelineRunStatus } from "@/lib/pipelines/types";
import { getPipelineProgressStatuses } from "./pipelineProgress";

export interface StudyPipelineNavItem {
  pipelineId: string;
  name: string;
  status: OrderProgressCompletionStatus;
}

interface StudyPipelineDefinition {
  pipelineId: string;
  name: string;
}

interface PipelineRunSummary {
  pipelineId: string;
  status: PipelineRunStatus;
}

const cache = new Map<string, StudyPipelineDefinition[]>();

async function fetchStudyPipelineDefinitions(): Promise<StudyPipelineDefinition[]> {
  const cacheKey = "study-pipelines";
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const res = await fetch("/api/admin/settings/pipelines?enabled=true&catalog=study");
  if (!res.ok) {
    throw new Error("Failed to fetch study pipeline definitions");
  }

  const data = (await res.json()) as {
    pipelines?: {
      pipelineId: string;
      name: string;
      enabled: boolean;
    }[];
  };

  const items: StudyPipelineDefinition[] = (data.pipelines ?? [])
    .filter((pipeline) => pipeline.enabled)
    .map((pipeline) => ({
      pipelineId: pipeline.pipelineId,
      name: pipeline.name,
    }));

  cache.set(cacheKey, items);
  return items;
}

export function useStudyPipelines(
  showAdminControls: boolean,
  studyId: string | null
): StudyPipelineNavItem[] {
  const [fetchedPipelines, setFetchedPipelines] = useState<StudyPipelineNavItem[]>([]);

  useEffect(() => {
    if (!showAdminControls || !studyId) {
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      try {
        const [definitions, runsRes] = await Promise.all([
          fetchStudyPipelineDefinitions(),
          fetch(`/api/pipelines/runs?studyId=${studyId}&limit=200`),
        ]);

        const runsPayload = runsRes.ok
          ? (await runsRes.json()) as { runs?: PipelineRunSummary[] }
          : null;
        const statusByPipeline = getPipelineProgressStatuses(
          runsPayload?.runs ?? []
        );

        if (!cancelled) {
          setFetchedPipelines(
            definitions.map((pipeline) => ({
              pipelineId: pipeline.pipelineId,
              name: pipeline.name,
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
  }, [showAdminControls, studyId]);

  return showAdminControls && studyId ? fetchedPipelines : [];
}
