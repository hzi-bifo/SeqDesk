"use client";

import { useState, useEffect, useMemo } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useSession } from "next-auth/react";
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
  Clock,
  Package,
  ArrowRight,
  Layers,
  Trash2,
} from "lucide-react";
import { PipelineDataFlowSummary } from "@/components/pipelines/PipelineDataFlow";
import {
  getAvailableAssemblies,
  resolveAssemblySelection,
} from "@/lib/pipelines/assembly-selection";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const AUTO_ASSEMBLY_SELECTION = "__auto__";

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

interface PipelineReadinessCheck {
  id: string;
  label: string;
  available: number;
  total: number;
  required: boolean;
  ready: boolean;
}

interface PipelineReadinessSummary {
  canRun: boolean;
  checking: boolean;
  requiredReady: number;
  requiredTotal: number;
  missingRequired: string[];
  summary: string;
  checkDetails: string[];
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

interface EnaSettingsResponse {
  enaTestMode?: boolean;
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

function formatRelativeTime(dateInput: string | Date) {
  const date = new Date(dateInput);
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

function getPipelineReadiness(params: {
  pipelineId: string;
  validation?: MetadataValidation;
  totalSamples: number;
  samplesWithReads: number;
}): PipelineReadinessSummary {
  const { pipelineId, validation, totalSamples, samplesWithReads } = params;

  if (pipelineId === "submg") {
    if (!validation) {
      return {
        canRun: false,
        checking: true,
        requiredReady: 0,
        requiredTotal: 6,
        missingRequired: [],
        summary: "Checking required inputs...",
        checkDetails: [],
      };
    }

    const errorIssues = validation.issues.filter((issue) => issue.severity === "error");
    const byField = new Map<string, MetadataIssue[]>();
    for (const issue of errorIssues) {
      const current = byField.get(issue.field) || [];
      current.push(issue);
      byField.set(issue.field, current);
    }

    const metadataFieldMissingSampleIds = new Map<string, Set<string>>();
    const sampleMetadataIssues = [
      ...(byField.get("sampleMetadata") || []),
      ...(byField.get("checklistData") || []),
    ];
    for (const issue of sampleMetadataIssues) {
      const sampleToken = extractSampleToken(issue.message) || issue.message;
      const missingFields = extractSubmgMissingMetadataFields(issue.message);
      for (const fieldName of missingFields) {
        const sampleSet = metadataFieldMissingSampleIds.get(fieldName) || new Set<string>();
        sampleSet.add(sampleToken);
        metadataFieldMissingSampleIds.set(fieldName, sampleSet);
      }
    }

    let sampleMetadataMissingSummary: string | undefined;
    if (metadataFieldMissingSampleIds.size > 0 && totalSamples > 0) {
      sampleMetadataMissingSummary = Array.from(metadataFieldMissingSampleIds.entries())
        .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
        .map(([fieldName, sampleIds]) => `${fieldName} (${sampleIds.size}/${totalSamples})`)
        .join(", ");
    }

    const checks: PipelineReadinessCheck[] = [];

    const addStudyCheck = (id: string, label: string, fields: string[]) => {
      const hasError = fields.some((field) => (byField.get(field) || []).length > 0);
      checks.push({
        id,
        label,
        available: hasError ? 0 : 1,
        total: 1,
        required: true,
        ready: !hasError,
      });
    };

    const addSampleCheck = (
      id: string,
      label: string,
      fields: string[],
      availableOverride?: number
    ) => {
      const issues = fields.flatMap((field) => byField.get(field) || []);
      const missingCount = countMissingSamples(issues, totalSamples);
      const availableCount =
        typeof availableOverride === "number"
          ? Math.max(0, Math.min(availableOverride, totalSamples))
          : Math.max(0, totalSamples - missingCount);
      checks.push({
        id,
        label,
        available: availableCount,
        total: totalSamples,
        required: true,
        ready: totalSamples > 0 && availableCount === totalSamples,
      });
    };

    addStudyCheck("studyAccession", "Study accession", ["studyAccessionId", "studyAccession"]);
    addSampleCheck("reads", "Paired reads", ["reads"], samplesWithReads);
    addSampleCheck("checksums", "Read checksums", ["checksums"]);
    addSampleCheck("taxId", "Sample taxId", ["taxId"]);
    addSampleCheck("sampleMetadata", "Sample metadata", ["checklistData", "sampleMetadata"]);
    addSampleCheck("assemblies", "Assemblies", ["assemblies"]);

    const requiredChecks = checks.filter((check) => check.required);
    const requiredReady = requiredChecks.filter((check) => check.ready).length;
    const requiredTotal = requiredChecks.length;
    const missingRequired = formatSampleMissingRequiredLabels(
      requiredChecks.filter((check) => !check.ready).map((check) => check.label),
      sampleMetadataMissingSummary ? [sampleMetadataMissingSummary] : []
    );

    const checkDetails = requiredChecks
      .filter((check) => check.total > 1)
      .map((check) => {
        const base = `${check.label}: ${check.available}/${check.total} samples`;
        if (check.label === "Sample metadata" && sampleMetadataMissingSummary) {
          return `${base} • fields: ${sampleMetadataMissingSummary}`;
        }
        return base;
      });

    return {
      canRun: requiredReady === requiredTotal,
      checking: false,
      requiredReady,
      requiredTotal,
      missingRequired,
      summary: `${requiredReady}/${requiredTotal} required inputs available`,
      checkDetails,
    };
  }

  if (pipelineId === "mag") {
    const pairedReadsReady = samplesWithReads > 0;
    const metadataErrors = (validation?.issues || []).filter(
      (issue) => issue.severity === "error"
    );
    const hasMetadataErrors = metadataErrors.length > 0;
    const metadataReady = validation ? !hasMetadataErrors : true;
    const requiredTotal = validation ? 2 : 1;
    const requiredReady =
      (pairedReadsReady ? 1 : 0) + (validation ? (metadataReady ? 1 : 0) : 0);
    const hasLongReadPlatformError = metadataErrors.some((issue) =>
      /long-read/i.test(issue.message)
    );
    const metadataLabel = hasLongReadPlatformError
      ? "Short-read platform"
      : "Platform metadata";
    const missingRequired = [
      ...(pairedReadsReady ? [] : ["Paired reads"]),
      ...(validation && !metadataReady ? [metadataLabel] : []),
    ];
    const checkDetails: string[] = [];
    if (totalSamples > 0) {
      checkDetails.push(`Paired reads: ${samplesWithReads}/${totalSamples} samples`);
    }
    if (validation && !metadataReady && metadataErrors.length > 0) {
      checkDetails.push(metadataErrors[0].message);
    }

    return {
      canRun: pairedReadsReady && metadataReady,
      checking: false,
      requiredReady,
      requiredTotal,
      missingRequired,
      summary: validation
        ? `${requiredReady}/${requiredTotal} required inputs available`
        : `${samplesWithReads}/${totalSamples} samples with paired reads`,
      checkDetails,
    };
  }

  const hasErrors = Boolean(
    validation?.issues.some((issue) => issue.severity === "error")
  );
  const errorFields = Array.from(
    new Set(
      (validation?.issues || [])
        .filter((issue) => issue.severity === "error")
        .map((issue) => fieldLabel(issue.field))
    )
  );

  return {
    canRun: !hasErrors,
    checking: false,
    requiredReady: hasErrors ? 0 : 1,
    requiredTotal: 1,
    missingRequired: errorFields,
    summary: hasErrors ? "Missing required metadata" : "Ready to run",
    checkDetails: [],
  };
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

export function StudyPipelinesSection({
  studyId,
  samples,
}: StudyPipelinesSectionProps) {
  const { data: session } = useSession();
  const isFacilityAdmin = session?.user?.role === "FACILITY_ADMIN";

  // Fetch enabled pipelines
  const { data: pipelinesData } = useSWR(
    "/api/admin/settings/pipelines?enabled=true",
    fetcher
  );
  const { data: enaSettingsData } = useSWR<EnaSettingsResponse>(
    isFacilityAdmin ? "/api/admin/settings/ena" : null,
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
  const [assemblySelectionError, setAssemblySelectionError] = useState<
    string | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<PipelineRun | null>(null);
  const [deletingRun, setDeletingRun] = useState(false);
  const [deleteRunError, setDeleteRunError] = useState<string | null>(null);
  const [calculatingChecksums, setCalculatingChecksums] = useState(false);
  const [checksumResult, setChecksumResult] = useState<{
    success: boolean;
    message: string;
    detail?: string;
  } | null>(null);
  const [localChecksumOverrides, setLocalChecksumOverrides] = useState<
    Record<string, true>
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

  useEffect(() => {
    setPreferredAssemblyBySample(initialPreferredAssemblyMap);
  }, [initialPreferredAssemblyMap]);

  useEffect(() => {
    setLocalChecksumOverrides({});
    setChecksumResult(null);
    setCalculatingChecksums(false);
  }, [studyId]);

  const enabledPipelines: Pipeline[] = useMemo(
    () => pipelinesData?.pipelines || [],
    [pipelinesData]
  );
  const pipelineRuns: PipelineRun[] = runsData?.runs || [];
  const enaSubmissionServer = useMemo(() => {
    if (typeof enaSettingsData?.enaTestMode !== "boolean") {
      return null;
    }

    const isTestMode = enaSettingsData.enaTestMode;
    return {
      isTestMode,
      label: isTestMode ? "Test server" : "Production server",
      host: isTestMode ? "wwwdev.ebi.ac.uk" : "www.ebi.ac.uk",
    };
  }, [enaSettingsData]);
  const samplesWithAssemblySelection = useMemo(
    () =>
      samples.map((sample) => ({
        ...sample,
        preferredAssemblyId:
          preferredAssemblyBySample[sample.id] ?? sample.preferredAssemblyId ?? null,
      })),
    [preferredAssemblyBySample, samples]
  );
  const samplesWithAssemblies = useMemo(
    () =>
      samplesWithAssemblySelection.filter(
        (sample) => getAvailableAssemblies(sample).length > 0
      ),
    [samplesWithAssemblySelection]
  );

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
  const samplesWithReads = samplesWithAssemblySelection.filter((s) =>
    s.reads?.some((r) => r.file1 && r.file2)
  );
  const missingChecksumFilePaths = useMemo(
    () =>
      getMissingReadChecksumPaths({
        samples: samplesWithAssemblySelection,
        ignorePaths: localChecksumOverrides,
      }),
    [localChecksumOverrides, samplesWithAssemblySelection]
  );
  const isSubmgDialog = selectedPipeline?.pipelineId === "submg";
  const submitBinsEnabled = Boolean(
    localConfig.submitBins ??
      selectedPipeline?.defaultConfig?.submitBins ??
      true
  );

  const submgCoverage = useMemo(() => {
    if (!isSubmgDialog || !metadataValidation) return null;
    return buildSubmgCoverageSummary({
      validation: metadataValidation,
      samples: samplesWithAssemblySelection,
      selectedSampleIds: selectedSamples,
      submitBins: submitBinsEnabled,
    });
  }, [
    isSubmgDialog,
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

  const hasBlockingMetadataErrors =
    metadataValidation !== null &&
    (isSubmgDialog
      ? Boolean(submgCoverage?.blocking)
      : metadataValidation.issues.some((i) => i.severity === "error"));

  const refreshSubmgValidation = async () => {
    const validationRes = await fetch("/api/pipelines/validate-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studyId, pipelineId: "submg" }),
    });

    if (!validationRes.ok) {
      let message = "Failed to refresh SubMG metadata validation";
      try {
        const payload = await validationRes.json();
        if (typeof payload.error === "string") {
          message = payload.error;
        }
      } catch {
        // Keep fallback error message.
      }
      throw new Error(message);
    }

    const validation = (await validationRes.json()) as MetadataValidation;
    setMetadataPrecheck((prev) => ({ ...prev, submg: validation }));

    if (isSubmgDialog) {
      setMetadataValidation(validation);
    }
  };

  const handleComputeReadChecksums = async () => {
    if (calculatingChecksums) return;

    if (missingChecksumFilePaths.length === 0) {
      setChecksumResult({
        success: true,
        message: "All read files already have checksums.",
      });
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

      const detailParts = [
        `${aggregate.updatedReadRecords} stored in read records`,
      ];
      if (aggregate.notLinkedToRead > 0) {
        detailParts.push(
          `${aggregate.notLinkedToRead} not assigned to a read record`
        );
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
    } catch (error) {
      setChecksumResult({
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to calculate read checksums",
      });
    } finally {
      setCalculatingChecksums(false);
    }
  };

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

  const handlePreferredAssemblyChange = async (
    sampleId: string,
    value: string
  ) => {
    const nextAssemblyId = value === AUTO_ASSEMBLY_SELECTION ? null : value;
    const sample = samplesWithAssemblySelection.find((item) => item.id === sampleId);
    if (!sample) return;

    if (nextAssemblyId) {
      const selectedAssembly = sample.assemblies.find(
        (assembly) => assembly.id === nextAssemblyId
      );
      if (!selectedAssembly?.assemblyFile) {
        setAssemblySelectionError(
          `Sample ${sample.sampleId}: selected assembly has no file path.`
        );
        return;
      }
    }

    const previousAssemblyId =
      preferredAssemblyBySample[sampleId] ?? sample.preferredAssemblyId ?? null;

    setAssemblySelectionError(null);
    setPreferredAssemblyBySample((prev) => ({
      ...prev,
      [sampleId]: nextAssemblyId,
    }));
    setAssemblySelectionSaving((prev) => ({
      ...prev,
      [sampleId]: true,
    }));

    let preferredAssemblySaved = false;

    try {
      const updateRes = await fetch(`/api/samples/${sampleId}/preferred-assembly`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyId,
          assemblyId: nextAssemblyId,
        }),
      });

      if (!updateRes.ok) {
        let message = "Failed to update preferred assembly";
        try {
          const payload = await updateRes.json();
          if (typeof payload.error === "string") {
            message = payload.error;
          }
        } catch {
          // Ignore parse failures and keep fallback message.
        }
        throw new Error(message);
      }

      preferredAssemblySaved = true;
      await refreshSubmgValidation();
    } catch (error) {
      if (!preferredAssemblySaved) {
        setPreferredAssemblyBySample((prev) => ({
          ...prev,
          [sampleId]: previousAssemblyId,
        }));
        setAssemblySelectionError(
          error instanceof Error
            ? error.message
            : "Failed to update preferred assembly"
        );
      } else {
        setAssemblySelectionError(
          error instanceof Error
            ? `Preferred assembly saved, but metadata refresh failed: ${error.message}`
            : "Preferred assembly saved, but failed to refresh SubMG metadata validation."
        );
      }
    } finally {
      setAssemblySelectionSaving((prev) => ({
        ...prev,
        [sampleId]: false,
      }));
    }
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

  const handleDeleteRun = async () => {
    if (!deleteTarget) return;

    setDeletingRun(true);
    setDeleteRunError(null);

    try {
      const res = await fetch(`/api/pipelines/runs/${deleteTarget.id}/delete`, {
        method: "POST",
      });

      let payload: { error?: string } = {};
      try {
        payload = await res.json();
      } catch {
        // Ignore non-JSON error payloads.
      }

      if (!res.ok) {
        setDeleteRunError(payload.error || "Failed to delete run");
        return;
      }

      setDeleteTarget(null);
      await mutateRuns();
    } catch (error) {
      setDeleteRunError(
        error instanceof Error ? error.message : "Failed to delete run"
      );
    } finally {
      setDeletingRun(false);
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
              const readiness = getPipelineReadiness({
                pipelineId: pipeline.pipelineId,
                validation,
                totalSamples: samples.length,
                samplesWithReads: samplesWithReads.length,
              });
              const canRun = readiness.canRun;
              const category = pipeline.category || "metagenomics";
              const isSubmgPipeline = pipeline.pipelineId === "submg";
              const submgNeedsChecksums =
                isSubmgPipeline &&
                readiness.missingRequired.includes("Read checksums");

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
                      {isSubmgPipeline && (
                        <p
                          className={`text-xs mt-2 ${
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
                      )}
                      <p
                        className={`text-xs mt-2 ${
                          canRun ? "text-muted-foreground" : "text-amber-700"
                        }`}
                      >
                        {readiness.summary}
                      </p>
                      {readiness.missingRequired.length > 0 && (
                        <p className="text-xs text-destructive mt-1">
                          Missing: {readiness.missingRequired.join(", ")}
                        </p>
                      )}
                      {pipeline.pipelineId === "submg" &&
                        readiness.missingRequired.includes("Study accession") && (
                          <p className="text-xs text-amber-700 mt-1">
                            Register this study in the ENA tab first to populate the
                            accession used by SubMG.
                          </p>
                        )}
                      {readiness.checkDetails.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {readiness.checkDetails.join(" • ")}
                        </p>
                      )}
                      {submgNeedsChecksums &&
                        isFacilityAdmin &&
                        missingChecksumFilePaths.length > 0 && (
                          <div className="mt-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8"
                              disabled={calculatingChecksums}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleComputeReadChecksums();
                              }}
                            >
                              {calculatingChecksums ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : null}
                              Compute and add read checksums
                            </Button>
                            <p className="text-xs text-muted-foreground mt-1">
                              {missingChecksumFilePaths.length} read file
                              {missingChecksumFilePaths.length === 1 ? "" : "s"}{" "}
                              currently missing MD5 values.
                            </p>
                          </div>
                        )}
                      {isSubmgPipeline && checksumResult && (
                        <p
                          className={`text-xs mt-2 ${
                            checksumResult.success
                              ? "text-green-700"
                              : "text-destructive"
                          }`}
                        >
                          {checksumResult.message}
                          {checksumResult.detail
                            ? ` ${checksumResult.detail}`
                            : ""}
                        </p>
                      )}
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
                href={`/analysis?studyId=${studyId}`}
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
                <TableHead className="w-[110px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pipelineRuns.map((run) => (
                <TableRow
                  key={run.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => window.location.href = `/analysis/${run.id}`}
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
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-destructive hover:text-destructive"
                      title={
                        run.status === "running"
                          ? "Stop the run before deleting"
                          : "Delete run and associated data"
                      }
                      disabled={run.status === "running" || deletingRun}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteRunError(null);
                        setDeleteTarget(run);
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {samplesWithAssemblySelection.length > 0 && (
        <div className="bg-card rounded-lg border overflow-hidden mt-4">
          <div className="px-5 py-4 border-b bg-secondary/30">
            <h3 className="text-sm font-semibold">Selected Assembly Per Sample</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Choose the assembly marked as final for each sample. Automatic mode
              always uses the newest available assembly.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/50">
                <TableHead>Sample</TableHead>
                <TableHead className="w-[320px]">Final Assembly</TableHead>
                <TableHead>Current Final Selection</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
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
                  <TableRow key={sample.id}>
                    <TableCell>
                      <div className="font-medium text-sm">{sample.sampleId}</div>
                      <div className="text-xs text-muted-foreground">
                        {availableAssemblies.length} assembly
                        {availableAssemblies.length === 1 ? "" : "ies"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={currentSelectValue}
                        onValueChange={(value) => {
                          if (value.startsWith("__missing__:")) return;
                          void handlePreferredAssemblyChange(sample.id, value);
                        }}
                        disabled={
                          (availableAssemblies.length === 0 &&
                            !stalePreferredValue) ||
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
                                {runNumber} • {fileName}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      {activeSelection.preferredMissing && (
                        <p className="text-xs text-destructive mt-1">
                          Previously selected assembly is no longer available.
                          Pick a new final assembly.
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {selectedAssembly ? (
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">
                            {activeSelection.source === "preferred"
                              ? "Marked as final"
                              : "Automatic selection"}
                          </p>
                          <p className="text-muted-foreground">
                            Run{" "}
                            {selectedAssembly.createdByPipelineRun?.runNumber ||
                              "manual"}
                            {selectedAssembly.createdByPipelineRun?.createdAt
                              ? ` • ${formatRelativeTime(
                                  selectedAssembly.createdByPipelineRun.createdAt
                                )}`
                              : ""}
                          </p>
                          <p className="text-muted-foreground truncate max-w-[360px]">
                            {selectedAssembly.assemblyFile}
                          </p>
                        </div>
                      ) : (
                        <span className="text-destructive">
                          No usable assembly selected
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {assemblySelectionError && (
            <div className="px-5 py-3 border-t bg-red-50 text-sm text-red-700">
              {assemblySelectionError}
            </div>
          )}
          {samplesWithAssemblies.length === 0 && (
            <div className="px-5 py-3 border-t text-sm text-muted-foreground">
              No assemblies found yet. Run MAG first to generate assemblies.
            </div>
          )}
        </div>
      )}

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
            <DialogTitle>Delete Run {deleteTarget?.runNumber}?</DialogTitle>
            <DialogDescription>
              This will permanently delete the run entry, its folder, and related
              records (steps, events, artifacts, assemblies, and bins). This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteRunError && (
            <p className="text-sm text-destructive">{deleteRunError}</p>
          )}

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
              onClick={handleDeleteRun}
              disabled={deletingRun}
            >
              {deletingRun ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Delete Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                          href={`/analysis/${runResult.runId}`}
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

              {isSubmgDialog && (
                <div className="py-3 border-b">
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                    <p className="text-sm font-medium">SubMG Submission Scope</p>
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
                        ? `Current ENA target (Admin > ENA): ${enaSubmissionServer.label} (${enaSubmissionServer.host})${enaSubmissionServer.isTestMode ? " - this run will be a test submission." : ""}`
                        : "Current ENA target: loading from Admin > ENA settings..."}
                    </p>
                    {loadingMetadata ? (
                      <p className="text-xs text-muted-foreground">
                        Evaluating selected samples...
                      </p>
                    ) : submgCoverage ? (
                      <>
                        <p
                          className={`text-xs ${
                            submgCoverage.blocking
                              ? "text-amber-700"
                              : "text-green-700"
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
                            study&apos;s ENA tab (Test Server or Production).
                          </p>
                        )}
                        <div className="space-y-1">
                          {submgCoverage.checks.map((check) => {
                            const preview = formatSamplePreview(
                              check.missingSampleIds,
                              new Map(
                                samplesWithAssemblySelection.map((sample) => [
                                  sample.id,
                                  sample,
                                ])
                              )
                            );
                            return (
                              <p key={check.id} className="text-xs text-muted-foreground">
                                {check.label}: {check.available}/{check.total} selected
                                {preview ? ` • missing ${preview}` : ""}
                                {check.missingDetail ? ` • fields: ${check.missingDetail}` : ""}
                              </p>
                            );
                          })}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {submgCoverage.binsSummary}
                        </p>
                        {submgCoverage.binsHint && (
                          <p className="text-xs text-amber-700">
                            {submgCoverage.binsHint}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Tip: Deselect samples with missing required inputs, or generate assemblies/bins first with the MAG pipeline.
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Unable to evaluate SubMG coverage yet.
                      </p>
                    )}
                  </div>
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
                  <Label>
                    {isSubmgDialog
                      ? `Samples to Submit (${selectedSamples.size} selected)`
                      : `Samples (${selectedSamples.size} selected)`}
                  </Label>
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

                {isSubmgDialog && (
                  <p className="text-xs text-muted-foreground mb-2">
                    Select which samples to include in this SubMG submission.
                    Samples missing required inputs must be deselected or completed first.
                  </p>
                )}

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
                        <div className="flex flex-col">
                          <span>{sample.sampleId}</span>
                          {isSubmgDialog &&
                            submgCoverage?.sampleMissingRequired[sample.id] &&
                            submgCoverage.sampleMissingRequired[sample.id].length > 0 && (
                              <span className="text-[11px] text-destructive">
                                Missing:{" "}
                                {formatSampleMissingRequiredLabels(
                                  submgCoverage.sampleMissingRequired[sample.id],
                                  submgCoverage.sampleMissingMetadataFields[sample.id] || []
                                ).join(", ")}
                              </span>
                            )}
                        </div>
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
                    hasBlockingMetadataErrors
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
