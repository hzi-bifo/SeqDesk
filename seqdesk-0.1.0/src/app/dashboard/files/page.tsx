"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2,
  AlertCircle,
  HardDrive,
  Search,
  RefreshCw,
  FileText,
  CheckCircle2,
  FolderOpen,
  AlertTriangle,
  Filter,
  FlaskConical,
  Link as LinkIcon,
  BookOpen,
  Hash,
  Copy,
  Check,
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
  const [copiedChecksum, setCopiedChecksum] = useState<string | null>(null);

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

  // Copy checksum to clipboard
  const copyChecksum = async (checksum: string) => {
    await navigator.clipboard.writeText(checksum);
    setCopiedChecksum(checksum);
    setTimeout(() => setCopiedChecksum(null), 2000);
  };

  // Checksum calculation state
  const [calculatingChecksums, setCalculatingChecksums] = useState<Set<string>>(new Set());
  const [checksumError, setChecksumError] = useState("");

  // Calculate MD5 for a single file
  const calculateChecksum = async (filePath: string) => {
    setCalculatingChecksums((prev) => new Set(prev).add(filePath));
    setChecksumError("");

    try {
      const res = await fetch("/api/files/checksum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePaths: [filePath] }),
      });

      const result = await res.json();
      if (!res.ok) {
        setChecksumError(result.error || "Failed to calculate checksum");
        return;
      }

      // Refresh files to show updated checksum
      fetchFiles();
    } catch {
      setChecksumError("Failed to calculate checksum");
    } finally {
      setCalculatingChecksums((prev) => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
    }
  };

  // Calculate MD5 for selected files (bulk)
  const calculateSelectedChecksums = async () => {
    if (selectedFiles.size === 0) return;

    // Only calculate for assigned files without checksums
    const filesToCalculate = data?.files
      .filter((f) => selectedFiles.has(f.relativePath) && f.assigned && !f.checksum)
      .map((f) => f.relativePath) || [];

    if (filesToCalculate.length === 0) {
      setChecksumError("No eligible files selected (must be assigned and without checksum)");
      return;
    }

    setCalculatingChecksums(new Set(filesToCalculate));
    setChecksumError("");

    try {
      const res = await fetch("/api/files/checksum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePaths: filesToCalculate }),
      });

      const result = await res.json();
      if (!res.ok) {
        setChecksumError(result.error || "Failed to calculate checksums");
        return;
      }

      // Refresh files to show updated checksums
      fetchFiles();
      setSelectedFiles(new Set());
    } catch {
      setChecksumError("Failed to calculate checksums");
    } finally {
      setCalculatingChecksums(new Set());
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
        <GlassCard className="p-8 text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground">
            Only facility administrators can access the file browser.
          </p>
        </GlassCard>
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
      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center">
              <HardDrive className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Sequencing Files</h1>
              <p className="text-muted-foreground mt-1">
                Browse and manage sequencing files. Click on unassigned files to assign them.
              </p>
            </div>
          </div>

          <Button
            variant="outline"
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

      {/* Stats */}
      {data && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <GlassCard className="p-4">
            <div className="text-2xl font-bold">{data.total}</div>
            <div className="text-sm text-muted-foreground">Total Files</div>
          </GlassCard>
          <GlassCard className="p-4">
            <div className="text-2xl font-bold text-green-600">{data.assigned}</div>
            <div className="text-sm text-muted-foreground">Assigned</div>
          </GlassCard>
          <GlassCard className="p-4">
            <div className="text-2xl font-bold text-amber-600">{data.unassigned}</div>
            <div className="text-sm text-muted-foreground">Unassigned</div>
          </GlassCard>
          <GlassCard className="p-4">
            <div className="text-2xl font-bold text-blue-600">{data.filtered}</div>
            <div className="text-sm text-muted-foreground">Showing</div>
          </GlassCard>
        </div>
      )}

      {/* Filters */}
      <GlassCard className="p-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filters:</span>
          </div>

          <div className="flex-1 max-w-sm">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search files, samples, orders..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Files</SelectItem>
              <SelectItem value="assigned">Assigned</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
            </SelectContent>
          </Select>

          <Select value={extension} onValueChange={setExtension}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Extension" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Extensions</SelectItem>
              {data?.config?.allowedExtensions?.map((ext) => (
                <SelectItem key={ext} value={ext}>
                  {ext}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </GlassCard>

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
              onClick={calculateSelectedChecksums}
              disabled={calculatingChecksums.size > 0}
            >
              {calculatingChecksums.size > 0 ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Hash className="h-4 w-4 mr-2" />
              )}
              Calculate MD5
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

      {/* Checksum Error */}
      {checksumError && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">{checksumError}</span>
          <button onClick={() => setChecksumError("")} className="ml-auto text-sm underline">
            Dismiss
          </button>
        </div>
      )}

      {/* File Table */}
      <GlassCard className="p-0 overflow-x-auto">
        <TooltipProvider>
          <Table>
            <TableHeader>
              <TableRow>
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
                <TableHead>Sample</TableHead>
                <TableHead>Study</TableHead>
                <TableHead className="w-[70px]">MD5</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.files.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12">
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
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="font-medium truncate max-w-[200px] block">{file.filename}</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="font-mono text-xs">{file.relativePath}</p>
                          </TooltipContent>
                        </Tooltip>
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
                        <Badge variant="default" className="bg-green-600 text-xs">
                          Assigned
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-300 text-amber-700 text-xs">
                          Unassigned
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell onClick={() => handleFileClick(file)}>
                      {file.assignedTo ? (
                        <div className="text-sm">
                          <span className="text-primary font-medium">
                            {file.assignedTo.sampleId}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell onClick={() => handleFileClick(file)}>
                      {file.assignedTo?.studyTitle ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1 text-sm max-w-[120px]">
                              <BookOpen className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                              <span className="truncate text-muted-foreground">{file.assignedTo.studyTitle}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{file.assignedTo.studyTitle}</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {file.checksum ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => copyChecksum(file.checksum!)}
                              className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700"
                            >
                              {copiedChecksum === file.checksum ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <Hash className="h-3 w-3" />
                              )}
                              <span className="font-mono">{file.checksum.slice(0, 6)}...</span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="font-mono text-xs">{file.checksum}</p>
                            <p className="text-xs text-muted-foreground mt-1">Click to copy</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : file.assigned ? (
                        <button
                          onClick={() => calculateChecksum(file.relativePath)}
                          disabled={calculatingChecksums.has(file.relativePath)}
                          className="text-xs text-primary hover:underline disabled:opacity-50 flex items-center gap-1"
                        >
                          {calculatingChecksums.has(file.relativePath) ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Hash className="h-3 w-3" />
                          )}
                          {calculatingChecksums.has(file.relativePath) ? "..." : "Calc"}
                        </button>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </TooltipProvider>
      </GlassCard>

      {/* Path info */}
      {data?.dataBasePath && (
        <div className="mt-4 text-sm text-muted-foreground">
          Scanning: <code className="bg-muted px-2 py-1 rounded">{data.dataBasePath}</code>
          {" "}(depth: {data.config.scanDepth})
        </div>
      )}

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
