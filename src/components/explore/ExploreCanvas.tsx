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
  type OnConnectEnd,
  type OnConnectStart,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Activity,
  AlertTriangle,
  BookmarkCheck,
  BookmarkPlus,
  Code2,
  Database,
  ExternalLink,
  FlaskConical,
  FoldHorizontal,
  Grid3x3,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  Loader2,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Play,
  Plus,
  Save,
  Settings2,
  Sparkle,
  Tags,
  Wand2,
  X,
} from "lucide-react";
import { AddDataMenu } from "@/components/explore/AddDataMenu";
import { HeatmapView } from "@/components/explore/views/HeatmapView";
import { SubjectTimelineOverview } from "@/components/explore/views/SubjectTimelineOverview";
import { CodeEditor } from "@/components/explore/CodeEditor";
import { PlotlyChart } from "@/components/explore/PlotlyChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
  type CanvasParamsSchema,
  type CanvasPendingData,
  type CanvasSourceData,
  type CanvasViewData,
  type BuiltInView,
} from "@/lib/explore/canvas-layout";
import { DATASET_KIND_DEFINITIONS, TABLE_KIND_DEFINITIONS, datasetFitsInput } from "@/lib/explore/dataset-kinds";
import { figureBlockId, tableBlockId, viewBlockId, type ReportBlock } from "@/lib/explore/report-blocks";
import type { ReportView } from "@/lib/explore/reports";
import { useStoredPreference } from "@/lib/explore/use-stored-preference";
import type { ExploreRole, ExploreRowRecord } from "@/lib/explore/types";

/** A kit as the kits API lists it; enough to tell whether a table fits its first input. */
export interface KitSummary {
  id: string;
  name: string;
  description: string;
  language: "python" | "r";
  inputs: Array<{ alias: string; label: string; tableKind?: string | null; requiredRoles: ExploreRole[]; optionalRoles: ExploreRole[]; optional?: boolean }>;
  params?: CanvasParamsSchema;
}

/** What the report can be asked to include or drop from a card. */
export type ReportTarget =
  | { type: "figure"; analysisId: string; figureName: string; label: string }
  | { type: "table"; datasetId: string; label: string }
  | { type: "view"; datasetId: string; view: BuiltInView; label: string };

/** Delete a table or an analysis from the "..." menu of its card. */
type Deletable = { onDelete: (kind: "dataset" | "analysis", id: string, name: string) => Promise<void> };

/** True when an arrow ends on this card, so its target dot can hide behind the arrowhead. */
type Wired = { hasInput?: boolean };

type CardActions = Wired &
  Deletable & {
  scopeQuery: string;
  onPreset: (id: string, size: { width: number; height: number }) => void;
  /** Start an analysis reading this table; `placeAt` puts the new card there (flow coordinates). */
  onAnalyse: (datasetId: string, kitId: string | null, placeAt?: { x: number; y: number }) => Promise<void>;
  /** Inputs of existing analyses this table could be connected to. */
  connectTargets: ConnectTarget[];
  onConnect: (datasetId: string, target: ConnectTarget) => Promise<void>;
  onToggleReport: (target: ReportTarget) => Promise<void>;
  kits: KitSummary[];
  /** Set for a few seconds after a run rewrote this card. */
  justUpdated?: boolean;
};
type DatasetNodeType = Node<CanvasDatasetData & CardActions & { hue: number }, "dataset">;
type AnalysisNodeType = Node<
  CanvasAnalysisData &
    Wired &
    Deletable & { hue: number; scopeQuery: string; onOpenCode: (analysisId: string) => void; onRun: (analysisId: string) => Promise<void>; onSaveParams: (analysisId: string, params: Record<string, unknown>) => Promise<void> },
  "analysis"
>;
type ViewNodeType = Node<CanvasViewData & Wired & { hue: number; scopeQuery: string; onToggleReport: (target: ReportTarget) => Promise<void> }, "view">;
type SourceNodeType = Node<CanvasSourceData, "source">;
type FigureNodeType = Node<CanvasFigureData & Wired & { hue: number; scopeQuery: string; justUpdated?: boolean; onToggleReport: (target: ReportTarget) => Promise<void> }, "figure">;
type PendingNodeType = Node<CanvasPendingData & Wired & { hue: number; scopeQuery: string }, "pending">;
type CanvasFlowNode = DatasetNodeType | AnalysisNodeType | SourceNodeType | FigureNodeType | PendingNodeType | ViewNodeType;

const MAX_FETCHED_ROWS = 200;
const COLUMN_WIDTH = CANVAS_COLUMN_WIDTH;
const ROW_HEIGHT = 22;
const CODE_LINE_HEIGHT = 14;

const handleClass = "!h-2 !w-2 !border-0 !bg-muted-foreground/70";
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
    chip: `hsl(${hue} 50% 88%)`,
    strong: `hsl(${hue} 50% 38%)`,
    stroke: `hsl(${hue} 45% 55%)`,
  };
}
type Tint = ReturnType<typeof tint>;

/** Resize handles for one card; shown while the card is selected. */
function Resizer({ kind }: { kind: CanvasNodeKind }) {
  const min = CANVAS_MIN_SIZES[kind];
  // Always rendered; globals.css shows the handles while the card is hovered or selected.
  return <NodeResizer isVisible minWidth={min.width} minHeight={min.height} lineClassName={resizerLine} handleClassName={resizerHandle} />;
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

/** A small label in the card's own colour: filled for facts, dashed for "nothing new". */
function CardChip({ children, colours, variant = "filled", title }: { children: React.ReactNode; colours?: Tint; variant?: "filled" | "outline" | "dashed"; title?: string }) {
  const style = colours
    ? variant === "filled"
      ? { background: colours.chip, color: colours.strong }
      : { borderColor: colours.border, color: colours.strong }
    : undefined;
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        variant === "filled" && !colours && "bg-muted text-muted-foreground",
        variant === "outline" && "border",
        variant === "dashed" && "border border-dashed",
        variant !== "filled" && !colours && "text-muted-foreground"
      )}
      style={style}
      title={title}
    >
      {children}
    </span>
  );
}

function OverflowChip({ children, colours }: { children: React.ReactNode; colours?: Tint }) {
  return <CardChip colours={colours}>{children}</CardChip>;
}

/** The "..." menu every card carries: open, report and delete actions. */
function CardMenu({ items }: { items: Array<{ label: string; href?: string; onSelect?: () => void; destructive?: boolean; external?: boolean }> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="nodrag rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="More actions" title="More actions">
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {items.map((item) =>
          item.href ? (
            <DropdownMenuItem key={item.label} asChild>
              {item.external ? (
                <a href={item.href} target="_blank" rel="noreferrer">{item.label}</a>
              ) : (
                <Link href={item.href}>{item.label}</Link>
              )}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={item.label} onSelect={item.onSelect} className={item.destructive ? "text-destructive focus:text-destructive" : undefined}>
              {item.label}
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A dataset card: a real fragment of the table plus chips that say how much
 * is hidden on each axis. Columns worth seeing (the preview picks and every
 * column an analysis reads) stay open; runs of other columns fold into "+N"
 * pills that open on click. Resizing the card shows more columns across and
 * more rows down; rows beyond the preview are fetched as needed.
 */
function DatasetNode({ id, data, width, height, positionAbsoluteX, positionAbsoluteY }: NodeProps<DatasetNodeType>) {
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
  const compact = size.width < 380;
  const toggleFold = (fold: number) =>
    setOpenFolds((current) => {
      const next = new Set(current);
      if (next.has(fold)) next.delete(fold);
      else next.add(fold);
      return next;
    });

  return (
    <div className={cn("relative flex h-full w-full flex-col rounded-lg border bg-card shadow-sm", data.refreshing && "animate-pulse", data.justUpdated && "ring-2 ring-emerald-400")} style={{ borderColor: colours.border }}>
      <Resizer kind="dataset" />
      {data.refreshing && <RefreshingOverlay label="updating" />}
      <Handle type="target" position={Position.Left} className={cn(handleClass, data.hasInput && "!opacity-0")} />
      <div className="flex items-start gap-2 rounded-t-[7px] border-b px-3 py-2" style={{ background: colours.header }}>
        <Database className="mt-0.5 h-4 w-4 shrink-0" style={{ color: colours.strong }} />
        <div className="min-w-0 flex-1">
          <Link href={`/explore/datasets/${data.datasetId}${data.scopeQuery}`} className="block truncate text-sm font-medium hover:underline" title={data.name}>
            {data.name}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            <span className="tabular-nums">{data.rowCount.toLocaleString()} rows × {data.columnCount} columns</span>
            {data.version !== null && <span>v{data.version}</span>}
            {data.origin && <span className="basis-full truncate" title={data.origin}>{data.origin}</span>}
            <CardChip colours={colours}>{DATASET_KIND_DEFINITIONS[data.datasetKind as keyof typeof DATASET_KIND_DEFINITIONS]?.label ?? data.datasetKind}</CardChip>
            {data.sensitivity !== "standard" && <CardChip colours={colours} variant="outline">{data.sensitivity}</CardChip>}
            {data.latestWrite && (
              <CardChip
                colours={colours}
                variant={data.latestWrite.changed ? "filled" : "dashed"}
                title={
                  data.latestWrite.changed
                    ? `The latest run, ${data.latestWrite.runNumber}, wrote this version`
                    : `The latest run, ${data.latestWrite.runNumber}, produced the same table, so no new version was written`
                }
              >
                {data.latestWrite.changed ? `updated by ${data.latestWrite.runNumber}` : `unchanged in ${data.latestWrite.runNumber}`}
              </CardChip>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => data.onPreset(id, expanded ? CANVAS_SIZES.dataset : CANVAS_EXPANDED_DATASET)}
          className="nodrag rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={expanded ? "Collapse table" : "Expand table"}
          title={expanded ? "Back to the small card" : "Grow the card; drag a corner for any other size"}
        >
          {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
        <CardMenu
          items={[
            { label: "Open table", href: `/explore/datasets/${data.datasetId}${data.scopeQuery}` },
            { label: "Columns and roles", href: `/explore/datasets/${data.datasetId}${data.scopeQuery}&tab=columns` },
            { label: "Edits", href: `/explore/datasets/${data.datasetId}${data.scopeQuery}&tab=edits` },
            ...(data.datasetKind === "derived"
              ? [{ label: data.inReport ? "Take off the report" : "Add to the report", onSelect: () => void data.onToggleReport({ type: "table", datasetId: data.datasetId, label: data.name }) }]
              : []),
            { label: "Delete table", destructive: true, onSelect: () => void data.onDelete("dataset", data.datasetId, data.name) },
          ]}
        />
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
      <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-b-[7px] border-t px-3 py-1.5" style={{ background: colours.header }}>
        {hiddenRows > 0 ? <OverflowChip colours={colours}>+{hiddenRows.toLocaleString()} rows</OverflowChip> : <span className="text-[10px]" style={{ color: colours.strong }}>all rows</span>}
        {hiddenColumns > 0 ? <OverflowChip colours={colours}>+{hiddenColumns} columns</OverflowChip> : <span className="text-[10px]" style={{ color: colours.strong }}>all columns</span>}
        <span className="flex-1" />
        <AnalyseMenu
          dataset={data}
          kits={data.kits}
          onPick={(kitId) => data.onAnalyse(data.datasetId, kitId, { x: positionAbsoluteX + size.width + 80, y: positionAbsoluteY })}
          compact={compact}
          connectTargets={data.connectTargets}
          onConnect={(target) => data.onConnect(data.datasetId, target)}
        />
        {data.datasetKind === "derived" && (
          <ReportToggle inReport={Boolean(data.inReport)} onToggle={() => data.onToggleReport({ type: "table", datasetId: data.datasetId, label: data.name })} compact={compact} colours={colours} />
        )}
        {data.views.length === 0 && data.roleHints && data.roleHints.length > 0 && (
          <Link
            href={`/explore/datasets/${data.datasetId}${data.scopeQuery}&tab=columns`}
            className="nodrag rounded p-1 text-muted-foreground hover:text-foreground"
            title={roleHintText(data.roleHints)}
            aria-label={roleHintText(data.roleHints)}
          >
            <Tags className="h-3.5 w-3.5" />
          </Link>
        )}
        <Link href={`/explore/datasets/${data.datasetId}${data.scopeQuery}`} className="nodrag inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-medium hover:underline" title="Open the table">
          {compact ? "Open" : "Open table"} <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className={cn(handleClass, "!flex !h-4 !w-4 !items-center !justify-center !bg-muted-foreground hover:!bg-foreground")}
        isConnectable
        title="Drag onto the canvas to start an analysis from this table"
      >
        <Plus className="pointer-events-none h-3 w-3 text-background" aria-hidden />
      </Handle>
    </div>
  );
}

function roleHintText(hints: NonNullable<CanvasDatasetData["roleHints"]>): string {
  const hint = hints[0];
  const view = hint.view === "subject-timeline" ? "the subject timeline" : "the heatmap";
  const roles = hint.missing.map((role) => ROLE_LABELS[role].toLowerCase());
  return `Map ${roles.length === 1 ? `a ${roles[0]} column` : `${roles.join(", ")} columns`} to enable ${view}`;
}

/** Start an analysis from this table: templates that fit it, or a blank script. */
function AnalyseMenu({
  dataset,
  kits,
  onPick,
  compact = false,
  connectTargets,
  onConnect,
}: {
  dataset: CanvasDatasetData;
  kits: KitSummary[];
  onPick: (kitId: string | null) => Promise<void>;
  compact?: boolean;
  connectTargets?: ConnectTarget[];
  onConnect?: (target: ConnectTarget) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const pick = async (kitId: string | null) => {
    setBusy(true);
    try {
      await onPick(kitId);
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="nodrag inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border bg-card px-1.5 py-0.5 text-[10px] font-medium hover:bg-muted" title="Start an analysis that reads this table" aria-label="Analyse" disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
          {!compact && "Analyse"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <AnalyseList dataset={dataset} kits={kits} onPick={(kitId) => void pick(kitId)} connectTargets={connectTargets} onConnect={onConnect ? (target) => void onConnect(target) : undefined} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** An input of an existing analysis that this table could be connected to. */
export interface ConnectTarget {
  analysisId: string;
  analysisName: string;
  alias: string;
  label: string;
}

/** The entries of the Analyse menu; also shown where a drag from a table ends. */
function AnalyseList({
  dataset,
  kits,
  onPick,
  connectTargets = [],
  onConnect,
}: {
  dataset: CanvasDatasetData;
  kits: KitSummary[];
  onPick: (kitId: string | null) => void;
  connectTargets?: ConnectTarget[];
  onConnect?: (target: ConnectTarget) => void;
}) {
  return (
    <>
      {connectTargets.length > 0 && onConnect && (
        <>
          <DropdownMenuLabel>Connect {dataset.name} to</DropdownMenuLabel>
          {connectTargets.map((target) => (
            <DropdownMenuItem key={`${target.analysisId}:${target.alias}`} onSelect={() => onConnect(target)}>
              <FlaskConical className="mr-2 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <div className="truncate font-medium">{target.analysisName}</div>
                <div className="truncate text-xs text-muted-foreground">as {target.label}</div>
              </div>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuLabel>{connectTargets.length > 0 ? "Or start a new analysis" : `Analyse ${dataset.name}`}</DropdownMenuLabel>
      {kits.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No templates installed.</div>}
      {kits.map((kit) => {
        const input = kit.inputs[0];
        const fit = input ? datasetFitsInput({ tableKind: dataset.tableKind, roles: dataset.roles }, input) : ({ ok: true } as const);
        const reason = fit.ok
          ? null
          : fit.reason === "table-kind"
            ? `needs a ${TABLE_KIND_DEFINITIONS[fit.tableKind]?.label ?? fit.tableKind} table`
            : `map ${fit.missing.map((role) => ROLE_LABELS[role].toLowerCase()).join(", ")} first`;
        return (
          <DropdownMenuItem key={kit.id} disabled={!fit.ok} onSelect={() => onPick(kit.id)} title={reason ?? kit.description}>
            <FlaskConical className="mr-2 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <div className="truncate font-medium">{kit.name}</div>
              <div className="truncate text-xs text-muted-foreground">{reason ?? kit.description}</div>
            </div>
          </DropdownMenuItem>
        );
      })}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onPick(null)}>
        <Code2 className="mr-2 h-4 w-4 shrink-0" />
        <div>
          <div className="font-medium">Blank Python script</div>
          <div className="text-xs text-muted-foreground">Starts with this table loaded; write the rest yourself</div>
        </div>
      </DropdownMenuItem>
    </>
  );
}

/** Put an output on the report page, or take it off. */
function ReportToggle({ inReport, onToggle, compact = false, colours }: { inReport: boolean; onToggle: () => Promise<void>; compact?: boolean; colours?: Tint }) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await onToggle();
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      className={cn("nodrag inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] font-medium hover:brightness-95", inReport ? "border-transparent bg-secondary" : "bg-card text-muted-foreground")}
      style={inReport && colours ? { background: colours.chip, color: colours.strong } : undefined}
      title={inReport ? "Shown on the report page; click to take it off" : "Not on the report page; click to add it"}
      aria-label={inReport ? "In report" : "Add to report"}
      aria-pressed={inReport}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : inReport ? <BookmarkCheck className="h-3 w-3" /> : <BookmarkPlus className="h-3 w-3" />}
      {!compact && (inReport ? "In report" : "Add to report")}
    </button>
  );
}

/** Kit parameters, edited on the card; Apply saves them as a new version of the analysis. */
function ParamsMini({ schema, values, onApply }: { schema: CanvasParamsSchema; values: Record<string, unknown>; onApply: (values: Record<string, unknown>) => Promise<void> }) {
  const [draft, setDraft] = useState<Record<string, unknown>>(values);
  const [busy, setBusy] = useState(false);
  const properties = Object.entries(schema.properties ?? {});
  const changed = properties.some(([key, property]) => String(draft[key] ?? property.default ?? "") !== String(values[key] ?? property.default ?? ""));
  const apply = async () => {
    setBusy(true);
    try {
      await onApply(draft);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="nodrag nowheel space-y-1 border-t bg-muted/20 px-3 py-1.5 text-[11px]">
      {properties.map(([key, property]) => {
        const type = Array.isArray(property.type) ? property.type.find((entry) => entry !== "null") : property.type;
        const value = draft[key] ?? property.default ?? "";
        const label = property.title ?? key;
        if (property.enum) {
          return (
            <label key={key} className="flex items-center gap-2" title={property.description}>
              <span className="w-1/2 truncate text-muted-foreground">{label}</span>
              <select value={String(value)} onChange={(event) => setDraft({ ...draft, [key]: typeof property.enum?.[0] === "number" ? Number(event.target.value) : event.target.value })} className="h-6 flex-1 rounded border bg-background px-1">
                {property.enum.map((option) => (
                  <option key={String(option)} value={String(option)}>{String(option)}</option>
                ))}
              </select>
            </label>
          );
        }
        if (type === "boolean") {
          return (
            <label key={key} className="flex items-center gap-2" title={property.description}>
              <span className="w-1/2 truncate text-muted-foreground">{label}</span>
              <input type="checkbox" checked={Boolean(value)} onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })} />
            </label>
          );
        }
        const numeric = type === "integer" || type === "number";
        return (
          <label key={key} className="flex items-center gap-2" title={property.description}>
            <span className="w-1/2 truncate text-muted-foreground">{label}</span>
            <Input
              type={numeric ? "number" : "text"}
              value={String(value)}
              min={property.minimum}
              max={property.maximum}
              step={type === "integer" ? 1 : undefined}
              onChange={(event) => setDraft({ ...draft, [key]: numeric ? (event.target.value === "" ? "" : Number(event.target.value)) : event.target.value })}
              className="h-6 flex-1 px-1.5 text-[11px]"
            />
          </label>
        );
      })}
      <div className="flex justify-end">
        <button type="button" onClick={() => void apply()} disabled={!changed || busy} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium hover:bg-muted disabled:opacity-50">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Apply as new version
        </button>
      </div>
    </div>
  );
}



/** The compute card: kit, revision, run control and as many code lines as fit. */
function AnalysisNode({ data, height }: NodeProps<AnalysisNodeType>) {
  const status = data.latestRun?.status;
  const colours = tint(data.hue);
  const [starting, setStarting] = useState(false);
  const [showParams, setShowParams] = useState(false);
  const hasParams = Boolean(data.paramsSchema?.properties && Object.keys(data.paramsSchema.properties).length > 0);
  const failed = status === "failed" && Boolean(data.latestRun?.errorTail);
  const errorLines = failed ? (data.latestRun?.errorTail ?? "").trim().split("\n").filter(Boolean).slice(-3) : [];
  const reserved = 104 + (failed ? 16 * errorLines.length + 24 : 0) + (showParams && hasParams ? 30 * Object.keys(data.paramsSchema?.properties ?? {}).length + 34 : 0);
  const visibleLines = Math.max(1, Math.floor(((height ?? CANVAS_SIZES.analysis.height) - reserved) / CODE_LINE_HEIGHT));
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
      <Resizer kind="analysis" />
      <Handle type="target" position={Position.Left} className={cn(handleClass, data.hasInput && "!opacity-0")} />
      <div className="flex items-start gap-2 rounded-t-[7px] px-3 py-2" style={{ background: colours.header }}>
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" style={{ color: colours.strong }} />
        <div className="min-w-0 flex-1">
          <Link href={`/explore/analyses/${data.analysisId}${data.scopeQuery}`} className="block truncate text-sm font-medium hover:underline" title={data.name}>{data.name}</Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            <span className="capitalize">{data.language}</span>
            {data.kitId && <span>template {data.kitId}</span>}
            {data.revision !== null && <span>version {data.revision}</span>}
            {data.codeLines > 0 && <span>{data.codeLines} lines</span>}
          </div>
        </div>
        {hasParams && (
          <button
            type="button"
            onClick={() => setShowParams((value) => !value)}
            className={cn("nodrag inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] hover:bg-muted hover:text-foreground", showParams ? "bg-secondary text-foreground" : "bg-card text-muted-foreground")}
            title="Parameters of this analysis"
            aria-pressed={showParams}
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => data.onOpenCode(data.analysisId)}
          className="nodrag inline-flex items-center gap-1 rounded-full border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Show and edit the code that turns the inputs into the outputs"
        >
          <Code2 className="h-3.5 w-3.5" /> Code
        </button>
        <CardMenu
          items={[
            { label: "Open analysis", href: `/explore/analyses/${data.analysisId}${data.scopeQuery}` },
            { label: "Show code", onSelect: () => data.onOpenCode(data.analysisId) },
            ...(data.active ? [] : [{ label: "Run", onSelect: () => void data.onRun(data.analysisId) }]),
            ...(data.latestRun ? [{ label: "Open latest run", href: `/explore/runs/${data.latestRun.id}${data.scopeQuery}` }] : []),
            { label: "Delete analysis", destructive: true, onSelect: () => void data.onDelete("analysis", data.analysisId, data.name) },
          ]}
        />
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
      {showParams && hasParams && data.paramsSchema && (
        <ParamsMini schema={data.paramsSchema} values={data.params ?? {}} onApply={(values) => data.onSaveParams(data.analysisId, values)} />
      )}
      {failed && data.latestRun && (
        <div className="nodrag nowheel border-t bg-red-50 px-3 py-1.5 text-[10px] text-red-800 dark:bg-red-950/40 dark:text-red-200">
          <div className="flex items-center gap-1 font-medium">
            <AlertTriangle className="h-3 w-3" /> {data.latestRun.runNumber} failed
            <span className="flex-1" />
            <Link href={`/explore/runs/${data.latestRun.id}${data.scopeQuery}`} className="hover:underline">Logs</Link>
          </div>
          <pre className="mt-0.5 max-h-12 overflow-hidden whitespace-pre-wrap break-all font-mono leading-4">{errorLines.join("\n")}</pre>
        </div>
      )}
      <div className="flex items-center gap-2 rounded-b-[7px] border-t px-3 py-1.5 text-[11px]" style={{ background: colours.header }}>
        <button
          type="button"
          onClick={() => void run()}
          disabled={data.active || starting}
          className="nodrag inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-white disabled:opacity-60"
          style={{ background: colours.strong }}
          title={data.active ? "A run is in progress" : "Run this analysis; analyses that read its outputs follow when the outputs change"}
        >
          {data.active || starting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          {data.active ? "Running" : starting ? "Starting" : "Run"}
        </button>
        {data.latestRun ? (
          <>
            {status === "failed" ? (
              <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">{status}</Badge>
            ) : (
              <CardChip colours={colours} variant={status === "completed" ? "filled" : "outline"}>{status}</CardChip>
            )}
            <Link href={`/explore/runs/${data.latestRun.id}${data.scopeQuery}`} className="nodrag truncate text-muted-foreground hover:underline">{data.latestRun.runNumber}</Link>
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

function FigureNode({ data, width, height }: NodeProps<FigureNodeType>) {
  const image = data.thumbnailUrl ?? (data.format === "png" || data.format === "svg" ? data.url : null);
  const colours = tint(data.hue);
  const compact = (width ?? CANVAS_SIZES.figure.width) < 340;
  const area = Math.max(80, (height ?? CANVAS_SIZES.figure.height) - 34);
  return (
    <div className={cn("relative flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card shadow-sm", data.refreshing && "animate-pulse", data.justUpdated && "ring-2 ring-emerald-400")} style={{ borderColor: colours.border }}>
      <Resizer kind="figure" />
      {data.refreshing && <RefreshingOverlay label="updating" />}
      <Handle type="target" position={Position.Left} className={cn(handleClass, data.hasInput && "!opacity-0")} />
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
      <div className="flex items-center gap-2 border-t px-3 py-1.5 text-[11px]" style={{ background: colours.header }}>
        <span className="min-w-0 truncate font-medium" title={`${data.name}, ${data.format === "plotly-json" ? "interactive" : data.format}`}>{data.name}</span>
        {!compact && <span className="shrink-0 text-muted-foreground">{data.format === "plotly-json" ? "interactive" : data.format}</span>}
        <span className="flex-1" />
        {data.unchanged && !compact && <CardChip colours={colours} variant="dashed">unchanged</CardChip>}
        {data.analysisId && (
          <ReportToggle inReport={Boolean(data.inReport)} onToggle={() => data.onToggleReport({ type: "figure", analysisId: data.analysisId!, figureName: data.name, label: data.name })} compact={compact} colours={colours} />
        )}
        <CardMenu
          items={[
            { label: "Open run", href: `/explore/runs/${data.runId}${data.scopeQuery}` },
            { label: "Open figure file", href: data.url, external: true },
            ...(data.analysisId
              ? [{ label: data.inReport ? "Take off the report" : "Add to the report", onSelect: () => void data.onToggleReport({ type: "figure", analysisId: data.analysisId!, figureName: data.name, label: data.name }) }]
              : []),
          ]}
        />
        <Link
          href={`/explore/runs/${data.runId}${data.scopeQuery}`}
          className="nodrag inline-flex shrink-0 items-center gap-1 whitespace-nowrap hover:underline"
          title={`${data.runNumber ?? "Run"}${data.unchanged ? ": the latest run produced the same figure as the run before it" : ": open the run that wrote this figure"}`}
        >
          {compact ? "Run" : (data.runNumber ?? "Run")} <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

/** A built-in view drawn from a table: always current, no run needed, placeable on the report. */
function ViewNode({ data, width, height }: NodeProps<ViewNodeType>) {
  const colours = tint(data.hue);
  const compact = (width ?? CANVAS_SIZES.view.width) < 340;
  const body = Math.max(60, (height ?? CANVAS_SIZES.view.height) - 44 - 34);
  const target: ReportTarget = { type: "view", datasetId: data.datasetId, view: data.view, label: `${data.name} of ${data.tableName}` };
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card shadow-sm" style={{ borderColor: colours.border }}>
      <Resizer kind="view" />
      <Handle type="target" position={Position.Left} className={cn(handleClass, data.hasInput && "!opacity-0")} />
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: colours.header }}>
        {data.view === "heatmap" ? <Grid3x3 className="h-4 w-4 shrink-0" style={{ color: colours.strong }} /> : <Activity className="h-4 w-4 shrink-0" style={{ color: colours.strong }} />}
        <div className="min-w-0 flex-1">
          <Link href={`${data.url}${data.scopeQuery}`} className="block truncate text-sm font-medium hover:underline" title={data.name}>{data.name}</Link>
          <div className="truncate text-[11px] text-muted-foreground" title={data.tableName}>built-in view of {data.tableName}</div>
        </div>
        <CardMenu
          items={[
            { label: "Open view", href: `${data.url}${data.scopeQuery}` },
            { label: data.inReport ? "Take off the report" : "Add to the report", onSelect: () => void data.onToggleReport(target) },
          ]}
        />
      </div>
      <div className="nodrag nowheel min-h-0 flex-1 overflow-hidden bg-muted/30">
        {data.view === "heatmap" ? (
          <HeatmapView datasetId={data.datasetId} compact height={body} />
        ) : (
          <SubjectTimelineOverview datasetId={data.datasetId} compact limit={Math.max(3, Math.floor((body - 26) / 18))} className="overflow-hidden" />
        )}
      </div>
      <div className="flex items-center gap-2 border-t px-3 py-1.5 text-[11px]" style={{ background: colours.header }}>
        <span className="min-w-0 truncate text-muted-foreground">always current</span>
        <span className="flex-1" />
        <ReportToggle inReport={Boolean(data.inReport)} onToggle={() => data.onToggleReport(target)} compact={compact} colours={colours} />
        <Link href={`${data.url}${data.scopeQuery}`} className="nodrag inline-flex shrink-0 items-center gap-1 whitespace-nowrap hover:underline" title="Open the full view">
          Open <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

/** Where the outputs of a run will appear once it finishes. */
function PendingNode({ data }: NodeProps<PendingNodeType>) {
  const colours = tint(data.hue);
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-dashed bg-card shadow-sm" style={{ borderColor: colours.border }}>
      <Resizer kind="pending" />
      <Handle type="target" position={Position.Left} className={cn(handleClass, data.hasInput && "!opacity-0")} />
      <div className="min-h-0 flex-1 space-y-2 p-3">
        <Skeleton className="h-[60%] w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
      <div className="flex items-center gap-2 border-t px-3 py-1.5 text-[11px] text-muted-foreground" style={{ background: colours.header }}>
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="truncate">{data.status === "queued" ? "Queued" : "Computing"} outputs of {data.runNumber}</span>
        <span className="flex-1" />
        <Link href={`/explore/runs/${data.runId}${data.scopeQuery}`} className="nodrag inline-flex items-center gap-1 hover:underline">Run <ExternalLink className="h-3 w-3" /></Link>
      </div>
    </div>
  );
}

const nodeTypes = { source: SourceNode, dataset: DatasetNode, analysis: AnalysisNode, figure: FigureNode, pending: PendingNode, view: ViewNode };

/** Per-card position and size; Arrange drops the positions and keeps the sizes. */
type StoredLayout = Record<string, { x?: number; y?: number; width?: number; height?: number }>;

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
  /** The report whose analysis steps the canvas shows; tables of the scope are shared. */
  reportId: string;
  className?: string;
  /** Grow to the bottom of the window instead of a fixed height. */
  fillViewport?: boolean;
  /** A card to pan to and select once the graph is shown (from "Show on canvas" on the report). */
  focusNodeId?: string | null;
}

/**
 * The Explore canvas for one scope: every dataset, analysis and figure as a
 * resizable card, connected by their lineage. Positions and sizes are kept per
 * scope in the browser; "Arrange" recomputes the layered layout.
 */
export function ExploreCanvas({ scope, reportId, className, fillViewport = false, focusNodeId = null }: ExploreCanvasProps) {
  // Card positions are remembered per report: every report has its own canvas.
  const layoutKey = `${scope}#${reportId}`;
  // Outputs a run just rewrote glow for a few seconds so the eye lands on what
  // changed, and the analyses reading those outputs run again (x -> y -> z).
  const statusRef = useRef<Map<string, string>>(new Map());
  const refreshRef = useRef<() => Promise<unknown>>(async () => undefined);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const cascade = useCallback(async (runId: string, analysisName: string) => {
    try {
      const result = await postJson<{ started: Array<{ name: string }>; changedDatasets: string[] }>(`/api/explore/runs/${runId}/cascade`, {});
      if (result.started.length > 0) {
        toast.info(`${analysisName} changed its outputs; running ${result.started.map((entry) => entry.name).join(", ")} next`);
        await refreshRef.current();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not run the analyses downstream");
    }
  }, []);
  const noteFinishedRuns = useCallback(
    (latest: CanvasGraph) => {
      const next = new Set<string>();
      for (const node of latest.nodes) {
        if (node.data.kind !== "analysis") continue;
        const previous = statusRef.current.get(node.id);
        const current = node.data.latestRun?.status ?? "";
        if (previous && ["pending", "queued", "running"].includes(previous) && current === "completed") {
          for (const edge of latest.edges) if (edge.source === node.id) next.add(edge.target);
          if (node.data.latestRun) void cascade(node.data.latestRun.id, node.data.name);
        }
        statusRef.current.set(node.id, current);
      }
      if (next.size === 0) return;
      setFresh((existing) => new Set([...existing, ...next]));
      setTimeout(() => setFresh((existing) => new Set([...existing].filter((id) => !next.has(id)))), 8000);
    },
    [cascade]
  );
  const { data: graph, error, isLoading, mutate } = useSWR<CanvasGraph>(`/api/explore/canvas?targetKey=${encodeURIComponent(scope)}&reportId=${encodeURIComponent(reportId)}`, fetcher, {
    // Poll quickly while something is computing so skeletons turn into outputs on their own.
    refreshInterval: (latest) => (latest?.nodes.some((node) => node.data.kind === "analysis" && node.data.active) ? 3000 : 15000),
    onSuccess: noteFinishedRuns,
  });
  useEffect(() => {
    refreshRef.current = () => mutate();
  }, [mutate]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [arrangeVersion, setArrangeVersion] = useState(0);
  const [openAnalysisId, setOpenAnalysisId] = useState<string | null>(null);
  const [minimap, setMinimap] = useStoredPreference<"shown" | "hidden">("seqdesk:explore:canvas:minimap", "shown", ["shown", "hidden"]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number>(640);
  const { data: kitsData } = useSWR<{ kits: KitSummary[] }>("/api/explore/kits", fetcher);
  const kits = useMemo(() => kitsData?.kits ?? [], [kitsData]);
  const instanceRef = useRef<ReactFlowInstance<CanvasFlowNode, Edge> | null>(null);
  const appliedArrangeRef = useRef(0);
  const focusedRef = useRef<string | null>(null);
  const connectingFromRef = useRef<string | null>(null);
  const [analyseAt, setAnalyseAt] = useState<{ datasetId: string; x: number; y: number; flow: { x: number; y: number } | null; from: { x: number; y: number } | null; hue: number | null } | null>(null);
  const scopeQuery = `?scope=${encodeURIComponent(scope)}`;

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

  /** Start an analysis whose first input is this table; the compute card appears next to it. */
  const createAnalysis = useCallback(
    async (datasetId: string, kitId: string | null, placeAt?: { x: number; y: number }) => {
      const kit = kitId ? kits.find((entry) => entry.id === kitId) : null;
      try {
        const result = await postJson<{ analysis: { id: string } }>("/api/explore/analyses", {
          targetKey: scope,
          reportId,
          kitId,
          language: kit?.language ?? "python",
          inputs: [{ alias: kit?.inputs[0]?.alias ?? "table", datasetId }],
        });
        if (placeAt) {
          // The new card appears where it was asked for, not where the layout would put it.
          writeLayout(layoutKey, { ...readLayout(layoutKey), [`analysis:${result.analysis.id}`]: { x: placeAt.x, y: placeAt.y } });
        }
        toast.success(kit ? `${kit.name} added; press Run on its card` : "Blank analysis added; open Code to write it");
        await mutate();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not create the analysis");
      }
    },
    [kits, mutate, scope, layoutKey, reportId]
  );

  /** Inputs an existing analysis still has free, per table: a kit input not yet bound, or an extra input of a blank script. */
  const connectTargetsFor = useCallback(
    (datasetId: string): ConnectTarget[] => {
      if (!graph) return [];
      const targets: ConnectTarget[] = [];
      for (const node of graph.nodes) {
        const data = node.data;
        if (data.kind !== "analysis") continue;
        const bound = data.inputs ?? [];
        if (bound.some((binding) => binding.datasetId === datasetId)) continue;
        const kit = data.kitId ? kits.find((entry) => entry.id === data.kitId) : null;
        if (kit) {
          for (const input of kit.inputs) {
            if (bound.some((binding) => binding.alias === input.alias)) continue;
            targets.push({ analysisId: data.analysisId, analysisName: data.name, alias: input.alias, label: input.label });
          }
        } else {
          let index = bound.length + 1;
          while (bound.some((binding) => binding.alias === `table${index}`)) index += 1;
          targets.push({ analysisId: data.analysisId, analysisName: data.name, alias: `table${index}`, label: `extra input ${index}` });
        }
      }
      return targets;
    },
    [graph, kits]
  );

  /** Bind a table to a free input of an existing analysis; the binding is a new version. */
  const connectInput = useCallback(
    async (datasetId: string, target: ConnectTarget) => {
      const node = graph?.nodes.find((entry) => entry.data.kind === "analysis" && entry.data.analysisId === target.analysisId);
      const bound = node?.data.kind === "analysis" ? (node.data.inputs ?? []) : [];
      try {
        await postJson(`/api/explore/analyses/${target.analysisId}/revisions`, {
          inputs: [...bound, { alias: target.alias, datasetId }],
          message: `Connected a table as ${target.alias} on the canvas`,
        });
        toast.success(`Connected to ${target.analysisName} as ${target.label}; press Run to use it`);
        await mutate();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not connect the table");
      }
    },
    [graph, mutate]
  );

  /** Delete a table or an analysis from its card, after a confirmation. */
  const deleteCard = useCallback(
    async (kind: "dataset" | "analysis", id: string, name: string) => {
      const question = kind === "dataset" ? `Delete the table "${name}" with all its versions and edits?` : `Delete the analysis "${name}" with all its versions and runs?`;
      if (!window.confirm(question)) return;
      try {
        await postJson(`/api/explore/${kind === "dataset" ? "datasets" : "analyses"}/${id}`, undefined, "DELETE");
        const layout = readLayout(layoutKey);
        delete layout[`${kind}:${id}`];
        writeLayout(layoutKey, layout);
        toast.success(kind === "dataset" ? "Table deleted" : "Analysis deleted");
        await mutate();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not delete");
      }
    },
    [mutate, layoutKey]
  );

  /** Parameters changed on a card become a new version of the analysis. */
  const saveParams = useCallback(
    async (analysisId: string, params: Record<string, unknown>) => {
      try {
        const result = await postJson<{ revision: { number: number } }>(`/api/explore/analyses/${analysisId}/revisions`, { params, message: "Parameters changed on the canvas" });
        toast.success(`Saved as version ${result.revision.number}; press Run to apply`);
        await mutate();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not save the parameters");
      }
    },
    [mutate]
  );

  /** Add an output to the report page or take it off; a draft report is saved on first use. */
  const toggleReport = useCallback(
    async (target: ReportTarget) => {
      const key = `/api/explore/reports/${encodeURIComponent(reportId)}`;
      try {
        const { report } = (await fetcher(key)) as { report: ReportView };
        const blocks: ReportBlock[] = report.blocks.map((block) => {
          if (block.type === "text") return { id: block.id, type: "text", markdown: block.markdown, span: block.span };
          if (block.type === "figure") return { id: block.id, type: "figure", analysisId: block.analysisId, figureName: block.figureName, caption: block.caption, span: block.span };
          if (block.type === "chart") return { id: block.id, type: "chart", datasetId: block.datasetId, chart: block.chart, x: block.x, y: block.y, color: block.color, caption: block.caption, span: block.span };
          if (block.type === "metric") return { id: block.id, type: "metric", datasetId: block.datasetId, column: block.column, stats: block.stats, label: block.label, span: block.span };
          if (block.type === "view") return { id: block.id, type: "view", datasetId: block.datasetId, view: block.view, options: block.options, caption: block.caption, span: block.span };
          if (block.type === "taxon-explorer") return { id: block.id, type: "taxon-explorer", datasetId: block.datasetId, taxon: block.taxon, caption: block.caption, span: block.span };
          if (block.type === "subject") return { id: block.id, type: "subject", datasetId: block.datasetId, subject: block.subject, measure: block.measure, caption: block.caption, span: block.span };
          if (block.type === "curated") return { id: block.id, type: "curated", datasetId: block.datasetId, role: block.role, lists: block.lists, limit: block.limit, caption: block.caption, span: block.span };
          if (block.type === "run-metric") return { id: block.id, type: "run-metric", analysisId: block.analysisId, metrics: block.metrics, label: block.label, span: block.span };
          return { id: block.id, type: "table", datasetId: block.datasetId, caption: block.caption, rows: block.rows, span: block.span };
        });
        const id = target.type === "figure" ? figureBlockId(target.analysisId, target.figureName) : target.type === "view" ? viewBlockId(target.datasetId, target.view) : tableBlockId(target.datasetId);
        const present = blocks.some((block) => block.id === id);
        const next = present
          ? blocks.filter((block) => block.id !== id)
          : [
              ...blocks,
              target.type === "figure"
                ? ({ id, type: "figure", analysisId: target.analysisId, figureName: target.figureName, caption: target.label, span: 1 } as ReportBlock)
                : target.type === "view"
                  ? ({ id, type: "view", datasetId: target.datasetId, view: target.view, caption: target.label, span: 2 } as ReportBlock)
                  : ({ id, type: "table", datasetId: target.datasetId, caption: target.label, span: 2 } as ReportBlock),
            ];
        await postJson(key, { title: report.title, blocks: next, filters: report.filters }, "PUT");
        toast.success(present ? `${target.label} taken off the report` : `${target.label} added to the report`);
        await mutate();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not change the report");
      }
    },
    [mutate, reportId]
  );

  // Pan to the card a report link asked for, once React Flow has measured it.
  const focusRequestedCard = useCallback(() => {
    const id = focusNodeId;
    const instance = instanceRef.current;
    if (!id || !instance || focusedRef.current === id) return;
    const target = instance.getNodes().find((node) => node.id === id);
    if (!target?.measured?.width) return;
    focusedRef.current = id;
    instance.updateNode(id, { selected: true });
    // After React Flow's own first fit, which would otherwise win.
    setTimeout(() => void instance.fitView({ nodes: [{ id }], duration: 600, maxZoom: 1, padding: 0.6 }), 250);
  }, [focusNodeId]);
  useEffect(() => {
    focusRequestedCard();
  }, [nodes, focusRequestedCard]);

  // Dragging from a table's handle onto empty canvas opens the Analyse menu there.
  const onConnectStart: OnConnectStart = useCallback((_event, params) => {
    connectingFromRef.current = params.handleType === "source" && params.nodeId?.startsWith("dataset:") ? params.nodeId : null;
  }, []);
  const onConnectEnd: OnConnectEnd = useCallback(
    (event) => {
    const from = connectingFromRef.current;
    connectingFromRef.current = null;
    if (!from || !containerRef.current) return;
    const target = event.target as HTMLElement | null;
    if (!target?.classList.contains("react-flow__pane")) return;
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    const rect = containerRef.current.getBoundingClientRect();
    // Keep the menu inside the canvas.
    const x = Math.min(point.clientX - rect.left, Math.max(0, rect.width - 330));
    const y = Math.min(point.clientY - rect.top, Math.max(0, rect.height - 320));
    // Where the drag started, so the line can stay while the menu is open.
    const handle = containerRef.current.querySelector<HTMLElement>(`.react-flow__node[data-id="${from}"] .react-flow__handle.source`);
    const handleRect = handle?.getBoundingClientRect();
    const fromPoint = handleRect ? { x: handleRect.left + handleRect.width / 2 - rect.left, y: handleRect.top + handleRect.height / 2 - rect.top } : null;
    const hue = (nodes.find((node) => node.id === from)?.data as { hue?: number } | undefined)?.hue ?? null;
    const dropped = instanceRef.current?.screenToFlowPosition({ x: point.clientX, y: point.clientY }) ?? null;
    const flow = dropped ? { x: dropped.x - CANVAS_SIZES.analysis.width / 2, y: dropped.y - CANVAS_SIZES.analysis.height / 2 } : null;
    setAnalyseAt({ datasetId: from.slice("dataset:".length), x, y, flow, from: fromPoint, hue });
    },
    [nodes]
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
    // Read again after Arrange dropped the positions (arrangeVersion changes then).
    const stored = arrangeVersion >= 0 ? readLayout(layoutKey) : {};
    const sizes: Record<string, { width: number; height: number }> = {};
    for (const [id, entry] of Object.entries(stored)) if (entry.width && entry.height) sizes[id] = { width: entry.width, height: entry.height };
    const auto = layoutCanvas(graph, { sizes });
    const hues = assignCanvasHues(graph);
    // Nodes the user placed keep their spot; new nodes take the computed slot
    // and move down until they no longer overlap a placed node.
    const placed = (id: string): { x: number; y: number } | null => {
      const entry = stored[id];
      return entry && typeof entry.x === "number" && typeof entry.y === "number" ? { x: entry.x, y: entry.y } : null;
    };
    const occupied = graph.nodes.flatMap((node) => {
      const at = placed(node.id);
      return at ? [{ ...at, ...nodeSize(node, { sizes }) }] : [];
    });
    const settle = (node: CanvasGraph["nodes"][number]) => {
      const at = placed(node.id);
      if (at) return at;
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
    const wired = new Set(graph.edges.map((edge) => edge.target));
    return graph.nodes.map((node) => {
      const position = settle(node);
      const size = nodeSize(node, { sizes });
      const hue = hues[node.id] ?? COMPUTE_HUE;
      const base = { id: node.id, position, width: size.width, height: size.height };
      const justUpdated = fresh.has(node.id);
      const hasInput = wired.has(node.id);
      if (node.data.kind === "dataset") {
        return {
          ...base,
          type: "dataset",
          data: {
            ...node.data,
            hue,
            scopeQuery,
            justUpdated,
            hasInput,
            kits,
            connectTargets: connectTargetsFor(node.data.datasetId),
            onPreset: applyPreset,
            onAnalyse: createAnalysis,
            onConnect: connectInput,
            onToggleReport: toggleReport,
            onDelete: deleteCard,
          },
        } as DatasetNodeType;
      }
      if (node.data.kind === "analysis") {
        return { ...base, type: "analysis", data: { ...node.data, hue, scopeQuery, hasInput, onOpenCode: openCode, onRun: runAnalysis, onSaveParams: saveParams, onDelete: deleteCard } } as AnalysisNodeType;
      }
      if (node.data.kind === "figure") return { ...base, type: "figure", data: { ...node.data, hue, scopeQuery, justUpdated, hasInput, onToggleReport: toggleReport } } as FigureNodeType;
      if (node.data.kind === "pending") return { ...base, type: "pending", data: { ...node.data, hue, scopeQuery, hasInput } } as PendingNodeType;
      if (node.data.kind === "view") return { ...base, type: "view", data: { ...node.data, hue, scopeQuery, hasInput, onToggleReport: toggleReport } } as ViewNodeType;
      return { ...base, type: "source", data: node.data } as SourceNodeType;
    });
  }, [graph, applyPreset, openCode, runAnalysis, saveParams, createAnalysis, connectTargetsFor, connectInput, toggleReport, deleteCard, kits, fresh, scopeQuery, arrangeVersion, layoutKey]);

  const flowEdges = useMemo<Edge[]>(() => {
    if (!graph) return [];
    const hues = assignCanvasHues(graph);
    return graph.edges.map((edge) => {
      const hue = hues[edge.source] ?? hues[edge.target] ?? null;
      // Lines stay neutral so the card colours carry the meaning.
      const stroke = hue === null ? "var(--border)" : "var(--muted-foreground)";
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
    const rearranged = arrangeVersion !== appliedArrangeRef.current;
    appliedArrangeRef.current = arrangeVersion;
    setNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node] as const));
      return flowNodes.map((node) => {
        const existing = rearranged ? undefined : currentById.get(node.id);
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
      writeLayout(layoutKey, layout);
    }, 400);
    return () => clearTimeout(timer);
  }, [nodes, scope, layoutKey]);

  // Clicking an arrow opens the code of the analysis it goes into or comes from.
  const onEdgeClick: EdgeMouseHandler = useCallback((_event, edge) => {
    const analysisId = [edge.source, edge.target].find((id) => id.startsWith("analysis:"))?.slice("analysis:".length);
    if (analysisId) setOpenAnalysisId(analysisId);
  }, []);

  const arrange = useCallback(() => {
    // Positions are recomputed; the sizes people chose stay.
    const sizesOnly: StoredLayout = {};
    for (const [id, entry] of Object.entries(readLayout(layoutKey))) if (entry.width && entry.height) sizesOnly[id] = { width: entry.width, height: entry.height };
    writeLayout(layoutKey, sizesOnly);
    setArrangeVersion((value) => value + 1);
  }, [layoutKey]);

  if (error) return <p className="text-sm text-destructive">Could not load the canvas: {String(error.message)}</p>;
  if (isLoading && !graph) return <Skeleton className={cn("h-[560px] w-full", className)} />;
  if (graph && graph.nodes.length === 0) {
    return (
      <div className={cn("rounded-lg border border-dashed p-8", className)}>
        <div className="mx-auto max-w-2xl">
          <p className="text-base font-semibold">Start here</p>
          <ol className="mt-4 grid gap-4 text-sm md:grid-cols-3">
            <li className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 font-medium"><span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-xs">1</span> Add a table</div>
              <p className="mt-1 text-muted-foreground">From the samples, the sequencing runs, a pipeline output, or a file of your own.</p>
              <div className="mt-3"><AddDataMenu scope={scope} reportId={reportId} onBuilt={() => mutate()} withAnalysis={false} label="Add table" /></div>
            </li>
            <li className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 font-medium"><span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-xs">2</span> Analyse it</div>
              <p className="mt-1 text-muted-foreground">Press Analyse on the table card, or drag from its right handle onto the canvas, and pick a template or a blank script.</p>
            </li>
            <li className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 font-medium"><span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-xs">3</span> Run and report</div>
              <p className="mt-1 text-muted-foreground">Run writes figures and tables as cards; they land on the Report page for others to read.</p>
            </li>
          </ol>
        </div>
      </div>
    );
  }
  const analyseDataset = analyseAt ? graph?.nodes.find((node) => node.id === `dataset:${analyseAt.datasetId}`)?.data : null;

  return (
    <div ref={containerRef} className={cn("relative w-full overflow-hidden rounded-lg border bg-muted/20", className)} style={{ height: fillViewport ? height : 640 }}>
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
        <AddDataMenu scope={scope} reportId={reportId} onBuilt={() => mutate()} label="Add" variant="outline" />
        <CanvasLegend />
        <Button size="sm" variant="outline" onClick={() => setMinimap(minimap === "shown" ? "hidden" : "shown")} title={minimap === "shown" ? "Hide the overview map" : "Show the overview map"} aria-pressed={minimap === "shown"}>
          <MapIcon className="mr-2 h-4 w-4" />
          Overview
        </Button>
        <Button size="sm" variant="outline" onClick={arrange} title="Recompute the layout; card sizes are kept">
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
        nodesConnectable
        isValidConnection={() => false}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onInit={(instance) => {
          instanceRef.current = instance;
          focusRequestedCard();
        }}
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
      {analyseAt?.from && (
        // The line the drag drew stays until the menu is answered.
        <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" aria-hidden>
          <path
            d={`M${analyseAt.from.x},${analyseAt.from.y} C${(analyseAt.from.x + analyseAt.x) / 2},${analyseAt.from.y} ${(analyseAt.from.x + analyseAt.x) / 2},${analyseAt.y} ${analyseAt.x},${analyseAt.y}`}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth="1.5"
            strokeDasharray="5 4"
          />
          <circle cx={analyseAt.x} cy={analyseAt.y} r="4" fill="var(--muted-foreground)" />
        </svg>
      )}
      {analyseAt && analyseDataset?.kind === "dataset" && (
        <DropdownMenu open onOpenChange={(open) => !open && setAnalyseAt(null)}>
          <DropdownMenuTrigger asChild>
            <span className="absolute h-px w-px" style={{ left: analyseAt.x, top: analyseAt.y }} aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80" aria-label={`Connect ${analyseDataset.name}`}>
            <AnalyseList
              dataset={analyseDataset}
              kits={kits}
              connectTargets={connectTargetsFor(analyseDataset.datasetId)}
              onConnect={(target) => {
                setAnalyseAt(null);
                void connectInput(analyseDataset.datasetId, target);
              }}
              onPick={(kitId) => {
                const placeAt = analyseAt.flow ?? undefined;
                setAnalyseAt(null);
                void createAnalysis(analyseDataset.datasetId, kitId, placeAt);
              }}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {openAnalysisId && <CodePanel analysisId={openAnalysisId} scopeQuery={scopeQuery} onClose={() => setOpenAnalysisId(null)} onChanged={() => mutate()} onRun={runAnalysis} />}
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
          <p className="mt-1 text-muted-foreground">Add tables with the Add button. Press Analyse on a table card, or drag from its green handle onto the canvas, to start an analysis that reads it.</p>
          <p className="mt-1 text-muted-foreground">Select a card and drag its corners to resize it; tables then show more rows and columns.</p>
          <p className="mt-1 text-muted-foreground">Column headers tinted like compute, with a dot, are the columns an analysis reads. A +N pill folds the columns in between; click it to open them.</p>
        </div>
      )}
    </div>
  );
}

/** Side panel with the current code of one analysis, opened from a card or an arrow. */
function CodePanel({
  analysisId,
  scopeQuery,
  onClose,
  onChanged,
  onRun,
}: {
  analysisId: string;
  scopeQuery: string;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
  onRun: (analysisId: string) => Promise<void>;
}) {
  const { data, error, mutate: mutateAnalysis } = useSWR<{ analysis: { name: string; description: string | null; language: "python" | "r"; code: string; currentRevision: { number: number } | null; kitId: string | null } }>(
    `/api/explore/analyses/${analysisId}`,
    fetcher
  );
  const analysis = data?.analysis;
  const [tab, setTab] = useState<"code" | "description">("code");
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState<"save" | "run" | null>(null);
  const dirty = draft !== null && analysis !== undefined && draft !== analysis.code;
  const save = async (thenRun: boolean) => {
    if (draft === null) return;
    setSaving(thenRun ? "run" : "save");
    try {
      const result = await postJson<{ revision: { number: number } }>(`/api/explore/analyses/${analysisId}/revisions`, { code: draft, message: "Edited on the canvas" });
      toast.success(`Saved as version ${result.revision.number}`);
      setDraft(null);
      await Promise.all([mutateAnalysis(), onChanged()]);
      if (thenRun) await onRun(analysisId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the code");
    } finally {
      setSaving(null);
    }
  };
  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-[min(560px,80%)] flex-col border-l bg-card shadow-xl" role="dialog" aria-label="Analysis code">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Code2 className="h-4 w-4 text-violet-700" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{analysis?.name ?? "Loading"}</div>
          {analysis && (
            <div className="text-[11px] text-muted-foreground">
              {analysis.language}{analysis.kitId ? `, template ${analysis.kitId}` : ""}{analysis.currentRevision ? `, version ${analysis.currentRevision.number}` : ""}{dirty ? ", unsaved changes" : ""}
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
        {analysis && tab === "code" && (
          <CodeEditor value={draft ?? analysis.code} onChange={setDraft} language={analysis.language} height="100%" ariaLabel={`Code of ${analysis.name}`} />
        )}
        {analysis && tab === "description" && (
          <div className="space-y-3 p-2 text-sm">
            {analysis.description && <p>{analysis.description}</p>}
            <div className="rounded-md border border-dashed p-4 text-muted-foreground">
              No plain-language description of this code yet. When the assistant module is enabled, it will describe what each revision does here.
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">This code turns the connected inputs into the outputs. Every save is a new version.</span>
        <Button size="sm" variant="outline" onClick={() => void save(false)} disabled={!dirty || saving !== null}>
          {saving === "save" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
          Save version
        </Button>
        <Button size="sm" onClick={() => void save(true)} disabled={!dirty || saving !== null}>
          {saving === "run" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
          Save and run
        </Button>
      </div>
    </div>
  );
}
