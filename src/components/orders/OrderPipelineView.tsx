"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpBox } from "@/components/ui/help-box";
import { PageNotice } from "@/components/ui/page-notice";
import { toast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  getSampleResultPreview,
  getSampleResultPreviewItem,
} from "@/lib/pipelines/sample-result";
import type { PipelineRunResultFile } from "@/lib/pipelines/result-files";
import { PipelineReportPreview } from "@/components/pipelines/PipelineReportPreview";
import { PipelineRunResultLinks } from "@/components/pipelines/PipelineRunResultLinks";
import { PipelineFileDownload, isPipelineReportPath } from "@/components/pipelines/PipelineFileDownload";
import { pipelinePageRequest } from "@/lib/pipelines/page-request";
import { useInputMetadataCheck } from "@/lib/pipelines/useInputMetadataCheck";
import { formatRunDateTime, getRunTiming } from "@/lib/pipelines/run-timing";
import {
  PipelineRunSettings,
} from "@/components/pipelines/PipelineRunSettings";
import type {
  PipelineConfigProperty,
  PipelineSampleResult,
} from "@/lib/pipelines/types";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Info,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type { OrderSequencingSummaryResponse } from "@/lib/sequencing/types";
import {
  READ_DATA_CLASS_BADGE_CLASSNAMES,
  type ReadDataClass,
} from "@/lib/sequencing/constants";
import { useQuickPrerequisiteStatus } from "@/lib/pipelines/useQuickPrerequisiteStatus";
import { pipelineRunOverrides } from "@/lib/pipelines/config-schema-validation";
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
  getEffectiveExecutionMode,
  getExecutionTargetBlockMessage,
  isExecutionTargetBlocked,
  useSlurmAvailability,
  type ExecutionModeRequest,
} from "@/components/pipelines/ExecutionTargetControl";

const fetcher = <T,>(url: string) => pipelinePageRequest<T>(url);

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
    id: string;
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
  const step = run.currentStep?.trim();
  if (step && step.toLowerCase() !== run.status.toLowerCase() &&
      !(run.status === "completed" && /^completed successfully\.?$/i.test(step))) {
    return step;
  }
  if (run.status === "queued") return "Waiting for execution";
  if (run.status === "pending") return "Waiting for execution";
  return "";
}

// Keep the recognizable prefix and sequence, not the date already shown in the
// Started column. The full identifier stays in the row label, tooltip and dialog.
function compactRunNumber(runNumber: string): string {
  const datedRun = /^(.+)-\d{8}-(\d+)$/.exec(runNumber);
  if (datedRun) return `${datedRun[1].slice(0, 10)}…${datedRun[2].slice(-6)}`;
  return runNumber.length > 18 ? `${runNumber.slice(0, 8)}…${runNumber.slice(-6)}` : runNumber;
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

function getOrderPipelineHelpText(pipeline: AdminPipeline): string {
  if (pipeline.pipelineId === SIMULATE_READS_PIPELINE_ID) {
    return "Simulate Reads generates test FASTQ files and adds them to your samples. Use it to test SeqDesk without real sequencer output. To work with real data, add or import your reads from Files.";
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
    return "This pipeline processes the read files selected for each sample. Samples are ready when all required input files are linked and available on disk.";
  }

  return "This pipeline runs on the samples in this data collection and saves its results in SeqDesk.";
}


function PendingWritebackReviewPanel({
  run,
  isDemo,
  canResolveOutputs,
  onPromoted,
  onError,
}: {
  run: PipelineRun;
  isDemo?: boolean;
  canResolveOutputs?: boolean;
  onPromoted?: () => void;
  onError?: (message: string) => void;
}) {
  const [selectedSampleIds, setSelectedSampleIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reviewChecked, setReviewChecked] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const response = useSWR<PendingWritebackResponse>(
    canResolveOutputs && run.status === "completed" && shouldOfferPendingReview(run)
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

  if (
    !canResolveOutputs ||
    run.status !== "completed" ||
    !shouldOfferPendingReview(run)
  ) {
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
      const promotedCount = selectedSampleIds.size;
      toast.success(
        `Set active reads for ${promotedCount} sample${promotedCount === 1 ? "" : "s"}`
      );
      await response.mutate();
      onPromoted?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to promote pending outputs";
      onError?.(message);
      toast.error(message);
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
              "Select staged read candidates that should become active reads for this sequencing order. Existing raw or unknown reads are preserved."}
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

          {canResolveOutputs && !isDemo ? (
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

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmOpen(false);
            setReviewChecked(false);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {review?.confirmTitle ?? "Set as active reads"}
            </DialogTitle>
            <DialogDescription>
              {review?.confirmDescription ??
                "This will change which read files SeqDesk uses for delivery and downstream pipelines. Existing raw or unknown reads will be preserved. Existing active cleaned reads will be superseded, not deleted."}{" "}
              This applies to {selectedCount} sample{selectedCount === 1 ? "" : "s"}.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-28 overflow-auto rounded-md bg-muted px-3 py-2 text-xs font-mono text-muted-foreground">
            {selectedCandidates.map((candidate) => candidate.sampleCode).join(", ")}
          </div>
          <label className="flex items-start gap-2 text-sm">
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
          <DialogFooter>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface OrderPipelineViewProps {
  orderId: string;
  pipelineId: string;
  samples: OrderSequencingSummaryResponse["samples"];
  inputSelection?: {
    description: ReactNode;
    renderSample: (sampleId: string) => ReactNode;
  };
  onRunCompleted?: () => void;
  onSampleDataChanged?: () => void;
  isDemo?: boolean;
  /** @deprecated Use the capability props below. Kept for older callers/tests. */
  isFacilityAdmin?: boolean;
  canRunPipelines?: boolean;
  canManagePipelines?: boolean;
  canResolveOutputs?: boolean;
  canCancelOwnRuns?: boolean;
  canCancelAllRuns?: boolean;
  canPurgeRuns?: boolean;
  currentUserId?: string;
}

function resultSourceRunId(sample: OrderPipelineViewProps["samples"][number], pipelineId: string): string | null {
  const sources = sample.read?.pipelineSources;
  // A different pipeline may have produced the active reads or a shared value
  // (for example, import-provided checksums). Do not attribute that to this one.
  return sources?.[pipelineId] ?? (sources && Object.keys(sources).length > 0 ? null : sample.read?.pipelineRunId ?? null);
}

export function OrderPipelineView(props: OrderPipelineViewProps) {
  // Drafts, pending requests and page cursors must never carry into another collection/pipeline.
  return <OrderPipelineContent key={`${props.orderId}:${props.pipelineId}`} {...props} />;
}

function OrderPipelineContent({
  orderId,
  pipelineId,
  samples,
  inputSelection,
  onRunCompleted,
  onSampleDataChanged,
  isDemo,
  isFacilityAdmin = false,
  canRunPipelines = isFacilityAdmin,
  canManagePipelines = isFacilityAdmin,
  canResolveOutputs = isFacilityAdmin,
  canCancelOwnRuns = false,
  canCancelAllRuns = isFacilityAdmin,
  canPurgeRuns = isFacilityAdmin,
  currentUserId,
}: OrderPipelineViewProps) {
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>({});
  const [executionMode, setExecutionMode] = useState<ExecutionModeRequest>("default");
  const setupScope = `${orderId}:${pipelineId}`;
  const [simulateReadsAdvancedOpen, setSimulateReadsAdvancedOpen] = useState(false);
  const [pendingRunSampleIds, setPendingRunSampleIds] = useState<Set<string>>(new Set());
  const [startingRun, setStartingRun] = useState(false);
  const startingRunRef = useRef(false);
  const [sampleSelection, setSampleSelection] = useState<{ scope: string; ids: Set<string> } | null>(null);
  const [error, setError] = useState("");
  const confirm = useConfirm();
  const [historyPage, setHistoryPage] = useState(0);
  const [sourcePage, setSourcePage] = useState(0);
  const [clearingSampleId, setClearingSampleId] = useState<string | null>(null);
  const clearingSampleRef = useRef(false);
  const initializedConfig = useRef(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState<PipelineRun | null>(null);
  const [deletingRun, setDeletingRun] = useState(false);
  const [stoppingRunId, setStoppingRunId] = useState<string | null>(null);
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const deletionSelectMode = selectMode && canPurgeRuns && !isDemo;
  const [selectionUpdatingRunId, setSelectionUpdatingRunId] = useState<string | null>(null);
  const [detailRun, setDetailRun] = useState<PipelineRun | null>(null);
  const [sourceDetailsLoading, setSourceDetailsLoading] = useState<string | null>(null);
  const sourceDetailsRequest = useRef<AbortController | null>(null);
  const historyDescriptionId = useId();
  const [historyDisclosure, setHistoryDisclosure] = useState<{
    scope: string;
    open: boolean;
    activeIds: string[];
  } | null>(null);
  const [changeSourceSample, setChangeSourceSample] = useState<{
    id: string;
    sampleId: string;
    currentRunId?: string | null;
  } | null>(null);
  const [changingSource, setChangingSource] = useState(false);
  const [sourceActionError, setSourceActionError] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<{ path: string; label: string; runId?: string | null } | null>(null);
  const [timingNow, setTimingNow] = useState(() => Date.now());
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
  } = useSlurmAvailability(Boolean(canManagePipelines && !isDemo));

  const pipelinesResponse = useSWR<{ pipelines: AdminPipeline[] }>(
    "/api/admin/settings/pipelines?enabled=true&catalog=order",
    fetcher
  );
  const runsResponse = useSWR<{ runs: PipelineRun[]; total: number }>(
    `/api/pipelines/runs?orderId=${encodeURIComponent(orderId)}&pipelineId=${encodeURIComponent(pipelineId)}&limit=50`,
    fetcher,
    {
      refreshInterval: isDemo ? 0 : 10000,
      revalidateOnFocus: !isDemo,
      revalidateOnReconnect: !isDemo,
    }
  );

  const historyQuery = historyPage > 0 || statusFilter !== "all";
  const historyResponse = useSWR<{ runs: PipelineRun[]; total: number }>(
    historyQuery ? `/api/pipelines/runs?orderId=${encodeURIComponent(orderId)}&pipelineId=${encodeURIComponent(pipelineId)}&limit=50&offset=${historyPage * 50}${statusFilter === "all" ? "" : `&status=${encodeURIComponent(statusFilter)}`}` : null,
    fetcher,
    { refreshInterval: isDemo ? 0 : 10000, revalidateOnFocus: !isDemo }
  );
  const displayedHistory = historyQuery ? historyResponse : runsResponse;
  const mutateRecentRuns = runsResponse.mutate;
  const mutateHistoryRuns = historyResponse.mutate;
  const refreshRuns = useCallback(async () => {
    // Revalidation errors are displayed through SWR; do not turn a completed
    // mutation into an unhandled rejection or leave an older history page stale.
    await Promise.allSettled([mutateRecentRuns(), ...(historyQuery ? [mutateHistoryRuns()] : [])]);
  }, [mutateRecentRuns, mutateHistoryRuns, historyQuery]);

  const sourcesResponse = useSWR<{ runs: PipelineRun[]; total: number }>(
    changeSourceSample ? `/api/pipelines/runs?orderId=${encodeURIComponent(orderId)}&pipelineId=${encodeURIComponent(pipelineId)}&status=completed&sampleId=${encodeURIComponent(changeSourceSample.id)}&limit=20&offset=${sourcePage * 20}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const pipeline = useMemo(
    () =>
      (pipelinesResponse.data?.pipelines ?? []).find(
        (p) => p.pipelineId === pipelineId && p.enabled
      ) ?? null,
    [pipelinesResponse.data?.pipelines, pipelineId]
  );

  const allRuns = useMemo(() => [...new Map([
    ...(historyResponse.data?.runs ?? []), ...(runsResponse.data?.runs ?? []),
  ].map(run => [run.id, run])).values()], [runsResponse.data?.runs, historyResponse.data?.runs]);

  useEffect(() => {
    if (allRuns.length === 0) return;
    const timer = window.setInterval(() => setTimingNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [allRuns.length]);

  const hasActiveRuns = useMemo(
    () => allRuns.some((run) => ["pending", "queued", "running"].includes(run.status)),
    [allRuns]
  );

  const historyActiveIds = useMemo(
    () => allRuns.filter((run) => ["pending", "queued", "running"].includes(run.status)).map((run) => run.id).sort(),
    [allRuns]
  );
  const historyOpen = historyDisclosure?.scope === setupScope
    ? historyDisclosure.open
    : historyActiveIds.length > 0;

  useEffect(() => {
    setHistoryDisclosure((previous) => {
      if (previous?.scope !== setupScope) {
        return { scope: setupScope, open: historyActiveIds.length > 0, activeIds: historyActiveIds };
      }
      if (previous.activeIds.join(",") === historyActiveIds.join(",")) return previous;
      const newActiveRun = historyActiveIds.some((id) => !previous.activeIds.includes(id));
      // Open for a new run, not every poll. Leave the finished run visible and
      // respect a user's decision to collapse the same ongoing run.
      return { ...previous, open: previous.open || newActiveRun, activeIds: historyActiveIds };
    });
  }, [setupScope, historyActiveIds]);

  useEffect(() => () => sourceDetailsRequest.current?.abort(), [setupScope]);

  const showSourceRun = useCallback(async (runId: string) => {
    sourceDetailsRequest.current?.abort();
    setError("");
    const cached = allRuns.find((run) => run.id === runId);
    if (cached) {
      setSourceDetailsLoading(null);
      setDetailRun(cached);
      return;
    }

    // A current result can originate from a run older than the history page.
    const controller = new AbortController();
    sourceDetailsRequest.current = controller;
    setSourceDetailsLoading(runId);
    try {
      const response = await fetch(`/api/pipelines/runs/${encodeURIComponent(runId)}`, { signal: controller.signal });
      const payload = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !payload.run) throw new Error(getApiErrorMessage(payload, "Source run details are not available."));
      setDetailRun({
        ...payload.run,
        config: typeof payload.run.config === "string" ? payload.run.config : JSON.stringify(payload.run.config ?? null),
        inputSampleIds: Array.isArray(payload.run.inputSampleIds) ? JSON.stringify(payload.run.inputSampleIds) : payload.run.inputSampleIds,
      });
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load source run details.");
    } finally {
      if (sourceDetailsRequest.current === controller) {
        sourceDetailsRequest.current = null;
        setSourceDetailsLoading(null);
      }
    }
  }, [allRuns]);

  // Derive running sample IDs from active pipeline runs + pending API calls
  const runningSampleIds = useMemo(() => {
    const ids = new Set(pendingRunSampleIds);
    for (const run of allRuns) {
      if (["pending", "queued", "running"].includes(run.status)) {
        if (!run.inputSampleIds) {
          // Older order-wide runs have no explicit sample list.
          for (const sample of samples) ids.add(sample.id);
        } else {
          try {
            const parsed = JSON.parse(run.inputSampleIds) as string[];
            if (Array.isArray(parsed)) for (const id of parsed) ids.add(id);
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
  }, [allRuns, pendingRunSampleIds, samples]);

  // Detect when a previously active run transitions to "completed" and notify parent
  const prevActiveRunIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentActiveIds = new Set(
      allRuns
        .filter((r) => ["pending", "queued", "running"].includes(r.status))
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
        ? displayedHistory.data?.runs ?? []
        : (displayedHistory.data?.runs ?? []).filter((run) => run.status === statusFilter),
    [displayedHistory.data?.runs, statusFilter]
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const run of allRuns) {
      counts[run.status] = (counts[run.status] || 0) + 1;
    }
    return counts;
  }, [allRuns]);

  useEffect(() => {
    if (!pipeline || initializedConfig.current) return;
    initializedConfig.current = true;
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

  // Config keys the facility has pinned via install-profile/server config (a
  // non-empty value in `pipeline.config`, not just the package default). Fields
  // flagged `hideWhenServerConfigured` — e.g. read-cleaning's `kraken2Db` — are
  // hidden from this per-run form so users don't re-enter the managed path.
  const serverManagedKeys = useMemo(() => {
    const keys = new Set<string>();
    const serverConfig = pipeline?.config;
    if (!serverConfig) return keys;
    for (const [key, value] of Object.entries(serverConfig)) {
      if (typeof value === "string" ? value.trim() !== "" : value != null) {
        keys.add(key);
      }
    }
    return keys;
  }, [pipeline?.config]);

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
  const selectableSamples = useMemo(
    () => readySamples.filter((sample) => !runningSampleIds.has(sample.id)),
    [readySamples, runningSampleIds]
  );
  // Start with the available samples selected. After an explicit choice, polling
  // must not silently add newly imported samples to the user's next run.
  const selectedSamples = useMemo(
    () => sampleSelection?.scope === setupScope
      ? selectableSamples.filter((sample) => sampleSelection.ids.has(sample.id))
      : selectableSamples,
    [sampleSelection, setupScope, selectableSamples]
  );
  const selectedSampleIds = useMemo(() => new Set(selectedSamples.map((sample) => sample.id)), [selectedSamples]);
  const selectedSampleIdsKey = JSON.stringify([...selectedSampleIds]);
  const selectedInputRevision = JSON.stringify(selectedSamples.map((sample) => [
    sample.id, sample.updatedAt, sample.read?.id, sample.read?.file1, sample.read?.file2,
  ]));
  const {
    data: metadataValidation,
    loading: loadingMetadata,
    error: metadataCheckError,
    retry: retryMetadataCheck,
  } = useInputMetadataCheck({
    orderId, pipelineId: pipeline?.pipelineId, sampleIdsKey: selectedSampleIdsKey,
    inputRevision: selectedInputRevision, enabled: canRunPipelines && !isDemo,
  });
  const allSamplesSelected = selectableSamples.length > 0 && selectedSamples.length === selectableSamples.length;
  const toggleInputSample = (sampleId: string, checked: boolean) => {
    const ids = new Set(selectedSampleIds);
    if (checked) ids.add(sampleId); else ids.delete(sampleId);
    setSampleSelection({ scope: setupScope, ids });
  };
  const toggleAllInputSamples = () => {
    setSampleSelection({ scope: setupScope, ids: allSamplesSelected ? new Set() : new Set(selectableSamples.map((sample) => sample.id)) });
  };
  const protectedSelectedSamples = useMemo(
    () => selectedSamples.filter((sample) => sample.read?.isProtectedRaw),
    [selectedSamples]
  );
  const executionTargetBlockMessage = useMemo(
    () =>
      pipeline && canManagePipelines && !isDemo
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
      canManagePipelines,
      pipeline,
      slurmAvailability,
      slurmAvailabilityError,
      slurmAvailabilityLoading,
    ]
  );
  const viewOnly = Boolean(isDemo || (!canRunPipelines && !canManagePipelines));
  const metadataErrors = useMemo(
    () =>
      !loadingMetadata && metadataValidation
        ? metadataValidation.issues.filter((issue) => issue.severity === "error")
        : [],
    [loadingMetadata, metadataValidation]
  );
  const metadataBlockMessage = metadataCheckError ? "Could not check inputs. Retry the check before running."
    : loadingMetadata
    ? "Pipeline metadata is still loading."
    : metadataErrors[0]?.message ?? (metadataValidation?.valid === false ? "Input metadata did not pass validation." : null);
  const runListUnavailable = Boolean(runsResponse.error || runsResponse.isLoading);
  const launchBlockMessage = metadataBlockMessage || executionTargetBlockMessage ||
    (runListUnavailable ? "Waiting for an up-to-date run list before starting." : null) ||
    (pipelinesResponse.error ? "Pipeline settings could not be refreshed. Retry before running." : null);
  const launchBlocked =
    Boolean(launchBlockMessage);

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
      if (!pipeline || !canRunPipelines || isDemo) return;
      if (
        canManagePipelines &&
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
        const confirmed = await confirm({
          title: "Run on raw reads?",
          description: `${protectedSamples.length} selected sample${protectedSamples.length === 1 ? "" : "s"} use raw or unknown reads. Raw reads may still contain human contamination. Continue running ${pipeline.name}?`,
          confirmLabel: "Run anyway",
          variant: "destructive",
        });
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
            config: pipelineRunOverrides(pipeline.configSchema, localConfig),
            ...(canManagePipelines ? { executionMode } : {}),
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

        const warnings = Array.isArray(startPayload?.warnings)
          ? (startPayload.warnings as string[])
          : [];
        if (warnings.length > 0) {
          toast.warning(`Pipeline started — ${warnings.length} sample(s) skipped`, {
            description: warnings[0],
          });
        } else {
          toast.success("Pipeline run started");
        }

        await refreshRuns();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start pipeline";
        setError(message);
        toast.error(message);
        // Creation may have succeeded even when starting or receiving its reply failed.
        // Refresh persisted state instead of making that run disappear from the page.
        await refreshRuns().catch(() => undefined);
      }
    },
    [
      confirm,
      executionMode,
      executionTargetBlockMessage,
      canManagePipelines,
      canRunPipelines,
      isDemo,
      localConfig,
      orderId,
      pipeline,
      refreshRuns,
      samples,
      slurmAvailability,
      slurmAvailabilityError,
      slurmAvailabilityLoading,
    ]
  );

  const handleDeleteRun = useCallback(
    async (runId: string) => {
      if (!canPurgeRuns || isDemo) return;
      setDeletingRun(true);
      try {
        const res = await fetch(`/api/pipelines/runs/${runId}/delete`, {
          method: "POST",
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(getApiErrorMessage(payload, "Failed to delete run"));
        }
        await refreshRuns();
        setDeleteTarget(null);
        onSampleDataChanged?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete run");
      } finally {
        setDeletingRun(false);
      }
    },
    [canPurgeRuns, isDemo, refreshRuns, onSampleDataChanged]
  );

  const handleStopRun = useCallback(
    async (runId: string) => {
      if (
        !(await confirm({
          title: "Stop this run?",
          description:
            "The SLURM/local job will be cancelled and the run marked as cancelled.",
          confirmLabel: "Stop run",
          variant: "destructive",
        }))
      ) {
        return;
      }
      setStoppingRunId(runId);
      setError("");
      try {
        const res = await fetch(`/api/pipelines/runs/${runId}`, {
          method: "DELETE",
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(getApiErrorMessage(payload, "Failed to stop run"));
        }
        if (payload?.alreadyFinalized) {
          toast.info(`Run already finished (${payload.status ?? "done"})`);
        } else {
          toast.success("Run cancelled");
        }
        await refreshRuns();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to stop run";
        setError(message);
        toast.error(message);
      } finally {
        setStoppingRunId(null);
      }
    },
    [confirm, refreshRuns]
  );

  const handleBulkDelete = useCallback(async () => {
    if (!canPurgeRuns || selectedRunIds.size === 0) return;
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
      await refreshRuns();
      setSelectedRunIds(new Set());
      setShowBulkDeleteConfirm(false);
      onSampleDataChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete runs");
    } finally {
      setBulkDeleting(false);
    }
  }, [canPurgeRuns, selectedRunIds, refreshRuns, onSampleDataChanged]);

  const handleSetVisibleRun = useCallback(
    async (run: PipelineRun, selected: boolean) => {
      if (!canResolveOutputs || isDemo) return;

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
        await refreshRuns();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to update result visibility"
        );
      } finally {
        setSelectionUpdatingRunId(null);
      }
    },
    [canResolveOutputs, isDemo, refreshRuns]
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
    if (isDemo || !hasActiveRuns) return;

    const interval = window.setInterval(() => {
      void refreshRuns();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [hasActiveRuns, isDemo, refreshRuns]);

  const handleRunSelected = async () => {
    if (!canRunPipelines || isDemo || initialCheckPending || systemBlocked || launchBlocked || startingRunRef.current || selectedSamples.length === 0) return;
    const ids = selectedSamples.map((sample) => sample.id);
    startingRunRef.current = true;
    setStartingRun(true);
    setPendingRunSampleIds(new Set(ids));
    try {
      await runPipeline(ids);
    } finally {
      setPendingRunSampleIds(new Set());
      startingRunRef.current = false;
      setStartingRun(false);
    }
  };


  const handleClearSampleResult = useCallback(
    async (sampleId: string) => {
      if (!pipeline?.sampleResult || !canResolveOutputs || isDemo || clearingSampleRef.current) return;
      clearingSampleRef.current = true;
      setClearingSampleId(sampleId);
      setError("");
      const fields = pipeline.sampleResult.values
        .map((v) => {
          const parts = v.path.split(".");
          return parts.length === 2 && parts[0] === "read" ? parts[1] : null;
        })
        .filter((f): f is string => f !== null);

      try {
        if (fields.length === 0 || !await confirm({
          title: "Clear current result?",
          description: "This removes the current result values and links for this sample. It does not delete files or run history. You can restore saved outputs using Change result source.",
          confirmLabel: "Clear current result",
          variant: "destructive",
        })) return;
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
      } finally {
        clearingSampleRef.current = false;
        setClearingSampleId(null);
      }
    },
    [orderId, pipeline?.sampleResult, onSampleDataChanged, canResolveOutputs, isDemo, confirm]
  );

  const completedRunsForSample = useMemo(() => {
    if (!changeSourceSample) return [];
    return (sourcesResponse.data?.runs ?? []).filter((run) => {
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
  }, [sourcesResponse.data?.runs, changeSourceSample]);

  const handleChangeSource = useCallback(
    async (runId: string) => {
      if (!changeSourceSample) return;
      setChangingSource(true);
      setSourceActionError(null);
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
        setSourceActionError(err instanceof Error ? err.message : "Failed to change source");
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

  if (!pipeline && pipelinesResponse.error) {
    return <PageNotice variant="error" title="Could not load pipeline settings">
      <p>{pipelinesResponse.error instanceof Error ? pipelinesResponse.error.message : "Please retry."}</p>
      <Button size="sm" variant="outline" className="mt-2" onClick={() => { void pipelinesResponse.mutate().catch(() => undefined); }}>Retry settings</Button>
    </PageNotice>;
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
  const columnCount = 2 + sampleResultColumnCount; // Clear, sample/source + saved results
  const tableMinWidthClass = sampleResultConfig
    ? sampleResultLayout === "columns"
      ? "min-w-[640px]"
      : "min-w-[480px]"
    : "min-w-[640px]";

  const selectedWithResults = selectedSamples.filter(sample => {
    const preview = getSampleResultPreview(sample, pipeline.sampleResult);
    const sourceId = resultSourceRunId(sample, pipelineId);
    const recordedForPipeline = Boolean(sample.read?.pipelineSources?.[pipelineId] || allRuns.some(run => run.id === sourceId && run.pipelineId === pipelineId));
    return recordedForPipeline && preview && preview.items.length > 0;
  });
  const rerunLabel = selectedSamples.length > 0 && selectedWithResults.length === selectedSamples.length
    ? `Run ${pipeline.name} again` : `Run ${pipeline.name}`;
  const changedSettings = selectedWithResults.some(sample => {
    const sourceId = resultSourceRunId(sample, pipelineId);
    const source = allRuns.find(run => run.id === sourceId);
    if (!source?.config) return false;
    try {
      const recorded = JSON.parse(source.config);
      if (!recorded || typeof recorded !== "object" || Array.isArray(recorded)) return false;
      // Compare only settings actually recorded by that run. Missing legacy
      // snapshots must not be described as identical inputs/settings.
      return Object.keys(recorded).some(key => key in localConfig && JSON.stringify(recorded[key]) !== JSON.stringify(localConfig[key]));
    } catch { return false; }
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
              Checking setup...
            </Button>
          ) : (
            <>
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
                {checkingSystem ? "Checking setup..." : "Check setup again"}
              </Button>
            </>
          )}
        </div>
      </div>

      <HelpBox title="What does this pipeline do?">
        {getOrderPipelineHelpText(pipeline)}
      </HelpBox>

      <section aria-label="Run setup" className="space-y-4 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">1</span>
          <h2 className="text-sm font-medium">Run setup</h2>
        </div>
      {canManagePipelines && !isDemo ? (
        <ExecutionTargetControl
          id="order-pipeline-execution-mode"
          value={executionMode}
          onChange={setExecutionMode}
          executionPolicy={pipeline.executionPolicy}
          slurmAvailability={slurmAvailability}
          slurmAvailabilityLoading={slurmAvailabilityLoading}
          slurmAvailabilityError={slurmAvailabilityError}
          className="rounded-none border-0 p-0"
        />
      ) : <div className="space-y-1 text-xs">
        <p className="font-medium">Where to run</p>
        <p>{getEffectiveExecutionMode("default", pipeline.executionPolicy) === "local" ? "SeqDesk server (local)" : "Compute cluster (SLURM)"}</p>
        <p className="text-muted-foreground">Uses the execution setting configured by your administrator.</p>
      </div>}

      {/* Pipeline settings — hidden in demo mode */}
      {!isDemo && pipeline?.pipelineId === SIMULATE_READS_PIPELINE_ID && pipeline?.configSchema?.properties && (
        <div className="border-t pt-4">
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
          serverManagedKeys={serverManagedKeys}
        />
      )}
      </section>

      {(runsResponse.error || pipelinesResponse.error) && <PageNotice variant="warning" title="Could not refresh this page">
        <p>{(runsResponse.error ?? pipelinesResponse.error) instanceof Error ? (runsResponse.error ?? pipelinesResponse.error).message : "Connection failed. Your last loaded data is still shown."}</p>
        <p className="mt-1">Saved results remain available. Refresh the checks before starting another run.</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => { void Promise.allSettled([refreshRuns(), pipelinesResponse.mutate()]); }}>Retry page checks</Button>
      </PageNotice>}

      {metadataCheckError && <PageNotice variant="error" title="Could not check inputs">
        <p>{metadataCheckError}</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={retryMetadataCheck}>Retry input check</Button>
      </PageNotice>}

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

      {protectedSelectedSamples.length > 0 && pipeline.pipelineId !== READ_CLEANING_PIPELINE_ID ? (
        <PageNotice
          variant="warning"
          title="Raw or unknown reads selected"
          className="rounded-xl border"
        >
          {protectedSelectedSamples.length} selected sample
          {protectedSelectedSamples.length === 1 ? "" : "s"} use raw or unknown reads. Raw reads may still contain human contamination; pipeline launch will ask for confirmation.
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

      {/* Choose inputs here; reports and earlier runs live below. */}
      <section aria-label="Input data" className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">2</span>
              <h2 className="text-sm font-medium">Choose samples</h2>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Select the samples to process, then run {pipeline.name}.
            </p>
          </div>
          <Link className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" href={`/orders/${orderId}/samples-files`}>
            Manage files
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm">
            <colgroup><col className="w-[42%] sm:w-1/3" /><col /></colgroup>
            <thead>
              <tr className="border-b bg-secondary/30 text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      aria-label="Select all available samples"
                      checked={allSamplesSelected ? true : selectedSamples.length > 0 ? "indeterminate" : false}
                      disabled={!canRunPipelines || !!isDemo || startingRun || selectableSamples.length === 0}
                      onCheckedChange={toggleAllInputSamples}
                    />
                    Sample
                  </div>
                </th>
                <th className="px-4 py-3 font-medium">Input files</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((sample) => {
                const { ready, reason } = getSampleReadiness(sample);
                const isRunning = runningSampleIds.has(sample.id);
                return <tr key={sample.id} className="border-b last:border-0">
                  <td className="px-4 py-4 align-top">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        aria-label={`Select ${sample.sampleId}`}
                        checked={selectedSampleIds.has(sample.id)}
                        disabled={!canRunPipelines || !!isDemo || startingRun || !ready || isRunning}
                        onCheckedChange={(checked) => toggleInputSample(sample.id, checked === true)}
                      />
                      <div className="min-w-0">
                        <div className="break-words font-medium">{sample.sampleId}</div>
                        {sample.sampleAlias && sample.sampleAlias !== sample.sampleId && <div className="mt-0.5 break-words text-xs text-muted-foreground">{sample.sampleAlias}</div>}
                        {isRunning && <p className="mt-1 text-xs text-muted-foreground">{pendingRunSampleIds.has(sample.id) ? "Starting…" : "Already queued or running"}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 align-top">
                    {inputSelection ? inputSelection.renderSample(sample.id) : sample.read?.file1 ? (
                      <div className="min-w-0 space-y-1">
                        <div className="break-all text-xs">{basename(sample.read.file1)}{sample.read.file2 && <> + {basename(sample.read.file2)}</>}</div>
                        <div className="text-xs text-muted-foreground">{sample.read.file2 ? "Paired-end" : "Single-end"}</div>
                      </div>
                    ) : <span className="text-xs text-muted-foreground">{pipeline.input.perSample.reads ? "No read files" : "No input files required"}</span>}
                    {!ready && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{getReadinessProblemText(reason)}</p>}
                    {ready && sample.read?.filesMissing && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Previous read files are missing from disk.</p>}
                  </td>
                </tr>;
              })}
              {samples.length === 0 && <tr><td colSpan={2} className="px-4 py-8 text-sm text-muted-foreground">No samples in this sequencing data collection. Add files or wait for an import to finish.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-secondary/20 px-4 py-3">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {startingRun ? "Starting your pipeline…" : viewOnly ? "View only" : selectedSamples.length > 0
              ? `${selectedSamples.length} sample${selectedSamples.length === 1 ? "" : "s"} selected`
              : selectableSamples.length > 0 ? "Select at least one sample to continue." : "No samples available to run. Check the files or active runs below."}
          </p>
          {!isDemo && <Button
            size="sm"
            disabled={!canRunPipelines || selectedSamples.length === 0 || startingRun || initialCheckPending || systemBlocked || launchBlocked}
            onClick={() => void handleRunSelected()}
          >
            {startingRun && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            {startingRun ? "Starting…" : rerunLabel}
          </Button>}
        </div>
        {selectedWithResults.length > 0 && <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          {selectedWithResults.length} selected sample{selectedWithResults.length === 1 ? " has" : "s have"} saved results. This creates a new run; previous reports remain in run history.
          {changedSettings && <span className="mt-1 block">Settings differ from the saved source run.</span>}
        </p>}
        {!startingRun && (launchBlockMessage || initialCheckPending || systemBlocked) && <p className="border-t px-4 py-3 text-xs text-muted-foreground" role="status">
          {launchBlockMessage || (initialCheckPending ? "Checking pipeline setup…" : systemReady?.summary || "Check pipeline setup before starting.")}
        </p>}
      </section>

      {sampleResultConfig && samples.length > 0 && <section aria-label="Current results" className="overflow-hidden rounded-xl border bg-card">
        <div className="border-b px-4 py-4">
          <h2 className="text-sm font-medium">Current results</h2>
          <p className="mt-1 text-xs text-muted-foreground">Reports and key values currently used for each sample.</p>
        </div>
        <div className="overflow-x-auto overflow-y-hidden">
          <table className={cn("w-full table-fixed text-sm", tableMinWidthClass)}>
          <colgroup>
            <col className="w-[2.5rem]" />
            <col className="w-[10rem]" />
            {sampleResultConfig
              ? sampleResultLayout === "columns"
                ? sampleResultConfig.values.map((descriptor, index) => (
                    <col
                      key={`${descriptor.path}-${index}`}
                      className={descriptor.previewable ? "w-[9rem]" : "w-[5.5rem]"}
                    />
                  ))
                : <col className="w-[17rem]" />
              : null}
          </colgroup>
          <thead>
            <tr className="border-b bg-secondary/30">
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                <span className="sr-only">Result actions</span>
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                Sample
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
              const sampleResultPreview = getSampleResultPreview(
                sample,
                sampleResultConfig,
              );
              const hasSampleResultItems = !!sampleResultPreview && sampleResultPreview.items.length > 0;
              const sourceRunId = resultSourceRunId(sample, pipelineId);
              const sourceRun = sourceRunId
                ? allRuns.find((r) => r.id === sourceRunId)
                : null;
              const sourceLabel =
                sourceRun?.runNumber ??
                (sourceRunId && sourceRunId === sample.read?.pipelineRunId ? sample.read?.pipelineRunNumber : null) ??
                sourceRunId;
              return (
                <tr
                  key={sample.id}
                  className="border-b last:border-0 transition-colors hover:bg-secondary/20"
                >
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center gap-1.5">
                      {canResolveOutputs && !isDemo && <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-7" aria-label={`Result actions for ${sample.sampleId}`} disabled={clearingSampleId === sample.id}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem aria-label={`Change result source for ${sample.sampleId}`} onSelect={() => {
                            setSourcePage(0);
                            setSourceActionError(null);
                            setChangeSourceSample({ id: sample.id, sampleId: sample.sampleId, currentRunId: sourceRunId });
                          }}>Change result source</DropdownMenuItem>
                          {hasSampleResultItems && <DropdownMenuItem variant="destructive" aria-label={`Clear current result for ${sample.sampleId}`} disabled={clearingSampleId !== null} onSelect={() => { void handleClearSampleResult(sample.id); }}>Clear current result</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="break-words font-medium">{sample.sampleId}</div>
                    {sample.sampleAlias && (
                      <div className="text-xs text-muted-foreground">
                        {sample.sampleAlias}
                      </div>
                    )}
                    <div className="mt-1 space-y-1 text-[11px] text-muted-foreground">
                      {hasSampleResultItems && sourceRunId && sourceLabel ? (
                        <button
                          type="button"
                          className="flex max-w-full items-center gap-1 text-left hover:text-foreground hover:underline"
                          aria-label={`From run ${sourceLabel} for ${sample.sampleId}`}
                          title={`View run ${sourceLabel}`}
                          disabled={sourceDetailsLoading === sourceRunId}
                          onClick={() => void showSourceRun(sourceRunId)}
                        >
                          <span className="shrink-0">From run</span>
                          <span className="min-w-0 truncate font-mono">{compactRunNumber(sourceLabel)}</span>
                          {sourceDetailsLoading === sourceRunId && <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden="true" />}
                        </button>
                      ) : hasSampleResultItems ? <span>No linked run</span> : null}

                    </div>
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
                                  <div className="flex min-w-0 items-center gap-1">
                                  <button
                                    type="button"
                                    className={cn(
                                      "inline-flex min-w-0 items-center gap-1 whitespace-nowrap font-mono text-xs text-blue-600 hover:text-blue-800 hover:underline cursor-pointer",
                                      sample.read?.filesMissing && !isPipelineReportPath(item.previewPath!) && "line-through text-muted-foreground pointer-events-none"
                                    )}
                                    onClick={() =>
                                      setPreviewFile({
                                        path: item.previewPath!,
                                        label: `${descriptor.label ? descriptor.label + " — " : ""}${item.value}`,
                                        runId: sourceRunId,
                                      })
                                    }
                                    disabled={!!sample.read?.filesMissing && !isPipelineReportPath(item.previewPath!)}
                                  >
                                    <span className="truncate" title={item.value}>{item.value}</span>
                                    <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                                  </button>
                                  <PipelineFileDownload
                                    runId={sourceRunId}
                                    path={item.previewPath}
                                    label={`${descriptor.label ?? item.value} for ${sample.sampleId}`}
                                    disabled={!!isDemo}
                                    verifyAvailability
                                    reportsOnly
                                  />
                                  </div>
                                ) : (
                                  <span
                                    className={cn(
                                      "whitespace-nowrap font-mono text-xs"
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
                                            sample.read?.filesMissing && !isPipelineReportPath(item.previewPath!) && "line-through text-muted-foreground pointer-events-none"
                                          )}
                                          onClick={() => setPreviewFile({ path: item.previewPath!, label: `${item.label ? item.label + " — " : ""}${item.value}`, runId: sourceRunId })}
                                          disabled={!!sample.read?.filesMissing && !isPipelineReportPath(item.previewPath!)}
                                        >
                                          {item.value}
                                          <ExternalLink className="h-2.5 w-2.5" />
                                        </button>
                                      ) : (
                                        <span className="font-mono">{item.value}</span>
                                      )}
                                      {item.previewPath && <PipelineFileDownload
                                        runId={sourceRunId}
                                        path={item.previewPath}
                                        label={`${item.label ?? item.value} for ${sample.sampleId}`}
                                        disabled={!!isDemo}
                                    verifyAvailability
                                        reportsOnly
                                      />}
                                    </div>
                                  ))}
                                  {sample.read?.filesMissing && (
                                    <div className="text-xs text-orange-600">
                                      Input reads are missing. Saved reports are checked separately.
                                    </div>
                                  )}
                                </div>

                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                <span className="text-xs text-muted-foreground">
                                  {sampleResultConfig.emptyText ?? "No result yet"}
                                </span>
                                {sample.read?.filesMissing && (
                                  <div className="text-xs text-orange-600">
                                    Input reads are missing. Saved reports are checked separately.
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
                  No samples in this sequencing data collection. Add files or wait for an import to finish.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>

      </section>}

      <Collapsible
        open={historyOpen}
        onOpenChange={(open) => setHistoryDisclosure({ scope: setupScope, open, activeIds: historyActiveIds })}
        className="group overflow-hidden rounded-xl border bg-card"
      >
        <h2 aria-label="Run history">
          <CollapsibleTrigger asChild>
            <button type="button" aria-label="Run history" aria-describedby={historyDescriptionId} className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  Run history
                  {allRuns.length > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">{runsResponse.data?.total ?? allRuns.length}</span>}
                  {historyActiveIds.length > 0 && <span className="inline-flex items-center gap-1.5 text-xs font-normal text-teal-700 dark:text-teal-300">
                    <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden="true" />
                    {historyActiveIds.length} in progress
                  </span>}
                </span>
                <span id={historyDescriptionId} className="mt-1 block text-xs font-normal text-muted-foreground">
                  All attempts, execution reports and technical details.
                  <span className="sr-only"> {allRuns.length} runs; {historyActiveIds.length} in progress.</span>
                </span>
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
            </button>
          </CollapsibleTrigger>
        </h2>
        <CollapsibleContent>
        <section aria-label="Pipeline run history" className="border-t p-4">
          {allRuns.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
              {deletionSelectMode ? (
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
                  {canPurgeRuns && !isDemo && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setSelectMode(true)}
                    >
                      Select
                    </Button>
                  )}
                  <Select value={statusFilter} onValueChange={value => { setStatusFilter(value); setHistoryPage(0); }}>
                    <SelectTrigger className="h-8 w-[160px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                          {opt.value !== "all" && (runsResponse.data?.total ?? 0) <= 50 && statusCounts[opt.value] ? (
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
                      onClick={() => { setStatusFilter("all"); setHistoryPage(0); }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </>
              )}
            </div>
          )}

        {displayedHistory.error ? <div role="alert" className="rounded-lg border p-4 text-sm">
          <p>{displayedHistory.error instanceof Error ? displayedHistory.error.message : "Run history could not be loaded."}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => { void displayedHistory.mutate().catch(() => undefined); }}>Retry run history</Button>
        </div> : displayedHistory.isLoading ? <p role="status" className="rounded-lg bg-muted p-4 text-sm motion-safe:animate-pulse">Loading run history…</p> : !historyQuery && allRuns.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No runs started for this pipeline yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] table-fixed text-sm">
                <colgroup>
                  {deletionSelectMode && <col className="w-10" />}
                  <col className="w-[23%]" />
                  <col className="w-[20%]" />
                  <col className="w-[32%]" />
                  <col />
                  <col className="w-11" />
                </colgroup>
                <thead className="border-b bg-secondary/30">
                  <tr>
                    {deletionSelectMode && (
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
                      Results
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Run time
                    </th>
                    <th className="w-[48px] px-4 py-2.5">
                      {/* Actions */}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredRuns.map((run) => {
                    const details = getRunDetails(run);
                    const timing = getRunTiming(run, timingNow);
                    const sampleCount = getSampleCount(run);
                    const canCancelThisRun =
                      canCancelAllRuns ||
                      (canCancelOwnRuns && run.user?.id === currentUserId);

                    return (
                      <tr
                        key={run.id}
                        tabIndex={deletionSelectMode ? undefined : 0}
                        aria-label={`View details for ${run.runNumber}`}
                        className={cn(
                          "transition-colors hover:bg-secondary/20",
                          !deletionSelectMode &&
                            "cursor-pointer focus-visible:bg-secondary/20 focus-visible:outline-none",
                          deletionSelectMode && selectedRunIds.has(run.id) && "bg-secondary/30"
                        )}
                        onClick={() => {
                          if (!deletionSelectMode) {
                            setDetailRun(run);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (
                            deletionSelectMode ||
                            event.currentTarget !== event.target ||
                            (event.key !== "Enter" && event.key !== " ")
                          ) {
                            return;
                          }

                          event.preventDefault();
                          setDetailRun(run);
                        }}
                      >
                        {deletionSelectMode && (
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
                          <div className="min-w-0 space-y-1">
                            <span
                              className="block truncate font-mono text-xs font-medium"
                              title={run.runNumber}
                            >
                              {compactRunNumber(run.runNumber)}
                            </span>
                            {sampleCount != null && <p className="text-xs text-muted-foreground">
                              {sampleCount} sample{sampleCount === 1 ? "" : "s"}
                            </p>}
                            {isRunVisibleToUser(run) && (
                              <p className="text-xs text-muted-foreground">
                                Visible to user
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-wrap items-center gap-2">
                            {getStatusBadge(run.status)}
                            {run.status === "running" && run.progress != null && run.progress > 0 && (
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {run.progress}%
                              </span>
                            )}
                          </div>
                          {details ? (
                            <span
                              className={`mt-1.5 block text-xs ${
                                run.status === "failed"
                                  ? "font-mono text-destructive"
                                  : "text-muted-foreground"
                              }`}
                              title={details}
                            >
                              <span className="line-clamp-2 break-words">{details}</span>
                            </span>
                          ) : null}
                        </td>
                        <td
                          className="px-4 py-3 align-top"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="space-y-1.5">
                            <PipelineRunResultLinks
                              runId={run.id}
                              downloadsDisabled={!!isDemo}
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
                        <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                          <div title={timing.exactTimes}>
                            <time dateTime={timing.dateTime} className="block">{timing.relativeLabel}</time>
                            <p className="mt-1 tabular-nums">{timing.durationLabel}</p>
                          </div>
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
                              {canResolveOutputs && !isDemo && run.status === "completed" && !isRunVisibleToUser(run) && (
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
                              {canResolveOutputs && !isDemo && shouldOfferPendingReview(run) && (
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
                              {canResolveOutputs && !isDemo && isRunVisibleToUser(run) && (
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
                              {canCancelThisRun &&
                                !isDemo &&
                                ["pending", "queued", "running"].includes(
                                  run.status
                                ) && (
                                  <DropdownMenuItem
                                    disabled={stoppingRunId === run.id}
                                    onSelect={(event) => {
                                      event.preventDefault();
                                      void handleStopRun(run.id);
                                    }}
                                  >
                                    <Ban className="h-4 w-4" />
                                    Stop run
                                  </DropdownMenuItem>
                                )}
                              {canPurgeRuns && !isDemo && (
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
                  {filteredRuns.length === 0 && (
                    <tr>
                      <td
                        colSpan={deletionSelectMode ? 6 : 5}
                        className="px-4 py-8 text-center text-muted-foreground"
                      >
                        {statusFilter === "all" ? "No runs on this page." : `No ${statusFilter} runs found.`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {(historyPage > 0 || (displayedHistory.data?.total ?? 0) > 50) && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <Button size="sm" variant="outline" disabled={historyPage === 0 || displayedHistory.isLoading} onClick={() => setHistoryPage(page => page - 1)}>Newer runs</Button>
          <p>Page {historyPage + 1}{displayedHistory.data ? ` · ${displayedHistory.data.total} runs` : ""}</p>
          <Button size="sm" variant="outline" disabled={displayedHistory.isLoading || !!displayedHistory.error || (historyPage + 1) * 50 >= (displayedHistory.data?.total ?? 0)} onClick={() => setHistoryPage(page => page + 1)}>Older runs</Button>
        </div>}
      </section>
        </CollapsibleContent>
      </Collapsible>

      {/* Delete confirmation dialog */}
      <Dialog
        open={canPurgeRuns && Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deletingRun) setDeleteTarget(null);
        }}
      >
        {deleteTarget && (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Delete Pipeline Run</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete run{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                  {deleteTarget.runNumber}
                </code>
                ? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
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
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
      {/* Bulk delete confirmation dialog */}
      {/* Run details modal */}
      {detailRun && (() => {
        let parsedConfig: Record<string, unknown> | null = null;
        try {
          parsedConfig = detailRun.config ? JSON.parse(detailRun.config) : null;
        } catch { /* ignore */ }

        return (
          <Dialog
            open={Boolean(detailRun)}
            onOpenChange={(open) => {
              if (!open) setDetailRun(null);
            }}
          >
            <DialogContent
              showCloseButton={false}
              className="!w-[90vw] !max-w-[1200px] max-h-[90vh] overflow-y-auto"
            >
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span>Run Details</span>{" "}
                  <code className="min-w-0 max-w-full break-all rounded bg-muted px-2 py-0.5 text-xs font-mono font-normal">
                    {detailRun.runNumber}
                  </code>
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Inspect execution status, timing, settings, errors, and
                  reviewable outputs for this pipeline run.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
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
                  <span className="text-muted-foreground">Added:</span>
                  <span>{formatRunDateTime(detailRun.createdAt)}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground">Started:</span>
                  <span>{formatRunDateTime(detailRun.startedAt)}</span>
                </div>
                {detailRun.completedAt && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground">Ended:</span>
                    <span>{formatRunDateTime(detailRun.completedAt)}</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <span className="text-muted-foreground">Duration:</span>
                  <span>
                    {getRunTiming(detailRun, timingNow).duration ?? getRunTiming(detailRun, timingNow).durationLabel}
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
                  canResolveOutputs={canResolveOutputs}
                  onPromoted={() => {
                    void refreshRuns();
                    onSampleDataChanged?.();
                  }}
                  onError={setError}
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDetailRun(null)}
                >
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}
      {/* Change source modal */}
      <Dialog
        open={Boolean(changeSourceSample)}
        onOpenChange={(open) => {
          if (!open && !changingSource) setChangeSourceSample(null);
        }}
      >
        {changeSourceSample && (
          <DialogContent showCloseButton={false} className="max-w-md">
            <DialogHeader>
              <DialogTitle>Change result source</DialogTitle>
              <DialogDescription>
                Select which pipeline run provides results for{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                  {changeSourceSample.sampleId}
                </code>
                . This changes the displayed results; it does not start a new run.
              </DialogDescription>
            </DialogHeader>
            {sourceActionError && <p role="alert" className="text-sm text-destructive">{sourceActionError}</p>}
            {sourcesResponse.error ? <div role="alert" className="text-sm">
              <p>{sourcesResponse.error instanceof Error ? sourcesResponse.error.message : "Could not load result sources."}</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => { void sourcesResponse.mutate().catch(() => undefined); }}>Retry result sources</Button>
            </div> : sourcesResponse.isLoading ? <p role="status" className="rounded-lg bg-muted p-4 text-sm motion-safe:animate-pulse">Loading result sources…</p> : completedRunsForSample.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No completed runs available for this sample.
              </p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto">
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
            {(sourcePage > 0 || (sourcesResponse.data?.total ?? 0) > 20) && <div className="flex items-center justify-between gap-2 text-xs">
              <Button size="sm" variant="outline" disabled={sourcePage === 0 || changingSource || sourcesResponse.isLoading} onClick={() => setSourcePage(page => page - 1)}>Newer results</Button>
              <span>Page {sourcePage + 1}</span>
              <Button size="sm" variant="outline" disabled={(sourcePage + 1) * 20 >= (sourcesResponse.data?.total ?? 0) || changingSource || sourcesResponse.isLoading} onClick={() => setSourcePage(page => page + 1)}>Older results</Button>
            </div>}
            <DialogFooter>
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
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
      <Dialog
        open={canPurgeRuns && showBulkDeleteConfirm}
        onOpenChange={(open) => {
          if (!open && !bulkDeleting) setShowBulkDeleteConfirm(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Pipeline Runs</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong>{selectedRunIds.size}</strong> run{selectedRunIds.size !== 1 ? "s" : ""}?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {previewFile && <PipelineReportPreview key={`${previewFile.runId}:${previewFile.path}`} file={previewFile} isDemo={isDemo} onClose={() => setPreviewFile(null)} />}
    </div>
  );
}
