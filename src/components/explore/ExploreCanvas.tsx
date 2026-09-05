"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Activity, Code2, Database, ExternalLink, FlaskConical, Grid3x3, Image as ImageIcon, Info, LayoutGrid, Map as MapIcon, Maximize2, Minimize2, Play, Sparkle, X } from "lucide-react";
import { useStoredPreference } from "@/lib/explore/use-stored-preference";
import { CodeEditor } from "@/components/explore/CodeEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fetcher, formatCell, ROLE_LABELS } from "@/lib/explore/client";
import {
  assignCanvasHues,
  CANVAS_EXPANDED_DATASET,
  CANVAS_SIZES,
  COMPUTE_HUE,
  layoutCanvas,
  type CanvasAnalysisData,
  type CanvasDatasetData,
  type CanvasFigureData,
  type CanvasGraph,
  type CanvasSourceData,
} from "@/lib/explore/canvas-layout";
import { DATASET_KIND_DEFINITIONS } from "@/lib/explore/dataset-kinds";
import type { ExploreColumn, ExploreRole, ExploreRowRecord } from "@/lib/explore/types";

type DatasetNodeType = Node<CanvasDatasetData & { expanded: boolean; hue: number; onToggle: (id: string) => void }, "dataset">;
type AnalysisNodeType = Node<CanvasAnalysisData & { hue: number; onOpenCode: (analysisId: string) => void }, "analysis">;
type SourceNodeType = Node<CanvasSourceData, "source">;
type FigureNodeType = Node<CanvasFigureData & { hue: number }, "figure">;
type CanvasFlowNode = DatasetNodeType | AnalysisNodeType | SourceNodeType | FigureNodeType;

const EXPANDED_ROWS = 10;
const EXPANDED_COLUMNS = 8;

const handleClass = "!h-2 !w-2 !border-0 !bg-muted-foreground/60";

/** Card colours derived from a hue: a tinted header, a saturated border and an edge stroke. */
function tint(hue: number) {
  return {
    border: `hsl(${hue} 45% 62%)`,
    header: `hsl(${hue} 55% 95%)`,
    strong: `hsl(${hue} 50% 38%)`,
    stroke: `hsl(${hue} 45% 55%)`,
  };
}

function SourceNode({ data }: NodeProps<SourceNodeType>) {
  return (
    <div className="w-[220px] rounded-lg border border-dashed bg-card px-3 py-2 text-xs shadow-sm">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{data.sourceType.replace("-", " ")}</div>
      <div className="truncate font-medium" title={data.label}>{data.label}</div>
      <Handle type="source" position={Position.Right} className={handleClass} />
    </div>
  );
}

function OverflowChip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{children}</span>;
}

/**
 * A dataset card: a real fragment of the table plus chips that say how much
 * is hidden on each axis. Expanded, it shows more rows and columns in place.
 */
function DatasetNode({ id, data }: NodeProps<DatasetNodeType>) {
  const { expanded } = data;
  const { data: more } = useSWR<{ rows: ExploreRowRecord[] }>(
    expanded ? `/api/explore/datasets/${data.datasetId}/rows?limit=${EXPANDED_ROWS}` : null,
    fetcher
  );
  const previewKeys = new Set(data.previewColumns.map((column) => column.key));
  const columns: ExploreColumn[] = expanded
    ? [...data.previewColumns, ...data.columns.filter((column) => !previewKeys.has(column.key) && !column.key.endsWith("_db_id"))].slice(0, EXPANDED_COLUMNS)
    : data.previewColumns;
  const rows = expanded ? (more?.rows.map((row) => row.data) ?? data.previewRows) : data.previewRows;
  const hiddenColumns = Math.max(data.columnCount - columns.length, 0);
  const hiddenRows = Math.max(data.rowCount - rows.length, 0);
  const roleOf = (key: string) => (Object.entries(data.roles) as Array<[ExploreRole, string]>).find(([, column]) => column === key)?.[0];
  const size = expanded ? CANVAS_EXPANDED_DATASET : CANVAS_SIZES.dataset;
  const colours = tint(data.hue);

  return (
    <div className="flex flex-col rounded-lg border bg-card shadow-sm" style={{ width: size.width, minHeight: size.height, borderColor: colours.border }}>
      <Handle type="target" position={Position.Left} className={handleClass} />
      <div className="flex items-start gap-2 border-b px-3 py-2" style={{ background: colours.header }}>
        <Database className="mt-0.5 h-4 w-4 shrink-0" style={{ color: colours.strong }} />
        <div className="min-w-0 flex-1">
          <Link href={`/explore/datasets/${data.datasetId}`} className="block truncate text-sm font-medium hover:underline" title={data.name}>
            {data.name}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            <span className="tabular-nums">{data.rowCount.toLocaleString()} rows × {data.columnCount} columns</span>
            {data.version !== null && <span>v{data.version}</span>}
            {data.origin && <span className="basis-full truncate" title={data.origin}>{data.origin}</span>}
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{DATASET_KIND_DEFINITIONS[data.datasetKind as keyof typeof DATASET_KIND_DEFINITIONS]?.label ?? data.datasetKind}</Badge>
            {data.sensitivity !== "standard" && <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{data.sensitivity}</Badge>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => data.onToggle(id)}
          className="nodrag rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={expanded ? "Collapse dataset" : "Expand dataset"}
          title={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className={cn("nodrag nowheel min-h-0 flex-1", expanded ? "overflow-auto" : "overflow-hidden")} style={{ maxHeight: expanded ? size.height - 120 : undefined }}>
        <table className="w-full text-[11px]">
          <thead className="bg-muted/50 text-left">
            <tr>
              {columns.map((column) => {
                const role = roleOf(column.key);
                return (
                  <th key={column.key} className="whitespace-nowrap px-2 py-1 font-medium" title={column.key}>
                    <span className="block max-w-[140px] truncate">{column.label}</span>
                    {role && <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{ROLE_LABELS[role]}</span>}
                  </th>
                );
              })}
              {hiddenColumns > 0 && <th className="w-4 px-1 py-1 text-muted-foreground" aria-label={`${hiddenColumns} more columns`}>…</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t">
                {columns.map((column) => (
                  <td key={column.key} className={cn("max-w-[160px] truncate whitespace-nowrap px-2 py-1", column.type === "number" && "text-right tabular-nums")} title={formatCell(row[column.key])}>
                    {formatCell(row[column.key])}
                  </td>
                ))}
                {hiddenColumns > 0 && <td className="px-2 py-1 text-muted-foreground">…</td>}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="px-2 py-3 text-muted-foreground" colSpan={columns.length + 1}>{expanded && !more ? "Loading rows" : "No rows"}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-1.5 border-t px-3 py-1.5">
        {hiddenRows > 0 ? <OverflowChip>+{hiddenRows.toLocaleString()} rows</OverflowChip> : <span className="text-[10px] text-muted-foreground">all rows</span>}
        {hiddenColumns > 0 ? <OverflowChip>+{hiddenColumns} columns</OverflowChip> : <span className="text-[10px] text-muted-foreground">all columns</span>}
        <span className="flex-1" />
        {data.views.includes("subject-timeline") && (
          <Link href={`/explore/datasets/${data.datasetId}/subject-timeline`} className="nodrag rounded p-1 text-muted-foreground hover:text-foreground" title="Subject timeline">
            <Activity className="h-3.5 w-3.5" />
          </Link>
        )}
        {data.views.includes("heatmap") && (
          <Link href={`/explore/datasets/${data.datasetId}/heatmap`} className="nodrag rounded p-1 text-muted-foreground hover:text-foreground" title="Heatmap">
            <Grid3x3 className="h-3.5 w-3.5" />
          </Link>
        )}
        <Link href={`/explore/datasets/${data.datasetId}`} className="nodrag inline-flex items-center gap-1 text-[11px] font-medium hover:underline">
          Open table <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <Handle type="source" position={Position.Right} className={handleClass} />
    </div>
  );
}

function AnalysisNode({ data }: NodeProps<AnalysisNodeType>) {
  const status = data.latestRun?.status;
  const colours = tint(data.hue);
  return (
    <div className="w-[300px] rounded-lg border bg-card shadow-sm" style={{ borderColor: colours.border }}>
      <Handle type="target" position={Position.Left} className={handleClass} />
      <div className="flex items-start gap-2 px-3 py-2" style={{ background: colours.header }}>
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" style={{ color: colours.strong }} />
        <div className="min-w-0 flex-1">
          <Link href={`/explore/analyses/${data.analysisId}`} className="block truncate text-sm font-medium hover:underline" title={data.name}>{data.name}</Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            <span className="capitalize">{data.language}</span>
            {data.kitId && <span>kit {data.kitId}</span>}
            {data.revision !== null && <span>revision {data.revision}</span>}
            {data.codeLines > 0 && <span>{data.codeLines} lines</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => data.onOpenCode(data.analysisId)}
          className="nodrag inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Show the code that turns the inputs into the outputs"
        >
          <Code2 className="h-3.5 w-3.5" /> Code
        </button>
      </div>
      <button
        type="button"
        onClick={() => data.onOpenCode(data.analysisId)}
        className="nodrag block w-full border-t bg-muted/40 px-3 py-2 text-left"
        title="Show the full code"
      >
        <pre className="max-h-[72px] overflow-hidden whitespace-pre font-mono text-[10px] leading-[14px] text-muted-foreground">{data.codePreview || "(no code yet)"}</pre>
      </button>
      <div className="flex items-center gap-2 border-t px-3 py-1.5 text-[11px]">
        {data.latestRun ? (
          <>
            <Badge variant={status === "completed" ? "secondary" : "outline"} className="px-1.5 py-0 text-[10px]">{status}</Badge>
            <Link href={`/explore/runs/${data.latestRun.id}`} className="nodrag text-muted-foreground hover:underline">{data.latestRun.runNumber}</Link>
          </>
        ) : (
          <span className="inline-flex items-center gap-1 text-muted-foreground"><Play className="h-3 w-3" /> not run yet</span>
        )}
        <span className="flex-1" />
        <Link href={`/explore/analyses/${data.analysisId}`} className="nodrag inline-flex items-center gap-1 font-medium hover:underline">Open <ExternalLink className="h-3 w-3" /></Link>
      </div>
      <Handle type="source" position={Position.Right} className={handleClass} />
    </div>
  );
}

function FigureNode({ data }: NodeProps<FigureNodeType>) {
  const isImage = data.format === "png" || data.format === "svg";
  const colours = tint(data.hue);
  return (
    <div className="w-[220px] overflow-hidden rounded-lg border bg-card shadow-sm" style={{ borderColor: colours.border }}>
      <Handle type="target" position={Position.Left} className={handleClass} />
      <div className="flex h-[96px] items-center justify-center bg-muted/40">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.url} alt={data.name} className="max-h-full max-w-full object-contain" />
        ) : (
          <ImageIcon className="h-8 w-8 text-muted-foreground/60" />
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
        <span className="truncate font-medium" title={data.name}>{data.name}</span>
        <span className="text-muted-foreground">{data.format === "plotly-json" ? "interactive" : data.format}</span>
        <span className="flex-1" />
        <Link href={`/explore/runs/${data.runId}`} className="nodrag inline-flex items-center gap-1 hover:underline">Run <ExternalLink className="h-3 w-3" /></Link>
      </div>
    </div>
  );
}

const nodeTypes = { source: SourceNode, dataset: DatasetNode, analysis: AnalysisNode, figure: FigureNode };

function storageKey(scope: string): string {
  return `seqdesk:explore:canvas:${scope}`;
}

function readPositions(scope: string): Record<string, { x: number; y: number }> {
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    return raw ? (JSON.parse(raw) as Record<string, { x: number; y: number }>) : {};
  } catch {
    return {};
  }
}

function writePositions(scope: string, positions: Record<string, { x: number; y: number }>): void {
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(positions));
  } catch {
    // Storage may be unavailable; the layout is recomputed next time.
  }
}

export interface ExploreCanvasProps {
  scope: string;
  className?: string;
  /** Grow to the bottom of the window instead of a fixed height. */
  fillViewport?: boolean;
}

/**
 * The Explore canvas for one scope: every dataset, analysis and figure as a
 * card, connected by their lineage. Positions are kept per scope in the
 * browser; "Arrange" recomputes the layered layout.
 */
export function ExploreCanvas({ scope, className, fillViewport = false }: ExploreCanvasProps) {
  const { data: graph, error, isLoading } = useSWR<CanvasGraph>(`/api/explore/canvas?targetKey=${encodeURIComponent(scope)}`, fetcher, {
    refreshInterval: 15000,
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [arrangeVersion, setArrangeVersion] = useState(0);
  const [openAnalysisId, setOpenAnalysisId] = useState<string | null>(null);
  const [minimap, setMinimap] = useStoredPreference<"shown" | "hidden">("seqdesk:explore:canvas:minimap", "shown", ["shown", "hidden"]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number>(640);

  useEffect(() => {
    if (!fillViewport) return;
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      const top = element.getBoundingClientRect().top;
      setHeight(Math.max(480, Math.floor(window.innerHeight - top - 24)));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [fillViewport, graph]);

  const openCode = useCallback((analysisId: string) => setOpenAnalysisId(analysisId), []);

  // Expanding a card changes its footprint, so the layered layout is recomputed
  // and hand-moved positions are dropped for this scope.
  const toggle = useCallback(
    (id: string) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      try {
        window.localStorage.removeItem(storageKey(scope));
      } catch {
        // ignore
      }
      setArrangeVersion((value) => value + 1);
    },
    [scope]
  );

  const flowNodes = useMemo<CanvasFlowNode[]>(() => {
    if (!graph) return [];
    const auto = layoutCanvas(graph, { expanded });
    const hues = assignCanvasHues(graph);
    const stored = arrangeVersion === 0 ? readPositions(scope) : {};
    return graph.nodes.map((node) => {
      const position = stored[node.id] ?? auto[node.id] ?? { x: 0, y: 0 };
      const hue = hues[node.id] ?? COMPUTE_HUE;
      if (node.data.kind === "dataset") {
        return { id: node.id, type: "dataset", position, data: { ...node.data, expanded: expanded.has(node.id), hue, onToggle: toggle } } as DatasetNodeType;
      }
      if (node.data.kind === "analysis") return { id: node.id, type: "analysis", position, data: { ...node.data, hue, onOpenCode: openCode } } as AnalysisNodeType;
      if (node.data.kind === "figure") return { id: node.id, type: "figure", position, data: { ...node.data, hue } } as FigureNodeType;
      return { id: node.id, type: "source", position, data: node.data } as SourceNodeType;
    });
  }, [graph, expanded, toggle, openCode, scope, arrangeVersion]);

  const flowEdges = useMemo<Edge[]>(() => {
    if (!graph) return [];
    const hues = assignCanvasHues(graph);
    return graph.edges.map((edge) => {
      const hue = hues[edge.source] ?? hues[edge.target] ?? null;
      const stroke = hue === null ? "var(--border)" : tint(hue).stroke;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: stroke },
        labelStyle: { fontSize: 10, fill: "var(--muted-foreground)" },
        labelBgStyle: { fill: "var(--card)", fillOpacity: 0.9 },
        style: { stroke, strokeWidth: 1.5, cursor: "pointer" },
        interactionWidth: 24,
      };
    });
  }, [graph]);

  useEffect(() => {
    // Keep positions of nodes the user already moved; new nodes take the computed slot.
    setNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node] as const));
      return flowNodes.map((node) => {
        const existing = arrangeVersion === 0 ? currentById.get(node.id) : undefined;
        return existing ? ({ ...node, position: existing.position } as CanvasFlowNode) : node;
      });
    });
    setEdges(flowEdges);
  }, [flowNodes, flowEdges, setNodes, setEdges, arrangeVersion]);

  const persist = useCallback(() => {
    writePositions(scope, Object.fromEntries(nodes.map((node) => [node.id, node.position])));
  }, [nodes, scope]);

  // Clicking an arrow opens the code of the analysis it goes into or comes from.
  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_event, edge) => {
      const analysisId = [edge.source, edge.target].find((id) => id.startsWith("analysis:"))?.slice("analysis:".length);
      if (analysisId) setOpenAnalysisId(analysisId);
    },
    []
  );

  const arrange = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey(scope));
    } catch {
      // ignore
    }
    setArrangeVersion((value) => value + 1);
  }, [scope]);

  if (error) return <p className="text-sm text-destructive">Could not load the canvas: {String(error.message)}</p>;
  if (isLoading && !graph) return <Skeleton className={cn("h-[560px] w-full", className)} />;
  if (graph && graph.nodes.length === 0) {
    return (
      <div className={cn("rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground", className)}>
        Nothing to show yet. Build or import a dataset and it appears here as a card.
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn("relative w-full overflow-hidden rounded-lg border bg-muted/20", className)} style={{ height: fillViewport ? height : 640 }}>
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
        <CanvasLegend />
        <Button size="sm" variant="outline" onClick={() => setMinimap(minimap === "shown" ? "hidden" : "shown")} title={minimap === "shown" ? "Hide the overview map" : "Show the overview map"} aria-pressed={minimap === "shown"}>
          <MapIcon className="mr-2 h-4 w-4" />
          Overview
        </Button>
        <Button size="sm" variant="outline" onClick={arrange} title="Recompute the layout">
          <LayoutGrid className="mr-2 h-4 w-4" />
          Arrange
        </Button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={persist}
        onEdgeClick={onEdgeClick}
        edgesFocusable
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.5}
        nodesConnectable={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border)" gap={20} />
        <Controls showInteractive={false} />
        {minimap === "shown" && (
          <MiniMap
            pannable
            zoomable
            className="!bg-card"
            nodeColor={(node) => {
              const hue = (node.data as { hue?: number }).hue;
              return typeof hue === "number" ? tint(hue).stroke : "#94A3B8";
            }}
          />
        )}
      </ReactFlow>
      {openAnalysisId && <CodePanel analysisId={openAnalysisId} onClose={() => setOpenAnalysisId(null)} />}
    </div>
  );
}

const LEGEND_ENTRIES: Array<{ hue: number; label: string; note: string }> = [
  { hue: 140, label: "Inputs", note: "from your data, imports and pipeline runs; a pipeline re-run refreshes them" },
  { hue: COMPUTE_HUE, label: "Compute", note: "code that turns inputs into outputs; click an arrow to read it" },
  { hue: 260, label: "Outputs", note: "written by compute; the hue is the input hue turned a third of the wheel" },
];

/** Three colour dots and an info button; the explanation opens on demand so it never covers cards. */
function CanvasLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="What the colours mean"
        title="What the colours mean"
        className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-card px-2 text-muted-foreground shadow-xs hover:bg-muted hover:text-foreground"
      >
        {LEGEND_ENTRIES.map((entry) => (
          <span key={entry.label} className="h-2.5 w-2.5 rounded-full border" style={{ background: tint(entry.hue).header, borderColor: tint(entry.hue).border }} />
        ))}
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-[340px] rounded-md border bg-card px-3 py-2 text-[11px] shadow-md" role="note">
          {LEGEND_ENTRIES.map((entry) => (
            <div key={entry.label} className="flex items-start gap-2 py-0.5">
              <span className="mt-0.5 h-3 w-3 shrink-0 rounded-sm border" style={{ background: tint(entry.hue).header, borderColor: tint(entry.hue).border }} />
              <span><span className="font-medium">{entry.label}</span> <span className="text-muted-foreground">{entry.note}</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Side panel with the current code of one analysis, opened from a card or an arrow. */
function CodePanel({ analysisId, onClose }: { analysisId: string; onClose: () => void }) {
  const { data, error } = useSWR<{ analysis: { name: string; description: string | null; language: "python" | "r"; code: string; currentRevision: { number: number } | null; kitId: string | null } }>(
    `/api/explore/analyses/${analysisId}`,
    fetcher
  );
  const analysis = data?.analysis;
  const [tab, setTab] = useState<"code" | "description">("code");
  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-[min(560px,80%)] flex-col border-l bg-card shadow-xl" role="dialog" aria-label="Analysis code">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Code2 className="h-4 w-4 text-violet-700" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{analysis?.name ?? "Loading"}</div>
          {analysis && (
            <div className="text-[11px] text-muted-foreground">
              {analysis.language}{analysis.kitId ? `, kit ${analysis.kitId}` : ""}{analysis.currentRevision ? `, revision ${analysis.currentRevision.number}` : ""}
            </div>
          )}
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href={`/explore/analyses/${analysisId}`}>Open analysis</Link>
        </Button>
        <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close code panel">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex gap-1 border-b px-3 py-1.5 text-xs" role="tablist" aria-label="Code panel view">
        <button type="button" role="tab" aria-selected={tab === "code"} onClick={() => setTab("code")} className={cn("rounded px-2 py-1", tab === "code" ? "bg-secondary font-medium" : "text-muted-foreground")}>
          Code
        </button>
        <button type="button" role="tab" aria-selected={tab === "description"} onClick={() => setTab("description")} className={cn("inline-flex items-center gap-1 rounded px-2 py-1", tab === "description" ? "bg-secondary font-medium" : "text-muted-foreground")}>
          <Sparkle className="h-3 w-3" /> Description
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {error && <p className="text-sm text-destructive">{String(error.message)}</p>}
        {!analysis && !error && <Skeleton className="h-64 w-full" />}
        {analysis && tab === "code" && <CodeEditor value={analysis.code} language={analysis.language} readOnly height="100%" ariaLabel={`Code of ${analysis.name}`} />}
        {analysis && tab === "description" && (
          <div className="space-y-3 p-2 text-sm">
            {analysis.description && <p>{analysis.description}</p>}
            <div className="rounded-md border border-dashed p-4 text-muted-foreground">
              No plain-language description of this code yet. When the assistant module is enabled, it will describe what each revision does here.
            </div>
          </div>
        )}
      </div>
      <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">This code turns the connected inputs into the outputs on the canvas. Edit it from the analysis page; every change is a new revision.</p>
    </div>
  );
}
