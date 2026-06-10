"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { notifyPanel } from "@/lib/notifications/client";
import { PageContainer } from "@/components/layout/PageContainer";
import { FastqcMetricBadges } from "@/components/orders/FastqcMetricBadges";
import { OrderPipelineView } from "@/components/orders/OrderPipelineView";
import { SequencingDiscoverView } from "@/components/orders/SequencingDiscoverView";
import { SequencingStreamView } from "@/components/orders/SequencingStreamView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { HelpBox } from "@/components/ui/help-box";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  FACILITY_SAMPLE_STATUSES,
  FACILITY_SAMPLE_STATUS_LABELS,
  READ_DATA_CLASS_BADGE_CLASSNAMES,
  READ_DATA_CLASS_LABELS,
  READ_DATA_CLASSES,
  READ_ORIGIN_BADGE_CLASSNAMES,
  getSequencingIntegrityIndicatorClassName,
  getSequencingIntegrityLabel,
  SEQUENCING_ARTIFACT_STAGE_LABELS,
  SEQUENCING_ARTIFACT_STAGES,
  SEQUENCING_ARTIFACT_TYPE_LABELS,
  SEQUENCING_ARTIFACT_TYPES,
  type FacilitySampleStatus,
  type ReadDataClass,
  type ReadOrigin,
} from "@/lib/sequencing/constants";
import {
  formatAvgQuality,
  getSequencingReportStageLabel,
  getSequencingReportSummary,
  hasSequencingReports,
} from "@/lib/sequencing/display";

const STATUS_DOT_COLORS: Record<FacilitySampleStatus, string> = {
  WAITING: "bg-slate-400",
  PROCESSING: "bg-blue-500",
  SEQUENCED: "bg-indigo-500",
  QC_REVIEW: "bg-amber-500",
  READY: "bg-emerald-500",
  ISSUE: "bg-rose-500",
};

const STATUS_TEXT_COLORS: Record<FacilitySampleStatus, string> = {
  WAITING: "text-muted-foreground",
  PROCESSING: "text-blue-600",
  SEQUENCED: "text-indigo-600",
  QC_REVIEW: "text-amber-600",
  READY: "text-emerald-600",
  ISSUE: "text-rose-600",
};

function getReadDataClassBadgeClassName(dataClass?: ReadDataClass | null) {
  return READ_DATA_CLASS_BADGE_CLASSNAMES[dataClass ?? "cleaned"];
}

function getReadOriginBadgeClassName(origin?: ReadOrigin | null) {
  return READ_ORIGIN_BADGE_CLASSNAMES[origin ?? "unknown"];
}

function shouldConfirmProtectedReadUse(sample?: SequencingSampleRow | null): boolean {
  return Boolean(sample?.read?.isProtectedRaw);
}

type ConfirmFn = ReturnType<typeof useConfirm>;

async function confirmProtectedReadUse(
  confirm: ConfirmFn,
  action: string,
  actionLabel: string,
  sample?: SequencingSampleRow | null
): Promise<boolean> {
  if (!shouldConfirmProtectedReadUse(sample)) return true;
  return confirm({
    title: "Use protected raw reads?",
    description: `${sample?.sampleId ?? "This sample"} uses ${sample?.read?.dataClassLabel ?? "protected"} reads. Raw reads may still contain human contamination. Continue to ${action}?`,
    confirmLabel: actionLabel,
    variant: "destructive",
  });
}

async function confirmCleanClassification(confirm: ConfirmFn): Promise<boolean> {
  return confirm({
    title: "Mark reads as cleaned?",
    description:
      "Only mark reads as cleaned after human contamination removal has completed. Continue?",
    confirmLabel: "Mark as cleaned",
  });
}
import type {
  OrderSequencingSummaryResponse,
  SequencingArtifactSummary,
  SequencingDeliverySummary,
  SequencingSampleRow,
} from "@/lib/sequencing/types";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  Eye,
  FlaskConical,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";

interface ReadBrowserFile {
  relativePath: string;
  filename: string;
  size: number;
  modifiedAt: string;
  checksum: string | null;
  readType: "R1" | "R2" | null;
  pairStatus: "paired" | "missing_r1" | "missing_r2" | "unknown" | null;
  assigned: boolean;
  assignedTo?: {
    sampleId: string;
    orderName: string;
  };
}

interface ArtifactBrowserFile {
  relativePath: string;
  filename: string;
  size: number;
  modifiedAt: string;
}

type PickerMode = "read" | "artifact";
type UploadMode = "read" | "artifact";
type DetailView = "reads" | "artifacts";

const CHUNK_SIZE = 5 * 1024 * 1024;

interface OrderPipelineShortcut {
  pipelineId: string;
  name: string;
  description: string;
  enabled: boolean;
  input?: {
    supportedScopes?: string[];
  };
}

interface RunPlanField {
  id: string;
  label: string;
  name: string;
  type: string;
  options?: Array<{ value: string; label: string }>;
  adminOnly?: boolean;
}

interface RunPlanSample {
  id: string;
  sampleId: string;
  sampleCode: string;
  sampleTitle: string | null;
  material: string | null;
  barcode: string | null;
  customFields: Record<string, unknown>;
  readCount: number;
  artifactCount: number;
  latestMetaXpathStatus: string | null;
}

interface RunPlan {
  id: string;
  runId: string;
  runName: string | null;
  platform: string | null;
  instrument: string | null;
  runDate: string | null;
  folderPath: string | null;
  runParameters: Record<string, unknown>;
  samples: RunPlanSample[];
}

interface AssignmentDraft {
  barcode: string;
  customFields: Record<string, string>;
}

interface RunPlanImportPreviewRow {
  rowNumber: number;
  runId: string;
  sampleCode: string;
  barcode: string | null;
  customFields: Record<string, unknown>;
  unmapped: Record<string, unknown>;
}

interface RunPlanImportPreview {
  sheet: string;
  rows: RunPlanImportPreviewRow[];
  rowCount: number;
  unmappedColumns: string[];
  missingSamples: string[];
  rowErrors?: Array<{ rowNumber: number | null; message: string }>;
  applyReady: boolean;
}

function formatFileSize(bytes?: number | null): string {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatBaseCount(bases: number): string {
  if (!Number.isFinite(bases) || bases <= 0) return "0 bp";
  if (bases < 1_000) return `${bases} bp`;
  if (bases < 1_000_000) return `${(bases / 1_000).toFixed(1)} kb`;
  if (bases < 1_000_000_000) return `${(bases / 1_000_000).toFixed(2)} Mb`;
  return `${(bases / 1_000_000_000).toFixed(2)} Gb`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
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

function artifactStageLabel(stage: string | null): string {
  if (!stage) return "No reports";
  return SEQUENCING_ARTIFACT_STAGE_LABELS[
    stage as keyof typeof SEQUENCING_ARTIFACT_STAGE_LABELS
  ] ?? stage;
}

function artifactTypeLabel(type: string): string {
  return SEQUENCING_ARTIFACT_TYPE_LABELS[
    type as keyof typeof SEQUENCING_ARTIFACT_TYPE_LABELS
  ] ?? type;
}

function copyToClipboard(value: string) {
  return navigator.clipboard.writeText(value);
}

type AssignmentFailurePayload = {
  error?: unknown;
  success?: unknown;
  results?: unknown;
};

type AssignmentFailureResult = {
  success?: unknown;
  sampleId?: unknown;
  error?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toAssignmentFailurePayload(value: unknown): AssignmentFailurePayload | null {
  return isRecord(value) ? value : null;
}

function toAssignmentFailureResult(value: unknown): AssignmentFailureResult | null {
  return isRecord(value) ? value : null;
}

function getAssignmentFailureMessage(payload: unknown, fallback: string): string | null {
  const payloadRecord = toAssignmentFailurePayload(payload);
  if (payloadRecord?.error) return String(payloadRecord.error);
  if (payloadRecord?.success === false) {
    const failures = Array.isArray(payloadRecord.results)
      ? payloadRecord.results
          .map(toAssignmentFailureResult)
          .filter((result): result is AssignmentFailureResult => result?.success === false)
      : [];
    if (failures.length > 0) {
      return failures
        .slice(0, 3)
        .map((failure) => {
          const message = failure.error ? String(failure.error) : fallback;
          return failure.sampleId && failure.error
            ? `${String(failure.sampleId)}: ${message}`
            : message;
        })
        .join("; ");
    }
    return fallback;
  }
  return null;
}

export default function OrderSequencingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const activePipelineId = searchParams.get("pipeline");
  const activeView = searchParams.get("view");
  const { data: session, status: sessionStatus } = useSession();
  const [data, setData] = useState<OrderSequencingSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dataFilter, setDataFilter] = useState("");
  const [detailSampleId, setDetailSampleId] = useState<string | null>(null);
  const [detailView, setDetailView] = useState<DetailView>("reads");
  const [detailOpen, setDetailOpen] = useState(false);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<PickerMode>("read");
  const [pickerTargetSampleId, setPickerTargetSampleId] = useState<string>("");
  const [pickerReadRole, setPickerReadRole] = useState<"R1" | "R2">("R1");
  const [pickerReadDataClass, setPickerReadDataClass] = useState<ReadDataClass>("cleaned");
  const [pickerArtifactStage, setPickerArtifactStage] = useState<string>("qc");
  const [pickerArtifactType, setPickerArtifactType] = useState<string>("qc_report");
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerFiles, setPickerFiles] = useState<Array<ReadBrowserFile | ArtifactBrowserFile>>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState<UploadMode>("read");
  const [uploadTargetSampleId, setUploadTargetSampleId] = useState<string>("");
  const [uploadReadRole, setUploadReadRole] = useState<"R1" | "R2">("R1");
  const [uploadReadDataClass, setUploadReadDataClass] = useState<ReadDataClass>("cleaned");
  const [uploadArtifactStage, setUploadArtifactStage] = useState<string>("qc");
  const [uploadArtifactType, setUploadArtifactType] = useState<string>("qc_report");
  const [uploadChecksum, setUploadChecksum] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [orderPipelines, setOrderPipelines] = useState<OrderPipelineShortcut[]>([]);
  const [, setRelativeTimeTick] = useState(0);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [delivery, setDelivery] = useState<SequencingDeliverySummary | null>(null);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryDialogOpen, setDeliveryDialogOpen] = useState(false);
  const [deliveryUpdating, setDeliveryUpdating] = useState(false);
  const [artifactVisibilityUpdatingId, setArtifactVisibilityUpdatingId] =
    useState<string | null>(null);

  const [inspectFilePath, setInspectFilePath] = useState<string>("");
  const [inspectData, setInspectData] = useState<{
    fileName: string;
    lines: string[];
    truncated: boolean;
    readCount: number | null;
    error: string | null;
  } | null>(null);

  const [analysisRuns, setAnalysisRuns] = useState<Array<{
    id: string;
    pipelineId: string;
    status: string;
    runNumber: string;
    createdAt: string;
    completedAt: string | null;
    startedBy?: { name: string | null } | null;
    inputSampleIds?: string | null;
  }>>([]);
  const [analysisRunsLoading, setAnalysisRunsLoading] = useState(false);
  const [runPlanFields, setRunPlanFields] = useState<RunPlanField[]>([]);
  const [runPlans, setRunPlans] = useState<RunPlan[]>([]);
  const [runPlansLoading, setRunPlansLoading] = useState(false);
  const [creatingRun, setCreatingRun] = useState(false);
  const [newRunId, setNewRunId] = useState("");
  const [newRunDate, setNewRunDate] = useState("");
  const [assignmentRunId, setAssignmentRunId] = useState("");
  const [assignmentSampleId, setAssignmentSampleId] = useState("");
  const [assignmentBarcode, setAssignmentBarcode] = useState("");
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [classifyingRead, setClassifyingRead] = useState(false);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, AssignmentDraft>>({});
  const [savingRunAssignmentsId, setSavingRunAssignmentsId] = useState<string | null>(null);
  const [importingRunPlan, setImportingRunPlan] = useState(false);
  const [applyingRunPlanImport, setApplyingRunPlanImport] = useState(false);
  const [runPlanImportFile, setRunPlanImportFile] = useState<File | null>(null);
  const [runPlanImportPreview, setRunPlanImportPreview] =
    useState<RunPlanImportPreview | null>(null);
  const [runPlanImportDialogOpen, setRunPlanImportDialogOpen] = useState(false);
  const runPlanImportRef = useRef<HTMLInputElement | null>(null);

  const orderId = resolvedParams.id;
  const isFacilityAdmin = session?.user?.role === "FACILITY_ADMIN";

  const sampleOptions = useMemo(() => data?.samples ?? [], [data?.samples]);
  const visibleOrderPipelines = useMemo(
    () => orderPipelines.filter((pipeline) => pipeline.enabled),
    [orderPipelines]
  );
  const editableRunPlanFields = useMemo(
    () => runPlanFields.filter((field) => field.name !== "barcode"),
    [runPlanFields]
  );
  const visibleRunPlanFields = useMemo(
    () => editableRunPlanFields.slice(0, 6),
    [editableRunPlanFields]
  );

  // Fetch pipeline runs for analysis overview
  useEffect(() => {
    if (activeView !== "analysis" || !isFacilityAdmin) return;
    let cancelled = false;
    setAnalysisRunsLoading(true);
    fetch(`/api/pipelines/runs?orderId=${orderId}&limit=200`)
      .then((res) => res.json())
      .then((payload) => {
        if (!cancelled) {
          setAnalysisRuns((payload?.runs ?? []) as typeof analysisRuns);
        }
      })
      .catch(() => {
        if (!cancelled) setAnalysisRuns([]);
      })
      .finally(() => {
        if (!cancelled) setAnalysisRunsLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeView, orderId, isFacilityAdmin]);

  const refreshSummary = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const response = await fetch(`/api/orders/${orderId}/sequencing`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Failed to load sequencing data");
        return;
      }
      setData(payload as OrderSequencingSummaryResponse);
      setError("");
    } catch {
      setError("Failed to load sequencing data");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  }, [orderId]);

  const refreshDelivery = useCallback(async () => {
    if (!isFacilityAdmin) {
      setDelivery(null);
      return;
    }

    setDeliveryLoading(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/sequencing/delivery`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load delivery status");
      }
      setDelivery((payload?.delivery ?? null) as SequencingDeliverySummary | null);
    } catch (deliveryError) {
      console.error("[Order Sequencing] Failed to load delivery status:", deliveryError);
      setDelivery(null);
    } finally {
      setDeliveryLoading(false);
    }
  }, [isFacilityAdmin, orderId]);

  const getSampleForReadPath = useCallback(
    (filePath: string) =>
      data?.samples.find(
        (sample) => sample.read?.file1 === filePath || sample.read?.file2 === filePath
      ) ?? null,
    [data?.samples]
  );

  const handleInspectFile = useCallback(async (filePath: string) => {
    const sample = getSampleForReadPath(filePath);
    if (!(await confirmProtectedReadUse(confirm, "inspect this file", "Inspect", sample))) {
      return;
    }
    setInspectFilePath(filePath);
    setInspectLoading(true);
    setInspectData(null);
    setInspectOpen(true);
    try {
      const res = await fetch(
        `/api/orders/${orderId}/files/inspect?path=${encodeURIComponent(filePath)}&lines=20`
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setInspectData({
          fileName: filePath.split("/").pop() ?? filePath,
          lines: [],
          truncated: false,
          readCount: null,
          error: payload?.error ?? "Failed to inspect file",
        });
      } else {
        setInspectData({
          fileName: payload.fileName,
          lines: payload.preview?.lines ?? [],
          truncated: payload.preview?.truncated ?? false,
          readCount: payload.readCount,
          error: payload.preview?.error ?? null,
        });
      }
    } catch {
      setInspectData({
        fileName: filePath.split("/").pop() ?? filePath,
        lines: [],
        truncated: false,
        readCount: null,
        error: "Failed to inspect file",
      });
    } finally {
      setInspectLoading(false);
    }
  }, [confirm, getSampleForReadPath, orderId]);

  const refreshOrderPipelines = useCallback(async () => {
    if (!isFacilityAdmin) {
      setOrderPipelines([]);
      return;
    }

    try {
      const response = await fetch("/api/admin/settings/pipelines?enabled=true&catalog=order");
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load order pipelines");
      }
      setOrderPipelines((payload?.pipelines as OrderPipelineShortcut[] | undefined) ?? []);
    } catch (pipelineError) {
      console.error("[Order Sequencing] Failed to load order pipelines:", pipelineError);
      setOrderPipelines([]);
    }
  }, [isFacilityAdmin]);

  const refreshRunPlans = useCallback(async () => {
    if (!isFacilityAdmin) {
      setRunPlans([]);
      setRunPlanFields([]);
      return;
    }
    setRunPlansLoading(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/sequencing/runs`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load run plans");
      }
      setRunPlanFields((payload?.fields ?? []) as RunPlanField[]);
      const runs = (payload?.runs ?? []) as RunPlan[];
      setRunPlans(runs);
      if (!assignmentRunId && runs[0]?.id) {
        setAssignmentRunId(runs[0].id);
      }
    } catch (runPlanError) {
      notifyPanel.error(
        runPlanError instanceof Error ? runPlanError.message : "Failed to load run plans"
      );
      setRunPlans([]);
    } finally {
      setRunPlansLoading(false);
    }
  }, [assignmentRunId, isFacilityAdmin, orderId]);

  useEffect(() => {
    if (sessionStatus === "loading") {
      return;
    }

    if (!isFacilityAdmin) {
      setLoading(false);
      return;
    }

    void refreshSummary();
  }, [isFacilityAdmin, refreshSummary, sessionStatus]);

  useEffect(() => {
    if (sessionStatus === "loading" || !isFacilityAdmin) {
      return;
    }

    void refreshDelivery();
  }, [isFacilityAdmin, refreshDelivery, sessionStatus]);

  useEffect(() => {
    if (sessionStatus === "loading") {
      return;
    }

    void refreshOrderPipelines();
    void refreshRunPlans();
  }, [refreshOrderPipelines, refreshRunPlans, sessionStatus]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRelativeTimeTick((value) => value + 1);
    }, 60_000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;

    const timeoutId = window.setTimeout(async () => {
      setPickerLoading(true);
      setError("");

      try {
        if (pickerMode === "read") {
          const response = await fetch(
            `/api/files?filter=present&search=${encodeURIComponent(pickerSearch)}`
          );
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload?.error || "Failed to browse read files");
          }
          setPickerFiles(payload.files as ReadBrowserFile[]);
        } else {
          const response = await fetch(
            `/api/orders/${orderId}/sequencing/browse?search=${encodeURIComponent(pickerSearch)}`
          );
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload?.error || "Failed to browse artifact files");
          }
          setPickerFiles(payload.files as ArtifactBrowserFile[]);
        }
      } catch (fetchError) {
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to browse sequencing storage"
        );
      } finally {
        setPickerLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [orderId, pickerMode, pickerOpen, pickerSearch]);

  useEffect(() => {
    if (pickerMode === "read" && !pickerTargetSampleId && sampleOptions[0]?.id) {
      setPickerTargetSampleId(sampleOptions[0].id);
    }
  }, [pickerMode, pickerTargetSampleId, sampleOptions]);

  useEffect(() => {
    if (uploadMode === "read" && !uploadTargetSampleId && sampleOptions[0]?.id) {
      setUploadTargetSampleId(sampleOptions[0].id);
    }
  }, [sampleOptions, uploadMode, uploadTargetSampleId]);

  useEffect(() => {
    if (!assignmentSampleId && sampleOptions[0]?.id) {
      setAssignmentSampleId(sampleOptions[0].id);
    }
  }, [assignmentSampleId, sampleOptions]);

  useEffect(() => {
    const nextDrafts: Record<string, AssignmentDraft> = {};
    for (const run of runPlans) {
      for (const sample of run.samples) {
        const customFields: Record<string, string> = {};
        for (const field of editableRunPlanFields) {
          const value = sample.customFields[field.name];
          customFields[field.name] =
            value === undefined || value === null ? "" : String(value);
        }
        nextDrafts[sample.id] = {
          barcode: sample.barcode ?? "",
          customFields,
        };
      }
    }
    setAssignmentDrafts(nextDrafts);
  }, [editableRunPlanFields, runPlans]);

  const canManage = Boolean(data?.canManage);
  const selectedSample = useMemo(
    () => data?.samples.find((sample) => sample.id === detailSampleId) ?? null,
    [data?.samples, detailSampleId]
  );

  const getSampleById = (sampleId: string) =>
    data?.samples.find((sample) => sample.id === sampleId) ?? null;

  const openSampleDetail = (sampleId: string, view: DetailView) => {
    setDetailSampleId(sampleId);
    setDetailView(view);
    setDetailOpen(true);
  };

  const getReadSummary = (sample: SequencingSampleRow) => {
    if (sample.read?.filesMissing) {
      return "Linked file missing";
    }

    const hasRead1 = Boolean(sample.read?.file1);
    const hasRead2 = Boolean(sample.read?.file2);

    if (hasRead1 && hasRead2) {
      return "Paired FASTQ linked";
    }
    if (hasRead1 || hasRead2) {
      return "Single read linked";
    }
    return "No reads linked";
  };

  const getReadIndicatorClassName = (sample: SequencingSampleRow) => {
    if (!sample.hasReads) return "bg-slate-300";
    if (sample.read?.filesMissing) return "bg-rose-500";
    return getSequencingIntegrityIndicatorClassName(sample.integrityStatus);
  };

  const getBarcodeSourceLabel = (source?: SequencingSampleRow["plannedBarcodeSource"]) => {
    if (source === "run-plan") return "Run plan";
    if (source === "sample-barcode") return "Order barcode";
    return null;
  };

  const hasReads = (sample: SequencingSampleRow) =>
    Boolean(sample.read?.file1 || sample.read?.file2);

  const hasReports = (sample: SequencingSampleRow) => hasSequencingReports(sample);

  const filteredSamples = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return sampleOptions.filter((sample) => {
      if (query) {
        const runPlanMatches = runPlans.flatMap((run) =>
          run.samples
            .filter((assignment) => assignment.sampleId === sample.id)
            .flatMap((assignment) => [
              run.runId,
              run.runName,
              assignment.barcode,
              ...Object.values(assignment.customFields).map((value) => String(value)),
            ])
        );
        const searchText = [
          sample.sampleId,
          sample.sampleAlias,
          sample.sampleTitle,
          sample.plannedBarcode,
          sample.sequencingRun?.runId,
          sample.sequencingRun?.runName,
          ...runPlanMatches,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!searchText.includes(query)) {
          return false;
        }
      }

      if (statusFilter && sample.facilityStatus !== statusFilter) {
        return false;
      }

      if (dataFilter === "reads" && !hasReads(sample)) {
        return false;
      }
      if (dataFilter === "missing_reads" && hasReads(sample)) {
        return false;
      }
      if (dataFilter === "stale_reads" && !sample.read?.filesMissing) {
        return false;
      }
      if (dataFilter === "reports" && !hasReports(sample)) {
        return false;
      }
      if (
        dataFilter === "missing_hashes" &&
        !["missing", "partial"].includes(sample.integrityStatus)
      ) {
        return false;
      }

      return true;
    });
  }, [dataFilter, runPlans, sampleOptions, searchQuery, statusFilter]);

  const protectedReadSamples = useMemo(
    () => sampleOptions.filter((sample) => sample.read?.isProtectedRaw),
    [sampleOptions]
  );

  const hasActiveFilters = Boolean(searchQuery || statusFilter || dataFilter);

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("");
    setDataFilter("");
  };

  const openPicker = (mode: PickerMode, sampleId?: string | null) => {
    setPickerMode(mode);
    setPickerTargetSampleId(
      sampleId || (mode === "artifact" ? "" : sampleOptions[0]?.id || "")
    );
    setPickerReadRole("R1");
    setPickerReadDataClass("cleaned");
    setPickerArtifactStage("qc");
    setPickerArtifactType("qc_report");
    setPickerSearch("");
    setPickerFiles([]);
    setPickerOpen(true);
  };

  const openUploader = (mode: UploadMode, sampleId?: string | null) => {
    setUploadMode(mode);
    setUploadTargetSampleId(
      sampleId || (mode === "artifact" ? "" : sampleOptions[0]?.id || "")
    );
    setUploadReadRole("R1");
    setUploadReadDataClass("cleaned");
    setUploadArtifactStage("qc");
    setUploadArtifactType("qc_report");
    setUploadChecksum("");
    setUploadFile(null);
    setUploadProgress(0);
    setUploadOpen(true);
  };

  const handleStatusChange = async (sampleId: string, facilityStatus: string) => {
    setUpdatingStatusId(sampleId);

    try {
      const response = await fetch(`/api/orders/${orderId}/sequencing/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: [{ sampleId, facilityStatus }],
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update status");
      }

      await refreshSummary({ silent: true });
    } catch (statusError) {
      notifyPanel.error(
        statusError instanceof Error ? statusError.message : "Failed to update status"
      );
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const handleApplyReadAssignment = async (
    sample: SequencingSampleRow,
    nextRead1: string | null,
    nextRead2: string | null,
    dataClass: ReadDataClass = "cleaned"
  ) => {
    const response = await fetch(`/api/orders/${orderId}/sequencing/reads`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assignments: [
          {
            sampleId: sample.id,
            read1: nextRead1,
            read2: nextRead2,
            dataClass,
          },
        ],
      }),
    });

    const payload = await response.json();
    const failureMessage = getAssignmentFailureMessage(payload, "Failed to assign reads");
    if (!response.ok || failureMessage) {
      throw new Error(failureMessage || "Failed to assign reads");
    }
  };

  const handleClassifyRead = async (
    sample: SequencingSampleRow,
    dataClass: ReadDataClass
  ) => {
    if (!sample.read) return;
    if (dataClass === "cleaned" && !(await confirmCleanClassification(confirm))) {
      return;
    }

    setClassifyingRead(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/sequencing/reads`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleId: sample.id,
          readId: sample.read.id,
          dataClass,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || "Failed to update read classification");
      }
      notifyPanel.success(`Marked reads as ${READ_DATA_CLASS_LABELS[dataClass].toLowerCase()}`);
      await refreshSummary({ silent: true });
      await refreshDelivery();
    } catch (classificationError) {
      notifyPanel.error(
        classificationError instanceof Error
          ? classificationError.message
          : "Failed to update read classification"
      );
    } finally {
      setClassifyingRead(false);
    }
  };

  const handleCreateRunPlan = async () => {
    const trimmedRunId = newRunId.trim();
    if (!trimmedRunId) {
      notifyPanel.error("Run ID is required");
      return;
    }
    setCreatingRun(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/sequencing/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: trimmedRunId,
          runName: trimmedRunId,
          runDate: newRunDate || null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to create run");
      }
      setNewRunId("");
      setNewRunDate("");
      notifyPanel.success("Created sequencing run");
      await refreshRunPlans();
    } catch (createError) {
      notifyPanel.error(createError instanceof Error ? createError.message : "Failed to create run");
    } finally {
      setCreatingRun(false);
    }
  };

  const handleSaveRunAssignment = async () => {
    if (!assignmentRunId || !assignmentSampleId) {
      notifyPanel.error("Choose a run and sample");
      return;
    }
    setSavingAssignment(true);
    try {
      const response = await fetch(
        `/api/orders/${orderId}/sequencing/runs/${assignmentRunId}/samples`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assignments: [
              {
                sampleId: assignmentSampleId,
                barcode: assignmentBarcode || null,
              },
            ],
          }),
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save assignment");
      }
      setAssignmentBarcode("");
      notifyPanel.success("Saved run assignment");
      await refreshRunPlans();
    } catch (saveError) {
      notifyPanel.error(saveError instanceof Error ? saveError.message : "Failed to save assignment");
    } finally {
      setSavingAssignment(false);
    }
  };

  const updateRunAssignmentBarcode = (assignmentId: string, barcode: string) => {
    setAssignmentDrafts((current) => ({
      ...current,
      [assignmentId]: {
        barcode,
        customFields: current[assignmentId]?.customFields ?? {},
      },
    }));
  };

  const updateRunAssignmentField = (
    assignmentId: string,
    fieldName: string,
    value: string
  ) => {
    setAssignmentDrafts((current) => ({
      ...current,
      [assignmentId]: {
        barcode: current[assignmentId]?.barcode ?? "",
        customFields: {
          ...(current[assignmentId]?.customFields ?? {}),
          [fieldName]: value,
        },
      },
    }));
  };

  const formatDraftValueForSave = (field: RunPlanField, value: string): unknown => {
    if (value === "") return null;
    if (field.type === "number") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value;
    }
    if (field.type === "checkbox") {
      return value === "true";
    }
    return value;
  };

  const handleSaveRunAssignments = async (run: RunPlan) => {
    if (run.samples.length === 0) {
      notifyPanel.message("No samples assigned to this run");
      return;
    }
    setSavingRunAssignmentsId(run.id);
    try {
      const assignments = run.samples.map((sample) => {
        const draft = assignmentDrafts[sample.id] ?? {
          barcode: sample.barcode ?? "",
          customFields: {},
        };
        const customFields = Object.fromEntries(
          editableRunPlanFields.map((field) => [
            field.name,
            formatDraftValueForSave(field, draft.customFields[field.name] ?? ""),
          ])
        );
        return {
          sampleId: sample.sampleId,
          barcode: draft.barcode || null,
          customFields,
        };
      });
      const response = await fetch(
        `/api/orders/${orderId}/sequencing/runs/${run.id}/samples`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignments }),
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save run assignments");
      }
      notifyPanel.success("Saved run assignments");
      await refreshRunPlans();
    } catch (saveError) {
      notifyPanel.error(
        saveError instanceof Error ? saveError.message : "Failed to save run assignments"
      );
    } finally {
      setSavingRunAssignmentsId(null);
    }
  };

  const handleRunPlanImport = async (file: File | null | undefined) => {
    if (!file) return;
    setImportingRunPlan(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const previewResponse = await fetch(`/api/orders/${orderId}/sequencing/runs/import`, {
        method: "POST",
        body: formData,
      });
      const preview = await previewResponse.json().catch(() => null);
      if (!previewResponse.ok) {
        throw new Error(preview?.error || "Failed to preview import");
      }
      setRunPlanImportFile(file);
      setRunPlanImportPreview(preview as RunPlanImportPreview);
      setRunPlanImportDialogOpen(true);
    } catch (importError) {
      notifyPanel.error(importError instanceof Error ? importError.message : "Failed to preview run plan");
    } finally {
      setImportingRunPlan(false);
      if (runPlanImportRef.current) {
        runPlanImportRef.current.value = "";
      }
    }
  };

  const handleApplyRunPlanImport = async () => {
    if (!runPlanImportFile) return;
    setApplyingRunPlanImport(true);
    try {
      const formData = new FormData();
      formData.append("file", runPlanImportFile);
      const applyResponse = await fetch(`/api/orders/${orderId}/sequencing/runs/import?apply=true`, {
        method: "POST",
        body: formData,
      });
      const payload = await applyResponse.json().catch(() => null);
      if (!applyResponse.ok) {
        throw new Error(payload?.error || "Failed to import run plan");
      }
      notifyPanel.success(`Imported ${payload.rowCount} run assignment${payload.rowCount === 1 ? "" : "s"}`);
      setRunPlanImportDialogOpen(false);
      setRunPlanImportFile(null);
      setRunPlanImportPreview(null);
      await refreshRunPlans();
    } catch (importError) {
      notifyPanel.error(importError instanceof Error ? importError.message : "Failed to import run plan");
    } finally {
      setApplyingRunPlanImport(false);
    }
  };

  const handlePickFile = async (relativePath: string) => {
    if (!data) return;

    try {
      if (pickerMode === "read") {
        const sample = getSampleById(pickerTargetSampleId);
        if (!sample) {
          throw new Error("Choose a sample first");
        }

        const nextRead1 =
          pickerReadRole === "R1" ? relativePath : sample.read?.file1 ?? null;
        const nextRead2 =
          pickerReadRole === "R2" ? relativePath : sample.read?.file2 ?? null;
        await handleApplyReadAssignment(sample, nextRead1, nextRead2, pickerReadDataClass);
        notifyPanel.success(`Linked ${pickerReadRole} for ${sample.sampleId}`);
      } else {
        const response = await fetch(`/api/orders/${orderId}/sequencing/artifacts/link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sampleId: pickerTargetSampleId || null,
            stage: pickerArtifactStage,
            artifactType: pickerArtifactType,
            path: relativePath,
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to link artifact");
        }
        notifyPanel.success("Linked artifact");
      }

      setPickerOpen(false);
      await refreshSummary({ silent: true });
      await refreshDelivery();
    } catch (pickError) {
      notifyPanel.error(pickError instanceof Error ? pickError.message : "Failed to add data");
    }
  };

  const handlePublishDelivery = async () => {
    setDeliveryUpdating(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/sequencing/delivery/publication`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to publish sequencing files");
      }
      setDelivery((payload?.delivery ?? null) as SequencingDeliverySummary | null);
      setDeliveryDialogOpen(false);
      notifyPanel.success("Sequencing files are downloadable to the user");
    } catch (publishError) {
      notifyPanel.error(
        publishError instanceof Error
          ? publishError.message
          : "Failed to publish sequencing files"
      );
    } finally {
      setDeliveryUpdating(false);
    }
  };

  const handleHideDelivery = async () => {
    setDeliveryUpdating(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/sequencing/delivery/publication`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to hide sequencing files");
      }
      setDelivery((payload?.delivery ?? null) as SequencingDeliverySummary | null);
      notifyPanel.success("Sequencing files are hidden from the user");
    } catch (hideError) {
      notifyPanel.error(
        hideError instanceof Error ? hideError.message : "Failed to hide sequencing files"
      );
    } finally {
      setDeliveryUpdating(false);
    }
  };

  const handleSetArtifactVisibility = async (
    artifact: SequencingArtifactSummary,
    visibility: "customer" | "facility"
  ) => {
    setArtifactVisibilityUpdatingId(artifact.id);
    try {
      const response = await fetch(
        `/api/orders/${orderId}/sequencing/artifacts/${artifact.id}/visibility`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visibility }),
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update report visibility");
      }
      notifyPanel.success(
        visibility === "customer"
          ? "Marked report as customer-facing"
          : "Marked report as facility-only"
      );
      await refreshSummary({ silent: true });
      await refreshDelivery();
    } catch (visibilityError) {
      notifyPanel.error(
        visibilityError instanceof Error
          ? visibilityError.message
          : "Failed to update report visibility"
      );
    } finally {
      setArtifactVisibilityUpdatingId(null);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) {
      notifyPanel.error("Choose a file first");
      return;
    }
    if (uploadMode === "read" && !uploadTargetSampleId) {
      notifyPanel.error("Choose a target sample");
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      const createResponse = await fetch(`/api/orders/${orderId}/sequencing/uploads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleId: uploadTargetSampleId || null,
          targetKind: uploadMode,
          targetRole: uploadMode === "read" ? uploadReadRole : uploadArtifactType,
          originalName: uploadFile.name,
          expectedSize: uploadFile.size,
          checksumProvided: uploadChecksum || null,
          mimeType: uploadFile.type || null,
          metadata:
            uploadMode === "artifact"
              ? {
                  stage: uploadArtifactStage,
                  artifactType: uploadArtifactType,
                  visibility: "facility",
                  source: "upload",
                }
              : {
                  source: "upload",
                  dataClass: uploadReadDataClass,
                },
        }),
      });

      const createPayload = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(createPayload?.error || "Failed to start upload");
      }

      const uploadId = createPayload.uploadId as string;
      let offset = 0;

      while (offset < uploadFile.size) {
        const nextChunk = uploadFile.slice(offset, offset + CHUNK_SIZE);
        const chunkResponse = await fetch(
          `/api/orders/${orderId}/sequencing/uploads/${uploadId}`,
          {
            method: "PATCH",
            headers: {
              "x-seqdesk-offset": String(offset),
            },
            body: nextChunk,
          }
        );
        const chunkPayload = await chunkResponse.json();
        if (!chunkResponse.ok) {
          throw new Error(chunkPayload?.error || "Failed to upload file chunk");
        }
        offset += nextChunk.size;
        setUploadProgress(Math.min(100, Math.round((offset / uploadFile.size) * 100)));
      }

      const completeResponse = await fetch(
        `/api/orders/${orderId}/sequencing/uploads/${uploadId}/complete`,
        { method: "POST" }
      );
      const completePayload = await completeResponse.json();
      if (!completeResponse.ok) {
        throw new Error(completePayload?.error || "Failed to finalize upload");
      }

      notifyPanel.success("Upload completed");
      setUploadOpen(false);
      await refreshSummary({ silent: true });
      await refreshDelivery();
    } catch (uploadError) {
      notifyPanel.error(uploadError instanceof Error ? uploadError.message : "Failed to upload file");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const isDemo = !!session?.user?.isDemo;
  const deliveryReadCount = delivery?.readFiles.length ?? 0;
  const deliveryReportCount = delivery?.artifactFiles.length ?? 0;
  const deliveryIncludedCount = deliveryReadCount + deliveryReportCount;
  const deliveryMissingCount =
    (delivery?.excluded.missingCleanedReadFiles ?? 0) +
    (delivery?.excluded.missingCustomerArtifacts ?? 0);
  const deliveryExcludedCount = delivery
    ? Object.values(delivery.excluded).reduce((total, count) => total + count, 0)
    : 0;
  const canPublishDelivery = Boolean(
    canManage &&
      !isDemo &&
      delivery?.dataBasePathConfigured &&
      deliveryIncludedCount > 0 &&
      !deliveryUpdating
  );

  const renderArtifactVisibilityControl = (artifact: SequencingArtifactSummary) => {
    const isCustomerFacing = artifact.visibility === "customer";
    const nextVisibility = isCustomerFacing ? "facility" : "customer";
    const updating = artifactVisibilityUpdatingId === artifact.id;

    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => void handleSetArtifactVisibility(artifact, nextVisibility)}
        disabled={isDemo || !canManage || updating}
      >
        {updating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
        {isCustomerFacing ? "Make facility-only" : "Make customer-facing"}
      </Button>
    );
  };

  const renderRunAssignmentFieldInput = (
    assignmentId: string,
    field: RunPlanField
  ) => {
    const value = assignmentDrafts[assignmentId]?.customFields[field.name] ?? "";

    if (field.type === "select" && field.options?.length) {
      return (
        <Select
          value={value || "__empty"}
          onValueChange={(nextValue) =>
            updateRunAssignmentField(
              assignmentId,
              field.name,
              nextValue === "__empty" ? "" : nextValue
            )
          }
          disabled={isDemo || !canManage || savingRunAssignmentsId !== null}
        >
          <SelectTrigger className="h-8 min-w-[9rem]">
            <SelectValue placeholder={field.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__empty">-</SelectItem>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (field.type === "checkbox") {
      return (
        <Select
          value={value === "" ? "__empty" : value}
          onValueChange={(nextValue) =>
            updateRunAssignmentField(
              assignmentId,
              field.name,
              nextValue === "__empty" ? "" : nextValue
            )
          }
          disabled={isDemo || !canManage || savingRunAssignmentsId !== null}
        >
          <SelectTrigger className="h-8 min-w-[7rem]">
            <SelectValue placeholder={field.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__empty">-</SelectItem>
            <SelectItem value="true">Yes</SelectItem>
            <SelectItem value="false">No</SelectItem>
          </SelectContent>
        </Select>
      );
    }

    return (
      <Input
        type={field.type === "number" || field.type === "date" ? field.type : "text"}
        value={value}
        onChange={(event) =>
          updateRunAssignmentField(assignmentId, field.name, event.target.value)
        }
        className="h-8 min-w-[9rem]"
        disabled={isDemo || !canManage || savingRunAssignmentsId !== null}
      />
    );
  };

  if (sessionStatus === "loading" || loading) {
    return (
      <PageContainer className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </PageContainer>
    );
  }

  if (!isFacilityAdmin) {
    return (
      <PageContainer>
        <Card>
          <CardHeader>
            <CardTitle>Sequencing Data</CardTitle>
            <CardDescription>
              This workspace is available only to facility administrators.
            </CardDescription>
          </CardHeader>
        </Card>
      </PageContainer>
    );
  }

  if (error && !data) {
    return (
      <PageContainer>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-destructive" />
              Sequencing Data
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </PageContainer>
    );
  }

  if (!data) {
    return null;
  }

  if (activeView === "discover" && !activePipelineId) {
    return (
      <PageContainer>
        <SequencingDiscoverView
          orderId={orderId}
          samples={data.samples}
          canManage={canManage}
          dataBasePathConfigured={data.dataBasePathConfigured}
          onDataChanged={() => {
            void refreshSummary({ silent: true });
            void refreshDelivery();
          }}
        />
      </PageContainer>
    );
  }

  if (activeView === "stream" && !activePipelineId) {
    return (
      <PageContainer>
        <SequencingStreamView
          orderId={orderId}
          samples={data.samples}
          canManage={canManage}
          onDataChanged={() => {
            void refreshSummary({ silent: true });
            void refreshDelivery();
          }}
        />
      </PageContainer>
    );
  }

  if (activeView === "analysis" && !activePipelineId) {
    // Group runs by pipeline
    const runsByPipeline = new Map<string, typeof analysisRuns>();
    for (const run of analysisRuns) {
      const existing = runsByPipeline.get(run.pipelineId);
      if (existing) {
        existing.push(run);
      } else {
        runsByPipeline.set(run.pipelineId, [run]);
      }
    }

    return (
      <PageContainer>
        <div className="space-y-6">
          <div>
            <h1 className="text-xl font-semibold">Analysis</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Pipeline overview for this order
            </p>
          </div>

          {analysisRunsLoading && visibleOrderPipelines.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading pipelines...
            </div>
          ) : (
            <div className="grid gap-4">
              {visibleOrderPipelines.map((pipeline) => {
                const runs = runsByPipeline.get(pipeline.pipelineId) ?? [];
                const completedRuns = runs.filter((r) => r.status === "completed");
                const activeRuns = runs.filter(
                  (r) => r.status === "running" || r.status === "queued" || r.status === "pending"
                );
                const failedRuns = runs.filter((r) => r.status === "failed");
                const latestRun = runs[0]; // API returns newest first

                return (
                  <Link
                    key={pipeline.pipelineId}
                    href={`/orders/${orderId}/sequencing?pipeline=${encodeURIComponent(pipeline.pipelineId)}`}
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
                              <Badge variant="secondary" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                                <CheckCircle2 className="mr-1 h-3 w-3" />
                                Completed
                              </Badge>
                            )}
                            {activeRuns.length === 0 && completedRuns.length === 0 && failedRuns.length > 0 && (
                              <Badge variant="secondary" className="text-xs bg-red-50 text-red-700 border-red-200">
                                <AlertCircle className="mr-1 h-3 w-3" />
                                Failed
                              </Badge>
                            )}
                            {runs.length === 0 && (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
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
                            <span className="text-emerald-600">{completedRuns.length} completed</span>
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
                                {latestRun.startedBy?.name && (
                                  <> by {latestRun.startedBy.name}</>
                                )}
                              </span>
                            </>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
              {visibleOrderPipelines.length === 0 && (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No pipelines configured for this order.
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </PageContainer>
    );
  }

  if (activePipelineId) {
    return (
      <PageContainer>
        <OrderPipelineView
          orderId={orderId}
          pipelineId={activePipelineId}
          samples={data.samples}
          onRunCompleted={() => void refreshSummary({ silent: true })}
          onSampleDataChanged={() => {
            void refreshSummary({ silent: true });
            void refreshDelivery();
          }}
          isDemo={isDemo}
          isFacilityAdmin={isFacilityAdmin}
        />
      </PageContainer>
    );
  }

  return (
    <>
      <PageContainer>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold">Sequencing Data</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {sampleOptions.length} sample{sampleOptions.length !== 1 ? "s" : ""} in this order
              </p>
              {data.sequencingTechSelection?.label ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Sequencing setup: {data.sequencingTechSelection.label}
                </p>
              ) : null}
            </div>
            {!isDemo && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" asChild aria-disabled={!canManage}>
                  <Link
                    href={`/orders/${orderId}/sequencing?view=discover`}
                    className={!canManage ? "pointer-events-none opacity-50" : undefined}
                  >
                    <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                    Associate Files
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void refreshSummary({ silent: true });
                    void refreshDelivery();
                    void refreshOrderPipelines();
                    void refreshRunPlans();
                  }}
                  disabled={refreshing || deliveryLoading}
                >
                  {refreshing || deliveryLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Refresh
                </Button>
              </div>
            )}
          </div>

          <HelpBox title="What is the sequencing overview?">
            The overview shows each sample&apos;s sequencing status, linked read files, checksums,
            and generated QC or report artifacts. Use it to quickly see which samples are ready,
            missing data, or need facility review.
          </HelpBox>

          {(delivery || deliveryLoading) && (
            <Card className="rounded-xl border bg-card shadow-none">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Download className="h-4 w-4 text-muted-foreground" />
                    Delivery to user
                  </CardTitle>
                  <CardDescription>
                    Publish cleaned active reads and customer-facing sequencing reports to the order owner.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {delivery?.isPublished ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleHideDelivery()}
                      disabled={isDemo || !canManage || deliveryUpdating}
                    >
                      {deliveryUpdating ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Hide from user
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setDeliveryDialogOpen(true)}
                      disabled={!canPublishDelivery}
                    >
                      Make downloadable to user
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {deliveryLoading && !delivery ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading delivery status...
                  </div>
                ) : delivery ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {[
                        {
                          label: "Cleaned reads present",
                          ready: deliveryReadCount > 0,
                          detail: `${deliveryReadCount} file${deliveryReadCount === 1 ? "" : "s"}`,
                        },
                        {
                          label: "Missing files",
                          ready: deliveryMissingCount === 0,
                          detail:
                            deliveryMissingCount === 0
                              ? "None missing"
                              : `${deliveryMissingCount} missing`,
                        },
                        {
                          label: "Customer reports",
                          ready: deliveryReportCount > 0,
                          detail: `${deliveryReportCount} file${deliveryReportCount === 1 ? "" : "s"}`,
                        },
                        {
                          label: "Published state",
                          ready: delivery.isPublished,
                          detail: delivery.isPublished
                            ? delivery.publishedAt
                              ? `Released ${formatDateTime(delivery.publishedAt)}`
                              : "Released"
                            : "Hidden",
                        },
                      ].map((item) => (
                        <div key={item.label} className="rounded-lg border px-3 py-2">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <span
                              className={cn(
                                "h-2.5 w-2.5 rounded-full",
                                item.ready ? "bg-emerald-500" : "bg-amber-500"
                              )}
                            />
                            {item.label}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {item.detail}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge
                        variant="outline"
                        className={
                          delivery.isPublished
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : undefined
                        }
                      >
                        {delivery.isPublished ? "Downloadable to user" : "Not visible to user"}
                      </Badge>
                      <span>{deliveryIncludedCount} included</span>
                      <span>{deliveryExcludedCount} excluded</span>
                      {delivery.publishedBy ? (
                        <span>
                          Published by {delivery.publishedBy.firstName}{" "}
                          {delivery.publishedBy.lastName}
                        </span>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </CardContent>
            </Card>
          )}

          {protectedReadSamples.length > 0 ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-900">
              <div className="font-medium">Protected read data present</div>
              <div className="mt-1 text-rose-800">
                {protectedReadSamples.length} sample{protectedReadSamples.length === 1 ? "" : "s"} use raw or unknown reads. Raw reads may still contain human contamination; only mark them cleaned after removal has completed.
              </div>
            </div>
          ) : null}

          {!isDemo && !data.dataBasePathConfigured && (
            <Card className="border-amber-200 bg-amber-50/70">
              <CardHeader>
                <CardTitle className="text-base text-amber-900">Storage Not Configured</CardTitle>
                <CardDescription className="text-amber-800">
                  Configure the sequencing storage path in admin settings before using scans, linked files, or uploads.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {!isDemo && !canManage && (
            <Card className="border-slate-200 bg-slate-50/70">
              <CardHeader>
                <CardTitle className="text-base">Order Not Ready For Sequencing Data</CardTitle>
                <CardDescription>
                  Sequencing data actions are enabled once the order is submitted or completed.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {error ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

	          <Card className="rounded-xl border bg-card shadow-none">
	            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FlaskConical className="h-4 w-4 text-muted-foreground" />
                    Run Plan
                  </CardTitle>
                  <CardDescription>
                    Map internal sample IDs to sequencing run barcodes before reads or reports arrive.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    ref={runPlanImportRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(event) => void handleRunPlanImport(event.target.files?.[0])}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runPlanImportRef.current?.click()}
                    disabled={importingRunPlan || isDemo || !canManage}
                  >
                    {importingRunPlan ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Import Excel
                  </Button>
                </div>
	              </div>
	            </CardHeader>
	            <CardContent className="space-y-4">
	              <HelpBox title="What is a run plan?">
	                A run plan maps each order sample to the sequencing run barcode or lane label expected
	                from the facility. SeqDesk uses it to match barcode-folder outputs such as
	                barcode01 FASTQs before read files or reports arrive, while still allowing later
	                corrections from facility imports.
	              </HelpBox>

	              <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
                <Input
                  value={newRunId}
                  onChange={(event) => setNewRunId(event.target.value)}
                  placeholder="Run ID, e.g. 20260223"
                  disabled={creatingRun || isDemo || !canManage}
                />
                <Input
                  type="date"
                  value={newRunDate}
                  onChange={(event) => setNewRunDate(event.target.value)}
                  disabled={creatingRun || isDemo || !canManage}
                />
                <Button
                  type="button"
                  onClick={() => void handleCreateRunPlan()}
                  disabled={creatingRun || isDemo || !canManage}
                >
                  {creatingRun ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Create Run
                </Button>
              </div>

              <div className="grid gap-3 lg:grid-cols-[1fr_1fr_10rem_auto]">
                <Select
                  value={assignmentRunId}
                  onValueChange={setAssignmentRunId}
                  disabled={savingAssignment || isDemo || !canManage}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose run" />
                  </SelectTrigger>
                  <SelectContent>
                    {runPlans.map((run) => (
                      <SelectItem key={run.id} value={run.id}>
                        {run.runId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={assignmentSampleId}
                  onValueChange={setAssignmentSampleId}
                  disabled={savingAssignment || isDemo || !canManage}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose sample" />
                  </SelectTrigger>
                  <SelectContent>
                    {sampleOptions.map((sample) => (
                      <SelectItem key={sample.id} value={sample.id}>
                        {sample.sampleId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={assignmentBarcode}
                  onChange={(event) => setAssignmentBarcode(event.target.value)}
                  placeholder="barcode01"
                  disabled={savingAssignment || isDemo || !canManage}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleSaveRunAssignment()}
                  disabled={savingAssignment || runPlans.length === 0 || isDemo || !canManage}
                >
                  {savingAssignment ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Save Mapping
                </Button>
              </div>

              {runPlansLoading ? (
                <div className="flex items-center justify-center rounded-lg border border-dashed py-6 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading run plans...
                </div>
              ) : runPlans.length === 0 ? (
                <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  No sequencing runs planned yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {runPlans.map((run) => (
                    <div key={run.id} className="overflow-hidden rounded-lg border">
                      <div className="flex flex-col gap-2 border-b bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="font-medium">{run.runId}</div>
                          <div className="text-xs text-muted-foreground">
                            {run.runDate ? formatDateTime(run.runDate) : "No run date"}
                            {run.platform ? ` · ${run.platform}` : ""}
                            {run.instrument ? ` · ${run.instrument}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleSaveRunAssignments(run)}
                            disabled={
                              isDemo ||
                              !canManage ||
                              run.samples.length === 0 ||
                              savingRunAssignmentsId === run.id
                            }
                          >
                            {savingRunAssignmentsId === run.id ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            Save Changes
                          </Button>
                          <Button size="sm" variant="outline" asChild>
                            <a href={`/api/orders/${orderId}/sequencing/runs/${run.id}/export`}>
                              <Download className="mr-1.5 h-3.5 w-3.5" />
                              Export
                            </a>
                          </Button>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] text-sm">
                          <thead className="border-b bg-background">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium">Barcode</th>
                              <th className="px-3 py-2 text-left font-medium">Sample ID</th>
                              <th className="px-3 py-2 text-left font-medium">Material</th>
                              <th className="px-3 py-2 text-left font-medium">Reads</th>
                              <th className="px-3 py-2 text-left font-medium">Reports</th>
                              <th className="px-3 py-2 text-left font-medium">MetaXpath</th>
                              {visibleRunPlanFields.map((field) => (
                                <th key={field.id} className="px-3 py-2 text-left font-medium">
                                  {field.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {run.samples.length === 0 ? (
                              <tr>
                                <td colSpan={6 + visibleRunPlanFields.length} className="px-3 py-5 text-center text-muted-foreground">
                                  No samples assigned to this run.
                                </td>
                              </tr>
                            ) : (
                              run.samples.map((sample) => (
                                <tr key={sample.id} className="border-b last:border-b-0">
                                  <td className="px-3 py-2">
                                    <Input
                                      value={assignmentDrafts[sample.id]?.barcode ?? ""}
                                      onChange={(event) =>
                                        updateRunAssignmentBarcode(sample.id, event.target.value)
                                      }
                                      className="h-8 min-w-[8rem] font-mono text-xs"
                                      placeholder="barcode01"
                                      disabled={isDemo || !canManage || savingRunAssignmentsId !== null}
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="font-medium">{sample.sampleCode}</div>
                                    {sample.sampleTitle && (
                                      <div className="text-xs text-muted-foreground">{sample.sampleTitle}</div>
                                    )}
                                  </td>
                                  <td className="px-3 py-2">{sample.material || "-"}</td>
                                  <td className="px-3 py-2">{sample.readCount}</td>
                                  <td className="px-3 py-2">{sample.artifactCount}</td>
                                  <td className="px-3 py-2">
                                    {sample.latestMetaXpathStatus ? (
                                      <Badge variant="outline">
                                        {sample.latestMetaXpathStatus}
                                      </Badge>
                                    ) : (
                                      <span className="text-muted-foreground">-</span>
                                    )}
                                  </td>
                                  {visibleRunPlanFields.map((field) => (
                                    <td key={field.id} className="px-3 py-2">
                                      {renderRunAssignmentFieldInput(sample.id, field)}
                                    </td>
                                  ))}
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pipeline shortcuts removed — pipelines are now accessible via sidebar sub-items */}

          <div className="overflow-hidden rounded-xl border border-border bg-card">

            <div className="border-b border-border px-4 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search samples..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="w-full rounded-lg border-0 bg-secondary py-2 pr-4 pl-9 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
                  />
                </div>

                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="relative flex-1 sm:flex-none">
                    <select
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value)}
                      className="w-full appearance-none rounded-lg border-0 bg-secondary py-2 pr-8 pl-3 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 sm:w-auto"
                    >
                      <option value="">All Statuses</option>
                      {FACILITY_SAMPLE_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {FACILITY_SAMPLE_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  </div>

                  <div className="relative flex-1 sm:flex-none">
                    <select
                      value={dataFilter}
                      onChange={(event) => setDataFilter(event.target.value)}
                      className="w-full appearance-none rounded-lg border-0 bg-secondary py-2 pr-8 pl-3 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 sm:w-auto"
                    >
	                      <option value="">All Data</option>
	                      <option value="reads">With Reads</option>
	                      <option value="missing_reads">Missing Reads</option>
	                      <option value="stale_reads">Stale Read Paths</option>
	                      <option value="reports">With QC / Reports</option>
	                      <option value="missing_hashes">Missing Hashes</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  </div>

                  {hasActiveFilters ? (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="flex shrink-0 items-center gap-1 px-2 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="hidden grid-cols-12 gap-4 border-b border-border bg-secondary/50 px-5 py-2.5 text-xs font-medium text-muted-foreground md:grid">
              <div className="col-span-2">Sample</div>
              <div className="col-span-2">Barcode</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-3">Reads</div>
              <div className="col-span-2">QC / Reports</div>
              <div className="col-span-1"></div>
            </div>

            <div className="divide-y divide-border">
              {filteredSamples.map((sample) => {
                const statusKey = sample.facilityStatus as FacilitySampleStatus;
                const dotColor = STATUS_DOT_COLORS[statusKey] ?? "bg-slate-400";
                const textColor = STATUS_TEXT_COLORS[statusKey] ?? "text-muted-foreground";
                const statusLabel = FACILITY_SAMPLE_STATUS_LABELS[statusKey] ?? sample.facilityStatus;
                const barcodeSourceLabel = getBarcodeSourceLabel(sample.plannedBarcodeSource);

                return (
                <div
                  key={sample.id}
                  className="block px-4 py-3 transition-colors hover:bg-secondary/80 group md:grid md:grid-cols-12 md:gap-4 md:px-5 md:py-4 md:items-center"
                >
                  {/* Mobile layout */}
                  <div className="md:hidden">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{sample.sampleId}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {sample.sampleAlias || sample.sampleTitle || ""}
                          {(sample.sampleAlias || sample.sampleTitle) && " · "}
                          {getReadSummary(sample)} · {getSequencingReportSummary(sample)}
                        </p>
                        {sample.plannedBarcode ? (
                          <p className="mt-1 text-xs font-mono text-muted-foreground">
                            {sample.plannedBarcode}
                            {barcodeSourceLabel ? (
                              <span className="ml-1 font-sans">({barcodeSourceLabel})</span>
                            ) : null}
                          </p>
                        ) : null}
                        {sample.read ? (
                          <div className="mt-1 flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={cn("text-[11px]", getReadDataClassBadgeClassName(sample.read.dataClass))}
                            >
                              {sample.read.dataClassLabel}
                            </Badge>
                            {sample.read.isSimulated ? (
                              <Badge
                                variant="outline"
                                className={cn("text-[11px]", getReadOriginBadgeClassName(sample.read.readOrigin))}
                              >
                                {sample.read.readOriginLabel}
                              </Badge>
                            ) : null}
                            {sample.protectedProvenanceCount > 0 ? (
                              <span className="text-xs text-muted-foreground">
                                {sample.protectedProvenanceCount} protected provenance
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {canManage ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-secondary transition-colors"
                                disabled={updatingStatusId === sample.id}
                              >
                                <span className={cn("h-2 w-2 rounded-full", dotColor)} />
                                <span className={cn("text-xs font-medium", textColor)}>{statusLabel}</span>
                                <ChevronDown className="h-3 w-3 text-muted-foreground" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {FACILITY_SAMPLE_STATUSES.map((s) => (
                                <DropdownMenuItem
                                  key={s}
                                  onClick={() => handleStatusChange(sample.id, s)}
                                  disabled={updatingStatusId === sample.id}
                                >
                                  <span className={cn("mr-2 h-2 w-2 rounded-full", STATUS_DOT_COLORS[s])} />
                                  {FACILITY_SAMPLE_STATUS_LABELS[s]}
                                  {sample.facilityStatus === s ? (
                                    <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                                  ) : null}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                            <span className={`text-xs font-medium ${textColor}`}>{statusLabel}</span>
                          </div>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
                              aria-label={`Actions for ${sample.sampleId}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openSampleDetail(sample.id, "reads")}>
                              Reads
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openSampleDetail(sample.id, "artifacts")}>
                              QC / Reports
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => openPicker("read", sample.id)} disabled={!canManage}>
                              Link Reads
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openUploader("read", sample.id)} disabled={!canManage}>
                              Upload Reads
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openPicker("artifact", sample.id)} disabled={!canManage}>
                              Link QC / Report
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openUploader("artifact", sample.id)} disabled={!canManage}>
                              Upload QC / Report
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>

                  {/* Desktop layout */}
                  <div className="hidden md:contents">
                    {/* Sample */}
                    <div className="col-span-2 min-w-0">
                      <p className="font-medium text-sm truncate">{sample.sampleId}</p>
                      {sample.sampleAlias ? (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{sample.sampleAlias}</p>
                      ) : null}
                      {sample.sampleTitle ? (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{sample.sampleTitle}</p>
                      ) : null}
                    </div>

                    {/* Barcode */}
                    <div className="col-span-2 min-w-0">
                      {sample.plannedBarcode ? (
                        <div className="space-y-1">
                          <Badge variant="outline" className="font-mono text-[11px]">
                            {sample.plannedBarcode}
                          </Badge>
                          {barcodeSourceLabel ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {barcodeSourceLabel}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not planned</span>
                      )}
                    </div>

                    {/* Status */}
                    <div className="col-span-2">
                      {canManage ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="flex items-center gap-2 rounded-md px-2 py-1 -ml-2 hover:bg-secondary transition-colors"
                              disabled={updatingStatusId === sample.id}
                            >
                              <span className={cn("h-2 w-2 rounded-full", dotColor)} />
                              <span className={cn("text-xs font-medium", textColor)}>{statusLabel}</span>
                              <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {FACILITY_SAMPLE_STATUSES.map((s) => (
                              <DropdownMenuItem
                                key={s}
                                onClick={() => handleStatusChange(sample.id, s)}
                              >
                                <span className={cn("h-2 w-2 rounded-full", STATUS_DOT_COLORS[s])} />
                                {FACILITY_SAMPLE_STATUS_LABELS[s]}
                                {sample.facilityStatus === s && (
                                  <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                                )}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className={cn("h-2 w-2 rounded-full", dotColor)} />
                          <span className={cn("text-xs font-medium", textColor)}>{statusLabel}</span>
                        </div>
                      )}
                    </div>

                    {/* Reads */}
                    <div className="col-span-3 min-w-0">
                      {sample.hasReads ? (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button type="button" className="text-left w-full group">
                              <div className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    "h-2 w-2 rounded-full shrink-0",
                                    getReadIndicatorClassName(sample)
                                  )}
                                  aria-hidden="true"
                                />
                                <span className="text-sm truncate group-hover:underline">{getReadSummary(sample)}</span>
                                {sample.read ? (
                                  <Badge
                                    variant="outline"
                                    className={cn("shrink-0 text-[11px]", getReadDataClassBadgeClassName(sample.read.dataClass))}
                                  >
                                    {sample.read.dataClassLabel}
                                  </Badge>
                                ) : null}
                                {sample.read?.isSimulated ? (
                                  <Badge
                                    variant="outline"
                                    className={cn("shrink-0 text-[11px]", getReadOriginBadgeClassName(sample.read.readOrigin))}
                                  >
                                    {sample.read.readOriginLabel}
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5 ml-4 truncate">
                                {[sample.read?.file1, sample.read?.file2].filter(Boolean).map((f) => (f as string).split("/").pop()).join(", ")}
                              </p>
                              {sample.read?.filesMissing ? (
                                <p className="ml-4 mt-0.5 text-xs text-rose-600">
                                  Linked path is stale or inaccessible
                                </p>
                              ) : null}
                              {sample.read?.isProtectedRaw ? (
                                <p className="ml-4 mt-0.5 text-xs text-rose-600">
                                  Raw reads may still contain human contamination
                                </p>
                              ) : null}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto max-w-md text-xs p-0" align="start">
                            <div className="divide-y divide-border">
                              {sample.read?.file1 && (
                                <div className="px-3 py-2.5">
                                  <div className="flex items-center justify-between gap-3 mb-1">
                                    <p className="font-medium">R1</p>
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                      onClick={() => void handleInspectFile(sample.read!.file1!)}
                                    >
                                      <Eye className="h-3 w-3" />
                                      Inspect
                                    </button>
                                  </div>
                                  <p className="font-mono text-[11px] text-muted-foreground break-all leading-relaxed">
                                    {(sample.read.file1).split("/").pop()}
                                  </p>
                                  <div className="flex items-center gap-2 mt-1.5 text-muted-foreground">
                                    {sample.read.fileSize1 != null && (
                                      <span className="inline-flex items-center gap-1 rounded bg-secondary/60 px-1.5 py-0.5">
                                        {formatFileSize(sample.read.fileSize1)}
                                      </span>
                                    )}
                                    {sample.read.readCount1 != null && (
                                      <span className="inline-flex items-center gap-1 rounded bg-secondary/60 px-1.5 py-0.5">
                                        {sample.read.readCount1.toLocaleString()} reads
                                      </span>
                                    )}
                                    {sample.read.avgQuality1 != null && (
                                      <span className="inline-flex items-center gap-1 rounded bg-secondary/60 px-1.5 py-0.5">
                                        Q{formatAvgQuality(sample.read.avgQuality1)}
                                      </span>
                                    )}
                                    {sample.read.checksum1 && (
                                      <span className="inline-flex items-center gap-1 rounded bg-secondary/60 px-1.5 py-0.5 font-mono" title={sample.read.checksum1}>
                                        {sample.read.checksum1.slice(0, 8)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                              {sample.read?.file2 && (
                                <div className="px-3 py-2.5">
                                  <div className="flex items-center justify-between gap-3 mb-1">
                                    <p className="font-medium">R2</p>
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                      onClick={() => void handleInspectFile(sample.read!.file2!)}
                                    >
                                      <Eye className="h-3 w-3" />
                                      Inspect
                                    </button>
                                  </div>
                                  <p className="font-mono text-[11px] text-muted-foreground break-all leading-relaxed">
                                    {(sample.read.file2).split("/").pop()}
                                  </p>
                                  <div className="flex items-center gap-2 mt-1.5 text-muted-foreground">
                                    {sample.read.fileSize2 != null && (
                                      <span className="inline-flex items-center gap-1 rounded bg-secondary/60 px-1.5 py-0.5">
                                        {formatFileSize(sample.read.fileSize2)}
                                      </span>
                                    )}
                                    {sample.read.readCount2 != null && (
                                      <span className="inline-flex items-center gap-1 rounded bg-secondary/60 px-1.5 py-0.5">
                                        {sample.read.readCount2.toLocaleString()} reads
                                      </span>
                                    )}
                                    {sample.read.avgQuality2 != null && (
                                      <span className="inline-flex items-center gap-1 rounded bg-secondary/60 px-1.5 py-0.5">
                                        Q{formatAvgQuality(sample.read.avgQuality2)}
                                      </span>
                                    )}
                                    {sample.read.checksum2 && (
                                      <span className="inline-flex items-center gap-1 rounded bg-secondary/60 px-1.5 py-0.5 font-mono" title={sample.read.checksum2}>
                                        {sample.read.checksum2.slice(0, 8)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "h-2 w-2 rounded-full shrink-0",
                                getReadIndicatorClassName(sample)
                              )}
                              aria-hidden="true"
                            />
                            <span className="text-sm truncate">{getReadSummary(sample)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 ml-4">No linked files</p>
                        </>
                      )}
                      {sample.stream ? (
                        <p
                          className="text-xs text-muted-foreground mt-1 ml-4 inline-flex items-center gap-1.5"
                          title={
                            sample.stream.activeRunId
                              ? `Stream ${sample.stream.activeRunId} is actively writing to this sample.`
                              : "Stream-ingested chunks recorded for this sample. The stream is no longer active."
                          }
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "inline-block h-1.5 w-1.5 rounded-full",
                              sample.stream.activeRunId
                                ? "bg-emerald-500 animate-pulse"
                                : "bg-muted-foreground/40",
                            )}
                          />
                          Streaming &middot; {sample.stream.fileCount.toLocaleString()} file{sample.stream.fileCount === 1 ? "" : "s"} &middot;{" "}
                          {sample.stream.totalReads.toLocaleString()} reads &middot;{" "}
                          {formatBaseCount(sample.stream.totalBases)}
                        </p>
                      ) : null}
                    </div>

                    {/* QC / Reports */}
                    <div className="col-span-2 min-w-0">
                      <span className="text-sm">{getSequencingReportSummary(sample)}</span>
                      <FastqcMetricBadges read={sample.read} />
                      {hasSequencingReports(sample) && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {getSequencingReportStageLabel(sample)}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="col-span-1 flex items-center justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`Actions for ${sample.sampleId}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openSampleDetail(sample.id, "reads")}>
                            Reads
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openSampleDetail(sample.id, "artifacts")}>
                            QC / Reports
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => openPicker("read", sample.id)} disabled={!canManage}>
                            Link Reads
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openUploader("read", sample.id)} disabled={!canManage}>
                            Upload Reads
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openPicker("artifact", sample.id)} disabled={!canManage}>
                            Link QC / Report
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openUploader("artifact", sample.id)} disabled={!canManage}>
                            Upload QC / Report
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
                );
              })}

              {filteredSamples.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  <p>
                    {hasActiveFilters
                      ? "No samples match your filters."
                      : "No samples are available in this order yet."}
                  </p>
                  {hasActiveFilters ? (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="mt-2 text-sm text-foreground underline underline-offset-4"
                    >
                      Clear all filters
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-base">Customer Order Files</CardTitle>
                <CardDescription>
                  Files that belong to this customer order, such as delivery notes or combined QC summaries.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openPicker("artifact")}
                  disabled={!canManage}
                >
                  <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                  Link Existing
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openUploader("artifact")}
                  disabled={!canManage}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  Upload
                </Button>
              </div>
	            </CardHeader>
	            <CardContent className="space-y-4">
	              <HelpBox title="What are customer order files?">
	                Customer order files are order-level documents such as delivery notes, combined QC
	                summaries, or shared reports. They belong to the whole order rather than one sample
	                and are kept separate from sample FASTQs and sample-specific QC artifacts.
	              </HelpBox>

	              {data.orderArtifacts.length === 0 ? (
                <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  No customer order files linked yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {data.orderArtifacts.map((artifact: SequencingArtifactSummary) => (
                    <div key={artifact.id} className="rounded-lg border bg-card px-4 py-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{artifact.originalName}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline">{artifactStageLabel(artifact.stage)}</Badge>
                            <Badge variant="outline">{artifactTypeLabel(artifact.artifactType)}</Badge>
                            <Badge
                              variant="outline"
                              className={
                                artifact.visibility === "customer"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : undefined
                              }
                            >
                              {artifact.visibility === "customer"
                                ? "Customer-facing"
                                : "Facility only"}
                            </Badge>
                            <span>{formatFileSize(artifact.size)}</span>
                          </div>
                          <div className="mt-2 break-all text-xs text-muted-foreground">
                            {artifact.path}
                          </div>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <div>{formatDateTime(artifact.updatedAt)}</div>
                          <div className="mt-2">
                            {artifact.checksum ? (
                              <button
                                type="button"
                                className="font-mono text-foreground underline-offset-2 hover:underline"
                                onClick={() => void copyToClipboard(artifact.checksum as string)}
                              >
                                hash
                              </button>
                            ) : (
                              "no hash"
                            )}
                          </div>
                          {renderArtifactVisibilityControl(artifact)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </PageContainer>

      <Dialog open={deliveryDialogOpen} onOpenChange={setDeliveryDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Make sequencing files downloadable?</DialogTitle>
            <DialogDescription>
              The order owner will be able to inspect cleaned reads and download the listed files.
            </DialogDescription>
          </DialogHeader>

          {delivery ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border px-3 py-2">
                  <div className="text-xs text-muted-foreground">Cleaned reads</div>
                  <div className="mt-1 font-medium">{deliveryReadCount}</div>
                </div>
                <div className="rounded-lg border px-3 py-2">
                  <div className="text-xs text-muted-foreground">Customer reports</div>
                  <div className="mt-1 font-medium">{deliveryReportCount}</div>
                </div>
                <div className="rounded-lg border px-3 py-2">
                  <div className="text-xs text-muted-foreground">Excluded files</div>
                  <div className="mt-1 font-medium">{deliveryExcludedCount}</div>
                </div>
              </div>

              <ScrollArea className="max-h-[280px] rounded-lg border">
                <div className="divide-y">
                  {delivery.readFiles.map((file) => (
                    <div key={file.id} className="px-3 py-2 text-sm">
                      <div className="font-medium">
                        {file.sampleCode ?? "Sample"} {file.readDirection ?? "read"}
                      </div>
                      <div className="break-all text-xs text-muted-foreground">
                        {file.path}
                      </div>
                    </div>
                  ))}
                  {delivery.artifactFiles.map((file) => (
                    <div key={file.id} className="px-3 py-2 text-sm">
                      <div className="font-medium">{file.label}</div>
                      <div className="break-all text-xs text-muted-foreground">
                        {file.path}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Excluded: {delivery.excluded.rawOrUnknownReadFiles} raw or unknown reads,{" "}
                {delivery.excluded.missingCleanedReadFiles} missing cleaned reads,{" "}
                {delivery.excluded.facilityArtifacts} facility-only reports,{" "}
                {delivery.excluded.missingCustomerArtifacts} missing customer reports,{" "}
                {delivery.excluded.unsupportedCustomerArtifacts} unsupported customer reports.
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeliveryDialogOpen(false)}
              disabled={deliveryUpdating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handlePublishDelivery()}
              disabled={!canPublishDelivery}
            >
              {deliveryUpdating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Make downloadable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={runPlanImportDialogOpen} onOpenChange={setRunPlanImportDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Preview Run Plan Import</DialogTitle>
            <DialogDescription>
              Review mapped rows and unresolved columns before saving assignments.
            </DialogDescription>
          </DialogHeader>

          {runPlanImportPreview ? (
            <div className="space-y-4">
              <div className="grid gap-3 text-sm sm:grid-cols-4">
                <div className="rounded-lg border px-3 py-2">
                  <div className="text-xs text-muted-foreground">Sheet</div>
                  <div className="mt-1 font-medium">{runPlanImportPreview.sheet}</div>
                </div>
                <div className="rounded-lg border px-3 py-2">
                  <div className="text-xs text-muted-foreground">Rows</div>
                  <div className="mt-1 font-medium">{runPlanImportPreview.rowCount}</div>
                </div>
                <div className="rounded-lg border px-3 py-2">
                  <div className="text-xs text-muted-foreground">Unmapped columns</div>
                  <div className="mt-1 font-medium">
                    {runPlanImportPreview.unmappedColumns.length}
                  </div>
                </div>
                <div className="rounded-lg border px-3 py-2">
                  <div className="text-xs text-muted-foreground">Missing samples</div>
                  <div className="mt-1 font-medium">
                    {runPlanImportPreview.missingSamples.length}
                  </div>
                </div>
              </div>

              {runPlanImportPreview.missingSamples.length > 0 && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  Missing samples: {runPlanImportPreview.missingSamples.join(", ")}
                </div>
              )}

              {runPlanImportPreview.rowErrors?.length ? (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <div className="font-medium">Rows needing review</div>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {runPlanImportPreview.rowErrors.slice(0, 8).map((rowError, index) => (
                      <li key={`${rowError.rowNumber ?? "global"}-${index}`}>
                        {rowError.rowNumber ? `Row ${rowError.rowNumber}: ` : ""}
                        {rowError.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {runPlanImportPreview.unmappedColumns.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Unmapped columns will not be saved:{" "}
                  {runPlanImportPreview.unmappedColumns.join(", ")}
                </div>
              )}

              <ScrollArea className="max-h-[360px] rounded-lg border">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Row</th>
                      <th className="px-3 py-2 text-left font-medium">Run</th>
                      <th className="px-3 py-2 text-left font-medium">Sample</th>
                      <th className="px-3 py-2 text-left font-medium">Barcode</th>
                      <th className="px-3 py-2 text-left font-medium">Mapped fields</th>
                      <th className="px-3 py-2 text-left font-medium">Unmapped</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runPlanImportPreview.rows.slice(0, 100).map((row) => (
                      <tr key={`${row.rowNumber}-${row.sampleCode}`} className="border-b last:border-b-0">
                        <td className="px-3 py-2">{row.rowNumber}</td>
                        <td className="px-3 py-2 font-mono text-xs">{row.runId}</td>
                        <td className="px-3 py-2 font-medium">{row.sampleCode}</td>
                        <td className="px-3 py-2 font-mono text-xs">{row.barcode || "-"}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {Object.keys(row.customFields).length
                            ? Object.entries(row.customFields)
                                .map(([key, value]) => `${key}: ${String(value)}`)
                                .join(", ")
                            : "-"}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {Object.keys(row.unmapped).length
                            ? Object.keys(row.unmapped).join(", ")
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
              {runPlanImportPreview.rows.length > 100 && (
                <p className="text-xs text-muted-foreground">
                  Showing first 100 rows only.
                </p>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRunPlanImportDialogOpen(false)}
              disabled={applyingRunPlanImport}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleApplyRunPlanImport()}
              disabled={
                applyingRunPlanImport ||
                !runPlanImportPreview?.applyReady ||
                isDemo ||
                !canManage
              }
            >
              {applyingRunPlanImport ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Apply Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {detailView === "reads" ? "Reads" : "QC / Reports"}
              {selectedSample ? ` for ${selectedSample.sampleId}` : ""}
            </DialogTitle>
            <DialogDescription>
              {detailView === "reads"
                ? "Review linked FASTQ files, integrity information, and replace or upload sample reads."
                : "Review sample-level QC and report files, then link or upload new artifacts."}
            </DialogDescription>
          </DialogHeader>

          {selectedSample ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={detailView === "reads" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDetailView("reads")}
                >
                  Reads
                </Button>
                <Button
                  variant={detailView === "artifacts" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDetailView("artifacts")}
                >
                  QC / Reports
                </Button>
              </div>

              {detailView === "reads" ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium">{getReadSummary(selectedSample)}</div>
                        {selectedSample.read ? (
                          <Badge
                            variant="outline"
                            className={cn("text-[11px]", getReadDataClassBadgeClassName(selectedSample.read.dataClass))}
                          >
                            {selectedSample.read.dataClassLabel}
                          </Badge>
                        ) : null}
                        {selectedSample.read?.isSimulated ? (
                          <Badge
                            variant="outline"
                            className={cn("text-[11px]", getReadOriginBadgeClassName(selectedSample.read.readOrigin))}
                          >
                            {selectedSample.read.readOriginLabel}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {getSequencingIntegrityLabel(selectedSample.integrityStatus)}
                      </div>
                      {selectedSample.read?.isProtectedRaw ? (
                        <div className="mt-2 text-xs text-rose-700">
                          Raw reads may still contain human contamination. Only mark as cleaned after human contamination removal has completed.
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedSample.read && canManage ? (
                        <Select
                          value={selectedSample.read.dataClass}
                          onValueChange={(value) =>
                            void handleClassifyRead(selectedSample, value as ReadDataClass)
                          }
                          disabled={classifyingRead}
                        >
                          <SelectTrigger className="h-8 w-[150px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {READ_DATA_CLASSES.map((dataClass) => (
                              <SelectItem key={dataClass} value={dataClass}>
                                {READ_DATA_CLASS_LABELS[dataClass]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setDetailOpen(false);
                          openPicker("read", selectedSample.id);
                        }}
                        disabled={!canManage}
                      >
                        <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                        Choose Existing
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setDetailOpen(false);
                          openUploader("read", selectedSample.id);
                        }}
                        disabled={!canManage}
                      >
                        <Upload className="mr-1.5 h-3.5 w-3.5" />
                        Upload
                      </Button>
                    </div>
                  </div>

                  {selectedSample.protectedProvenance.length > 0 ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3">
                      <div className="text-sm font-medium text-rose-900">Protected provenance</div>
                      <div className="mt-1 text-xs text-rose-800">
                        Previous raw or unknown reads are retained for facility traceability and are not the active pipeline input.
                      </div>
                      <div className="mt-3 space-y-2">
                        {selectedSample.protectedProvenance.map((read) => (
                          <div key={read.id} className="rounded-lg border border-rose-200 bg-background/80 px-3 py-2 text-xs">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <Badge
                                variant="outline"
                                className={cn("text-[11px]", getReadDataClassBadgeClassName(read.dataClass))}
                              >
                                {read.dataClassLabel}
                              </Badge>
                              {read.isSimulated ? (
                                <Badge
                                  variant="outline"
                                  className={cn("text-[11px]", getReadOriginBadgeClassName(read.readOrigin))}
                                >
                                  {read.readOriginLabel}
                                </Badge>
                              ) : null}
                              {read.classifiedAt ? (
                                <span className="text-muted-foreground">
                                  Classified {formatDateTime(read.classifiedAt)}
                                </span>
                              ) : null}
                            </div>
                            {[read.file1, read.file2].filter(Boolean).map((filePath) => (
                              <div key={filePath} className="break-all font-mono text-muted-foreground">
                                {filePath}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-2">
                    {(["file1", "file2"] as const).map((field, index) => {
                      const filePath = selectedSample.read?.[field];
                      const checksum =
                        field === "file1"
                          ? selectedSample.read?.checksum1
                          : selectedSample.read?.checksum2;
                      const readCount =
                        field === "file1"
                          ? selectedSample.read?.readCount1
                          : selectedSample.read?.readCount2;
                      const avgQuality =
                        field === "file1"
                          ? selectedSample.read?.avgQuality1
                          : selectedSample.read?.avgQuality2;
                      const label = index === 0 ? "R1" : "R2";

                      return (
                        <div key={field} className="rounded-xl border bg-card px-4 py-4">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <Badge variant="outline">{label}</Badge>
                            <span
                              className={cn(
                                "h-2.5 w-2.5 rounded-full",
                                filePath
                                  ? getReadIndicatorClassName(selectedSample)
                                  : "bg-slate-300"
                              )}
                              aria-hidden="true"
                            />
                          </div>
                          {filePath ? (
                            <div className="space-y-2">
                              <div className="text-sm font-medium">{filePath.split("/").pop()}</div>
                              <div className="break-all text-xs text-muted-foreground">
                                {filePath}
                              </div>
                              {selectedSample.read?.filesMissing ? (
                                <div className="text-xs text-rose-600">
                                  Linked path is stale or inaccessible.
                                </div>
                              ) : null}
                              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                <span>
                                  Reads: {readCount ?? "Unknown"}
                                </span>
                                <span>
                                  Avg quality: {avgQuality != null ? formatAvgQuality(avgQuality) : "Unknown"}
                                </span>
                                <span>
                                  Checksum:{" "}
                                  {checksum ? (
                                    <button
                                      type="button"
                                      className="font-mono text-foreground underline-offset-2 hover:underline"
                                      onClick={() => void copyToClipboard(checksum)}
                                    >
                                      {checksum}
                                    </button>
                                  ) : (
                                    "Missing"
                                  )}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground">
                              No {label} linked yet.
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium">{getSequencingReportSummary(selectedSample)}</div>
                      <FastqcMetricBadges read={selectedSample.read} />
                      <div className="mt-1 text-xs text-muted-foreground">
                        Sample-level files for QC, reports, or delivery attachments.
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setDetailOpen(false);
                          openPicker("artifact", selectedSample.id);
                        }}
                        disabled={!canManage}
                      >
                        <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                        Link Existing
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setDetailOpen(false);
                          openUploader("artifact", selectedSample.id);
                        }}
                        disabled={!canManage}
                      >
                        <Upload className="mr-1.5 h-3.5 w-3.5" />
                        Upload
                      </Button>
                    </div>
                  </div>

                  {selectedSample.artifacts.length === 0 ? (
                    <div className="rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground">
                      No sample-level QC or report files linked yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {selectedSample.artifacts.map((artifact) => (
                        <div key={artifact.id} className="rounded-lg border bg-card px-4 py-3">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="font-medium">{artifact.originalName}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <Badge variant="outline">
                                  {artifactStageLabel(artifact.stage)}
                                </Badge>
                                <Badge variant="outline">
                                  {artifactTypeLabel(artifact.artifactType)}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={
                                    artifact.visibility === "customer"
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      : undefined
                                  }
                                >
                                  {artifact.visibility === "customer"
                                    ? "Customer-facing"
                                    : "Facility only"}
                                </Badge>
                                <span>{formatFileSize(artifact.size)}</span>
                              </div>
                              <div className="mt-2 break-all text-xs text-muted-foreground">
                                {artifact.path}
                              </div>
                            </div>
                            <div className="text-right text-xs text-muted-foreground">
                              <div>{formatDateTime(artifact.updatedAt)}</div>
                              <div className="mt-2">
                                {artifact.checksum ? (
                                  <button
                                    type="button"
                                    className="font-mono text-foreground underline-offset-2 hover:underline"
                                    onClick={() => void copyToClipboard(artifact.checksum as string)}
                                  >
                                    hash
                                  </button>
                                ) : (
                                  "no hash"
                                )}
                              </div>
                              {renderArtifactVisibilityControl(artifact)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Choose Existing Files</DialogTitle>
            <DialogDescription>
              Link reads or reports already present on sequencing storage.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Data Type
              </div>
              <Select value={pickerMode} onValueChange={(value) => setPickerMode(value as PickerMode)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">Read Files</SelectItem>
                  <SelectItem value="artifact">QC / Reports</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Target
              </div>
              <Select
                value={pickerTargetSampleId || "order"}
                onValueChange={(value) => setPickerTargetSampleId(value === "order" ? "" : value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pickerMode === "artifact" ? <SelectItem value="order">Whole Order</SelectItem> : null}
                  {sampleOptions.map((sample) => (
                    <SelectItem key={sample.id} value={sample.id}>
                      {sample.sampleId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {pickerMode === "read" ? (
              <>
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Read Role
                  </div>
                  <Select value={pickerReadRole} onValueChange={(value) => setPickerReadRole(value as "R1" | "R2")}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="R1">Read 1 (R1)</SelectItem>
                      <SelectItem value="R2">Read 2 (R2)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Associate As
                  </div>
                  <Select value={pickerReadDataClass} onValueChange={(value) => setPickerReadDataClass(value as ReadDataClass)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {READ_DATA_CLASSES.map((dataClass) => (
                        <SelectItem key={dataClass} value={dataClass}>
                          {READ_DATA_CLASS_LABELS[dataClass]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Stage
                  </div>
                  <Select value={pickerArtifactStage} onValueChange={setPickerArtifactStage}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SEQUENCING_ARTIFACT_STAGES.map((stage) => (
                        <SelectItem key={stage} value={stage}>
                          {artifactStageLabel(stage)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Type
                  </div>
                  <Select value={pickerArtifactType} onValueChange={setPickerArtifactType}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SEQUENCING_ARTIFACT_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {artifactTypeLabel(type)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
          <Input
            value={pickerSearch}
            onChange={(event) => setPickerSearch(event.target.value)}
            placeholder={
              pickerMode === "read"
                ? "Search FASTQ files by path or filename"
                : "Search reports, PDFs, CSVs, or other artifacts"
            }
          />
          <ScrollArea className="max-h-[420px] rounded-xl border">
            <div className="divide-y">
              {pickerLoading ? (
                <div className="flex items-center justify-center px-4 py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : pickerFiles.length === 0 ? (
                <div className="px-4 py-10 text-sm text-muted-foreground">
                  No files found for this search.
                </div>
              ) : (
                pickerFiles.map((file) => {
                  const filePath = "relativePath" in file ? file.relativePath : "";
                  return (
                    <div key={filePath} className="flex items-start justify-between gap-4 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{file.filename}</div>
                        <div className="mt-1 break-all text-xs text-muted-foreground">
                          {file.relativePath}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {"size" in file ? <span>{formatFileSize(file.size)}</span> : null}
                          {"modifiedAt" in file ? <span>{formatDateTime(file.modifiedAt)}</span> : null}
                          {"readType" in file && file.readType ? (
                            <Badge variant="outline">{file.readType}</Badge>
                          ) : null}
                          {"assigned" in file && file.assigned && file.assignedTo ? (
                            <Badge variant="outline">
                              Assigned to {file.assignedTo.sampleId}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handlePickFile(file.relativePath)}
                        disabled={!canManage}
                      >
                        Choose
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Upload Files</DialogTitle>
            <DialogDescription>
              Upload read files or internal reports directly into the sequencing storage area.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Data Type
              </div>
              <Select value={uploadMode} onValueChange={(value) => setUploadMode(value as UploadMode)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">Read Files</SelectItem>
                  <SelectItem value="artifact">QC / Reports</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Target
              </div>
              <Select
                value={uploadTargetSampleId || "order"}
                onValueChange={(value) => setUploadTargetSampleId(value === "order" ? "" : value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {uploadMode === "artifact" ? <SelectItem value="order">Whole Order</SelectItem> : null}
                  {sampleOptions.map((sample) => (
                    <SelectItem key={sample.id} value={sample.id}>
                      {sample.sampleId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {uploadMode === "read" ? (
              <>
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Read Role
                  </div>
                  <Select value={uploadReadRole} onValueChange={(value) => setUploadReadRole(value as "R1" | "R2")}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="R1">Read 1 (R1)</SelectItem>
                      <SelectItem value="R2">Read 2 (R2)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Upload As
                  </div>
                  <Select value={uploadReadDataClass} onValueChange={(value) => setUploadReadDataClass(value as ReadDataClass)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {READ_DATA_CLASSES.map((dataClass) => (
                        <SelectItem key={dataClass} value={dataClass}>
                          {READ_DATA_CLASS_LABELS[dataClass]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Stage
                  </div>
                  <Select value={uploadArtifactStage} onValueChange={setUploadArtifactStage}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SEQUENCING_ARTIFACT_STAGES.map((stage) => (
                        <SelectItem key={stage} value={stage}>
                          {artifactStageLabel(stage)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Type
                  </div>
                  <Select value={uploadArtifactType} onValueChange={setUploadArtifactType}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SEQUENCING_ARTIFACT_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {artifactTypeLabel(type)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              File
            </div>
            <Input
              type="file"
              onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Optional Checksum
            </div>
            <Input
              value={uploadChecksum}
              onChange={(event) => setUploadChecksum(event.target.value)}
              placeholder="Paste an MD5 checksum if you already have it"
            />
          </div>
          {uploading ? (
            <div className="rounded-xl border bg-muted/30 px-4 py-3">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span>Uploading</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={() => void handleUpload()} disabled={!canManage || uploading}>
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Upload File
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inspect file preview dialog */}
      <Dialog open={inspectOpen} onOpenChange={setInspectOpen}>
        <DialogContent className="max-w-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              {inspectData?.fileName ?? "Inspecting file..."}
            </DialogTitle>
            <DialogDescription>
              {inspectData?.readCount != null
                ? `${inspectData.readCount.toLocaleString()} reads total — showing first ${Math.floor((inspectData?.lines?.length ?? 0) / 4)} reads`
                : "File preview"}
            </DialogDescription>
          </DialogHeader>
          {inspectLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : inspectData?.error ? (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {inspectData.error}
            </div>
          ) : inspectData?.lines && inspectData.lines.length > 0 ? (
            <div className="min-w-0">
              <div className="rounded-md border bg-secondary/30 max-h-[60vh] overflow-auto">
                <pre className="p-3 text-[11px] leading-relaxed font-mono whitespace-pre">
                  {inspectData.lines.join("\n")}
                </pre>
              </div>
              {inspectData.truncated && (
                <p className="mt-2 text-xs text-muted-foreground text-center">
                  Showing first {Math.floor(inspectData.lines.length / 4)} reads (file truncated)
                </p>
              )}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No preview available
            </p>
          )}
          {!inspectLoading && !inspectData?.error && inspectFilePath && (
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                asChild
              >
                <a
                  href={`/api/files/download?path=${encodeURIComponent(inspectFilePath)}`}
                  download
                  onClick={(event) => {
                    const sample = getSampleForReadPath(inspectFilePath);
                    if (!shouldConfirmProtectedReadUse(sample)) {
                      return;
                    }
                    event.preventDefault();
                    const href = event.currentTarget.href;
                    void confirmProtectedReadUse(
                      confirm,
                      "download this file",
                      "Download",
                      sample
                    ).then((confirmed) => {
                      if (confirmed) {
                        window.location.href = href;
                      }
                    });
                  }}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Download
                </a>
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
