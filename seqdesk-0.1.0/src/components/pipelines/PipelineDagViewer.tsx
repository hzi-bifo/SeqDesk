"use client";

import { useMemo, useState, useCallback } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText,
  FileOutput,
  X,
  Wrench,
  ArrowRight,
  ExternalLink,
  Info,
  Settings,
  Users,
  ChevronRight,
  Hash,
  ToggleLeft,
  Type,
  Folder,
  Database,
  Upload,
  Download,
  ArrowUpFromLine,
  ArrowDownToLine,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// Types matching the definitions/index.ts
export interface PipelineParameter {
  name: string;
  type: "string" | "integer" | "number" | "boolean" | "file" | "path";
  description: string;
  default?: string | number | boolean;
  required?: boolean;
  enum?: (string | number)[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  group?: string;
  hidden?: boolean;
}

export interface PipelineParameterGroup {
  name: string;
  description?: string;
  parameters: PipelineParameter[];
}

export interface PipelineInfo {
  name?: string;
  description?: string;
  url?: string;
  version?: string;
  minNextflowVersion?: string;
  authors?: string[];
  parameterGroups?: PipelineParameterGroup[];
}

export type SeqDeskSource =
  | "order_reads"
  | "order_files"
  | "sample_reads"
  | "samplesheet"
  | "reference_genome"
  | "manual";

export type SeqDeskDestination =
  | "sample_qc"
  | "sample_metadata"
  | "order_files"
  | "order_report"
  | "sample_assemblies"
  | "sample_bins"
  | "sample_annotations"
  | "download_only";

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
  parameters?: string[];
  // SeqDesk integration
  source?: SeqDeskSource;
  sourceDescription?: string;
  destination?: SeqDeskDestination;
  destinationField?: string;
  destinationDescription?: string;
}

export interface DagEdge {
  from: string;
  to: string;
  label?: string;
}

interface PipelineDagViewerProps {
  nodes: DagNode[];
  edges: DagEdge[];
  pipeline?: PipelineInfo;
  className?: string;
}

// Category colors
const categoryStyles: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  qc: { bg: "bg-blue-50", border: "border-blue-400", text: "text-blue-900", badge: "bg-blue-100 text-blue-700" },
  preprocessing: { bg: "bg-blue-50", border: "border-blue-400", text: "text-blue-900", badge: "bg-blue-100 text-blue-700" },
  assembly: { bg: "bg-green-50", border: "border-green-400", text: "text-green-900", badge: "bg-green-100 text-green-700" },
  alignment: { bg: "bg-green-50", border: "border-green-400", text: "text-green-900", badge: "bg-green-100 text-green-700" },
  binning: { bg: "bg-purple-50", border: "border-purple-400", text: "text-purple-900", badge: "bg-purple-100 text-purple-700" },
  variant_calling: { bg: "bg-purple-50", border: "border-purple-400", text: "text-purple-900", badge: "bg-purple-100 text-purple-700" },
  annotation: { bg: "bg-orange-50", border: "border-orange-400", text: "text-orange-900", badge: "bg-orange-100 text-orange-700" },
  quantification: { bg: "bg-orange-50", border: "border-orange-400", text: "text-orange-900", badge: "bg-orange-100 text-orange-700" },
  reporting: { bg: "bg-gray-50", border: "border-gray-400", text: "text-gray-900", badge: "bg-gray-100 text-gray-700" },
  input: { bg: "bg-emerald-50", border: "border-emerald-500", text: "text-emerald-900", badge: "bg-emerald-100 text-emerald-700" },
  output: { bg: "bg-sky-50", border: "border-sky-500", text: "text-sky-900", badge: "bg-sky-100 text-sky-700" },
};

// Custom node data type
interface PipelineStepNodeData {
  label: string;
  description?: string;
  category?: string;
  nodeType?: "step" | "input" | "output";
  fileTypes?: string[];
  tools?: string[];
  outputs?: string[];
  source?: SeqDeskSource;
  sourceDescription?: string;
  destination?: SeqDeskDestination;
  destinationDescription?: string;
}

// Source/destination display helpers
function getSourceLabel(source?: SeqDeskSource): string {
  switch (source) {
    case "order_reads": return "Order Files";
    case "order_files": return "Order Files";
    case "sample_reads": return "Sample Reads";
    case "samplesheet": return "Auto-generated";
    case "reference_genome": return "Reference DB";
    case "manual": return "Manual Upload";
    default: return "";
  }
}

function getDestinationLabel(dest?: SeqDeskDestination): string {
  switch (dest) {
    case "sample_qc": return "Sample QC";
    case "sample_metadata": return "Sample Data";
    case "order_files": return "Order Files";
    case "order_report": return "Order Report";
    case "sample_assemblies": return "Assemblies";
    case "sample_bins": return "Genome Bins";
    case "sample_annotations": return "Annotations";
    case "download_only": return "Download";
    default: return "";
  }
}

// Custom node component for pipeline steps
function PipelineStepNode({ data }: { data: PipelineStepNodeData }) {
  const style = categoryStyles[data.category || ""] || categoryStyles.reporting;

  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 shadow-sm min-w-[180px] cursor-pointer hover:shadow-md transition-shadow ${style.bg} ${style.border}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`font-semibold text-sm ${style.text}`}>
            {data.label}
          </span>
          {data.category && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded capitalize ${style.badge}`}>
              {data.category}
            </span>
          )}
        </div>
        {data.description && (
          <p className="text-xs text-muted-foreground leading-tight line-clamp-2">
            {data.description}
          </p>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
    </div>
  );
}

// Custom node component for input files
function InputNode({ data }: { data: PipelineStepNodeData }) {
  const style = categoryStyles.input;
  const sourceLabel = getSourceLabel(data.source);

  return (
    <div
      className={`px-4 py-3 rounded-xl border-2 border-dashed shadow-sm min-w-[180px] cursor-pointer hover:shadow-md transition-shadow ${style.bg} ${style.border}`}
    >
      {/* SeqDesk source indicator */}
      {sourceLabel && (
        <div className="flex items-center gap-1 text-[10px] text-emerald-700 mb-2 -mt-1">
          <Database className="h-3 w-3" />
          <span>from SeqDesk: {sourceLabel}</span>
        </div>
      )}

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
            {data.fileTypes.length > 3 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600">
                +{data.fileTypes.length - 3}
              </span>
            )}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-emerald-500" />
    </div>
  );
}

// Custom node component for output files
function OutputNode({ data }: { data: PipelineStepNodeData }) {
  const style = categoryStyles.output;
  const destLabel = getDestinationLabel(data.destination);

  return (
    <div
      className={`px-4 py-3 rounded-xl border-2 border-dashed shadow-sm min-w-[180px] cursor-pointer hover:shadow-md transition-shadow ${style.bg} ${style.border}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-sky-500" />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <ArrowDownToLine className={`h-4 w-4 ${style.text}`} />
          <span className={`font-semibold text-sm ${style.text}`}>
            {data.label}
          </span>
        </div>
        {data.fileTypes && data.fileTypes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {data.fileTypes.slice(0, 3).map((ft) => (
              <span key={ft} className="text-[10px] px-1.5 py-0.5 rounded bg-sky-200 text-sky-800 font-mono">
                .{ft}
              </span>
            ))}
            {data.fileTypes.length > 3 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-600">
                +{data.fileTypes.length - 3}
              </span>
            )}
          </div>
        )}
      </div>

      {/* SeqDesk destination indicator */}
      {destLabel && (
        <div className="flex items-center gap-1 text-[10px] text-sky-700 mt-2 -mb-1">
          <Database className="h-3 w-3" />
          <span>to SeqDesk: {destLabel}</span>
        </div>
      )}
    </div>
  );
}

const nodeTypes = {
  pipelineStep: PipelineStepNode,
  inputNode: InputNode,
  outputNode: OutputNode,
};

// Parameter type icon
function ParamTypeIcon({ type }: { type: string }) {
  switch (type) {
    case "boolean":
      return <ToggleLeft className="h-3 w-3 text-purple-500" />;
    case "integer":
    case "number":
      return <Hash className="h-3 w-3 text-blue-500" />;
    case "path":
    case "file":
      return <Folder className="h-3 w-3 text-amber-500" />;
    default:
      return <Type className="h-3 w-3 text-gray-500" />;
  }
}

// Layout algorithm using Dagre-like positioning
function layoutNodes(dagNodes: DagNode[], dagEdges: DagEdge[]): Node[] {
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
      let type = "pipelineStep";
      if (node.nodeType === "input") {
        type = "inputNode";
      } else if (node.nodeType === "output") {
        type = "outputNode";
      }

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
          outputs: node.outputs,
          source: node.source,
          sourceDescription: node.sourceDescription,
          destination: node.destination,
          destinationDescription: node.destinationDescription,
        },
      });
    });
  }

  return nodes;
}

// Detail panel for selected node
function NodeDetailPanel({
  node,
  pipeline,
  onClose,
}: {
  node: DagNode;
  pipeline?: PipelineInfo;
  onClose: () => void;
}) {
  // Get relevant parameters for this step
  const relevantParams = useMemo(() => {
    if (!node.parameters || !pipeline?.parameterGroups) return [];
    const paramNames = new Set(node.parameters);
    const params: PipelineParameter[] = [];
    for (const group of pipeline.parameterGroups) {
      for (const param of group.parameters) {
        if (paramNames.has(param.name)) {
          params.push({ ...param, group: group.name });
        }
      }
    }
    return params;
  }, [node.parameters, pipeline?.parameterGroups]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-2 p-4 border-b">
        <div>
          <h3 className="font-semibold text-lg">{node.name}</h3>
          <Badge variant="outline" className="mt-1 capitalize">
            {node.nodeType === "input" ? "Input" : node.nodeType === "output" ? "Output" : node.category?.replace("_", " ")}
          </Badge>
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

          {/* SeqDesk Source (for inputs) */}
          {node.source && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-200 mb-1">
                <Database className="h-4 w-4" />
                SeqDesk Source
              </div>
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                {node.sourceDescription || getSourceLabel(node.source)}
              </p>
            </div>
          )}

          {/* SeqDesk Destination (for outputs) */}
          {node.destination && (
            <div className="p-3 rounded-lg bg-sky-50 dark:bg-sky-950 border border-sky-200 dark:border-sky-800">
              <div className="flex items-center gap-2 text-sm font-medium text-sky-800 dark:text-sky-200 mb-1">
                <Database className="h-4 w-4" />
                SeqDesk Destination
              </div>
              <p className="text-sm text-sky-700 dark:text-sky-300">
                {node.destinationDescription || getDestinationLabel(node.destination)}
              </p>
              {node.destinationField && (
                <p className="text-xs text-sky-600 dark:text-sky-400 mt-1">
                  Field: <code className="bg-sky-100 dark:bg-sky-900 px-1 rounded">{node.destinationField}</code>
                </p>
              )}
            </div>
          )}

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

          {/* Tools (for steps) */}
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

          {/* File Types (for inputs/outputs) */}
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

          {/* Output Formats (for steps) */}
          {node.outputs && node.outputs.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <ArrowRight className="h-4 w-4" />
                Output Formats
              </div>
              <div className="flex flex-wrap gap-1.5">
                {node.outputs.map((out) => (
                  <Badge key={out} variant="outline" className="font-mono text-xs">
                    .{out}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Relevant Parameters */}
          {relevantParams.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <Settings className="h-4 w-4" />
                Related Parameters
              </div>
              <div className="space-y-2">
                {relevantParams.map((param) => (
                  <div
                    key={param.name}
                    className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 text-xs"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <ParamTypeIcon type={param.type} />
                      <code className="font-semibold text-slate-700 dark:text-slate-300">
                        --{param.name}
                      </code>
                      {param.required && (
                        <Badge variant="destructive" className="text-[10px] h-4">
                          required
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground">{param.description}</p>
                    {param.default !== undefined && (
                      <p className="mt-1">
                        <span className="text-muted-foreground">Default:</span>{" "}
                        <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">
                          {String(param.default)}
                        </code>
                      </p>
                    )}
                    {param.enum && (
                      <p className="mt-1">
                        <span className="text-muted-foreground">Options:</span>{" "}
                        {param.enum.map((v, i) => (
                          <code key={i} className="bg-slate-200 dark:bg-slate-700 px-1 rounded mx-0.5">
                            {String(v)}
                          </code>
                        ))}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// Pipeline overview panel (when no node is selected)
function PipelineOverviewPanel({ pipeline }: { pipeline: PipelineInfo }) {
  return (
    <Tabs defaultValue="info" className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 border-b">
        <h3 className="font-semibold text-lg mb-2">{pipeline.name || "Pipeline"}</h3>
        <TabsList className="w-full">
          <TabsTrigger value="info" className="flex-1">
            <Info className="h-4 w-4 mr-1" />
            Info
          </TabsTrigger>
          <TabsTrigger value="params" className="flex-1">
            <Settings className="h-4 w-4 mr-1" />
            Params
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="info" className="flex-1 m-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-4">
            {pipeline.description && (
              <p className="text-sm text-muted-foreground">{pipeline.description}</p>
            )}

            {pipeline.url && (
              <a
                href={pipeline.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                {pipeline.url}
              </a>
            )}

            {pipeline.version && (
              <div>
                <div className="text-sm font-medium mb-1">Version</div>
                <Badge variant="outline">{pipeline.version}</Badge>
              </div>
            )}

            {pipeline.minNextflowVersion && (
              <div>
                <div className="text-sm font-medium mb-1">Requires Nextflow</div>
                <Badge variant="secondary">{">="} {pipeline.minNextflowVersion}</Badge>
              </div>
            )}

            {pipeline.authors && pipeline.authors.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-sm font-medium mb-2">
                  <Users className="h-4 w-4" />
                  Authors
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pipeline.authors.map((author) => (
                    <Badge key={author} variant="secondary" className="text-xs">
                      {author}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="params" className="flex-1 m-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4">
            {pipeline.parameterGroups && pipeline.parameterGroups.length > 0 ? (
              <Accordion type="multiple" defaultValue={[pipeline.parameterGroups[0].name]}>
                {pipeline.parameterGroups.map((group) => (
                  <AccordionItem key={group.name} value={group.name}>
                    <AccordionTrigger className="text-sm hover:no-underline">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{group.name}</span>
                        <Badge variant="secondary" className="text-[10px] h-5">
                          {group.parameters.length}
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      {group.description && (
                        <p className="text-xs text-muted-foreground mb-3">{group.description}</p>
                      )}
                      <div className="space-y-2">
                        {group.parameters.map((param) => (
                          <div
                            key={param.name}
                            className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 text-xs"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <ParamTypeIcon type={param.type} />
                              <code className="font-semibold text-slate-700 dark:text-slate-300">
                                --{param.name}
                              </code>
                              {param.required && (
                                <Badge variant="destructive" className="text-[10px] h-4">
                                  required
                                </Badge>
                              )}
                            </div>
                            <p className="text-muted-foreground">{param.description}</p>
                            {param.default !== undefined && (
                              <p className="mt-1">
                                <span className="text-muted-foreground">Default:</span>{" "}
                                <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">
                                  {String(param.default)}
                                </code>
                              </p>
                            )}
                            {param.enum && (
                              <p className="mt-1 flex flex-wrap items-center gap-1">
                                <span className="text-muted-foreground">Options:</span>
                                {param.enum.map((v, i) => (
                                  <code key={i} className="bg-slate-200 dark:bg-slate-700 px-1 rounded">
                                    {String(v)}
                                  </code>
                                ))}
                              </p>
                            )}
                            {(param.minimum !== undefined || param.maximum !== undefined) && (
                              <p className="mt-1">
                                <span className="text-muted-foreground">Range:</span>{" "}
                                {param.minimum !== undefined && <span>{param.minimum}</span>}
                                {param.minimum !== undefined && param.maximum !== undefined && " - "}
                                {param.maximum !== undefined && <span>{param.maximum}</span>}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            ) : (
              <p className="text-sm text-muted-foreground">No parameters defined</p>
            )}
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}

export function PipelineDagViewer({
  nodes: dagNodes,
  edges: dagEdges,
  pipeline,
  className = "",
}: PipelineDagViewerProps) {
  const [selectedNode, setSelectedNode] = useState<DagNode | null>(null);

  const nodeMap = useMemo(() => {
    const map = new Map<string, DagNode>();
    dagNodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [dagNodes]);

  const initialNodes = useMemo(() => layoutNodes(dagNodes, dagEdges), [dagNodes, dagEdges]);

  const initialEdges = useMemo<Edge[]>(
    () =>
      dagEdges.map((edge, idx) => ({
        id: `e${idx}`,
        source: edge.from,
        target: edge.to,
        type: "smoothstep",
        animated: false,
        style: { stroke: "#94a3b8", strokeWidth: 2 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "#94a3b8",
        },
        ...(edge.label && {
          label: edge.label,
          labelStyle: { fontSize: 10, fill: "#64748b" },
          labelBgStyle: { fill: "#f8fafc", fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
        }),
      })),
    [dagEdges]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onNodeClick: NodeMouseHandler = useCallback(
    (event, node) => {
      const dagNode = nodeMap.get(node.id);
      if (dagNode) {
        setSelectedNode(dagNode);
      }
    },
    [nodeMap]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const n of dagNodes) {
      if (n.nodeType === "input") {
        cats.add("input");
      } else if (n.nodeType === "output") {
        cats.add("output");
      } else if (n.category) {
        cats.add(n.category);
      }
    }
    return Array.from(cats).sort((a, b) => {
      if (a === "input") return -1;
      if (b === "input") return 1;
      if (a === "output") return 1;
      if (b === "output") return -1;
      return a.localeCompare(b);
    });
  }, [dagNodes]);

  const showSidePanel = selectedNode || pipeline;

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => {
          const style = categoryStyles[cat] || categoryStyles.reporting;
          const label =
            cat === "input"
              ? "Input Files"
              : cat === "output"
              ? "Output Files"
              : cat.replace("_", " ");
          return (
            <Badge key={cat} variant="outline" className={`${style.badge} border-0 capitalize`}>
              {label}
            </Badge>
          );
        })}
      </div>

      {/* Flow Canvas with side panel */}
      <div className="flex-1 flex gap-4 min-h-[400px]">
        <div className={`border rounded-lg bg-slate-50 dark:bg-slate-900 ${showSidePanel ? "flex-1" : "w-full"}`}>
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

        {/* Side Panel */}
        {showSidePanel && (
          <div className="w-[360px] min-w-[320px] border rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
            {selectedNode ? (
              <NodeDetailPanel
                node={selectedNode}
                pipeline={pipeline}
                onClose={() => setSelectedNode(null)}
              />
            ) : pipeline ? (
              <PipelineOverviewPanel pipeline={pipeline} />
            ) : null}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Click on a node to see details, or click empty space to view pipeline overview.
      </p>
    </div>
  );
}
