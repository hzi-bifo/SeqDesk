"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FolderOpen,
  Hash,
  Loader2,
  Play,
  RefreshCw,
} from "lucide-react";
import type { OrderSequencingSummaryResponse } from "@/lib/sequencing/types";

const fetcher = (url: string) => fetch(url).then((response) => response.json());

type PipelineConfigProperty = {
  type: string;
  title: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
};

type AdminPipeline = {
  pipelineId: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  icon: string;
  config: Record<string, unknown>;
  configSchema: {
    properties: Record<string, PipelineConfigProperty>;
  };
  defaultConfig: Record<string, unknown>;
  input: {
    supportedScopes: string[];
    perSample: {
      reads: boolean;
      pairedEnd: boolean;
    };
  };
};

type PipelineRun = {
  id: string;
  runNumber: string;
  pipelineId: string;
  pipelineName: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function getStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge className="bg-emerald-600">Completed</Badge>;
    case "running":
      return <Badge className="bg-blue-600">Running</Badge>;
    case "queued":
      return <Badge variant="secondary">Queued</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "cancelled":
      return <Badge variant="outline">Cancelled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getReadinessIssues(
  pipeline: AdminPipeline | null,
  data: OrderSequencingSummaryResponse | undefined,
  selectedSampleIds: Set<string>
): string[] {
  if (!pipeline || !data) return [];

  const issues: string[] = [];
  const selectedSamples = data.samples.filter((sample) => selectedSampleIds.has(sample.id));

  if (selectedSamples.length === 0) {
    issues.push("Select at least one sample.");
    return issues;
  }

  for (const sample of selectedSamples) {
    if (pipeline.input.perSample.reads && !sample.read?.file1) {
      issues.push(`Sample ${sample.sampleId} is missing linked reads.`);
      continue;
    }

    if (pipeline.input.perSample.pairedEnd && !sample.read?.file2) {
      issues.push(`Sample ${sample.sampleId} requires a paired-end R2 file.`);
    }
  }

  return issues;
}

export default function OrderPipelinesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const requestedPipelineId = searchParams.get("pipeline");
  const { data: session, status: sessionStatus } = useSession();
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [selectedSamples, setSelectedSamples] = useState<Set<string>>(new Set());
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>({});
  const [startingPipelineId, setStartingPipelineId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const isFacilityAdmin = session?.user?.role === "FACILITY_ADMIN";

  const sequencingResponse = useSWR<OrderSequencingSummaryResponse>(
    isFacilityAdmin ? `/api/orders/${id}/sequencing` : null,
    fetcher
  );
  const pipelinesResponse = useSWR<{ pipelines: AdminPipeline[] }>(
    isFacilityAdmin ? "/api/admin/settings/pipelines?enabled=true" : null,
    fetcher
  );
  const runsResponse = useSWR<{ runs: PipelineRun[] }>(
    isFacilityAdmin ? `/api/pipelines/runs?orderId=${id}&limit=20` : null,
    fetcher
  );

  const orderScopedPipelines = useMemo(
    () =>
      (pipelinesResponse.data?.pipelines || []).filter(
        (pipeline) => pipeline.enabled && pipeline.input.supportedScopes.includes("order")
      ),
    [pipelinesResponse.data?.pipelines]
  );

  const selectedPipeline = useMemo(
    () =>
      orderScopedPipelines.find((pipeline) => pipeline.pipelineId === selectedPipelineId) || null,
    [orderScopedPipelines, selectedPipelineId]
  );

  useEffect(() => {
    const sampleIds = sequencingResponse.data?.samples.map((sample) => sample.id) || [];
    if (sampleIds.length === 0) return;
    setSelectedSamples((current) => (current.size > 0 ? current : new Set(sampleIds)));
  }, [sequencingResponse.data?.samples]);

  useEffect(() => {
    if (!orderScopedPipelines.length) return;
    setSelectedPipelineId((current) => {
      if (
        current &&
        orderScopedPipelines.some((pipeline) => pipeline.pipelineId === current)
      ) {
        return current;
      }

      if (
        requestedPipelineId &&
        orderScopedPipelines.some((pipeline) => pipeline.pipelineId === requestedPipelineId)
      ) {
        return requestedPipelineId;
      }

      return orderScopedPipelines[0].pipelineId;
    });
  }, [orderScopedPipelines, requestedPipelineId]);

  useEffect(() => {
    if (!selectedPipeline) return;
    setLocalConfig({ ...(selectedPipeline.config || selectedPipeline.defaultConfig || {}) });
  }, [selectedPipeline]);

  const readinessIssues = getReadinessIssues(
    selectedPipeline,
    sequencingResponse.data,
    selectedSamples
  );

  const isLoading =
    sessionStatus === "loading" ||
    sequencingResponse.isLoading ||
    pipelinesResponse.isLoading ||
    runsResponse.isLoading;

  const handleToggleSample = (sampleId: string) => {
    setSelectedSamples((current) => {
      const next = new Set(current);
      if (next.has(sampleId)) {
        next.delete(sampleId);
      } else {
        next.add(sampleId);
      }
      return next;
    });
  };

  const handleStartPipeline = async () => {
    if (!selectedPipeline) return;

    setStartingPipelineId(selectedPipeline.pipelineId);
    setError("");

    try {
      const createResponse = await fetch("/api/pipelines/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineId: selectedPipeline.pipelineId,
          orderId: id,
          sampleIds: Array.from(selectedSamples),
          config: localConfig,
        }),
      });

      const createPayload = await createResponse.json().catch(() => null);
      if (!createResponse.ok) {
        throw new Error(createPayload?.error || "Failed to create pipeline run");
      }

      const runId = createPayload?.run?.id as string | undefined;
      if (!runId) {
        throw new Error("Pipeline run was created without an id");
      }

      const startResponse = await fetch(`/api/pipelines/runs/${runId}/start`, {
        method: "POST",
      });
      const startPayload = await startResponse.json().catch(() => null);
      if (!startResponse.ok) {
        throw new Error(startPayload?.error || "Failed to start pipeline run");
      }

      await Promise.all([
        sequencingResponse.mutate(),
        runsResponse.mutate(),
      ]);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Failed to start pipeline");
    } finally {
      setStartingPipelineId(null);
    }
  };

  if (sessionStatus !== "loading" && !isFacilityAdmin) {
    return (
      <PageContainer>
        <Card>
          <CardHeader>
            <CardTitle>Order Pipelines</CardTitle>
            <CardDescription>This workspace is available only to facility administrators.</CardDescription>
          </CardHeader>
        </Card>
      </PageContainer>
    );
  }

  if (isLoading) {
    return (
      <PageContainer className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Button variant="ghost" size="sm" asChild className="mb-2 px-0">
              <Link href={`/orders/${id}`}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Order
              </Link>
            </Button>
            <h1 className="text-xl font-semibold">Order Pipelines</h1>
            <p className="text-sm text-muted-foreground">
              Run order-scoped utility pipelines on linked FASTQ files.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/orders/${id}/sequencing`}>
                <FolderOpen className="mr-2 h-4 w-4" />
                Sequencing Workspace
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void sequencingResponse.mutate();
                void pipelinesResponse.mutate();
                void runsResponse.mutate();
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {orderScopedPipelines.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No Order Pipelines Enabled</CardTitle>
              <CardDescription>
                Enable an order-scoped pipeline in admin settings before using this workspace.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Hash className="h-5 w-5" />
                  Available Pipelines
                </CardTitle>
                <CardDescription>
                  Select a pipeline, choose the order samples to include, and start the run.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  {orderScopedPipelines.map((pipeline) => {
                    const active = pipeline.pipelineId === selectedPipelineId;
                    return (
                      <button
                        key={pipeline.pipelineId}
                        type="button"
                        onClick={() => setSelectedPipelineId(pipeline.pipelineId)}
                        className={`rounded-lg border p-4 text-left transition ${
                          active
                            ? "border-foreground bg-secondary/40"
                            : "border-border hover:border-foreground/30"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">{pipeline.name}</div>
                          <Badge variant="outline">{pipeline.category}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">{pipeline.description}</p>
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h2 className="font-medium">Selected Samples</h2>
                      <p className="text-sm text-muted-foreground">
                        {sequencingResponse.data?.samples.length || 0} sample
                        {(sequencingResponse.data?.samples.length || 0) === 1 ? "" : "s"} in this order
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const ids = sequencingResponse.data?.samples.map((sample) => sample.id) || [];
                        setSelectedSamples(new Set(ids));
                      }}
                    >
                      Select All
                    </Button>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2">
                    {(sequencingResponse.data?.samples || []).map((sample) => (
                      <label
                        key={sample.id}
                        className="flex items-start gap-3 rounded-lg border px-3 py-2"
                      >
                        <Checkbox
                          checked={selectedSamples.has(sample.id)}
                          onCheckedChange={() => handleToggleSample(sample.id)}
                        />
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{sample.sampleId}</span>
                            {sample.read?.file1 ? (
                              <Badge variant="outline" className="text-emerald-700">
                                Reads linked
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-amber-700">
                                Missing reads
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {sample.read?.file1
                              ? sample.read.file2
                                ? "Paired-end FASTQ"
                                : "Single-end FASTQ"
                              : "No linked FASTQ files"}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {selectedPipeline &&
                Object.keys(selectedPipeline.configSchema.properties || {}).length > 0 ? (
                  <div className="space-y-3 rounded-lg border p-4">
                    <div>
                      <h2 className="font-medium">Pipeline Configuration</h2>
                      <p className="text-sm text-muted-foreground">
                        Configure this run before starting it.
                      </p>
                    </div>

                    <div className="grid gap-3">
                      {Object.entries(selectedPipeline.configSchema.properties).map(
                        ([key, property]) => {
                          if (property.type === "boolean") {
                            return (
                              <label
                                key={key}
                                className="flex items-start gap-3 rounded-lg border px-3 py-3"
                              >
                                <Checkbox
                                  checked={Boolean(localConfig[key])}
                                  onCheckedChange={(checked) =>
                                    setLocalConfig((current) => ({
                                      ...current,
                                      [key]: checked === true,
                                    }))
                                  }
                                />
                                <div className="space-y-1">
                                  <div className="font-medium">{property.title}</div>
                                  {property.description ? (
                                    <div className="text-xs text-muted-foreground">
                                      {property.description}
                                    </div>
                                  ) : null}
                                </div>
                              </label>
                            );
                          }

                          if (Array.isArray(property.enum) && property.enum.length > 0) {
                            return (
                              <div key={key} className="grid gap-1.5">
                                <label htmlFor={`pipeline-config-${key}`} className="text-sm font-medium">
                                  {property.title}
                                </label>
                                <select
                                  id={`pipeline-config-${key}`}
                                  value={String(localConfig[key] ?? property.default ?? property.enum[0] ?? "")}
                                  onChange={(event) =>
                                    setLocalConfig((current) => ({
                                      ...current,
                                      [key]: event.target.value,
                                    }))
                                  }
                                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                                >
                                  {property.enum.map((value) => (
                                    <option key={String(value)} value={String(value)}>
                                      {String(value)}
                                    </option>
                                  ))}
                                </select>
                                {property.description ? (
                                  <div className="text-xs text-muted-foreground">
                                    {property.description}
                                  </div>
                                ) : null}
                              </div>
                            );
                          }

                          return (
                            <div key={key} className="grid gap-1.5">
                              <label htmlFor={`pipeline-config-${key}`} className="text-sm font-medium">
                                {property.title}
                              </label>
                              <input
                                id={`pipeline-config-${key}`}
                                type={property.type === "number" ? "number" : "text"}
                                value={String(localConfig[key] ?? property.default ?? "")}
                                onChange={(event) =>
                                  setLocalConfig((current) => ({
                                    ...current,
                                    [key]:
                                      property.type === "number"
                                        ? Number(event.target.value)
                                        : event.target.value,
                                  }))
                                }
                                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                              />
                              {property.description ? (
                                <div className="text-xs text-muted-foreground">
                                  {property.description}
                                </div>
                              ) : null}
                            </div>
                          );
                        }
                      )}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>{selectedPipeline?.name || "Pipeline"}</CardTitle>
                  <CardDescription>
                    {selectedPipeline?.description || "Select a pipeline to review readiness."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {readinessIssues.length === 0 ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900">
                      <div className="flex items-center gap-2 font-medium">
                        <CheckCircle2 className="h-4 w-4" />
                        Ready to run
                      </div>
                      <p className="mt-1 text-emerald-800">
                        {selectedSamples.size} selected sample{selectedSamples.size === 1 ? "" : "s"} meet the current input requirements.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
                      <div className="flex items-center gap-2 font-medium">
                        <AlertCircle className="h-4 w-4" />
                        Action required
                      </div>
                      <div className="mt-2 space-y-1">
                        {readinessIssues.map((issue) => (
                          <div key={issue}>{issue}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  <Button
                    className="w-full"
                    disabled={!selectedPipeline || readinessIssues.length > 0 || startingPipelineId !== null}
                    onClick={handleStartPipeline}
                  >
                    {startingPipelineId === selectedPipeline?.pipelineId ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="mr-2 h-4 w-4" />
                    )}
                    Start Pipeline
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Recent Runs</CardTitle>
                  <CardDescription>
                    Order-scoped runs for this order.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {(runsResponse.data?.runs || []).length === 0 ? (
                    <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                      No runs started for this order yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(runsResponse.data?.runs || []).map((run) => (
                        <div
                          key={run.id}
                          className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{run.pipelineName}</span>
                              <span className="text-xs text-muted-foreground">{run.runNumber}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Created {formatDateTime(run.createdAt)} · Completed {formatDateTime(run.completedAt)}
                            </div>
                          </div>
                          {getStatusBadge(run.status)}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
