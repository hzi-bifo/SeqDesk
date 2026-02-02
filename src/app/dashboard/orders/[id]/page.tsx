"use client";

import { useState, useEffect, use } from "react";
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
  FileText,
  User,
  Mail,
  Phone,
  MapPin,
  Settings,
  ArrowRight,
  Pencil,
  Trash2,
  Send,
  ClipboardList,
  BookOpen,
  FolderOpen,
  Info,
  HardDrive,
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
  { key: "READY_FOR_SEQUENCING", label: "Ready for Sequencing", description: "Waiting for sequencing facility to process" },
  { key: "SEQUENCING_IN_PROGRESS", label: "Sequencing in Progress", description: "Samples are being sequenced" },
  { key: "SEQUENCING_COMPLETED", label: "Sequencing Completed", description: "Sequencing finished, data being prepared" },
  { key: "DATA_PROCESSING", label: "Data Processing", description: "Bioinformatics analysis in progress" },
  { key: "DATA_DELIVERED", label: "Data Delivered", description: "Sequencing data has been delivered" },
  { key: "COMPLETED", label: "Completed", description: "Order workflow finished" },
];

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-500",
  READY_FOR_SEQUENCING: "bg-blue-500",
  SEQUENCING_IN_PROGRESS: "bg-yellow-500",
  SEQUENCING_COMPLETED: "bg-purple-500",
  DATA_PROCESSING: "bg-orange-500",
  DATA_DELIVERED: "bg-green-500",
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
  const [markReadyDialogOpen, setMarkReadyDialogOpen] = useState(false);

  // Post-submission instructions
  const [instructions, setInstructions] = useState<string | null>(null);
  const [showFullInstructions, setShowFullInstructions] = useState(false);

  // Form config for showing per-sample fields
  const [perSampleFields, setPerSampleFields] = useState<Array<{ name: string; label: string }>>([]);

  const isResearcher = session?.user?.role === "RESEARCHER";
  const isFacilityAdmin = session?.user?.role === "FACILITY_ADMIN";
  const isOwner = order?.user.id === session?.user?.id;

  useEffect(() => {
    const fetchOrder = async () => {
      try {
        const res = await fetch(`/api/orders/${resolvedParams.id}`);
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
        setLoading(false);
      }
    };

    fetchOrder();
  }, [resolvedParams.id]);

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

  const currentStatusIndex = order ? STATUS_ORDER.findIndex(s => s.key === order.status) : -1;

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
            {(isOwner || isFacilityAdmin) && order.status === "DRAFT" && order.samples.length > 0 && (
              <Button
                size="sm"
                onClick={() => setMarkReadyDialogOpen(true)}
                disabled={updating}
              >
                {updating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Mark as Ready
              </Button>
            )}
            {isFacilityAdmin && order.status !== "DRAFT" && (
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
          const isSubmitted = order.status !== "DRAFT";
          const isSequenced = order.status === "SEQUENCING_COMPLETED" ||
                              order.status === "DATA_PROCESSING" ||
                              order.status === "DATA_DELIVERED" ||
                              order.status === "COMPLETED";

          // Determine completion status for each step
          const step1Complete = true; // Order created (always true on this page)
          const step2Complete = order.samples.length > 0; // Samples added
          const step3Complete = isSubmitted; // Order submitted (physical samples being shipped)
          const step4Complete = isSequenced; // Sequencing completed

          return (
            <div className="mb-6 bg-gradient-to-r from-secondary to-emerald-50/50 rounded-xl border border-border p-5">
              <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-blue-600" />
                Order Progress
              </h3>
              <div className="grid grid-cols-4 gap-3">
                {/* Step 1: Order Created */}
                <div className={`relative p-3 rounded-lg ${step1Complete ? 'bg-white border-2 border-emerald-200' : 'bg-white/50 border border-border'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {step1Complete ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <div className="h-4 w-4 rounded-full bg-muted-foreground flex items-center justify-center">
                        <span className="text-[10px] text-white font-bold">1</span>
                      </div>
                    )}
                    <span className="text-sm font-medium">Create Order</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Order details submitted</p>
                </div>

                {/* Step 2: Add Samples */}
                <div className={`relative p-3 rounded-lg ${step2Complete ? 'bg-white border-2 border-emerald-200' : 'bg-white/50 border border-border'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {step2Complete ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <div className="h-4 w-4 rounded-full bg-muted-foreground flex items-center justify-center">
                        <span className="text-[10px] text-white font-bold">2</span>
                      </div>
                    )}
                    <span className="text-sm font-medium">Add Samples</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{order.samples.length} sample{order.samples.length !== 1 ? 's' : ''} added</p>
                </div>

                {/* Step 3: Mark as Ready - available after adding samples */}
                <div className={`relative p-3 rounded-lg ${step3Complete ? 'bg-white border-2 border-emerald-200' : 'bg-white/50 border border-border'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {step3Complete ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <div className="h-4 w-4 rounded-full bg-muted-foreground flex items-center justify-center">
                        <span className="text-[10px] text-white font-bold">3</span>
                      </div>
                    )}
                    <span className="text-sm font-medium">Mark as Ready</span>
                  </div>
                  {step3Complete ? (
                    <p className="text-xs text-emerald-600">Ready for facility</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Notify facility</p>
                  )}
                  {!step3Complete && step2Complete && (
                    <button
                      onClick={() => setMarkReadyDialogOpen(true)}
                      disabled={updating}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
                    >
                      {updating ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Updating...
                        </>
                      ) : (
                        <>
                          Mark as Ready <Send className="h-3 w-3" />
                        </>
                      )}
                    </button>
                  )}
                  {!step3Complete && !step2Complete && (
                    <p className="mt-2 text-xs text-muted-foreground/60">Add samples first</p>
                  )}
                  {step3Complete && instructions && (
                    <button
                      onClick={() => setShowFullInstructions(!showFullInstructions)}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      <Info className="h-3 w-3" />
                      {showFullInstructions ? "Hide Instructions" : "View Instructions"}
                    </button>
                  )}
                </div>

                {/* Step 4: Sequenced */}
                <div className={`relative p-3 rounded-lg ${step4Complete ? 'bg-white border-2 border-emerald-200' : 'bg-white/50 border border-border'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {step4Complete ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <div className="h-4 w-4 rounded-full bg-muted-foreground flex items-center justify-center">
                        <span className="text-[10px] text-white font-bold">4</span>
                      </div>
                    )}
                    <span className="text-sm font-medium">Sequenced</span>
                  </div>
                  {step4Complete ? (
                    <p className="text-xs text-emerald-600">Data ready</p>
                  ) : step3Complete ? (
                    <p className="text-xs text-amber-600">In progress</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Awaiting samples</p>
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

              {/* Admin controls for submitted orders */}
              {isSubmitted && isFacilityAdmin && currentStatusIndex < STATUS_ORDER.length - 1 && (
                <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Admin: Advance order status</span>
                  <Button
                    size="sm"
                    onClick={() => handleStatusChange(STATUS_ORDER[currentStatusIndex + 1].key)}
                    disabled={updating}
                  >
                    {updating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <ArrowRight className="h-4 w-4 mr-2" />
                    )}
                    Advance to {STATUS_ORDER[currentStatusIndex + 1].label}
                  </Button>
                </div>
              )}
            </div>
          );
        })()
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

      {/* Mark as Ready Confirmation Dialog */}
      <Dialog open={markReadyDialogOpen} onOpenChange={setMarkReadyDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Order as Ready</DialogTitle>
            <DialogDescription>
              Mark this order as ready for sequencing? The sequencing facility will be notified and can begin processing your samples.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkReadyDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setMarkReadyDialogOpen(false);
                handleStatusChange("READY_FOR_SEQUENCING");
              }}
              disabled={updating}
            >
              {updating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Mark as Ready
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
