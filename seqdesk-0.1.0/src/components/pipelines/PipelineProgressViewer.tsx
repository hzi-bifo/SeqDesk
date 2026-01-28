"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  Position,
  Handle,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText,
  X,
  Wrench,
  ExternalLink,
  ArrowUpFromLine,
  ArrowDownToLine,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// Types
export interface StepStatus {
  stepId: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  completedAt?: string;
  outputFiles?: string[];
}

export interface DagNode {
  id: string;
  name: string;
  description?: string;
  category?: string;
  order: number;
  nodeType?: "step" | "input" | "output";
  fileTypes?: string[];
  tools?: string[];
  outputs?: string[];
  docs?: string;
}

export interface DagEdge {
  from: string;
  to: string;
  label?: string;
}

// File types for DAG integration
export interface PipelineInputFile {
  id: string;
  name: string;
  path: string;
  type: "read_1" | "read_2" | "samplesheet" | string;
  sampleId?: string;
  checksum?: string;
}

export interface PipelineOutputFile {
  id: string;
  name: string;
  path: string;
  type: string;
  sampleId?: string;
  size?: number | bigint;
  producedByStepId?: string;
  checksum?: string;
  metadata?: string;
}

interface PipelineProgressViewerProps {
  nodes: DagNode[];
  edges: DagEdge[];
  stepStatuses?: StepStatus[];
  inputFiles?: PipelineInputFile[];
  outputFiles?: PipelineOutputFile[];
  showFiles?: boolean;
  className?: string;
  runStatus?: string;
  currentStepId?: string;
  currentStepLabel?: string | null;
  onStepClick?: (stepId: string) => void;
  onFileClick?: (file: PipelineInputFile | PipelineOutputFile) => void;
}

// Status colors
const statusStyles: Record<string, { bg: string; border: string; text: string; glow?: string; extra?: string }> = {
  pending: { bg: "bg-gray-50", border: "border-gray-300", text: "text-gray-600", extra: "opacity-60" },
  running: { bg: "bg-red-50", border: "border-red-500", text: "text-red-700", glow: "shadow-red-200 shadow-lg", extra: "animate-pulse ring-2 ring-red-300" },
  completed: { bg: "bg-green-50", border: "border-green-500", text: "text-green-700" },
  failed: { bg: "bg-red-50", border: "border-red-500", text: "text-red-700" },
  skipped: { bg: "bg-gray-50", border: "border-gray-300 border-dashed", text: "text-gray-400", extra: "opacity-40" },
};

// Category colors (for non-status nodes)
const categoryStyles: Record<string, { bg: string; border: string; text: string }> = {
  qc: { bg: "bg-blue-50", border: "border-blue-400", text: "text-blue-900" },
  preprocessing: { bg: "bg-blue-50", border: "border-blue-400", text: "text-blue-900" },
  assembly: { bg: "bg-green-50", border: "border-green-400", text: "text-green-900" },
  binning: { bg: "bg-purple-50", border: "border-purple-400", text: "text-purple-900" },
  annotation: { bg: "bg-orange-50", border: "border-orange-400", text: "text-orange-900" },
  reporting: { bg: "bg-gray-50", border: "border-gray-400", text: "text-gray-900" },
  input: { bg: "bg-emerald-50", border: "border-emerald-500", text: "text-emerald-900" },
  output: { bg: "bg-sky-50", border: "border-sky-500", text: "text-sky-900" },
};

// Status icon
function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case "running":
      return <Loader2 className="h-4 w-4 text-red-600 animate-spin" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-600" />;
    case "skipped":
      return <Clock className="h-4 w-4 text-gray-400" />;
    default:
      return <Clock className="h-4 w-4 text-gray-400" />;
  }
}

// Custom node data type
interface ProgressNodeData {
  label: string;
  description?: string;
  category?: string;
  nodeType?: "step" | "input" | "output";
  fileTypes?: string[];
  tools?: string[];
  status?: string;
  outputFiles?: string[];
  startedAt?: string;
  completedAt?: string;
  isCurrent?: boolean;
  [key: string]: unknown;
}

// Custom node component for pipeline steps with status
function ProgressStepNode({ data }: { data: ProgressNodeData }) {
  const hasStatus = !!data.status;
  const style = hasStatus
    ? statusStyles[data.status || "pending"]
    : categoryStyles[data.category || ""] || categoryStyles.reporting;
  const currentRing = data.isCurrent ? "ring-2 ring-red-300" : "";

  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 shadow-sm min-w-[180px] cursor-pointer hover:shadow-md transition-all ${style.bg} ${style.border} ${(style as { glow?: string }).glow || ""} ${(style as { extra?: string }).extra || ""} ${currentRing}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {hasStatus && <StatusIcon status={data.status || "pending"} />}
            <span className={`font-semibold text-sm ${style.text}`}>
              {data.label}
            </span>
          </div>
          {data.status && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded capitalize ${
              data.status === "completed" ? "bg-green-100 text-green-700" :
              data.status === "running" ? "bg-blue-100 text-blue-700" :
              data.status === "failed" ? "bg-red-100 text-red-700" :
              "bg-gray-100 text-gray-600"
            }`}>
              {data.status}
            </span>
          )}
        </div>
        {data.description && (
          <p className="text-xs text-muted-foreground leading-tight line-clamp-2">
            {data.description}
          </p>
        )}
        {data.outputFiles && data.outputFiles.length > 0 && (
          <div className="flex items-center gap-1 mt-1 text-xs text-green-600">
            <FolderOpen className="h-3 w-3" />
            <span>{data.outputFiles.length} files</span>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
    </div>
  );
}

// Custom node component for input files
function InputNode({ data }: { data: ProgressNodeData }) {
  const style = categoryStyles.input;

  return (
    <div
      className={`px-4 py-3 rounded-xl border-2 border-dashed shadow-sm min-w-[180px] cursor-pointer hover:shadow-md transition-shadow ${style.bg} ${style.border}`}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <ArrowUpFromLine className={`h-4 w-4 ${style.text}`} />
          <span className={`font-semibold text-sm ${style.text}`}>
            {data.label}
          </span>
        </div>
        {data.fileTypes && data.fileTypes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {data.fileTypes.slice(0, 3).map((ft) => (
              <span key={ft} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-800 font-mono">
                .{ft}
              </span>
            ))}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-emerald-500" />
    </div>
  );
}

// Custom node component for output files
function OutputNode({ data }: { data: ProgressNodeData }) {
  const style = categoryStyles.output;
  const hasFiles = data.outputFiles && data.outputFiles.length > 0;

  return (
    <div
      className={`px-4 py-3 rounded-xl border-2 border-dashed shadow-sm min-w-[180px] cursor-pointer hover:shadow-md transition-shadow ${
        hasFiles ? "bg-green-50 border-green-500" : `${style.bg} ${style.border}`
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-sky-500" />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          {hasFiles ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : (
            <ArrowDownToLine className={`h-4 w-4 ${style.text}`} />
          )}
          <span className={`font-semibold text-sm ${hasFiles ? "text-green-700" : style.text}`}>
            {data.label}
          </span>
        </div>
        {hasFiles ? (
          <div className="flex items-center gap-1 text-xs text-green-600">
            <FolderOpen className="h-3 w-3" />
            <span>{data.outputFiles!.length} files generated</span>
          </div>
        ) : data.fileTypes && data.fileTypes.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {data.fileTypes.slice(0, 3).map((ft) => (
              <span key={ft} className="text-[10px] px-1.5 py-0.5 rounded bg-sky-200 text-sky-800 font-mono">
                .{ft}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// File node data type
interface FileNodeData {
  label: string;
  fileName: string;
  filePath: string;
  fileType: string;
  sampleId?: string;
  isInput: boolean;
  checksum?: string;
  size?: number | bigint;
  [key: string]: unknown;
}

// Custom node component for individual files (FASTQ, outputs, etc.)
function FileNode({ data }: { data: FileNodeData }) {
  const isInput = data.isInput;
  const ext = data.fileName.split(".").pop()?.toLowerCase() || "";

  // Get file icon based on extension
  const getIcon = () => {
    if (ext === "gz" || ext === "fastq" || ext === "fq") {
      return <FileText className="h-3 w-3" />;
    }
    if (ext === "csv" || ext === "tsv") {
      return <FileText className="h-3 w-3" />;
    }
    return <FileText className="h-3 w-3" />;
  };

  return (
    <div
      className={`px-2 py-1.5 rounded-md border shadow-sm min-w-[120px] max-w-[160px] cursor-pointer hover:shadow-md transition-shadow ${
        isInput
          ? "bg-blue-50 border-blue-300 hover:border-blue-400"
          : "bg-green-50 border-green-300 hover:border-green-400"
      }`}
    >
      {!isInput && <Handle type="target" position={Position.Top} className="!bg-green-400 !w-2 !h-2" />}

      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <span className={isInput ? "text-blue-600" : "text-green-600"}>
            {getIcon()}
          </span>
          <span className="text-[10px] font-medium truncate" title={data.fileName}>
            {data.fileName.length > 18 ? data.fileName.slice(0, 15) + "..." : data.fileName}
          </span>
        </div>
        {data.sampleId && (
          <span className="text-[9px] text-muted-foreground truncate">
            {data.sampleId}
          </span>
        )}
      </div>

      {isInput && <Handle type="source" position={Position.Bottom} className="!bg-blue-400 !w-2 !h-2" />}
    </div>
  );
}

const nodeTypes = {
  progressStep: ProgressStepNode,
  inputNode: InputNode,
  outputNode: OutputNode,
  fileNode: FileNode,
};

// Layout algorithm
function layoutNodes(
  dagNodes: DagNode[],
  dagEdges: DagEdge[],
  stepStatuses?: StepStatus[],
  currentStepId?: string
): Node[] {
  const statusMap = new Map<string, StepStatus>();
  if (stepStatuses) {
    for (const s of stepStatuses) {
      statusMap.set(s.stepId, s);
    }
  }

  const levels = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const node of dagNodes) {
    levels.set(node.id, 0);
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }

  for (const edge of dagEdges) {
    adj.get(edge.from)?.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = levels.get(current) || 0;

    for (const next of adj.get(current) || []) {
      levels.set(next, Math.max(levels.get(next) || 0, currentLevel + 1));
      const newDegree = (inDegree.get(next) || 1) - 1;
      inDegree.set(next, newDegree);
      if (newDegree === 0) queue.push(next);
    }
  }

  const levelGroups = new Map<number, DagNode[]>();
  for (const node of dagNodes) {
    const level = levels.get(node.id) || 0;
    if (!levelGroups.has(level)) levelGroups.set(level, []);
    levelGroups.get(level)!.push(node);
  }

  const nodeWidth = 220;
  const nodeHeight = 100;
  const horizontalGap = 40;
  const verticalGap = 60;

  const nodes: Node[] = [];

  for (const [level, levelNodes] of levelGroups) {
    const totalWidth = levelNodes.length * nodeWidth + (levelNodes.length - 1) * horizontalGap;
    const startX = -totalWidth / 2 + nodeWidth / 2;

    levelNodes.forEach((node, idx) => {
      let type = "progressStep";
      if (node.nodeType === "input") {
        type = "inputNode";
      } else if (node.nodeType === "output") {
        type = "outputNode";
      }

      const status = statusMap.get(node.id);
      const statusValue =
        status?.status || (node.nodeType ? undefined : "pending");

      nodes.push({
        id: node.id,
        type,
        position: {
          x: startX + idx * (nodeWidth + horizontalGap),
          y: level * (nodeHeight + verticalGap),
        },
        data: {
          label: node.name,
          description: node.description,
          category: node.category,
          nodeType: node.nodeType,
          fileTypes: node.fileTypes,
          tools: node.tools,
          status: statusValue,
          outputFiles: status?.outputFiles,
          startedAt: status?.startedAt,
          completedAt: status?.completedAt,
          isCurrent: currentStepId ? node.id === currentStepId : false,
        },
      });
    });
  }

  return nodes;
}

// Detail panel for selected node
function NodeDetailPanel({
  node,
  status,
  inputFiles = [],
  outputFiles = [],
  inputStepId,
  onFileSelect,
  onClose,
}: {
  node: DagNode;
  status?: StepStatus;
  inputFiles?: PipelineInputFile[];
  outputFiles?: PipelineOutputFile[];
  inputStepId?: string;
  onFileSelect?: (file: PipelineInputFile | PipelineOutputFile) => void;
  onClose: () => void;
}) {
  const isInputStep = inputStepId ? node.id === inputStepId : false;
  const stepInputs = isInputStep ? inputFiles : [];
  const stepOutputs = outputFiles.filter((file) => file.producedByStepId === node.id);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-2 p-4 border-b">
        <div>
          <div className="flex items-center gap-2">
            {status && <StatusIcon status={status.status} />}
            <h3 className="font-semibold text-lg">{node.name}</h3>
          </div>
          <div className="flex items-center gap-2 mt-1">
            {status && (
              <Badge
                variant={
                  status.status === "completed" ? "default" :
                  status.status === "running" ? "secondary" :
                  status.status === "failed" ? "destructive" : "outline"
                }
                className="capitalize"
              >
                {status.status}
              </Badge>
            )}
            {node.category && (
              <Badge variant="outline" className="capitalize">
                {node.category?.replace("_", " ")}
              </Badge>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {node.description && (
            <p className="text-sm text-muted-foreground">{node.description}</p>
          )}

          {/* Timing info */}
          {status?.startedAt && (
            <div className="text-sm">
              <div className="text-muted-foreground">Started</div>
              <div>{new Date(status.startedAt).toLocaleString()}</div>
            </div>
          )}
          {status?.completedAt && (
            <div className="text-sm">
              <div className="text-muted-foreground">Completed</div>
              <div>{new Date(status.completedAt).toLocaleString()}</div>
            </div>
          )}

          {/* Input files */}
          {stepInputs.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <ArrowUpFromLine className="h-4 w-4" />
                Input Files ({stepInputs.length})
              </div>
              <div className="space-y-1 max-h-40 overflow-auto">
                {stepInputs.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => onFileSelect?.(file)}
                    className="w-full text-left text-xs font-mono bg-muted p-1 rounded hover:bg-muted/70 transition-colors"
                  >
                    {file.name}
                    {file.sampleId ? ` · ${file.sampleId}` : ""}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Output files */}
          {stepOutputs.length > 0 ? (
            <div>
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <FolderOpen className="h-4 w-4" />
                Output Files ({stepOutputs.length})
              </div>
              <div className="space-y-1 max-h-40 overflow-auto">
                {stepOutputs.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => onFileSelect?.(file)}
                    className="w-full text-left text-xs font-mono bg-muted p-1 rounded hover:bg-muted/70 transition-colors"
                  >
                    {file.name}
                    {file.sampleId ? ` · ${file.sampleId}` : ""}
                  </button>
                ))}
              </div>
            </div>
          ) : status?.outputFiles && status.outputFiles.length > 0 ? (
            <div>
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <FolderOpen className="h-4 w-4" />
                Output Files ({status.outputFiles.length})
              </div>
              <div className="space-y-1 max-h-40 overflow-auto">
                {status.outputFiles.map((file, i) => (
                  <div key={i} className="text-xs font-mono bg-muted p-1 rounded truncate">
                    {file.split("/").pop()}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Documentation link */}
          {node.docs && (
            <a
              href={node.docs}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              View Documentation
            </a>
          )}

          {/* Tools */}
          {node.tools && node.tools.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <Wrench className="h-4 w-4" />
                Tools / Software
              </div>
              <div className="flex flex-wrap gap-1.5">
                {node.tools.map((tool) => (
                  <Badge key={tool} variant="secondary" className="font-mono text-xs">
                    {tool}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* File Types */}
          {node.fileTypes && node.fileTypes.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <FileText className="h-4 w-4" />
                {node.nodeType === "input" ? "Accepted Formats" : "Output Formats"}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {node.fileTypes.map((ft) => (
                  <Badge key={ft} variant="outline" className="font-mono text-xs">
                    .{ft}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// File detail panel
function FileDetailPanel({
  file,
  onClose,
}: {
  file: PipelineInputFile | PipelineOutputFile;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const inputTypes = new Set(["read_1", "read_2", "samplesheet"]);
  const isInput = inputTypes.has(file.type);
  const outputFile = file as PipelineOutputFile;

  const copyPath = () => {
    navigator.clipboard.writeText(file.path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Format file size
  const formatSize = (size?: number | bigint): string => {
    if (!size) return "-";
    const bytes = typeof size === "bigint" ? Number(size) : size;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-2 p-4 border-b">
        <div>
          <div className="flex items-center gap-2">
            {isInput ? (
              <ArrowUpFromLine className="h-4 w-4 text-blue-600" />
            ) : (
              <ArrowDownToLine className="h-4 w-4 text-green-600" />
            )}
            <h3 className="font-semibold text-sm truncate max-w-[200px]" title={file.name}>
              {file.name}
            </h3>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={isInput ? "secondary" : "default"} className={isInput ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}>
              {isInput ? "Input" : "Output"}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {file.type}
            </Badge>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Sample */}
          {file.sampleId && (
            <div className="text-sm">
              <div className="text-muted-foreground">Sample</div>
              <div className="font-medium">{file.sampleId}</div>
            </div>
          )}

          {/* Size (for output files) */}
          {!isInput && outputFile.size && (
            <div className="text-sm">
              <div className="text-muted-foreground">Size</div>
              <div className="font-medium">{formatSize(outputFile.size)}</div>
            </div>
          )}

          {/* Produced by step */}
          {!isInput && outputFile.producedByStepId && (
            <div className="text-sm">
              <div className="text-muted-foreground">Produced By</div>
              <div className="font-medium">{outputFile.producedByStepId}</div>
            </div>
          )}

          {/* Checksum */}
          {"checksum" in file && file.checksum && (
            <div className="text-sm">
              <div className="text-muted-foreground">Checksum</div>
              <div className="font-mono text-xs truncate">{file.checksum}</div>
            </div>
          )}

          {/* Full path */}
          <div>
            <div className="text-sm text-muted-foreground mb-1">Full Path</div>
            <div className="flex items-start gap-2">
              <code className="flex-1 text-xs bg-muted p-2 rounded font-mono break-all">
                {file.path}
              </code>
            </div>
            <Button variant="outline" size="sm" className="w-full mt-2" onClick={copyPath}>
              {copied ? (
                <>
                  <CheckCircle2 className="h-3 w-3 mr-2 text-green-600" />
                  Copied!
                </>
              ) : (
                <>
                  <FileText className="h-3 w-3 mr-2" />
                  Copy Path
                </>
              )}
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

export function PipelineProgressViewer({
  nodes: dagNodes,
  edges: dagEdges,
  stepStatuses,
  inputFiles = [],
  outputFiles = [],
  showFiles = true,
  className = "",
  runStatus,
  currentStepId,
  currentStepLabel,
  onStepClick,
  onFileClick,
}: PipelineProgressViewerProps) {
  const [selectedNode, setSelectedNode] = useState<DagNode | null>(null);
  const [selectedFile, setSelectedFile] = useState<PipelineInputFile | PipelineOutputFile | null>(null);

  const inputStepId = useMemo(
    () => dagNodes.find((n) => n.id === "input")?.id || dagNodes[0]?.id,
    [dagNodes]
  );

  const nodeMap = useMemo(() => {
    const map = new Map<string, DagNode>();
    dagNodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [dagNodes]);

  const statusMap = useMemo(() => {
    const map = new Map<string, StepStatus>();
    if (stepStatuses) {
      for (const s of stepStatuses) {
        map.set(s.stepId, s);
      }
    }
    return map;
  }, [stepStatuses]);

  // Create combined nodes with file nodes
  const { allNodes, allEdges } = useMemo(() => {
    const baseNodes = layoutNodes(dagNodes, dagEdges, stepStatuses, currentStepId);
    const resultEdges: Edge[] = [];

    // Add base edges
    dagEdges.forEach((edge, idx) => {
      const sourceStatus = statusMap.get(edge.from)?.status || "pending";
      const targetStatus = statusMap.get(edge.to)?.status || "pending";
      const isCompleted = sourceStatus === "completed";
      const isRunning = sourceStatus === "running" || targetStatus === "running";
      const isFailed = sourceStatus === "failed" || targetStatus === "failed";
      const strokeColor = isFailed
        ? "#ef4444"
        : isRunning
          ? "#f59e0b"
          : isCompleted
            ? "#22c55e"
            : "#94a3b8";

      resultEdges.push({
        id: `e${idx}`,
        source: edge.from,
        target: edge.to,
        type: "smoothstep",
        animated: isRunning,
        style: {
          stroke: strokeColor,
          strokeWidth: isCompleted ? 3 : 2,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: strokeColor,
        },
      });
    });

    if (!showFiles || (inputFiles.length === 0 && outputFiles.length === 0)) {
      return { allNodes: baseNodes, allEdges: resultEdges };
    }

    // Find the bounds of existing nodes
    let minY = Infinity, maxY = -Infinity;
    let centerX = 0;
    baseNodes.forEach(n => {
      minY = Math.min(minY, n.position.y);
      maxY = Math.max(maxY, n.position.y);
      centerX += n.position.x;
    });
    centerX = baseNodes.length > 0 ? centerX / baseNodes.length : 0;

    // Find the "input" step (first step) to connect input files to
    // Group input files by sample
    const inputBySample = new Map<string, PipelineInputFile[]>();
    inputFiles.forEach(f => {
      const key = f.sampleId || "_general";
      if (!inputBySample.has(key)) inputBySample.set(key, []);
      inputBySample.get(key)!.push(f);
    });

    // Create input file nodes - positioned above the first level
    const fileNodes: Node[] = [];
    const inputY = minY - 120;
    const fileWidth = 140;
    const fileGap = 20;

    // Group files into sample groups for better layout
    let currentX = centerX - ((inputBySample.size * (fileWidth * 2 + fileGap)) / 2);

    inputBySample.forEach((files) => {
      files.forEach((file, idx) => {
        const nodeId = `file_input_${file.id}`;
        fileNodes.push({
          id: nodeId,
          type: "fileNode",
          position: {
            x: currentX + idx * (fileWidth + fileGap / 2),
            y: inputY,
          },
          data: {
            label: file.name,
            fileName: file.name,
            filePath: file.path,
            fileType: file.type,
            sampleId: file.sampleId,
            isInput: true,
            checksum: file.checksum,
          },
        });

        // Connect to input step
        if (inputStepId) {
          resultEdges.push({
            id: `e_file_in_${file.id}`,
            source: nodeId,
            target: inputStepId,
            type: "smoothstep",
            style: { stroke: "#3b82f6", strokeWidth: 1.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: "#3b82f6" },
          });
        }
      });
      currentX += files.length * (fileWidth + fileGap / 2) + fileGap * 2;
    });

    // Find output steps and group output files by producedByStepId
    const outputByStep = new Map<string, PipelineOutputFile[]>();
    outputFiles.forEach(f => {
      const key = f.producedByStepId || "_end";
      if (!outputByStep.has(key)) outputByStep.set(key, []);
      outputByStep.get(key)!.push(f);
    });

    // Create output file nodes - positioned below their producing step
    const outputY = maxY + 120;
    currentX = centerX - ((outputFiles.length * (fileWidth + fileGap)) / 2);

    outputFiles.forEach((file, idx) => {
      const nodeId = `file_output_${file.id}`;
      fileNodes.push({
        id: nodeId,
        type: "fileNode",
        position: {
          x: currentX + idx * (fileWidth + fileGap),
          y: outputY,
        },
        data: {
          label: file.name,
          fileName: file.name,
          filePath: file.path,
          fileType: file.type,
          sampleId: file.sampleId,
          isInput: false,
          size: file.size,
        },
      });

      // Connect from producing step
      if (file.producedByStepId && nodeMap.has(file.producedByStepId)) {
        resultEdges.push({
          id: `e_file_out_${file.id}`,
          source: file.producedByStepId,
          target: nodeId,
          type: "smoothstep",
          style: { stroke: "#22c55e", strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#22c55e" },
        });
      }
    });

    return { allNodes: [...baseNodes, ...fileNodes], allEdges: resultEdges };
  }, [dagNodes, dagEdges, stepStatuses, statusMap, inputFiles, outputFiles, showFiles, nodeMap, inputStepId, currentStepId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(allNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(allEdges);

  useEffect(() => {
    setNodes(allNodes);
  }, [allNodes, setNodes]);

  useEffect(() => {
    setEdges(allEdges);
  }, [allEdges, setEdges]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (event, node) => {
      // Check if it's a file node
      if (node.id.startsWith("file_input_")) {
        const fileId = node.id.replace("file_input_", "");
        const file = inputFiles.find(f => f.id === fileId);
        if (file) {
          setSelectedFile(file);
          setSelectedNode(null);
          onFileClick?.(file);
          return;
        }
      }
      if (node.id.startsWith("file_output_")) {
        const fileId = node.id.replace("file_output_", "");
        const file = outputFiles.find(f => f.id === fileId);
        if (file) {
          setSelectedFile(file);
          setSelectedNode(null);
          onFileClick?.(file);
          return;
        }
      }

      // Regular node
      const dagNode = nodeMap.get(node.id);
      if (dagNode) {
        setSelectedNode(dagNode);
        setSelectedFile(null);
        onStepClick?.(node.id);
      }
    },
    [nodeMap, onStepClick, onFileClick, inputFiles, outputFiles]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedFile(null);
  }, []);

  // Calculate summary stats
  const stats = useMemo(() => {
    if (!stepStatuses) return null;
    const completed = stepStatuses.filter(s => s.status === "completed").length;
    const running = stepStatuses.filter(s => s.status === "running").length;
    const failed = stepStatuses.filter(s => s.status === "failed").length;
    const total = stepStatuses.length;
    return { completed, running, failed, total, pending: total - completed - running - failed };
  }, [stepStatuses]);

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Progress Summary */}
      <div className="flex flex-wrap gap-3">
        {runStatus && (
          <Badge variant="outline" className={`${
            runStatus === "running"
              ? "bg-blue-50 text-blue-700 border-blue-200"
              : runStatus === "failed"
                ? "bg-red-50 text-red-700 border-red-200"
                : runStatus === "completed"
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-gray-50 text-gray-600 border-gray-200"
          }`}>
            Status: {runStatus}
          </Badge>
        )}
        {currentStepLabel && runStatus !== "completed" && (
          <Badge
            variant="outline"
            className={`${
              runStatus === "failed"
                ? "bg-red-50 text-red-800 border-red-200"
                : "bg-amber-50 text-amber-800 border-amber-200"
            }`}
          >
            {runStatus === "failed" ? "Failed at" : "Current"}: {currentStepLabel}
          </Badge>
        )}
        {/* File counts */}
        {showFiles && inputFiles.length > 0 && (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            <ArrowUpFromLine className="h-3 w-3 mr-1" />
            {inputFiles.length} input files
          </Badge>
        )}
        {showFiles && outputFiles.length > 0 && (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            <ArrowDownToLine className="h-3 w-3 mr-1" />
            {outputFiles.length} output files
          </Badge>
        )}
        {/* Step stats */}
        {stats && (
          <>
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
              <CheckCircle2 className="h-3 w-3 mr-1" />
            {stats.completed} completed
          </Badge>
          {stats.running > 0 && (
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              {stats.running} running
            </Badge>
          )}
          {stats.failed > 0 && (
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
              <XCircle className="h-3 w-3 mr-1" />
              {stats.failed} failed
            </Badge>
          )}
          {stats.pending > 0 && (
            <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200">
              <Clock className="h-3 w-3 mr-1" />
              {stats.pending} pending
            </Badge>
          )}
          </>
        )}
      </div>

      {/* Flow Canvas with side panel */}
      <div className="flex-1 flex gap-4 min-h-[400px]">
        <div className={`border rounded-lg bg-slate-50 dark:bg-slate-900 ${(selectedNode || selectedFile) ? "flex-1" : "w-full"}`}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.3}
            maxZoom={1.5}
            defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#e2e8f0" gap={16} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {/* Side Panel - Node Details */}
        {selectedNode && (
          <div className="w-[320px] min-w-[280px] border rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
            <NodeDetailPanel
              node={selectedNode}
              status={statusMap.get(selectedNode.id)}
              inputFiles={inputFiles}
              outputFiles={outputFiles}
              inputStepId={inputStepId}
              onFileSelect={(file) => {
                setSelectedFile(file);
                setSelectedNode(null);
              }}
              onClose={() => setSelectedNode(null)}
            />
          </div>
        )}

        {/* Side Panel - File Details */}
        {selectedFile && (
          <div className="w-[320px] min-w-[280px] border rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
            <FileDetailPanel
              file={selectedFile}
              onClose={() => setSelectedFile(null)}
            />
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Click on a step or file to see details. Blue = input files, Green = output files.
      </p>
    </div>
  );
}
