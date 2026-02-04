"use client";

import { useState, useEffect, use, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { PageContainer } from "@/components/layout/PageContainer";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Settings,
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

// Helper to format custom field values for display
function formatCustomFieldValue(key: string, value: unknown): string | React.ReactNode {
  // Handle projects field specially
  if (key === "_projects") {
    const projects = parseProjectsValue(value);
    if (projects.length === 0) return "No projects";
    return projects.map(p => p.name).join(", ");
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  // Handle booleans
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  // Handle objects (stringify them nicely)
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

  // Default: convert to string
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

const STATUS_ORDER = [
  { key: "DRAFT", label: "Draft", description: "Order is being prepared by researcher" },
  { key: "SUBMITTED", label: "Submitted", description: "Order submitted, waiting for file assignment" },
  { key: "COMPLETED", label: "Completed", description: "All samples have sequencing files assigned" },
];

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-500",
  SUBMITTED: "bg-blue-500",
  COMPLETED: "bg-emerald-500",
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
  const [simulatingReads, setSimulatingReads] = useState(false);
  const [simulateReadsResult, setSimulateReadsResult] = useState<{
    success: boolean;
    error?: string;
    createdPath?: string;
    filesCreated?: number;
    samplesProcessed?: number;
  } | null>(null);
  const [selectedStudyId, setSelectedStudyId] = useState<string>("");

  const isResearcher = session?.user?.role === "RESEARCHER";
  const isFacilityAdmin = session?.user?.role === "FACILITY_ADMIN";
  const isOwner = order?.user.id === session?.user?.id;

  const orderStudies = useMemo(() => {
    if (!order) return [];
    const map = new Map<string, { id: string; title: string }>();
    for (const sample of order.samples) {
      if (sample.study) {
        map.set(sample.study.id, { id: sample.study.id, title: sample.study.title });
      }
    }
    return Array.from(map.values());
  }, [order]);

  const selectedStudy = orderStudies.find((study) => study.id === selectedStudyId) || null;

  useEffect(() => {
    if (orderStudies.length === 0) {
      setSelectedStudyId("");
      return;
    }
    if (!selectedStudyId || !orderStudies.some((study) => study.id === selectedStudyId)) {
      setSelectedStudyId(orderStudies[0].id);
    }
  }, [orderStudies, selectedStudyId]);

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

  const handleSimulateReads = async () => {
    if (!selectedStudyId) {
      setSimulateReadsResult({
        success: false,
        error: "Select a study before simulating reads.",
      });
      setSimulateReadsDialogOpen(true);
      return;
    }

    setSimulatingReads(true);
    setSimulateReadsResult(null);
    setSimulateReadsDialogOpen(true);
    setError("");

    try {
      const res = await fetch(`/api/studies/${selectedStudyId}/simulate-reads`, {
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
        return;
      }

      setSimulateReadsResult({
        success: true,
        createdPath: data.createdPath,
        filesCreated: data.filesCreated,
        samplesProcessed: data.samplesProcessed,
      });

      // Refresh order data to show new reads if applicable
      setTimeout(() => fetchOrder({ silent: true }), 500);
    } catch (err) {
      setSimulateReadsResult({
        success: false,
        error: err instanceof Error ? err.message : "Failed to create simulated reads",
      });
    } finally {
      setSimulatingReads(false);
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

      // Refresh order data
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

    // For submitted orders, require typing DELETE
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
      hour: "2-digit",
      minute: "2-digit",
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
        <GlassCard className="p-8 text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h2 className="text-xl font-semibold mb-2">Error</h2>
          <p className="text-muted-foreground">{error}</p>
        </GlassCard>
      </PageContainer>
    );
  }

  if (!order) return null;

  return (
    <PageContainer>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href="/dashboard/orders">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Orders
          </Link>
        </Button>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center">
              <FlaskConical className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">{order.name}</h1>
              <div className="flex items-center gap-3 mt-1">
                <Badge className={`${STATUS_COLORS[order.status]} hover:${STATUS_COLORS[order.status]}`}>
                  {STATUS_ORDER.find(s => s.key === order.status)?.label || order.status}
                </Badge>
                <span className="text-muted-foreground text-sm">
                  Created {formatDate(order.createdAt)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(isOwner || isFacilityAdmin) && (
              <>
                {order.status === "DRAFT" ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/dashboard/orders/${order.id}/edit`}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled className="opacity-50">
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                )}
              </>
            )}
            {isFacilityAdmin && (order.status === "SUBMITTED" || order.status === "COMPLETED") && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/dashboard/orders/${order.id}/files`}>
                  <HardDrive className="h-4 w-4 mr-2" />
                  Manage Files
                </Link>
              </Button>
            )}
            {(isOwner || isFacilityAdmin) && (
              <>
                {(order.status === "DRAFT" || isFacilityAdmin) ? (
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
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled
                    className="opacity-50"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {/* Workflow Guide - Show for orders with samples */}
      {order.samples.length > 0 && (
        (() => {
          const isSubmitted = order.status === "SUBMITTED" || order.status === "COMPLETED";
          const isCompleted = order.status === "COMPLETED";

          // Determine completion status for each step
          const step1Complete = isSubmitted; // Order submitted
          const step2Complete = isCompleted; // All files assigned (auto)

          return (
            <div className="mb-6 bg-gradient-to-r from-secondary to-emerald-50/50 rounded-xl border border-border p-5">
              <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-blue-600" />
                Order Progress
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {/* Step 1: Order Submitted */}
                <div className={`relative p-3 rounded-lg ${step1Complete ? 'bg-white border-2 border-emerald-200' : 'bg-white/50 border border-border'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {step1Complete ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <div className="h-4 w-4 rounded-full bg-muted-foreground flex items-center justify-center">
                        <span className="text-[10px] text-white font-bold">1</span>
                      </div>
                    )}
                    <span className="text-sm font-medium">Order Submitted</span>
                  </div>
                  {step1Complete ? (
                    <p className="text-xs text-emerald-600">{order.samples.length} sample{order.samples.length !== 1 ? 's' : ''} submitted to facility</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{order.samples.length} sample{order.samples.length !== 1 ? 's' : ''} added</p>
                  )}
                  {step1Complete && instructions && (
                    <button
                      onClick={() => setShowFullInstructions(!showFullInstructions)}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      <Info className="h-3 w-3" />
                      {showFullInstructions ? "Hide Instructions" : "View Instructions"}
                    </button>
                  )}
                </div>

                {/* Step 2: Files Assigned (auto) */}
                <div className={`relative p-3 rounded-lg ${step2Complete ? 'bg-white border-2 border-emerald-200' : 'bg-white/50 border border-border'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {step2Complete ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <div className="h-4 w-4 rounded-full bg-muted-foreground flex items-center justify-center">
                        <span className="text-[10px] text-white font-bold">2</span>
                      </div>
                    )}
                    <span className="text-sm font-medium">Files Assigned</span>
                  </div>
                  {step2Complete ? (
                    <p className="text-xs text-emerald-600">All samples have files</p>
                  ) : step1Complete ? (
                    <p className="text-xs text-amber-600">Waiting for files</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Submit order first</p>
                  )}
                </div>
              </div>

              {/* Shipping Instructions - shown when expanded */}
              {isSubmitted && showFullInstructions && instructions && (
                <div className="mt-4 p-4 bg-white/80 rounded-lg border border-border">
                  <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground/80 prose-li:text-foreground/80 prose-strong:text-foreground">
                    <ReactMarkdown>{instructions}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          );
        })()
      )}

      {isFacilityAdmin && order.samples.length > 0 && (
        <div className="mb-6 rounded-lg border p-5 bg-muted/30">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="font-semibold flex items-center gap-2">
                <FileCode className="h-5 w-5" />
                Admin Tools
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Development and testing utilities for this order
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {orderStudies.length > 1 ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Study</span>
                  <Select value={selectedStudyId} onValueChange={setSelectedStudyId}>
                    <SelectTrigger className="h-8 w-[220px]">
                      <SelectValue placeholder="Select study" />
                    </SelectTrigger>
                    <SelectContent>
                      {orderStudies.map((study) => (
                        <SelectItem key={study.id} value={study.id}>
                          {study.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Study:{" "}
                  <span className="text-foreground font-medium">
                    {selectedStudy?.title || "Not linked"}
                  </span>
                </div>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={handleSimulateReads}
                disabled={simulatingReads || orderStudies.length === 0}
              >
                {simulatingReads ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileCode className="h-4 w-4 mr-2" />
                )}
                Simulate Reads
              </Button>
            </div>
          </div>
          {orderStudies.length === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              No linked studies yet. Add samples to a study to simulate reads.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Order Details */}
        <GlassCard className="p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Sequencing Parameters
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Platform</span>
              <span className="font-medium">{order.platform || "Not specified"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Instrument</span>
              <span className="font-medium">{order.instrumentModel || "Not specified"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Strategy</span>
              <span className="font-medium">{order.libraryStrategy || "Not specified"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Source</span>
              <span className="font-medium">{order.librarySource || "Not specified"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Selection</span>
              <span className="font-medium">{order.librarySelection || "Not specified"}</span>
            </div>
          </div>
        </GlassCard>

        {/* Samples */}
        <GlassCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Samples ({order._count.samples})
            </h2>
            {order.status === "DRAFT" && isOwner && (
              <Button size="sm" asChild>
                <Link href={`/dashboard/orders/${order.id}/samples`}>
                  Update sample information
                </Link>
              </Button>
            )}
          </div>
          {order.samples.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
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
            <div className="space-y-3">
              {/* Show configured per-sample fields */}
              {perSampleFields.length > 0 && (
                <div className="text-sm text-muted-foreground pb-2 border-b">
                  <span className="font-medium text-foreground">Fields to fill: </span>
                  {perSampleFields.map((f) => f.label).join(", ")}
                </div>
              )}
              {order.samples.slice(0, 5).map((sample) => (
                <div
                  key={sample.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                >
                  <div>
                    <span className="font-medium">{sample.sampleId}</span>
                    {sample.sampleTitle && (
                      <span className="text-muted-foreground ml-2">
                        - {sample.sampleTitle}
                      </span>
                    )}
                  </div>
                  {sample.study && (
                    <Link
                      href={`/dashboard/studies/${sample.study.id}`}
                      className="text-sm text-primary hover:underline flex items-center gap-1"
                    >
                      <BookOpen className="h-3 w-3" />
                      {sample.study.title}
                    </Link>
                  )}
                </div>
              ))}
              {order.samples.length > 5 && (
                <p className="text-sm text-muted-foreground text-center pt-2">
                  And {order.samples.length - 5} more samples...
                </p>
              )}
            </div>
          )}
        </GlassCard>

        {/* Sequencing Files - shown when order is COMPLETED and samples have files */}
        {order.status === "COMPLETED" && order.samples.some(s => s.reads?.some(r => r.file1 || r.file2)) && (
          <GlassCard className="p-6 lg:col-span-2">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <HardDrive className="h-5 w-5" />
              Sequencing Files
            </h2>
            <div className="space-y-3">
              {order.samples.filter(s => s.reads?.some(r => r.file1 || r.file2)).map((sample) => (
                <div key={sample.id} className="p-3 rounded-lg bg-muted/30">
                  <div className="font-medium mb-2">{sample.sampleId}</div>
                  {sample.reads.filter(r => r.file1 || r.file2).map((read) => (
                    <div key={read.id} className="ml-4 space-y-1">
                      {read.file1 && (
                        <div className="flex items-center gap-2 text-sm">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground">R1:</span>
                          <span className="truncate">{read.file1.split("/").pop()}</span>
                          <a
                            href={`/api/files/download?path=${encodeURIComponent(read.file1)}`}
                            className="ml-auto text-primary hover:text-primary/80 flex items-center gap-1 shrink-0"
                          >
                            <Download className="h-4 w-4" />
                            <span>Download</span>
                          </a>
                        </div>
                      )}
                      {read.file2 && (
                        <div className="flex items-center gap-2 text-sm">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground">R2:</span>
                          <span className="truncate">{read.file2.split("/").pop()}</span>
                          <a
                            href={`/api/files/download?path=${encodeURIComponent(read.file2)}`}
                            className="ml-auto text-primary hover:text-primary/80 flex items-center gap-1 shrink-0"
                          >
                            <Download className="h-4 w-4" />
                            <span>Download</span>
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </GlassCard>
        )}

        {/* Custom Fields (if any) */}
        {order.customFields && (() => {
          const customData = JSON.parse(order.customFields);
          // Filter out internal fields like _mixsChecklist, _mixsFields
          const displayFields = Object.entries(customData).filter(
            ([key]) => !key.startsWith("_mixs")
          );
          if (displayFields.length === 0) return null;
          return (
            <GlassCard className="p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <ClipboardList className="h-5 w-5" />
                Additional Information
              </h2>
              <div className="space-y-3">
                {displayFields.map(([key, value]) => (
                  <div key={key} className="flex justify-between items-start">
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
            </GlassCard>
          );
        })()}

        {/* Status History */}
        {order.statusNotes.length > 0 && (
          <GlassCard className="p-6 lg:col-span-2">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Status History
            </h2>
            <div className="space-y-3">
              {order.statusNotes.map((note) => (
                <div
                  key={note.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-muted/30"
                >
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Clock className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{note.content}</p>
                    <p className="text-sm text-muted-foreground">
                      {note.user
                        ? `${note.user.firstName} ${note.user.lastName}`
                        : "System"}{" "}
                      • {formatDate(note.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        )}
      </div>

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
              {selectedStudy?.title
                ? `Target study: ${selectedStudy.title}`
                : "Target study: Not linked"}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {simulatingReads && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            )}

            {simulateReadsResult && (
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
                          files created
                        </p>
                        <p>
                          <span className="font-medium">
                            {simulateReadsResult.samplesProcessed}
                          </span>{" "}
                          samples processed
                        </p>
                        {simulateReadsResult.createdPath && (
                          <p className="mt-2 text-xs font-mono bg-muted p-2 rounded break-all">
                            {simulateReadsResult.createdPath}
                          </p>
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
            {simulateReadsResult ? (
              <Button onClick={() => setSimulateReadsDialogOpen(false)}>
                Close
              </Button>
            ) : (
              <Button variant="outline" disabled>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating files...
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </PageContainer>
  );
}
