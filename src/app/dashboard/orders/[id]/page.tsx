"use client";

import { useState, useEffect, use } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  User,
  Mail,
  Phone,
  MapPin,
  Pencil,
  Trash2,
  ClipboardList,
  BookOpen,
  FolderOpen,
  Info,
  HardDrive,
  Download,
  FileCode,
} from "lucide-react";
import { parseProjectsValue } from "@/lib/field-types/projects";

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

interface Order {
  id: string;
  name: string;
  status: string;
  statusUpdatedAt: string;
  createdAt: string;
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
    sampleTitle: string | null;
    reads: Array<{
      id: string;
      file1: string | null;
      file2: string | null;
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

const STATUS_CONFIG: Record<string, { label: string; dot: string; color: string }> = {
  DRAFT: { label: "Draft", dot: "bg-muted-foreground", color: "text-muted-foreground" },
  SUBMITTED: { label: "Submitted", dot: "bg-blue-500", color: "text-blue-600" },
  COMPLETED: { label: "Completed", dot: "bg-emerald-500", color: "text-emerald-600" },
};

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const { data: session } = useSession();
  const router = useRouter();
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

  // Form config for showing per-sample fields
  const [perSampleFields, setPerSampleFields] = useState<Array<{ name: string; label: string }>>([]);

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

  const isResearcher = session?.user?.role === "RESEARCHER";
  const isFacilityAdmin = session?.user?.role === "FACILITY_ADMIN";
  const isOwner = order?.user.id === session?.user?.id;

  const orderId = resolvedParams.id;

  const fetchOrder = async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      if (!res.ok) {
        if (res.status === 404) {
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
  };

  useEffect(() => {
    fetchOrder();
  }, [orderId]);

  const handleSimulateReadsClick = () => {
    setSimulateReadsPhase("confirm");
    setSimulateReadsResult(null);
    setSimulateReadsDialogOpen(true);
  };

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

  // Fetch post-submission instructions for submitted orders
  useEffect(() => {
    if (order && order.status !== "DRAFT") {
      fetch("/api/settings/instructions")
        .then((res) => res.json())
        .then((data) => setInstructions(data.instructions))
        .catch(() => setInstructions(null));
    }
  }, [order?.status]);

  // Fetch form config to get per-sample fields
  useEffect(() => {
    fetch("/api/form-schema")
      .then((res) => res.json())
      .then((data) => {
        const fields = data.perSampleFields || (data.fields || []).filter((f: { perSample?: boolean; visible?: boolean }) =>
          f.perSample && f.visible
        );
        if (fields.length > 0) {
          setPerSampleFields(
            fields.map((f: { name: string; label: string }) => ({
              name: f.name,
              label: f.label,
            }))
          );
        }
      })
      .catch(() => setPerSampleFields([]));
  }, []);

  const handleStatusChange = async (newStatus: string) => {
    if (!order) return;
    setUpdating(true);
    setError("");

    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to update status");
        return;
      }

      const updatedRes = await fetch(`/api/orders/${order.id}`);
      const updatedOrder = await updatedRes.json();
      setOrder(updatedOrder);
    } catch {
      setError("Failed to update status");
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

      router.push("/dashboard/orders");
    } catch {
      setError("Failed to delete order");
    } finally {
      setUpdating(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

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
          <Link href="/dashboard/orders">
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

  const statusCfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.DRAFT;
  const samplesWithFiles = order.samples.filter(s => s.reads?.some(r => r.file1 || r.file2)).length;

  return (
    <PageContainer>
      {/* Header */}
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link href="/dashboard/orders">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Orders
          </Link>
        </Button>

        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-semibold">{order.name}</h1>
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${statusCfg.color}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${statusCfg.dot}`} />
                {statusCfg.label}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {[
                order.platform,
                `${order._count.samples} sample${order._count.samples !== 1 ? "s" : ""}`,
                `Created ${formatDate(order.createdAt)}`,
              ].filter(Boolean).join(" · ")}
            </p>
          </div>

          {/* Action buttons */}
          {(isOwner || isFacilityAdmin) && (
            <div className="flex items-center gap-2">
              {order.status === "DRAFT" && (isOwner || isFacilityAdmin) && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/dashboard/orders/${order.id}/edit`}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </Link>
                </Button>
              )}
              {isFacilityAdmin && (order.status === "SUBMITTED" || order.status === "COMPLETED") && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/dashboard/orders/${order.id}/files`}>
                    <HardDrive className="h-4 w-4 mr-2" />
                    Manage Files
                  </Link>
                </Button>
              )}
              {(order.status === "DRAFT" || isFacilityAdmin) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={handleDeleteClick}
                  disabled={updating}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="reads">
            Read Files{samplesWithFiles > 0 ? ` (${samplesWithFiles}/${order._count.samples})` : ""}
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview">
          {/* Order Progress - only when there are samples */}
          {order.samples.length > 0 && (() => {
            const isSubmitted = order.status === "SUBMITTED" || order.status === "COMPLETED";
            const allSamplesHaveFiles = order.samples.length > 0 && samplesWithFiles === order.samples.length;

            return (
              <div className="rounded-xl border border-primary/20 bg-gradient-to-r from-primary/5 via-primary/10 to-violet-500/10 p-5 mb-4">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <ClipboardList className="h-5 w-5" />
                  Order Progress
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {/* Step 1: Order Submitted */}
                  <div className={`p-3 rounded-lg border bg-card ${isSubmitted ? "border-emerald-200" : ""}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {isSubmitted ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <div className="h-4 w-4 rounded-full bg-muted-foreground flex items-center justify-center">
                          <span className="text-[10px] text-white font-bold">1</span>
                        </div>
                      )}
                      <span className="text-sm font-medium">Order Submitted</span>
                    </div>
                    {isSubmitted ? (
                      <p className="text-xs text-emerald-600">{order.samples.length} sample{order.samples.length !== 1 ? "s" : ""} submitted to facility</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">{order.samples.length} sample{order.samples.length !== 1 ? "s" : ""} added</p>
                    )}
                    {isSubmitted && instructions && (
                      <button
                        onClick={() => setShowFullInstructions(!showFullInstructions)}
                        className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                      >
                        <Info className="h-3 w-3" />
                        {showFullInstructions ? "Hide Instructions" : "View Instructions"}
                      </button>
                    )}
                  </div>

                  {/* Step 2: Files Assigned */}
                  <div className={`p-3 rounded-lg border bg-card ${allSamplesHaveFiles ? "border-emerald-200" : ""}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {allSamplesHaveFiles ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <div className="h-4 w-4 rounded-full bg-muted-foreground flex items-center justify-center">
                          <span className="text-[10px] text-white font-bold">2</span>
                        </div>
                      )}
                      <span className="text-sm font-medium">Files Assigned</span>
                    </div>
                    {allSamplesHaveFiles ? (
                      <p className="text-xs text-emerald-600">All samples have files</p>
                    ) : samplesWithFiles > 0 ? (
                      <p className="text-xs text-amber-600">{samplesWithFiles}/{order.samples.length} samples have files</p>
                    ) : isSubmitted ? (
                      <p className="text-xs text-amber-600">Waiting for files</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Submit order first</p>
                    )}
                  </div>
                </div>

                {/* Shipping Instructions */}
                {isSubmitted && showFullInstructions && instructions && (
                  <div className="mt-4 p-4 bg-card rounded-lg border">
                    <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground/80 prose-li:text-foreground/80 prose-strong:text-foreground">
                      <ReactMarkdown>{instructions}</ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="bg-card rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Samples</p>
              <p className="text-2xl font-semibold mt-1">{order._count.samples}</p>
            </div>
            <div className="bg-card rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Researcher</p>
              <p className="text-sm font-medium mt-1 truncate">
                {order.user.firstName} {order.user.lastName}
              </p>
            </div>
            <div className="bg-card rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Platform</p>
              <p className="text-sm font-medium mt-1 truncate">{order.platform || "Not specified"}</p>
            </div>
          </div>

          {/* Sequencing Parameters */}
          <div className="bg-card rounded-lg border overflow-hidden mb-4">
            <div className="px-5 py-4">
              <h2 className="text-sm font-semibold">Sequencing Parameters</h2>
            </div>
            <div className="divide-y divide-border border-t">
              {[
                { label: "Platform", value: order.platform },
                { label: "Instrument", value: order.instrumentModel },
                { label: "Strategy", value: order.libraryStrategy },
                { label: "Source", value: order.librarySource },
                { label: "Selection", value: order.librarySelection },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between px-5 py-3 text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">{value || "Not specified"}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Custom Fields */}
          {order.customFields && (() => {
            let customData: Record<string, unknown>;
            try {
              customData = JSON.parse(order.customFields);
            } catch {
              return null;
            }
            const displayFields = Object.entries(customData).filter(
              ([key]) => !key.startsWith("_mixs")
            );
            if (displayFields.length === 0) return null;
            return (
              <div className="bg-card rounded-lg border overflow-hidden mb-4">
                <div className="px-5 py-4">
                  <h2 className="text-sm font-semibold">Additional Information</h2>
                </div>
                <div className="divide-y divide-border border-t">
                  {displayFields.map(([key, value]) => (
                    <div key={key} className="flex justify-between items-start px-5 py-3 text-sm">
                      <span className="text-muted-foreground capitalize flex items-center gap-2">
                        {key === "_projects" && <FolderOpen className="h-4 w-4" />}
                        {getFieldLabel(key)}
                      </span>
                      <span className="font-medium text-right max-w-[60%]">
                        {formatCustomFieldValue(key, value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

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
        </TabsContent>

        {/* Read Files Tab */}
        <TabsContent value="reads">
          {/* Admin: Simulate Reads button */}
          {isFacilityAdmin && order.samples.length > 0 && (
            <div className="flex items-center justify-between mb-4 p-4 bg-card rounded-lg border">
              <div>
                <p className="text-sm font-medium">Simulate Read Files</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Create simulated FASTQ files for testing
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleSimulateReadsClick}
                disabled={simulatingReads || order.samples.length === 0}
              >
                {simulatingReads ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileCode className="h-4 w-4 mr-2" />
                )}
                Simulate Reads
              </Button>
            </div>
          )}

          {/* Samples with file info */}
          <div className="bg-card rounded-lg border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                Samples ({order._count.samples})
              </h2>
              {isFacilityAdmin && (order.status === "SUBMITTED" || order.status === "COMPLETED") && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/dashboard/orders/${order.id}/files`}>
                    Manage Files
                  </Link>
                </Button>
              )}
            </div>

            {order.samples.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border-t">
                <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>No samples added yet</p>
                {order.status === "DRAFT" && isOwner && (
                  <Button className="mt-4" size="sm" asChild>
                    <Link href={`/dashboard/orders/${order.id}/samples`}>
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
                                href={`/dashboard/studies/${sample.study.id}`}
                                className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5"
                              >
                                <BookOpen className="h-3 w-3" />
                                {sample.study.title}
                              </Link>
                            )}
                          </div>
                        </div>
                        {!hasFiles && (
                          <span className="text-xs text-muted-foreground">No files</span>
                        )}
                      </div>

                      {/* File details */}
                      {hasFiles && (
                        <div className="ml-10 mt-2 space-y-1">
                          {sample.reads.filter(r => r.file1 || r.file2).map((read) => (
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
      </Tabs>

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

    </PageContainer>
  );
}
