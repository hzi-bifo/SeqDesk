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
  NodeResizer,
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
import { Activity, Code2, Database, ExternalLink, FlaskConical, FoldHorizontal, Grid3x3, Image as ImageIcon, Info, LayoutGrid, Loader2, Map as MapIcon, Maximize2, Minimize2, Play, Sparkle, X } from "lucide-react";
import { CodeEditor } from "@/components/explore/CodeEditor";
import { PlotlyChart } from "@/components/explore/PlotlyChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { fetcher, formatCell, postJson, ROLE_LABELS } from "@/lib/explore/client";
import {
  assignCanvasHues,
  CANVAS_COLUMN_WIDTH,
  CANVAS_EXPANDED_DATASET,
  CANVAS_FOLD_WIDTH,
  CANVAS_MIN_SIZES,
  CANVAS_SIZES,
  COMPUTE_HUE,
  fitSegments,
  foldColumns,
  layoutCanvas,
  nodeSize,
  type CanvasAnalysisData,
  type CanvasDatasetData,
  type CanvasFigureData,
  type CanvasGraph,
  type CanvasNodeKind,
  type CanvasPendingData,
  type CanvasSourceData,
} from "@/lib/explore/canvas-layout";
import { DATASET_KIND_DEFINITIONS } from "@/lib/explore/dataset-kinds";
import { useStoredPreference } from "@/lib/explore/use-stored-preference";
import type { ExploreRole, ExploreRowRecord } from "@/lib/explore/types";

type Sizing = { onPreset: (id: string, size: { width: number; height: number }) => void; scopeQuery: string };
type DatasetNodeType = Node<CanvasDatasetData & Sizing & { hue: number }, "dataset">;
type AnalysisNodeType = Node<CanvasAnalysisData & { hue: number; scopeQuery: string; onOpenCode: (analysisId: string) => void; onRun: (analysisId: string) => Promise<void> }, "analysis">;
type SourceNodeType = Node<CanvasSourceData, "source">;
type FigureNodeType = Node<CanvasFigureData & { hue: number; scopeQuery: string }, "figure">;
type PendingNodeType = Node<CanvasPendingData & { hue: number; scopeQuery: string }, "pending">;
type CanvasFlowNode = DatasetNodeType | AnalysisNodeType | SourceNodeType | FigureNodeType | PendingNodeType;

const MAX_FETCHED_ROWS = 200;
const COLUMN_WIDTH = CANVAS_COLUMN_WIDTH;
const ROW_HEIGHT = 22;
const CODE_LINE_HEIGHT = 14;

const handleClass = "!h-2 !w-2 !border-0 !bg-muted-foreground/60";
const resizerLine = "!border-transparent";
const resizerHandle = "!h-2.5 !w-2.5 !rounded-sm !border !border-muted-foreground/60 !bg-card";

/** Pulsing overlay for outputs that a running analysis is about to replace. */
function RefreshingOverlay({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-card/70">
      <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
        <Loader2 className="h-3 w-3 animate-spin" /> {label}
      </span>
    </div>
  );
}

/** Card colours derived from a hue: a tinted header, a saturated border and an edge stroke. */
function tint(hue: number) {
  return {
    border: `hsl(${hue} 45% 62%)`,
    header: `hsl(${hue} 55% 95%)`,
    strong: `hsl(${hue} 50% 38%)`,
    stroke: `hsl(${hue} 45% 55%)`,
  };
}

/** Resize handles for one card; shown while the card is selected. */
function Resizer({ kind, selected }: { kind: CanvasNodeKind; selected: boolean }) {
  const min = CANVAS_MIN_SIZES[kind];
  return <NodeResizer isVisible={selected} minWidth={min.width} minHeight={min.height} lineClassName={resizerLine} handleClassName={resizerHandle} />;
}

function SourceNode({ data }: NodeProps<SourceNodeType>) {
  return (
    <div className="h-full w-full rounded-lg border border-dashed bg-card px-3 py-2 text-xs shadow-sm">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{data.sourceType.replace("-", " ")}</div>
      <div className="truncate font-medium" title={data.label}>{data.label}</div>
      <Handle type="source" position={Position.Right} className={handleClass} />
    </div>
  );
}

function OverflowChip({ children }: { children: React.ReactNode }) {
  return <span className="whitespace-nowrap rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{children}</span>;
}

/**
 * A dataset card: a real fragment of the table plus chips that say how much
 * is hidden on each axis. Columns worth seeing (the preview picks and every
 * column an analysis reads) stay open; runs of other columns fold into "+N"
 * pills that open on click. Resizing the card shows more columns across and
 * more rows down; rows beyond the preview are fetched as needed.
 */
function DatasetNode({ id, data, selected, width, height }: NodeProps<DatasetNodeType>) {
  const size = { width: width ?? CANVAS_SIZES.dataset.width, height: height ?? CANVAS_SIZES.dataset.height };
  const expanded = size.width >= CANVAS_EXPANDED_DATASET.width - 1 && size.height >= CANVAS_EXPANDED_DATASET.height - 1;
  const headerHeight = data.origin ? 92 : 70;
  const footerHeight = 36;
  const tableHeader = 36;
  const maxRows = Math.max(1, Math.floor((size.height - headerHeight - footerHeight - tableHeader) / ROW_HEIGHT));
  const wanted = maxRows > data.previewRows.length ? Math.min(MAX_FETCHED_ROWS, Math.ceil(maxRows / 10) * 10) : 0;
  const { data: more } = useSWR<{ rows: ExploreRowRecord[] }>(wanted > 0 ? `/api/explore/datasets/${data.datasetId}/rows?limit=${wanted}` : null, fetcher, { keepPreviousData: true });
  const [openFolds, setOpenFolds] = useState<Set<number>>(() => new Set());

  const usedColumns = data.usedColumns ?? {};
  const keep = new Set([...data.previewColumns.map((column) => column.key), ...Object.keys(usedColumns)]);
  const tableColumns = data.columns.filter((column) => !column.key.endsWith("_db_id"));
  const { shown, hiddenColumns } = fitSegments(foldColumns(tableColumns, keep, openFolds), size.width - 20);
  const allRows = more?.rows.map((row) => row.data) ?? data.previewRows;
  const rows = allRows.slice(0, maxRows);
  const hiddenRows = Math.max(data.rowCount - rows.length, 0);
  const roleOf = (key: string) => (Object.entries(data.roles) as Array<[ExploreRole, string]>).find(([, column]) => column === key)?.[0];
  const colours = tint(data.hue);
  const compute = tint(COMPUTE_HUE);
  const computeSoft = `hsl(${COMPUTE_HUE} 55% 95% / 0.5)`;
  const toggleFold = (fold: number) =>
    setOpenFolds((current) => {
      const next = new Set(current);
      if (next.has(fold)) next.delete(fold);
      else next.add(fold);
      return next;
    });

  return (
    <div className={cn("relative flex h-full w-full flex-col rounded-lg border bg-card shadow-sm", data.refreshing && "animate-pulse")} style={{ borderColor: colours.border }}>
      <Resizer kind="dataset" selected={Boolean(selected)} />
      {data.refreshing && <RefreshingOverlay label="updating" />}
      <Handle type="target" position={Position.Left} className={handleClass} />
      <div className="flex items-start gap-2 border-b px-3 py-2" style={{ background: colours.header }}>
        <Database className="mt-0.5 h-4 w-4 shrink-0" style={{ color: colours.strong }} />
        <div className="min-w-0 flex-1">
          <Link href={`/explore/datasets/${data.datasetId}${data.scopeQuery}`} className="block truncate text-sm font-medium hover:underline" title={data.name}>
            {data.name}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            <span className="tabular-nums">{data.rowCount.toLocaleString()} rows × {data.columnCount} columns</span>
            {data.version !== null && <span>v{data.version}</span>}
            {data.origin && <span className="basis-full truncate" title={data.origin}>{data.origin}</span>}
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{DATASET_KIND_DEFINITIONS[data.datasetKind as keyof typeof DATASET_KIND_DEFINITIONS]?.label ?? data.datasetKind}</Badge>
            {data.sensitivity !== "standard" && <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{data.sensitivity}</Badge>}
            {data.latestWrite && (
              <span
                className={cn("rounded-full border px-1.5 py-0 text-[10px]", data.latestWrite.changed ? "border-transparent bg-secondary text-foreground" : "border-dashed")}
                title={
                  data.latestWrite.changed
                    ? `The latest run, ${data.latestWrite.runNumber}, wrote this version`
                    : `The latest run, ${data.latestWrite.runNumber}, produced the same table, so no new version was written`
                }
              >
                {data.latestWrite.changed ? `updated by ${data.latestWrite.runNumber}` : `unchanged in ${data.latestWrite.runNumber}`}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => data.onPreset(id, expanded ? CANVAS_SIZES.dataset : CANVAS_EXPANDED_DATASET)}
          className="nodrag rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={expanded ? "Collapse dataset" : "Expand dataset"}
          title={expanded ? "Back to the small card" : "Grow the card; drag a corner for any other size"}
        >
          {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="nodrag nowheel min-h-0 flex-1 overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-muted/50 text-left">
            <tr>
              {shown.map((segment) => {
                if (segment.kind === "fold") {
                  const names = segment.columns.map((column) => column.label).join(", ");
                  return (
                    <th key={`fold-${segment.fold}`} className="px-0.5 py-1 align-middle" style={{ width: CANVAS_FOLD_WIDTH }}>
                      <button
                        type="button"
                        onClick={() => toggleFold(segment.fold)}
                        className="nodrag mx-auto flex h-5 items-center justify-center rounded border border-dashed bg-muted/60 px-1 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        title={`Show ${segment.columns.length} folded columns: ${names}`}
                        aria-label={`Show ${segment.columns.length} folded columns`}
                      >
                        +{segment.columns.length}
                      </button>
                    </th>
                  );
                }
                const { column } = segment;
                const role = roleOf(column.key);
                const usedBy = usedColumns[column.key];
                const foldIndex = segment.fold;
                return (
                  <th
                    key={column.key}
                    className={cn("whitespace-nowrap px-2 py-1 font-medium", foldIndex !== null && "bg-muted/30")}
                    style={{ maxWidth: COLUMN_WIDTH + 20, background: usedBy ? compute.header : undefined }}
                    title={usedBy ? `${column.key}: read by ${usedBy.join(", ")}` : column.key}
                  >
                    <span className="flex items-center gap-1">
                      {foldIndex !== null && segment.firstOfFold && (
                        <button type="button" onClick={() => toggleFold(foldIndex)} className="nodrag shrink-0 rounded text-muted-foreground hover:text-foreground" title="Fold these columns away" aria-label="Fold these columns away">
                          <FoldHorizontal className="h-3 w-3" />
                        </button>
                      )}
                      {usedBy && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: compute.strong }} aria-hidden />}
                      <span className="truncate">{column.label}</span>
                    </span>
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
                {shown.map((segment) =>
                  segment.kind === "fold" ? (
                    <td key={`fold-${segment.fold}`} className="border-x border-dashed bg-muted/30 px-0 py-1" style={{ width: CANVAS_FOLD_WIDTH }} />
                  ) : (
                    <td
                      key={segment.column.key}
                      className={cn("truncate whitespace-nowrap px-2 py-1", segment.column.type === "number" && "text-right tabular-nums")}
                      style={{ maxWidth: COLUMN_WIDTH + 20, background: usedColumns[segment.column.key] ? computeSoft : undefined }}
                      title={formatCell(row[segment.column.key])}
                    >
                      {formatCell(row[segment.column.key])}
                    </td>
                  )
                )}
                {hiddenColumns > 0 && <td className="px-2 py-1 text-muted-foreground">…</td>}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="px-2 py-3 text-muted-foreground" colSpan={shown.length + 1}>{wanted > 0 && !more ? "Loading rows" : "No rows"}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap border-t px-3 py-1.5">
        {hiddenRows > 0 ? <OverflowChip>+{hiddenRows.toLocaleString()} rows</OverflowChip> : <span className="text-[10px] text-muted-foreground">all rows</span>}
        {hiddenColumns > 0 ? <OverflowChip>+{hiddenColumns} columns</OverflowChip> : <span className="text-[10px] text-muted-foreground">all columns</span>}
        <span className="flex-1" />
        {data.views.includes("subject-timeline") && (
          <Link href={`/explore/datasets/${data.datasetId}/subject-timeline${data.scopeQuery}`} className="nodrag rounded p-1 text-muted-foreground hover:text-foreground" title="Subject timeline">
            <Activity className="h-3.5 w-3.5" />
          </Link>
        )}
        {data.views.includes("heatmap") && (
          <Link href={`/explore/datasets/${data.datasetId}/heatmap${data.scopeQuery}`} className="nodrag rounded p-1 text-muted-foreground hover:text-foreground" title="Heatmap">
            <Grid3x3 className="h-3.5 w-3.5" />
          </Link>
        )}
        <Link href={`/explore/datasets/${data.datasetId}${data.scopeQuery}`} className="nodrag inline-flex items-center gap-1 text-[11px] font-medium hover:underline">
          Open table <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <Handle type="source" position={Position.Right} className={handleClass} />
    </div>
  );
}

/** The compute card: kit, revision, run control and as many code lines as fit. */
function AnalysisNode({ data, selected, height }: NodeProps<AnalysisNodeType>) {
  const status = data.latestRun?.status;
  const colours = tint(data.hue);
  const [starting, setStarting] = useState(false);
  const visibleLines = Math.max(2, Math.floor(((height ?? CANVAS_SIZES.analysis.height) - 104) / CODE_LINE_HEIGHT));
  const lines = data.codePreview ? data.codePreview.split("\n") : [];
  const shown = lines.slice(0, visibleLines);
  const run = async () => {
    setStarting(true);
    try {
      await data.onRun(data.analysisId);
    } finally {
      setStarting(false);
    }
  };
  return (
    <div className="flex h-full w-full flex-col rounded-lg border bg-card shadow-sm" style={{ borderColor: colours.border }}>
      <Resizer kind="analysis" selected={Boolean(selected)} />
      <Handle type="target" position={Position.Left} className={handleClass} />
      <div className="flex items-start gap-2 px-3 py-2" style={{ background: colours.header }}>
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" style={{ color: colours.strong }} />
        <div className="min-w-0 flex-1">
          <Link href={`/explore/analyses/${data.analysisId}${data.scopeQuery}`} className="block truncate text-sm font-medium hover:underline" title={data.name}>{data.name}</Link>
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
        className="nodrag nowheel block min-h-0 w-full flex-1 overflow-hidden border-t bg-muted/40 px-3 py-2 text-left"
        title="Show the full code"
      >
        <pre className="whitespace-pre font-mono text-[10px] leading-[14px] text-muted-foreground">
          {shown.length ? shown.join("\n") : "(no code yet)"}
          {lines.length > shown.length ? `\n… ${data.codeLines - shown.length} more lines` : ""}
        </pre>
      </button>
      <div className="flex items-center gap-2 border-t px-3 py-1.5 text-[11px]">
        <button
          type="button"
          onClick={() => void run()}
          disabled={data.active || starting}
          className="nodrag inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-white disabled:opacity-60"
          style={{ background: colours.strong }}
          title={data.active ? "A run is in progress" : "Run the current revision"}
        >
          {data.active || starting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          {data.active ? "Running" : starting ? "Starting" : "Run"}
        </button>
        {data.latestRun ? (
          <>
            <Badge variant={status === "completed" ? "secondary" : "outline"} className="px-1.5 py-0 text-[10px]">{status}</Badge>
            <Link href={`/explore/runs/${data.latestRun.id}`} className="nodrag truncate text-muted-foreground hover:underline">{data.latestRun.runNumber}</Link>
          </>
        ) : (
          <span className="text-muted-foreground">not run yet</span>
        )}
        <span className="flex-1" />
        <Link href={`/explore/analyses/${data.analysisId}${data.scopeQuery}`} className="nodrag inline-flex items-center gap-1 font-medium hover:underline">Open <ExternalLink className="h-3 w-3" /></Link>
      </div>
      <Handle type="source" position={Position.Right} className={handleClass} />
    </div>
  );
}

/** A live miniature of a Plotly figure, rendered static so the card stays draggable. */
function PlotlyThumbnail({ url, height }: { url: string; height: number }) {
  const { data, error } = useSWR<{ data?: unknown[]; layout?: Record<string, unknown> }>(url, fetcher);
  if (error) return <ImageIcon className="h-8 w-8 text-muted-foreground/60" />;
  if (!data) return <Skeleton className="h-full w-full" />;
  return (
    <PlotlyChart
      data={Array.isArray(data.data) ? data.data : []}
      layout={{ ...(data.layout ?? {}), title: undefined, margin: { l: 28, r: 8, t: 8, b: 24 }, showlegend: false, font: { size: 8 } }}
      height={height}
      staticPlot
      className="w-full"
    />
  );
}

function FigureNode({ data, selected, height }: NodeProps<FigureNodeType>) {
  const image = data.thumbnailUrl ?? (data.format === "png" || data.format === "svg" ? data.url : null);
  const colours = tint(data.hue);
  const area = Math.max(80, (height ?? CANVAS_SIZES.figure.height) - 34);
  return (
    <div className={cn("relative flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card shadow-sm", data.refreshing && "animate-pulse")} style={{ borderColor: colours.border }}>
      <Resizer kind="figure" selected={Boolean(selected)} />
      {data.refreshing && <RefreshingOverlay label="updating" />}
      <Handle type="target" position={Position.Left} className={handleClass} />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/30">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={data.name} className="max-h-full max-w-full object-contain" />
        ) : data.format === "plotly-json" ? (
          <PlotlyThumbnail url={data.url} height={area} />
        ) : (
          <ImageIcon className="h-8 w-8 text-muted-foreground/60" />
        )}
      </div>
      <div className="flex items-center gap-2 border-t px-3 py-1.5 text-[11px]">
        <span className="min-w-0 truncate font-medium" title={data.name}>{data.name}</span>
        <span className="shrink-0 text-muted-foreground">{data.format === "plotly-json" ? "interactive" : data.format}</span>
        <span className="flex-1" />
        {data.unchanged && <OverflowChip>unchanged</OverflowChip>}
        <Link
          href={`/explore/runs/${data.runId}${data.scopeQuery}`}
          className="nodrag inline-flex shrink-0 items-center gap-1 hover:underline"
          title={data.unchanged ? "The latest run produced the same figure as the run before it" : "Open the run that wrote this figure"}
        >
          {data.runNumber ?? "Run"} <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

/** Where the outputs of a run will appear once it finishes. */
function PendingNode({ data, selected }: NodeProps<PendingNodeType>) {
  const colours = tint(data.hue);
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-dashed bg-card shadow-sm" style={{ borderColor: colours.border }}>
      <Resizer kind="pending" selected={Boolean(selected)} />
      <Handle type="target" position={Position.Left} className={handleClass} />
      <div className="min-h-0 flex-1 space-y-2 p-3">
        <Skeleton className="h-[60%] w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
      <div className="flex items-center gap-2 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="truncate">{data.status === "queued" ? "Queued" : "Computing"} outputs of {data.runNumber}</span>
        <span className="flex-1" />
        <Link href={`/explore/runs/${data.runId}${data.scopeQuery}`} className="nodrag inline-flex items-center gap-1 hover:underline">Run <ExternalLink className="h-3 w-3" /></Link>
      </div>
    </div>
  );
}

const nodeTypes = { source: SourceNode, dataset: DatasetNode, analysis: AnalysisNode, figure: FigureNode, pending: PendingNode };

type StoredLayout = Record<string, { x: number; y: number; width?: number; height?: number }>;

function storageKey(scope: string): string {
  return `seqdesk:explore:canvas:${scope}`;
}

function readLayout(scope: string): StoredLayout {
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    return raw ? (JSON.parse(raw) as StoredLayout) : {};
  } catch {
    return {};
  }
}

function writeLayout(scope: string, layout: StoredLayout): void {
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(layout));
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
 * resizable card, connected by their lineage. Positions and sizes are kept per
 * scope in the browser; "Arrange" recomputes the layered layout.
 */
export function ExploreCanvas({ scope, className, fillViewport = false }: ExploreCanvasProps) {
  const { data: graph, error, isLoading, mutate } = useSWR<CanvasGraph>(`/api/explore/canvas?targetKey=${encodeURIComponent(scope)}`, fetcher, {
    // Poll quickly while something is computing so skeletons turn into outputs on their own.
    refreshInterval: (latest) => (latest?.nodes.some((node) => node.data.kind === "analysis" && node.data.active) ? 3000 : 15000),
  });
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

  const runAnalysis = useCallback(
    async (analysisId: string) => {
      try {
        const result = await postJson<{ run: { runNumber: string } }>(`/api/explore/analyses/${analysisId}/runs`, {});
        toast.success(`Run ${result.run.runNumber} started`);
        await mutate();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not start the run");
      }
    },
    [mutate]
  );

  /** Size presets from the card's own button (expand, collapse). */
  const applyPreset = useCallback(
    (id: string, size: { width: number; height: number }) => {
      setNodes((current) => current.map((node) => (node.id === id ? ({ ...node, width: size.width, height: size.height } as CanvasFlowNode) : node)));
    },
    [setNodes]
  );

  const flowNodes = useMemo<CanvasFlowNode[]>(() => {
    if (!graph) return [];
    const stored = arrangeVersion === 0 ? readLayout(scope) : {};
    const sizes: Record<string, { width: number; height: number }> = {};
    for (const [id, entry] of Object.entries(stored)) if (entry.width && entry.height) sizes[id] = { width: entry.width, height: entry.height };
    const auto = layoutCanvas(graph, { sizes });
    const hues = assignCanvasHues(graph);
    // Nodes the user placed keep their spot; new nodes take the computed slot
    // and move down until they no longer overlap a placed node.
    const occupied = graph.nodes.filter((node) => stored[node.id]).map((node) => ({ ...stored[node.id], ...nodeSize(node, { sizes }) }));
    const settle = (node: CanvasGraph["nodes"][number]) => {
      if (stored[node.id]) return { x: stored[node.id].x, y: stored[node.id].y };
      const size = nodeSize(node, { sizes });
      const position = { ...(auto[node.id] ?? { x: 0, y: 0 }) };
      for (let guard = 0; guard < 50; guard += 1) {
        const hit = occupied.find(
          (box) => position.x < box.x + box.width + 24 && position.x + size.width + 24 > box.x && position.y < box.y + box.height + 24 && position.y + size.height + 24 > box.y
        );
        if (!hit) break;
        position.y = hit.y + hit.height + 28;
      }
      occupied.push({ ...position, ...size });
      return position;
    };
    // Links from cards keep the scope so the sidebar stays with the study or order.
    const scopeQuery = `?scope=${encodeURIComponent(scope)}`;
    return graph.nodes.map((node) => {
      const position = settle(node);
      const size = nodeSize(node, { sizes });
      const hue = hues[node.id] ?? COMPUTE_HUE;
      const base = { id: node.id, position, width: size.width, height: size.height };
      if (node.data.kind === "dataset") return { ...base, type: "dataset", data: { ...node.data, hue, scopeQuery, onPreset: applyPreset } } as DatasetNodeType;
      if (node.data.kind === "analysis") return { ...base, type: "analysis", data: { ...node.data, hue, scopeQuery, onOpenCode: openCode, onRun: runAnalysis } } as AnalysisNodeType;
      if (node.data.kind === "figure") return { ...base, type: "figure", data: { ...node.data, hue, scopeQuery } } as FigureNodeType;
      if (node.data.kind === "pending") return { ...base, type: "pending", data: { ...node.data, hue, scopeQuery } } as PendingNodeType;
      return { ...base, type: "source", data: node.data } as SourceNodeType;
    });
  }, [graph, applyPreset, openCode, runAnalysis, scope, arrangeVersion]);

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
    // Keep positions and sizes of nodes the user already touched; new nodes take the computed slot.
    setNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node] as const));
      return flowNodes.map((node) => {
        const existing = arrangeVersion === 0 ? currentById.get(node.id) : undefined;
        return existing ? ({ ...node, position: existing.position, width: existing.width ?? node.width, height: existing.height ?? node.height } as CanvasFlowNode) : node;
      });
    });
    setEdges(flowEdges);
  }, [flowNodes, flowEdges, setNodes, setEdges, arrangeVersion]);

  // Remember positions and sizes shortly after any change (drag, resize, preset).
  useEffect(() => {
    if (nodes.length === 0) return;
    const timer = setTimeout(() => {
      const layout: StoredLayout = {};
      for (const node of nodes) {
        layout[node.id] = { x: node.position.x, y: node.position.y, width: node.width ?? node.measured?.width, height: node.height ?? node.measured?.height };
      }
      writeLayout(scope, layout);
    }, 400);
    return () => clearTimeout(timer);
  }, [nodes, scope]);

  // Clicking an arrow opens the code of the analysis it goes into or comes from.
  const onEdgeClick: EdgeMouseHandler = useCallback((_event, edge) => {
    const analysisId = [edge.source, edge.target].find((id) => id.startsWith("analysis:"))?.slice("analysis:".length);
    if (analysisId) setOpenAnalysisId(analysisId);
  }, []);

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
        <Button size="sm" variant="outline" onClick={arrange} title="Recompute the layout and reset card sizes">
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
      {openAnalysisId && <CodePanel analysisId={openAnalysisId} scopeQuery={`?scope=${encodeURIComponent(scope)}`} onClose={() => setOpenAnalysisId(null)} />}
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
          <p className="mt-1 text-muted-foreground">Select a card and drag its corners to resize it; tables then show more rows and columns.</p>
          <p className="mt-1 text-muted-foreground">Column headers tinted like compute, with a dot, are the columns an analysis reads. A +N pill folds the columns in between; click it to open them.</p>
        </div>
      )}
    </div>
  );
}

/** Side panel with the current code of one analysis, opened from a card or an arrow. */
function CodePanel({ analysisId, scopeQuery, onClose }: { analysisId: string; scopeQuery: string; onClose: () => void }) {
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
          <Link href={`/explore/analyses/${analysisId}${scopeQuery}`}>Open analysis</Link>
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
