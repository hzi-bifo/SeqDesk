"use client";

import { useState, useEffect, useCallback, use, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  ChevronRight,
} from "lucide-react";
import { StudyPipelinesSection } from "@/components/pipelines/StudyPipelinesSection";
import { type FormFieldDefinition, type FormFieldGroup } from "@/types/form-config";
import {
  STUDY_ADDITIONAL_DETAILS_SECTION_ID,
  STUDY_INFORMATION_SECTION_ID,
  getFixedStudySections,
  getStudyOverviewSectionAnchorId,
} from "@/lib/studies/fixed-sections";
import {
  buildStudyFacilityFieldSections,
} from "@/lib/studies/facility-sections";
import {
  STUDY_OVERVIEW_ASSOCIATED_SAMPLES_SECTION_ID,
  STUDY_OVERVIEW_ENVIRONMENT_TYPE_SECTION_ID,
  STUDY_OVERVIEW_REVIEW_SECTION_ID,
  STUDY_OVERVIEW_SAMPLE_METADATA_SECTION_ID,
  STUDY_OVERVIEW_STUDY_DETAILS_SECTION_ID,
  sampleHasStudyOverviewMetadata,
} from "@/lib/studies/overview-flow";

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

interface StudyFormSchemaResponse {
  fields?: FormFieldDefinition[];
  studyFields?: FormFieldDefinition[];
  perSampleFields?: FormFieldDefinition[];
  groups?: FormFieldGroup[];
  modules?: {
    mixs?: boolean;
    sampleAssociation?: boolean;
    funding?: boolean;
  };
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

function normalizeStudyTab(
  tab: string | null
): "overview" | "samples" | "reads" | "pipelines" | "publishing" {
  switch (tab) {
    case "samples":
    case "reads":
    case "pipelines":
    case "publishing":
      return tab;
    case "ena":
      return "publishing";
    default:
      return "overview";
  }
}

function normalizePublishingTarget(value: string | null): "ena" | null {
  return value === "ena" ? "ena" : null;
}

function getPublishingStatus(
  study: Pick<
    Study,
    "submitted" | "readyForSubmission" | "studyAccessionId" | "testRegisteredAt"
  >
): {
  label: string;
  className: string;
} {
  if (study.submitted) {
    return {
      label: "Registered",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }
  if (study.studyAccessionId && !study.testRegisteredAt) {
    return {
      label: "Partial",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }
  if (study.studyAccessionId && study.testRegisteredAt) {
    const expiration = getTestExpirationStatus(study.testRegisteredAt);
    return {
      label: expiration?.expired ? "Test Expired" : "Test Registered",
      className: expiration?.expired
        ? "border-slate-200 bg-slate-50 text-slate-600"
        : "border-amber-200 bg-amber-50 text-amber-700",
    };
  }
  if (study.readyForSubmission) {
    return {
      label: "Ready",
      className: "border-blue-200 bg-blue-50 text-blue-700",
    };
  }
  return {
    label: "Draft",
    className: "border-slate-200 bg-slate-50 text-slate-700",
  };
}

function getPublishingSummary(
  study: Pick<
    Study,
    "submitted" | "readyForSubmission" | "studyAccessionId" | "testRegisteredAt"
  >
): string {
  if (study.submitted && study.studyAccessionId) {
    return `Accession ${study.studyAccessionId} assigned`;
  }
  if (study.submitted) {
    return "Study has been registered";
  }
  if (study.studyAccessionId && !study.testRegisteredAt) {
    return `Study accession ${study.studyAccessionId} assigned; sample registration incomplete`;
  }
  if (study.studyAccessionId && study.testRegisteredAt) {
    const expiration = getTestExpirationStatus(study.testRegisteredAt);
    return expiration?.expired
      ? `Expired ENA test accession ${study.studyAccessionId}`
      : `ENA test accession ${study.studyAccessionId} active`;
  }
  if (study.readyForSubmission) {
    return "Ready for registration";
  }
  return "Complete metadata and mark ready to publish";
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
  const [enaCheck, setEnaCheck] = useState<{
    status: "idle" | "checking" | "ok" | "error";
    message?: string;
  }>({ status: "idle" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [enaSubmissions, setEnaSubmissions] = useState<any[]>([]);
  const [enaSubmissionsLoaded, setEnaSubmissionsLoaded] = useState(false);
  const [expandedSubmissionId, setExpandedSubmissionId] = useState<string | null>(null);
  const [studyFormFields, setStudyFormFields] = useState<FormFieldDefinition[]>([]);
  const [studyPerSampleFields, setStudyPerSampleFields] = useState<FormFieldDefinition[]>([]);
  const [studyFormGroups, setStudyFormGroups] = useState<FormFieldGroup[]>(getFixedStudySections());
  const [studyModules, setStudyModules] = useState<StudyFormSchemaResponse["modules"]>({});
  const [studySchemaLoaded, setStudySchemaLoaded] = useState(false);

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
  const requestedTab = searchParams.get("tab");
  const currentTab = normalizeStudyTab(requestedTab);
  const selectedPipelineId =
    currentTab === "pipelines" ? searchParams.get("pipeline") : null;
  const selectedPublishingPipeline =
    currentTab === "publishing" ? searchParams.get("pipeline") : null;
  const selectedPublishingTarget =
    currentTab === "publishing" && !selectedPublishingPipeline
      ? normalizePublishingTarget(
          requestedTab === "ena" ? "ena" : searchParams.get("publisher")
        )
      : null;

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
        const schemaPerSampleFields = (data?.perSampleFields ?? data?.fields ?? [])
          .filter((field) => field.perSample && field.visible);
        const groups = (data?.groups && data.groups.length > 0 ? data.groups : getFixedStudySections())
          .slice()
          .sort((a, b) => a.order - b.order);
        setStudyFormFields(schemaStudyFields);
        setStudyPerSampleFields(schemaPerSampleFields);
        setStudyFormGroups(groups);
        setStudyModules(data?.modules ?? {});
        setStudySchemaLoaded(true);
      })
      .catch(() => {
        setStudyFormFields([]);
        setStudyPerSampleFields([]);
        setStudyFormGroups(getFixedStudySections());
        setStudyModules({});
        setStudySchemaLoaded(true);
      });
  }, []);

  // ENA credentials check - runs when user visits the ENA registration page
  useEffect(() => {
    if (selectedPublishingTarget !== "ena" || !isAdmin) return;
    if (enaCheck.status !== "idle") return;

    setEnaCheck({ status: "checking" });
    fetch("/api/admin/settings/ena/test", { method: "POST" })
      .then((res) => res.json())
      .then((data: { success?: boolean; error?: string; message?: string }) => {
        if (data.success) {
          setEnaCheck({ status: "ok", message: data.message });
        } else {
          setEnaCheck({ status: "error", message: data.error || "ENA check failed" });
        }
      })
      .catch(() => {
        setEnaCheck({ status: "error", message: "Failed to check ENA credentials" });
      });
  }, [selectedPublishingTarget, isAdmin, enaCheck.status]);

  // Fetch ENA submissions for this study
  const fetchEnaSubmissions = useCallback(() => {
    if (!study || !isAdmin) return;
    fetch("/api/admin/submissions")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        const studySubs = (Array.isArray(data) ? data : [])
          .filter((s: { entityType: string; entityId: string }) => s.entityType === "study" && s.entityId === study.id)
          .sort((a: { createdAt: string }, b: { createdAt: string }) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setEnaSubmissions(studySubs);
        setEnaSubmissionsLoaded(true);
      })
      .catch(() => {
        setEnaSubmissionsLoaded(true);
      });
  }, [study, isAdmin]);

  useEffect(() => {
    if (selectedPublishingTarget !== "ena" || enaSubmissionsLoaded) return;
    fetchEnaSubmissions();
  }, [selectedPublishingTarget, enaSubmissionsLoaded, fetchEnaSubmissions]);

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

      // Refresh study data and submission history after a short delay.
      setTimeout(() => {
        void fetchStudy();
        fetchEnaSubmissions();
      }, 500);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create submission";
      setRegisterSteps([
        { step: 1, name: "Submission failed", status: "error", details: message },
      ]);
      setRegisterResult({ success: false, error: message, isTest });
    } finally {
      setSubmitting(false);
      // Refresh submissions list
      fetchEnaSubmissions();
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

  const visibleUserStudyFields = useMemo(
    () => studyFormFields
      .filter((field) => !field.adminOnly)
      .slice()
      .sort((a, b) => a.order - b.order),
    [studyFormFields]
  );

  const visibleUserPerSampleFields = useMemo(
    () => studyPerSampleFields
      .filter((field) => !field.adminOnly)
      .slice()
      .sort((a, b) => a.order - b.order),
    [studyPerSampleFields]
  );

  const knownStudyFieldNames = useMemo(
    () => new Set([...studyFormFields, ...studyPerSampleFields].map((field) => field.name)),
    [studyFormFields, studyPerSampleFields]
  );

  const fixedStudyOverviewSections = useMemo(
    () => studyFormGroups
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((group) => ({
        id: group.id,
        title: group.name,
        rows: visibleUserStudyFields
          .filter((field) => field.groupId === group.id)
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((field) => ({ field, value: parsedStudyMetadata[field.name] })),
      }))
          .filter(({ id, rows }) => {
        if (id === STUDY_INFORMATION_SECTION_ID) return true;
        return rows.length > 0;
      }),
    [parsedStudyMetadata, studyFormGroups, visibleUserStudyFields]
  );

  const ungroupedStudyMetadataRows = useMemo(
    () => visibleUserStudyFields
      .filter((field) => !field.groupId)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((field) => ({ field, value: parsedStudyMetadata[field.name] })),
    [visibleUserStudyFields, parsedStudyMetadata]
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

  const hasAdditionalDetailsSection =
    ungroupedStudyMetadataRows.length > 0 || fallbackStudyMetadataRows.length > 0;

  const overviewSectionsWithRows = useMemo(
    () =>
      fixedStudyOverviewSections.map((section) => {
        const coreRows =
          section.id === STUDY_INFORMATION_SECTION_ID
            ? [
                { key: "study-title", label: "Study Title", value: study?.title ?? "" },
                { key: "study-description", label: "Description", value: study?.description ?? "" },
                { key: "study-alias", label: "Alias", value: study?.alias ?? "" },
              ]
            : [];

        return {
          ...section,
          coreRows,
        };
      }),
    [
      fixedStudyOverviewSections,
      study?.alias,
      study?.description,
      study?.title,
    ]
  );

  const facilitySections = useMemo(
    () =>
      buildStudyFacilityFieldSections({
        fields: [...studyFormFields, ...studyPerSampleFields],
        study: study
          ? {
              studyMetadata: study.studyMetadata,
              samples: (study.samples ?? []).map((sample) => ({
                id: sample.id,
                checklistData: sample.checklistData,
              })),
            }
          : null,
        includeFacilityFields: isAdmin,
      }),
    [isAdmin, study, studyFormFields, studyPerSampleFields]
  );
  const studySamples = study?.samples ?? [];
  const hasAssociatedSamplesSection =
    Boolean(studyModules?.sampleAssociation) || studySamples.length > 0;
  const hasEnvironmentTypeSection =
    Boolean(studyModules?.mixs) || hasDisplayValue(study?.checklistType);
  const hasSampleMetadataSection =
    hasAssociatedSamplesSection &&
    (visibleUserPerSampleFields.length > 0 ||
      (Boolean(studyModules?.mixs) && hasDisplayValue(study?.checklistType)));
  const associatedSamplePreview = studySamples.slice(0, 5);

  const requestedSection = searchParams.get("section");
  const requestedSubsection = searchParams.get("subsection");
  const activeOverviewSubsection =
    currentTab === "overview" ? requestedSubsection : null;

  useEffect(() => {
    if (loading || !studySchemaLoaded || currentTab !== "overview") {
      return;
    }

    if (requestedSection === "facility") {
      if (!isAdmin || facilitySections.length === 0) {
        router.replace(`/studies/${apiStudyId}`);
        return;
      }

      const target = requestedSubsection
        ? `/studies/${apiStudyId}/facility?subsection=${encodeURIComponent(requestedSubsection)}`
        : `/studies/${apiStudyId}/facility`;
      router.replace(target);
    }
  }, [
    apiStudyId,
    currentTab,
    facilitySections.length,
    isAdmin,
    loading,
    requestedSection,
    requestedSubsection,
    router,
    studySchemaLoaded,
  ]);

  useEffect(() => {
    if (!study || currentTab !== "overview") return;

    const anchorId = activeOverviewSubsection
      ? getStudyOverviewSectionAnchorId(activeOverviewSubsection)
      : null;
    if (!anchorId) return;

    const element = document.getElementById(anchorId);
    if (!element) return;

    const rafId = window.requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [
    activeOverviewSubsection,
    currentTab,
    hasAssociatedSamplesSection,
    hasEnvironmentTypeSection,
    hasSampleMetadataSection,
    study,
  ]);

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
  const totalSamples = studySamples.length;
  const metadataEvaluationReady = studySchemaLoaded;
  const sampleMetadataRequired = metadataEvaluationReady && hasSampleMetadataSection;
  const samplesWithMetadata = !metadataEvaluationReady
    ? 0
    : sampleMetadataRequired
      ? studySamples.filter(sampleHasStudyOverviewMetadata).length
      : totalSamples;
  const allMetadataComplete =
    metadataEvaluationReady && totalSamples > 0 && samplesWithMetadata === totalSamples;
  const metadataCompletionPercent = totalSamples > 0
    ? Math.round((samplesWithMetadata / totalSamples) * 100)
    : 0;
  const publishingStatus = getPublishingStatus(study);
  const ownerDisplayName = study.user.firstName && study.user.lastName
    ? `${study.user.firstName} ${study.user.lastName}`
    : study.user.email;
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
            {publishingStatus.label}
            {study.studyAccessionId && ` \u00B7 ${study.studyAccessionId}`}
          </p>
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
          <>
            {hasAssociatedSamplesSection && (
              <div
                id={getStudyOverviewSectionAnchorId(STUDY_OVERVIEW_ASSOCIATED_SAMPLES_SECTION_ID)}
                className="bg-card rounded-lg border overflow-hidden scroll-mt-20"
              >
                <div className="flex items-start justify-between gap-3 px-5 py-4">
                  <div>
                    <h2 className="text-sm font-semibold">Associated Samples</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Samples currently linked to this study.
                    </p>
                  </div>
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/studies/${id}?tab=samples`}>Open Samples</Link>
                  </Button>
                </div>
                {studySamples.length > 0 ? (
                  <div className="divide-y divide-border border-t">
                    {associatedSamplePreview.map((sample) => (
                      <div key={sample.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                        <div>
                          <div className="font-medium">{sample.sampleId}</div>
                          <div className="text-xs text-muted-foreground">
                            {sample.order ? `${sample.order.orderNumber}${sample.order.name ? ` · ${sample.order.name}` : ""}` : "No source order"}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {sampleHasStudyOverviewMetadata(sample) ? "Metadata started" : "No metadata yet"}
                        </div>
                      </div>
                    ))}
                    {studySamples.length > associatedSamplePreview.length && (
                      <div className="px-5 py-3 text-xs text-muted-foreground">
                        +{studySamples.length - associatedSamplePreview.length} more sample{studySamples.length - associatedSamplePreview.length === 1 ? "" : "s"}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="border-t px-5 py-6 text-sm text-muted-foreground">
                    No samples are linked yet.
                    {(isOwner || isAdmin) && !study.submitted && (
                      <>
                        {" "}
                        <Link href={`/studies/${id}/edit`} className="font-medium text-primary hover:underline">
                          Associate samples
                        </Link>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

              <div
                id={getStudyOverviewSectionAnchorId(STUDY_OVERVIEW_STUDY_DETAILS_SECTION_ID)}
                className="mt-4 rounded-lg border bg-card p-4 scroll-mt-20"
              >
                <div className="mb-4">
                  <h2 className="text-sm font-semibold">Study Details</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Information entered in the study details step.
                  </p>
                </div>

                <div className="space-y-4">
                  {overviewSectionsWithRows.map((section) => (
                    <div key={section.id} className="rounded-lg border overflow-hidden">
                      <div className="px-5 py-4">
                        <h3 className="text-sm font-semibold">{section.title}</h3>
                      </div>
                      {section.coreRows.length > 0 || section.rows.length > 0 ? (
                        <div className="divide-y divide-border border-t">
                          {section.coreRows.map((row) => (
                            <div key={row.key} className="flex justify-between items-start px-5 py-3 text-sm">
                              <span className="text-muted-foreground">{row.label}</span>
                              <span className="font-medium text-right max-w-[60%] break-words">
                                {formatUnknownFieldValue(row.value)}
                              </span>
                            </div>
                          ))}
                          {section.rows.map(({ field, value }) => (
                            <div key={field.id} className="flex justify-between items-start px-5 py-3 text-sm">
                              <span className="text-muted-foreground">{field.label}</span>
                              <span className="font-medium text-right max-w-[60%] break-words">
                                {formatSchemaFieldValue(field, value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="border-t px-5 py-6 text-sm text-muted-foreground">
                          No values provided in this section yet.
                        </div>
                      )}
                    </div>
                  ))}

                  {hasAdditionalDetailsSection && (
                    <div
                      id={getStudyOverviewSectionAnchorId(STUDY_ADDITIONAL_DETAILS_SECTION_ID)}
                      className="rounded-lg border overflow-hidden"
                    >
                      <div className="px-5 py-4">
                        <h3 className="text-sm font-semibold">Additional Details</h3>
                      </div>
                      {ungroupedStudyMetadataRows.length > 0 || fallbackStudyMetadataRows.length > 0 ? (
                        <div className="divide-y divide-border border-t">
                          {ungroupedStudyMetadataRows.map(({ field, value }) => (
                            <div key={field.id} className="flex justify-between items-start px-5 py-3 text-sm">
                              <span className="text-muted-foreground">{field.label}</span>
                              <span className="font-medium text-right max-w-[60%] break-words">
                                {formatSchemaFieldValue(field, value)}
                              </span>
                            </div>
                          ))}
                          {fallbackStudyMetadataRows.map(([key, value]) => (
                            <div key={key} className="flex justify-between items-start px-5 py-3 text-sm">
                              <span className="text-muted-foreground capitalize">{getFieldLabel(key)}</span>
                              <span className="font-medium text-right max-w-[60%] break-words">
                                {formatUnknownFieldValue(value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="border-t px-5 py-6 text-sm text-muted-foreground">
                          No additional details provided yet.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {hasEnvironmentTypeSection && (
                <div
                  id={getStudyOverviewSectionAnchorId(STUDY_OVERVIEW_ENVIRONMENT_TYPE_SECTION_ID)}
                  className="bg-card rounded-lg border overflow-hidden mt-4 scroll-mt-20"
                >
                  <div className="px-5 py-4">
                    <h2 className="text-sm font-semibold">Environment Type</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      MIxS environment selection used to define sample metadata requirements.
                    </p>
                  </div>
                  <div className="divide-y divide-border border-t">
                    <div className="flex justify-between items-start px-5 py-3 text-sm">
                      <span className="text-muted-foreground">Selected Environment</span>
                      <span className="font-medium text-right max-w-[60%] break-words">
                        {formatUnknownFieldValue(study.checklistType)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {hasSampleMetadataSection && (
                <div
                  id={getStudyOverviewSectionAnchorId(STUDY_OVERVIEW_SAMPLE_METADATA_SECTION_ID)}
                  className="bg-card rounded-lg border overflow-hidden mt-4 scroll-mt-20"
                >
                  <div className="flex items-start justify-between gap-3 px-5 py-4">
                    <div>
                      <h2 className="text-sm font-semibold">Sample Metadata</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Progress across all associated samples for the metadata step.
                      </p>
                    </div>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/studies/${id}?tab=samples`}>View Sample List</Link>
                    </Button>
                  </div>
                  {totalSamples > 0 ? (
                    <>
                      <div className="border-t px-5 py-4 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Completion</span>
                          <span className="font-medium">
                            {samplesWithMetadata} / {totalSamples}
                            <span className="ml-2 text-xs text-muted-foreground">
                              ({metadataCompletionPercent}%)
                            </span>
                          </span>
                        </div>
                      </div>
                      <div className="divide-y divide-border border-t">
                        {associatedSamplePreview.map((sample) => {
                          const hasMetadata = sampleHasStudyOverviewMetadata(sample);
                          return (
                            <div key={sample.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                              <div className="font-medium">{sample.sampleId}</div>
                              <div className={hasMetadata ? "text-green-600" : "text-muted-foreground"}>
                                {hasMetadata ? "Metadata entered" : "Waiting for metadata"}
                              </div>
                            </div>
                          );
                        })}
                        {study.samples.length > associatedSamplePreview.length && (
                          <div className="px-5 py-3 text-xs text-muted-foreground">
                            +{study.samples.length - associatedSamplePreview.length} more sample{study.samples.length - associatedSamplePreview.length === 1 ? "" : "s"}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="border-t px-5 py-6 text-sm text-muted-foreground">
                      Associate samples first to start the metadata step.
                    </div>
                  )}
                </div>
              )}

            <div
              id={getStudyOverviewSectionAnchorId(STUDY_OVERVIEW_REVIEW_SECTION_ID)}
              className="mt-4 space-y-4 scroll-mt-20"
            >
                {!study.submitted && (() => {
                  const hasSamples = totalSamples > 0;
                  const metadataStepStatus = !hasSamples
                    ? "Blocked"
                    : allMetadataComplete
                      ? "Done"
                      : "In Progress";
                  return (
                    <div className="rounded-lg border bg-card p-5">
                      <h3 className="mb-4 text-base font-semibold">Study Process</h3>
                      <div className="space-y-3">
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

                <div className="bg-card rounded-lg border overflow-hidden">
                  <div className="px-5 py-4">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      Status History
                    </h2>
                  </div>
                  <div className="divide-y divide-border border-t">
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

                <div className="rounded-lg border bg-card overflow-hidden">
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
            </div>
          </>

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

          {!study.submitted && (
            <div className="bg-card rounded-lg border overflow-hidden mt-4">
              <div className="px-5 py-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Submission Status</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {study.readyForSubmission
                      ? "This study is marked as ready for ENA submission."
                      : allMetadataComplete
                        ? "All metadata is complete. Mark this study as ready when you want to submit."
                        : "Complete all metadata before marking this study as ready for submission."}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {(isOwner || isAdmin) && study.readyForSubmission && (
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
                  {isOwner && !study.readyForSubmission && (
                    <Button
                      size="sm"
                      onClick={() => setMarkReadyDialogOpen(true)}
                      disabled={markingReady || !allMetadataComplete}
                      title={!allMetadataComplete ? "Complete all metadata first" : undefined}
                    >
                      {markingReady ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : null}
                      Mark as Ready
                    </Button>
                  )}
                </div>
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
                Samples ({studySamples.length})
              </h2>
              {!study.submitted && isOwner && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/studies/${id}/edit`}>
                    Manage Samples
                  </Link>
                </Button>
              )}
            </div>

            {studySamples.length === 0 ? (
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
                {studySamples.map((sample) => {
                  const hasMetadata = sampleHasStudyOverviewMetadata(sample);
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

            {studySamples.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border-t">
                <FlaskConical className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>No samples in this study yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border border-t">
                {studySamples.map((sample) => {
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
            <StudyPipelinesSection
              studyId={study.id}
              samples={studySamples}
              selectedPipelineId={selectedPipelineId}
              categoryFilter="analysis"
            />
          </TabsContent>
        )}

        {/* Publishing Tab */}
        {!isDemoUser && (
        <TabsContent value="publishing">
          {selectedPublishingPipeline ? (
            <StudyPipelinesSection
              studyId={study.id}
              samples={studySamples}
              selectedPipelineId={selectedPublishingPipeline}
              categoryFilter="submission"
            />
          ) : !selectedPublishingTarget ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold">Publishing</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Publishing destinations available for this study
                </p>
              </div>

              <div className="grid gap-4">
                <Link
                  href={`/studies/${id}?tab=publishing&publisher=ena`}
                  className="block"
                >
                  <Card className="cursor-pointer transition-colors hover:bg-muted/30">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between gap-4">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Send className="h-4 w-4 text-muted-foreground" />
                          Register at ENA
                        </CardTitle>
                        <Badge
                          variant="secondary"
                          className={getPublishingStatus(study).className}
                        >
                          {getPublishingStatus(study).label}
                        </Badge>
                      </div>
                      <CardDescription>
                        Register and publish study metadata to the European
                        Nucleotide Archive
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>{getPublishingSummary(study)}</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
                {isAdmin && totalSamples > 0 && (
                  <Link
                    href={`/studies/${id}?tab=publishing&pipeline=submg`}
                    className="block"
                  >
                    <Card className="cursor-pointer transition-colors hover:bg-muted/30">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between gap-4">
                          <CardTitle className="flex items-center gap-2 text-base">
                            <Send className="h-4 w-4 text-muted-foreground" />
                            Submit to ENA
                          </CardTitle>
                        </div>
                        <CardDescription>
                          Submit reads, assemblies, and bins to ENA using SubMG
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>Pipeline-based data submission</span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )}
              </div>
            </div>
          ) : (() => {
            const uniqueTaxIds = [...new Set(studySamples.map(s => s.taxId).filter(Boolean))];
            const taxSummary = uniqueTaxIds.length > 0
              ? uniqueTaxIds.map(id => {
                  const sample = studySamples.find(s => s.taxId === id);
                  return sample?.scientificName ? `${sample.scientificName} (${id})` : String(id);
                }).join(", ")
              : null;
            const hasTestRegistration = Boolean(study.testRegisteredAt && study.studyAccessionId);
            const testExpiration = getTestExpirationStatus(study.testRegisteredAt);
            const activeTestRegistration = hasTestRegistration && !(testExpiration?.expired ?? false);
            const hasPartialProductionRegistration = Boolean(
              study.studyAccessionId && !study.submitted && !study.testRegisteredAt
            );
            const allSamplesHaveAccessions =
              totalSamples > 0 &&
              studySamples.every((sample) => Boolean(sample.sampleAccessionNumber));
            const requiredChecks = [
              { key: "title", label: "Title", passed: Boolean(study.title && study.title.trim()), value: study.title?.trim() || null },
              { key: "description", label: "Description", passed: Boolean(study.description && study.description.trim()), value: study.description?.trim() ? (study.description.trim().length > 80 ? study.description.trim().slice(0, 80) + "..." : study.description.trim()) : null },
              { key: "samples", label: "Samples", passed: totalSamples > 0, value: totalSamples > 0 ? `${totalSamples} sample${totalSamples !== 1 ? "s" : ""} linked` : null },
              { key: "taxonomy", label: "Taxonomy ID", passed: totalSamples > 0 && studySamples.every(s => s.taxId && s.taxId.trim()), value: taxSummary },
              {
                key: "metadata",
                label: "Metadata",
                passed: metadataEvaluationReady && (!sampleMetadataRequired || allMetadataComplete),
                value: !metadataEvaluationReady
                  ? "Checking..."
                  : sampleMetadataRequired
                  ? (allMetadataComplete
                    ? "All complete"
                    : `${samplesWithMetadata}/${studySamples.length} complete`)
                  : "Not required for this study",
              },
            ];
            const passedChecks = requiredChecks.filter(c => c.passed).length;
            const allPassed = passedChecks === requiredChecks.length;
            const testButtonDisabledReason = !allPassed
              ? "All checks must pass before registration"
              : hasPartialProductionRegistration
                ? "Study already has a production accession. Test re-registration would overwrite the stored production accession."
                : activeTestRegistration && allSamplesHaveAccessions
                  ? "Study and samples are already registered on the ENA Test Server"
                  : undefined;

            return (
              <div className="space-y-6">
                {/* Section 1: Header */}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h1 className="text-xl font-semibold">Register at ENA</h1>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Register your study and samples with the European Nucleotide Archive.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!study.submitted && isAdmin && (
                      <>
                        {enaCheck.status === "checking" ? (
                          <Button size="sm" disabled>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Checking ENA...
                          </Button>
                        ) : enaCheck.status === "error" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-[#FFBA00]/30 bg-[#FFBA00]/10 text-[#FFBA00] hover:bg-[#FFBA00]/20"
                            onClick={() => setEnaCheck({ status: "idle" })}
                            title={enaCheck.message}
                          >
                            <AlertCircle className="h-4 w-4 mr-2" />
                            {enaCheck.message?.includes("credentials") ? "ENA credentials missing" : "ENA check failed"}
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRegisterWithENA(true)}
                              disabled={
                                submitting ||
                                !allPassed ||
                                hasPartialProductionRegistration ||
                                (activeTestRegistration && allSamplesHaveAccessions)
                              }
                              title={testButtonDisabledReason}
                            >
                              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                              Test Server
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleRegisterWithENA(false)}
                              disabled={submitting || !allPassed || !study.readyForSubmission}
                              title={!allPassed ? "All checks must pass" : !study.readyForSubmission ? "Mark study as ready first" : undefined}
                            >
                              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                              Production
                            </Button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Section 2: Warnings */}
                {study.submitted && study.studyAccessionId && (
                  <div className="rounded-lg border border-[#00BD7D]/20 bg-[#00BD7D]/10 px-4 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-[#00BD7D] shrink-0" />
                      <span>Registered accession: <span className="font-mono font-medium">{study.studyAccessionId}</span></span>
                      {study.submittedAt && (
                        <span className="text-muted-foreground">on {formatDate(study.submittedAt)}</span>
                      )}
                    </div>
                  </div>
                )}


                {/* Section 3: Readiness Checks */}
                <div className="rounded-xl border border-border bg-card">
                  <div className="px-4 py-3 border-b border-border">
                    <h3 className="text-sm font-medium">Submission Requirements</h3>
                  </div>
                  <div className="divide-y divide-border">
                    {requiredChecks.map((check) => (
                      <div key={check.key} className="flex items-center gap-3 px-4 py-2.5">
                        {check.passed ? (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#00BD7D]/10 shrink-0">
                            <CheckCircle2 className="h-3.5 w-3.5 text-[#00BD7D]" />
                          </span>
                        ) : (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive/10 shrink-0">
                            <XCircle className="h-3.5 w-3.5 text-destructive" />
                          </span>
                        )}
                        <span className="text-xs font-medium w-24 shrink-0">{check.label}</span>
                        <span className="text-xs text-muted-foreground truncate">
                          {check.value || (check.passed ? "OK" : "Missing")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Section 4: Submission History */}
                <div className="rounded-xl border border-border bg-card">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      Submission History
                      {enaSubmissions.length > 0 && (
                        <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-medium">
                          {enaSubmissions.length}
                        </span>
                      )}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      Created by {study.user.firstName && study.user.lastName
                        ? `${study.user.firstName} ${study.user.lastName}`
                        : study.user.email}
                    </span>
                  </div>
                  {enaSubmissions.length === 0 ? (
                    <div className="rounded-b-xl border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                      {enaSubmissionsLoaded ? "No submissions yet. Use the buttons above to register with ENA." : "Loading..."}
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {enaSubmissions.map((sub) => {
                        const response = safeJsonParse(sub.response);
                        const accessions = safeJsonParse(sub.accessionNumbers);
                        const steps = response?.steps as Array<{ step: number; name: string; status: string; details?: Record<string, unknown> }> | undefined;
                        const studyAccession = accessions?.study || response?.receipt?.studyAccession;
                        const isExpanded = expandedSubmissionId === sub.id;
                        const isTest = response?.isTest;
                        const statusColor = sub.status === "ACCEPTED"
                          ? "#00BD7D"
                          : sub.status === "PARTIAL"
                            ? "#FFBA00"
                            : sub.status === "ERROR" || sub.status === "REJECTED"
                              ? "var(--destructive)"
                              : "#8FA1B9";

                        return (
                          <div key={sub.id}>
                            <button
                              onClick={() => setExpandedSubmissionId(isExpanded ? null : sub.id)}
                              className="flex items-center justify-between px-4 py-3 w-full text-left hover:bg-secondary/20 transition-colors"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="flex h-6 w-6 items-center justify-center rounded-full shrink-0" style={{ backgroundColor: `${statusColor}15` }}>
                                  {sub.status === "ACCEPTED" ? (
                                    <CheckCircle2 className="h-3.5 w-3.5" style={{ color: statusColor }} />
                                  ) : sub.status === "PARTIAL" ? (
                                    <AlertCircle className="h-3.5 w-3.5" style={{ color: statusColor }} />
                                  ) : sub.status === "ERROR" || sub.status === "REJECTED" ? (
                                    <XCircle className="h-3.5 w-3.5" style={{ color: statusColor }} />
                                  ) : (
                                    <Clock className="h-3.5 w-3.5" style={{ color: statusColor }} />
                                  )}
                                </span>
                                <span className="text-sm font-medium whitespace-nowrap">
                                  {isTest ? "Test" : "Production"}
                                </span>
                                <span className="text-xs font-normal px-1.5 py-0.5 rounded whitespace-nowrap" style={{ color: statusColor, backgroundColor: `${statusColor}15` }}>
                                  {sub.status}
                                </span>
                              </div>
                              <div className="flex items-center gap-4 shrink-0">
                                {studyAccession ? (
                                  <span className="text-xs font-mono text-muted-foreground">{studyAccession}</span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">--</span>
                                )}
                                <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(sub.createdAt)}</span>
                                <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                              </div>
                            </button>

                            {isExpanded && (
                              <div className="px-4 pb-4 space-y-3 border-t border-border bg-muted/30">
                                {/* Steps timeline */}
                                {steps && steps.length > 0 && (
                                  <div className="pt-3">
                                    <p className="text-xs font-medium mb-2">Registration Steps</p>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {steps.map((step, i) => (
                                        <span key={step.step} className="contents">
                                          {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                                          <span className="flex items-center gap-1 text-xs">
                                            {step.status === "completed" ? (
                                              <CheckCircle2 className="h-3.5 w-3.5 text-[#00BD7D] shrink-0" />
                                            ) : step.status === "error" ? (
                                              <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                                            ) : (
                                              <span className="h-3.5 w-3.5 rounded-full bg-muted flex items-center justify-center shrink-0">
                                                <span className="text-[9px] text-muted-foreground font-bold">{step.step}</span>
                                              </span>
                                            )}
                                            <span className={step.status === "error" ? "text-destructive" : "text-muted-foreground"}>{step.name}</span>
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Error message */}
                                {(sub.status === "ERROR" || sub.status === "REJECTED") && (() => {
                                  const errorStep = steps?.find((s) => s.status === "error");
                                  const details = errorStep?.details as Record<string, unknown> | string | undefined;
                                  const errorMsg = details
                                    ? (typeof details === "object" && details.error ? String(details.error) : typeof details === "string" ? details : JSON.stringify(details))
                                    : response?.receipt?.studyReceiptXml || null;
                                  if (!errorMsg) return null;
                                  const errorText = typeof errorMsg === "string" && errorMsg.includes("<ERROR>")
                                    ? errorMsg.match(/<ERROR>([\s\S]*?)<\/ERROR>/)?.[1] || errorMsg
                                    : typeof errorMsg === "string" && errorMsg.length > 300
                                      ? errorMsg.slice(0, 300) + "..."
                                      : String(errorMsg);
                                  return (
                                    <div className="rounded border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                                      {errorText}
                                    </div>
                                  );
                                })()}

                                {/* Accession numbers */}
                                {accessions && Object.keys(accessions).length > 0 && (
                                  <div>
                                    <p className="text-xs font-medium mb-1.5">Accession Numbers</p>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                                      {Object.entries(accessions).map(([key, val]) => (
                                        <div key={key} className="flex items-center gap-1.5 text-xs">
                                          <span className="text-muted-foreground capitalize">{key}:</span>
                                          <span className="font-mono">{String(val)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* XML content */}
                                {sub.xmlContent && (
                                  <details className="group">
                                    <summary className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground flex items-center gap-1">
                                      <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                                      Submitted XML
                                    </summary>
                                    <div className="mt-2 relative">
                                      <button
                                        onClick={() => navigator.clipboard.writeText(sub.xmlContent || "")}
                                        className="absolute top-2 right-2 text-xs bg-background border px-2 py-0.5 rounded hover:bg-muted flex items-center gap-1"
                                      >
                                        <Copy className="h-3 w-3" /> Copy
                                      </button>
                                      <div className="max-h-48 overflow-y-auto bg-background rounded border p-2 text-xs font-mono whitespace-pre-wrap break-all">
                                        {sub.xmlContent}
                                      </div>
                                    </div>
                                  </details>
                                )}

                                {/* Raw response */}
                                {response && (
                                  <details className="group">
                                    <summary className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground flex items-center gap-1">
                                      <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                                      ENA Response
                                    </summary>
                                    <div className="mt-2 relative">
                                      <button
                                        onClick={() => navigator.clipboard.writeText(JSON.stringify(response, null, 2))}
                                        className="absolute top-2 right-2 text-xs bg-background border px-2 py-0.5 rounded hover:bg-muted flex items-center gap-1"
                                      >
                                        <Copy className="h-3 w-3" /> Copy
                                      </button>
                                      <div className="max-h-48 overflow-y-auto bg-background rounded border p-2 text-xs font-mono whitespace-pre-wrap break-all">
                                        {JSON.stringify(response, null, 2)}
                                      </div>
                                    </div>
                                  </details>
                                )}

                                {/* Metadata */}
                                <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
                                  <span>ID: <span className="font-mono">{sub.id}</span></span>
                                  <span>Type: {sub.submissionType}</span>
                                  {response?.server && <span>Server: {response.server}</span>}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
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
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
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

          <div className="flex-1 overflow-y-auto py-2 space-y-3">
            {/* Steps */}
            <div className="flex items-center gap-2 flex-wrap">
              {registerSteps.map((step, i) => (
                <span key={step.step} className="contents">
                  {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                  <span className="flex items-center gap-1.5 text-sm">
                    {step.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-[#00BD7D] shrink-0" />
                    ) : step.status === "running" ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                    ) : step.status === "error" ? (
                      <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                    ) : (
                      <span className="h-4 w-4 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <span className="text-[10px] text-muted-foreground font-bold">{step.step}</span>
                      </span>
                    )}
                    <span className={step.status === "error" ? "text-red-600" : ""}>{step.name}</span>
                  </span>
                </span>
              ))}
            </div>

            {/* Step error details */}
            {registerSteps.some((s) => s.status === "error" && s.details) && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {registerSteps.find((s) => s.status === "error")?.details}
              </div>
            )}

            {/* Result */}
            {registerResult && (
              <div className={`p-4 rounded-lg border ${
                registerResult.success
                  ? "bg-[#00BD7D]/10 border-[#00BD7D]/20"
                  : registerResult.isPartial
                    ? "bg-[#FFBA00]/10 border-[#FFBA00]/20"
                    : "bg-red-50 border-red-200"
              }`}>
                <div className="text-center">
                  {registerResult.success ? (
                    <>
                      <CheckCircle2 className="h-6 w-6 text-[#00BD7D] mx-auto mb-2" />
                      <p className="font-medium">Registration Successful</p>
                      {registerResult.accession && (
                        <p className="text-sm text-muted-foreground mt-1 font-mono">
                          {registerResult.accession}
                        </p>
                      )}
                      {registerResult.isTest && (
                        <p className="text-xs text-[#FFBA00] mt-2">Test server - expires in 24h</p>
                      )}
                    </>
                  ) : registerResult.isPartial ? (
                    <>
                      <AlertCircle className="h-6 w-6 text-[#FFBA00] mx-auto mb-2" />
                      <p className="font-medium">Partial Registration</p>
                      <p className="text-sm text-muted-foreground mt-1">Study OK, samples had errors</p>
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
                    Details available in Submission History below.
                  </p>
                </div>
              </div>
            )}

            {/* Generated XML - collapsible debug section */}
            {generatedXml && (
              <details className="group">
                <summary className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground flex items-center gap-1">
                  <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                  Generated XML
                </summary>
                <div className="mt-2 space-y-2">
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
              </details>
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
