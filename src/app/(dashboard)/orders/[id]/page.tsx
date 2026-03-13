"use client";

import { useState, useEffect, use, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageContainer } from "@/components/layout/PageContainer";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FlaskConical,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
  Pencil,
  Trash2,
  BookOpen,
  FolderOpen,
  HardDrive,
  Download,
  Eye,
  RefreshCw,
  FileCode,
} from "lucide-react";
import { parseProjectsValue } from "@/lib/field-types/projects";
import {
  buildOrderProgressSteps,
  getOrderProgressAnchorId,
} from "@/lib/orders/progress-steps";
import {
  buildFacilityFieldSections,
  getFacilityFieldSubsectionAnchorId,
  isFacilityFieldSubsectionId,
} from "@/lib/orders/facility-sections";
import { mapPerSampleFieldToColumn } from "@/lib/sample-fields";
import { DEFAULT_GROUPS, type FormFieldDefinition, type FormFieldGroup } from "@/types/form-config";

const DATA_HANDLING_SETTINGS_HREF = "/admin/form-builder?tab=settings#data-handling";

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// Helper to format custom field values for display
function formatCustomFieldValue(key: string, value: unknown): string | React.ReactNode {
  if (key === "_projects") {
    const projects = parseProjectsValue(value);
    if (projects.length === 0) return "No projects";
    return projects.map(p => p.name).join(", ");
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "object" && value !== null) {
    if ("technologyId" in value) {
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
      return parts.length > 0 ? parts.join(" | ") : "Not specified";
    }
    return JSON.stringify(value);
  }
  return String(value) || "Not specified";
}

// Helper to get human-readable field name
function getFieldLabel(key: string): string {
  const labels: Record<string, string> = {
    "_projects": "Projects",
    "_mixsChecklist": "MIxS Checklist",
    "_mixsFields": "Selected MIxS Fields",
  };
  return labels[key] || key.replace(/_/g, " ");
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore JSON parse errors and return empty object fallback.
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

function renderOrderDeleteError(message: string): React.ReactNode {
  if (message !== "Deletion of submitted orders is disabled. Enable it in Settings > Data Handling.") {
    return message;
  }

  return (
    <>
      Deletion of submitted orders is disabled. Enable it in{" "}
      <Link href={DATA_HANDLING_SETTINGS_HREF} className="underline underline-offset-2">
        Settings &gt; Data Handling
      </Link>
      .
    </>
  );
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
    if (billingValue.costCenter) {
      parts.push(`Cost Center: ${billingValue.costCenter}`);
    }
    if (billingValue.pspElement) {
      parts.push(`PSP: ${billingValue.pspElement}`);
    }
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

interface Order {
  id: string;
  name: string;
  status: string;
  statusUpdatedAt: string;
  createdAt: string;
  numberOfSamples: number | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  billingAddress: string | null;
  platform: string | null;
  instrumentModel: string | null;
  librarySelection: string | null;
  libraryStrategy: string | null;
  librarySource: string | null;
  customFields: string | null;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    department?: { name: string } | null;
  };
  samples: Array<{
    id: string;
    sampleId: string;
    sampleAlias: string | null;
    sampleTitle: string | null;
    sampleDescription: string | null;
    scientificName: string | null;
    taxId: string | null;
    customFields: string | null;
    reads: Array<{
      id: string;
      file1: string | null;
      file2: string | null;
      readCount1: number | null;
      readCount2: number | null;
    }>;
    study: {
      id: string;
      title: string;
      submitted: boolean;
    } | null;
  }>;
  statusNotes: Array<{
    id: string;
    noteType: string;
    content: string;
    createdAt: string;
    user: { firstName: string; lastName: string } | null;
  }>;
  _count: {
    samples: number;
  };
}

interface FileInspectionResponse {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  modifiedAt: string;
  readCount: number | null;
  readCountSource: "database" | "computed" | "unsupported" | "error";
  readCountError: string | null;
  preview: {
    lines: string[];
    truncated: boolean;
    supported: boolean;
    error: string | null;
  };
}

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(false);

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // Post-submission instructions
  const [instructions, setInstructions] = useState<string | null>(null);
  const [showFullInstructions, setShowFullInstructions] = useState(false);

  // Form config for showing order + sample fields in the same flow as order entry
  const [formFields, setFormFields] = useState<FormFieldDefinition[]>([]);
  const [formGroups, setFormGroups] = useState<FormFieldGroup[]>(DEFAULT_GROUPS);
  const [perSampleFields, setPerSampleFields] = useState<FormFieldDefinition[]>([]);
  const [enabledMixsChecklists, setEnabledMixsChecklists] = useState<string[]>([]);

  // Simulate reads states
  const [simulateReadsDialogOpen, setSimulateReadsDialogOpen] = useState(false);
  const [simulateReadsPhase, setSimulateReadsPhase] = useState<"confirm" | "running" | "done">("confirm");
  const [simulatingReads, setSimulatingReads] = useState(false);
  const [simulateReadsResult, setSimulateReadsResult] = useState<{
    success: boolean;
    error?: string;
    createdPath?: string;
    filesCreated?: number;
    oldFilesRemoved?: number;
    samplesProcessed?: number;
    files?: Array<{
      sampleId: string;
      file1: string;
      file1Size: number;
      file2: string | null;
      file2Size: number | null;
    }>;
  } | null>(null);

  // File inspection states
  const [inspectDialogOpen, setInspectDialogOpen] = useState(false);
  const [inspectingFilePath, setInspectingFilePath] = useState<string | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState("");
  const [inspectedFile, setInspectedFile] = useState<FileInspectionResponse | null>(null);
  const [inspectionCache, setInspectionCache] = useState<Record<string, FileInspectionResponse>>({});

  const isFacilityAdmin = session?.user?.role === "FACILITY_ADMIN";
  const isDemoUser = session?.user?.isDemo === true;
  const isOwner = order?.user.id === session?.user?.id;
  const canEditOrder = isFacilityAdmin || ((isOwner ?? false) && order?.status !== "COMPLETED");

  // Admin-only field names from form schema (used to filter custom fields display)
  const [adminOnlyFieldNames, setAdminOnlyFieldNames] = useState<Set<string>>(new Set());

  const orderId = resolvedParams.id;

  const fetchOrder = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      if (!res.ok) {
        if (res.status === 404) {
          // Handle stale/mismatched links: if this ID belongs to a study,
          // route the user to the matching study page instead of hard-failing.
          try {
            const studyRes = await fetch(`/api/studies/${orderId}`);
            if (studyRes.ok) {
              router.replace(`/studies/${orderId}`);
              return;
            }
          } catch {
            // Ignore fallback lookup errors and show default order error.
          }
          setError("Order not found");
        } else if (res.status === 403) {
          setError("You don't have permission to view this order");
        } else {
          throw new Error("Failed to fetch order");
        }
        return;
      }
      const data = await res.json();
      setOrder(data);
    } catch {
      setError("Failed to load order");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [orderId, router]);

  useEffect(() => {
    void fetchOrder();

    // Fetch form schema so overview can mirror order-entry flow.
    fetch("/api/form-schema")
      .then(res => res.ok ? res.json() : null)
      .then((data: {
        fields?: FormFieldDefinition[];
        groups?: FormFieldGroup[];
        perSampleFields?: FormFieldDefinition[];
        enabledMixsChecklists?: string[];
      } | null) => {
        const fields = (data?.fields || []).filter((field) => field.visible);
        const groups = (data?.groups && data.groups.length > 0 ? data.groups : DEFAULT_GROUPS)
          .slice()
          .sort((a, b) => a.order - b.order);
        const sampleFields = (data?.perSampleFields || fields.filter((field) => field.perSample))
          .filter((field) => field.visible)
          .sort((a, b) => a.order - b.order);

        setFormFields(fields);
        setFormGroups(groups);
        setPerSampleFields(sampleFields);
        setEnabledMixsChecklists(data?.enabledMixsChecklists || []);
        setAdminOnlyFieldNames(
          new Set(fields.filter((field) => field.adminOnly).map((field) => field.name))
        );
      })
      .catch(() => {
        setFormFields([]);
        setFormGroups(DEFAULT_GROUPS);
        setPerSampleFields([]);
        setEnabledMixsChecklists([]);
      });
  }, [fetchOrder, orderId]);

  const handleSimulateReadsConfirm = async () => {
    setSimulateReadsPhase("running");
    setSimulatingReads(true);
    setSimulateReadsResult(null);
    setError("");

    try {
      const res = await fetch(`/api/orders/${orderId}/simulate-reads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairedEnd: true,
          createRecords: true,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSimulateReadsResult({
          success: false,
          error: data.error || "Failed to create simulated read files",
        });
      } else {
        setSimulateReadsResult({
          success: true,
          createdPath: data.createdPath,
          filesCreated: data.filesCreated,
          oldFilesRemoved: data.oldFilesRemoved,
          samplesProcessed: data.samplesProcessed,
          files: data.files,
        });
        setTimeout(() => fetchOrder({ silent: true }), 500);
      }
    } catch (err) {
      setSimulateReadsResult({
        success: false,
        error: err instanceof Error ? err.message : "Failed to create simulated reads",
      });
    } finally {
      setSimulatingReads(false);
      setSimulateReadsPhase("done");
    }
  };

  const orderStatus = order?.status;

  // Fetch post-submission instructions for submitted orders
  useEffect(() => {
    if (!orderStatus || orderStatus === "DRAFT") return;

    fetch("/api/settings/instructions")
      .then((res) => res.json())
      .then((data) => setInstructions(data.instructions))
      .catch(() => setInstructions(null));
  }, [orderStatus]);

  const handleMarkSamplesSent = async () => {
    if (!order) return;
    setUpdating(true);
    setError("");

    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markSamplesSent: true }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to mark samples as sent");
        return;
      }

      await fetchOrder({ silent: true });
    } catch {
      setError("Failed to mark samples as sent");
    } finally {
      setUpdating(false);
    }
  };

  const handleDeleteClick = () => {
    setDeleteConfirmText("");
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!order) return;

    const isSubmitted = order.status !== "DRAFT";

    if (isSubmitted && deleteConfirmText !== "DELETE") {
      setError("You must type DELETE to confirm deletion of a submitted order.");
      return;
    }

    setUpdating(true);
    setDeleteDialogOpen(false);
    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to delete order");
        return;
      }

      router.push("/orders");
    } catch {
      setError("Failed to delete order");
    } finally {
      setUpdating(false);
    }
  };

  const fetchFileInspection = async (
    filePath: string,
    options?: { force?: boolean }
  ) => {
    const cached = inspectionCache[filePath];
    if (cached && !options?.force) {
      setInspectedFile(cached);
      setInspectError("");
      return;
    }

    setInspectLoading(true);
    setInspectError("");
    if (!cached) {
      setInspectedFile(null);
    }

    try {
      const res = await fetch(
        `/api/orders/${orderId}/files/inspect?path=${encodeURIComponent(filePath)}`
      );
      const data = (await res.json()) as
        | FileInspectionResponse
        | { error?: string };

      if (!res.ok) {
        const errorMessage =
          "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to inspect file";
        setInspectError(errorMessage);
        return;
      }

      const inspection = data as FileInspectionResponse;
      setInspectedFile(inspection);
      setInspectionCache((prev) => ({ ...prev, [filePath]: inspection }));
    } catch {
      setInspectError("Failed to inspect file");
    } finally {
      setInspectLoading(false);
    }
  };

  const handleInspectFile = (filePath: string) => {
    setInspectDialogOpen(true);
    setInspectingFilePath(filePath);
    void fetchFileInspection(filePath);
  };

  const handleRefreshInspection = () => {
    if (!inspectingFilePath) return;
    void fetchFileInspection(inspectingFilePath, { force: true });
  };

  const getReadCountForFile = (
    filePath: string | null,
    fallbackCount: number | null
  ): number | null => {
    if (!filePath) return null;
    const cached = inspectionCache[filePath];
    if (cached && cached.readCount !== null) {
      return cached.readCount;
    }
    return fallbackCount;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatReadCount = (value: number | null) => {
    if (value === null) return "Unknown";
    return `${value.toLocaleString("en-US")} reads`;
  };

  const parsedOrderCustomFields = useMemo(
    () => parseJsonObject(order?.customFields),
    [order?.customFields]
  );

  const sampleCustomFieldsById = useMemo(() => {
    if (!order) return {} as Record<string, Record<string, unknown>>;
    const parsed: Record<string, Record<string, unknown>> = {};
    for (const sample of order.samples) {
      parsed[sample.id] = parseJsonObject(sample.customFields);
    }
    return parsed;
  }, [order]);

  const overviewSteps = useMemo(
    () =>
      buildOrderProgressSteps({
        fields: isFacilityAdmin
          ? formFields
          : formFields.filter((field) => !field.adminOnly),
        groups: formGroups,
        enabledMixsChecklists,
        includeFacilityFields: isFacilityAdmin,
      }),
    [enabledMixsChecklists, formFields, formGroups, isFacilityAdmin]
  );
  const hasUngroupedStep = overviewSteps.some((step) => step.id === "_ungrouped");
  const hasMixsStep = overviewSteps.some((step) => step.id === "mixs");
  const hasFacilityStep = overviewSteps.some((step) => step.id === "_facility");

  const requestedSection = searchParams.get("section");
  const requestedSubsection = searchParams.get("subsection");
  const activeSection =
    requestedSection === "reads"
      ? "reads"
      : requestedSection === "facility"
        ? "facility"
        : "overview";
  const activeSubsection =
    activeSection === "overview" ? requestedSubsection : null;
  const activeFacilitySubsection =
    activeSection === "facility" && isFacilityFieldSubsectionId(requestedSubsection)
      ? requestedSubsection
      : null;

  useEffect(() => {
    if (loading || sessionStatus === "loading") {
      return;
    }

    if (requestedSection === "reads") {
      if (isFacilityAdmin && !isDemoUser) {
        router.replace(`/orders/${orderId}/sequencing`);
        return;
      }

      router.replace(`/orders/${orderId}`);
      return;
    }

    if (requestedSubsection === "_facility") {
      if (isFacilityAdmin && hasFacilityStep) {
        router.replace(`/orders/${orderId}?section=facility`);
        return;
      }

      router.replace(`/orders/${orderId}`);
      return;
    }

    if (requestedSection === "facility" && (!isFacilityAdmin || !hasFacilityStep)) {
      router.replace(`/orders/${orderId}`);
    }
  }, [
    hasFacilityStep,
    isDemoUser,
    isFacilityAdmin,
    loading,
    orderId,
    requestedSection,
    requestedSubsection,
    router,
    sessionStatus,
  ]);

  useEffect(() => {
    if (!order) return;

    const anchorId =
      activeSection === "overview" && activeSubsection
        ? getOrderProgressAnchorId(activeSubsection)
        : activeSection === "facility" && activeFacilitySubsection
          ? getFacilityFieldSubsectionAnchorId(activeFacilitySubsection)
          : null;
    if (!anchorId) return;

    const element = document.getElementById(anchorId);
    if (!element) return;

    const rafId = window.requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [
    activeSection,
    activeSubsection,
    activeFacilitySubsection,
    order,
    formFields.length,
    perSampleFields.length,
  ]);

  if (loading) {
    return (
      <PageContainer className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </PageContainer>
    );
  }

  if (error && !order) {
    return (
      <PageContainer>
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href="/orders">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Orders
          </Link>
        </Button>
        <div className="bg-card rounded-lg border p-8 text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h2 className="text-xl font-semibold mb-2">Error</h2>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </PageContainer>
    );
  }

  if (!order) return null;

  const samplesWithFiles = order.samples.filter(s => s.reads?.some(r => r.file1 || r.file2)).length;
  const visibleRegularOrderFields = formFields
    .filter(
      (field) =>
        field.visible &&
        !field.perSample &&
        field.type !== "mixs" &&
        !field.adminOnly
    );
  const visibleAdminOrderFields = isFacilityAdmin
    ? formFields.filter(
        (field) =>
          field.visible &&
          !field.perSample &&
          field.type !== "mixs" &&
          field.adminOnly
      )
    : [];
  const visibleSampleFields = perSampleFields
    .filter((field) => !field.adminOnly)
    .slice()
    .sort((a, b) => a.order - b.order);
  const visibleAdminSampleFields = isFacilityAdmin
    ? perSampleFields
        .filter((field) => field.adminOnly)
        .slice()
        .sort((a, b) => a.order - b.order)
    : [];
  const knownOrderFieldNames = new Set(formFields.map((field) => field.name));
  const orderRecord = order as unknown as Record<string, unknown>;

  const getOrderFieldRawValue = (field: FormFieldDefinition): unknown => {
    if (field.isSystem && field.systemKey) {
      const systemValue = orderRecord[field.systemKey];
      if (!hasDisplayValue(systemValue) && field.systemKey === "numberOfSamples") {
        return order.numberOfSamples ?? order._count.samples;
      }
      return systemValue;
    }
    return parsedOrderCustomFields[field.name];
  };

  const groupedOverviewSections = overviewSteps
    .filter((step) => step.kind === "group")
    .map((step) => ({
      id: step.id,
      title: step.label,
      rows: visibleRegularOrderFields
        .filter((field) => field.groupId === step.id)
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((field) => ({ field, value: getOrderFieldRawValue(field) }))
        .filter(({ value }) => hasDisplayValue(value)),
    }));

  const ungroupedOverviewRows = visibleRegularOrderFields
    .filter((field) => !field.groupId)
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((field) => ({ field, value: getOrderFieldRawValue(field) }))
    .filter(({ value }) => hasDisplayValue(value));

  const fallbackCustomRows = Object.entries(parsedOrderCustomFields).filter(
    ([key, value]) =>
      !key.startsWith("_mixs") &&
      !knownOrderFieldNames.has(key) &&
      !adminOnlyFieldNames.has(key) &&
      hasDisplayValue(value)
  );
  const fallbackAdminRows = Object.entries(parsedOrderCustomFields).filter(
    ([key, value]) =>
      !key.startsWith("_mixs") &&
      !knownOrderFieldNames.has(key) &&
      adminOnlyFieldNames.has(key) &&
      hasDisplayValue(value)
  );
  const facilityOverviewRows = visibleAdminOrderFields
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((field) => ({ field, value: getOrderFieldRawValue(field) }))
    .filter(({ value }) => hasDisplayValue(value));
  const selectedMixsChecklist =
    typeof parsedOrderCustomFields._mixsChecklist === "string"
      ? parsedOrderCustomFields._mixsChecklist
      : "";
  const selectedMixsFields = Array.isArray(parsedOrderCustomFields._mixsFields)
    ? parsedOrderCustomFields._mixsFields.filter(
        (field): field is string => typeof field === "string"
      )
    : [];
  const facilitySections = buildFacilityFieldSections({
    fields: formFields,
    order,
    includeFacilityFields: isFacilityAdmin,
  });

  const renderStepHeader = (
    title: string,
    stepId: string,
    options?: {
      wrapperClassName?: string;
      titleClassName?: string;
    }
  ) => {
    const wrapperClassName = options?.wrapperClassName || "px-5 py-4";
    const titleClassName = options?.titleClassName || "text-sm font-semibold";

    return (
      <div className={wrapperClassName}>
        {canEditOrder ? (
          <Link
            href={`/orders/${orderId}/edit?step=${stepId}`}
            className="group -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-1 transition-colors hover:bg-secondary/40"
          >
            <h2 className={titleClassName}>{title}</h2>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
              Edit
              <Pencil className="h-3 w-3" />
            </span>
          </Link>
        ) : (
          <h2 className={titleClassName}>{title}</h2>
        )}
      </div>
    );
  };

  const getSampleFieldRawValue = (sample: Order["samples"][number], field: FormFieldDefinition): unknown => {
    if (field.type === "organism") {
      const scientificName = sample.scientificName?.trim();
      const taxId = sample.taxId?.trim();
      if (scientificName && taxId) return `${scientificName} (Tax ID: ${taxId})`;
      return scientificName || taxId || "";
    }

    const mappedColumn = mapPerSampleFieldToColumn(field.name);
    if (mappedColumn) {
      return sample[mappedColumn];
    }

    return sampleCustomFieldsById[sample.id]?.[field.name];
  };

  return (
    <>
    <PageContainer>
      {error && (
        <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          <span>{renderOrderDeleteError(error)}</span>
        </div>
      )}
          {/* Order Process - only when there are samples */}
          {activeSection === "overview" && order.samples.length > 0 && (() => {
            const isSubmitted = order.status === "SUBMITTED" || order.status === "COMPLETED";
            const allSamplesHaveFiles = order.samples.length > 0 && samplesWithFiles === order.samples.length;
            const canShowShippingInstructions = isSubmitted && Boolean(instructions?.trim());
            const samplesSentNote = order.statusNotes.find((note) => note.noteType === "SAMPLES_SENT");
            const samplesMarkedSent = Boolean(samplesSentNote);
            const canMarkSamplesSent = isSubmitted && !samplesMarkedSent && Boolean(isOwner || isFacilityAdmin);
            const shippingStatus = !isSubmitted ? "Pending" : (samplesMarkedSent || allSamplesHaveFiles) ? "Done" : "In Progress";
            const sequencingStatus = allSamplesHaveFiles
              ? "Done"
              : isSubmitted
                ? "Waiting"
                : "Pending";

            return (
              <div className="mb-4 rounded-lg border bg-card p-5">
                <h3 className="mb-4 text-base font-semibold">Order Process</h3>
                <div className="space-y-3">
                  {/* Step 1: Order Submitted */}
                  <div className="rounded-lg border bg-background p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${isSubmitted
                            ? "border-foreground bg-foreground text-background"
                            : "border-muted-foreground/40 text-muted-foreground"
                          }`}
                        >
                          1
                        </span>
                        <span className="text-sm font-medium">Order Submitted</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{isSubmitted ? "Done" : "Pending"}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {isSubmitted
                        ? `${order.samples.length} sample${order.samples.length !== 1 ? "s" : ""} submitted to facility`
                        : `${order.samples.length} sample${order.samples.length !== 1 ? "s" : ""} added`}
                    </p>
                  </div>

                  {/* Step 2: Send Samples to Institutions */}
                  <div className="rounded-lg border bg-background p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${isSubmitted
                            ? "border-foreground bg-foreground text-background"
                            : "border-muted-foreground/40 text-muted-foreground"
                          }`}
                        >
                          2
                        </span>
                        <span className="text-sm font-medium">Send Samples to Institutions</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{shippingStatus}</span>
                        {canMarkSamplesSent && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-xs"
                            onClick={handleMarkSamplesSent}
                            disabled={updating}
                          >
                            {updating && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                            Mark sent
                          </Button>
                        )}
                      </div>
                    </div>
                    {!isSubmitted ? (
                      <p className="text-xs text-muted-foreground">Submit order first to unlock shipping instructions</p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {samplesSentNote ? (
                          <p className="text-xs text-muted-foreground">
                            Marked as sent{samplesSentNote.user ? ` by ${samplesSentNote.user.firstName} ${samplesSentNote.user.lastName}` : ""} on {formatDateTime(samplesSentNote.createdAt)}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Use Mark sent once samples are shipped to the institution</p>
                        )}

                        {canShowShippingInstructions ? (
                          <>
                            <button
                              onClick={() => setShowFullInstructions(!showFullInstructions)}
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              {showFullInstructions ? "Hide Instructions" : "Show Instructions"}
                            </button>
                            {showFullInstructions && (
                              <div className="mt-3 rounded-lg border bg-card p-3">
                                <div className="prose prose-sm max-w-none [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm [&_p]:text-xs [&_li]:text-xs prose-headings:text-foreground prose-p:text-foreground/80 prose-li:text-foreground/80 prose-strong:text-foreground">
                                  <ReactMarkdown>{instructions ?? ""}</ReactMarkdown>
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">No shipping instructions configured yet</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Step 3: Waiting for Sequencing */}
                  <div className="rounded-lg border bg-background p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${allSamplesHaveFiles
                            ? "border-foreground bg-foreground text-background"
                            : "border-muted-foreground/40 text-muted-foreground"
                          }`}
                        >
                          3
                        </span>
                        <span className="text-sm font-medium">Waiting for Sequencing</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{sequencingStatus}</span>
                    </div>
                    {allSamplesHaveFiles ? (
                      <p className="text-xs text-muted-foreground">Sequencing files received for all samples</p>
                    ) : samplesWithFiles > 0 ? (
                      <p className="text-xs text-muted-foreground">{samplesWithFiles}/{order.samples.length} samples have sequencing files</p>
                    ) : isSubmitted ? (
                      <p className="text-xs text-muted-foreground">Waiting for sequencing files from the institution</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Submit order first</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {activeSection === "overview" && (
            <>
              <div
                id={getOrderProgressAnchorId("review")}
                className="scroll-mt-20"
              />
              {/* Order entry fields in the same group flow as new order */}
              {groupedOverviewSections.map((section) => (
                <div
                  key={section.id}
                  id={getOrderProgressAnchorId(section.id)}
                  className="bg-card rounded-lg border overflow-hidden mb-4 scroll-mt-20"
                >
                  {renderStepHeader(section.title, section.id)}
                  {section.rows.length > 0 ? (
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
                  ) : (
                    <div className="border-t px-5 py-6 text-sm text-muted-foreground">
                      No values provided in this section yet.
                    </div>
                  )}
                </div>
              ))}

              {hasUngroupedStep && (
                <div
                  id={getOrderProgressAnchorId("_ungrouped")}
                  className="bg-card rounded-lg border overflow-hidden mb-4 scroll-mt-20"
                >
                  {renderStepHeader("Additional Details", "_ungrouped")}
                  {ungroupedOverviewRows.length > 0 || fallbackCustomRows.length > 0 ? (
                    <div className="divide-y divide-border border-t">
                      {ungroupedOverviewRows.map(({ field, value }) => (
                        <div key={field.id} className="flex justify-between items-start px-5 py-3 text-sm">
                          <span className="text-muted-foreground">{field.label}</span>
                          <span className="font-medium text-right max-w-[60%] break-words">
                            {formatSchemaFieldValue(field, value)}
                          </span>
                        </div>
                      ))}
                      {fallbackCustomRows.map(([key, value]) => (
                        <div key={key} className="flex justify-between items-start px-5 py-3 text-sm">
                          <span className="text-muted-foreground capitalize flex items-center gap-2">
                            {key === "_projects" && <FolderOpen className="h-4 w-4" />}
                            {getFieldLabel(key)}
                          </span>
                          <span className="font-medium text-right max-w-[60%] break-words">
                            {formatCustomFieldValue(key, value)}
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

              {!hasUngroupedStep && fallbackCustomRows.length > 0 && (
                <div className="bg-card rounded-lg border overflow-hidden mb-4">
                  <div className="px-5 py-4">
                    <h2 className="text-sm font-semibold">Additional Information</h2>
                  </div>
                  <div className="divide-y divide-border border-t">
                    {fallbackCustomRows.map(([key, value]) => (
                      <div key={key} className="flex justify-between items-start px-5 py-3 text-sm">
                        <span className="text-muted-foreground capitalize flex items-center gap-2">
                          {key === "_projects" && <FolderOpen className="h-4 w-4" />}
                          {getFieldLabel(key)}
                        </span>
                        <span className="font-medium text-right max-w-[60%] break-words">
                          {formatCustomFieldValue(key, value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {hasMixsStep && (
                <div
                  id={getOrderProgressAnchorId("mixs")}
                  className="bg-card rounded-lg border overflow-hidden mb-4 scroll-mt-20"
                >
                  {renderStepHeader("Sample Metadata", "mixs")}
                  {selectedMixsChecklist ? (
                    <div className="divide-y divide-border border-t">
                      <div className="flex justify-between items-start px-5 py-3 text-sm">
                        <span className="text-muted-foreground">Checklist</span>
                        <span className="font-medium text-right max-w-[60%] break-words">
                          {selectedMixsChecklist}
                        </span>
                      </div>
                      <div className="flex justify-between items-start px-5 py-3 text-sm">
                        <span className="text-muted-foreground">Selected Fields</span>
                        <span className="font-medium text-right max-w-[60%] break-words">
                          {selectedMixsFields.length > 0
                            ? `${selectedMixsFields.length} field${selectedMixsFields.length === 1 ? "" : "s"}`
                            : "None selected"}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="border-t px-5 py-6 text-sm text-muted-foreground">
                      No MIxS checklist selected for this order.
                    </div>
                  )}
                </div>
              )}

              {/* Samples */}
              <div
                id={getOrderProgressAnchorId("samples")}
                className="bg-card rounded-lg border overflow-hidden mb-4 scroll-mt-20"
              >
                {renderStepHeader(`Samples (${order.samples.length})`, "samples")}
                {order.samples.length === 0 ? (
                  <div className="px-5 py-8 text-center text-sm text-muted-foreground border-t">
                    No samples added yet
                  </div>
                ) : (
                  <div className="border-t">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50 border-b">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">#</th>
                            <th className="px-3 py-2 text-left font-medium">Sample ID</th>
                            {visibleSampleFields.map((field) => (
                              <th key={field.id} className="px-3 py-2 text-left font-medium">
                                {field.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {order.samples.map((sample, index) => (
                            <tr key={sample.id}>
                              <td className="px-3 py-2 text-muted-foreground">{index + 1}</td>
                              <td className="px-3 py-2">
                                <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                                  {sample.sampleId}
                                </code>
                              </td>
                              {visibleSampleFields.map((field) => {
                                const rawValue = getSampleFieldRawValue(sample, field);
                                const displayValue = formatSchemaFieldValue(field, rawValue);
                                return (
                                  <td key={field.id} className="px-3 py-2 align-top">
                                    {displayValue === "Not specified" ? "-" : displayValue}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {visibleSampleFields.length === 0 && (
                      <div className="px-5 py-3 text-sm text-muted-foreground border-t">
                        No per-sample fields are configured. Sample IDs are shown above.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Status History */}
              {order.statusNotes.length > 0 && (
                <div className="bg-card rounded-lg border overflow-hidden">
                  <div className="px-5 py-4">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      Status History
                    </h2>
                  </div>
                  <div className="divide-y divide-border border-t">
                    {order.statusNotes.map((note) => (
                      <div key={note.id} className="flex items-start gap-3 px-5 py-3">
                        <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Clock className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{note.content}</p>
                          <p className="text-xs text-muted-foreground">
                            {note.user
                              ? `${note.user.firstName} ${note.user.lastName}`
                              : "System"}{" "}
                            · {formatDate(note.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {activeSection === "facility" && isFacilityAdmin && hasFacilityStep && (
            <>
              {facilitySections.some((section) => section.id === "order-fields") && (
                <div
                  id={getFacilityFieldSubsectionAnchorId("order-fields")}
                  className="bg-card rounded-lg border border-slate-200 overflow-hidden mb-4 scroll-mt-20"
                >
                  <div className="flex items-start justify-between gap-3 border-b bg-slate-50/30 px-5 py-4">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-700">Order Fields</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Internal order-level data maintained by the facility team.
                      </p>
                    </div>
                    {canEditOrder && (
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/orders/${order.id}/edit?step=_facility&scope=facility`}>
                          <Pencil className="h-3.5 w-3.5 mr-1.5" />
                          Edit Order Fields
                        </Link>
                      </Button>
                    )}
                  </div>
                  {facilityOverviewRows.length > 0 || fallbackAdminRows.length > 0 ? (
                    <div className="divide-y divide-border">
                      {facilityOverviewRows.map(({ field, value }) => (
                        <div key={field.id} className="flex justify-between items-start px-5 py-3 text-sm">
                          <span className="text-muted-foreground">{field.label}</span>
                          <span className="font-medium text-right max-w-[60%] break-words">
                            {formatSchemaFieldValue(field, value)}
                          </span>
                        </div>
                      ))}
                      {fallbackAdminRows.map(([key, value]) => (
                        <div key={key} className="flex justify-between items-start px-5 py-3 text-sm">
                          <span className="text-muted-foreground capitalize">
                            {getFieldLabel(key)}
                          </span>
                          <span className="font-medium text-right max-w-[60%] break-words">
                            {formatCustomFieldValue(key, value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-5 py-6 text-sm text-muted-foreground">
                      No internal order-level fields are configured yet.
                    </div>
                  )}
                </div>
              )}

              {facilitySections.some((section) => section.id === "sample-fields") && (
                <div
                  id={getFacilityFieldSubsectionAnchorId("sample-fields")}
                  className="bg-card rounded-lg border border-slate-200 overflow-hidden scroll-mt-20"
                >
                  <div className="flex items-start justify-between gap-3 border-b bg-slate-50/30 px-5 py-4">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-700">Sample Fields</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Internal sample-level fields tracked by the facility team.
                      </p>
                    </div>
                    {canEditOrder && (
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/orders/${order.id}/edit?step=samples&scope=facility`}>
                          <Pencil className="h-3.5 w-3.5 mr-1.5" />
                          Edit Sample Fields
                        </Link>
                      </Button>
                    )}
                  </div>
                  {order.samples.length === 0 ? (
                    <div className="px-5 py-6 text-sm text-muted-foreground">
                      No samples have been added to this order yet.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40 border-b">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">#</th>
                            <th className="px-3 py-2 text-left font-medium">Sample ID</th>
                            {visibleAdminSampleFields.map((field) => (
                              <th key={field.id} className="px-3 py-2 text-left font-medium">
                                {field.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {order.samples.map((sample, index) => (
                            <tr key={sample.id}>
                              <td className="px-3 py-2 text-muted-foreground">{index + 1}</td>
                              <td className="px-3 py-2">
                                <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                                  {sample.sampleId}
                                </code>
                              </td>
                              {visibleAdminSampleFields.map((field) => {
                                const rawValue = getSampleFieldRawValue(sample, field);
                                const displayValue = formatSchemaFieldValue(field, rawValue);
                                return (
                                  <td key={field.id} className="px-3 py-2 align-top">
                                    {displayValue === "Not specified" ? "-" : displayValue}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {visibleAdminSampleFields.length === 0 && order.samples.length > 0 && (
                    <div className="border-t px-5 py-3 text-sm text-muted-foreground">
                      No internal per-sample fields are configured yet. Add admin-only sample fields in the form builder to track facility annotations here.
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {activeSection === "overview" && canEditOrder && (
            <div className="bg-card rounded-lg border overflow-hidden mt-4">
              <div className="px-5 py-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Order Information</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Update the order details, contact, or metadata fields.
                  </p>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/orders/${order.id}/edit`}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    Change Order Information
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {activeSection === "overview" && isFacilityAdmin && !isDemoUser && (
            <div className="bg-card rounded-lg border overflow-hidden mt-4">
              <div className="px-5 py-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Sequencing Data</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Track facility status, linked reads, QC reports, uploads, and integrity for this order.
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {samplesWithFiles} of {order.samples.length} sample{order.samples.length === 1 ? "" : "s"} currently have linked reads.
                  </p>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/orders/${order.id}/sequencing`}>
                    <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                    Open Sequencing Workspace
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {/* Read Files section */}
          {activeSection === "reads" && !isDemoUser && (
          <div className="bg-card rounded-lg border overflow-hidden mt-4">
            <div className="px-5 py-4">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                Samples ({order._count.samples})
              </h2>
            </div>

            {order.samples.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border-t">
                <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>No samples added yet</p>
                {order.status === "DRAFT" && isOwner && (
                  <Button className="mt-4" size="sm" asChild>
                    <Link href={`/orders/${order.id}/samples`}>
                      Add Samples
                    </Link>
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border border-t">
                {order.samples.map((sample) => {
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
                            {sample.study && (
                              <Link
                                href={`/studies/${sample.study.id}`}
                                className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5"
                              >
                                <BookOpen className="h-3 w-3" />
                                {sample.study.title}
                              </Link>
                            )}
                          </div>
                        </div>
                        {!hasFiles && (
                          <span className="text-xs text-muted-foreground">No reads</span>
                        )}
                      </div>

                      {/* File details */}
                      {!hasFiles && (
                        <div className="ml-10 mt-2">
                          <p className="text-xs text-muted-foreground">
                            No reads found for this sample.
                          </p>
                        </div>
                      )}
                      {hasFiles && (
                        <div className="ml-10 mt-2 space-y-1">
                          {sample.reads.filter(r => r.file1 || r.file2).map((read) => {
                            const read1Count = getReadCountForFile(read.file1, read.readCount1);
                            const read2Count = getReadCountForFile(read.file2, read.readCount2);
                            const read1Path = read.file1;
                            const read2Path = read.file2;
                            return (
                              <div key={read.id} className="space-y-1">
                                {read1Path && (
                                  <div className="flex items-center gap-2 text-sm">
                                    <Badge variant="outline" className="border-blue-300 text-blue-700 text-xs">R1</Badge>
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-muted-foreground text-xs">
                                        {read1Path.split("/").pop()}
                                      </p>
                                      <p className="text-[11px] text-muted-foreground">
                                        {formatReadCount(read1Count)}
                                      </p>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-xs"
                                      onClick={() => handleInspectFile(read1Path)}
                                    >
                                      <Eye className="h-3 w-3 mr-1" />
                                      Inspect
                                    </Button>
                                  </div>
                                )}
                                {read2Path && (
                                  <div className="flex items-center gap-2 text-sm">
                                    <Badge variant="outline" className="border-purple-300 text-purple-700 text-xs">R2</Badge>
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-muted-foreground text-xs">
                                        {read2Path.split("/").pop()}
                                      </p>
                                      <p className="text-[11px] text-muted-foreground">
                                        {formatReadCount(read2Count)}
                                      </p>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-xs"
                                      onClick={() => handleInspectFile(read2Path)}
                                    >
                                      <Eye className="h-3 w-3 mr-1" />
                                      Inspect
                                    </Button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {/* Delete Order */}
          {activeSection === "overview" && (isOwner || isFacilityAdmin) && (order.status === "DRAFT" || isFacilityAdmin) && (
            <div className="bg-card rounded-lg border overflow-hidden mt-4">
              <div className="px-5 py-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Delete Order</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Permanently remove this order and all its data.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={handleDeleteClick}
                  disabled={updating}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete
                </Button>
              </div>
            </div>
          )}
      </PageContainer>

      {/* File Inspect Dialog */}
      <Dialog
        open={inspectDialogOpen}
        onOpenChange={(open) => {
          setInspectDialogOpen(open);
          if (!open) {
            setInspectError("");
            setInspectingFilePath(null);
            setInspectedFile(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Inspect Read File
            </DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">
              {inspectingFilePath || "No file selected"}
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-4">
            {inspectLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : inspectError ? (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                {inspectError}
              </div>
            ) : inspectedFile ? (
              <>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-md border p-3">
                    <p className="text-muted-foreground text-xs">Size</p>
                    <p className="font-medium mt-1">{formatFileSize(inspectedFile.sizeBytes)}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-muted-foreground text-xs">Read Count</p>
                    <p className="font-medium mt-1">{formatReadCount(inspectedFile.readCount)}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-muted-foreground text-xs">Modified</p>
                    <p className="font-medium mt-1">{formatDateTime(inspectedFile.modifiedAt)}</p>
                  </div>
                </div>

                {inspectedFile.readCountError && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
                    Read count could not be calculated: {inspectedFile.readCountError}
                  </div>
                )}

                <div>
                  <p className="text-sm font-medium mb-2">Preview (first lines)</p>
                  {inspectedFile.preview.supported ? (
                    inspectedFile.preview.error ? (
                      <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                        {inspectedFile.preview.error}
                      </div>
                    ) : (
                      <>
                        <div className="rounded-md border bg-muted max-h-[360px] overflow-auto">
                          <pre className="p-3 text-xs whitespace-pre-wrap font-mono">
                            {inspectedFile.preview.lines.length > 0
                              ? inspectedFile.preview.lines.join("\n")
                              : "No preview content available"}
                          </pre>
                        </div>
                        {inspectedFile.preview.truncated && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Preview truncated. Showing the first lines only.
                          </p>
                        )}
                      </>
                    )
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Preview is not supported for this file type.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No file selected.</p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="outline"
              onClick={handleRefreshInspection}
              disabled={!inspectingFilePath || inspectLoading}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            {inspectingFilePath && (
              <Button variant="outline" asChild>
                <a href={`/api/files/download?path=${encodeURIComponent(inspectingFilePath)}`}>
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Order</DialogTitle>
            <DialogDescription>
              {order?.status !== "DRAFT" ? (
                <>
                  <p className="mb-2">
                    <strong>Warning:</strong> This order has been submitted (status: {order?.status}).
                  </p>
                  <p className="mb-2">Deleting will permanently remove:</p>
                  <ul className="list-disc list-inside mb-4 text-sm">
                    <li>{order?._count?.samples || 0} samples</li>
                    <li>All associated sequencing data</li>
                    <li>Status history</li>
                  </ul>
                  <p className="mb-2">
                    This cannot be undone. Type <strong>DELETE</strong> to confirm.
                  </p>
                  <Input
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="Type DELETE to confirm"
                    className="mt-2"
                  />
                </>
              ) : (
                <p>Are you sure you want to delete this order? This cannot be undone.</p>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={order?.status !== "DRAFT" && deleteConfirmText !== "DELETE"}
            >
              Delete Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Simulate Reads Dialog */}
      <Dialog
        open={simulateReadsDialogOpen}
        onOpenChange={(open) => {
          if (!simulatingReads) setSimulateReadsDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCode className="h-5 w-5" />
              Simulate Reads
            </DialogTitle>
            <DialogDescription>
              {simulateReadsPhase === "confirm"
                ? "Create simulated FASTQ files for testing"
                : simulateReadsResult
                  ? simulateReadsResult.success
                    ? "Simulated read files created successfully"
                    : "Failed to create simulated reads"
                  : "Creating simulated FASTQ files..."}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {/* Confirmation phase */}
            {simulateReadsPhase === "confirm" && order && (
              <div className="space-y-3">
                {(() => {
                  const existingFileCount = order.samples.reduce(
                    (count, s) => count + s.reads.filter(r => r.file1 || r.file2).length * 2,
                    0
                  );
                  const samplesWithReads = order.samples.filter(
                    s => s.reads.some(r => r.file1 || r.file2)
                  );
                  return (
                    <>
                      <div className="text-sm">
                        This will create paired-end FASTQ files (R1 + R2) for{" "}
                        <span className="font-medium">{order.samples.length}</span>{" "}
                        sample{order.samples.length !== 1 ? "s" : ""}.
                      </div>
                      {samplesWithReads.length > 0 && (
                        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                          <div className="text-sm font-medium text-amber-800 mb-2 flex items-center gap-1.5">
                            <AlertCircle className="h-4 w-4" />
                            Existing files will be replaced
                          </div>
                          <div className="text-xs text-amber-700 space-y-1">
                            <p>
                              {samplesWithReads.length} sample{samplesWithReads.length !== 1 ? "s" : ""}{" "}
                              already {samplesWithReads.length !== 1 ? "have" : "has"} read files
                              ({existingFileCount} file{existingFileCount !== 1 ? "s" : ""} total).
                            </p>
                            <div className="mt-2 max-h-[120px] overflow-y-auto space-y-0.5">
                              {samplesWithReads.map((s) => (
                                <div key={s.id} className="flex items-center gap-1.5">
                                  <FlaskConical className="h-3 w-3 flex-shrink-0" />
                                  <span className="font-medium">{s.sampleId}</span>
                                  <span className="text-amber-600">
                                    -- {s.reads.filter(r => r.file1 || r.file2).length} read record{s.reads.filter(r => r.file1 || r.file2).length !== 1 ? "s" : ""}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {/* Running phase */}
            {simulateReadsPhase === "running" && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            )}

            {/* Done phase */}
            {simulateReadsPhase === "done" && simulateReadsResult && (
              <div
                className={`p-4 rounded-lg border ${
                  simulateReadsResult.success
                    ? "bg-green-50 border-green-200"
                    : "bg-red-50 border-red-200"
                }`}
              >
                <div className="text-center">
                  {simulateReadsResult.success ? (
                    <>
                      <CheckCircle2 className="h-6 w-6 text-green-600 mx-auto mb-2" />
                      <p className="font-medium">Files Created Successfully</p>
                      <div className="mt-3 text-sm text-muted-foreground space-y-1">
                        <p>
                          <span className="font-medium">
                            {simulateReadsResult.filesCreated}
                          </span>{" "}
                          files created for{" "}
                          <span className="font-medium">
                            {simulateReadsResult.samplesProcessed}
                          </span>{" "}
                          samples
                        </p>
                        {(simulateReadsResult.oldFilesRemoved ?? 0) > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {simulateReadsResult.oldFilesRemoved} old file{simulateReadsResult.oldFilesRemoved !== 1 ? "s" : ""} replaced
                          </p>
                        )}
                        {simulateReadsResult.files && simulateReadsResult.files.length > 0 && (
                          <div className="mt-3 text-left max-h-[150px] overflow-y-auto space-y-2">
                            {simulateReadsResult.files.map((f) => (
                              <div key={f.sampleId} className="text-xs border-t pt-1.5">
                                <span className="font-medium">{f.sampleId}</span>
                                <div className="ml-2 text-muted-foreground">
                                  R1: {formatFileSize(f.file1Size)}
                                  {f.file2Size != null && <> · R2: {formatFileSize(f.file2Size)}</>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-6 w-6 text-red-600 mx-auto mb-2" />
                      <p className="font-medium text-red-800">Failed</p>
                      <p className="text-sm text-red-600 mt-1">
                        {simulateReadsResult.error}
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            {simulateReadsPhase === "confirm" && (
              <>
                <Button variant="outline" onClick={() => setSimulateReadsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSimulateReadsConfirm}>
                  Confirm
                </Button>
              </>
            )}
            {simulateReadsPhase === "running" && (
              <Button variant="outline" disabled>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating files...
              </Button>
            )}
            {simulateReadsPhase === "done" && (
              <Button onClick={() => setSimulateReadsDialogOpen(false)}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}
