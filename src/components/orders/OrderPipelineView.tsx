"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpBox } from "@/components/ui/help-box";
import { PageNotice } from "@/components/ui/page-notice";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  getSampleResultPreview,
  getSampleResultPreviewItem,
} from "@/lib/pipelines/sample-result";
import type { PipelineRunResultFile } from "@/lib/pipelines/result-files";
import { PipelineRunResultLinks } from "@/components/pipelines/PipelineRunResultLinks";
import {
  PipelineRunSettings,
  type PipelineRunDerivedSetting,
} from "@/components/pipelines/PipelineRunSettings";
import type {
  PipelineConfigProperty,
  PipelineSampleResult,
} from "@/lib/pipelines/types";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Info,
  Loader2,
  MoreHorizontal,
  Play,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type { OrderSequencingSummaryResponse } from "@/lib/sequencing/types";
import {
  READ_DATA_CLASS_BADGE_CLASSNAMES,
  READ_DATA_CLASS_LABELS,
  READ_ORIGIN_BADGE_CLASSNAMES,
  type ReadDataClass,
  type ReadOrigin,
} from "@/lib/sequencing/constants";
import { useQuickPrerequisiteStatus } from "@/lib/pipelines/useQuickPrerequisiteStatus";
import { getOrderPipelineSampleReadiness } from "@/lib/pipelines/order-pipeline-readiness";
import {
  READ_CLEANING_PIPELINE_ID,
  normalizeSimulateReadsConfig,
  SIMULATE_READS_ADVANCED_FIELDS,
  SIMULATE_READS_BASIC_FIELDS,
  SIMULATE_READS_ENUM_LABELS,
  SIMULATE_READS_PIPELINE_ID,
  type SimulateReadsConfig,
  type SimulateReadsMode,
  type SimulateReadsSimulationMode,
} from "@/lib/pipelines/simulate-reads-config";
import {
  ExecutionTargetControl,
  getExecutionTargetBlockMessage,
  isExecutionTargetBlocked,
  useSlurmAvailability,
  type ExecutionModeRequest,
} from "@/components/pipelines/ExecutionTargetControl";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function getApiErrorMessage(
  payload: { error?: unknown; details?: unknown } | null,
  fallback: string
): string {
  if (!payload) return fallback;
  if (Array.isArray(payload.details) && payload.details.length > 0) {
    return payload.details
      .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
      .join("\n");
  }
  if (typeof payload.details === "string" && payload.details.trim()) {
    return payload.details;
  }
  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }
  return fallback;
}

type AdminPipeline = {
  pipelineId: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  config: Record<string, unknown>;
  defaultConfig: Record<string, unknown>;
  executionPolicy?: {
    mode: "local" | "slurm";
    source: "global" | "pipeline" | "run";
  };
  runtimeWarnings?: string[];
  sampleResult?: PipelineSampleResult;
  configSchema?: {
    properties?: Record<string, PipelineConfigProperty>;
  };
  input: {
    supportedScopes: string[];
    perSample: {
      reads: boolean;
      pairedEnd: boolean;
      readMode?: "single_or_paired" | "paired_only";
    };
  };
};

type MetadataValidation = {
  valid: boolean;
  issues: Array<{
    field: string;
    message: string;
    severity: "error" | "warning";
    fixUrl?: string;
  }>;
  derivedSettings?: PipelineRunDerivedSetting[];
  metadata: {
    platform?: string;
    instrumentModel?: string;
    libraryStrategy?: string;
  };
};

type PipelineRun = {
  id: string;
  runNumber: string;
  pipelineId: string;
  pipelineName: string;
  status: string;
  currentStep: string | null;
  progress: number | null;
  inputSampleIds: string | null;
  errorTail?: string | null;
  config?: string | null;
  runFolder?: string | null;
  results?: {
    errors?: string[];
    warnings?: string[];
    pendingWritebacks?: number;
  } | null;
  isSelectedFinal?: boolean;
  isUserVisible?: boolean;
  selectedFinal?: {
    selectedRunId: string;
    selectedAt: string;
    selectedBy?: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string;
    } | null;
  } | null;
  resultFiles?: PipelineRunResultFile[];
  resultFilesOmittedCount?: number;
  resultFilesOmittedSampleFileCount?: number;
  primaryResultFile?: PipelineRunResultFile | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  user?: {
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null;
};

type PendingReadCandidate = {
  artifactId: string;
  outputId: string | null;
  outputLabel: string;
  sampleId: string;
  sampleCode: string;
  file1: string;
  file2: string | null;
  readLayout: "single" | "paired" | "long" | "unknown";
  targetDataClass: ReadDataClass;
  status: "candidate" | "promoted";
  metadata: Record<string, unknown>;
  currentRead: {
    id: string;
    file1: string | null;
    file2: string | null;
    dataClass: string;
    dataClassLabel: string;
    isProtectedRaw: boolean;
  } | null;
};

type PendingWritebackResponse = {
  readCandidates: PendingReadCandidate[];
  reports: Array<{
    id: string;
    name: string;
    path: string;
    outputId: string | null;
  }>;
  review?: {
    title?: string;
    description?: string;
    candidateCountLabel?: string;
    emptyText?: string;
    promoteButtonLabel?: string;
    confirmTitle?: string;
    confirmDescription?: string;
    reviewedLabel?: string;
  };
};

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "completed", label: "Completed" },
  { value: "running", label: "Running" },
  { value: "queued", label: "Queued" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "-";
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const diffMs = endDate.getTime() - startDate.getTime();
  if (diffMs < 0) return "-";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSecs}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return `${hours}h ${remainingMins}m`;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "completed":
      // Use the SeqDesk brand success color, matching StudyPipelinesSection and
      // the rest of the app (analysis/studies/footer all use #00BD7D).
      return <Badge className="bg-[#00BD7D] text-white">Completed</Badge>;
    case "running":
      return <Badge className="bg-blue-600 text-white">Running</Badge>;
    case "queued":
      return <Badge variant="secondary">Queued</Badge>;
    case "pending":
      return <Badge variant="outline">Pending</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "cancelled":
      return <Badge variant="outline">Cancelled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getRunDetails(run: PipelineRun): string {
  if (run.status === "failed" && run.errorTail?.trim()) {
    return run.errorTail.trim();
  }
  if (run.currentStep?.trim()) {
    return run.currentStep.trim();
  }
  if (run.status === "completed") return "Completed successfully";
  if (run.status === "queued") return "Waiting for execution";
  if (run.status === "pending") return "Waiting for execution";
  if (run.status === "running") return "Currently running";
  return "";
}

function runHasOutputErrors(run: PipelineRun): boolean {
  return Array.isArray(run.results?.errors) && run.results.errors.length > 0;
}

function getPendingWritebackCount(run: PipelineRun): number {
  const value = run.results?.pendingWritebacks;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

// Whether the candidate-review entry points should be offered for a run.
// The denormalized pendingWritebacks count is only present for runs completed
// after the writeback-contracts cutover; runs completed before that have a count
// of 0 even though staged sample_read_candidate artifacts still exist. To avoid
// stranding those historical runs, also offer the review for any completed
// read-cleaning run — the review panel recomputes candidates from artifacts and
// degrades gracefully when none remain.
function shouldOfferPendingReview(run: PipelineRun): boolean {
  if (getPendingWritebackCount(run) > 0) return true;
  return (
    run.status === "completed" && run.pipelineId === READ_CLEANING_PIPELINE_ID
  );
}

function getSampleCount(run: PipelineRun): number | null {
  if (!run.inputSampleIds) return null;
  try {
    const ids = JSON.parse(run.inputSampleIds);
    return Array.isArray(ids) ? ids.length : null;
  } catch {
    return null;
  }
}

function getUserDisplay(run: PipelineRun): string {
  if (!run.user) return "-";
  const name = [run.user.firstName, run.user.lastName].filter(Boolean).join(" ");
  return name || run.user.email;
}

function getSelectedByDisplay(run: PipelineRun): string {
  const selectedBy = run.selectedFinal?.selectedBy;
  if (!selectedBy) return "Unknown user";
  const name = [selectedBy.firstName, selectedBy.lastName].filter(Boolean).join(" ");
  return name || selectedBy.email;
}

function basename(filePath: string | null | undefined): string {
  if (!filePath) return "-";
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

function formatCandidateMetric(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return null;
}

function getCandidateEvidence(candidate: PendingReadCandidate): string {
  const keys = [
    "classified",
    "classified_reads",
    "classification_ids",
    "blastn_unique_ids",
    "filteredblastn_unique_ids",
  ];
  for (const key of keys) {
    const value = formatCandidateMetric(candidate.metadata[key]);
    if (value) return value;
  }
  return "-";
}

function getCandidateLayoutLabel(layout: PendingReadCandidate["readLayout"]): string {
  switch (layout) {
    case "paired":
      return "Paired-end";
    case "long":
      return "Long read";
    case "single":
      return "Single-end";
    default:
      return "FASTQ";
  }
}

function isRunVisibleToUser(run: PipelineRun): boolean {
  return run.isUserVisible ?? run.isSelectedFinal ?? false;
}

function getReadinessProblemText(reason?: string): string {
  switch (reason) {
    case "Files missing":
      return "Files missing from disk. Re-associate existing files or regenerate the reads before running this pipeline.";
    case "Missing reads":
      return "No read files are linked to this sample. Associate FASTQ files before running this pipeline.";
    case "Missing R2 file":
      return "This pipeline requires paired reads, but the R2 file is missing.";
    case "Needs raw or unknown reads":
      return "Read Cleaning only runs on active reads marked raw or unknown. Cleaned reads do not need this promotion workflow.";
    case "Pipeline not loaded":
      return "Pipeline metadata is still loading.";
    default:
      return reason || "This sample is not ready for this pipeline.";
  }
}

function getReadDataClassBadgeClassName(dataClass?: ReadDataClass | null) {
  return READ_DATA_CLASS_BADGE_CLASSNAMES[dataClass ?? "cleaned"];
}

function getReadOriginBadgeClassName(origin?: ReadOrigin | null) {
  return READ_ORIGIN_BADGE_CLASSNAMES[origin ?? "unknown"];
}

function getOrderPipelineHelpText(pipeline: AdminPipeline): string {
  if (pipeline.pipelineId === SIMULATE_READS_PIPELINE_ID) {
    return "Simulate Reads generates test FASTQ files and links them back to the order samples. Use it to verify the SeqDesk to pipeline to sequencing-data flow without real sequencer output; real production reads should normally be linked from Associate.";
  }

  if (pipeline.pipelineId === "fastq-checksum") {
    return "FASTQ Checksum computes hashes for the linked read files and writes them back to each sample. Samples are ready when their required FASTQ files are linked and still present on disk.";
  }

  if (pipeline.pipelineId === "fastqc") {
    return "FastQC runs quality control on linked FASTQ files and writes report links and quality summaries back to each sample. Samples are ready when their required FASTQ files are linked and still present on disk.";
  }

  if (pipeline.pipelineId === READ_CLEANING_PIPELINE_ID) {
    return "Read Cleaning runs nf-core/detaxizer on active raw or unknown reads. Completed runs stage cleaned FASTQ candidates and reports; an admin must review and set candidates as active cleaned reads before SeqDesk uses them for delivery or downstream pipelines.";
  }

  if (pipeline.input.perSample.reads) {
    return "This order pipeline runs on linked sequencing reads. Samples become ready when the required input files are associated with the sample and available on disk.";
  }

  return "This order pipeline runs against the samples in this order and writes results back into SeqDesk when the run completes.";
}

function getSampleRunActionCopy({
  pipeline,
  sampleLabel,
  isDemo,
  systemBlocked,
  systemSummary,
  launchBlockMessage,
}: {
  pipeline: AdminPipeline;
  sampleLabel: string;
  isDemo?: boolean;
  systemBlocked?: boolean;
  systemSummary?: string | null;
  launchBlockMessage?: string | null;
}): { title: string; description: string } {
  if (isDemo) {
    return {
      title: "Execution disabled in demo mode",
      description: "This would start a real local pipeline run. Demo workspaces keep pipeline execution view-only.",
    };
  }

  if (systemBlocked) {
    return {
      title: "Pipeline cannot start yet",
      description: systemSummary || "One or more required runtime settings are missing. Check the environment status before starting this pipeline.",
    };
  }

  if (launchBlockMessage) {
    return {
      title: "Execution target unavailable",
      description: launchBlockMessage,
    };
  }

  if (pipeline.pipelineId === SIMULATE_READS_PIPELINE_ID) {
    return {
      title: "Generate simulated reads",
      description: `Starts ${pipeline.name} for ${sampleLabel}. It creates test FASTQ files using the settings above and links the generated files back to this sample as sequencing data.`,
    };
  }

  if (pipeline.pipelineId === "fastq-checksum") {
    return {
      title: "Compute FASTQ checksums",
      description: `Starts ${pipeline.name} for ${sampleLabel}. It reads the linked FASTQ files, computes MD5 checksums, and writes checksum values back to this sample.`,
    };
  }

  if (pipeline.pipelineId === "fastqc") {
    return {
      title: "Run FASTQ quality control",
      description: `Starts ${pipeline.name} for ${sampleLabel}. It runs FastQC on the linked FASTQ files, stores the reports, and writes report links and QC summaries back to this sample.`,
    };
  }

  if (pipeline.pipelineId === READ_CLEANING_PIPELINE_ID) {
    return {
      title: "Clean raw reads",
      description: `Starts ${pipeline.name} for ${sampleLabel}. It screens raw or unknown reads for contaminant sequences and stages cleaned read candidates for admin review.`,
    };
  }

  if (pipeline.input.perSample.reads) {
    return {
      title: `Run ${pipeline.name}`,
      description: `Starts this pipeline for ${sampleLabel}. It uses the sample's active linked FASTQ files and writes configured outputs back into SeqDesk when the run completes.`,
    };
  }

  return {
    title: `Run ${pipeline.name}`,
    description: `Starts this pipeline for ${sampleLabel} and writes configured outputs back into SeqDesk when the run completes.`,
  };
}

function getRunAllActionCopy({
  pipeline,
  readyCount,
  isDemo,
  systemBlocked,
  systemSummary,
  launchBlockMessage,
}: {
  pipeline: AdminPipeline;
  readyCount: number;
  isDemo?: boolean;
  systemBlocked?: boolean;
  systemSummary?: string | null;
  launchBlockMessage?: string | null;
}): { title: string; description: string } {
  if (readyCount === 0 && !systemBlocked && !isDemo && !launchBlockMessage) {
    return {
      title: "No ready samples",
      description: "No samples currently meet this pipeline's input requirements.",
    };
  }

  const base = getSampleRunActionCopy({
    pipeline,
    sampleLabel: `${readyCount} ready sample${readyCount === 1 ? "" : "s"}`,
    isDemo,
    systemBlocked,
    systemSummary,
    launchBlockMessage,
  });

  return {
    title: `Run all ready samples`,
    description: base.description,
  };
}

function PendingWritebackReviewPanel({
  run,
  isDemo,
  isFacilityAdmin,
  onPromoted,
  onError,
}: {
  run: PipelineRun;
  isDemo?: boolean;
  isFacilityAdmin?: boolean;
  onPromoted?: () => void;
  onError?: (message: string) => void;
}) {
  const [selectedSampleIds, setSelectedSampleIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reviewChecked, setReviewChecked] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const response = useSWR<PendingWritebackResponse>(
    run.status === "completed" && shouldOfferPendingReview(run)
      ? `/api/pipelines/runs/${run.id}/pending-writebacks`
      : null,
    fetcher
  );

  const candidates = response.data?.readCandidates ?? [];
  const reports = response.data?.reports ?? [];
  const review = response.data?.review;
  const promotableCandidates = candidates.filter((candidate) => candidate.status !== "promoted");

  useEffect(() => {
    if (!response.data) return;
    setSelectedSampleIds(
      new Set(
        response.data.readCandidates
          .filter((candidate) => candidate.status !== "promoted")
          .map((candidate) => candidate.sampleId)
      )
    );
  }, [response.data]);

  if (run.status !== "completed" || !shouldOfferPendingReview(run)) {
    return null;
  }

  const selectedCount = selectedSampleIds.size;
  const selectedCandidates = candidates.filter((candidate) =>
    selectedSampleIds.has(candidate.sampleId)
  );

  const toggleCandidate = (sampleId: string) => {
    setSelectedSampleIds((prev) => {
      const next = new Set(prev);
      if (next.has(sampleId)) {
        next.delete(sampleId);
      } else {
        next.add(sampleId);
      }
      return next;
    });
  };

  const promoteSelected = async () => {
    setPromoting(true);
    onError?.("");
    try {
      const res = await fetch(`/api/pipelines/runs/${run.id}/pending-writebacks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sampleIds: Array.from(selectedSampleIds) }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(getApiErrorMessage(payload, "Failed to promote pending outputs"));
      }
      setConfirmOpen(false);
      setReviewChecked(false);
      await response.mutate();
      onPromoted?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to promote pending outputs");
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div className="border-t pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {review?.title ?? "Review pending read outputs"}
          </span>
          <p className="mt-1 text-sm text-muted-foreground">
            {review?.description ??
              "Select staged read candidates that should become active reads for this order. Existing raw or unknown reads are preserved."}
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          {promotableCandidates.length}{" "}
          {review?.candidateCountLabel ?? "candidate"}
          {promotableCandidates.length === 1 ? "" : "s"}
        </Badge>
      </div>

      {response.isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading candidates...
        </div>
      ) : candidates.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          {review?.emptyText ?? "No pending read candidates were discovered for this run."}
        </p>
      ) : (
        <>
          {reports.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {reports.map((report) => (
                <a
                  key={report.id}
                  href={`/api/files/preview?path=${encodeURIComponent(report.path)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-primary transition-colors hover:bg-accent hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {report.name}
                </a>
              ))}
            </div>
          ) : null}

          <div className="mt-4 max-h-72 overflow-auto rounded-lg border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b bg-secondary/30">
                <tr>
                  <th className="w-[44px] px-3 py-2 text-left">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    Sample
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    Current active reads
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    Candidate
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    Evidence
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {candidates.map((candidate) => {
                  const disabled = candidate.status === "promoted" || promoting;
                  return (
                    <tr key={candidate.artifactId}>
                      <td className="px-3 py-2 align-top">
                        <Checkbox
                          aria-label={`Select pending reads for ${candidate.sampleCode}`}
                          checked={selectedSampleIds.has(candidate.sampleId)}
                          disabled={disabled}
                          onCheckedChange={() => toggleCandidate(candidate.sampleId)}
                        />
                      </td>
                      <td className="px-3 py-2 align-top font-medium">
                        {candidate.sampleCode}
                      </td>
                      <td className="px-3 py-2 align-top text-xs">
                        {candidate.currentRead ? (
                          <div className="space-y-1">
                            <div className="flex flex-wrap gap-1">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[11px]",
                                  getReadDataClassBadgeClassName(candidate.currentRead.dataClass as ReadDataClass)
                                )}
                              >
                                {candidate.currentRead.dataClassLabel}
                              </Badge>
                              {candidate.currentRead.file2 ? (
                                <Badge variant="outline" className="text-[11px]">
                                  Paired
                                </Badge>
                              ) : null}
                            </div>
                            <div className="font-mono text-muted-foreground">
                              {basename(candidate.currentRead.file1)}
                              {candidate.currentRead.file2 ? ` / ${basename(candidate.currentRead.file2)}` : ""}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">No active reads</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top text-xs">
                        <div className="space-y-1">
                          <Badge variant="outline" className="text-[11px]">
                            {getCandidateLayoutLabel(candidate.readLayout)}
                          </Badge>
                          <div className="font-mono text-muted-foreground">
                            {basename(candidate.file1)}
                            {candidate.file2 ? ` / ${basename(candidate.file2)}` : ""}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                        {getCandidateEvidence(candidate)}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {candidate.status === "promoted" ? (
                          <Badge className="bg-[#00BD7D] text-white">Promoted</Badge>
                        ) : (
                          <Badge variant="outline">Candidate</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {isFacilityAdmin && !isDemo ? (
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={promoting || promotableCandidates.length === 0}
                onClick={() => setSelectedSampleIds(new Set())}
              >
                Keep current reads
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={promoting || selectedCount === 0}
                onClick={() => setConfirmOpen(true)}
              >
                {review?.promoteButtonLabel ?? "Set as active reads"}
              </Button>
            </div>
          ) : null}
        </>
      )}

      {confirmOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-lg rounded-xl border bg-card p-6 shadow-lg">
            <h4 className="text-base font-semibold">
              {review?.confirmTitle ?? "Set as active reads"}
            </h4>
            <p className="mt-2 text-sm text-muted-foreground">
              {review?.confirmDescription ??
                "This will change which read files SeqDesk uses for delivery and downstream pipelines. Existing raw or unknown reads will be preserved. Existing active cleaned reads will be superseded, not deleted."}{" "}
              This applies to {selectedCount} sample{selectedCount === 1 ? "" : "s"}.
            </p>
            <div className="mt-3 max-h-28 overflow-auto rounded-md bg-muted px-3 py-2 text-xs font-mono text-muted-foreground">
              {selectedCandidates.map((candidate) => candidate.sampleCode).join(", ")}
            </div>
            <label className="mt-4 flex items-start gap-2 text-sm">
              <Checkbox
                aria-label={
                  review?.reviewedLabel ??
                  "I reviewed the reports and want to use these read candidates."
                }
                checked={reviewChecked}
                disabled={promoting}
                onCheckedChange={(checked) => setReviewChecked(Boolean(checked))}
              />
              <span>
                {review?.reviewedLabel ??
                  "I reviewed the reports and want to use these read candidates."}
              </span>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={promoting}
                onClick={() => {
                  setConfirmOpen(false);
                  setReviewChecked(false);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={promoting || !reviewChecked}
                onClick={() => void promoteSelected()}
              >
                {promoting ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Set active
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface OrderPipelineViewProps {
  orderId: string;
  pipelineId: string;
  samples: OrderSequencingSummaryResponse["samples"];
  onRunCompleted?: () => void;
  onSampleDataChanged?: () => void;
  isDemo?: boolean;
  isFacilityAdmin?: boolean;
}

export function OrderPipelineView({
  orderId,
  pipelineId,
  samples,
  onRunCompleted,
  onSampleDataChanged,
  isDemo,
  isFacilityAdmin = false,
}: OrderPipelineViewProps) {
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>({});
  const [executionMode, setExecutionMode] = useState<ExecutionModeRequest>("default");
  const [simulateReadsAdvancedOpen, setSimulateReadsAdvancedOpen] = useState(false);
  const [pendingRunSampleIds, setPendingRunSampleIds] = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState(false);
  const [error, setError] = useState("");
  const [metadataValidation, setMetadataValidation] = useState<MetadataValidation | null>(null);
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState<PipelineRun | null>(null);
  const [deletingRun, setDeletingRun] = useState(false);
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [selectionUpdatingRunId, setSelectionUpdatingRunId] = useState<string | null>(null);
  const [detailRun, setDetailRun] = useState<PipelineRun | null>(null);
  const [changeSourceSample, setChangeSourceSample] = useState<{
    id: string;
    sampleId: string;
    currentRunId?: string | null;
  } | null>(null);
  const [changingSource, setChangingSource] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ path: string; label: string } | null>(null);
  const {
    systemReady,
    checkingSystem,
    refreshSystemReady,
    initialCheckPending,
    systemBlocked,
  } = useQuickPrerequisiteStatus();
  const {
    slurmAvailability,
    slurmAvailabilityLoading,
    slurmAvailabilityError,
  } = useSlurmAvailability(Boolean(isFacilityAdmin && !isDemo));

  const pipelinesResponse = useSWR<{ pipelines: AdminPipeline[] }>(
    "/api/admin/settings/pipelines?enabled=true&catalog=order",
    fetcher
  );
  const runsResponse = useSWR<{ runs: PipelineRun[]; total: number }>(
    `/api/pipelines/runs?orderId=${orderId}&pipelineId=${pipelineId}&limit=50`,
    fetcher,
    { refreshInterval: 10000 }
  );

  const pipeline = useMemo(
    () =>
      (pipelinesResponse.data?.pipelines ?? []).find(
        (p) => p.pipelineId === pipelineId && p.enabled
      ) ?? null,
    [pipelinesResponse.data?.pipelines, pipelineId]
  );

  const allRuns = useMemo(() => runsResponse.data?.runs ?? [], [runsResponse.data?.runs]);

  const hasActiveRuns = useMemo(
    () => allRuns.some((run) => run.status === "queued" || run.status === "running"),
    [allRuns]
  );

  // Derive running sample IDs from active pipeline runs + pending API calls
  const runningSampleIds = useMemo(() => {
    const ids = new Set(pendingRunSampleIds);
    for (const run of allRuns) {
      if (run.status === "queued" || run.status === "running") {
        if (run.inputSampleIds) {
          try {
            const parsed = JSON.parse(run.inputSampleIds) as string[];
            for (const id of parsed) ids.add(id);
          } catch {
            // inputSampleIds might be comma-separated
            for (const id of run.inputSampleIds.split(",")) {
              const trimmed = id.trim();
              if (trimmed) ids.add(trimmed);
            }
          }
        }
      }
    }
    return ids;
  }, [allRuns, pendingRunSampleIds]);

  // Detect when a previously active run transitions to "completed" and notify parent
  const prevActiveRunIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentActiveIds = new Set(
      allRuns
        .filter((r) => r.status === "queued" || r.status === "running")
        .map((r) => r.id)
    );
    const justCompleted = [...prevActiveRunIdsRef.current].some(
      (id) => !currentActiveIds.has(id) && allRuns.some((r) => r.id === id && r.status === "completed")
    );
    if (justCompleted) {
      onRunCompleted?.();
    }
    prevActiveRunIdsRef.current = currentActiveIds;
  }, [allRuns, onRunCompleted]);

  const filteredRuns = useMemo(
    () =>
      statusFilter === "all"
        ? allRuns
        : allRuns.filter((run) => run.status === statusFilter),
    [allRuns, statusFilter]
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const run of allRuns) {
      counts[run.status] = (counts[run.status] || 0) + 1;
    }
    return counts;
  }, [allRuns]);

  useEffect(() => {
    if (!pipeline) return;
    const mergedConfig = {
      ...(pipeline.defaultConfig || {}),
      ...(pipeline.config || {}),
    };
    setLocalConfig(
      pipeline.pipelineId === SIMULATE_READS_PIPELINE_ID
        ? { ...normalizeSimulateReadsConfig(mergedConfig) } as Record<string, unknown>
        : mergedConfig
    );
    setExecutionMode("default");
    setSimulateReadsAdvancedOpen(false);
  }, [pipeline]);

  const simulateReadsConfig = useMemo(
    () =>
      pipeline?.pipelineId === SIMULATE_READS_PIPELINE_ID
        ? normalizeSimulateReadsConfig(localConfig)
        : null,
    [localConfig, pipeline?.pipelineId]
  );

  const updateSimulateReadsConfig = useCallback(
    (patch: Partial<SimulateReadsConfig>) => {
      setLocalConfig((prev) => {
        const merged = {
          ...normalizeSimulateReadsConfig(prev),
          ...patch,
        };

        if (
          patch.mode === "longRead" &&
          merged.simulationMode === "template"
        ) {
          merged.simulationMode = "synthetic";
        }

        return { ...normalizeSimulateReadsConfig(merged) } as Record<string, unknown>;
      });
    },
    []
  );

  const getSampleReadiness = useCallback(
    (sample: (typeof samples)[0]): { ready: boolean; reason?: string } => {
      return getOrderPipelineSampleReadiness({ pipeline, sample });
    },
    [pipeline]
  );

  const readySamples = useMemo(
    () => samples.filter((s) => getSampleReadiness(s).ready),
    [samples, getSampleReadiness]
  );
  const readySampleIdsKey = useMemo(
    () => readySamples.map((sample) => sample.id).join("|"),
    [readySamples]
  );
  const protectedReadySamples = useMemo(
    () => readySamples.filter((sample) => sample.read?.isProtectedRaw),
    [readySamples]
  );
  const blockedSampleCount = Math.max(samples.length - readySamples.length, 0);
  const activeRunCount =
    (statusCounts.running ?? 0) + (statusCounts.queued ?? 0) + (statusCounts.pending ?? 0);
  const completedRunCount = statusCounts.completed ?? 0;
  const failedRunCount = statusCounts.failed ?? 0;
  const executionTargetBlockMessage = useMemo(
    () =>
      pipeline && isFacilityAdmin && !isDemo
        ? getExecutionTargetBlockMessage({
            executionMode,
            executionPolicy: pipeline.executionPolicy,
            slurmAvailability,
            slurmAvailabilityLoading,
            slurmAvailabilityError,
          })
        : null,
    [
      executionMode,
      isDemo,
      isFacilityAdmin,
      pipeline,
      slurmAvailability,
      slurmAvailabilityError,
      slurmAvailabilityLoading,
    ]
  );
  const executionTargetBlocked = Boolean(executionTargetBlockMessage);
  const metadataErrors = useMemo(
    () =>
      !loadingMetadata && metadataValidation
        ? metadataValidation.issues.filter((issue) => issue.severity === "error")
        : [],
    [loadingMetadata, metadataValidation]
  );
  const metadataBlockMessage = loadingMetadata
    ? "Pipeline metadata is still loading."
    : metadataErrors[0]?.message ?? null;
  const launchBlockMessage = metadataBlockMessage || executionTargetBlockMessage;
  const launchBlocked =
    executionTargetBlocked || loadingMetadata || metadataErrors.length > 0;

  useEffect(() => {
    if (!pipeline) {
      setMetadataValidation(null);
      setLoadingMetadata(false);
      return;
    }

    let cancelled = false;
    const readySampleIds = readySamples.map((sample) => sample.id);
    setLoadingMetadata(true);

    const load = async () => {
      try {
        const res = await fetch("/api/pipelines/validate-metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId,
            pipelineId: pipeline.pipelineId,
            ...(readySampleIds.length > 0 ? { sampleIds: readySampleIds } : {}),
          }),
        });
        if (!cancelled && res.ok) {
          setMetadataValidation(await res.json());
        }
      } catch {
        if (!cancelled) setMetadataValidation(null);
      } finally {
        if (!cancelled) setLoadingMetadata(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [orderId, pipeline, readySampleIdsKey, readySamples]);

  const staleReadsPreservedCount = useMemo(() => {
    if (
      pipeline?.pipelineId !== SIMULATE_READS_PIPELINE_ID ||
      simulateReadsConfig?.replaceExisting !== false
    ) {
      return 0;
    }

    return samples.filter((sample) => sample.read?.filesMissing).length;
  }, [pipeline?.pipelineId, samples, simulateReadsConfig?.replaceExisting]);

  const runPipeline = useCallback(
    async (sampleIds: string[]) => {
      if (!pipeline) return;
      if (
        isFacilityAdmin &&
        isExecutionTargetBlocked({
          executionMode,
          executionPolicy: pipeline.executionPolicy,
          slurmAvailability,
          slurmAvailabilityLoading,
          slurmAvailabilityError,
        })
      ) {
        setError(
          executionTargetBlockMessage ||
            "The selected execution target is not available."
        );
        return;
      }
      const protectedSamples = samples.filter(
        (sample) => sampleIds.includes(sample.id) && sample.read?.isProtectedRaw
      );
      if (protectedSamples.length > 0 && pipeline.pipelineId !== READ_CLEANING_PIPELINE_ID) {
        const confirmed = window.confirm(
          `${protectedSamples.length} selected sample${protectedSamples.length === 1 ? "" : "s"} use raw or unknown reads. Raw reads may still contain human contamination. Continue running ${pipeline.name}?`
        );
        if (!confirmed) return;
      }
      setError("");

      try {
        const createRes = await fetch("/api/pipelines/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pipelineId: pipeline.pipelineId,
            orderId,
            sampleIds,
            config: localConfig,
            ...(isFacilityAdmin ? { executionMode } : {}),
          }),
        });

        const createPayload = await createRes.json().catch(() => null);
        if (!createRes.ok) {
          throw new Error(
            getApiErrorMessage(createPayload, "Failed to create pipeline run")
          );
        }

        const runId = createPayload?.run?.id as string | undefined;
        if (!runId) throw new Error("Pipeline run created without an id");

        const startRes = await fetch(`/api/pipelines/runs/${runId}/start`, {
          method: "POST",
        });
        const startPayload = await startRes.json().catch(() => null);
        if (!startRes.ok) {
          throw new Error(
            getApiErrorMessage(startPayload, "Failed to start pipeline run")
          );
        }

        await runsResponse.mutate();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start pipeline");
      }
    },
    [
      executionMode,
      executionTargetBlockMessage,
      isFacilityAdmin,
      localConfig,
      orderId,
      pipeline,
      runsResponse,
      samples,
      slurmAvailability,
      slurmAvailabilityError,
      slurmAvailabilityLoading,
    ]
  );

  const handleDeleteRun = useCallback(
    async (runId: string) => {
      setDeletingRun(true);
      try {
        const res = await fetch(`/api/pipelines/runs/${runId}/delete`, {
          method: "POST",
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(getApiErrorMessage(payload, "Failed to delete run"));
        }
        await runsResponse.mutate();
        setDeleteTarget(null);
        onSampleDataChanged?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete run");
      } finally {
        setDeletingRun(false);
      }
    },
    [runsResponse, onSampleDataChanged]
  );

  const handleBulkDelete = useCallback(async () => {
    if (selectedRunIds.size === 0) return;
    setBulkDeleting(true);
    try {
      for (const runId of selectedRunIds) {
        const res = await fetch(`/api/pipelines/runs/${runId}/delete`, {
          method: "POST",
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(getApiErrorMessage(payload, "Failed to delete run"));
        }
      }
      await runsResponse.mutate();
      setSelectedRunIds(new Set());
      setShowBulkDeleteConfirm(false);
      onSampleDataChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete runs");
    } finally {
      setBulkDeleting(false);
    }
  }, [selectedRunIds, runsResponse, onSampleDataChanged]);

  const handleSetVisibleRun = useCallback(
    async (run: PipelineRun, selected: boolean) => {
      if (!isFacilityAdmin || isDemo) return;

      setSelectionUpdatingRunId(run.id);
      setError("");

      try {
        const res = await fetch(`/api/pipelines/runs/${run.id}/selection`, {
          method: selected ? "PUT" : "DELETE",
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            getApiErrorMessage(payload, "Failed to update result visibility")
          );
        }
        await runsResponse.mutate();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to update result visibility"
        );
      } finally {
        setSelectionUpdatingRunId(null);
      }
    },
    [isDemo, isFacilityAdmin, runsResponse]
  );

  // Deletable runs are those not currently running
  const deletableFilteredRuns = useMemo(
    () => filteredRuns.filter((r) => r.status !== "running"),
    [filteredRuns]
  );

  const allFilteredSelected =
    deletableFilteredRuns.length > 0 &&
    deletableFilteredRuns.every((r) => selectedRunIds.has(r.id));

  const toggleSelectAll = useCallback(() => {
    if (allFilteredSelected) {
      setSelectedRunIds(new Set());
    } else {
      setSelectedRunIds(new Set(deletableFilteredRuns.map((r) => r.id)));
    }
  }, [allFilteredSelected, deletableFilteredRuns]);

  const toggleSelectRun = useCallback((runId: string) => {
    setSelectedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!hasActiveRuns) return;

    const interval = window.setInterval(() => {
      void runsResponse.mutate();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [hasActiveRuns, runsResponse]);

  const handleRunSingle = useCallback(
    async (sampleId: string) => {
      setPendingRunSampleIds((prev) => new Set(prev).add(sampleId));
      await runPipeline([sampleId]);
      setPendingRunSampleIds((prev) => {
        const next = new Set(prev);
        next.delete(sampleId);
        return next;
      });
    },
    [runPipeline]
  );

  const handleRunAllReady = useCallback(async () => {
    if (readySamples.length === 0) return;
    setRunningAll(true);
    await runPipeline(readySamples.map((s) => s.id));
    setRunningAll(false);
  }, [readySamples, runPipeline]);


  const handleClearSampleResult = useCallback(
    async (sampleId: string) => {
      if (!pipeline?.sampleResult) return;
      setError("");
      const fields = pipeline.sampleResult.values
        .map((v) => {
          const parts = v.path.split(".");
          return parts.length === 2 && parts[0] === "read" ? parts[1] : null;
        })
        .filter((f): f is string => f !== null);

      if (fields.length === 0) return;

      try {
        const res = await fetch(`/api/orders/${orderId}/sequencing/reads`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sampleId, clearFields: fields }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(getApiErrorMessage(payload, "Failed to clear result"));
        }
        onSampleDataChanged?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to clear result");
      }
    },
    [orderId, pipeline?.sampleResult, onSampleDataChanged]
  );

  const completedRunsForSample = useMemo(() => {
    if (!changeSourceSample) return [];
    return allRuns.filter((run) => {
      if (run.status !== "completed") return false;
      // null means "all samples" — the run covered the entire order
      if (!run.inputSampleIds) return true;
      try {
        const ids = JSON.parse(run.inputSampleIds) as string[];
        return Array.isArray(ids) && ids.includes(changeSourceSample.id);
      } catch {
        return false;
      }
    });
  }, [allRuns, changeSourceSample]);

  const handleChangeSource = useCallback(
    async (runId: string) => {
      if (!changeSourceSample) return;
      setChangingSource(true);
      setError("");
      try {
        const res = await fetch(
          `/api/pipelines/runs/${runId}/resolve-outputs/sample`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sampleId: changeSourceSample.id }),
          }
        );
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(
            getApiErrorMessage(payload, "Failed to change source")
          );
        }
        onSampleDataChanged?.();
        setChangeSourceSample(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to change source");
      } finally {
        setChangingSource(false);
      }
    },
    [changeSourceSample, onSampleDataChanged]
  );

  if (pipelinesResponse.isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!pipeline) {
    return (
      <div className="rounded-lg border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
        Pipeline not found or not enabled.
      </div>
    );
  }

  const sampleResultConfig = pipeline.sampleResult;
  const sampleResultLayout = sampleResultConfig?.layout ?? "stack";
  const sampleResultColumnCount = sampleResultConfig
    ? sampleResultLayout === "columns"
      ? sampleResultConfig.values.length
      : 1
    : 0;
  const columnCount = 3 + sampleResultColumnCount; // Action, Sample, Reads + sample-result columns
  const tableMinWidthClass = sampleResultConfig
    ? sampleResultLayout === "columns"
      ? "min-w-[1020px]"
      : "min-w-[860px]"
    : "min-w-[640px]";
  const runAllActionCopy = getRunAllActionCopy({
    pipeline,
    readyCount: readySamples.length,
    isDemo,
    systemBlocked,
    systemSummary: systemReady?.summary,
    launchBlockMessage,
  });

  const renderSimulateReadsSettings = () => {
    if (!pipeline?.configSchema?.properties || !simulateReadsConfig) {
      return null;
    }

    const templateMode = simulateReadsConfig.simulationMode === "template";
    const longReadMode = simulateReadsConfig.mode === "longRead";
    const pairedSyntheticMode =
      simulateReadsConfig.mode === "shortReadPaired" && !templateMode;
    const schema = pipeline.configSchema.properties;

    const renderField = (
      key: keyof SimulateReadsConfig,
      options?: {
        disabled?: boolean;
        helperText?: string;
      }
    ) => {
      const fieldSchema = schema[key];
      if (!fieldSchema) return null;
      const fieldId = `config-${String(key)}`;
      const disabled = options?.disabled ?? false;
      const value = simulateReadsConfig[key];

      if (fieldSchema.enum) {
        return (
          <div key={key} className="space-y-1">
            <Label className="text-xs" htmlFor={fieldId}>
              {fieldSchema.title || key}
            </Label>
            <Select
              value={String(value ?? "")}
              onValueChange={(nextValue) => {
                if (key === "mode") {
                  updateSimulateReadsConfig({
                    mode: nextValue as SimulateReadsMode,
                  });
                  return;
                }

                if (key === "simulationMode") {
                  updateSimulateReadsConfig({
                    simulationMode: nextValue as SimulateReadsSimulationMode,
                  });
                  return;
                }

                updateSimulateReadsConfig({ [key]: nextValue } as Partial<SimulateReadsConfig>);
              }}
              disabled={disabled}
            >
              <SelectTrigger
                id={fieldId}
                aria-label={fieldSchema.title || key}
                className="h-8 w-[180px] text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fieldSchema.enum.map((option) => {
                  const optionValue = String(option);
                  return (
                    <SelectItem
                      key={optionValue}
                      value={optionValue}
                      disabled={key === "simulationMode" && optionValue === "template" && longReadMode}
                    >
                      {SIMULATE_READS_ENUM_LABELS[optionValue] || optionValue}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {options?.helperText ? (
              <p className="max-w-[220px] text-[11px] text-muted-foreground">
                {options.helperText}
              </p>
            ) : null}
          </div>
        );
      }

      if (fieldSchema.type === "boolean") {
        return (
          <div key={key} className="flex items-center gap-2 pt-5">
            <Switch
              id={fieldId}
              checked={Boolean(value)}
              disabled={disabled}
              onCheckedChange={(checked) =>
                updateSimulateReadsConfig({
                  [key]: checked,
                } as Partial<SimulateReadsConfig>)
              }
            />
            <Label htmlFor={fieldId} className="text-xs">
              {fieldSchema.title || key}
            </Label>
          </div>
        );
      }

      return (
        <div key={key} className="space-y-1">
          <Label className="text-xs" htmlFor={fieldId}>
            {fieldSchema.title || key}
          </Label>
          <Input
            id={fieldId}
            type="number"
            className="h-8 w-[120px] text-xs"
            min={fieldSchema.minimum}
            max={fieldSchema.maximum}
            disabled={disabled}
            value={value != null ? String(value) : ""}
            onChange={(e) =>
              updateSimulateReadsConfig({
                [key]: e.target.value ? Number(e.target.value) : null,
              } as Partial<SimulateReadsConfig>)
            }
          />
          {options?.helperText ? (
            <p className="max-w-[220px] text-[11px] text-muted-foreground">
              {options.helperText}
            </p>
          ) : null}
        </div>
      );
    };

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-start gap-4">
          {SIMULATE_READS_BASIC_FIELDS.map((key) => {
            switch (key) {
              case "readCount":
              case "readLength":
                return renderField(key, {
                  disabled: templateMode,
                  helperText: templateMode
                    ? "Template replay uses the read count and read lengths from the selected FASTQ pair."
                    : undefined,
                });
              case "qualityProfile":
                return renderField(key, {
                  disabled: templateMode,
                  helperText: templateMode
                    ? "Template replay preserves the quality profile already present in the template FASTQs."
                    : undefined,
                });
              default:
                return renderField(key);
            }
          })}
        </div>

        {longReadMode ? (
          <p className="text-xs text-muted-foreground">
            Long-read mode always runs with synthetic generation. Template replay is disabled for this mode.
          </p>
        ) : null}

        <Collapsible
          open={simulateReadsAdvancedOpen}
          onOpenChange={setSimulateReadsAdvancedOpen}
        >
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" type="button">
              {simulateReadsAdvancedOpen ? "Hide advanced settings" : "Advanced settings"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="flex flex-wrap items-start gap-4">
              {SIMULATE_READS_ADVANCED_FIELDS.map((key) => {
                if (key === "insertMean" || key === "insertStdDev") {
                  return renderField(key, {
                    disabled: !pairedSyntheticMode,
                    helperText: !pairedSyntheticMode
                      ? "Insert sizing only applies to synthetic paired-end reads."
                      : undefined,
                  });
                }

                return renderField(key, {
                  helperText:
                    templateMode && key === "seed"
                      ? "When multiple template pairs are available, the seed controls deterministic template selection."
                      : undefined,
                });
              })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{pipeline.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {pipeline.description}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isDemo ? (
            <Badge
              variant="outline"
              className="border-blue-200 bg-blue-50 px-3 py-1.5 text-blue-700"
            >
              <Info className="mr-1.5 h-3.5 w-3.5" />
              Demo mode — pipeline execution is view-only
            </Badge>
          ) : initialCheckPending ? (
            <Button size="sm" disabled className="h-9 w-40">
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Checking env...
            </Button>
          ) : (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      className="h-9 w-40"
                      disabled={
                        readySamples.length === 0 ||
                        runningAll ||
                        systemBlocked ||
                        launchBlocked
                      }
                      onClick={handleRunAllReady}
                      aria-label="Run all ready samples"
                    >
                      {runningAll ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      <span>Run All Ready</span>
                      <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-white/25 bg-white/15 px-1.5 text-[11px] font-semibold tabular-nums text-current">
                        {readySamples.length}
                      </span>
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="end" sideOffset={8} className="max-w-xs text-left">
                  <div className="space-y-1">
                    <p className="font-medium">{runAllActionCopy.title}</p>
                    <p>{runAllActionCopy.description}</p>
                  </div>
                </TooltipContent>
              </Tooltip>
              {systemBlocked ? (
                <Badge
                  variant="outline"
                  className="border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-700"
                >
                  <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
                  {systemReady?.summary}
                </Badge>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                className="h-9 w-40"
                disabled={checkingSystem}
                onClick={() => void refreshSystemReady()}
              >
                <RefreshCw
                  className={`mr-1.5 h-3.5 w-3.5 ${
                    checkingSystem ? "animate-spin" : ""
                  }`}
                />
                {checkingSystem ? "Re-checking..." : "Re-check env"}
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <PageNotice variant="error" title="Pipeline action failed" className="rounded-xl border">
          {error}
        </PageNotice>
      )}

      {pipeline.runtimeWarnings && pipeline.runtimeWarnings.length > 0 ? (
        <PageNotice
          variant="warning"
          title="MetaxPath runtime warning"
          className="rounded-xl border"
        >
          <div className="space-y-1.5">
            {pipeline.runtimeWarnings.map((warning, index) => (
              <p key={index}>{warning}</p>
            ))}
          </div>
        </PageNotice>
      ) : null}

      {metadataErrors.length > 0 ? (
        <PageNotice
          variant="error"
          title="Pipeline metadata needs attention"
          className="rounded-xl border"
        >
          <div className="space-y-1.5">
            {metadataErrors.map((issue, index) => (
              <p key={`${issue.field}-${index}`}>{issue.message}</p>
            ))}
          </div>
        </PageNotice>
      ) : null}

      <HelpBox title="What is this order pipeline?">
        {getOrderPipelineHelpText(pipeline)}
      </HelpBox>

      {isFacilityAdmin && !isDemo ? (
        <ExecutionTargetControl
          id="order-pipeline-execution-mode"
          value={executionMode}
          onChange={setExecutionMode}
          executionPolicy={pipeline.executionPolicy}
          slurmAvailability={slurmAvailability}
          slurmAvailabilityLoading={slurmAvailabilityLoading}
          slurmAvailabilityError={slurmAvailabilityError}
        />
      ) : null}

      {/* Pipeline settings — hidden in demo mode */}
      {!isDemo && pipeline?.pipelineId === SIMULATE_READS_PIPELINE_ID && pipeline?.configSchema?.properties && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Settings</h3>
          {renderSimulateReadsSettings()}
        </div>
      )}

      {!isDemo && pipeline?.pipelineId !== SIMULATE_READS_PIPELINE_ID && (
        <PipelineRunSettings
          configSchema={pipeline.configSchema}
          localConfig={localConfig}
          setLocalConfig={setLocalConfig}
          derivedSettings={loadingMetadata ? [] : metadataValidation?.derivedSettings}
        />
      )}

      {staleReadsPreservedCount > 0 ? (
        <PageNotice
          variant="warning"
          title="Stale reads will be preserved"
          className="rounded-xl border"
        >
          Replace Existing Reads is off. Simulate Reads will leave{" "}
          {staleReadsPreservedCount} stale linked sample
          {staleReadsPreservedCount === 1 ? "" : "s"} unchanged; turn it on to
          regenerate and repair those reads.
        </PageNotice>
      ) : null}

      {protectedReadySamples.length > 0 && pipeline.pipelineId !== READ_CLEANING_PIPELINE_ID ? (
        <PageNotice
          variant="warning"
          title="Raw or unknown reads selected"
          className="rounded-xl border"
        >
          {protectedReadySamples.length} ready sample
          {protectedReadySamples.length === 1 ? "" : "s"} use raw or unknown reads. Raw reads may still contain human contamination; pipeline launch will ask for confirmation.
        </PageNotice>
      ) : null}

      {pipeline.pipelineId === READ_CLEANING_PIPELINE_ID && readySamples.length > 0 ? (
        <PageNotice
          variant="info"
          title="Promotion required after cleaning"
          className="rounded-xl border"
        >
          Read Cleaning will not change active reads when the run completes. Review the reports and use Set as active cleaned reads on selected candidates after the run.
        </PageNotice>
      ) : null}

      {/* Sample table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">Samples</h2>
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
                {samples.length}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Readiness is based on this pipeline&apos;s required inputs.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
              {readySamples.length} ready
            </Badge>
            {blockedSampleCount > 0 ? (
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                {blockedSampleCount} blocked
              </Badge>
            ) : null}
            {activeRunCount > 0 ? (
              <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                {activeRunCount} active
              </Badge>
            ) : null}
            {completedRunCount > 0 ? (
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                {completedRunCount} completed
              </Badge>
            ) : null}
            {failedRunCount > 0 ? (
              <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
                {failedRunCount} failed
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="overflow-x-auto overflow-y-hidden">
          <table className={cn("w-full table-fixed text-sm", tableMinWidthClass)}>
          <colgroup>
            <col className="w-[6.5rem]" />
            <col className={sampleResultLayout === "columns" ? "w-[15rem]" : "w-[18rem]"} />
            <col className="w-[12rem]" />
            {sampleResultConfig
              ? sampleResultLayout === "columns"
                ? sampleResultConfig.values.map((descriptor, index) => (
                    <col
                      key={`${descriptor.path}-${index}`}
                      className="w-[7.5rem]"
                    />
                  ))
                : <col className="w-[17rem]" />
              : null}
          </colgroup>
          <thead>
            <tr className="border-b bg-secondary/30">
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                Action
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                Sample
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                Reads
              </th>
              {sampleResultConfig
                ? sampleResultLayout === "columns"
                  ? sampleResultConfig.values.map((descriptor, index) => (
                      <th
                        key={`${descriptor.path}-${index}`}
                        className="px-4 py-2.5 text-left font-medium text-muted-foreground"
                      >
                        {descriptor.label ?? sampleResultConfig.columnLabel}
                      </th>
                    ))
                  : (
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                        {sampleResultConfig.columnLabel}
                      </th>
                    )
                : null}
            </tr>
          </thead>
          <tbody>
            {samples.map((sample) => {
              const { ready, reason } = getSampleReadiness(sample);
              const isRunning = runningSampleIds.has(sample.id);
              const sampleResultPreview = getSampleResultPreview(
                sample,
                sampleResultConfig,
              );
              const hasSampleResultItems = !!sampleResultPreview && sampleResultPreview.items.length > 0;
              const sourceRunId =
                sample.read?.pipelineSources?.[pipelineId] ??
                sample.read?.pipelineRunId ??
                null;
              const sourceRun = sourceRunId
                ? allRuns.find((r) => r.id === sourceRunId)
                : null;
              const sourceLabel =
                sourceRun?.runNumber ??
                (sourceRunId ? sample.read?.pipelineRunNumber : null);
              const sampleLabel = sample.sampleAlias
                ? `${sample.sampleId} (${sample.sampleAlias})`
                : sample.sampleId;
              const sampleActionCopy = getSampleRunActionCopy({
                pipeline,
                sampleLabel,
                isDemo,
                systemBlocked,
                systemSummary: systemReady?.summary,
                launchBlockMessage,
              });

              return (
                <tr
                  key={sample.id}
                  className="border-b last:border-0 transition-colors hover:bg-secondary/20"
                >
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center gap-1.5">
                      {sampleResultLayout === "columns" && hasSampleResultItems ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="shrink-0 rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
                              aria-label={`Clear ${sampleResultConfig?.columnLabel ?? "result"} for ${sample.sampleId}`}
                              onClick={() => void handleClearSampleResult(sample.id)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right" align="start" sideOffset={8} className="max-w-xs text-left">
                            <div className="space-y-1">
                              <p className="font-medium">Clear displayed result</p>
                              <p>
                                Removes the values shown in the {sampleResultConfig?.columnLabel ?? "result"} columns for this sample.
                                It does not delete FASTQ files or the completed pipeline run.
                              </p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                      {initialCheckPending ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <Button size="sm" variant="outline" disabled className="h-9 px-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="sr-only">Checking pipeline environment</span>
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right" align="start" sideOffset={8} className="max-w-xs text-left">
                            <div className="space-y-1">
                              <p className="font-medium">Checking environment</p>
                              <p>SeqDesk is checking whether the local pipeline runtime is configured before enabling sample runs.</p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      ) : isRunning ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <Button size="sm" variant="outline" disabled className="h-9 px-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="sr-only">Pipeline running</span>
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right" align="start" sideOffset={8} className="max-w-xs text-left">
                            <div className="space-y-1">
                              <p className="font-medium">Pipeline already running</p>
                              <p>A run for {sampleLabel} is queued or running. Wait for it to complete before starting another run for this sample.</p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      ) : ready ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-9 px-3"
                                disabled={systemBlocked || launchBlocked || !!isDemo}
                                onClick={() => void handleRunSingle(sample.id)}
                                aria-label={`${sampleActionCopy.title} for ${sample.sampleId}`}
                              >
                                {systemBlocked || launchBlocked ? (
                                  <AlertCircle className="h-4 w-4" />
                                ) : (
                                  <Play className="h-4 w-4" />
                                )}
                                <span className="sr-only">
                                  {systemBlocked || launchBlocked ? "Blocked" : "Run"}
                                </span>
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right" align="start" sideOffset={8} className="max-w-xs text-left">
                            <div className="space-y-1">
                              <p className="font-medium">{sampleActionCopy.title}</p>
                              <p>{sampleActionCopy.description}</p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              role="button"
                              tabIndex={0}
                              className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-amber-100 px-2 text-xs font-semibold text-amber-700"
                              aria-label={`Cannot run sample: ${reason ?? "not ready"}`}
                            >
                              !
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right" align="start" sideOffset={8} className="max-w-xs text-left">
                            <div className="space-y-1">
                              <p className="font-medium">Cannot run sample</p>
                              <p>{getReadinessProblemText(reason)}</p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="break-words font-medium">{sample.sampleId}</div>
                    {sample.sampleAlias && (
                      <div className="text-xs text-muted-foreground">
                        {sample.sampleAlias}
                      </div>
                    )}
                    <div className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                      <span className="shrink-0">Source</span>
                      <button
                        type="button"
                        className={cn(
                          "min-w-0 truncate text-left transition-colors hover:text-foreground hover:underline",
                          sourceLabel && "font-mono"
                        )}
                        title={sourceLabel ?? undefined}
                        onClick={() =>
                          setChangeSourceSample({
                            id: sample.id,
                            sampleId: sample.sampleId,
                            currentRunId: sourceRunId,
                          })
                        }
                      >
                        {sourceLabel
                          ? sourceLabel
                          : sample.read
                            ? "Manual"
                            : "Not linked"}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    {sample.read?.file1 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-emerald-700 border-emerald-200 bg-emerald-50">
                          {sample.read.file2 ? "Paired-end" : "Single-end"}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={cn("text-[11px]", getReadDataClassBadgeClassName(sample.read.dataClass))}
                        >
                          {sample.read.dataClassLabel ?? READ_DATA_CLASS_LABELS[sample.read.dataClass ?? "cleaned"]}
                        </Badge>
                        {sample.read.isSimulated ? (
                          <Badge
                            variant="outline"
                            className={cn("text-[11px]", getReadOriginBadgeClassName(sample.read.readOrigin))}
                          >
                            {sample.read.readOriginLabel}
                          </Badge>
                        ) : null}
                        {sample.read.filesMissing && (
                          <Badge
                            variant="outline"
                            className="text-orange-700 border-orange-200 bg-orange-50"
                            title={[
                              sample.read.file1 && sample.read.fileSize1 == null && "R1 file missing from disk",
                              sample.read.file2 && sample.read.fileSize2 == null && "R2 file missing from disk",
                            ].filter(Boolean).join("; ") || "Source files missing from disk"}
                          >
                            Stale
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-amber-700 border-amber-200 bg-amber-50">
                        No reads
                      </Badge>
                    )}
                  </td>
                  {sampleResultConfig
                    ? sampleResultLayout === "columns"
                      ? sampleResultConfig.values.map((descriptor, index) => {
                          const item = getSampleResultPreviewItem(sample, descriptor);

                          return (
                            <td
                              key={`${sample.id}-${descriptor.path}-${index}`}
                              className="px-4 py-3 align-top"
                            >
                              {item ? (
                                item.previewPath ? (
                                  <button
                                    type="button"
                                    className={cn(
                                      "inline-flex items-center gap-1 whitespace-nowrap font-mono text-xs text-blue-600 hover:text-blue-800 hover:underline cursor-pointer",
                                      sample.read?.filesMissing && "line-through text-muted-foreground pointer-events-none"
                                    )}
                                    onClick={() =>
                                      setPreviewFile({
                                        path: item.previewPath!,
                                        label: `${descriptor.label ? descriptor.label + " — " : ""}${item.value}`,
                                      })
                                    }
                                    disabled={!!sample.read?.filesMissing}
                                  >
                                    {item.value}
                                    <ExternalLink className="h-2.5 w-2.5" />
                                  </button>
                                ) : (
                                  <span
                                    className={cn(
                                      "whitespace-nowrap font-mono text-xs",
                                      sample.read?.filesMissing && "line-through text-muted-foreground"
                                    )}
                                  >
                                    {item.value}
                                  </span>
                                )
                              ) : descriptor.previewable ? (
                                <span className="text-xs text-muted-foreground">
                                  {sampleResultConfig.emptyText ?? "No result yet"}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </td>
                          );
                        })
                      : (
                          <td className="px-4 py-3 align-top">
                            {hasSampleResultItems ? (
                              <div className="flex items-start gap-1.5">
                                <div className="min-w-0 space-y-1">
                                  {sampleResultPreview.items.map((item) => (
                                    <div
                                      key={`${item.label ?? "value"}-${item.value}`}
                                      className="flex min-w-0 items-center gap-1 text-xs"
                                    >
                                      {item.label ? (
                                        <span className="mr-1 shrink-0 text-muted-foreground">
                                          {item.label}
                                        </span>
                                      ) : null}
                                      {item.previewPath ? (
                                        <button
                                          type="button"
                                          className={cn(
                                            "inline-flex items-center gap-0.5 whitespace-nowrap font-mono text-blue-600 hover:text-blue-800 hover:underline cursor-pointer",
                                            sample.read?.filesMissing && "line-through text-muted-foreground pointer-events-none"
                                          )}
                                          onClick={() => setPreviewFile({ path: item.previewPath!, label: `${item.label ? item.label + " — " : ""}${item.value}` })}
                                          disabled={!!sample.read?.filesMissing}
                                        >
                                          {item.value}
                                          <ExternalLink className="h-2.5 w-2.5" />
                                        </button>
                                      ) : (
                                        <span className={cn("font-mono", sample.read?.filesMissing && "line-through text-muted-foreground")}>{item.value}</span>
                                      )}
                                    </div>
                                  ))}
                                  {sample.read?.filesMissing && (
                                    <div className="text-xs text-orange-600">
                                      Source files deleted
                                    </div>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                                  title="Clear result"
                                  onClick={() => void handleClearSampleResult(sample.id)}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                <span className="text-xs text-muted-foreground">
                                  {sampleResultConfig.emptyText ?? "No result yet"}
                                </span>
                                {sample.read?.filesMissing && (
                                  <div className="text-xs text-orange-600">
                                    Source files deleted
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        )
                    : null}
                </tr>
              );
            })}
            {samples.length === 0 && (
              <tr>
                <td
                  colSpan={columnCount}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No samples in this order.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Pipeline Runs table */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">Pipeline Runs</h2>
            {allRuns.length > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
                {allRuns.length}
              </span>
            )}
          </div>
          {allRuns.length > 0 && (
            <div className="flex items-center gap-2">
              {selectMode ? (
                <>
                  <span className="text-xs text-muted-foreground">
                    {selectedRunIds.size} selected
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setShowBulkDeleteConfirm(true)}
                    disabled={bulkDeleting || selectedRunIds.size === 0 || !!isDemo}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Delete
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setSelectMode(false);
                      setSelectedRunIds(new Set());
                    }}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setSelectMode(true)}
                  >
                    Select
                  </Button>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-8 w-[160px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                          {opt.value !== "all" && statusCounts[opt.value] ? (
                            <span className="ml-1 text-muted-foreground">
                              ({statusCounts[opt.value]})
                            </span>
                          ) : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {statusFilter !== "all" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setStatusFilter("all")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {allRuns.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No runs started for this pipeline yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-secondary/30">
                  <tr>
                    {selectMode && (
                      <th className="w-[40px] px-3 py-2.5">
                        <Checkbox
                          checked={allFilteredSelected && deletableFilteredRuns.length > 0}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all runs"
                        />
                      </th>
                    )}
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Run
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Details
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Results
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Samples
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Started
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Duration
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Started by
                    </th>
                    <th className="w-[48px] px-4 py-2.5">
                      {/* Actions */}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredRuns.map((run) => {
                    const details = getRunDetails(run);
                    const sampleCount = getSampleCount(run);

                    return (
                      <tr
                        key={run.id}
                        tabIndex={selectMode ? undefined : 0}
                        aria-label={`View details for ${run.runNumber}`}
                        className={cn(
                          "transition-colors hover:bg-secondary/20",
                          !selectMode &&
                            "cursor-pointer focus-visible:bg-secondary/20 focus-visible:outline-none",
                          selectMode && selectedRunIds.has(run.id) && "bg-secondary/30"
                        )}
                        onClick={() => {
                          if (!selectMode) {
                            setDetailRun(run);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (
                            selectMode ||
                            event.currentTarget !== event.target ||
                            (event.key !== "Enter" && event.key !== " ")
                          ) {
                            return;
                          }

                          event.preventDefault();
                          setDetailRun(run);
                        }}
                      >
                        {selectMode && (
                          <td
                            className="px-3 py-3 align-top"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Checkbox
                              checked={selectedRunIds.has(run.id)}
                              onCheckedChange={() => toggleSelectRun(run.id)}
                              disabled={run.status === "running"}
                              aria-label={`Select run ${run.runNumber}`}
                            />
                          </td>
                        )}
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-wrap items-center gap-2">
                            <code
                              className="rounded bg-muted px-2 py-0.5 text-xs font-mono"
                              title={run.runNumber}
                            >
                              {run.runNumber}
                            </code>
                            {isRunVisibleToUser(run) && (
                              <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
                                <CheckCircle2 className="h-3 w-3" />
                                Visible to user
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center gap-2">
                            {getStatusBadge(run.status)}
                            {run.status === "running" && run.progress != null && run.progress > 0 && (
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {run.progress}%
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="max-w-[280px] px-4 py-3 align-top">
                          {details ? (
                            <span
                              className={`text-xs ${
                                run.status === "failed"
                                  ? "font-mono text-destructive"
                                  : "text-muted-foreground"
                              }`}
                              title={details}
                            >
                              <span className="line-clamp-2">{details}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </td>
                        <td
                          className="px-4 py-3 align-top"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="space-y-1.5">
                            <PipelineRunResultLinks
                              status={run.status}
                              resultFiles={run.resultFiles}
                              primaryResultFile={run.primaryResultFile}
                              omittedCount={run.resultFilesOmittedCount}
                              omittedSampleFileCount={run.resultFilesOmittedSampleFileCount}
                              hasOutputErrors={runHasOutputErrors(run)}
                            />
                            {getPendingWritebackCount(run) > 0 && (
                              <Badge
                                variant="outline"
                                className="gap-1 border-amber-200 bg-amber-50 text-amber-700"
                              >
                                <ShieldCheck className="h-3 w-3" />
                                {getPendingWritebackCount(run)} pending review
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-muted-foreground tabular-nums">
                          {sampleCount != null ? sampleCount : "-"}
                        </td>
                        <td className="px-4 py-3 align-top whitespace-nowrap text-xs text-muted-foreground">
                          {formatDateTime(run.startedAt || run.createdAt)}
                        </td>
                        <td className="px-4 py-3 align-top whitespace-nowrap text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {run.status === "running"
                              ? formatDuration(run.startedAt, null)
                              : formatDuration(run.startedAt, run.completedAt)}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top whitespace-nowrap text-xs text-muted-foreground">
                          {getUserDisplay(run)}
                        </td>
                        <td
                          className="px-4 py-3 align-top text-right"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label={`Actions for ${run.runNumber}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={(event) => {
                                  event.preventDefault();
                                  setDetailRun(run);
                                }}
                              >
                                <Info className="h-4 w-4" />
                                View details
                              </DropdownMenuItem>
                              {isFacilityAdmin && !isDemo && run.status === "completed" && !isRunVisibleToUser(run) && (
                                <DropdownMenuItem
                                  disabled={selectionUpdatingRunId === run.id}
                                  onSelect={(event) => {
                                    event.preventDefault();
                                    void handleSetVisibleRun(run, true);
                                  }}
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                  Make visible to user
                                </DropdownMenuItem>
                              )}
                              {isFacilityAdmin && !isDemo && shouldOfferPendingReview(run) && (
                                <DropdownMenuItem
                                  onSelect={(event) => {
                                    event.preventDefault();
                                    setDetailRun(run);
                                  }}
                                >
                                  <ShieldCheck className="h-4 w-4" />
                                  Review pending outputs
                                </DropdownMenuItem>
                              )}
                              {isFacilityAdmin && !isDemo && isRunVisibleToUser(run) && (
                                <DropdownMenuItem
                                  disabled={selectionUpdatingRunId === run.id}
                                  onSelect={(event) => {
                                    event.preventDefault();
                                    void handleSetVisibleRun(run, false);
                                  }}
                                >
                                  <X className="h-4 w-4" />
                                  Hide from user
                                </DropdownMenuItem>
                              )}
                              {!isDemo && (
                                <DropdownMenuItem
                                  variant="destructive"
                                  disabled={run.status === "running" || deletingRun}
                                  onSelect={(event) => {
                                    event.preventDefault();
                                    setDeleteTarget(run);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete run
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredRuns.length === 0 && statusFilter !== "all" && (
                    <tr>
                      <td
                        colSpan={selectMode ? 10 : 9}
                        className="px-4 py-8 text-center text-muted-foreground"
                      >
                        No {statusFilter} runs found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
            <h3 className="text-base font-semibold">Delete Pipeline Run</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Are you sure you want to delete run{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                {deleteTarget.runNumber}
              </code>
              ? This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteTarget(null)}
                disabled={deletingRun}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deletingRun}
                onClick={() => void handleDeleteRun(deleteTarget.id)}
              >
                {deletingRun ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Bulk delete confirmation dialog */}
      {/* Run details modal */}
      {detailRun && (() => {
        let parsedConfig: Record<string, unknown> | null = null;
        try {
          parsedConfig = detailRun.config ? JSON.parse(detailRun.config) : null;
        } catch { /* ignore */ }

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
            <div className={cn("w-full rounded-xl border bg-card p-6 shadow-lg", getPendingWritebackCount(detailRun) > 0 ? "max-w-4xl" : "max-w-2xl")}>
              <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
                <span>Run Details</span>
                <code className="min-w-0 max-w-full break-all rounded bg-muted px-2 py-0.5 text-xs font-mono font-normal">
                  {detailRun.runNumber}
                </code>
              </h3>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Status:</span>
                  {getStatusBadge(detailRun.status)}
                  {getPendingWritebackCount(detailRun) > 0 && (
                    <Badge
                      variant="outline"
                      className="gap-1 border-amber-200 bg-amber-50 text-amber-700"
                    >
                      <ShieldCheck className="h-3 w-3" />
                      {getPendingWritebackCount(detailRun)} pending review
                    </Badge>
                  )}
                  {isRunVisibleToUser(detailRun) && (
                    <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" />
                      Visible to user
                    </Badge>
                  )}
                </div>
                {isRunVisibleToUser(detailRun) && detailRun.selectedFinal && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground">User visibility:</span>
                    <span>
                      Published by {getSelectedByDisplay(detailRun)} at{" "}
                      {formatDateTime(detailRun.selectedFinal.selectedAt)}
                    </span>
                  </div>
                )}
                <div className="flex gap-2">
                  <span className="text-muted-foreground">Started:</span>
                  <span>{formatDateTime(detailRun.startedAt || detailRun.createdAt)}</span>
                </div>
                {detailRun.completedAt && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground">Completed:</span>
                    <span>{formatDateTime(detailRun.completedAt)}</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <span className="text-muted-foreground">Duration:</span>
                  <span>
                    {detailRun.status === "running"
                      ? formatDuration(detailRun.startedAt, null)
                      : formatDuration(detailRun.startedAt, detailRun.completedAt)}
                  </span>
                </div>
                {detailRun.user && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground">Started by:</span>
                    <span>
                      {[detailRun.user.firstName, detailRun.user.lastName]
                        .filter(Boolean)
                        .join(" ") || detailRun.user.email}
                    </span>
                  </div>
                )}
                {parsedConfig && Object.keys(parsedConfig).length > 0 && (
                  <>
                    <div className="border-t pt-3">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Settings
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)]">
                      {Object.entries(parsedConfig).map(([key, value]) => {
                        const schemaProp = pipeline?.configSchema?.properties?.[key];
                        const label = schemaProp?.title || key;
                        let displayValue: string;
                        if (typeof value === "boolean") {
                          displayValue = value ? "Yes" : "No";
                        } else if (
                          typeof value === "string" &&
                          SIMULATE_READS_ENUM_LABELS[value]
                        ) {
                          displayValue = SIMULATE_READS_ENUM_LABELS[value];
                        } else {
                          displayValue = String(value ?? "-");
                        }
                        return (
                          <div key={key} className="contents">
                            <span className="text-muted-foreground">{label}:</span>
                            <span
                              className="min-w-0 break-all font-mono text-xs"
                              title={displayValue}
                            >
                              {displayValue}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
                {detailRun.errorTail && (
                  <>
                    <div className="border-t pt-3">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Error
                      </span>
                    </div>
                    <pre className="max-h-40 overflow-auto rounded bg-muted p-3 text-xs font-mono text-destructive">
                      {detailRun.errorTail}
                    </pre>
                  </>
                )}
                <PendingWritebackReviewPanel
                  run={detailRun}
                  isDemo={isDemo}
                  isFacilityAdmin={isFacilityAdmin}
                  onPromoted={() => {
                    void runsResponse.mutate();
                    onSampleDataChanged?.();
                  }}
                  onError={setError}
                />
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDetailRun(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* Change source modal */}
      {changeSourceSample && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
            <h3 className="text-base font-semibold">
              Change Source
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Select which pipeline run provides results for{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                {changeSourceSample.sampleId}
              </code>
            </p>
            {completedRunsForSample.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No completed runs available for this sample.
              </p>
            ) : (
              <div className="mt-4 max-h-64 space-y-1 overflow-y-auto">
                {completedRunsForSample.map((run) => {
                  const isCurrent = run.id === changeSourceSample.currentRunId;
                  return (
                    <button
                      key={run.id}
                      type="button"
                      disabled={changingSource}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                        isCurrent
                          ? "border-primary/40 bg-primary/5"
                          : "hover:bg-muted/50"
                      )}
                      onClick={() => {
                        if (!isCurrent) void handleChangeSource(run.id);
                      }}
                    >
                      <div>
                        <span className="font-mono text-xs font-medium">
                          {run.runNumber}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {formatDateTime(run.completedAt || run.createdAt)}
                        </span>
                        {run.user && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {getUserDisplay(run)}
                          </span>
                        )}
                      </div>
                      {isCurrent && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          Current
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setChangeSourceSample(null)}
                disabled={changingSource}
              >
                {changingSource ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Applying...
                  </>
                ) : (
                  "Close"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
            <h3 className="text-base font-semibold">Delete Pipeline Runs</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Are you sure you want to delete{" "}
              <strong>{selectedRunIds.size}</strong> run{selectedRunIds.size !== 1 ? "s" : ""}?
              This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBulkDeleteConfirm(false)}
                disabled={bulkDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={bulkDeleting}
                onClick={() => void handleBulkDelete()}
              >
                {bulkDeleting ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Delete {selectedRunIds.size} run{selectedRunIds.size !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* HTML Report Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="relative flex h-[90vh] w-[90vw] max-w-6xl flex-col rounded-xl border bg-card shadow-lg">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-medium truncate">{previewFile.label}</h3>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/files/preview?path=${encodeURIComponent(previewFile.path)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  Open in new tab
                  <ExternalLink className="h-3 w-3" />
                </a>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  onClick={() => setPreviewFile(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <iframe
              src={`/api/files/preview?path=${encodeURIComponent(previewFile.path)}`}
              className="flex-1 w-full rounded-b-xl"
              title={previewFile.label}
              sandbox="allow-same-origin allow-scripts"
            />
          </div>
        </div>
      )}
    </div>
  );
}
