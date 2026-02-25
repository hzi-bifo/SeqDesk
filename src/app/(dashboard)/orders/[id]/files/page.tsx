"use client";

import { useState, useEffect, use } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileText,
  Search,
  X,
  XCircle,
  HardDrive,
  FolderSearch,
  AlertTriangle,
  RefreshCw,
  Save,
  Download,
  FileCode,
  FlaskConical,
} from "lucide-react";
import { toast } from "sonner";

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

interface SampleFileInfo {
  sampleId: string;
  sampleAlias: string | null;
  sampleTitle: string | null;
  read1: string | null;
  read2: string | null;
  read1Exists: boolean;
  read2Exists: boolean;
  suggestedRead1: string | null;
  suggestedRead2: string | null;
  suggestionStatus: "exact" | "partial" | "ambiguous" | "none" | "assigned";
  suggestionConfidence: number;
}

interface DiscoverySuggestion {
  status: "exact" | "partial" | "ambiguous" | "none";
  read1: { relativePath: string; filename: string } | null;
  read2: { relativePath: string; filename: string } | null;
  confidence: number;
  alternatives: Array<{
    identifier: string;
    read1: { relativePath: string; filename: string };
    read2: { relativePath: string; filename: string } | null;
  }>;
}

interface DiscoveryResult {
  sampleId: string;
  sampleAlias: string | null;
  suggestion: DiscoverySuggestion;
  autoAssigned: boolean;
}

interface OrderFilesData {
  orderId: string;
  orderName: string;
  orderStatus: string;
  canAssign: boolean;
  dataBasePath: string | null;
  config: {
    allowedExtensions: string[];
    allowSingleEnd: boolean;
  };
  samples: SampleFileInfo[];
}

const STATUS_BADGES: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  assigned: { label: "Assigned", variant: "default" },
  exact: { label: "Match Found", variant: "secondary" },
  partial: { label: "Partial Match", variant: "outline" },
  ambiguous: { label: "Multiple Matches", variant: "destructive" },
  none: { label: "No Match", variant: "outline" },
};

const tabClass =
  "relative h-[52px] border-0 border-b-2 rounded-none px-4 text-sm font-medium transition-colors inline-flex items-center";
const tabInactiveClass =
  `${tabClass} border-b-transparent text-muted-foreground hover:text-foreground`;
const tabActiveClass =
  `${tabClass} border-b-foreground text-foreground`;

export default function OrderFilesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const { data: session } = useSession();
  const [data, setData] = useState<OrderFilesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);

  // Local edits (before saving)
  const [localEdits, setLocalEdits] = useState<Map<string, { read1: string | null; read2: string | null }>>(new Map());
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Discovery results
  const [discoveryResults, setDiscoveryResults] = useState<Map<string, DiscoverySuggestion>>(new Map());

  // Select file dialog
  const [selectDialogOpen, setSelectDialogOpen] = useState(false);
  const [selectingSample, setSelectingSample] = useState<{ sampleId: string; field: "read1" | "read2" } | null>(null);
  const [alternatives, setAlternatives] = useState<DiscoverySuggestion["alternatives"]>([]);

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

  const isFacilityAdmin = session?.user?.role === "FACILITY_ADMIN";

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/orders/${resolvedParams.id}/files`);
        if (!res.ok) {
          if (res.status === 404) {
            setError("Order not found");
          } else if (res.status === 403) {
            setError("You don't have permission to view this order");
          } else {
            throw new Error("Failed to fetch order files");
          }
          return;
        }
        const result = await res.json();
        setData(result);
      } catch {
        setError("Failed to load order files");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [resolvedParams.id]);

  const handleDiscover = async (force: boolean = false) => {
    setDiscovering(true);
    setError("");

    try {
      const res = await fetch(`/api/orders/${resolvedParams.id}/files/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force, autoAssign: false }),
      });

      if (!res.ok) {
        const result = await res.json();
        setError(result.error || "Failed to discover files");
        return;
      }

      const result = await res.json();

      // Update discovery results
      const newResults = new Map<string, DiscoverySuggestion>();
      const newEdits = new Map(localEdits);

      for (const item of result.results as DiscoveryResult[]) {
        newResults.set(item.sampleId, item.suggestion);

        // If exact match found and no current edit, pre-fill
        if (
          item.suggestion.status === "exact" &&
          item.suggestion.read1 &&
          !localEdits.has(item.sampleId)
        ) {
          const sample = data?.samples.find((s) => s.sampleId === item.sampleId);
          if (!sample?.read1) {
            newEdits.set(item.sampleId, {
              read1: item.suggestion.read1.relativePath,
              read2: item.suggestion.read2?.relativePath || null,
            });
          }
        }
      }

      setDiscoveryResults(newResults);
      setLocalEdits(newEdits);
      setHasUnsavedChanges(newEdits.size > 0);

      toast.success(
        `Scanned ${result.scannedFiles} files. Found ${result.summary.exactMatches} exact matches, ${result.summary.ambiguous} need manual selection.`
      );
    } catch {
      setError("Failed to discover files");
    } finally {
      setDiscovering(false);
    }
  };

  const handleSaveAll = async () => {
    if (localEdits.size === 0) return;

    setSaving(true);
    setError("");

    try {
      const assignments = Array.from(localEdits.entries()).map(([sampleId, edit]) => ({
        sampleId,
        read1: edit.read1,
        read2: edit.read2,
      }));

      const res = await fetch(`/api/orders/${resolvedParams.id}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments }),
      });

      if (!res.ok) {
        const result = await res.json();
        setError(result.error || "Failed to save assignments");
        return;
      }

      const result = await res.json();

      // Refresh data
      const refreshRes = await fetch(`/api/orders/${resolvedParams.id}/files`);
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        setData(refreshData);
      }

      setLocalEdits(new Map());
      setHasUnsavedChanges(false);
      toast.success(result.message || "Assignments saved");
    } catch {
      setError("Failed to save assignments");
    } finally {
      setSaving(false);
    }
  };

  const handleEditField = (sampleId: string, field: "read1" | "read2", value: string) => {
    const sample = data?.samples.find((s) => s.sampleId === sampleId);
    const current = localEdits.get(sampleId) || {
      read1: sample?.read1 || null,
      read2: sample?.read2 || null,
    };

    const updated = { ...current, [field]: value || null };
    const newEdits = new Map(localEdits);
    newEdits.set(sampleId, updated);
    setLocalEdits(newEdits);
    setHasUnsavedChanges(true);
  };

  const handleClearSample = (sampleId: string) => {
    const newEdits = new Map(localEdits);
    newEdits.set(sampleId, { read1: null, read2: null });
    setLocalEdits(newEdits);
    setHasUnsavedChanges(true);
  };

  const handleSelectAlternative = (alternative: { identifier: string; read1: { relativePath: string }; read2: { relativePath: string } | null }) => {
    if (!selectingSample) return;

    const sample = data?.samples.find((s) => s.sampleId === selectingSample.sampleId);
    const current = localEdits.get(selectingSample.sampleId) || {
      read1: sample?.read1 || null,
      read2: sample?.read2 || null,
    };

    const newEdits = new Map(localEdits);
    newEdits.set(selectingSample.sampleId, {
      ...current,
      read1: alternative.read1.relativePath,
      read2: alternative.read2?.relativePath || null,
    });
    setLocalEdits(newEdits);
    setHasUnsavedChanges(true);
    setSelectDialogOpen(false);
    setSelectingSample(null);
  };

  const openAlternativesDialog = (sampleId: string, field: "read1" | "read2") => {
    const suggestion = discoveryResults.get(sampleId);
    if (suggestion && suggestion.alternatives.length > 0) {
      setAlternatives(suggestion.alternatives);
      setSelectingSample({ sampleId, field });
      setSelectDialogOpen(true);
    }
  };

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
      const res = await fetch(`/api/orders/${resolvedParams.id}/simulate-reads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairedEnd: true,
          createRecords: true,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        setSimulateReadsResult({
          success: false,
          error: result.error || "Failed to create simulated read files",
        });
      } else {
        setSimulateReadsResult({
          success: true,
          createdPath: result.createdPath,
          filesCreated: result.filesCreated,
          oldFilesRemoved: result.oldFilesRemoved,
          samplesProcessed: result.samplesProcessed,
          files: result.files,
        });
        // Refresh file assignments after simulate
        setTimeout(async () => {
          const refreshRes = await fetch(`/api/orders/${resolvedParams.id}/files`);
          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            setData(refreshData);
          }
        }, 500);
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

  const getDisplayValue = (sample: SampleFileInfo, field: "read1" | "read2"): string | null => {
    const edit = localEdits.get(sample.sampleId);
    if (edit) {
      return edit[field];
    }
    return sample[field];
  };

  const getSampleStatus = (sample: SampleFileInfo): string => {
    const edit = localEdits.get(sample.sampleId);
    if (edit && (edit.read1 || edit.read2)) {
      return "assigned";
    }
    if (sample.read1 || sample.read2) {
      return "assigned";
    }
    const suggestion = discoveryResults.get(sample.sampleId);
    if (suggestion) {
      return suggestion.status;
    }
    return sample.suggestionStatus || "none";
  };

  if (loading) {
    return (
      <PageContainer className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </PageContainer>
    );
  }

  if (error && !data) {
    return (
      <>
        <div className="sticky top-0 z-30 bg-card border-b border-border">
          <div className="flex items-center h-[52px] px-6 lg:px-8">
            <Link
              href="/orders"
              className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-secondary transition-colors flex-shrink-0 mr-3"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Link>
            <span className="text-sm font-medium truncate">Order</span>
          </div>
        </div>
        <PageContainer>
          <div className="bg-card rounded-lg border p-8 text-center">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <h2 className="text-xl font-semibold mb-2">Error</h2>
            <p className="text-muted-foreground">{error}</p>
          </div>
        </PageContainer>
      </>
    );
  }

  if (!data) return null;

  const canEdit = data.canAssign && isFacilityAdmin;
  const assignedSamples = data.samples.filter((sample) => {
    const read1Value = getDisplayValue(sample, "read1");
    const read2Value = getDisplayValue(sample, "read2");
    return Boolean(read1Value || read2Value);
  }).length;

  return (
    <>
      {/* Sticky header bar - matches order detail page */}
      <div className="sticky top-0 z-30 bg-card border-b border-border">
        <div className="flex items-center h-[52px] px-6 lg:px-8">
          <Link
            href="/orders"
            className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-secondary transition-colors flex-shrink-0 mr-3"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Link>
          <span className="text-sm font-medium truncate">{data.orderName}</span>

          {/* Tabs - centered */}
          <div className="flex-1 flex justify-center">
            <nav className="flex h-[52px] gap-1">
              <Link
                href={`/orders/${resolvedParams.id}`}
                className={tabInactiveClass}
              >
                Overview
              </Link>
              <Link
                href={`/orders/${resolvedParams.id}`}
                className={tabInactiveClass}
              >
                Read Files
              </Link>
              <span className={tabActiveClass}>
                Manage Files
              </span>
            </nav>
          </div>

          <div className="flex-shrink-0" />
        </div>
      </div>

      <PageContainer>
        {canEdit && (
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Assign sequencing files to samples for this order.
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleDiscover(false)}
                disabled={discovering || !data.dataBasePath}
              >
                {discovering ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FolderSearch className="h-4 w-4 mr-2" />
                )}
                Auto-Detect
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleDiscover(true)}
                disabled={discovering || !data.dataBasePath}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Rescan
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleSimulateReadsClick}
                disabled={simulatingReads || data.samples.length === 0}
              >
                {simulatingReads ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileCode className="h-4 w-4 mr-2" />
                )}
                Simulate Reads
              </Button>
              {hasUnsavedChanges && (
                <Button size="sm" onClick={handleSaveAll} disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save Changes
                </Button>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            {error}
          </div>
        )}

        {!data.dataBasePath && (
          <div className="mb-4 p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            <span>
              Data base path not configured.{" "}
              {isFacilityAdmin && (
                <Link href="/admin/settings" className="underline">
                  Configure in Settings
                </Link>
              )}
            </span>
          </div>
        )}

        {hasUnsavedChanges && (
          <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4" />
              You have unsaved changes
            </span>
            <Button size="sm" className="h-7 text-xs" onClick={handleSaveAll} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
              Save Now
            </Button>
          </div>
        )}

        <div className="bg-card rounded-lg border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              Samples ({data.samples.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              {assignedSamples} of {data.samples.length} assigned
            </p>
          </div>

          {data.samples.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border-t">
              <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>No samples in this order yet</p>
            </div>
          ) : (
            <div className="border-t">
              <Table>
                <TableHeader className="[&_tr]:bg-muted/40">
                  <TableRow className="hover:bg-muted/40">
                    <TableHead className="w-[160px] px-3 py-2 text-xs text-muted-foreground">Sample ID</TableHead>
                    <TableHead className="w-[220px] px-3 py-2 text-xs text-muted-foreground">Alias</TableHead>
                    <TableHead className="px-3 py-2 text-xs text-muted-foreground">Read 1 (Forward)</TableHead>
                    <TableHead className="px-3 py-2 text-xs text-muted-foreground">Read 2 (Reverse)</TableHead>
                    <TableHead className="w-[150px] px-3 py-2 text-xs text-muted-foreground">Status</TableHead>
                    {canEdit && <TableHead className="w-[100px] px-3 py-2 text-xs text-muted-foreground">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.samples.map((sample) => {
                    const read1Value = getDisplayValue(sample, "read1");
                    const read2Value = getDisplayValue(sample, "read2");
                    const status = getSampleStatus(sample);
                    const suggestion = discoveryResults.get(sample.sampleId);
                    const hasAlternatives = suggestion && suggestion.alternatives.length > 0;

                    return (
                      <TableRow key={sample.sampleId}>
                        <TableCell className="px-3 py-2">
                          <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                            {sample.sampleId}
                          </code>
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <div className="min-w-[170px]">
                            <p className="text-sm text-foreground">{sample.sampleAlias || "-"}</p>
                            {sample.sampleTitle && (
                              <p className="text-xs text-muted-foreground truncate">{sample.sampleTitle}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          {canEdit ? (
                            <div className="flex items-center gap-2 min-w-[320px]">
                              <Input
                                value={read1Value || ""}
                                onChange={(e) => handleEditField(sample.sampleId, "read1", e.target.value)}
                                placeholder="No file assigned"
                                className="h-8 text-sm"
                              />
                              {hasAlternatives && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  onClick={() => openAlternativesDialog(sample.sampleId, "read1")}
                                  title="Select from detected alternatives"
                                >
                                  <Search className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 min-w-[250px]">
                              {read1Value ? (
                                <>
                                  <FileText className="h-4 w-4 text-muted-foreground" />
                                  <span className="text-sm truncate max-w-[300px]" title={read1Value}>
                                    {read1Value.split("/").pop()}
                                  </span>
                                  {sample.read1 && !sample.read1Exists && (
                                    <span title="File not found">
                                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                                    </span>
                                  )}
                                  {sample.read1 && sample.read1Exists && (
                                    <a
                                      href={`/api/files/download?path=${encodeURIComponent(read1Value)}`}
                                      title="Download"
                                      className="text-primary hover:text-primary/80"
                                    >
                                      <Download className="h-4 w-4" />
                                    </a>
                                  )}
                                </>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          {canEdit ? (
                            <div className="min-w-[320px]">
                              <Input
                                value={read2Value || ""}
                                onChange={(e) => handleEditField(sample.sampleId, "read2", e.target.value)}
                                placeholder="No file assigned"
                                className="h-8 text-sm"
                              />
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 min-w-[250px]">
                              {read2Value ? (
                                <>
                                  <FileText className="h-4 w-4 text-muted-foreground" />
                                  <span className="text-sm truncate max-w-[300px]" title={read2Value}>
                                    {read2Value.split("/").pop()}
                                  </span>
                                  {sample.read2 && !sample.read2Exists && (
                                    <span title="File not found">
                                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                                    </span>
                                  )}
                                  {sample.read2 && sample.read2Exists && (
                                    <a
                                      href={`/api/files/download?path=${encodeURIComponent(read2Value)}`}
                                      title="Download"
                                      className="text-primary hover:text-primary/80"
                                    >
                                      <Download className="h-4 w-4" />
                                    </a>
                                  )}
                                </>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <Badge variant={STATUS_BADGES[status]?.variant || "outline"}>
                            {status === "assigned" && read1Value ? (
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                            ) : null}
                            {STATUS_BADGES[status]?.label || status}
                          </Badge>
                        </TableCell>
                        {canEdit && (
                          <TableCell className="px-3 py-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => handleClearSample(sample.sampleId)}
                              disabled={!read1Value && !read2Value}
                              title="Clear sample assignment"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Select from alternatives dialog */}
        <Dialog open={selectDialogOpen} onOpenChange={setSelectDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Select File Pair</DialogTitle>
              <DialogDescription>
                Multiple matches found for this sample. Select the correct file pair.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {alternatives.map((alt, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg border hover:border-primary cursor-pointer transition-colors"
                  onClick={() => handleSelectAlternative(alt)}
                >
                  <div className="font-medium mb-1">{alt.identifier}</div>
                  <div className="text-sm text-muted-foreground">
                    <div>R1: {alt.read1.filename}</div>
                    {alt.read2 && <div>R2: {alt.read2.filename}</div>}
                  </div>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectDialogOpen(false)}>
                Cancel
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
              {simulateReadsPhase === "confirm" && data && (
                <div className="space-y-3">
                  <div className="text-sm">
                    This will create paired-end FASTQ files (R1 + R2) for{" "}
                    <span className="font-medium">{data.samples.length}</span>{" "}
                    sample{data.samples.length !== 1 ? "s" : ""}.
                  </div>
                  {(() => {
                    const samplesWithReads = data.samples.filter(
                      (s) => s.read1 || s.read2
                    );
                    if (samplesWithReads.length === 0) return null;
                    return (
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                        <div className="text-sm font-medium text-amber-800 mb-2 flex items-center gap-1.5">
                          <AlertCircle className="h-4 w-4" />
                          Existing files will be replaced
                        </div>
                        <div className="text-xs text-amber-700 space-y-1">
                          <p>
                            {samplesWithReads.length} sample{samplesWithReads.length !== 1 ? "s" : ""}{" "}
                            already {samplesWithReads.length !== 1 ? "have" : "has"} read files.
                          </p>
                          <div className="mt-2 max-h-[120px] overflow-y-auto space-y-0.5">
                            {samplesWithReads.map((s) => (
                              <div key={s.sampleId} className="flex items-center gap-1.5">
                                <FlaskConical className="h-3 w-3 flex-shrink-0" />
                                <span className="font-medium">{s.sampleId}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
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
    </>
  );
}
