"use client";

import { useState, useEffect, useMemo } from "react";
import useSWR from "swr";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dna,
  FlaskConical,
  Upload,
  Loader2,
  Play,
  AlertCircle,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  Settings,
  ExternalLink,
  Clock,
  Package,
  ArrowRight,
  Layers,
} from "lucide-react";
import { PipelineDataFlowSummary } from "@/components/pipelines/PipelineDataFlow";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface PipelineInput {
  id: string;
  name: string;
  description: string;
  fileTypes: string[];
  source: string;
  sourceDescription: string;
}

interface PipelineOutput {
  id: string;
  name: string;
  description: string;
  fromStep: string;
  fileTypes: string[];
  destination: string;
  destinationField?: string;
  destinationDescription: string;
}

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
  version?: string;
  category?: string;
  config?: Record<string, unknown>;
  configSchema: {
    properties: Record<
      string,
      {
        type: string;
        title: string;
        description?: string;
        default?: unknown;
      }
    >;
  };
  defaultConfig: Record<string, unknown>;
}

interface Sample {
  id: string;
  sampleId: string;
  reads: { id: string; file1: string | null; file2: string | null }[];
}

interface PipelineRun {
  id: string;
  runNumber: string;
  pipelineId: string;
  pipelineName: string;
  pipelineIcon: string;
  status: string;
  progress: number | null;
  currentStep: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  _count?: {
    assembliesCreated: number;
    binsCreated: number;
  };
}

interface StudyPipelinesSectionProps {
  studyId: string;
  samples: Sample[];
}

function getPipelineIcon(icon: string) {
  switch (icon) {
    case "Dna":
      return <Dna className="h-5 w-5" />;
    case "Upload":
      return <Upload className="h-5 w-5" />;
    default:
      return <FlaskConical className="h-5 w-5" />;
  }
}

function getCategoryColor(category: string): string {
  switch (category) {
    case "metagenomics":
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "transcriptomics":
      return "bg-blue-100 text-blue-700 border-blue-200";
    case "amplicon":
      return "bg-purple-100 text-purple-700 border-purple-200";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-green-100 text-green-700 border-green-200">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Completed
        </Badge>
      );
    case "running":
      return (
        <Badge className="bg-blue-100 text-blue-700 border-blue-200">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Running
        </Badge>
      );
    case "queued":
      return (
        <Badge className="bg-amber-100 text-amber-700 border-amber-200">
          <Clock className="h-3 w-3 mr-1" />
          Queued
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-red-100 text-red-700 border-red-200">
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    case "pending":
      return (
        <Badge variant="outline">
          <Clock className="h-3 w-3 mr-1" />
          Pending
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function formatRelativeTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function StudyPipelinesSection({
  studyId,
  samples,
}: StudyPipelinesSectionProps) {
  // Fetch enabled pipelines
  const { data: pipelinesData } = useSWR(
    "/api/admin/settings/pipelines?enabled=true",
    fetcher
  );

  // Fetch pipeline runs for this study
  const {
    data: runsData,
    mutate: mutateRuns,
  } = useSWR(`/api/pipelines/runs?studyId=${studyId}&limit=10`, fetcher, {
    refreshInterval: 10000,
  });

  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(
    null
  );
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>({});
  const [selectedSamples, setSelectedSamples] = useState<Set<string>>(
    new Set()
  );
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{
    success: boolean;
    runId?: string;
    runNumber?: string;
    error?: string;
    details?: string[];
  } | null>(null);
  const [prerequisites, setPrerequisites] =
    useState<PrerequisiteResult | null>(null);
  const [loadingPrereqs, setLoadingPrereqs] = useState(false);
  const [prereqsExpanded, setPrereqsExpanded] = useState(false);
  const [metadataValidation, setMetadataValidation] =
    useState<MetadataValidation | null>(null);
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [metadataPrecheck, setMetadataPrecheck] = useState<
    Record<string, MetadataValidation>
  >({});

  // Pipeline definition for data flow display
  const [pipelineDefinition, setPipelineDefinition] = useState<{
    inputs: PipelineInput[];
    outputs: PipelineOutput[];
  } | null>(null);
  const [showDataFlow, setShowDataFlow] = useState(false);

  // System ready state
  const [systemReady, setSystemReady] = useState<{
    ready: boolean;
    summary: string;
  } | null>(null);
  const [checkingSystem, setCheckingSystem] = useState(true);

  // Check system prerequisites on mount
  useEffect(() => {
    const checkSystem = async () => {
      setCheckingSystem(true);
      try {
        const res = await fetch(
          "/api/admin/settings/pipelines/check-prerequisites?quick=true"
        );
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

  const enabledPipelines: Pipeline[] = useMemo(
    () => pipelinesData?.pipelines || [],
    [pipelinesData]
  );
  const pipelineRuns: PipelineRun[] = runsData?.runs || [];

  // Pre-check metadata for enabled pipelines so cards reflect runability
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
  const samplesWithReads = samples.filter((s) =>
    s.reads?.some((r) => r.file1 && r.file2)
  );
  const canRunMag = samplesWithReads.length > 0;

  const openRunDialog = async (pipeline: Pipeline) => {
    setSelectedPipeline(pipeline);
    setLocalConfig({ ...(pipeline.config || pipeline.defaultConfig) });
    setSelectedSamples(new Set(samplesWithReads.map((s) => s.id)));
    setRunResult(null);
    setPrerequisites(null);
    setMetadataValidation(null);
    setPipelineDefinition(null);
    setPrereqsExpanded(false);
    setShowDataFlow(false);
    setRunDialogOpen(true);

    // Check prerequisites, metadata, and fetch definition in parallel
    setLoadingPrereqs(true);
    setLoadingMetadata(true);

    try {
      const [prereqRes, metadataRes, defRes] = await Promise.all([
        fetch("/api/admin/settings/pipelines/check-prerequisites"),
        fetch("/api/pipelines/validate-metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studyId, pipelineId: pipeline.pipelineId }),
        }),
        fetch(`/api/admin/settings/pipelines/${pipeline.pipelineId}/definition`),
      ]);

      if (prereqRes.ok) {
        const data = await prereqRes.json();
        setPrerequisites(data);
        if (!data.requiredPassed) {
          setPrereqsExpanded(true);
        }
      }

      if (metadataRes.ok) {
        const data = await metadataRes.json();
        setMetadataValidation(data);
      }

      if (defRes.ok) {
        const data = await defRes.json();
        setPipelineDefinition({
          inputs: data.inputs || [],
          outputs: data.outputs || [],
        });
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
    setSelectedSamples(new Set(samplesWithReads.map((s) => s.id)));
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
          error:
            (createData.error as string) || "Failed to create pipeline run",
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
        runNumber: String(
          (startData as { runNumber?: number }).runNumber ||
            (createData as { run?: { runNumber?: number } }).run?.runNumber ||
            ""
        ),
      });

      // Refresh runs list
      mutateRuns();
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

  // If no pipelines are enabled, show nothing
  if (enabledPipelines.length === 0 && pipelineRuns.length === 0) {
    return null;
  }

  return (
    <>
      {/* System warning */}
      {checkingSystem ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking system requirements...
        </div>
      ) : systemReady && !systemReady.ready ? (
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 mb-4">
          <p className="text-sm text-amber-800 flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4" />
            {systemReady.summary}
          </p>
          <Link
            href="/admin/settings/pipelines"
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            <Settings className="h-3 w-3" />
            Configure Pipeline Settings
          </Link>
        </div>
      ) : null}

      {/* Pipeline cards */}
      {samplesWithReads.length === 0 ? (
        <div className="text-center py-8 bg-muted/30 rounded-lg border border-dashed mb-4">
          <Package className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium mb-1">No Samples Ready</p>
          <p className="text-sm text-muted-foreground">
            Assign paired-end read files to run analysis pipelines
          </p>
        </div>
      ) : (
        <>
          {/* Sample readiness */}
          <div className="flex items-center gap-2 text-sm mb-3">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span>
              <strong>{samplesWithReads.length}</strong> of {samples.length} samples ready
            </span>
          </div>

          {/* Pipeline cards - admin-style */}
          <div className="grid gap-4 sm:grid-cols-2 mb-6">
            {enabledPipelines.map((pipeline) => {
              const validation = metadataPrecheck[pipeline.pipelineId];
              const hasMetadataErrors = validation
                ? validation.issues.some((issue) => issue.severity === "error")
                : pipeline.pipelineId === "submg";
              const canRun =
                (pipeline.pipelineId === "mag" ? canRunMag : true) &&
                !hasMetadataErrors;
              const category = pipeline.category || "metagenomics";

              return (
                <GlassCard
                  key={pipeline.pipelineId}
                  className={`relative transition-all ${
                    canRun
                      ? "hover:shadow-md hover:border-primary/50 cursor-pointer"
                      : "opacity-60"
                  }`}
                  onClick={() => canRun && openRunDialog(pipeline)}
                >
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-xl ${getCategoryColor(category)}`}>
                      {getPipelineIcon(pipeline.icon)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h3 className="font-semibold">{pipeline.name}</h3>
                        {pipeline.version && (
                          <Badge variant="outline" className="text-xs font-normal">
                            v{pipeline.version}
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-xs capitalize">
                          {category}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {pipeline.description}
                      </p>
                    </div>
                    {canRun && (
                      <Button size="sm" variant="ghost" className="h-8 flex-shrink-0">
                        <Play className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </GlassCard>
              );
            })}
          </div>
        </>
      )}

      {/* Run History */}
      {pipelineRuns.length > 0 && (
        <div className="bg-card rounded-lg border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Run History
            </h3>
            {runsData?.total > pipelineRuns.length && (
              <Link
                href={`/dashboard/analysis?studyId=${studyId}`}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                View all {runsData.total} runs
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/50">
                <TableHead>Pipeline</TableHead>
                <TableHead className="w-[100px]">Run</TableHead>
                <TableHead className="w-[100px]">Started</TableHead>
                <TableHead className="w-[120px]">Results</TableHead>
                <TableHead className="w-[110px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pipelineRuns.map((run) => (
                <TableRow
                  key={run.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => window.location.href = `/dashboard/analysis/${run.id}`}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded-lg ${getCategoryColor("metagenomics")}`}>
                        {getPipelineIcon(run.pipelineIcon)}
                      </div>
                      <span className="font-medium text-sm">{run.pipelineName}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs font-mono text-muted-foreground">
                      {run.runNumber}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatRelativeTime(run.createdAt)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {run.currentStep && run.status === "running" ? (
                      <span className="text-blue-600">{run.currentStep}</span>
                    ) : run._count &&
                      (run._count.assembliesCreated > 0 ||
                        run._count.binsCreated > 0) ? (
                      <span>
                        {run._count.assembliesCreated} assemblies, {run._count.binsCreated} bins
                      </span>
                    ) : (
                      <span>--</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(run.status)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

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

          <div className="max-h-[60vh] overflow-y-auto pr-1">
          {runResult ? (
            <div className="py-4">
              <div
                className={`p-4 rounded-lg border ${
                  runResult.success
                    ? "bg-green-50 border-green-200"
                    : "bg-red-50 border-red-200"
                }`}
              >
                <div className="text-center">
                  {runResult.success ? (
                    <>
                      <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto mb-3" />
                      <p className="font-semibold text-lg">
                        Pipeline Run Started
                      </p>
                      {runResult.runNumber && (
                        <p className="text-sm text-muted-foreground mt-1 font-mono">
                          {runResult.runNumber}
                        </p>
                      )}
                      <p className="text-sm text-muted-foreground mt-3">
                        Your pipeline is now queued and will start processing
                        shortly.
                      </p>
                      <div className="mt-4 flex flex-col gap-2">
                        <Link
                          href={`/dashboard/analysis/${runResult.runId}`}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
                        >
                          <FlaskConical className="h-4 w-4" />
                          View Run Details
                        </Link>
                      </div>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-6 w-6 text-red-600 mx-auto mb-2" />
                      <p className="font-medium text-red-800">
                        Failed to Start
                      </p>
                      <p className="text-sm text-red-600 mt-1">
                        {runResult.error}
                      </p>
                      {runResult.details && runResult.details.length > 0 && (
                        <div className="mt-3 text-left bg-red-100 p-3 rounded text-xs">
                          <p className="font-medium text-red-800 mb-1">
                            Details:
                          </p>
                          <ul className="list-disc list-inside space-y-1 text-red-700">
                            {runResult.details.map((detail, i) => (
                              <li key={i}>{detail}</li>
                            ))}
                          </ul>
                        </div>
                      )}
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
                  <Collapsible
                    open={prereqsExpanded}
                    onOpenChange={setPrereqsExpanded}
                  >
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
                          <span
                            className={`text-xs ${
                              prerequisites.requiredPassed
                                ? "text-green-600"
                                : "text-red-600"
                            }`}
                          >
                            {prerequisites.summary}
                          </span>
                        </div>
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${
                            prereqsExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-3 max-h-48 overflow-y-auto space-y-2 text-sm pr-1">
                        {prerequisites.checks
                          .filter(
                            (check) =>
                              check.status === "fail" ||
                              check.status === "warning" ||
                              check.required
                          )
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
                                  <span className="font-medium">
                                    {check.name}
                                  </span>
                                  {check.required &&
                                    check.status !== "pass" && (
                                      <span className="text-xs text-red-600">
                                        required
                                      </span>
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
                        ) : metadataValidation.issues.some(
                            (i) => i.severity === "error"
                          ) ? (
                          <XCircle className="h-4 w-4 text-red-600" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        )}
                        <span className="text-sm font-medium">
                          Study Metadata
                        </span>
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
                                issue.severity === "error"
                                  ? "text-red-600"
                                  : "text-yellow-600"
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

              {/* Data Flow - What goes in/out */}
              {pipelineDefinition && pipelineDefinition.inputs.length > 0 && (
                <div className="py-3 border-b">
                  <Collapsible open={showDataFlow} onOpenChange={setShowDataFlow}>
                    <CollapsibleTrigger asChild>
                      <button className="flex items-center justify-between w-full text-left hover:bg-muted/50 rounded p-2 -m-2">
                        <div className="flex items-center gap-2">
                          <Layers className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium">
                            Data Integration
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {pipelineDefinition.inputs.length} inputs, {pipelineDefinition.outputs.length} outputs
                          </span>
                        </div>
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${
                            showDataFlow ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-3">
                      <PipelineDataFlowSummary
                        inputs={pipelineDefinition.inputs}
                        outputs={pipelineDefinition.outputs}
                      />
                    </CollapsibleContent>
                  </Collapsible>
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
                        {(sample.reads ?? []).filter((r) => r.file1 && r.file2).length}{" "}
                        read pair(s)
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
              {selectedPipeline &&
                Object.keys(selectedPipeline.configSchema.properties).length >
                  0 && (
                  <div className="border-t pt-4">
                    <Label className="mb-3 block">Configuration</Label>
                    <div className="space-y-3">
                      {Object.entries(
                        selectedPipeline.configSchema.properties
                      ).map(([key, schema]) => {
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
                                <Label
                                  htmlFor={`config-${key}`}
                                  className="text-sm"
                                >
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
                            <Label
                              htmlFor={`config-${key}`}
                              className="text-sm"
                            >
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
                      })}
                    </div>
                  </div>
                )}
            </>
          )}
          </div>

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
                    (metadataValidation !== null &&
                      metadataValidation.issues.some(
                        (i) => i.severity === "error"
                      ))
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
