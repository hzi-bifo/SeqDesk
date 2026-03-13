"use client";

import { useState, useEffect, useCallback, use, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageContainer } from "@/components/layout/PageContainer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  XCircle,
  FlaskConical,
  Send,
  Clock,
  ExternalLink,
  Copy,
  CheckCircle2,
  BookOpen,
  RotateCcw,
  Download,
  HardDrive,
} from "lucide-react";
import { StudyPipelinesSection } from "@/components/pipelines/StudyPipelinesSection";
import { type FormFieldDefinition, type FormFieldGroup } from "@/types/form-config";

interface Sample {
  id: string;
  sampleId: string;
  sampleAlias: string | null;
  sampleTitle: string | null;
  sampleAccessionNumber: string | null;
  taxId: string | null;
  scientificName: string | null;
  checklistData: string | null;
  customFields: string | null;
  order: {
    id: string;
    orderNumber: string;
    name: string | null;
    status: string;
  } | null;
  reads: { id: string; file1: string | null; file2: string | null }[];
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

interface Study {
  id: string;
  title: string;
  alias: string | null;
  description: string | null;
  checklistType: string | null;
  studyMetadata: string | null;
  readyForSubmission: boolean;
  readyAt: string | null;
  submitted: boolean;
  submittedAt: string | null;
  testRegisteredAt: string | null;
  studyAccessionId: string | null;
  notes: string | null;
  notesEditedAt: string | null;
  notesEditedById: string | null;
  notesEditedBy: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null;
  notesSupported?: boolean;
  createdAt: string;
  samples: Sample[];
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
  };
}

const DEFAULT_STUDY_GROUPS: FormFieldGroup[] = [
  { id: "group_study_info", name: "Study Information", order: 0 },
  { id: "group_metadata", name: "Metadata", order: 1 },
];

interface StudyFormSchemaResponse {
  fields?: FormFieldDefinition[];
  studyFields?: FormFieldDefinition[];
  groups?: FormFieldGroup[];
}

// Helper to check if sample has metadata
function sampleHasMetadata(sample: Sample): boolean {
  if (!sample.taxId || sample.taxId.trim() === "") {
    return false;
  }

  // Check core sample fields (from order form's per-sample fields)
  const hasCoreSampleData =
    (sample.taxId && sample.taxId.trim() !== "") ||
    (sample.scientificName && sample.scientificName.trim() !== "") ||
    (sample.sampleTitle && sample.sampleTitle.trim() !== "") ||
    (sample.sampleAlias && sample.sampleAlias.trim() !== "");

  if (hasCoreSampleData) return true;

  // Check customFields (per-sample custom fields from order form)
  if (sample.customFields) {
    try {
      const customData = typeof sample.customFields === "string"
        ? JSON.parse(sample.customFields)
        : sample.customFields;
      const hasCustomData = Object.values(customData).some(
        v => v !== null && v !== "" && v !== undefined
      );
      if (hasCustomData) return true;
    } catch {
      // ignore parse errors
    }
  }

  // Check MIxS checklistData
  if (sample.checklistData) {
    try {
      const data = typeof sample.checklistData === "string"
        ? JSON.parse(sample.checklistData)
        : sample.checklistData;
      return Object.values(data).some(v => v !== null && v !== "" && v !== undefined);
    } catch {
      return false;
    }
  }

  return false;
}

// Calculate expiration status for test submissions (24h expiry)
function getTestExpirationStatus(registeredAt: string | null): { expired: boolean; text: string } | null {
  if (!registeredAt) return null;

  const registered = new Date(registeredAt);
  const expiresAt = new Date(registered.getTime() + 24 * 60 * 60 * 1000);
  const now = new Date();
  const msRemaining = expiresAt.getTime() - now.getTime();
  const hoursRemaining = Math.floor(msRemaining / (60 * 60 * 1000));

  if (msRemaining <= 0) {
    return { expired: true, text: "Expired" };
  } else if (hoursRemaining < 1) {
    const minutesRemaining = Math.floor(msRemaining / (60 * 1000));
    return { expired: false, text: `expires in ${minutesRemaining}m` };
  } else {
    return { expired: false, text: `expires in ${hoursRemaining}h` };
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore parse errors and use empty object fallback.
  }
  return {};
}

function hasDisplayValue(value: unknown): boolean {
  return !(
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function getFieldLabel(key: string): string {
  const labels: Record<string, string> = {
    _mixsChecklist: "MIxS Checklist",
    _mixsFields: "Selected MIxS Fields",
  };
  return labels[key] || key.replace(/_/g, " ");
}

function formatSchemaFieldValue(field: FormFieldDefinition, value: unknown): string {
  if (!hasDisplayValue(value)) return "Not specified";

  if (field.type === "select" && field.options) {
    const option = field.options.find((o) => o.value === value);
    return option?.label || String(value);
  }

  if (field.type === "multiselect" && Array.isArray(value) && field.options) {
    return value
      .map((v) => field.options?.find((o) => o.value === v)?.label || String(v))
      .join(", ");
  }

  if (field.type === "checkbox") {
    return value === true ? "Yes" : "No";
  }

  if (field.type === "funding") {
    const fundingValue = value as {
      entries?: Array<{
        agencyId: string;
        agencyOther?: string;
        grantNumber: string;
        isPrimary?: boolean;
      }>;
    };
    if (!fundingValue?.entries || fundingValue.entries.length === 0) {
      return "No funding sources";
    }
    return fundingValue.entries
      .map((entry) => {
        const agencyName = entry.agencyId === "other"
          ? (entry.agencyOther || "Other")
          : entry.agencyId.toUpperCase();
        return `${agencyName}: ${entry.grantNumber}${entry.isPrimary ? " (Primary)" : ""}`;
      })
      .join("; ");
  }

  if (field.type === "billing") {
    const billingValue = value as { costCenter?: string; pspElement?: string } | null;
    if (!billingValue) return "Not specified";
    const parts: string[] = [];
    if (billingValue.costCenter) parts.push(`Cost Center: ${billingValue.costCenter}`);
    if (billingValue.pspElement) parts.push(`PSP: ${billingValue.pspElement}`);
    return parts.length > 0 ? parts.join(", ") : "Not specified";
  }

  if (field.type === "sequencing-tech" && typeof value === "object" && value !== null) {
    const selection = value as {
      technologyId?: string;
      technologyName?: string;
      deviceId?: string;
      deviceName?: string;
      flowCellId?: string;
      flowCellSku?: string;
      kitId?: string;
      kitSku?: string;
    };
    const parts: string[] = [];
    const platform = selection.technologyName || selection.technologyId;
    const device = selection.deviceName || selection.deviceId;
    const flowCell = selection.flowCellSku || selection.flowCellId;
    const kit = selection.kitSku || selection.kitId;
    if (platform) parts.push(`Platform: ${platform}`);
    if (device) parts.push(`Device: ${device}`);
    if (flowCell) parts.push(`Flow Cell: ${flowCell}`);
    if (kit) parts.push(`Kit: ${kit}`);
    return parts.length > 0 ? parts.join(" | ") : "Not selected";
  }

  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }

  return String(value);
}

function formatUnknownFieldValue(value: unknown): string {
  if (!hasDisplayValue(value)) return "Not specified";
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

function normalizeStudyTab(tab: string | null): "overview" | "samples" | "reads" | "pipelines" | "ena" {
  switch (tab) {
    case "samples":
    case "reads":
    case "pipelines":
    case "ena":
      return tab;
    default:
      return "overview";
  }
}

export default function StudyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const [study, setStudy] = useState<Study | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [markingReady, setMarkingReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [studyFormFields, setStudyFormFields] = useState<FormFieldDefinition[]>([]);
  const [studyFormGroups, setStudyFormGroups] = useState<FormFieldGroup[]>(DEFAULT_STUDY_GROUPS);

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [markReadyDialogOpen, setMarkReadyDialogOpen] = useState(false);
  const [unmarkReadyDialogOpen, setUnmarkReadyDialogOpen] = useState(false);
  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);
  const [registerSteps, setRegisterSteps] = useState<Array<{
    step: number;
    name: string;
    status: "pending" | "running" | "completed" | "error";
    details?: string;
  }>>([]);
  const [registerResult, setRegisterResult] = useState<{
    success: boolean;
    accession?: string | null;
    error?: string;
    isTest?: boolean;
    isPartial?: boolean;
    samplesError?: string;
    rawResponse?: unknown;
  } | null>(null);
  const [generatedXml, setGeneratedXml] = useState<{
    studyXml?: string;
    sampleXml?: string;
    submissionXml?: string;
  } | null>(null);

  // Check if current user is the owner of this study
  const isOwner = session?.user?.id === study?.user?.id;
  const isAdmin = session?.user?.role === "FACILITY_ADMIN";
  const isDemoUser = session?.user?.isDemo === true;
  const apiStudyId = study?.id ?? id;
  const currentTab = normalizeStudyTab(searchParams.get("tab"));

  const safeJsonParse = (value: unknown) => {
    if (!value) return null;
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const fetchStudy = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotFound(false);
    try {
      const res = await fetch(`/api/studies/${id}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 404) {
          setNotFound(true);
          setStudy(null);
          return;
        }
        if (res.status === 403) {
          setError(typeof data.error === "string" ? data.error : "You don't have permission to view this study");
          setStudy(null);
          return;
        }
        throw new Error(typeof data.error === "string" ? data.error : "Failed to fetch study");
      }

      setStudy(data);
      if (typeof data?.id === "string" && data.id !== id) {
        router.replace(`/studies/${data.id}`);
      }
    } catch (err) {
      setStudy(null);
      setError(err instanceof Error ? err.message : "Failed to load study");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    void fetchStudy();
  }, [fetchStudy]);

  useEffect(() => {
    fetch("/api/study-form-schema")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: StudyFormSchemaResponse | null) => {
        const schemaStudyFields = (data?.studyFields ?? data?.fields ?? [])
          .filter((field) => !field.perSample && field.name !== "_sample_association" && field.visible);
        const groups = (data?.groups && data.groups.length > 0 ? data.groups : DEFAULT_STUDY_GROUPS)
          .slice()
          .sort((a, b) => a.order - b.order);
        setStudyFormFields(schemaStudyFields);
        setStudyFormGroups(groups);
      })
      .catch(() => {
        setStudyFormFields([]);
        setStudyFormGroups(DEFAULT_STUDY_GROUPS);
      });
  }, []);

  const handleDeleteStudy = async () => {
    if (!study) return;
    if (study.submitted) {
      setError("Cannot delete a submitted study");
      return;
    }

    setDeleting(true);
    setDeleteDialogOpen(false);
    try {
      const res = await fetch(`/api/studies/${apiStudyId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to delete study");
        return;
      }

      router.push("/studies");
    } catch {
      setError("Failed to delete study");
    } finally {
      setDeleting(false);
    }
  };

  const handleMarkAsReady = async () => {
    if (!study) return;

    setMarkingReady(true);
    setMarkReadyDialogOpen(false);
    setError("");
    try {
      const res = await fetch(`/api/studies/${apiStudyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readyForSubmission: true }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to update study");
        return;
      }

      // Refresh study data
      const updated = await res.json();
      setStudy(updated);
    } catch {
      setError("Failed to update study");
    } finally {
      setMarkingReady(false);
    }
  };

  const handleUnmarkReady = async () => {
    if (!study) return;

    setMarkingReady(true);
    setUnmarkReadyDialogOpen(false);
    setError("");
    try {
      const res = await fetch(`/api/studies/${apiStudyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readyForSubmission: false }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to update study");
        return;
      }

      const updated = await res.json();
      setStudy(updated);
    } catch {
      setError("Failed to update study");
    } finally {
      setMarkingReady(false);
    }
  };

  const handleRegisterWithENA = async (isTest: boolean) => {
    if (!study) return;

    setRegisterSteps([
      { step: 1, name: "Submitting to ENA", status: "running" as const },
    ]);
    setRegisterResult(null);
    setGeneratedXml(null);
    setRegisterDialogOpen(true);
    setSubmitting(true);
    setError("");
    setSubmitSuccess("");

    try {
      const res = await fetch("/api/admin/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "study",
          entityId: study.id,
          isTest,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!data) {
        const message = "Failed to read ENA submission response";
        setRegisterSteps([
          { step: 1, name: "Submission failed", status: "error", details: message },
        ]);
        setRegisterResult({ success: false, error: message, isTest });
        return;
      }

      if (!res.ok) {
        const message = data?.error || "Failed to create submission";
        setRegisterSteps([
          { step: 1, name: "Submission failed", status: "error", details: message },
        ]);
        setRegisterResult({ success: false, error: message, isTest });
        return;
      }

      const response = safeJsonParse(data?.submission?.response);
      const accessions = safeJsonParse(data?.submission?.accessionNumbers);
      const submissionStatus = data?.submission?.status;

      if (response?.steps && Array.isArray(response.steps)) {
        const mappedSteps = response.steps.map((step: {
          step?: number;
          name?: string;
          status?: string;
        }, index: number) => ({
          step: step.step ?? index + 1,
          name: step.name || `Step ${index + 1}`,
          status: step.status === "error"
            ? "error"
            : step.status === "completed"
              ? "completed"
              : "pending",
        }));
        setRegisterSteps(mappedSteps);
      } else {
        setRegisterSteps([{ step: 1, name: "Submission complete", status: "completed" }]);
      }

      // Extract generated XML from the steps for debugging
      const step2 = response?.steps?.find((s: { step: number }) => s.step === 2);
      if (step2?.details) {
        setGeneratedXml({
          studyXml: step2.details.studyXml,
          sampleXml: step2.details.sampleXml,
          submissionXml: step2.details.submissionXml,
        });
      }

      // Get study accession (filter out null/empty)
      const studyAccession = accessions?.study || response?.receipt?.studyAccession || null;

      // Determine if this is a full success or partial
      const isFullSuccess = submissionStatus === "ACCEPTED";
      const isPartialSuccess = submissionStatus === "PARTIAL";
      const samplesError = response?.samplesError;

      // Set result
      setRegisterResult({
        success: isFullSuccess,
        accession: studyAccession,
        isTest,
        isPartial: isPartialSuccess,
        samplesError: samplesError,
        rawResponse: response,
      });

      if (isFullSuccess) {
        setSubmitSuccess(response?.message || data.message || "Registration successful!");
      } else {
        setSubmitSuccess("");
      }

      // Refresh study data after a short delay
      setTimeout(fetchStudy, 500);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create submission";
      setRegisterSteps([
        { step: 1, name: "Submission failed", status: "error", details: message },
      ]);
      setRegisterResult({ success: false, error: message, isTest });
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const parsedStudyMetadata = useMemo(
    () => parseJsonObject(study?.studyMetadata),
    [study?.studyMetadata]
  );

  const visibleStudyFields = useMemo(
    () => studyFormFields
      .filter((field) => isAdmin || !field.adminOnly)
      .slice()
      .sort((a, b) => a.order - b.order),
    [studyFormFields, isAdmin]
  );

  const knownStudyFieldNames = useMemo(
    () => new Set(studyFormFields.map((field) => field.name)),
    [studyFormFields]
  );

  const groupedStudyMetadataSections = useMemo(
    () => studyFormGroups
      .slice()
      .sort((a, b) => a.order - b.order)
      .flatMap((group) => {
        const rows = visibleStudyFields
          .filter((field) => field.groupId === group.id)
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((field) => ({ field, value: parsedStudyMetadata[field.name] }))
          .filter(({ value }) => hasDisplayValue(value));
        return rows.length > 0 ? [{ id: group.id, title: group.name, rows }] : [];
      }),
    [studyFormGroups, visibleStudyFields, parsedStudyMetadata]
  );

  const ungroupedStudyMetadataRows = useMemo(
    () => visibleStudyFields
      .filter((field) => !field.groupId)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((field) => ({ field, value: parsedStudyMetadata[field.name] }))
      .filter(({ value }) => hasDisplayValue(value)),
    [visibleStudyFields, parsedStudyMetadata]
  );

  const fallbackStudyMetadataRows = useMemo(
    () => {
      if (!isAdmin) return [];
      return Object.entries(parsedStudyMetadata).filter(
        ([key, value]) =>
          !key.startsWith("_mixs") &&
          !knownStudyFieldNames.has(key) &&
          hasDisplayValue(value)
      );
    },
    [parsedStudyMetadata, knownStudyFieldNames, isAdmin]
  );

  if (loading) {
    return (
      <PageContainer className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </PageContainer>
    );
  }

  if (!study) {
    const title = notFound ? "Study Not Found" : "Error";
    const message = notFound
      ? "The requested study could not be found."
      : (error || "Failed to load study");

    return (
      <PageContainer>
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h2 className="text-xl font-semibold mb-2">{title}</h2>
          <p className="text-sm text-muted-foreground mb-4">{message}</p>
          <Button asChild variant="outline">
            <Link href="/studies">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Studies
            </Link>
          </Button>
        </div>
      </PageContainer>
    );
  }

  // Calculate metadata completion
  const samplesWithMetadata = study.samples.filter(sampleHasMetadata).length;
  const totalSamples = study.samples.length;
  const allMetadataComplete = totalSamples > 0 && samplesWithMetadata === totalSamples;
  const metadataCompletionPercent = totalSamples > 0
    ? Math.round((samplesWithMetadata / totalSamples) * 100)
    : 0;
  const ownerDisplayName = study.user.firstName && study.user.lastName
    ? `${study.user.firstName} ${study.user.lastName}`
    : study.user.email;
  const samplesWithFiles = study.samples.filter(s => s.reads?.some(r => r.file1 || r.file2)).length;
  return (
    <>
      <Tabs value={currentTab} onValueChange={(tab) => {
        const url = tab === "overview" ? `/studies/${id}` : `/studies/${id}?tab=${tab}`;
        router.replace(url, { scroll: false });
      }}>

      <PageContainer>
      {/* Page title + actions */}
      <div className="flex items-center justify-between mb-6">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold truncate">{study.title}</h1>
          <p className="text-sm text-muted-foreground">
            {study.submitted ? "Registered" : study.readyForSubmission ? "Ready for submission" : "Draft"}
            {study.studyAccessionId && ` \u00B7 ${study.studyAccessionId}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {(isOwner || isAdmin) && !study.submitted && study.readyForSubmission && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUnmarkReadyDialogOpen(true)}
              disabled={markingReady}
            >
              {markingReady ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Back to Draft
            </Button>
          )}
          {isOwner && !study.submitted && !study.readyForSubmission && allMetadataComplete && (
            <Button
              size="sm"
              onClick={() => setMarkReadyDialogOpen(true)}
              disabled={markingReady}
            >
              {markingReady ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : null}
              Mark as Ready
            </Button>
          )}
        </div>
      </div>
      {error && (
        <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {submitSuccess && (
        <div className="mb-6 p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5" />
          {submitSuccess}
        </div>
      )}

        {/* Overview Tab */}
        <TabsContent value="overview">
          {/* Study Process */}
          {!study.submitted && (() => {
            const hasSamples = totalSamples > 0;
            const metadataStepStatus = !hasSamples
              ? "Blocked"
              : allMetadataComplete
                ? "Done"
                : "In Progress";
            return (
              <div className="mb-4 rounded-lg border bg-card p-5">
                <h3 className="mb-4 text-base font-semibold">Study Process</h3>
                <div className="space-y-3">
                  {/* Step 1: Study Created */}
                  <div className="rounded-lg border bg-background p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-foreground bg-foreground text-xs font-semibold text-background">
                          1
                        </span>
                        <span className="text-sm font-medium">Create Study</span>
                      </div>
                      <span className="text-xs text-muted-foreground">Done</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Study created and available for sample assignment.
                    </p>
                  </div>

                  {/* Step 2: Add Samples */}
                  <div className="rounded-lg border bg-background p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${hasSamples
                            ? "border-foreground bg-foreground text-background"
                            : "border-muted-foreground/40 text-muted-foreground"
                          }`}
                        >
                          2
                        </span>
                        <span className="text-sm font-medium">Add Samples</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{hasSamples ? "Done" : "Pending"}</span>
                    </div>
                    {hasSamples ? (
                      <p className="text-xs text-muted-foreground">
                        {totalSamples} sample{totalSamples !== 1 ? "s" : ""} linked to this study.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                          No samples are linked yet.
                        </p>
                        {isOwner && (
                          <Link
                            href={`/studies/${id}/edit`}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            Add samples
                          </Link>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Step 3: Complete Metadata */}
                  <div className="rounded-lg border bg-background p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${hasSamples
                            ? "border-foreground bg-foreground text-background"
                            : "border-muted-foreground/40 text-muted-foreground"
                          }`}
                        >
                          3
                        </span>
                        <span className="text-sm font-medium">Complete Metadata</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{metadataStepStatus}</span>
                    </div>
                    {!hasSamples ? (
                      <p className="text-xs text-muted-foreground">Add samples first to unlock metadata completion.</p>
                    ) : allMetadataComplete ? (
                      <p className="text-xs text-muted-foreground">
                        Metadata complete for all {totalSamples} sample{totalSamples !== 1 ? "s" : ""}.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                          {samplesWithMetadata}/{totalSamples} sample{totalSamples !== 1 ? "s" : ""} complete.
                        </p>
                        {isOwner && (
                          <Link
                            href={`/studies/${id}/edit`}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            Edit metadata
                          </Link>
                        )}
                      </div>
                    )}
                  </div>

                </div>
              </div>
            );
          })()}

          {/* Submitted Study Status */}
          {study.submitted && (
            <div className="rounded-lg border p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <div>
                  <p className="font-medium">Registered with ENA</p>
                  <p className="text-sm text-muted-foreground">
                    {study.studyAccessionId && <span className="font-mono">{study.studyAccessionId}</span>}
                    {study.submittedAt && <span className="ml-2">{formatDate(study.submittedAt)}</span>}
                  </p>
                </div>
              </div>
              {study.studyAccessionId && (
                <a
                  href="https://www.ebi.ac.uk/ena/submit/webin/report/studies"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline flex items-center gap-1"
                >
                  View in Webin Portal
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          {/* Ready / Awaiting facility status */}
          {!study.submitted && study.readyForSubmission && !study.studyAccessionId && !study.testRegisteredAt && (
            <div className="rounded-lg border p-4 flex items-center gap-3">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">Awaiting Facility Review</p>
                <p className="text-sm text-muted-foreground">
                  This study is marked as ready. The sequencing facility will review and submit to ENA.
                </p>
              </div>
            </div>
          )}

          {/* Status History */}
          <div className="bg-card rounded-lg border overflow-hidden mt-4">
            <div className="px-5 py-4">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Status History
              </h2>
            </div>
            <div className="divide-y divide-border border-t">
              {/* Created */}
              <div className="flex items-start gap-3 px-5 py-3">
                <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <BookOpen className="h-3.5 w-3.5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">Study Created</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(study.createdAt)}
                  </p>
                </div>
              </div>

              {/* Marked as Ready */}
              {study.readyAt && (
                <div className="flex items-start gap-3 px-5 py-3">
                  <div className="h-7 w-7 rounded-md bg-secondary flex items-center justify-center flex-shrink-0">
                    <Send className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Marked as Ready</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(study.readyAt)}
                    </p>
                  </div>
                </div>
              )}

              {/* Submitted to ENA */}
              {study.submittedAt && (
                <div className="flex items-start gap-3 px-5 py-3">
                  <div className="h-7 w-7 rounded-md bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Submitted to ENA</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(study.submittedAt)}
                      {study.studyAccessionId && (
                        <span className="ml-2 font-mono text-xs bg-muted px-2 py-0.5 rounded">
                          {study.studyAccessionId}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Study summary */}
          <div className="mt-4 rounded-lg border bg-card overflow-hidden">
            <div className="px-5 py-4">
              <h2 className="text-sm font-semibold">Study Snapshot</h2>
            </div>
            <div className="border-t">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="px-5 py-3 text-muted-foreground">Samples</td>
                    <td className="px-5 py-3 text-right font-medium">{totalSamples}</td>
                  </tr>
                  <tr>
                    <td className="px-5 py-3 text-muted-foreground">Metadata</td>
                    <td className="px-5 py-3 text-right font-medium">
                      {samplesWithMetadata} / {totalSamples}
                      <span className="ml-2 text-xs text-muted-foreground">({metadataCompletionPercent}%)</span>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-5 py-3 text-muted-foreground">Owner</td>
                    <td className="px-5 py-3 text-right font-medium">{ownerDisplayName}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-card rounded-lg border overflow-hidden mt-4">
            <div className="px-5 py-4">
              <h2 className="text-sm font-semibold">Filled Study Information</h2>
            </div>
            <div className="divide-y divide-border border-t">
              <div className="flex justify-between items-start px-5 py-3 text-sm">
                <span className="text-muted-foreground">Study Title</span>
                <span className="font-medium text-right max-w-[60%] break-words">
                  {study.title}
                </span>
              </div>
              {hasDisplayValue(study.description) && (
                <div className="flex justify-between items-start px-5 py-3 text-sm">
                  <span className="text-muted-foreground">Description</span>
                  <span className="font-medium text-right max-w-[60%] break-words">
                    {study.description}
                  </span>
                </div>
              )}
              {hasDisplayValue(study.alias) && (
                <div className="flex justify-between items-start px-5 py-3 text-sm">
                  <span className="text-muted-foreground">Alias</span>
                  <span className="font-medium text-right max-w-[60%] break-words">
                    {study.alias}
                  </span>
                </div>
              )}
              {hasDisplayValue(study.checklistType) && (
                <div className="flex justify-between items-start px-5 py-3 text-sm">
                  <span className="text-muted-foreground">Environment Type</span>
                  <span className="font-medium text-right max-w-[60%] break-words">
                    {study.checklistType}
                  </span>
                </div>
              )}
            </div>
          </div>

          {groupedStudyMetadataSections.map((section) => (
            <div key={section.id} className="bg-card rounded-lg border overflow-hidden mt-4">
              <div className="px-5 py-4">
                <h2 className="text-sm font-semibold">{section.title}</h2>
              </div>
              <div className="divide-y divide-border border-t">
                {section.rows.map(({ field, value }) => (
                  <div key={field.id} className="flex justify-between items-start px-5 py-3 text-sm">
                    <span className="text-muted-foreground">{field.label}</span>
                    <span className="font-medium text-right max-w-[60%] break-words">
                      {formatSchemaFieldValue(field, value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {ungroupedStudyMetadataRows.length > 0 && (
            <div className="bg-card rounded-lg border overflow-hidden mt-4">
              <div className="px-5 py-4">
                <h2 className="text-sm font-semibold">Additional Details</h2>
              </div>
              <div className="divide-y divide-border border-t">
                {ungroupedStudyMetadataRows.map(({ field, value }) => (
                  <div key={field.id} className="flex justify-between items-start px-5 py-3 text-sm">
                    <span className="text-muted-foreground">{field.label}</span>
                    <span className="font-medium text-right max-w-[60%] break-words">
                      {formatSchemaFieldValue(field, value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {fallbackStudyMetadataRows.length > 0 && (
            <div className="bg-card rounded-lg border overflow-hidden mt-4">
              <div className="px-5 py-4">
                <h2 className="text-sm font-semibold">Additional Information</h2>
              </div>
              <div className="divide-y divide-border border-t">
                {fallbackStudyMetadataRows.map(([key, value]) => (
                  <div key={key} className="flex justify-between items-start px-5 py-3 text-sm">
                    <span className="text-muted-foreground capitalize">{getFieldLabel(key)}</span>
                    <span className="font-medium text-right max-w-[60%] break-words">
                      {formatUnknownFieldValue(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(isAdmin || (!study.submitted && !study.readyForSubmission)) && (
            <div className="bg-card rounded-lg border overflow-hidden mt-4">
              <div className="px-5 py-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Study Information</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Update the study details, samples, or metadata fields.
                  </p>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/studies/${id}/edit`}>
                    Change Study Information
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Samples Tab */}
        <TabsContent value="samples">
          <div className="bg-card rounded-lg border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <FlaskConical className="h-4 w-4" />
                Samples ({study.samples.length})
              </h2>
              {!study.submitted && isOwner && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/studies/${id}/edit`}>
                    Manage Samples
                  </Link>
                </Button>
              )}
            </div>

            {study.samples.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border-t">
                <FlaskConical className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>No samples in this study yet</p>
                {!study.submitted && isOwner && (
                  <Button className="mt-4" size="sm" asChild>
                    <Link href={`/studies/${id}/edit`}>
                      Add Samples
                    </Link>
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border border-t">
                {study.samples.map((sample) => {
                  const hasMetadata = sampleHasMetadata(sample);
                  return (
                    <div
                      key={sample.id}
                      className="flex items-center justify-between px-5 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`h-7 w-7 rounded-md flex items-center justify-center ${
                          hasMetadata ? "bg-green-500/10" : "bg-muted"
                        }`}>
                          <FlaskConical className={`h-3.5 w-3.5 ${
                            hasMetadata ? "text-green-600" : "text-muted-foreground"
                          }`} />
                        </div>
                        <div>
                          <div className="font-medium text-sm flex items-center gap-2">
                            {sample.sampleId}
                            {hasMetadata && (
                              <CheckCircle2 className="h-3 w-3 text-green-500" />
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {sample.order ? (
                              <>
                                <Link
                                  href={`/orders/${sample.order.id}`}
                                  className="hover:text-primary"
                                >
                                  {sample.order.orderNumber}
                                </Link>
                                {sample.order.name && (
                                  <span> - {sample.order.name}</span>
                                )}
                              </>
                            ) : (
                              <span>Order unavailable</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Read Files Tab */}
        {!isDemoUser && (
        <TabsContent value="reads">
          <div className="bg-card rounded-lg border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                Samples ({totalSamples})
              </h2>
            </div>

            {study.samples.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border-t">
                <FlaskConical className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>No samples in this study yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border border-t">
                {study.samples.map((sample) => {
                  const hasFiles = sample.reads?.some(r => r.file1 || r.file2);
                  return (
                    <div key={sample.id} className="px-5 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`h-7 w-7 rounded-md flex items-center justify-center ${
                            hasFiles ? "bg-green-500/10" : "bg-muted"
                          }`}>
                            <FlaskConical className={`h-3.5 w-3.5 ${
                              hasFiles ? "text-green-600" : "text-muted-foreground"
                            }`} />
                          </div>
                          <div>
                            <div className="text-sm font-medium flex items-center gap-2">
                              {sample.sampleId}
                              {sample.sampleTitle && (
                                <span className="text-muted-foreground font-normal">- {sample.sampleTitle}</span>
                              )}
                              {hasFiles && (
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {sample.order ? (
                                <>
                                  <Link
                                    href={`/orders/${sample.order.id}`}
                                    className="hover:text-primary"
                                  >
                                    {sample.order.orderNumber}
                                  </Link>
                                  {sample.order.name && (
                                    <span> - {sample.order.name}</span>
                                  )}
                                </>
                              ) : (
                                <span>Order unavailable</span>
                              )}
                            </div>
                          </div>
                        </div>
                        {!hasFiles && (
                          <span className="text-xs text-muted-foreground">No files</span>
                        )}
                      </div>

                      {/* File details */}
                      {hasFiles && (
                        <div className="ml-10 mt-2 space-y-1">
                          {(sample.reads ?? []).filter(r => r.file1 || r.file2).map((read) => (
                            <div key={read.id} className="space-y-1">
                              {read.file1 && (
                                <div className="flex items-center gap-2 text-sm">
                                  <Badge variant="outline" className="border-blue-300 text-blue-700 text-xs">R1</Badge>
                                  <span className="truncate text-muted-foreground text-xs">{read.file1.split("/").pop()}</span>
                                  <a
                                    href={`/api/files/download?path=${encodeURIComponent(read.file1)}`}
                                    className="ml-auto text-primary hover:text-primary/80 flex items-center gap-1 shrink-0 text-xs"
                                  >
                                    <Download className="h-3 w-3" />
                                    Download
                                  </a>
                                </div>
                              )}
                              {read.file2 && (
                                <div className="flex items-center gap-2 text-sm">
                                  <Badge variant="outline" className="border-purple-300 text-purple-700 text-xs">R2</Badge>
                                  <span className="truncate text-muted-foreground text-xs">{read.file2.split("/").pop()}</span>
                                  <a
                                    href={`/api/files/download?path=${encodeURIComponent(read.file2)}`}
                                    className="ml-auto text-primary hover:text-primary/80 flex items-center gap-1 shrink-0 text-xs"
                                  >
                                    <Download className="h-3 w-3" />
                                    Download
                                  </a>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>
        )}

        {/* Pipelines Tab - admin only */}
        {isAdmin && totalSamples > 0 && (
          <TabsContent value="pipelines">
            <StudyPipelinesSection studyId={study.id} samples={study.samples} />
          </TabsContent>
        )}

        {/* ENA Tab */}
        {!isDemoUser && (
        <TabsContent value="ena">
          {/* ENA Submission Readiness - Admin View */}
          {isAdmin && !study.submitted && (() => {
            const requiredChecks = {
              hasTitle: Boolean(study.title && study.title.trim()),
              hasDescription: Boolean(study.description && study.description.trim()),
              hasSamples: totalSamples > 0,
              allSamplesHaveOrganism: study.samples.every(s =>
                s.taxId && s.taxId.trim()
              ),
              allSamplesHaveMetadata: allMetadataComplete,
            };
            const passedChecks = Object.values(requiredChecks).filter(Boolean).length;
            const totalChecks = Object.keys(requiredChecks).length;
            const allPassed = passedChecks === totalChecks;
            const hasTestRegistration = Boolean(study.testRegisteredAt);

            return (
              <div className="bg-card rounded-lg border p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="font-semibold flex items-center gap-2">
                      ENA Registration
                      <span className="text-sm font-normal text-muted-foreground">
                        ({passedChecks}/{totalChecks} checks)
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {study.readyForSubmission ? "User marked ready" : "User has not marked as ready"}
                    </p>
                  </div>
                  {allPassed && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRegisterWithENA(true)}
                        disabled={submitting}
                      >
                        {submitting ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4 mr-2" />
                        )}
                        Test Server
                      </Button>
                      {study.readyForSubmission && (
                        <Button
                          size="sm"
                          onClick={() => handleRegisterWithENA(false)}
                          disabled={submitting}
                        >
                          {submitting ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4 mr-2" />
                          )}
                          Production
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {/* Test Registration Status */}
                {hasTestRegistration && (() => {
                  const expiration = getTestExpirationStatus(study.testRegisteredAt);
                  const isExpired = expiration?.expired ?? false;
                  return (
                    <div className={`mb-4 p-3 rounded border flex items-center justify-between ${
                      isExpired
                        ? "border-stone-300 bg-stone-100"
                        : "border-amber-200 bg-amber-50"
                    }`}>
                      <div className="flex items-center gap-2 text-sm">
                        <AlertCircle className={`h-4 w-4 ${isExpired ? "text-stone-500" : "text-amber-600"}`} />
                        <span className={isExpired ? "text-stone-600" : "text-amber-800"}>
                          Test: <span className={`font-mono ${isExpired ? "line-through" : ""}`}>{study.studyAccessionId}</span>
                          <span className={`ml-2 ${isExpired ? "text-stone-500" : "text-amber-600"}`}>
                            ({expiration?.text ?? "expires 24h"})
                          </span>
                        </span>
                      </div>
                      {!isExpired && (
                        <a
                          href="https://wwwdev.ebi.ac.uk/ena/submit/webin/report/studies"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-amber-700 hover:underline flex items-center gap-1"
                        >
                          View <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  );
                })()}

                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    {requiredChecks.hasTitle ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span>Title</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {requiredChecks.hasDescription ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span>Description</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {requiredChecks.hasSamples ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span>Samples ({totalSamples})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {requiredChecks.allSamplesHaveOrganism ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span>Taxonomy ID</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {requiredChecks.allSamplesHaveMetadata ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span>Metadata</span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t text-sm text-muted-foreground">
                  Created by: {study.user.firstName && study.user.lastName
                    ? `${study.user.firstName} ${study.user.lastName}`
                    : study.user.email}
                </div>
              </div>
            );
          })()}

        </TabsContent>
        )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Study</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this study? Samples will be unassigned but not deleted. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteStudy} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Delete Study
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark as Ready Confirmation Dialog */}
      <Dialog open={markReadyDialogOpen} onOpenChange={setMarkReadyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Study as Ready</DialogTitle>
            <DialogDescription>
              Mark this study as ready for ENA submission? The sequencing facility will be notified and can proceed with the submission process.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkReadyDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleMarkAsReady} disabled={markingReady}>
              {markingReady ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Mark as Ready
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Back to Draft Confirmation Dialog */}
      <Dialog open={unmarkReadyDialogOpen} onOpenChange={setUnmarkReadyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return to Draft</DialogTitle>
            <DialogDescription>
              Mark this study back as a draft? You can continue editing it and mark it as ready again when complete.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnmarkReadyDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUnmarkReady} disabled={markingReady}>
              {markingReady ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
              Back to Draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ENA Registration Progress Dialog */}
      <Dialog open={registerDialogOpen} onOpenChange={(open) => {
        if (!submitting) setRegisterDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              ENA Registration
            </DialogTitle>
            <DialogDescription>
              {registerResult
                ? registerResult.success
                  ? "Registration completed successfully!"
                  : "Registration failed"
                : "Registering study with ENA..."}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="space-y-2">
              {registerSteps.map((step) => (
                <div
                  key={step.step}
                  className="flex items-center gap-3 p-2 rounded border"
                >
                  <div className="flex-shrink-0">
                    {step.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : step.status === "running" ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : step.status === "error" ? (
                      <XCircle className="h-4 w-4 text-red-500" />
                    ) : (
                      <div className="h-4 w-4 rounded-full bg-stone-300 flex items-center justify-center">
                        <span className="text-[10px] text-white font-bold">{step.step}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{step.name}</p>
                    {step.details && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {step.details}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Generated XML - for debugging */}
            {generatedXml && (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Generated XML:</p>

                {generatedXml.sampleXml && (
                  <div className="border rounded p-2 bg-muted/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">Sample XML</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(generatedXml.sampleXml || "");
                        }}
                        className="text-xs bg-stone-200 text-stone-600 px-2 py-0.5 rounded hover:bg-stone-300 flex items-center gap-1"
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                    </div>
                    <div className="max-h-32 overflow-y-auto bg-white rounded p-2 border text-xs font-mono whitespace-pre-wrap break-all">
                      {generatedXml.sampleXml}
                    </div>
                  </div>
                )}

                {generatedXml.studyXml && (
                  <div className="border rounded p-2 bg-muted/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">Study XML</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(generatedXml.studyXml || "");
                        }}
                        className="text-xs bg-stone-200 text-stone-600 px-2 py-0.5 rounded hover:bg-stone-300 flex items-center gap-1"
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                    </div>
                    <div className="max-h-24 overflow-y-auto bg-white rounded p-2 border text-xs font-mono whitespace-pre-wrap break-all">
                      {generatedXml.studyXml}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Result */}
            {registerResult && (
              <div className={`mt-4 p-4 rounded-lg border ${
                registerResult.success
                  ? "bg-green-50 border-green-200"
                  : registerResult.isPartial
                    ? "bg-amber-50 border-amber-200"
                    : "bg-red-50 border-red-200"
              }`}>
                <div className="text-center">
                  {registerResult.success ? (
                    <>
                      <CheckCircle2 className="h-6 w-6 text-green-600 mx-auto mb-2" />
                      <p className="font-medium">Registration Successful</p>
                      {registerResult.accession && (
                        <p className="text-sm text-muted-foreground mt-1 font-mono">
                          {registerResult.accession}
                        </p>
                      )}
                      {registerResult.isTest && (
                        <p className="text-xs text-amber-600 mt-2">Test server - expires in 24h</p>
                      )}
                    </>
                  ) : registerResult.isPartial ? (
                    <>
                      <AlertCircle className="h-6 w-6 text-amber-600 mx-auto mb-2" />
                      <p className="font-medium text-amber-800">Partial Registration</p>
                      <p className="text-sm text-amber-700 mt-1">Study OK, samples had errors</p>
                      {registerResult.accession && (
                        <p className="text-sm text-muted-foreground mt-1 font-mono">
                          {registerResult.accession}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <XCircle className="h-6 w-6 text-red-600 mx-auto mb-2" />
                      <p className="font-medium text-red-800">Registration Failed</p>
                      <p className="text-sm text-red-600 mt-1">
                        {registerResult.error && registerResult.error.length > 100
                          ? registerResult.error.substring(0, 100) + "..."
                          : registerResult.error}
                      </p>
                    </>
                  )}
                  <p className="text-xs text-muted-foreground mt-3">
                    <Link href="/submissions" className="text-primary hover:underline">
                      View details in ENA Submissions
                    </Link>
                  </p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            {registerResult ? (
              <Button onClick={() => setRegisterDialogOpen(false)}>
                Close
              </Button>
            ) : (
              <Button variant="outline" disabled>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      </PageContainer>
      </Tabs>
    </>
  );
}
