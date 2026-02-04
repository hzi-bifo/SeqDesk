"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageContainer } from "@/components/layout/PageContainer";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  AlertCircle,
  Search,
  RefreshCw,
  FileText,
  CheckCircle2,
  FolderOpen,
  AlertTriangle,
  FlaskConical,
  Link as LinkIcon,
  ChevronDown,
  Trash2,
  XCircle,
} from "lucide-react";

interface FileWithAssignment {
  relativePath: string;
  filename: string;
  size: number;
  modifiedAt: string;
  assigned: boolean;
  readType: "R1" | "R2" | null;
  pairStatus: "paired" | "missing_r1" | "missing_r2" | "unknown" | null;
  checksum: string | null;
  assignedTo?: {
    sampleId: string;
    sampleAlias: string | null;
    orderId: string;
    orderName: string;
    readField: "file1" | "file2";
    studyId: string | null;
    studyTitle: string | null;
  };
}

interface FilesResponse {
  files: FileWithAssignment[];
  total: number;
  assigned: number;
  unassigned: number;
  filtered: number;
  dataBasePath: string | null;
  config: {
    allowedExtensions: string[];
    scanDepth: number;
  };
  error?: string;
}

interface SampleForAssignment {
  id: string;
  sampleId: string;
  sampleAlias: string | null;
  sampleTitle: string | null;
  orderId: string;
  orderNumber: string;
  orderName: string | null;
  orderStatus: string;
  hasR1: boolean;
  hasR2: boolean;
  currentR1: string | null;
  currentR2: string | null;
  matchScore: number;
  matchType: "exact" | "strong" | "partial" | "none";
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Detect if filename is R1 or R2
function detectReadType(filename: string): "file1" | "file2" | null {
  const lower = filename.toLowerCase();
  // R2 patterns
  if (/_r2[._]/.test(lower) || /\.r2[._]/.test(lower) || /_2\./.test(lower)) {
    return "file2";
  }
  // R1 patterns
  if (/_r1[._]/.test(lower) || /\.r1[._]/.test(lower) || /_1\./.test(lower)) {
    return "file1";
  }
  return null;
}

export default function FileBrowserPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<FilesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "assigned" | "unassigned">("all");
  const [extension, setExtension] = useState("all");

  // Bulk selection state
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  // Bulk delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{
    success: boolean;
    error?: string;
    deletedCount?: number;
    recordsRemoved?: number;
  } | null>(null);

  // Assignment dialog state
  const [selectedFile, setSelectedFile] = useState<FileWithAssignment | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [sampleSearch, setSampleSearch] = useState("");
  const [matchingSamples, setMatchingSamples] = useState<SampleForAssignment[]>([]);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [assignSuccess, setAssignSuccess] = useState("");

  // Toggle file selection
  const toggleFileSelection = (relativePath: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(relativePath)) {
        next.delete(relativePath);
      } else {
        next.add(relativePath);
      }
      return next;
    });
  };

  // Select/deselect all visible files
  const toggleSelectAll = () => {
    if (!data) return;
    const allPaths = data.files.map((f) => f.relativePath);
    const allSelected = allPaths.every((p) => selectedFiles.has(p));
    if (allSelected) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(allPaths));
    }
  };

  const isFacilityAdmin = session?.user?.role === "FACILITY_ADMIN";

  const fetchFiles = async (force: boolean = false) => {
    if (force) {
      setScanning(true);
    }
    setError("");

    try {
      const params = new URLSearchParams();
      if (force) params.set("force", "true");
      if (filter !== "all") params.set("filter", filter);
      if (search) params.set("search", search);
      if (extension !== "all") params.set("extension", extension);

      const res = await fetch(`/api/files?${params.toString()}`);
      if (!res.ok) {
        if (res.status === 403) {
          setError("You don't have permission to access the file browser");
        } else {
          throw new Error("Failed to fetch files");
        }
        return;
      }
      const result = await res.json();
      setData(result);
      if (result.error) {
        setError(result.error);
      }
    } catch {
      setError("Failed to load files");
    } finally {
      setLoading(false);
      setScanning(false);
    }
  };

  const searchSamples = useCallback(async (searchTerm: string) => {
    if (!selectedFile) return;

    setLoadingSamples(true);
    try {
      const detectedType = detectReadType(selectedFile.filename);
      const params = new URLSearchParams();
      if (searchTerm) params.set("search", searchTerm);
      // Pass filename for match scoring
      params.set("filename", selectedFile.filename);
      // Filter samples that need this read type
      if (detectedType === "file1") {
        params.set("needsR1", "true");
      } else if (detectedType === "file2") {
        params.set("needsR2", "true");
      }
      params.set("limit", "30");

      const res = await fetch(`/api/files/samples?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setMatchingSamples(data.samples);
      }
    } catch {
      // ignore
    } finally {
      setLoadingSamples(false);
    }
  }, [selectedFile]);

  const handleFileClick = (file: FileWithAssignment) => {
    setSelectedFile(file);
    setAssignDialogOpen(true);
    setAssignError("");
    setAssignSuccess("");
    setSampleSearch("");
    setMatchingSamples([]);

    // Initial search with empty string to show recent samples
    setTimeout(() => searchSamples(""), 100);
  };

  const handleAssign = async (sample: SampleForAssignment) => {
    if (!selectedFile) return;

    setAssigning(true);
    setAssignError("");
    setAssignSuccess("");

    try {
      const detectedType = detectReadType(selectedFile.filename);

      const res = await fetch("/api/files/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: selectedFile.relativePath,
          sampleId: sample.id,
          readField: detectedType,
          force: selectedFile.assigned, // Allow re-assignment if file is already assigned
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setAssignError(data.error || "Failed to assign file");
        return;
      }

      const action = selectedFile.assigned ? "Re-assigned" : "Assigned";
      setAssignSuccess(`${action} to ${sample.sampleId} as ${detectedType === "file1" ? "Read 1" : "Read 2"}`);

      // Refresh files list after short delay
      setTimeout(() => {
        setAssignDialogOpen(false);
        fetchFiles();
      }, 1000);
    } catch {
      setAssignError("Failed to assign file");
    } finally {
      setAssigning(false);
    }
  };

  const handleBulkDeleteClick = () => {
    setDeleteResult(null);
    setDeleteDialogOpen(true);
  };

  const handleBulkDeleteConfirm = async () => {
    setDeleting(true);
    setDeleteResult(null);

    try {
      const res = await fetch("/api/files/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePaths: Array.from(selectedFiles),
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        setDeleteResult({
          success: false,
          error: result.error || "Failed to delete files",
        });
        return;
      }

      setDeleteResult({
        success: true,
        deletedCount: result.deletedCount,
        recordsRemoved: result.recordsRemoved,
      });

      // Refresh file list (force re-scan) and clear selection after a short delay
      setTimeout(() => {
        setSelectedFiles(new Set());
        setDeleteDialogOpen(false);
        fetchFiles(true);
      }, 1500);
    } catch {
      setDeleteResult({
        success: false,
        error: "Failed to delete files",
      });
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [filter, extension]);

  // Debounced search for files
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!loading) {
        fetchFiles();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Debounced search for samples in dialog
  useEffect(() => {
    if (!assignDialogOpen) return;

    const timer = setTimeout(() => {
      searchSamples(sampleSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [sampleSearch, assignDialogOpen, searchSamples]);

  if (!isFacilityAdmin) {
    return (
      <PageContainer>
        <div className="bg-card rounded-lg p-8 text-center border border-border">
          <AlertCircle className="h-10 w-10 mx-auto mb-3 text-destructive" />
          <h2 className="text-lg font-medium mb-2">Access Denied</h2>
          <p className="text-sm text-muted-foreground">
            Only facility administrators can access the file browser.
          </p>
        </div>
      </PageContainer>
    );
  }

  if (loading) {
    return (
      <PageContainer className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </PageContainer>
    );
  }

  const detectedType = selectedFile ? detectReadType(selectedFile.filename) : null;

  return (
    <PageContainer>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Sequencing Files</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data
              ? <>{data.total} file{data.total !== 1 ? "s" : ""}{data.assigned > 0 && <span className="text-green-600"> · {data.assigned} assigned</span>}{data.unassigned > 0 && <span className="text-amber-600"> · {data.unassigned} unassigned</span>}</>
              : "Loading..."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchFiles(true)}
          disabled={scanning}
        >
          {scanning ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Scan Now
        </Button>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {!data?.dataBasePath && (
        <div className="mb-6 p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          <span>
            Data base path not configured.{" "}
            <Link href="/admin/settings" className="underline">
              Configure in Settings
            </Link>
          </span>
        </div>
      )}

      {/* Bulk Selection Actions */}
      {selectedFiles.size > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-primary/5 border border-primary/20 flex items-center justify-between">
          <span className="text-sm font-medium">
            {selectedFiles.size} file{selectedFiles.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={handleBulkDeleteClick}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Selected
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedFiles(new Set())}
            >
              Clear Selection
            </Button>
          </div>
        </div>
      )}

      {/* File Table */}
      <div className="bg-card rounded-lg overflow-hidden border border-border">
        {/* Search & Filters */}
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search files, samples, orders..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm bg-secondary border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="relative">
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as typeof filter)}
                className="appearance-none pl-3 pr-8 py-2 text-sm bg-secondary border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
              >
                <option value="all">All Files</option>
                <option value="assigned">Assigned</option>
                <option value="unassigned">Unassigned</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>

            <div className="relative">
              <select
                value={extension}
                onChange={(e) => setExtension(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 text-sm bg-secondary border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
              >
                <option value="all">All Extensions</option>
                {data?.config?.allowedExtensions?.map((ext) => (
                  <option key={ext} value={ext}>{ext}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Table Header */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/50">
                <TableHead className="w-[40px]">
                  <Checkbox
                    checked={data?.files.length ? data.files.every((f) => selectedFiles.has(f.relativePath)) : false}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Filename</TableHead>
                <TableHead className="w-[60px]">Type</TableHead>
                <TableHead className="w-[90px]">Pair</TableHead>
                <TableHead className="w-[80px]">Size</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead>Study</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.files.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12">
                    <FolderOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                    <p className="text-muted-foreground">
                      {data.total === 0
                        ? "No sequencing files found in the configured path"
                        : "No files match the current filters"}
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                data?.files.map((file) => (
                  <TableRow
                    key={file.relativePath}
                    className={`cursor-pointer hover:bg-primary/5 transition-colors ${
                      selectedFiles.has(file.relativePath) ? "bg-primary/5" : ""
                    }`}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedFiles.has(file.relativePath)}
                        onCheckedChange={() => toggleFileSelection(file.relativePath)}
                      />
                    </TableCell>
                    <TableCell onClick={() => handleFileClick(file)}>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="font-medium truncate max-w-[200px] block">{file.filename}</span>
                        <LinkIcon className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
                      </div>
                    </TableCell>
                    <TableCell onClick={() => handleFileClick(file)}>
                      {file.readType ? (
                        <Badge variant="outline" className={
                          file.readType === "R1" ? "border-blue-300 text-blue-700" : "border-purple-300 text-purple-700"
                        }>
                          {file.readType}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </TableCell>
                    <TableCell onClick={() => handleFileClick(file)}>
                      {file.pairStatus === "paired" ? (
                        <Badge variant="outline" className="border-green-300 text-green-700 text-xs">
                          Paired
                        </Badge>
                      ) : file.pairStatus === "missing_r1" ? (
                        <Badge variant="outline" className="border-red-300 text-red-600 text-xs">
                          No R1
                        </Badge>
                      ) : file.pairStatus === "missing_r2" ? (
                        <Badge variant="outline" className="border-red-300 text-red-600 text-xs">
                          No R2
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </TableCell>
                    <TableCell onClick={() => handleFileClick(file)} className="text-muted-foreground text-sm">
                      {formatFileSize(file.size)}
                    </TableCell>
                    <TableCell onClick={() => handleFileClick(file)}>
                      {file.assigned ? (
                        <Badge
                          variant="default"
                          className="bg-green-600 text-xs cursor-default"
                          title={file.assignedTo ? `${file.assignedTo.sampleId}${file.assignedTo.studyTitle ? ` · ${file.assignedTo.studyTitle}` : ""}${file.assignedTo.orderName ? ` · ${file.assignedTo.orderName}` : ""}` : undefined}
                        >
                          Assigned
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-300 text-amber-700 text-xs">
                          Unassigned
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell onClick={() => handleFileClick(file)}>
                      {file.assignedTo?.studyTitle ? (
                        <Link
                          href={`/dashboard/studies/${file.assignedTo.studyId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm text-primary hover:underline truncate max-w-[150px] block"
                        >
                          {file.assignedTo.studyTitle}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          </Table>
        </div>
      </div>

      {/* Path info */}
      {data?.dataBasePath && (
        <div className="mt-4 text-sm text-muted-foreground">
          Scanning: <code className="bg-muted px-2 py-1 rounded">{data.dataBasePath}</code>
          {" "}(depth: {data.config.scanDepth})
        </div>
      )}

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (!deleting) setDeleteDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Delete Files
            </DialogTitle>
            <DialogDescription>
              {deleteResult
                ? deleteResult.success
                  ? "Files deleted successfully"
                  : "Failed to delete files"
                : "This action cannot be undone."}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {!deleteResult && !deleting && (() => {
              const selectedFilesList = data?.files.filter(f => selectedFiles.has(f.relativePath)) || [];
              const assignedCount = selectedFilesList.filter(f => f.assigned).length;
              return (
                <div className="space-y-3">
                  <p className="text-sm">
                    You are about to delete{" "}
                    <span className="font-medium">{selectedFiles.size}</span>{" "}
                    file{selectedFiles.size !== 1 ? "s" : ""} from disk.
                  </p>
                  {assignedCount > 0 && (
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                      <div className="text-sm font-medium text-amber-800 flex items-center gap-1.5 mb-1">
                        <AlertTriangle className="h-4 w-4" />
                        {assignedCount} file{assignedCount !== 1 ? "s are" : " is"} assigned to samples
                      </div>
                      <p className="text-xs text-amber-700">
                        Deleting will remove the file assignments from their samples.
                      </p>
                    </div>
                  )}
                  <div className="max-h-[200px] overflow-y-auto border rounded-lg divide-y">
                    {selectedFilesList.map((f) => (
                      <div key={f.relativePath} className="px-3 py-2 text-xs flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="truncate">{f.filename}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-muted-foreground">{formatFileSize(f.size)}</span>
                          {f.assigned && (
                            <Badge variant="default" className="bg-green-600 text-[10px]">Assigned</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {deleting && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            )}

            {deleteResult && (
              <div
                className={`p-4 rounded-lg border ${
                  deleteResult.success
                    ? "bg-green-50 border-green-200"
                    : "bg-red-50 border-red-200"
                }`}
              >
                <div className="text-center">
                  {deleteResult.success ? (
                    <>
                      <CheckCircle2 className="h-6 w-6 text-green-600 mx-auto mb-2" />
                      <p className="font-medium">Deleted Successfully</p>
                      <div className="mt-2 text-sm text-muted-foreground space-y-1">
                        <p>
                          <span className="font-medium">{deleteResult.deletedCount}</span>{" "}
                          file{deleteResult.deletedCount !== 1 ? "s" : ""} removed
                        </p>
                        {(deleteResult.recordsRemoved ?? 0) > 0 && (
                          <p>
                            <span className="font-medium">{deleteResult.recordsRemoved}</span>{" "}
                            assignment{deleteResult.recordsRemoved !== 1 ? "s" : ""} cleared
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-6 w-6 text-red-600 mx-auto mb-2" />
                      <p className="font-medium text-red-800">Failed</p>
                      <p className="text-sm text-red-600 mt-1">{deleteResult.error}</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            {!deleteResult && !deleting && (
              <>
                <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleBulkDeleteConfirm}>
                  Delete {selectedFiles.size} File{selectedFiles.size !== 1 ? "s" : ""}
                </Button>
              </>
            )}
            {deleteResult && (
              <Button onClick={() => setDeleteDialogOpen(false)}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assignment Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LinkIcon className="h-5 w-5" />
              {selectedFile?.assigned ? "Re-assign File" : "Assign File to Sample"}
            </DialogTitle>
            <DialogDescription>
              {selectedFile?.assigned
                ? "This file is already assigned. Select a different sample to re-assign it."
                : "Select a sample to assign this file to."}
            </DialogDescription>
          </DialogHeader>

          {selectedFile && (
            <div className="space-y-4">
              {/* File Info */}
              <div className="p-3 rounded-lg bg-muted/50 border">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{selectedFile.filename}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {selectedFile.relativePath}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant="outline">
                    {detectedType === "file1" ? "Read 1 (R1)" : detectedType === "file2" ? "Read 2 (R2)" : "Unknown type"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatFileSize(selectedFile.size)}
                  </span>
                </div>
              </div>

              {/* Current Assignment (if re-assigning) */}
              {selectedFile.assigned && selectedFile.assignedTo && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <div className="text-sm font-medium text-amber-800 mb-1">Currently assigned to:</div>
                  <div className="flex items-center gap-2">
                    <FlaskConical className="h-4 w-4 text-amber-600" />
                    <span className="font-medium">{selectedFile.assignedTo.sampleId}</span>
                    <span className="text-amber-600 text-sm">
                      ({selectedFile.assignedTo.readField === "file1" ? "R1" : "R2"})
                    </span>
                  </div>
                  <div className="text-xs text-amber-700 mt-1">
                    {selectedFile.assignedTo.orderName}
                  </div>
                </div>
              )}

              {/* Success/Error Messages */}
              {assignSuccess && (
                <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  {assignSuccess}
                </div>
              )}

              {assignError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {assignError}
                </div>
              )}

              {/* Sample Search */}
              {!assignSuccess && (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search samples by ID, order..."
                      value={sampleSearch}
                      onChange={(e) => setSampleSearch(e.target.value)}
                      className="pl-9"
                      autoFocus
                    />
                  </div>

                  {/* Sample List */}
                  <div className="max-h-[300px] overflow-y-auto border rounded-lg">
                    {loadingSamples ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    ) : matchingSamples.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">
                          {sampleSearch
                            ? "No samples found matching your search"
                            : "No samples available for assignment"}
                        </p>
                        <p className="text-xs mt-1">
                          {detectedType && `Showing samples that need ${detectedType === "file1" ? "R1" : "R2"}`}
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y">
                        {matchingSamples.map((sample) => {
                          // Color coding based on match type
                          const matchColors = {
                            exact: "bg-green-50 border-l-4 border-l-green-500",
                            strong: "bg-blue-50 border-l-4 border-l-blue-400",
                            partial: "bg-amber-50 border-l-4 border-l-amber-300",
                            none: "",
                          };
                          const iconColors = {
                            exact: "bg-green-100 text-green-600",
                            strong: "bg-blue-100 text-blue-600",
                            partial: "bg-amber-100 text-amber-600",
                            none: "bg-muted text-muted-foreground",
                          };

                          return (
                            <button
                              key={sample.id}
                              onClick={() => handleAssign(sample)}
                              disabled={assigning}
                              className={`w-full p-3 text-left hover:bg-primary/5 transition-colors flex items-center justify-between gap-3 disabled:opacity-50 ${matchColors[sample.matchType]}`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconColors[sample.matchType]}`}>
                                  <FlaskConical className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                  <div className="font-medium truncate flex items-center gap-2">
                                    {sample.sampleId}
                                    {sample.matchType === "exact" && (
                                      <Badge className="bg-green-600 text-xs">Match</Badge>
                                    )}
                                    {sample.matchType === "strong" && (
                                      <Badge variant="outline" className="border-blue-400 text-blue-600 text-xs">Likely</Badge>
                                    )}
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate">
                                    {sample.orderNumber}
                                    {sample.orderName && ` - ${sample.orderName}`}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <div className="flex gap-1">
                                  <Badge
                                    variant={sample.hasR1 ? "default" : "outline"}
                                    className={`text-xs ${sample.hasR1 ? "bg-green-600" : "border-dashed"}`}
                                  >
                                    R1
                                  </Badge>
                                  <Badge
                                    variant={sample.hasR2 ? "default" : "outline"}
                                    className={`text-xs ${sample.hasR2 ? "bg-green-600" : "border-dashed"}`}
                                  >
                                    R2
                                  </Badge>
                                </div>
                                {assigning ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <LinkIcon className="h-4 w-4 text-muted-foreground" />
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Only samples from orders in sequencing workflow are shown.
                    {detectedType && ` Filtered to samples missing ${detectedType === "file1" ? "R1" : "R2"}.`}
                  </p>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
