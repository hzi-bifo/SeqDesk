"use client";

import { useState, useEffect, use } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
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
  HardDrive,
  FolderSearch,
  AlertTriangle,
  RefreshCw,
  Save,
  Download,
} from "lucide-react";
import { toast } from "sonner";

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
      <PageContainer>
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href={`/dashboard/orders/${resolvedParams.id}`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Order
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

  if (!data) return null;

  const canEdit = data.canAssign && isFacilityAdmin;

  return (
    <PageContainer>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href={`/dashboard/orders/${resolvedParams.id}`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Order
          </Link>
        </Button>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center">
              <HardDrive className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Sequencing Files</h1>
              <p className="text-muted-foreground mt-1">
                Assign sequencing files to samples
              </p>
            </div>
          </div>

          {canEdit && (
            <div className="flex items-center gap-2">
              <Button
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
                variant="outline"
                onClick={() => handleDiscover(true)}
                disabled={discovering || !data.dataBasePath}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Rescan
              </Button>
              {hasUnsavedChanges && (
                <Button onClick={handleSaveAll} disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save Changes
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

      {!data.dataBasePath && (
        <div className="mb-6 p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 flex items-center gap-2">
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
        <div className="mb-6 p-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            You have unsaved changes
          </span>
          <Button size="sm" onClick={handleSaveAll} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Save Now
          </Button>
        </div>
      )}

      <GlassCard className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[150px]">Sample ID</TableHead>
              <TableHead className="w-[150px]">Alias</TableHead>
              <TableHead>Read 1 (Forward)</TableHead>
              <TableHead>Read 2 (Reverse)</TableHead>
              <TableHead className="w-[140px]">Status</TableHead>
              {canEdit && <TableHead className="w-[100px]">Actions</TableHead>}
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
                  <TableCell className="font-medium">{sample.sampleId}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {sample.sampleAlias || "-"}
                  </TableCell>
                  <TableCell>
                    {canEdit ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={read1Value || ""}
                          onChange={(e) => handleEditField(sample.sampleId, "read1", e.target.value)}
                          placeholder="No file assigned"
                          className="h-8 text-sm"
                        />
                        {hasAlternatives && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openAlternativesDialog(sample.sampleId, "read1")}
                          >
                            <Search className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
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
                  <TableCell>
                    {canEdit ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={read2Value || ""}
                          onChange={(e) => handleEditField(sample.sampleId, "read2", e.target.value)}
                          placeholder="No file assigned"
                          className="h-8 text-sm"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
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
                  <TableCell>
                    <Badge variant={STATUS_BADGES[status]?.variant || "outline"}>
                      {status === "assigned" && read1Value ? (
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                      ) : null}
                      {STATUS_BADGES[status]?.label || status}
                    </Badge>
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleClearSample(sample.sampleId)}
                        disabled={!read1Value && !read2Value}
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
      </GlassCard>

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
    </PageContainer>
  );
}
