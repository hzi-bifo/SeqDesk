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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Hash,
  Layers,
  Trash2,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import { PipelineDataFlowSummary } from "@/components/pipelines/PipelineDataFlow";
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
  reads: {
    id: string;
    file1: string | null;
    file2: string | null;
    checksum1?: string | null;
    checksum2?: string | null;
  }[];
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
  selectedPipelineId?: string | null;
}

interface EnaSettingsResponse {
  enaTestMode?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  if (run.status === "completed") {
    return "Run completed successfully.";
  }
  if (run.status === "queued") {
    return "Waiting for execution.";
  }
  if (run.status === "running") {
    return "Pipeline is currently running.";
  }
  return "No additional details.";
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
    issues.push("Select at least one sample.");
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
  const [selectedSamples, setSelectedSamples] = useState<Set<string>>(new Set());
  const [startingPipelineId, setStartingPipelineId] = useState<string | null>(null);
  const [error, setError] = useState("");

  // --- Validation state ---
  const [prerequisites, setPrerequisites] = useState<PrerequisiteResult | null>(null);
  const [loadingPrereqs, setLoadingPrereqs] = useState(false);
  const [prereqsExpanded, setPrereqsExpanded] = useState(false);
  const [metadataValidation, setMetadataValidation] = useState<MetadataValidation | null>(null);
  const [loadingMetadata, setLoadingMetadata] = useState(false);

  // --- Pipeline definition for data flow ---
  const [pipelineDefinition, setPipelineDefinition] = useState<{
    inputs: PipelineInput[];
    outputs: PipelineOutput[];
  } | null>(null);
  const [showDataFlow, setShowDataFlow] = useState(false);

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

  const { systemReady, checkingSystem } = useQuickPrerequisiteStatus();

  // --- Derived data ---
  const enabledPipelines: Pipeline[] = useMemo(
    () => pipelinesData?.pipelines || [],
    [pipelinesData]
  );
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
      selectedSampleIds: selectedSamples,
      submitBins: submitBinsEnabled,
    });
  }, [
    isSubmgSelected,
    metadataValidation,
    samplesWithAssemblySelection,
    selectedSamples,
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
    selectedSampleIds: selectedSamples,
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

  const samplesWithAssemblies = useMemo(
    () =>
      samplesWithAssemblySelection.filter(
        (sample) => getAvailableAssemblies(sample).length > 0
      ),
    [samplesWithAssemblySelection]
  );

  // --- Effects ---

  // Auto-select pipeline
  useEffect(() => {
    if (!enabledPipelines.length) return;
    setSelectedPipelineId((current) => {
      if (current && enabledPipelines.some((p) => p.pipelineId === current)) {
        return current;
      }
      if (requestedPipelineId && enabledPipelines.some((p) => p.pipelineId === requestedPipelineId)) {
        return requestedPipelineId;
      }
      return enabledPipelines[0].pipelineId;
    });
  }, [enabledPipelines, requestedPipelineId]);

  // Init config and samples when pipeline changes
  useEffect(() => {
    if (!selectedPipeline) return;
    setLocalConfig({ ...(selectedPipeline.config || selectedPipeline.defaultConfig || {}) });
  }, [selectedPipeline]);

  useEffect(() => {
    if (!selectedPipeline || samplesWithReads.length === 0) return;
    setSelectedSamples((current) =>
      current.size > 0 ? current : new Set(samplesWithReads.map((s) => s.id))
    );
  }, [selectedPipeline, samplesWithReads]);

  useEffect(() => {
    setPreferredAssemblyBySample(initialPreferredAssemblyMap);
  }, [initialPreferredAssemblyMap]);

  useEffect(() => {
    setLocalChecksumOverrides({});
    setChecksumResult(null);
    setCalculatingChecksums(false);
  }, [studyId]);

  // Fetch prerequisites, metadata, and definition when pipeline changes
  useEffect(() => {
    if (!selectedPipeline) return;
    let cancelled = false;

    setLoadingPrereqs(true);
    setLoadingMetadata(true);
    setPrerequisites(null);
    setMetadataValidation(null);
    setPipelineDefinition(null);
    setPrereqsExpanded(false);
    setShowDataFlow(false);

    const load = async () => {
      try {
        const [prereqRes, metadataRes, defRes] = await Promise.all([
          fetch("/api/admin/settings/pipelines/check-prerequisites"),
          fetch("/api/pipelines/validate-metadata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studyId, pipelineId: selectedPipeline.pipelineId }),
          }),
          fetch(`/api/admin/settings/pipelines/${selectedPipeline.pipelineId}/definition`),
        ]);

        if (cancelled) return;

        if (prereqRes.ok) {
          const data = await prereqRes.json();
          setPrerequisites(data);
          if (!data.requiredPassed) setPrereqsExpanded(true);
        }
        if (metadataRes.ok) {
          setMetadataValidation(await metadataRes.json());
        }
        if (defRes.ok) {
          const data = await defRes.json();
          setPipelineDefinition({ inputs: data.inputs || [], outputs: data.outputs || [] });
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
          studyId,
          sampleIds: Array.from(selectedSamples),
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

  const getPrereqStatusIcon = (status: PrerequisiteCheck["status"]) => {
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
      <Card>
        <CardHeader>
          <CardTitle>No Study Pipelines Enabled</CardTitle>
          <CardDescription>
            Enable a study-scoped pipeline in admin settings before using this workspace.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // --- Main render ---
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Study Pipelines</h1>
          <p className="text-sm text-muted-foreground">
            Run study-scoped analysis pipelines on linked FASTQ files.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void mutatePipelines();
            void mutateRuns();
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* System warning banner */}
      {!checkingSystem && systemReady && !systemReady.ready ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {systemReady.summary}
          </div>
          <Link
            href="/admin/settings/pipelines"
            className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Settings className="h-3 w-3" />
            Configure Pipeline Settings
          </Link>
        </div>
      ) : null}

      {/* Error banner */}
      {error ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
        {/* --- Left column --- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Hash className="h-5 w-5" />
              Available Pipelines
            </CardTitle>
            <CardDescription>
              Select a pipeline, choose samples, and start the run.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Pipeline selector */}
            <div className="grid gap-3 md:grid-cols-2">
              {enabledPipelines.map((pipeline) => {
                const active = pipeline.pipelineId === selectedPipelineIdState;
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
                      <div className="flex items-center gap-2 font-medium">
                        {getPipelineIcon(pipeline.icon)}
                        {pipeline.name}
                      </div>
                      <Badge variant="outline">{pipeline.category || "analysis"}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{pipeline.description}</p>
                  </button>
                );
              })}
            </div>

            {/* Selected Samples */}
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="font-medium">Selected Samples</h2>
                  <p className="text-sm text-muted-foreground">
                    {samplesWithReads.length} of {samples.length} sample
                    {samples.length === 1 ? "" : "s"} with paired reads
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setSelectedSamples(new Set(samplesWithReads.map((s) => s.id)))
                    }
                  >
                    Select All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedSamples(new Set())}
                  >
                    Clear
                  </Button>
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                {samples.map((sample) => {
                  const hasPairedReads = sample.reads?.some((r) => r.file1 && r.file2);
                  const sampleMissing =
                    isSubmgSelected && submgCoverage?.sampleMissingRequired[sample.id];

                  return (
                    <label
                      key={sample.id}
                      className="flex items-start gap-3 rounded-lg border px-3 py-2"
                    >
                      <Checkbox
                        checked={selectedSamples.has(sample.id)}
                        onCheckedChange={() => handleToggleSample(sample.id)}
                        disabled={!hasPairedReads}
                      />
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{sample.sampleId}</span>
                          {hasPairedReads ? (
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
                          {hasPairedReads
                            ? sample.reads.some((r) => r.file1 && r.file2)
                              ? "Paired-end FASTQ"
                              : "Single-end FASTQ"
                            : "No linked FASTQ files"}
                        </div>
                        {sampleMissing && sampleMissing.length > 0 && (
                          <div className="text-[11px] text-destructive">
                            Missing:{" "}
                            {formatSampleMissingRequiredLabels(
                              sampleMissing,
                              submgCoverage?.sampleMissingMetadataFields[sample.id] || []
                            ).join(", ")}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Pipeline Configuration */}
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

            {/* SubMG Scope */}
            {isSubmgSelected && (
              <div className="space-y-3 rounded-lg border p-4">
                <div>
                  <h2 className="font-medium">SubMG Submission Scope</h2>
                </div>
                <p
                  className={`text-xs ${
                    enaSubmissionServer?.isTestMode
                      ? "text-amber-700"
                      : enaSubmissionServer
                        ? "text-blue-700"
                        : "text-muted-foreground"
                  }`}
                >
                  {enaSubmissionServer
                    ? `ENA target: ${enaSubmissionServer.label} (${enaSubmissionServer.host})${enaSubmissionServer.isTestMode ? " - test submission mode." : ""}`
                    : "ENA target: loading from Admin > ENA settings..."}
                </p>

                {loadingMetadata ? (
                  <p className="text-xs text-muted-foreground">Evaluating selected samples...</p>
                ) : submgCoverage ? (
                  <>
                    <p
                      className={`text-xs ${
                        submgCoverage.blocking ? "text-amber-700" : "text-green-700"
                      }`}
                    >
                      {submgCoverage.summary}
                    </p>
                    {submgCoverage.missingRequired.length > 0 && (
                      <p className="text-xs text-destructive">
                        Missing required: {submgMissingRequiredLabels.join(", ")}
                      </p>
                    )}
                    {submgCoverage.studyAccessionMissing && (
                      <p className="text-xs text-amber-700">
                        Study accession comes from ENA Registration in this
                        study&apos;s Publishing section (Test Server or Production).
                      </p>
                    )}
                    <div className="space-y-1">
                      {submgCoverage.checks.map((check) => {
                        const preview = formatSamplePreview(
                          check.missingSampleIds,
                          new Map(samplesWithAssemblySelection.map((s) => [s.id, s]))
                        );
                        return (
                          <p key={check.id} className="text-xs text-muted-foreground">
                            {check.label}: {check.available}/{check.total} selected
                            {preview ? ` - missing ${preview}` : ""}
                            {check.missingDetail ? ` - fields: ${check.missingDetail}` : ""}
                          </p>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground">{submgCoverage.binsSummary}</p>
                    {submgCoverage.binsHint && (
                      <p className="text-xs text-amber-700">{submgCoverage.binsHint}</p>
                    )}
                  </>
                ) : null}

                {/* Checksum computation */}
                {isFacilityAdmin && missingChecksumFilePaths.length > 0 && (
                  <div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={calculatingChecksums}
                      onClick={() => void handleComputeReadChecksums()}
                    >
                      {calculatingChecksums ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : null}
                      Compute and add read checksums
                    </Button>
                    <p className="text-xs text-muted-foreground mt-1">
                      {missingChecksumFilePaths.length} read file
                      {missingChecksumFilePaths.length === 1 ? "" : "s"} currently missing MD5
                      values.
                    </p>
                  </div>
                )}
                {checksumResult && (
                  <p
                    className={`text-xs ${
                      checksumResult.success ? "text-green-700" : "text-destructive"
                    }`}
                  >
                    {checksumResult.message}
                    {checksumResult.detail ? ` ${checksumResult.detail}` : ""}
                  </p>
                )}
              </div>
            )}

            {/* Metadata Validation (inline) */}
            {selectedPipeline && (loadingMetadata || metadataValidation) && (
              <div className="space-y-2 rounded-lg border p-4">
                {loadingMetadata ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking study metadata...
                  </div>
                ) : metadataValidation ? (
                  <>
                    <div className="flex items-center gap-2">
                      {metadataValidation.valid ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : metadataValidation.issues.some((i) => i.severity === "error") ? (
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
                  </>
                ) : null}
              </div>
            )}

            {/* System Requirements (collapsible) */}
            {selectedPipeline && (loadingPrereqs || prerequisites) && (
              <div className="rounded-lg border p-4">
                {loadingPrereqs ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking system requirements...
                  </div>
                ) : prerequisites ? (
                  <Collapsible open={prereqsExpanded} onOpenChange={setPrereqsExpanded}>
                    <CollapsibleTrigger asChild>
                      <button className="flex items-center justify-between w-full text-left hover:bg-muted/50 rounded p-1 -m-1">
                        <div className="flex items-center gap-2">
                          {prerequisites.requiredPassed ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-600" />
                          )}
                          <span className="text-sm font-medium">System Requirements</span>
                          <span
                            className={`text-xs ${
                              prerequisites.requiredPassed ? "text-green-600" : "text-red-600"
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
                              {getPrereqStatusIcon(check.status)}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{check.name}</span>
                                  {check.required && check.status !== "pass" && (
                                    <span className="text-xs text-red-600">required</span>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">{check.message}</p>
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
            )}

            {/* Data Flow (collapsible) */}
            {pipelineDefinition && pipelineDefinition.inputs.length > 0 && (
              <div className="rounded-lg border p-4">
                <Collapsible open={showDataFlow} onOpenChange={setShowDataFlow}>
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center justify-between w-full text-left hover:bg-muted/50 rounded p-1 -m-1">
                      <div className="flex items-center gap-2">
                        <Layers className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">Data Integration</span>
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
          </CardContent>
        </Card>

        {/* --- Right column --- */}
        <div className="space-y-6">
          {/* Readiness card */}
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
                    {selectedSamples.size} selected sample
                    {selectedSamples.size === 1 ? "" : "s"} meet the current input
                    requirements.
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
                disabled={
                  !selectedPipeline ||
                  readinessIssues.length > 0 ||
                  startingPipelineId !== null ||
                  loadingPrereqs ||
                  loadingMetadata
                }
                onClick={() => void handleStartPipeline()}
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

          {/* Recent Runs */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Runs</CardTitle>
              <CardDescription>
                {selectedPipeline
                  ? `${selectedPipeline.name} runs for this study.`
                  : "Study-scoped runs for this study."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {visibleRuns.length === 0 ? (
                <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  No runs started for this pipeline yet.
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                            Run
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                            Pipeline
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                            Status
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                            Details
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                            Created
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                            Started
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                            Completed
                          </th>
                          <th className="w-[56px] px-3 py-2 text-right font-medium text-muted-foreground">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {visibleRuns.map((run) => (
                          <tr
                            key={run.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => (window.location.href = `/analysis/${run.id}`)}
                          >
                            <td className="px-3 py-2 align-top">
                              <code className="rounded bg-muted px-2 py-1 text-xs font-mono">
                                {run.runNumber}
                              </code>
                            </td>
                            <td className="px-3 py-2 align-top font-medium">
                              {run.pipelineName}
                            </td>
                            <td className="px-3 py-2 align-top">{getStatusBadge(run.status)}</td>
                            <td className="max-w-[320px] px-3 py-2 align-top text-xs text-muted-foreground">
                              {getRunDetails(run)}
                            </td>
                            <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                              {formatDateTime(run.createdAt)}
                            </td>
                            <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                              {formatDateTime(run.startedAt)}
                            </td>
                            <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                              {formatDateTime(run.completedAt)}
                            </td>
                            <td className="px-3 py-2 align-top text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    aria-label={`Actions for ${run.runNumber}`}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
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
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Assembly Selection */}
          {samplesWithAssemblySelection.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Selected Assembly Per Sample</CardTitle>
                <CardDescription>
                  Choose the assembly marked as final for each sample. Automatic mode
                  always uses the newest available assembly.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                            Sample
                          </th>
                          <th className="w-[320px] px-3 py-2 text-left font-medium text-muted-foreground">
                            Final Assembly
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                            Current Final Selection
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {samplesWithAssemblySelection.map((sample) => {
                          const availableAssemblies = getAvailableAssemblies(sample);
                          const activeSelection = resolveAssemblySelection(sample, {
                            strictPreferred: true,
                          });
                          const selectedAssembly = activeSelection.assembly;
                          const hasExplicitSelection =
                            Boolean(sample.preferredAssemblyId) &&
                            availableAssemblies.some(
                              (assembly) => assembly.id === sample.preferredAssemblyId
                            );
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
                            <tr key={sample.id}>
                              <td className="px-3 py-2 align-top">
                                <div className="font-medium text-sm">{sample.sampleId}</div>
                                <div className="text-xs text-muted-foreground">
                                  {availableAssemblies.length} assembly
                                  {availableAssemblies.length === 1 ? "" : "ies"}
                                </div>
                              </td>
                              <td className="px-3 py-2 align-top">
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
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select final assembly" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={AUTO_ASSEMBLY_SELECTION}>
                                      Automatic (latest available assembly)
                                    </SelectItem>
                                    {stalePreferredValue && (
                                      <SelectItem value={stalePreferredValue}>
                                        Unavailable preferred assembly (choose another)
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
                                {activeSelection.preferredMissing && (
                                  <p className="text-xs text-destructive mt-1">
                                    Previously selected assembly is no longer available. Pick a new
                                    final assembly.
                                  </p>
                                )}
                              </td>
                              <td className="px-3 py-2 align-top text-xs">
                                {selectedAssembly ? (
                                  <div className="space-y-1">
                                    <p className="font-medium text-foreground">
                                      {activeSelection.source === "preferred"
                                        ? "Marked as final"
                                        : "Automatic selection"}
                                    </p>
                                    <p className="text-muted-foreground">
                                      Run{" "}
                                      {selectedAssembly.createdByPipelineRun?.runNumber || "manual"}
                                      {selectedAssembly.createdByPipelineRun?.createdAt
                                        ? ` - ${formatDateTime(String(selectedAssembly.createdByPipelineRun.createdAt))}`
                                        : ""}
                                    </p>
                                    <p className="text-muted-foreground truncate max-w-[360px]">
                                      {selectedAssembly.assemblyFile}
                                    </p>
                                  </div>
                                ) : (
                                  <span className="text-destructive">No usable assembly selected</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                {assemblySelectionError && (
                  <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {assemblySelectionError}
                  </div>
                )}
                {samplesWithAssemblies.length === 0 && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No assemblies found yet. Run MAG first to generate assemblies.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Delete Run Dialog */}
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
    </div>
  );
}
