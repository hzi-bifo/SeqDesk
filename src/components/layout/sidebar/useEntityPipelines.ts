"use client";

import { useEffect, useState } from "react";
import {
  assessPipelineInputCompatibility,
  type PipelineCompatibilitySample,
} from "@/lib/pipelines/input-compatibility";
import { startVisiblePolling } from "@/lib/polling";
import {
  getPipelineProgressStatuses,
  type PipelineProgressIndicatorStatus,
  type PipelineProgressRunSummary,
} from "./pipelineProgress";

export type PipelineInputCompatibility = ReturnType<typeof assessPipelineInputCompatibility>;

export interface EntityPipelineNavItem {
  pipelineId: string;
  name: string;
  category: string;
  status: PipelineProgressIndicatorStatus;
  runIds: string[];
  compatibility: PipelineInputCompatibility;
}

type PipelineDefinition = Parameters<typeof assessPipelineInputCompatibility>[0] & {
  pipelineId: string;
  name: string;
  category?: string;
  enabled: boolean;
};

type PipelineRunSummary = PipelineProgressRunSummary & { id?: string };
type EntityType = "order" | "study";
const definitionsCache = new Map<EntityType, {
  definitions: PipelineDefinition[];
  fetchedAt: number;
}>();
const pendingDefinitions = new Map<EntityType, Promise<PipelineDefinition[]>>();
const DEFINITION_CACHE_MS = 60_000;

async function fetchDefinitions(entityType: EntityType): Promise<PipelineDefinition[]> {
  const cached = definitionsCache.get(entityType);
  if (cached && Date.now() - cached.fetchedAt < DEFINITION_CACHE_MS) {
    return cached.definitions;
  }
  const pending = pendingDefinitions.get(entityType);
  if (pending) return pending;

  const request = (async () => {
    try {
      const response = await fetch(`/api/admin/settings/pipelines?enabled=true&catalog=${entityType}`);
      if (!response.ok) throw new Error("Failed to fetch pipeline definitions");
      const data = await response.json() as { pipelines?: PipelineDefinition[] };
      const definitions = (data.pipelines ?? []).filter((pipeline) => pipeline.enabled);
      definitionsCache.set(entityType, { definitions, fetchedAt: Date.now() });
      return definitions;
    } catch (error) {
      if (cached) return cached.definitions;
      throw error;
    } finally {
      pendingDefinitions.delete(entityType);
    }
  })();
  pendingDefinitions.set(entityType, request);
  return request;
}

async function fetchPayload<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    return response.ok ? await response.json() as T : null;
  } catch {
    return null;
  }
}

export function useEntityPipelines(
  entityType: EntityType,
  showAdminControls: boolean,
  entityId: string | null,
  enablePolling: boolean
): EntityPipelineNavItem[] {
  const entityKey = showAdminControls && entityId ? `${entityType}:${entityId}` : null;
  const [state, setState] = useState<{ key: string | null; items: EntityPipelineNavItem[] }>({
    key: null,
    items: [],
  });

  useEffect(() => {
    if (!entityKey || !entityId) return;
    let cancelled = false;
    let refreshSequence = 0;
    const samplesUrl = entityType === "order"
      ? `/api/orders/${entityId}/pipeline-input`
      : `/api/studies/${entityId}`;

    const refresh = async () => {
      const sequence = ++refreshSequence;
      const [definitionsResult, runsResult, samplesResult] = await Promise.allSettled([
        fetchDefinitions(entityType),
        fetchPayload<{ runs?: PipelineRunSummary[] }>(`/api/pipelines/runs?${entityType}Id=${entityId}&limit=200`),
        fetchPayload<{ samples?: PipelineCompatibilitySample[] }>(samplesUrl),
      ]);
      if (cancelled || sequence !== refreshSequence) return;
      // A failed data request must not remove the available pipeline links.
      if (definitionsResult.status !== "fulfilled") return;
      const runsPayload = runsResult.status === "fulfilled" ? runsResult.value : null;
      const samplesPayload = samplesResult.status === "fulfilled" ? samplesResult.value : null;
      const samples = Array.isArray(samplesPayload?.samples) ? samplesPayload.samples : null;
      const statusByPipeline = getPipelineProgressStatuses(runsPayload?.runs ?? []);
      const runIdsByPipeline = new Map<string, string[]>();
      for (const run of runsPayload?.runs ?? []) {
        if (!run.id) continue;
        const runIds = runIdsByPipeline.get(run.pipelineId) ?? [];
        runIds.push(run.id);
        runIdsByPipeline.set(run.pipelineId, runIds);
      }

      setState((previous) => ({
        key: entityKey,
        items: definitionsResult.value.map((pipeline) => {
          const previousItem = previous.key === entityKey
            ? previous.items.find((item) => item.pipelineId === pipeline.pipelineId)
            : undefined;
          return {
            pipelineId: pipeline.pipelineId,
            name: pipeline.name,
            category: pipeline.category ?? "analysis",
            status: runsPayload
              ? statusByPipeline[pipeline.pipelineId] ?? "empty"
              : previousItem?.status ?? "empty",
            runIds: runsPayload
              ? runIdsByPipeline.get(pipeline.pipelineId) ?? []
              : previousItem?.runIds ?? [],
            compatibility: assessPipelineInputCompatibility(pipeline, samples),
          };
        }),
      }));
    };

    void refresh();
    const stopPolling = enablePolling
      ? startVisiblePolling(() => void refresh(), 15_000)
      : () => undefined;
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [enablePolling, entityId, entityKey, entityType]);

  return entityKey && state.key === entityKey ? state.items : [];
}
