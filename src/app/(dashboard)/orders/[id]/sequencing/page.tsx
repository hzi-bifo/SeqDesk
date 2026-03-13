"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { DemoFeatureNotice } from "@/components/demo/DemoFeatureNotice";
import { PageContainer } from "@/components/layout/PageContainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  FACILITY_SAMPLE_STATUSES,
  FACILITY_SAMPLE_STATUS_LABELS,
  getSequencingIntegrityIndicatorClassName,
  getSequencingIntegrityLabel,
  SEQUENCING_ARTIFACT_STAGE_LABELS,
  SEQUENCING_ARTIFACT_STAGES,
  SEQUENCING_ARTIFACT_TYPE_LABELS,
  SEQUENCING_ARTIFACT_TYPES,
  type FacilitySampleStatus,
} from "@/lib/sequencing/constants";

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
import type {
  OrderSequencingSummaryResponse,
  SequencingArtifactSummary,
  SequencingDiscoveryResult,
  SequencingSampleRow,
} from "@/lib/sequencing/types";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  FolderOpen,
  FolderSearch,
  Hash,
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

function formatFileSize(bytes?: number | null): string {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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

export default function OrderSequencingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
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
  const [computingChecksums, setComputingChecksums] = useState(false);
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  const [scanResults, setScanResults] = useState<SequencingDiscoveryResult[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<PickerMode>("read");
  const [pickerTargetSampleId, setPickerTargetSampleId] = useState<string>("");
  const [pickerReadRole, setPickerReadRole] = useState<"R1" | "R2">("R1");
  const [pickerArtifactStage, setPickerArtifactStage] = useState<string>("qc");
  const [pickerArtifactType, setPickerArtifactType] = useState<string>("qc_report");
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerFiles, setPickerFiles] = useState<Array<ReadBrowserFile | ArtifactBrowserFile>>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState<UploadMode>("read");
  const [uploadTargetSampleId, setUploadTargetSampleId] = useState<string>("");
  const [uploadReadRole, setUploadReadRole] = useState<"R1" | "R2">("R1");
  const [uploadArtifactStage, setUploadArtifactStage] = useState<string>("qc");
  const [uploadArtifactType, setUploadArtifactType] = useState<string>("qc_report");
  const [uploadChecksum, setUploadChecksum] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [, setRelativeTimeTick] = useState(0);

  const orderId = resolvedParams.id;
  const isFacilityAdmin = session?.user?.role === "FACILITY_ADMIN";

  const sampleOptions = useMemo(() => data?.samples ?? [], [data?.samples]);

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

  const getReportSummary = (sample: SequencingSampleRow) => {
    if (sample.artifactCount === 0) {
      return "No reports";
    }
    if (sample.artifactCount === 1) {
      return "1 report";
    }
    return `${sample.artifactCount} reports`;
  };

  const hasReads = (sample: SequencingSampleRow) =>
    Boolean(sample.read?.file1 || sample.read?.file2);

  const hasReports = (sample: SequencingSampleRow) => sample.artifactCount > 0;

  const filteredSamples = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return sampleOptions.filter((sample) => {
      if (query) {
        const searchText = [
          sample.sampleId,
          sample.sampleAlias,
          sample.sampleTitle,
          sample.sequencingRun?.runId,
          sample.sequencingRun?.runName,
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
  }, [dataFilter, sampleOptions, searchQuery, statusFilter]);

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
      toast.error(
        statusError instanceof Error ? statusError.message : "Failed to update status"
      );
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const handleApplyReadAssignment = async (
    sample: SequencingSampleRow,
    nextRead1: string | null,
    nextRead2: string | null
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
          },
        ],
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || "Failed to assign reads");
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
        await handleApplyReadAssignment(sample, nextRead1, nextRead2);
        toast.success(`Linked ${pickerReadRole} for ${sample.sampleId}`);
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
        toast.success("Linked artifact");
      }

      setPickerOpen(false);
      await refreshSummary({ silent: true });
    } catch (pickError) {
      toast.error(pickError instanceof Error ? pickError.message : "Failed to add data");
    }
  };

  const handleDiscover = async () => {
    setDiscovering(true);
    setScanResults([]);

    try {
      const response = await fetch(`/api/orders/${orderId}/sequencing/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true, autoAssign: false }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to discover files");
      }
      setScanResults(payload.results as SequencingDiscoveryResult[]);
    } catch (discoverError) {
      toast.error(
        discoverError instanceof Error
          ? discoverError.message
          : "Failed to discover sequencing files"
      );
    } finally {
      setDiscovering(false);
    }
  };

  const applyDiscoverySuggestion = async (result: SequencingDiscoveryResult) => {
    const sample = data?.samples.find((item) => item.sampleId === result.sampleId);
    if (!sample || !result.suggestion.read1) {
      return;
    }

    try {
      await handleApplyReadAssignment(
        sample,
        result.suggestion.read1.relativePath,
        result.suggestion.read2?.relativePath ?? null
      );
      toast.success(`Linked reads for ${sample.sampleId}`);
      await refreshSummary({ silent: true });
    } catch (applyError) {
      toast.error(applyError instanceof Error ? applyError.message : "Failed to apply match");
    }
  };

  const applyExactSuggestions = async () => {
    if (!data) return;

    const assignments = scanResults
      .filter((result) => result.suggestion.status === "exact" && result.suggestion.read1)
      .map((result) => {
        const sample = data.samples.find((row) => row.sampleId === result.sampleId);
        if (!sample || !result.suggestion.read1) return null;
        return {
          sampleId: sample.id,
          read1: result.suggestion.read1.relativePath,
          read2: result.suggestion.read2?.relativePath ?? null,
        };
      })
      .filter(
        (
          assignment
        ): assignment is { sampleId: string; read1: string; read2: string | null } =>
          assignment !== null
      );

    if (assignments.length === 0) {
      toast.message("No exact matches to apply");
      return;
    }

    try {
      const response = await fetch(`/api/orders/${orderId}/sequencing/reads`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to apply matches");
      }
      toast.success(`Applied ${assignments.length} exact match${assignments.length === 1 ? "" : "es"}`);
      await refreshSummary({ silent: true });
    } catch (applyError) {
      toast.error(applyError instanceof Error ? applyError.message : "Failed to apply matches");
    }
  };

  const handleComputeChecksums = async () => {
    setComputingChecksums(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/sequencing/checksums`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to compute checksums");
      }
      const summary = payload.summary as {
        updatedReads: number;
        updatedArtifacts: number;
      };
      toast.success(
        `Updated ${summary.updatedReads} read record${summary.updatedReads === 1 ? "" : "s"} and ${summary.updatedArtifacts} artifact${summary.updatedArtifacts === 1 ? "" : "s"}`
      );
      await refreshSummary({ silent: true });
    } catch (checksumError) {
      toast.error(
        checksumError instanceof Error
          ? checksumError.message
          : "Failed to compute checksums"
      );
    } finally {
      setComputingChecksums(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) {
      toast.error("Choose a file first");
      return;
    }
    if (uploadMode === "read" && !uploadTargetSampleId) {
      toast.error("Choose a target sample");
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

      toast.success("Upload completed");
      setUploadOpen(false);
      await refreshSummary({ silent: true });
    } catch (uploadError) {
      toast.error(uploadError instanceof Error ? uploadError.message : "Failed to upload file");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  if (session?.user?.isDemo) {
    return (
      <DemoFeatureNotice
        title="Sequencing data is disabled in the public demo"
        description="The hosted demo does not connect to local sequencing storage or browser uploads. This workspace is available in a real facility installation."
      />
    );
  }

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
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setScanDialogOpen(true)} disabled={!canManage}>
                <FolderSearch className="mr-1.5 h-3.5 w-3.5" />
                Scan Storage
              </Button>
              <Button size="sm" variant="outline" onClick={() => refreshSummary({ silent: true })} disabled={refreshing}>
                {refreshing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Refresh
              </Button>
              <Button size="sm" variant="outline" onClick={handleComputeChecksums} disabled={!canManage || computingChecksums}>
                {computingChecksums ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Hash className="mr-2 h-4 w-4" />
                )}
                Compute Hashes
              </Button>
            </div>
          </div>

          {!data.dataBasePathConfigured && (
            <Card className="border-amber-200 bg-amber-50/70">
              <CardHeader>
                <CardTitle className="text-base text-amber-900">Storage Not Configured</CardTitle>
                <CardDescription className="text-amber-800">
                  Configure the sequencing storage path in admin settings before using scans, linked files, or uploads.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {!canManage && (
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
              <div className="col-span-3">Sample</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-3">Reads</div>
              <div className="col-span-2">QC / Reports</div>
              <div className="col-span-1">Updated</div>
              <div className="col-span-1"></div>
            </div>

            <div className="divide-y divide-border">
              {filteredSamples.map((sample) => {
                const statusKey = sample.facilityStatus as FacilitySampleStatus;
                const dotColor = STATUS_DOT_COLORS[statusKey] ?? "bg-slate-400";
                const textColor = STATUS_TEXT_COLORS[statusKey] ?? "text-muted-foreground";
                const statusLabel = FACILITY_SAMPLE_STATUS_LABELS[statusKey] ?? sample.facilityStatus;

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
                          {getReadSummary(sample)} · {getReportSummary(sample)}
                        </p>
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
                    <div className="col-span-3 min-w-0">
                      <p className="font-medium text-sm truncate">{sample.sampleId}</p>
                      {sample.sampleAlias ? (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{sample.sampleAlias}</p>
                      ) : null}
                      {sample.sampleTitle ? (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{sample.sampleTitle}</p>
                      ) : null}
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
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full shrink-0",
                            getSequencingIntegrityIndicatorClassName(sample.integrityStatus)
                          )}
                          aria-hidden="true"
                        />
                        <span className="text-sm truncate">{getReadSummary(sample)}</span>
                      </div>
                      {(sample.read?.file1 || sample.read?.file2) ? (
                        <p className="text-xs text-muted-foreground mt-0.5 ml-4 truncate">
                          {[sample.read?.file1, sample.read?.file2].filter(Boolean).map((f) => (f as string).split("/").pop()).join(", ")}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-0.5 ml-4">No linked files</p>
                      )}
                    </div>

                    {/* QC / Reports */}
                    <div className="col-span-2 min-w-0">
                      <span className="text-sm">{getReportSummary(sample)}</span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {sample.artifactCount > 0
                          ? artifactStageLabel(sample.latestArtifactStage)
                          : "No sample reports yet"}
                      </p>
                    </div>

                    {/* Updated */}
                    <div className="col-span-1">
                      <span className="text-sm text-muted-foreground tabular-nums" title={formatDateTime(sample.updatedAt)}>
                        {formatRelativeTime(sample.updatedAt)}
                      </span>
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
            <CardContent>
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
                      <div className="text-sm font-medium">{getReadSummary(selectedSample)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {getSequencingIntegrityLabel(selectedSample.integrityStatus)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
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
                      const label = index === 0 ? "R1" : "R2";

                      return (
                        <div key={field} className="rounded-xl border bg-card px-4 py-4">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <Badge variant="outline">{label}</Badge>
                            <span
                              className={cn(
                                "h-2.5 w-2.5 rounded-full",
                                filePath
                                  ? getSequencingIntegrityIndicatorClassName(
                                      selectedSample.integrityStatus
                                    )
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
                              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                <span>
                                  Reads: {readCount ?? "Unknown"}
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
                      <div className="text-sm font-medium">{getReportSummary(selectedSample)}</div>
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

      <Dialog open={scanDialogOpen} onOpenChange={setScanDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Scan Storage</DialogTitle>
            <DialogDescription>
              Review suggested FASTQ matches before linking them to samples.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <Button onClick={handleDiscover} disabled={discovering || !canManage}>
              {discovering ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FolderSearch className="mr-2 h-4 w-4" />
              )}
              Scan Storage
            </Button>
            <Button
              variant="outline"
              onClick={applyExactSuggestions}
              disabled={scanResults.length === 0 || !canManage}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Apply Exact Matches
            </Button>
          </div>
          <ScrollArea className="max-h-[420px]">
            <div className="space-y-3 pr-4">
              {scanResults.length === 0 ? (
                <div className="rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground">
                  Run a storage scan to review candidate FASTQ matches.
                </div>
              ) : (
                scanResults.map((result) => (
                  <div key={result.sampleId} className="rounded-xl border p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="font-medium">{result.sampleId}</div>
                        <Badge variant="outline">{result.suggestion.status}</Badge>
                        {result.suggestion.read1 ? (
                          <div className="space-y-1 text-sm text-muted-foreground">
                            <div>R1: {result.suggestion.read1.relativePath}</div>
                            {result.suggestion.read2 ? (
                              <div>R2: {result.suggestion.read2.relativePath}</div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">No direct match suggested.</div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {result.suggestion.read1 ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void applyDiscoverySuggestion(result)}
                            disabled={!canManage}
                          >
                            Use Suggestion
                          </Button>
                        ) : null}
                        {result.suggestion.alternatives.slice(0, 3).map((alternative) => (
                          <Button
                            key={alternative.identifier}
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              void applyDiscoverySuggestion({
                                ...result,
                                suggestion: {
                                  ...result.suggestion,
                                  status: "exact",
                                  read1: alternative.read1,
                                  read2: alternative.read2,
                                },
                              })
                            }
                            disabled={!canManage}
                          >
                            {alternative.identifier}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
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
                  <SelectItem value="read">Raw Reads</SelectItem>
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
              Upload raw reads or internal reports directly into the sequencing storage area.
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
                  <SelectItem value="read">Raw Reads</SelectItem>
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
    </>
  );
}
