"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  FlaskConical,
  Loader2,
  Play,
  AlertCircle,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Trash2,
  MoreHorizontal,
  RefreshCw,
  Clock,
  X,
} from "lucide-react";
import {
  getAvailableAssemblies,
  resolveAssemblySelection,
} from "@/lib/pipelines/assembly-selection";
import { useQuickPrerequisiteStatus } from "@/lib/pipelines/useQuickPrerequisiteStatus";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const AUTO_ASSEMBLY_SELECTION = "__auto__";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface SubmgCoverageCheck {
  id: string;
  label: string;
  available: number;
  total: number;
  missingSampleIds: string[];
  missingDetail?: string;
}

interface SubmgCoverageSummary {
  summary: string;
  missingRequired: string[];
  checks: SubmgCoverageCheck[];
  binsSummary: string;
  binsHint?: string;
  studyAccessionMissing: boolean;
  blocking: boolean;
  sampleMissingRequired: Record<string, string[]>;
  sampleMissingMetadataFields: Record<string, string[]>;
  sampleMetadataMissingSummary?: string;
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
        enum?: unknown[];
      }
    >;
  };
  defaultConfig: Record<string, unknown>;
}

interface Sample {
  id: string;
  sampleId: string;
  sampleAlias?: string | null;
  reads: {
    id: string;
    file1: string | null;
    file2: string | null;
    checksum1?: string | null;
    checksum2?: string | null;
  }[];
  order?: {
    id: string;
    orderNumber: string;
    name: string | null;
    status: string;
  } | null;
  preferredAssemblyId: string | null;
  assemblies: {
    id: string;
    assemblyName: string | null;
    assemblyFile: string | null;
    createdByPipelineRunId: string | null;
    createdByPipelineRun: {
      id: string;
      runNumber: string;
      status: string;
      createdAt: string;
      completedAt: string | null;
    } | null;
  }[];
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
  errorTail: string | null;
  inputSampleIds?: string | null;
  runFolder?: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  user?: {
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null;
  _count?: {
    assembliesCreated: number;
    binsCreated: number;
  };
}

interface StudyPipelinesSectionProps {
  studyId: string;
  samples: Sample[];
  selectedPipelineId?: string | null;
  /** When set, only pipelines matching this category are shown. "analysis" excludes "submission". */
  categoryFilter?: "analysis" | "submission";
}

interface EnaSettingsResponse {
  enaTestMode?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "completed", label: "Completed" },
  { value: "running", label: "Running" },
  { value: "queued", label: "Queued" },
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

function formatRelativeTime(value: string): string {
  const now = new Date();
  const date = new Date(value);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  return `${diffMonths}mo ago`;
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
      return <Badge className="bg-[#00BD7D] text-white">Completed</Badge>;
    case "running":
      return <Badge className="bg-blue-600 text-white">Running</Badge>;
    case "queued":
      return <Badge variant="secondary">Queued</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "pending":
      return <Badge variant="outline">Pending</Badge>;
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
  if (run.status === "running") return "Currently running";
  return "";
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

function getFileName(filePath: string | null | undefined): string {
  if (!filePath) return "assembly";
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || filePath;
}

function fieldLabel(field: string): string {
  switch (field) {
    case "studyAccessionId":
    case "studyAccession":
      return "Study accession";
    case "reads":
      return "Paired reads";
    case "checksums":
      return "Read checksums";
    case "taxId":
      return "Sample taxId";
    case "checklistData":
    case "sampleMetadata":
      return "Sample metadata";
    case "assemblies":
      return "Assemblies";
    case "platform":
      return "Platform metadata";
    case "allowedSequencingTechnologies":
      return "Allowed technologies";
    default:
      return field;
  }
}

function extractSampleToken(message: string): string | null {
  const match = message.match(/^Sample\s+(.+?)(?::|\s+is\b|\s+has\b)/i);
  if (!match?.[1]) return null;
  return match[1].trim();
}

const SUBMG_REQUIRED_METADATA_FALLBACK_FIELDS = [
  "collection date",
  "geographic location (country and/or sea)",
] as const;

function extractSubmgMissingMetadataFields(message: string): string[] {
  const marker = "is missing required metadata fields for SubMG:";
  const markerIndex = message.toLowerCase().indexOf(marker.toLowerCase());
  if (markerIndex < 0) {
    if (/missing metadata \(checklist data\)/i.test(message)) {
      return [...SUBMG_REQUIRED_METADATA_FALLBACK_FIELDS];
    }
    return [];
  }

  const raw = message.slice(markerIndex + marker.length).trim();
  if (!raw) return [];

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function countMissingSamples(issues: MetadataIssue[], totalSamples: number): number {
  if (issues.length === 0) return 0;
  const sampleTokens = new Set<string>();
  for (const issue of issues) {
    const token = extractSampleToken(issue.message);
    if (token) sampleTokens.add(token);
  }
  if (sampleTokens.size > 0) {
    return Math.min(sampleTokens.size, totalSamples);
  }
  return Math.min(issues.length, totalSamples);
}

function addUniqueField(map: Record<string, string[]>, sampleId: string, label: string) {
  if (!map[sampleId]) {
    map[sampleId] = [];
  }
  if (!map[sampleId].includes(label)) {
    map[sampleId].push(label);
  }
}

function formatSampleMissingRequiredLabels(
  labels: string[],
  missingMetadataFields: string[]
): string[] {
  return labels.map((label) => {
    if (label !== "Sample metadata" || missingMetadataFields.length === 0) {
      return label;
    }
    return `Sample metadata (${missingMetadataFields.join(", ")})`;
  });
}

function formatSamplePreview(
  sampleIds: string[],
  sampleById: Map<string, Sample>,
  limit = 3
): string | null {
  if (sampleIds.length === 0) return null;
  const sampleCodes = sampleIds
    .map((id) => sampleById.get(id)?.sampleId)
    .filter((value): value is string => Boolean(value));
  if (sampleCodes.length === 0) return null;
  if (sampleCodes.length <= limit) return sampleCodes.join(", ");
  return `${sampleCodes.slice(0, limit).join(", ")}, +${sampleCodes.length - limit} more`;
}

// ---------------------------------------------------------------------------
// SubMG coverage summary builder
// ---------------------------------------------------------------------------

function buildSubmgCoverageSummary(params: {
  validation: MetadataValidation;
  samples: Sample[];
  selectedSampleIds: Set<string>;
  submitBins: boolean;
}): SubmgCoverageSummary {
  const { validation, samples, selectedSampleIds, submitBins } = params;
  const sampleCodeToId = new Map(samples.map((sample) => [sample.sampleId, sample.id]));
  const sampleById = new Map(samples.map((sample) => [sample.id, sample]));
  const selectedIds = Array.from(selectedSampleIds);
  const selectedSet = new Set(selectedIds);
  const selectedCount = selectedIds.length;

  const sampleErrorByField = new Map<string, Set<string>>();
  const sampleWarningByField = new Map<string, Set<string>>();
  const studyErrorFields = new Set<string>();
  const unscopedSampleErrorFields = new Set<string>();
  const sampleMissingMetadataFields: Record<string, string[]> = {};
  const metadataFieldMissingSampleIds = new Map<string, Set<string>>();
  const sampleScopedFields = new Set([
    "reads",
    "checksums",
    "taxId",
    "checklistData",
    "sampleMetadata",
    "assemblies",
    "bins",
  ]);

  for (const issue of validation.issues) {
    const token = extractSampleToken(issue.message);
    const resolvedSampleId = token ? sampleCodeToId.get(token) : undefined;
    const target =
      issue.severity === "error" ? sampleErrorByField : sampleWarningByField;

    if (resolvedSampleId) {
      const fieldSet = target.get(issue.field) || new Set<string>();
      fieldSet.add(resolvedSampleId);
      target.set(issue.field, fieldSet);

      if (
        issue.severity === "error" &&
        (issue.field === "sampleMetadata" || issue.field === "checklistData")
      ) {
        const missingFields = extractSubmgMissingMetadataFields(issue.message);
        if (missingFields.length > 0) {
          sampleMissingMetadataFields[resolvedSampleId] = missingFields;
          for (const missingField of missingFields) {
            const sampleIds = metadataFieldMissingSampleIds.get(missingField) || new Set<string>();
            sampleIds.add(resolvedSampleId);
            metadataFieldMissingSampleIds.set(missingField, sampleIds);
          }
        }
      }
      continue;
    }

    if (issue.severity === "error") {
      if (sampleScopedFields.has(issue.field)) {
        unscopedSampleErrorFields.add(issue.field);
      } else {
        studyErrorFields.add(issue.field);
      }
    }
  }

  const getMissingForFields = (
    fields: string[],
    severity: "error" | "warning"
  ): Set<string> => {
    const result = new Set<string>();
    const source = severity === "error" ? sampleErrorByField : sampleWarningByField;

    for (const field of fields) {
      const sampleSet = source.get(field);
      if (sampleSet) {
        for (const sampleId of sampleSet) {
          if (selectedSet.has(sampleId)) {
            result.add(sampleId);
          }
        }
      }
      if (severity === "error" && unscopedSampleErrorFields.has(field)) {
        for (const sampleId of selectedIds) {
          result.add(sampleId);
        }
      }
    }

    return result;
  };

  const missingPairedReads = getMissingForFields(["reads"], "error");
  for (const sampleId of selectedIds) {
    const sample = sampleById.get(sampleId);
    if (!sample) continue;
    const hasPairedReads = sample.reads?.some((read) => read.file1 && read.file2);
    if (!hasPairedReads) {
      missingPairedReads.add(sampleId);
    }
  }

  const missingChecksums = getMissingForFields(["checksums"], "error");
  const missingTaxId = getMissingForFields(["taxId"], "error");
  const missingMetadata = getMissingForFields(
    ["checklistData", "sampleMetadata"],
    "error"
  );
  const missingAssemblies = new Set<string>();
  for (const sampleId of selectedIds) {
    const sample = sampleById.get(sampleId);
    if (!sample) continue;
    const resolvedAssembly = resolveAssemblySelection(sample, {
      strictPreferred: true,
    }).assembly;
    if (!resolvedAssembly?.assemblyFile) {
      missingAssemblies.add(sampleId);
    }
  }

  let sampleMetadataMissingSummary: string | undefined;
  if (metadataFieldMissingSampleIds.size > 0 && selectedCount > 0) {
    sampleMetadataMissingSummary = Array.from(metadataFieldMissingSampleIds.entries())
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
      .map(([fieldName, sampleIds]) => `${fieldName} (${sampleIds.size}/${selectedCount})`)
      .join(", ");
  }

  const checks: SubmgCoverageCheck[] = [
    {
      id: "paired_reads",
      label: "Paired reads",
      available: Math.max(0, selectedCount - missingPairedReads.size),
      total: selectedCount,
      missingSampleIds: Array.from(missingPairedReads),
    },
    {
      id: "checksums",
      label: "Read checksums",
      available: Math.max(0, selectedCount - missingChecksums.size),
      total: selectedCount,
      missingSampleIds: Array.from(missingChecksums),
    },
    {
      id: "taxid",
      label: "Sample taxId",
      available: Math.max(0, selectedCount - missingTaxId.size),
      total: selectedCount,
      missingSampleIds: Array.from(missingTaxId),
    },
    {
      id: "metadata",
      label: "Sample metadata",
      available: Math.max(0, selectedCount - missingMetadata.size),
      total: selectedCount,
      missingSampleIds: Array.from(missingMetadata),
      missingDetail: sampleMetadataMissingSummary,
    },
    {
      id: "assemblies",
      label: "Assemblies",
      available: Math.max(0, selectedCount - missingAssemblies.size),
      total: selectedCount,
      missingSampleIds: Array.from(missingAssemblies),
    },
  ];

  const studyAccessionMissing =
    studyErrorFields.has("studyAccessionId") || studyErrorFields.has("studyAccession");
  const requiredTotal = 1 + checks.length;
  const requiredReady =
    (studyAccessionMissing ? 0 : 1) +
    checks.filter((check) => check.missingSampleIds.length === 0).length;

  const missingRequired: string[] = [];
  if (studyAccessionMissing) {
    missingRequired.push("Study accession");
  }
  for (const check of checks) {
    if (check.missingSampleIds.length > 0) {
      missingRequired.push(check.label);
    }
  }

  const sampleMissingRequired: Record<string, string[]> = {};
  const requiredCheckMap: Array<{ label: string; sampleIds: string[] }> = [
    { label: "Paired reads", sampleIds: Array.from(missingPairedReads) },
    { label: "Read checksums", sampleIds: Array.from(missingChecksums) },
    { label: "Sample taxId", sampleIds: Array.from(missingTaxId) },
    { label: "Sample metadata", sampleIds: Array.from(missingMetadata) },
    { label: "Assemblies", sampleIds: Array.from(missingAssemblies) },
  ];
  for (const entry of requiredCheckMap) {
    for (const sampleId of entry.sampleIds) {
      addUniqueField(sampleMissingRequired, sampleId, entry.label);
    }
  }

  const missingBins = submitBins ? getMissingForFields(["bins"], "warning") : new Set<string>();
  const binsIncluded = Math.max(0, selectedCount - missingBins.size);
  const binsSummary = submitBins
    ? selectedCount === 0
      ? "Bins: waiting for sample selection"
      : `Bins: ${binsIncluded}/${selectedCount} selected samples include bins`
    : "Bins: excluded (Submit Bins is off)";

  let binsHint: string | undefined;
  if (submitBins && missingBins.size > 0) {
    binsHint =
      "Samples without bins will still be submitted. Generate bins first with the MAG pipeline if needed.";
  } else if (!submitBins) {
    binsHint =
      "Enable \"Submit Bins\" if you want to include bins in this SubMG submission.";
  }

  const blocking =
    selectedCount === 0 ||
    studyAccessionMissing ||
    checks.some((check) => check.missingSampleIds.length > 0);

  return {
    summary: `${requiredReady}/${requiredTotal} required inputs available for selected samples`,
    missingRequired,
    checks,
    binsSummary,
    binsHint,
    studyAccessionMissing,
    blocking,
    sampleMissingRequired,
    sampleMissingMetadataFields,
    sampleMetadataMissingSummary,
  };
}

// ---------------------------------------------------------------------------
// Readiness helpers
// ---------------------------------------------------------------------------

function getReadinessIssues(params: {
  pipeline: Pipeline | null;
  samples: Sample[];
  selectedSampleIds: Set<string>;
  metadataValidation: MetadataValidation | null;
  loadingMetadata: boolean;
  prerequisites: PrerequisiteResult | null;
  loadingPrereqs: boolean;
  systemReady: { ready: boolean; summary: string } | null;
  checkingSystem: boolean;
  submgCoverage: SubmgCoverageSummary | null;
}): string[] {
  const {
    pipeline,
    samples,
    selectedSampleIds,
    metadataValidation,
    loadingMetadata,
    prerequisites,
    loadingPrereqs,
    systemReady,
    checkingSystem,
    submgCoverage,
  } = params;
  if (!pipeline) return [];

  const issues: string[] = [];
  const selectedSamples = samples.filter((s) => selectedSampleIds.has(s.id));

  if (selectedSamples.length === 0) {
    issues.push("No samples with paired reads available.");
    return issues;
  }

  // System prerequisites
  if (!checkingSystem && systemReady && !systemReady.ready) {
    issues.push(`System: ${systemReady.summary}`);
  }

  // Prerequisites from server check
  if (!loadingPrereqs && prerequisites && !prerequisites.requiredPassed) {
    issues.push(`System requirements not met: ${prerequisites.summary}`);
  }

  // SubMG-specific
  if (pipeline.pipelineId === "submg") {
    if (loadingMetadata) {
      issues.push("Checking metadata...");
      return issues;
    }
    if (submgCoverage?.blocking) {
      if (submgCoverage.studyAccessionMissing) {
        issues.push("Study accession is missing. Register this study in the Publishing section first.");
      }
      for (const check of submgCoverage.checks) {
        if (check.missingSampleIds.length > 0) {
          issues.push(
            `${check.label}: ${check.available}/${check.total} selected samples ready${check.missingDetail ? ` (fields: ${check.missingDetail})` : ""}`
          );
        }
      }
    }
    return issues;
  }

  // MAG-specific
  if (pipeline.pipelineId === "mag") {
    const samplesWithPairedReads = selectedSamples.filter((s) =>
      s.reads?.some((r) => r.file1 && r.file2)
    );
    if (samplesWithPairedReads.length === 0) {
      issues.push("No selected samples have paired reads linked.");
    }
    if (metadataValidation && !loadingMetadata) {
      const errors = metadataValidation.issues.filter((i) => i.severity === "error");
      for (const err of errors) {
        issues.push(err.message);
      }
    }
    return issues;
  }

  // Generic pipeline
  for (const sample of selectedSamples) {
    const hasPairedReads = sample.reads?.some((r) => r.file1 && r.file2);
    if (!hasPairedReads) {
      issues.push(`Sample ${sample.sampleId} is missing paired reads.`);
    }
  }

  if (metadataValidation && !loadingMetadata) {
    const errors = metadataValidation.issues.filter((i) => i.severity === "error");
    for (const err of errors) {
      issues.push(err.message);
    }
  }

  return issues;
}

function getMissingReadChecksumPaths(params: {
  samples: Sample[];
  sampleIds?: Set<string>;
  ignorePaths?: Record<string, true>;
}): string[] {
  const { samples, sampleIds, ignorePaths = {} } = params;
  const paths = new Set<string>();

  for (const sample of samples) {
    if (sampleIds && !sampleIds.has(sample.id)) {
      continue;
    }

    for (const read of sample.reads ?? []) {
      if (read.file1 && !read.checksum1 && !ignorePaths[read.file1]) {
        paths.add(read.file1);
      }
      if (read.file2 && !read.checksum2 && !ignorePaths[read.file2]) {
        paths.add(read.file2);
      }
    }
  }

  return Array.from(paths);
}

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StudyPipelinesSection({
  studyId,
  samples,
  selectedPipelineId: requestedPipelineId = null,
  categoryFilter,
}: StudyPipelinesSectionProps) {
  const { data: session } = useSession();
  const isFacilityAdmin = session?.user?.role === "FACILITY_ADMIN";

  // --- Data fetching ---
  const { data: pipelinesData, isLoading: pipelinesLoading, mutate: mutatePipelines } = useSWR<{
    pipelines: Pipeline[];
  }>(
    "/api/admin/settings/pipelines?enabled=true&catalog=study",
    fetcher
  );
  const { data: enaSettingsData } = useSWR<EnaSettingsResponse>(
    isFacilityAdmin ? "/api/admin/settings/ena" : null,
    fetcher
  );
  const {
    data: runsData,
    mutate: mutateRuns,
  } = useSWR<{ runs: PipelineRun[]; total?: number }>(
    `/api/pipelines/runs?studyId=${studyId}&limit=200`,
    fetcher
  );

  // --- Pipeline selection state ---
  const [selectedPipelineIdState, setSelectedPipelineId] = useState<string | null>(null);
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>({});
  // All samples with paired reads are always included (study pipelines run on all samples)
  const allSampleWithReadsIds = useMemo(
    () => new Set(samples.filter((s) => s.reads?.some((r) => r.file1 && r.file2)).map((s) => s.id)),
    [samples]
  );
  const [startingPipelineId, setStartingPipelineId] = useState<string | null>(null);
  const [error, setError] = useState("");

  // --- Validation state ---
  const [prerequisites, setPrerequisites] = useState<PrerequisiteResult | null>(null);
  const [loadingPrereqs, setLoadingPrereqs] = useState(false);
  const [metadataValidation, setMetadataValidation] = useState<MetadataValidation | null>(null);
  const [loadingMetadata, setLoadingMetadata] = useState(false);

  // --- Runs table state ---
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  // --- Assembly selection state ---
  const initialPreferredAssemblyMap = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const sample of samples) {
      map[sample.id] = sample.preferredAssemblyId ?? null;
    }
    return map;
  }, [samples]);
  const [preferredAssemblyBySample, setPreferredAssemblyBySample] = useState<
    Record<string, string | null>
  >(initialPreferredAssemblyMap);
  const [assemblySelectionSaving, setAssemblySelectionSaving] = useState<
    Record<string, boolean>
  >({});
  const [assemblySelectionError, setAssemblySelectionError] = useState<string | null>(null);

  // --- Delete run state ---
  const [deleteTarget, setDeleteTarget] = useState<PipelineRun | null>(null);
  const [deletingRun, setDeletingRun] = useState(false);
  const [deleteRunError, setDeleteRunError] = useState<string | null>(null);

  // --- Checksum state ---
  const [calculatingChecksums, setCalculatingChecksums] = useState(false);
  const [checksumResult, setChecksumResult] = useState<{
    success: boolean;
    message: string;
    detail?: string;
  } | null>(null);
  const [localChecksumOverrides, setLocalChecksumOverrides] = useState<Record<string, true>>({});

  const {
    systemReady,
    checkingSystem,
    refreshSystemReady,
    initialCheckPending,
    systemBlocked,
  } = useQuickPrerequisiteStatus();

  // --- Derived data ---
  const enabledPipelines: Pipeline[] = useMemo(() => {
    const all = pipelinesData?.pipelines || [];
    if (!categoryFilter) return all;
    if (categoryFilter === "analysis") return all.filter((p) => p.category !== "submission");
    return all.filter((p) => p.category === categoryFilter);
  }, [pipelinesData, categoryFilter]);
  const pipelineRuns: PipelineRun[] = useMemo(
    () => runsData?.runs || [],
    [runsData?.runs]
  );

  const selectedPipeline = useMemo(
    () =>
      enabledPipelines.find((p) => p.pipelineId === selectedPipelineIdState) || null,
    [enabledPipelines, selectedPipelineIdState]
  );

  const samplesWithAssemblySelection = useMemo(
    () =>
      samples.map((sample) => ({
        ...sample,
        preferredAssemblyId:
          preferredAssemblyBySample[sample.id] ?? sample.preferredAssemblyId ?? null,
      })),
    [preferredAssemblyBySample, samples]
  );

  const samplesWithReads = useMemo(
    () =>
      samplesWithAssemblySelection.filter((s) =>
        s.reads?.some((r) => r.file1 && r.file2)
      ),
    [samplesWithAssemblySelection]
  );

  const enaSubmissionServer = useMemo(() => {
    if (typeof enaSettingsData?.enaTestMode !== "boolean") return null;
    const isTestMode = enaSettingsData.enaTestMode;
    return {
      isTestMode,
      label: isTestMode ? "Test server" : "Production server",
      host: isTestMode ? "wwwdev.ebi.ac.uk" : "www.ebi.ac.uk",
    };
  }, [enaSettingsData]);

  const missingChecksumFilePaths = useMemo(
    () =>
      getMissingReadChecksumPaths({
        samples: samplesWithAssemblySelection,
        ignorePaths: localChecksumOverrides,
      }),
    [localChecksumOverrides, samplesWithAssemblySelection]
  );

  const isSubmgSelected = selectedPipeline?.pipelineId === "submg";
  const isMagSelected = selectedPipeline?.pipelineId === "mag";
  const showAssemblyColumn = isMagSelected || isSubmgSelected;

  const submitBinsEnabled = Boolean(
    localConfig.submitBins ??
      selectedPipeline?.defaultConfig?.submitBins ??
      true
  );

  const submgCoverage = useMemo(() => {
    if (!isSubmgSelected || !metadataValidation) return null;
    return buildSubmgCoverageSummary({
      validation: metadataValidation,
      samples: samplesWithAssemblySelection,
      selectedSampleIds: allSampleWithReadsIds,
      submitBins: submitBinsEnabled,
    });
  }, [
    isSubmgSelected,
    metadataValidation,
    samplesWithAssemblySelection,
    allSampleWithReadsIds,
    submitBinsEnabled,
  ]);

  const submgMissingRequiredLabels = useMemo(() => {
    if (!submgCoverage) return [];
    return formatSampleMissingRequiredLabels(
      submgCoverage.missingRequired,
      submgCoverage.sampleMetadataMissingSummary
        ? [submgCoverage.sampleMetadataMissingSummary]
        : []
    );
  }, [submgCoverage]);

  const readinessIssues = getReadinessIssues({
    pipeline: selectedPipeline,
    samples: samplesWithAssemblySelection,
    selectedSampleIds: allSampleWithReadsIds,
    metadataValidation,
    loadingMetadata,
    prerequisites,
    loadingPrereqs,
    systemReady,
    checkingSystem,
    submgCoverage,
  });

  const hasActiveRuns = useMemo(
    () =>
      pipelineRuns.some(
        (run) => run.status === "queued" || run.status === "running"
      ),
    [pipelineRuns]
  );

  const visibleRuns = useMemo(
    () =>
      selectedPipeline
        ? pipelineRuns.filter((run) => run.pipelineId === selectedPipeline.pipelineId)
        : pipelineRuns,
    [pipelineRuns, selectedPipeline]
  );

  const filteredRuns = useMemo(
    () =>
      statusFilter === "all"
        ? visibleRuns
        : visibleRuns.filter((run) => run.status === statusFilter),
    [visibleRuns, statusFilter]
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const run of visibleRuns) {
      counts[run.status] = (counts[run.status] || 0) + 1;
    }
    return counts;
  }, [visibleRuns]);

  const deletableFilteredRuns = useMemo(
    () => filteredRuns.filter((r) => r.status !== "running"),
    [filteredRuns]
  );

  const allFilteredSelected = useMemo(
    () =>
      deletableFilteredRuns.length > 0 &&
      deletableFilteredRuns.every((r) => selectedRunIds.has(r.id)),
    [deletableFilteredRuns, selectedRunIds]
  );

  const samplesWithAssemblies = useMemo(
    () =>
      samplesWithAssemblySelection.filter(
        (sample) => getAvailableAssemblies(sample).length > 0
      ),
    [samplesWithAssemblySelection]
  );

  // --- Effects ---

  // Auto-select pipeline from URL — always follow the URL when it changes
  useEffect(() => {
    if (!enabledPipelines.length || !requestedPipelineId) return;
    if (enabledPipelines.some((p) => p.pipelineId === requestedPipelineId)) {
      setSelectedPipelineId(requestedPipelineId);
    } else {
      setSelectedPipelineId(enabledPipelines[0].pipelineId);
    }
  }, [enabledPipelines, requestedPipelineId]);

  // Init config and samples when pipeline changes
  useEffect(() => {
    if (!selectedPipeline) return;
    setLocalConfig({ ...(selectedPipeline.config || selectedPipeline.defaultConfig || {}) });
  }, [selectedPipeline]);

  useEffect(() => {
    setPreferredAssemblyBySample(initialPreferredAssemblyMap);
  }, [initialPreferredAssemblyMap]);

  useEffect(() => {
    setLocalChecksumOverrides({});
    setChecksumResult(null);
    setCalculatingChecksums(false);
  }, [studyId]);

  // Fetch prerequisites and metadata when pipeline changes
  useEffect(() => {
    if (!selectedPipeline) return;
    let cancelled = false;

    setLoadingPrereqs(true);
    setLoadingMetadata(true);
    setPrerequisites(null);
    setMetadataValidation(null);

    const load = async () => {
      try {
        const [prereqRes, metadataRes] = await Promise.all([
          fetch("/api/admin/settings/pipelines/check-prerequisites"),
          fetch("/api/pipelines/validate-metadata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studyId, pipelineId: selectedPipeline.pipelineId }),
          }),
        ]);

        if (cancelled) return;

        if (prereqRes.ok) {
          setPrerequisites(await prereqRes.json());
        }
        if (metadataRes.ok) {
          setMetadataValidation(await metadataRes.json());
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) {
          setLoadingPrereqs(false);
          setLoadingMetadata(false);
        }
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [selectedPipeline, studyId]);

  // Poll when active runs exist
  useEffect(() => {
    if (!hasActiveRuns) return;
    const interval = window.setInterval(() => {
      void mutateRuns();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [hasActiveRuns, mutateRuns]);

  // --- Handlers ---

  const refreshSubmgValidation = useCallback(async () => {
    const validationRes = await fetch("/api/pipelines/validate-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studyId, pipelineId: "submg" }),
    });

    if (!validationRes.ok) {
      let message = "Failed to refresh SubMG metadata validation";
      try {
        const payload = await validationRes.json();
        if (typeof payload.error === "string") message = payload.error;
      } catch { /* keep fallback */ }
      throw new Error(message);
    }

    const validation = (await validationRes.json()) as MetadataValidation;
    if (isSubmgSelected) {
      setMetadataValidation(validation);
    }
  }, [studyId, isSubmgSelected]);

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
          studyId,
          sampleIds: Array.from(allSampleWithReadsIds),
          config: localConfig,
        }),
      });

      const createPayload = await createResponse.json().catch(() => null);
      if (!createResponse.ok) {
        throw new Error(getApiErrorMessage(createPayload, "Failed to create pipeline run"));
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
        throw new Error(getApiErrorMessage(startPayload, "Failed to start pipeline run"));
      }

      await mutateRuns();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Failed to start pipeline");
    } finally {
      setStartingPipelineId(null);
    }
  };

  const handleDeleteRun = async () => {
    if (!deleteTarget) return;

    setDeletingRun(true);
    setDeleteRunError(null);

    try {
      const res = await fetch(`/api/pipelines/runs/${deleteTarget.id}/delete`, {
        method: "POST",
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteRunError(
          getApiErrorMessage(payload as { error?: unknown }, "Failed to delete run")
        );
        return;
      }

      setDeleteTarget(null);
      await mutateRuns();
    } catch (deleteError) {
      setDeleteRunError(
        deleteError instanceof Error ? deleteError.message : "Failed to delete run"
      );
    } finally {
      setDeletingRun(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedRunIds.size === 0) return;
    setBulkDeleting(true);

    try {
      const ids = Array.from(selectedRunIds);
      for (const runId of ids) {
        const res = await fetch(`/api/pipelines/runs/${runId}/delete`, {
          method: "POST",
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(
            getApiErrorMessage(payload as { error?: unknown }, `Failed to delete run ${runId}`)
          );
        }
      }

      setSelectedRunIds(new Set());
      setSelectMode(false);
      setShowBulkDeleteConfirm(false);
      await mutateRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete runs");
      setShowBulkDeleteConfirm(false);
    } finally {
      setBulkDeleting(false);
    }
  };

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedRunIds(new Set());
    } else {
      setSelectedRunIds(new Set(deletableFilteredRuns.map((r) => r.id)));
    }
  };

  const toggleSelectRun = (runId: string) => {
    setSelectedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  };

  const handleComputeReadChecksums = async () => {
    if (calculatingChecksums) return;

    if (missingChecksumFilePaths.length === 0) {
      setChecksumResult({ success: true, message: "All read files already have checksums." });
      return;
    }

    setCalculatingChecksums(true);
    setChecksumResult(null);

    try {
      const aggregate = {
        total: 0,
        successful: 0,
        failed: 0,
        updatedReadRecords: 0,
        notLinkedToRead: 0,
      };
      const computedPaths: Record<string, true> = {};

      for (let index = 0; index < missingChecksumFilePaths.length; index += 50) {
        const batch = missingChecksumFilePaths.slice(index, index + 50);
        const res = await fetch("/api/files/checksum", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filePaths: batch }),
        });

        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof payload.error === "string"
              ? payload.error
              : "Failed to calculate read checksums"
          );
        }

        const summary = payload.summary as Partial<{
          total: number;
          successful: number;
          failed: number;
          updatedReadRecords: number;
          notLinkedToRead: number;
        }>;
        aggregate.total += summary.total ?? batch.length;
        aggregate.successful += summary.successful ?? 0;
        aggregate.failed += summary.failed ?? 0;
        aggregate.updatedReadRecords += summary.updatedReadRecords ?? 0;
        aggregate.notLinkedToRead += summary.notLinkedToRead ?? 0;

        const results = Array.isArray(payload.results) ? payload.results : [];
        for (const result of results) {
          if (
            result &&
            typeof result === "object" &&
            typeof result.filePath === "string" &&
            typeof result.checksum === "string"
          ) {
            computedPaths[result.filePath] = true;
          }
        }
      }

      const detailParts = [`${aggregate.updatedReadRecords} stored in read records`];
      if (aggregate.notLinkedToRead > 0) {
        detailParts.push(`${aggregate.notLinkedToRead} not assigned to a read record`);
      }
      if (aggregate.failed > 0) {
        detailParts.push(`${aggregate.failed} failed`);
      }

      await refreshSubmgValidation();

      setLocalChecksumOverrides((prev) => ({ ...prev, ...computedPaths }));
      setChecksumResult({
        success: aggregate.failed === 0,
        message: `Calculated MD5 for ${aggregate.successful}/${aggregate.total} read files.`,
        detail: detailParts.join(" · "),
      });
    } catch (checksumError) {
      setChecksumResult({
        success: false,
        message:
          checksumError instanceof Error ? checksumError.message : "Failed to calculate read checksums",
      });
    } finally {
      setCalculatingChecksums(false);
    }
  };

  const handlePreferredAssemblyChange = async (sampleId: string, value: string) => {
    const nextAssemblyId = value === AUTO_ASSEMBLY_SELECTION ? null : value;
    const sample = samplesWithAssemblySelection.find((item) => item.id === sampleId);
    if (!sample) return;

    if (nextAssemblyId) {
      const selectedAssembly = sample.assemblies.find((a) => a.id === nextAssemblyId);
      if (!selectedAssembly?.assemblyFile) {
        setAssemblySelectionError(`Sample ${sample.sampleId}: selected assembly has no file path.`);
        return;
      }
    }

    const previousAssemblyId =
      preferredAssemblyBySample[sampleId] ?? sample.preferredAssemblyId ?? null;

    setAssemblySelectionError(null);
    setPreferredAssemblyBySample((prev) => ({ ...prev, [sampleId]: nextAssemblyId }));
    setAssemblySelectionSaving((prev) => ({ ...prev, [sampleId]: true }));

    let preferredAssemblySaved = false;

    try {
      const updateRes = await fetch(`/api/samples/${sampleId}/preferred-assembly`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studyId, assemblyId: nextAssemblyId }),
      });

      if (!updateRes.ok) {
        let message = "Failed to update preferred assembly";
        try {
          const payload = await updateRes.json();
          if (typeof payload.error === "string") message = payload.error;
        } catch { /* ignore */ }
        throw new Error(message);
      }

      preferredAssemblySaved = true;
      await refreshSubmgValidation();
    } catch (err) {
      if (!preferredAssemblySaved) {
        setPreferredAssemblyBySample((prev) => ({ ...prev, [sampleId]: previousAssemblyId }));
        setAssemblySelectionError(
          err instanceof Error ? err.message : "Failed to update preferred assembly"
        );
      } else {
        setAssemblySelectionError(
          err instanceof Error
            ? `Preferred assembly saved, but metadata refresh failed: ${err.message}`
            : "Preferred assembly saved, but failed to refresh SubMG metadata validation."
        );
      }
    } finally {
      setAssemblySelectionSaving((prev) => ({ ...prev, [sampleId]: false }));
    }
  };

  // --- Loading state ---
  if (pipelinesLoading && enabledPipelines.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading pipelines...
      </div>
    );
  }

  // --- Empty state ---
  if (enabledPipelines.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-base font-semibold">No Study Pipelines Enabled</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Enable a study-scoped pipeline in admin settings before using this workspace.
        </p>
      </div>
    );
  }

  // --- Overview mode (no pipeline selected) ---
  if (!requestedPipelineId) {
    const runsByPipeline = new Map<string, PipelineRun[]>();
    for (const run of pipelineRuns) {
      const existing = runsByPipeline.get(run.pipelineId);
      if (existing) {
        existing.push(run);
      } else {
        runsByPipeline.set(run.pipelineId, [run]);
      }
    }

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Analysis</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Pipeline overview for this study
          </p>
        </div>

        <div className="grid gap-4">
          {enabledPipelines.map((pipeline) => {
            const runs = runsByPipeline.get(pipeline.pipelineId) ?? [];
            const completedRuns = runs.filter((r) => r.status === "completed");
            const activeRuns = runs.filter(
              (r) => r.status === "running" || r.status === "queued" || r.status === "pending"
            );
            const failedRuns = runs.filter((r) => r.status === "failed");
            const latestRun = runs[0];

            return (
              <Link
                key={pipeline.pipelineId}
                href={`/studies/${studyId}?tab=pipelines&pipeline=${encodeURIComponent(pipeline.pipelineId)}`}
                className="block"
              >
                <Card className="hover:bg-muted/30 transition-colors cursor-pointer">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <FlaskConical className="h-4 w-4 text-muted-foreground" />
                        {pipeline.name}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        {activeRuns.length > 0 && (
                          <Badge variant="secondary" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            Running
                          </Badge>
                        )}
                        {activeRuns.length === 0 && completedRuns.length > 0 && (
                          <Badge variant="secondary" className="text-xs bg-[#00BD7D]/10 text-[#00BD7D] border-[#00BD7D]/20">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Completed
                          </Badge>
                        )}
                        {activeRuns.length === 0 && completedRuns.length === 0 && failedRuns.length > 0 && (
                          <Badge variant="secondary" className="text-xs bg-destructive/10 text-destructive border-destructive/20">
                            <AlertCircle className="mr-1 h-3 w-3" />
                            Failed
                          </Badge>
                        )}
                        {runs.length === 0 && (
                          <Badge variant="outline" className="text-xs" style={{ color: "#8FA1B9", borderColor: "#CAD5E2" }}>
                            Not run yet
                          </Badge>
                        )}
                      </div>
                    </div>
                    <CardDescription>{pipeline.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{runs.length} run{runs.length !== 1 ? "s" : ""} total</span>
                      {completedRuns.length > 0 && (
                        <span className="text-[#00BD7D]">{completedRuns.length} completed</span>
                      )}
                      {failedRuns.length > 0 && (
                        <span className="text-red-600">{failedRuns.length} failed</span>
                      )}
                      {latestRun && (
                        <>
                          <span className="text-border">|</span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Last run: {formatRelativeTime(latestRun.createdAt)}
                          </span>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
          {enabledPipelines.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No pipelines configured for this study.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  // --- Main render (single-column layout matching OrderPipelineView) ---
  return (
    <div className="space-y-6">
      {/* Section 1: Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">
            {selectedPipeline?.name || "Pipeline"}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {selectedPipeline?.description || "Select a pipeline to review readiness."}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {initialCheckPending ? (
            <Button size="sm" disabled>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Checking environment...
            </Button>
          ) : systemBlocked ? (
            <Button
              size="sm"
              variant="outline"
              className="border-[#FFBA00]/30 bg-[#FFBA00]/10 text-[#FFBA00] hover:bg-[#FFBA00]/20"
              disabled={checkingSystem}
              onClick={() => void refreshSystemReady()}
              title={systemReady?.summary}
            >
              {checkingSystem ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
              )}
              {checkingSystem ? "Re-checking..." : systemReady?.summary || "Env issue"}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={
                !selectedPipeline ||
                readinessIssues.length > 0 ||
                startingPipelineId !== null ||
                loadingPrereqs ||
                loadingMetadata
              }
              onClick={() => void handleStartPipeline()}
              title={
                readinessIssues.length > 0
                  ? readinessIssues[0]
                  : undefined
              }
            >
              {startingPipelineId === selectedPipeline?.pipelineId || loadingPrereqs || loadingMetadata ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              {loadingPrereqs || loadingMetadata ? "Loading..." : "Start Pipeline"}
            </Button>
          )}
        </div>
      </div>

      {/* Section 2: Error banner */}
      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Section 2b: Study-level metadata warnings */}
      {metadataValidation && !loadingMetadata && (() => {
        const studyIssues = metadataValidation.issues.filter(
          (issue) => !extractSampleToken(issue.message)
        );
        if (studyIssues.length === 0) return null;
        return (
          <div className="rounded-lg border border-[#FFBA00]/30 bg-[#FFBA00]/10 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#FFBA00]" />
              <div className="space-y-1.5">
                {studyIssues.map((issue, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-foreground">
                    <span>{issue.message}</span>
                    {issue.fixUrl && (
                      <Link
                        href={issue.fixUrl}
                        className="inline-flex items-center gap-0.5 text-primary hover:underline"
                      >
                        Fix <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Section 3: Settings */}
      {selectedPipeline?.configSchema?.properties &&
        Object.entries(selectedPipeline.configSchema.properties).some(
          ([, s]) => s.enum || s.type === "boolean" || s.type === "number"
        ) && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Settings</h3>
          {(() => {
            const entries = Object.entries(selectedPipeline.configSchema.properties);
            const booleanEntries = entries.filter(([, p]) => p.type === "boolean");
            const otherEntries = entries.filter(([, p]) => p.type !== "boolean" && (Array.isArray(p.enum) || p.type === "number"));
            return (
              <div className="space-y-4">
                {booleanEntries.length > 0 && (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-4">
                    {booleanEntries.map(([key, property]) => {
                      const fieldId = `config-${key}`;
                      const rawValue = localConfig[key] ?? property.default;
                      const isSkipKey = key.startsWith("skip");
                      const checked = isSkipKey ? !rawValue : !!rawValue;
                      const label = isSkipKey
                        ? (property.title || key).replace(/^Skip\s+/i, "")
                        : (property.title || key);
                      return (
                        <div key={key} className="flex items-center gap-2.5">
                          <Switch
                            id={fieldId}
                            checked={checked}
                            onCheckedChange={(c) =>
                              setLocalConfig((prev) => ({
                                ...prev,
                                [key]: isSkipKey ? !c : !!c,
                              }))
                            }
                          />
                          <Label htmlFor={fieldId} className="text-xs text-muted-foreground cursor-pointer">
                            {label}
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                )}
                {otherEntries.length > 0 && (
                  <div className="flex flex-wrap items-end gap-4">
                    {otherEntries.map(([key, property]) => {
                      const fieldId = `config-${key}`;
                      const value = localConfig[key] ?? property.default;
                      if (Array.isArray(property.enum) && property.enum.length > 0) {
                        return (
                          <div key={key} className="space-y-1">
                            <Label className="text-xs" htmlFor={fieldId}>
                              {property.title || key}
                            </Label>
                            <Select
                              value={String(value ?? property.enum[0] ?? "")}
                              onValueChange={(v) =>
                                setLocalConfig((prev) => ({ ...prev, [key]: v }))
                              }
                            >
                              <SelectTrigger
                                id={fieldId}
                                aria-label={property.title || key}
                                className="h-8 w-[160px] text-xs"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {property.enum.map((opt) => (
                                  <SelectItem key={String(opt)} value={String(opt)}>
                                    {String(opt)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      }
                      if (property.type === "number") {
                        return (
                          <div key={key} className="space-y-1">
                            <Label className="text-xs" htmlFor={fieldId}>
                              {property.title || key}
                            </Label>
                            <Input
                              id={fieldId}
                              type="number"
                              className="h-8 w-[120px] text-xs"
                              value={value != null ? String(value) : ""}
                              onChange={(e) =>
                                setLocalConfig((prev) => ({
                                  ...prev,
                                  [key]: e.target.value ? Number(e.target.value) : undefined,
                                }))
                              }
                            />
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}
              </div>
            );
          })()}
          {/* SubMG ENA target info */}
          {isSubmgSelected && enaSubmissionServer && (
            <p
              className={`mt-3 text-xs ${
                enaSubmissionServer.isTestMode ? "text-amber-700" : "text-blue-700"
              }`}
            >
              ENA target: {enaSubmissionServer.label} ({enaSubmissionServer.host})
              {enaSubmissionServer.isTestMode ? " - test submission mode" : ""}
            </p>
          )}
        </div>
      )}

      {/* Section 4: Samples table */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">Samples</h2>
            <span className="text-xs text-muted-foreground">
              {samplesWithReads.length} with reads
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isFacilityAdmin && isSubmgSelected && missingChecksumFilePaths.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={calculatingChecksums}
                onClick={() => void handleComputeReadChecksums()}
              >
                {calculatingChecksums && (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                )}
                Compute checksums ({missingChecksumFilePaths.length})
              </Button>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className={cn("w-full text-sm", showAssemblyColumn ? "min-w-[960px]" : "min-w-[760px]")}>
              <thead className="border-b bg-secondary/30">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">#</th>
                  <th className="min-w-[10rem] px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Sample
                  </th>
                  <th className="min-w-[14rem] px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Read Files
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Source
                  </th>
                  <th className="min-w-[10rem] px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Issues
                  </th>
                  {showAssemblyColumn && (
                    <th className="min-w-[12rem] px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Assembly
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {samplesWithAssemblySelection.map((sample, index) => {
                  const hasPairedReads = sample.reads?.some((r) => r.file1 && r.file2);
                  const sampleMissing =
                    isSubmgSelected && submgCoverage?.sampleMissingRequired[sample.id];
                  const sampleMetadataIssues = metadataValidation?.issues.filter((issue) => {
                    const token = extractSampleToken(issue.message);
                    return token === sample.sampleId;
                  }) ?? [];
                  const sampleErrors = sampleMetadataIssues.filter((i) => i.severity === "error");
                  const sampleWarnings = sampleMetadataIssues.filter((i) => i.severity === "warning");
                  const hasIssues =
                    !hasPairedReads ||
                    (sampleMissing && sampleMissing.length > 0) ||
                    sampleErrors.length > 0;

                  // Assembly data
                  const availableAssemblies = showAssemblyColumn
                    ? getAvailableAssemblies(sample)
                    : [];
                  const activeSelection = showAssemblyColumn
                    ? resolveAssemblySelection(sample, { strictPreferred: true })
                    : null;
                  const hasExplicitSelection =
                    Boolean(sample.preferredAssemblyId) &&
                    availableAssemblies.some((a) => a.id === sample.preferredAssemblyId);
                  const stalePreferredValue =
                    sample.preferredAssemblyId && !hasExplicitSelection
                      ? `__missing__:${sample.preferredAssemblyId}`
                      : null;
                  const currentSelectValue =
                    stalePreferredValue ||
                    (hasExplicitSelection
                      ? (sample.preferredAssemblyId as string)
                      : AUTO_ASSEMBLY_SELECTION);

                  return (
                    <tr
                      key={sample.id}
                      className="transition-colors hover:bg-secondary/20"
                    >
                      <td className="px-4 py-3 align-top text-muted-foreground tabular-nums">
                        {index + 1}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium">{sample.sampleId}</div>
                        {sample.sampleAlias && (
                          <div className="text-xs text-muted-foreground">{sample.sampleAlias}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {(() => {
                          const pairedRead = sample.reads?.find((r) => r.file1 && r.file2);
                          if (pairedRead) {
                            const f1 = pairedRead.file1!.split("/").pop();
                            const f2 = pairedRead.file2!.split("/").pop();
                            return (
                              <div className="space-y-0.5">
                                <Badge
                                  variant="outline"
                                  className="border-[#00BD7D]/20 bg-[#00BD7D]/10 text-[#00BD7D] mb-1"
                                >
                                  Paired-end
                                </Badge>
                                <div className="text-xs text-muted-foreground font-mono truncate max-w-[220px]" title={pairedRead.file1!}>
                                  R1: {f1}
                                </div>
                                <div className="text-xs text-muted-foreground font-mono truncate max-w-[220px]" title={pairedRead.file2!}>
                                  R2: {f2}
                                </div>
                              </div>
                            );
                          }
                          return (
                            <Badge
                              variant="outline"
                              className="border-[#FFBA00]/20 bg-[#FFBA00]/10 text-[#FFBA00]"
                            >
                              No reads
                            </Badge>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {sample.order ? (
                          <Link
                            href={`/orders/${sample.order.id}/sequencing`}
                            className="text-xs text-primary hover:underline"
                          >
                            {sample.order.orderNumber}
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {hasIssues ? (
                          <div className="space-y-0.5">
                            {!hasPairedReads && (
                              <p className="text-xs text-amber-700">Missing paired reads</p>
                            )}
                            {sampleMissing && sampleMissing.length > 0 && (
                              <p className="text-xs text-destructive">
                                Missing:{" "}
                                {formatSampleMissingRequiredLabels(
                                  sampleMissing,
                                  submgCoverage?.sampleMissingMetadataFields[sample.id] || []
                                ).join(", ")}
                              </p>
                            )}
                            {sampleErrors.map((issue, i) => (
                              <div key={i} className="flex items-center gap-1 text-xs text-destructive">
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
                            {sampleWarnings.map((issue, i) => (
                              <div key={i} className="flex items-center gap-1 text-xs text-yellow-600">
                                <span>{issue.message}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-[#00BD7D]" />
                        )}
                      </td>
                      {showAssemblyColumn && (
                        <td className="px-4 py-3 align-top">
                          {availableAssemblies.length > 0 || stalePreferredValue ? (
                            <div>
                              <Select
                                value={currentSelectValue}
                                onValueChange={(value) => {
                                  if (value.startsWith("__missing__:")) return;
                                  void handlePreferredAssemblyChange(sample.id, value);
                                }}
                                disabled={
                                  (availableAssemblies.length === 0 && !stalePreferredValue) ||
                                  Boolean(assemblySelectionSaving[sample.id])
                                }
                              >
                                <SelectTrigger className="h-8 w-full text-xs">
                                  <SelectValue placeholder="Select assembly" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={AUTO_ASSEMBLY_SELECTION}>
                                    Auto (latest)
                                  </SelectItem>
                                  {stalePreferredValue && (
                                    <SelectItem value={stalePreferredValue}>
                                      Unavailable (choose another)
                                    </SelectItem>
                                  )}
                                  {availableAssemblies.map((assembly) => {
                                    const runNumber =
                                      assembly.createdByPipelineRun?.runNumber || "manual";
                                    const fileName = getFileName(assembly.assemblyFile);
                                    return (
                                      <SelectItem key={assembly.id} value={assembly.id}>
                                        {runNumber} - {fileName}
                                      </SelectItem>
                                    );
                                  })}
                                </SelectContent>
                              </Select>
                              {activeSelection?.preferredMissing && (
                                <p className="text-[11px] text-destructive mt-1">
                                  Previously selected assembly is no longer available.
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">No assemblies</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Below-table info */}
        <div className="mt-3 space-y-2">
          {/* SubMG coverage summary */}
          {isSubmgSelected && submgCoverage && (
            <p
              className={`text-xs ${submgCoverage.blocking ? "text-amber-700" : "text-[#00BD7D]"}`}
            >
              {submgCoverage.summary}
            </p>
          )}
          {isSubmgSelected && submgCoverage?.studyAccessionMissing && (
            <p className="text-xs text-amber-700">
              Study accession is missing. Register in Publishing first.
            </p>
          )}
          {checksumResult && (
            <p
              className={`text-xs ${checksumResult.success ? "text-[#00BD7D]" : "text-destructive"}`}
            >
              {checksumResult.message}
              {checksumResult.detail ? ` ${checksumResult.detail}` : ""}
            </p>
          )}
          {assemblySelectionError && (
            <p className="text-xs text-destructive">{assemblySelectionError}</p>
          )}
        </div>
      </div>

      {/* Section 5: Pipeline Runs table */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">Pipeline Runs</h2>
            {visibleRuns.length > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
                {visibleRuns.length}
              </span>
            )}
          </div>
          {visibleRuns.length > 0 && (
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
                    disabled={bulkDeleting || selectedRunIds.size === 0}
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

        {visibleRuns.length === 0 ? (
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
                      Report
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
                        className={cn(
                          "cursor-pointer transition-colors hover:bg-secondary/20",
                          selectMode && selectedRunIds.has(run.id) && "bg-secondary/30"
                        )}
                        onClick={() => window.open(`/analysis/${run.id}?studyId=${studyId}`, '_blank')}
                      >
                        {selectMode && (
                          <td
                            className="px-3 py-3 align-top"
                            onClick={(e) => e.stopPropagation()}
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
                          <code
                            className="rounded bg-muted px-2 py-0.5 text-xs font-mono"
                            title={run.runNumber}
                          >
                            #{run.runNumber.split("-").pop()}
                          </code>
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
                        <td className="px-4 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                          {run.status === "completed" && run.runFolder ? (
                            <a
                              href={`/api/files/preview?path=${encodeURIComponent(`${run.runFolder}/output/report/reads-qc-report.html`)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              View report
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
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
                          onClick={(e) => e.stopPropagation()}
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
                                onSelect={() => {
                                  window.open(`/analysis/${run.id}?studyId=${studyId}`, '_blank');
                                }}
                              >
                                <ExternalLink className="h-4 w-4" />
                                View details
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={run.status === "running" || deletingRun}
                                onSelect={(event) => {
                                  event.preventDefault();
                                  setDeleteRunError(null);
                                  setDeleteTarget(run);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete run
                              </DropdownMenuItem>
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

      {/* Section 6: Delete Run Dialog */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteRunError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete run {deleteTarget?.runNumber}?</DialogTitle>
            <DialogDescription>
              This will permanently delete the run entry, its folder, and related
              records (steps, events, artifacts, assemblies, and bins). This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteRunError ? (
            <p className="text-sm text-destructive">{deleteRunError}</p>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteRunError(null);
              }}
              disabled={deletingRun}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteRun()}
              disabled={deletingRun}
            >
              {deletingRun ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Delete Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog
        open={showBulkDeleteConfirm}
        onOpenChange={(open) => {
          if (!open) setShowBulkDeleteConfirm(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedRunIds.size} run{selectedRunIds.size !== 1 ? "s" : ""}?</DialogTitle>
            <DialogDescription>
              This will permanently delete the selected runs and all their data. This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowBulkDeleteConfirm(false)}
              disabled={bulkDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleBulkDelete()}
              disabled={bulkDeleting}
            >
              {bulkDeleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Delete {selectedRunIds.size} Run{selectedRunIds.size !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
