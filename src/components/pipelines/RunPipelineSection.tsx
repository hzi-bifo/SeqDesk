"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Dna, FlaskConical, Loader2, Play, AlertCircle, CheckCircle2, XCircle, AlertTriangle, ChevronDown, Settings, ExternalLink } from "lucide-react";
import Link from "next/link";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface PrerequisiteCheck {
  id: string;
  name: string;
  description: string;
  status: "pass" | "fail" | "warning" | "unchecked";
  message: string;
  details?: string;
  required: boolean;
}

interface PrerequisiteResult {
  allPassed: boolean;
  requiredPassed: boolean;
  checks: PrerequisiteCheck[];
  summary: string;
}

interface MetadataIssue {
  field: string;
  message: string;
  severity: "error" | "warning";
  fixUrl?: string;
}

interface MetadataValidation {
  valid: boolean;
  issues: MetadataIssue[];
  metadata: {
    platform?: string;
    instrumentModel?: string;
    libraryStrategy?: string;
  };
}

interface Pipeline {
  pipelineId: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  config?: Record<string, unknown>;
  configSchema: {
    properties: Record<string, {
      type: string;
      title: string;
      description?: string;
      default?: unknown;
    }>;
  };
  defaultConfig: Record<string, unknown>;
}

interface Sample {
  id: string;
  sampleId: string;
  reads: { id: string; file1: string | null; file2: string | null }[];
}

interface RunPipelineSectionProps {
  studyId: string;
  samples: Sample[];
}

function getPipelineIcon(icon: string) {
  switch (icon) {
    case "Dna":
      return <Dna className="h-5 w-5" />;
    default:
      return <FlaskConical className="h-5 w-5" />;
  }
}

export function RunPipelineSection({ studyId, samples }: RunPipelineSectionProps) {
  const { data: pipelinesData } = useSWR(
    "/api/admin/settings/pipelines?enabled=true",
    fetcher
  );

  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null);
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>({});
  const [selectedSamples, setSelectedSamples] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{
    success: boolean;
    runId?: string;
    runNumber?: string;
    error?: string;
    details?: string[];
  } | null>(null);
  const [prerequisites, setPrerequisites] = useState<PrerequisiteResult | null>(null);
  const [loadingPrereqs, setLoadingPrereqs] = useState(false);
  const [prereqsExpanded, setPrereqsExpanded] = useState(false);

  // Metadata validation state
  const [metadataValidation, setMetadataValidation] = useState<MetadataValidation | null>(null);
  const [loadingMetadata, setLoadingMetadata] = useState(false);

  // Quick prerequisite check state (for disabling buttons)
  const [systemReady, setSystemReady] = useState<{ ready: boolean; summary: string } | null>(null);
  const [checkingSystem, setCheckingSystem] = useState(true);

  // Pre-check metadata for all pipelines on mount
  const [metadataPrecheck, setMetadataPrecheck] = useState<Record<string, MetadataValidation>>({});

  // Check system prerequisites on mount
  useEffect(() => {
    const checkSystem = async () => {
      setCheckingSystem(true);
      try {
        const res = await fetch("/api/admin/settings/pipelines/check-prerequisites?quick=true");
        if (res.ok) {
          const data = await res.json();
          setSystemReady(data);
        } else {
          setSystemReady({ ready: false, summary: "Could not check system" });
        }
      } catch {
        setSystemReady({ ready: false, summary: "Could not check system" });
      }
      setCheckingSystem(false);
    };
    checkSystem();
  }, []);

  const enabledPipelines: Pipeline[] = pipelinesData?.pipelines || [];

  // Pre-check metadata for enabled pipelines
  useEffect(() => {
    const checkMetadata = async () => {
      if (!enabledPipelines.length) return;

      const checks: Record<string, MetadataValidation> = {};
      for (const pipeline of enabledPipelines) {
        try {
          const res = await fetch("/api/pipelines/validate-metadata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studyId, pipelineId: pipeline.pipelineId }),
          });
          if (res.ok) {
            checks[pipeline.pipelineId] = await res.json();
          }
        } catch {
          // Ignore errors in precheck
        }
      }
      setMetadataPrecheck(checks);
    };
    checkMetadata();
  }, [enabledPipelines, studyId]);

  // Check which pipelines can run based on data availability
  const samplesWithReads = samples.filter(s =>
    s.reads.some(r => r.file1 && r.file2)
  );

  const canRunMag = samplesWithReads.length > 0;

  const openRunDialog = async (pipeline: Pipeline) => {
    setSelectedPipeline(pipeline);
    setLocalConfig({ ...(pipeline.config || pipeline.defaultConfig) });
    setSelectedSamples(new Set(samplesWithReads.map(s => s.id)));
    setRunResult(null);
    setPrerequisites(null);
    setMetadataValidation(null);
    setPrereqsExpanded(false);
    setRunDialogOpen(true);

    // Check prerequisites and metadata in parallel
    setLoadingPrereqs(true);
    setLoadingMetadata(true);

    try {
      const [prereqRes, metadataRes] = await Promise.all([
        fetch("/api/admin/settings/pipelines/check-prerequisites"),
        fetch("/api/pipelines/validate-metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studyId, pipelineId: pipeline.pipelineId }),
        }),
      ]);

      if (prereqRes.ok) {
        const data = await prereqRes.json();
        setPrerequisites(data);
        // Auto-expand if there are failures
        if (!data.requiredPassed) {
          setPrereqsExpanded(true);
        }
      }

      if (metadataRes.ok) {
        const data = await metadataRes.json();
        setMetadataValidation(data);
      }
    } catch (err) {
      console.error("Failed to check prerequisites:", err);
    } finally {
      setLoadingPrereqs(false);
      setLoadingMetadata(false);
    }
  };

  const toggleSample = (sampleId: string) => {
    const newSet = new Set(selectedSamples);
    if (newSet.has(sampleId)) {
      newSet.delete(sampleId);
    } else {
      newSet.add(sampleId);
    }
    setSelectedSamples(newSet);
  };

  const selectAllSamples = () => {
    setSelectedSamples(new Set(samplesWithReads.map(s => s.id)));
  };

  const deselectAllSamples = () => {
    setSelectedSamples(new Set());
  };

  const handleStartRun = async () => {
    if (!selectedPipeline || selectedSamples.size === 0) return;

    setRunning(true);
    setRunResult(null);

    try {
      const normalizeDetails = (value: unknown): string[] | undefined => {
        if (!value) return undefined;
        if (Array.isArray(value)) {
          return value.map((item) => String(item));
        }
        if (typeof value === "string") {
          return [value];
        }
        return [JSON.stringify(value)];
      };

      // Step 1: Create the run record
      const createRes = await fetch("/api/pipelines/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineId: selectedPipeline.pipelineId,
          studyId,
          sampleIds: Array.from(selectedSamples),
          config: localConfig,
        }),
      });

      let createData: Record<string, unknown> = {};
      try {
        createData = await createRes.json();
      } catch {
        // ignore
      }

      if (!createRes.ok) {
        setRunResult({
          success: false,
          error: (createData.error as string) || "Failed to create pipeline run",
          details: normalizeDetails(
            createData.details ?? `HTTP ${createRes.status}`
          ),
        });
        return;
      }

      const runId = (createData as { run?: { id?: string } }).run?.id;

      if (!runId) {
        setRunResult({
          success: false,
          error: "Failed to create pipeline run",
          details: ["Server returned success but no run ID was provided."],
        });
        return;
      }

      // Step 2: Start the run
      const startRes = await fetch(`/api/pipelines/runs/${runId}/start`, {
        method: "POST",
      });

      let startData: Record<string, unknown> = {};
      try {
        startData = await startRes.json();
      } catch {
        // ignore
      }

      if (!startRes.ok) {
        setRunResult({
          success: false,
          runId,
          error: (startData.error as string) || "Failed to start pipeline",
          details: normalizeDetails(
            startData.details ?? `HTTP ${startRes.status}`
          ),
        });
        return;
      }

      setRunResult({
        success: true,
        runId,
        runNumber: String((startData as { runNumber?: number }).runNumber || (createData as { run?: { runNumber?: number } }).run?.runNumber || ''),
      });
    } catch (err) {
      setRunResult({
        success: false,
        error: err instanceof Error ? err.message : "Failed to start pipeline",
      });
    } finally {
      setRunning(false);
    }
  };

  const getStatusIcon = (status: PrerequisiteCheck["status"]) => {
    switch (status) {
      case "pass":
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case "fail":
        return <XCircle className="h-4 w-4 text-red-600" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  if (enabledPipelines.length === 0) {
    return null;
  }

  return (
    <>
      <div className="mb-6 rounded-lg border p-5 bg-muted/30">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="font-semibold flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              Run Analysis
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {samplesWithReads.length} of {samples.length} samples have paired reads
            </p>
            {/* Show metadata issues summary */}
            {Object.entries(metadataPrecheck).map(([pipelineId, validation]) => {
              const errors = validation.issues.filter(i => i.severity === "error");
              const warnings = validation.issues.filter(i => i.severity === "warning");
              if (errors.length === 0 && warnings.length === 0) return null;
              return (
                <div key={pipelineId} className="mt-2">
                  {errors.map((issue, i) => (
                    <p key={i} className="text-sm text-red-600 flex items-center gap-1">
                      <XCircle className="h-4 w-4" />
                      {issue.message}
                      {issue.fixUrl && (
                        <Link href={issue.fixUrl} className="text-primary hover:underline ml-1 inline-flex items-center gap-0.5">
                          Fix <ExternalLink className="h-3 w-3" />
                        </Link>
                      )}
                    </p>
                  ))}
                  {warnings.map((issue, i) => (
                    <p key={i} className="text-sm text-yellow-600 flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4" />
                      {issue.message}
                    </p>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {checkingSystem ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking system...
          </div>
        ) : systemReady && !systemReady.ready ? (
          <div className="p-3 rounded-lg bg-yellow-50 border border-yellow-200">
            <p className="text-sm text-yellow-800 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {systemReady.summary}
            </p>
            <Link
              href="/admin/settings/pipelines"
              className="text-xs text-primary hover:underline mt-1 inline-flex items-center gap-1"
            >
              <Settings className="h-3 w-3" />
              Configure in Admin Settings
            </Link>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {enabledPipelines.map((pipeline) => {
              const canRun = pipeline.pipelineId === "mag" ? canRunMag : true;

              return (
                <Button
                  key={pipeline.pipelineId}
                  variant="outline"
                  className="h-auto py-3 px-4"
                  disabled={!canRun}
                  onClick={() => openRunDialog(pipeline)}
                >
                  <div className="flex items-center gap-3">
                    {getPipelineIcon(pipeline.icon)}
                    <div className="text-left">
                      <div className="font-medium">{pipeline.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {pipeline.description.length > 40
                          ? pipeline.description.substring(0, 40) + "..."
                          : pipeline.description}
                      </div>
                    </div>
                  </div>
                </Button>
              );
            })}
          </div>
        )}

        {systemReady?.ready && !canRunMag && samplesWithReads.length === 0 && (
          <p className="text-sm text-muted-foreground mt-3">
            <AlertCircle className="h-4 w-4 inline mr-1" />
            No samples have paired-end reads assigned. Assign files first.
          </p>
        )}
      </div>

      {/* Run Pipeline Dialog */}
      <Dialog open={runDialogOpen} onOpenChange={setRunDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedPipeline && getPipelineIcon(selectedPipeline.icon)}
              Run {selectedPipeline?.name}
            </DialogTitle>
            <DialogDescription>
              Select samples and configure the pipeline run
            </DialogDescription>
          </DialogHeader>

          {runResult ? (
            <div className="py-4">
              <div className={`p-4 rounded-lg border ${
                runResult.success
                  ? "bg-green-50 border-green-200"
                  : "bg-red-50 border-red-200"
              }`}>
                <div className="text-center">
                  {runResult.success ? (
                    <>
                      <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto mb-3" />
                      <p className="font-semibold text-lg">Pipeline Run Started</p>
                      {runResult.runNumber && (
                        <p className="text-sm text-muted-foreground mt-1 font-mono">
                          {runResult.runNumber}
                        </p>
                      )}
                      <p className="text-sm text-muted-foreground mt-3">
                        Your pipeline is now queued and will start processing shortly.
                        You can monitor progress in the Analysis section.
                      </p>
                      <div className="mt-4 flex flex-col gap-2">
                        <Link
                          href={`/dashboard/analysis/${runResult.runId}`}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
                        >
                          <FlaskConical className="h-4 w-4" />
                          View Run Details
                        </Link>
                        <Link
                          href="/dashboard/analysis"
                          className="text-sm text-muted-foreground hover:text-primary transition-colors"
                        >
                          Go to Analysis Dashboard
                        </Link>
                      </div>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-6 w-6 text-red-600 mx-auto mb-2" />
                      <p className="font-medium text-red-800">Failed to Start</p>
                      <p className="text-sm text-red-600 mt-1">
                        {runResult.error}
                      </p>
                      {runResult.details && runResult.details.length > 0 && (
                        <div className="mt-3 text-left bg-red-100 p-3 rounded text-xs">
                          <p className="font-medium text-red-800 mb-1">Details:</p>
                          <ul className="list-disc list-inside space-y-1 text-red-700">
                            {runResult.details.map((detail, i) => (
                              <li key={i}>{detail}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground mt-3">
                        <Link
                          href="/admin/settings/pipelines"
                          className="text-primary hover:underline inline-flex items-center gap-1"
                        >
                          <Settings className="h-3 w-3" />
                          Check Pipeline Settings
                        </Link>
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* System Requirements */}
              <div className="py-3 border-b">
                {loadingPrereqs ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking system requirements...
                  </div>
                ) : prerequisites ? (
                  <Collapsible open={prereqsExpanded} onOpenChange={setPrereqsExpanded}>
                    <CollapsibleTrigger asChild>
                      <button className="flex items-center justify-between w-full text-left hover:bg-muted/50 rounded p-2 -m-2">
                        <div className="flex items-center gap-2">
                          {prerequisites.requiredPassed ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-600" />
                          )}
                          <span className="text-sm font-medium">
                            System Requirements
                          </span>
                          <span className={`text-xs ${
                            prerequisites.requiredPassed
                              ? "text-green-600"
                              : "text-red-600"
                          }`}>
                            {prerequisites.summary}
                          </span>
                        </div>
                        <ChevronDown className={`h-4 w-4 transition-transform ${
                          prereqsExpanded ? "rotate-180" : ""
                        }`} />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-3 max-h-48 overflow-y-auto space-y-2 text-sm pr-1">
                        {prerequisites.checks
                          .filter((check) => check.status === "fail" || check.status === "warning" || check.required)
                          .map((check) => (
                          <div
                            key={check.id}
                            className={`flex items-start gap-2 p-2 rounded ${
                              check.status === "fail"
                                ? "bg-red-50"
                                : check.status === "warning"
                                ? "bg-yellow-50"
                                : ""
                            }`}
                          >
                            {getStatusIcon(check.status)}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{check.name}</span>
                                {check.required && check.status !== "pass" && (
                                  <span className="text-xs text-red-600">required</span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {check.message}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="pt-2 mt-2 border-t">
                        <Link
                          href="/admin/settings/pipelines"
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                        >
                          <Settings className="h-3 w-3" />
                          Configure Pipeline Settings
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ) : null}
              </div>

              {/* Metadata Validation */}
              {(loadingMetadata || metadataValidation) && (
                <div className="py-3 border-b">
                  {loadingMetadata ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Checking study metadata...
                    </div>
                  ) : metadataValidation ? (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        {metadataValidation.valid ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : metadataValidation.issues.some(i => i.severity === "error") ? (
                          <XCircle className="h-4 w-4 text-red-600" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        )}
                        <span className="text-sm font-medium">Study Metadata</span>
                        {metadataValidation.metadata.platform && (
                          <span className="text-xs text-muted-foreground">
                            Platform: {metadataValidation.metadata.platform}
                          </span>
                        )}
                      </div>
                      {metadataValidation.issues.length > 0 && (
                        <div className="space-y-1 ml-6">
                          {metadataValidation.issues.map((issue, i) => (
                            <div
                              key={i}
                              className={`text-sm flex items-center gap-2 ${
                                issue.severity === "error" ? "text-red-600" : "text-yellow-600"
                              }`}
                            >
                              {issue.severity === "error" ? (
                                <XCircle className="h-3 w-3" />
                              ) : (
                                <AlertTriangle className="h-3 w-3" />
                              )}
                              <span>{issue.message}</span>
                              {issue.fixUrl && (
                                <Link
                                  href={issue.fixUrl}
                                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                                >
                                  Fix <ExternalLink className="h-3 w-3" />
                                </Link>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}

              {/* Sample Selection */}
              <div className="py-4">
                <div className="flex items-center justify-between mb-3">
                  <Label>Samples ({selectedSamples.size} selected)</Label>
                  <div className="flex gap-2 text-xs">
                    <button
                      className="text-primary hover:underline"
                      onClick={selectAllSamples}
                    >
                      Select All
                    </button>
                    <span className="text-muted-foreground">|</span>
                    <button
                      className="text-primary hover:underline"
                      onClick={deselectAllSamples}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="max-h-48 overflow-y-auto border rounded-lg p-2 space-y-1">
                  {samplesWithReads.map((sample) => (
                    <div
                      key={sample.id}
                      className="flex items-center gap-2 p-2 rounded hover:bg-muted/50"
                    >
                      <Checkbox
                        id={`sample-${sample.id}`}
                        checked={selectedSamples.has(sample.id)}
                        onCheckedChange={() => toggleSample(sample.id)}
                      />
                      <Label
                        htmlFor={`sample-${sample.id}`}
                        className="flex-1 cursor-pointer"
                      >
                        {sample.sampleId}
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        {sample.reads.filter(r => r.file1 && r.file2).length} read pair(s)
                      </span>
                    </div>
                  ))}

                  {samplesWithReads.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No samples with paired reads
                    </p>
                  )}
                </div>
              </div>

              {/* Configuration */}
              {selectedPipeline && Object.keys(selectedPipeline.configSchema.properties).length > 0 && (
                <div className="border-t pt-4">
                  <Label className="mb-3 block">Configuration</Label>
                <div className="space-y-3">
                  {Object.entries(selectedPipeline.configSchema.properties).map(
                    ([key, schema]) => {
                      if (schema.type === "boolean") {
                        return (
                          <div key={key} className="flex items-start gap-2">
                            <Checkbox
                              id={`config-${key}`}
                              checked={localConfig[key] as boolean}
                              onCheckedChange={(checked) =>
                                setLocalConfig((prev) => ({
                                  ...prev,
                                  [key]: checked,
                                }))
                              }
                            />
                            <div className="grid gap-1 leading-none">
                              <Label htmlFor={`config-${key}`} className="text-sm">
                                {schema.title}
                              </Label>
                              {schema.description && (
                                <p className="text-xs text-muted-foreground">
                                  {schema.description}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div key={key} className="grid gap-1">
                          <Label htmlFor={`config-${key}`} className="text-sm">
                            {schema.title}
                          </Label>
                          <input
                            id={`config-${key}`}
                            type={schema.type === "number" ? "number" : "text"}
                            value={String(localConfig[key] ?? "")}
                            onChange={(e) =>
                              setLocalConfig((prev) => ({
                                ...prev,
                                [key]:
                                  schema.type === "number"
                                    ? Number(e.target.value)
                                    : e.target.value,
                              }))
                            }
                            className="w-full px-3 py-2 border rounded-md bg-background text-sm"
                          />
                          {schema.description && (
                            <p className="text-xs text-muted-foreground">
                              {schema.description}
                            </p>
                          )}
                        </div>
                      );
                    }
                  )}
                </div>
                </div>
              )}
            </>
          )}

          <DialogFooter>
            {runResult ? (
              <Button onClick={() => setRunDialogOpen(false)}>Close</Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => setRunDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleStartRun}
                  disabled={
                    running ||
                    selectedSamples.size === 0 ||
                    loadingPrereqs ||
                    loadingMetadata ||
                    (prerequisites !== null && !prerequisites.requiredPassed) ||
                    (metadataValidation !== null && metadataValidation.issues.some(i => i.severity === "error"))
                  }
                >
                  {running ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Start Pipeline
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
