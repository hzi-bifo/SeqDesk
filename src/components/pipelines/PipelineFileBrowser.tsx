"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  FileText,
  Download,
  Eye,
  Loader2,
  Search,
  FolderInput,
  FolderOutput,
  FileCode,
  FileArchive,
  File,
  Copy,
  Check,
  ExternalLink,
  Filter,
  X,
} from "lucide-react";

// Types
export interface PipelineFile {
  id: string;
  name: string;
  path: string;
  type: string;
  sampleId?: string;
  checksum?: string;
  size?: number | bigint;
  producedByStepId?: string;
  metadata?: string;
}

interface PipelineFileBrowserProps {
  inputFiles: PipelineFile[];
  outputFiles: PipelineFile[];
  runId?: string;
  runFolder?: string | null;
  runStatus?: string;
  className?: string;
}

// File type icons
function getFileIcon(filename: string, type: string) {
  const ext = filename.split(".").pop()?.toLowerCase();

  if (type === "samplesheet" || ext === "csv" || ext === "tsv") {
    return <FileCode className="h-4 w-4 text-green-600" />;
  }
  if (ext === "gz" || ext === "zip" || ext === "tar") {
    return <FileArchive className="h-4 w-4 text-amber-600" />;
  }
  if (ext === "html") {
    return <FileText className="h-4 w-4 text-blue-600" />;
  }
  if (ext === "fasta" || ext === "fa" || ext === "fna" || ext === "faa") {
    return <FileCode className="h-4 w-4 text-purple-600" />;
  }
  if (ext === "fastq" || ext === "fq") {
    return <FileCode className="h-4 w-4 text-indigo-600" />;
  }
  return <File className="h-4 w-4 text-gray-500" />;
}

const TEXT_EXTENSIONS = new Set([
  "txt",
  "log",
  "out",
  "err",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "md",
  "dot",
]);

function isTextLikeFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".out") || lower.endsWith(".err")) return true;
  const ext = lower.split(".").pop();
  return !!ext && TEXT_EXTENSIONS.has(ext);
}

// File type badge
function getTypeBadge(type: string) {
  switch (type) {
    case "read_1":
      return <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700">R1</Badge>;
    case "read_2":
      return <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700">R2</Badge>;
    case "samplesheet":
      return <Badge variant="outline" className="text-xs bg-green-50 text-green-700">Samplesheet</Badge>;
    case "assembly":
      return <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700">Assembly</Badge>;
    case "bins":
      return <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700">Bins</Badge>;
    case "qc_report":
      return <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700">QC Report</Badge>;
    case "log":
      return <Badge variant="outline" className="text-xs bg-slate-50 text-slate-700">Log</Badge>;
    case "report":
      return <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700">Report</Badge>;
    case "dag":
      return <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700">DAG</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{type}</Badge>;
  }
}

// Format file size
function formatSize(size?: number | bigint): string {
  if (!size) return "-";
  const bytes = typeof size === "bigint" ? Number(size) : size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// File preview dialog
function FilePreviewDialog({
  file,
  runId,
  open,
  onClose,
}: {
  file: PipelineFile | null;
  runId?: string;
  open: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTruncated, setPreviewTruncated] = useState(false);

  const canPreview = !!file && !!runId && isTextLikeFile(file.name);

  const loadPreview = async () => {
    if (!file || !runId || !isTextLikeFile(file.name)) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewContent(null);
    setPreviewTruncated(false);
    try {
      const res = await fetch(
        `/api/pipelines/runs/${runId}/file?path=${encodeURIComponent(file.path)}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPreviewError(data?.error || `Failed to load file (HTTP ${res.status})`);
        return;
      }
      const data = (await res.json()) as {
        content?: string;
        truncated?: boolean;
      };
      setPreviewContent(data.content ?? "");
      setPreviewTruncated(Boolean(data.truncated));
    } catch {
      setPreviewError("Failed to load file");
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (canPreview) {
      void loadPreview();
    } else {
      setPreviewContent(null);
      setPreviewError(null);
      setPreviewTruncated(false);
    }
  }, [open, file?.path, runId]);

  const copyPath = () => {
    if (file?.path) {
      navigator.clipboard.writeText(file.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!file) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getFileIcon(file.name, file.type)}
            {file.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* File Info */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Type</div>
              <div className="font-medium">{getTypeBadge(file.type)}</div>
            </div>
            {file.sampleId && (
              <div>
                <div className="text-muted-foreground">Sample</div>
                <div className="font-medium">{file.sampleId}</div>
              </div>
            )}
            {file.size && (
              <div>
                <div className="text-muted-foreground">Size</div>
                <div className="font-medium">{formatSize(file.size)}</div>
              </div>
            )}
            {file.checksum && (
              <div>
                <div className="text-muted-foreground">Checksum</div>
                <div className="font-mono text-xs truncate">{file.checksum}</div>
              </div>
            )}
            {file.producedByStepId && (
              <div>
                <div className="text-muted-foreground">Produced By</div>
                <div className="font-medium">{file.producedByStepId}</div>
              </div>
            )}
          </div>

          {/* Path */}
          <div>
            <div className="text-sm text-muted-foreground mb-1">Full Path</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted p-2 rounded font-mono break-all">
                {file.path}
              </code>
              <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={copyPath}>
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            {runId && (
              <Button variant="outline" className="flex-1" asChild>
                <a
                  href={`/api/pipelines/runs/${runId}/file?path=${encodeURIComponent(file.path)}&download=1`}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download File
                </a>
              </Button>
            )}
            <Button variant="outline" className="flex-1" onClick={copyPath}>
              <Copy className="h-4 w-4 mr-2" />
              Copy Path
            </Button>
            {/* For HTML files, we could add a preview button */}
            {file.name.endsWith(".html") && (
              <Button variant="outline" className="flex-1" asChild>
                <a href={`/api/files/preview?path=${encodeURIComponent(file.path)}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open Report
                </a>
              </Button>
            )}
          </div>

          {/* Preview */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">Preview</div>
              {canPreview && (
                <Button variant="ghost" size="sm" onClick={loadPreview} disabled={previewLoading}>
                  {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
                </Button>
              )}
            </div>
            {!canPreview && (
              <div className="text-xs text-muted-foreground">
                Preview available for text-based files (e.g., .out, .err, .log, .txt).
              </div>
            )}
            {previewError && (
              <div className="text-xs text-destructive">{previewError}</div>
            )}
            {canPreview && !previewError && (
              <div className="bg-muted rounded-md border max-h-[320px] overflow-auto">
                {previewLoading ? (
                  <div className="p-4 text-sm text-muted-foreground">Loading...</div>
                ) : (
                  <pre className="p-4 text-xs whitespace-pre-wrap font-mono">
                    {previewContent || "No content"}
                  </pre>
                )}
              </div>
            )}
            {previewTruncated && (
              <div className="text-xs text-muted-foreground mt-1">
                Showing last part of file (truncated).
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PipelineFileBrowser({
  inputFiles,
  outputFiles,
  runId,
  runFolder,
  runStatus,
  className = "",
}: PipelineFileBrowserProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sampleFilter, setSampleFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"input" | "output" | "all">("all");
  const [selectedFile, setSelectedFile] = useState<PipelineFile | null>(null);

  // Get unique samples and types
  const allFiles = useMemo(() => {
    if (viewMode === "input") return inputFiles;
    if (viewMode === "output") return outputFiles;
    return [...inputFiles, ...outputFiles];
  }, [inputFiles, outputFiles, viewMode]);

  const uniqueSamples = useMemo(() => {
    const samples = new Set<string>();
    allFiles.forEach((f) => f.sampleId && samples.add(f.sampleId));
    return Array.from(samples).sort();
  }, [allFiles]);

  const uniqueTypes = useMemo(() => {
    const types = new Set<string>();
    allFiles.forEach((f) => types.add(f.type));
    return Array.from(types).sort();
  }, [allFiles]);

  // Filter files
  const filteredFiles = useMemo(() => {
    return allFiles.filter((file) => {
      // Search filter
      if (search && !file.name.toLowerCase().includes(search.toLowerCase()) &&
          !file.path.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      // Type filter
      if (typeFilter !== "all" && file.type !== typeFilter) {
        return false;
      }
      // Sample filter
      if (sampleFilter !== "all" && file.sampleId !== sampleFilter) {
        return false;
      }
      return true;
    });
  }, [allFiles, search, typeFilter, sampleFilter]);

  // Group files by sample
  const groupedBySample = useMemo(() => {
    const groups = new Map<string, PipelineFile[]>();
    groups.set("_general", []);

    filteredFiles.forEach((file) => {
      const key = file.sampleId || "_general";
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(file);
    });

    return groups;
  }, [filteredFiles]);

  const hasFilters = search || typeFilter !== "all" || sampleFilter !== "all";

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header Stats */}
      <div className="flex flex-wrap gap-3">
        <Button
          variant={viewMode === "all" ? "secondary" : "outline"}
          size="sm"
          onClick={() => setViewMode("all")}
        >
          All Files ({inputFiles.length + outputFiles.length})
        </Button>
        <Button
          variant={viewMode === "input" ? "secondary" : "outline"}
          size="sm"
          onClick={() => setViewMode("input")}
        >
          <FolderInput className="h-4 w-4 mr-1" />
          Input ({inputFiles.length})
        </Button>
        <Button
          variant={viewMode === "output" ? "secondary" : "outline"}
          size="sm"
          onClick={() => setViewMode("output")}
        >
          <FolderOutput className="h-4 w-4 mr-1" />
          Output ({outputFiles.length})
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search files..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[150px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {uniqueTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {uniqueSamples.length > 0 && (
          <Select value={sampleFilter} onValueChange={setSampleFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Sample" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Samples</SelectItem>
              {uniqueSamples.map((sample) => (
                <SelectItem key={sample} value={sample}>
                  {sample}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {hasFilters && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setSearch("");
              setTypeFilter("all");
              setSampleFilter("all");
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Run Folder */}
      {runFolder && (
        <div className="text-sm text-muted-foreground bg-muted rounded p-2 font-mono truncate">
          Run folder: {runFolder}
        </div>
      )}

      {/* File List */}
      <ScrollArea className="h-[400px] border rounded-md">
        {filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mb-3 opacity-50" />
            <p>No files found</p>
            {runStatus === "running" && (
              <p className="text-sm mt-1">
                Pipeline is running — outputs will appear as steps complete.
              </p>
            )}
            {hasFilters && (
              <p className="text-sm">Try adjusting your filters</p>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">File</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Sample</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredFiles.map((file) => (
                <TableRow
                  key={file.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedFile(file)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getFileIcon(file.name, file.type)}
                      <span className="font-mono text-sm truncate max-w-[300px]">
                        {file.name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{getTypeBadge(file.type)}</TableCell>
                  <TableCell>
                    {file.sampleId ? (
                      <Badge variant="outline" className="text-xs">
                        {file.sampleId}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {formatSize(file.size)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFile(file);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ScrollArea>

      {/* Summary */}
      <div className="text-sm text-muted-foreground">
        Showing {filteredFiles.length} of {allFiles.length} files
        {uniqueSamples.length > 0 && ` across ${uniqueSamples.length} samples`}
      </div>

      {/* Preview Dialog */}
      <FilePreviewDialog
        file={selectedFile}
        runId={runId}
        open={!!selectedFile}
        onClose={() => setSelectedFile(null)}
      />
    </div>
  );
}
