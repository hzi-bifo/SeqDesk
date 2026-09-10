"use client";

import { useEffect, useState } from "react";
import { pipelinePageRequest } from "./page-request";
import type { PipelineRunDerivedSetting } from "@/components/pipelines/PipelineRunSettings";

export interface InputMetadataValidation {
  valid: boolean;
  issues: Array<{ field: string; message: string; severity: "error" | "warning"; fixUrl?: string }>;
  derivedSettings?: PipelineRunDerivedSetting[];
  metadata: Record<string, unknown>;
}

export function useInputMetadataCheck(args: {
  orderId: string;
  pipelineId?: string;
  sampleIdsKey: string;
  inputRevision: string;
  enabled: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const key = args.enabled && args.pipelineId && args.sampleIdsKey !== "[]"
    ? JSON.stringify([args.orderId, args.pipelineId, args.sampleIdsKey, args.inputRevision, attempt])
    : null;
  const [check, setCheck] = useState<{ key: string; data: InputMetadataValidation | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    const [orderId, pipelineId, sampleIdsKey] = JSON.parse(key) as string[];
    const controller = new AbortController();
    void (async () => {
      try {
        const data = await pipelinePageRequest<InputMetadataValidation>("/api/pipelines/validate-metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, pipelineId, sampleIds: JSON.parse(sampleIdsKey) }),
          signal: controller.signal,
        });
        if (typeof data.valid !== "boolean" || !Array.isArray(data.issues) || data.issues.some(issue =>
          !issue || typeof issue.message !== "string" || !["warning", "error"].includes(issue.severity))) {
          throw new Error("The server returned an incomplete input check. Please retry.");
        }
        if (!controller.signal.aborted) setCheck({ key, data, error: null });
      } catch (error) {
        if (!controller.signal.aborted) setCheck({ key, data: null, error: error instanceof Error ? error.message : "Could not check inputs. Please retry." });
      }
    })();
    return () => controller.abort();
  }, [key]);

  const current = key && check?.key === key ? check : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: Boolean(key && !current),
    retry: () => setAttempt(value => value + 1),
  };
}
