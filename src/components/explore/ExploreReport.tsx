"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowDown, ArrowUp, Check, Copy, ExternalLink, Globe, LayoutGrid, Loader2, Plus, RectangleHorizontal, RotateCcw, Share2, Square, Trash2, Undo2, Unlink } from "lucide-react";
import { ElementStore, type StoreGroup } from "@/components/explore/ElementStore";
import { Markdown } from "@/components/explore/Markdown";
import { RichTextEditor } from "@/components/explore/RichTextEditor";
import { PlotlyChart } from "@/components/explore/PlotlyChart";
import { CuratedOrganismsView, FilterBar, filtersApply, RunMetricView, SubjectView, TaxonExplorerView, useTableFrame, filteredRows, columnLabel as frameColumnLabel } from "@/components/explore/ReportWidgets";
import { HeatmapView, type HeatmapOptions } from "@/components/explore/views/HeatmapView";
import { SubjectTimelineOverview } from "@/components/explore/views/SubjectTimelineOverview";
import { BUILT_IN_VIEWS, type BuiltInView } from "@/lib/explore/canvas-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { fetcher, formatCell, formatDateTime, postJson } from "@/lib/explore/client";
import { CHART_KINDS, CHART_KIND_LABELS, METRIC_STATS, METRIC_STAT_LABELS, type ChartKind, type MetricStat } from "@/lib/explore/report-blocks";
import { buildChart, computeStats, formatStat, numericColumns } from "@/lib/explore/report-widgets";
import type { ActiveFilters } from "@/lib/explore/frame";
import type { ReportFilter } from "@/lib/explore/report-blocks";
import type { ReportAnalysis, ReportBlock, ReportFigure, ReportInput, ReportShare, ReportTable, ReportTableContent, ReportView, ResolvedReportBlock } from "@/lib/explore/reports";
import type { ExploreColumn } from "@/lib/explore/types";

interface ExploreReportProps {
  reportId: string;
  scope: string;
  canEdit: boolean;
  /** True while the page is being edited (the report page's edit mode); saving or cancelling calls onDone. */
  editing: boolean;
  onDone: () => void;
  /** Switch to the canvas, where outputs are made. */
  onOpenCanvas: () => void;
}

type ReportResponse = { report: ReportView };

/** Tables the organism blocks can read: long profiles with sample, taxon and count roles. */
const profileTable = (table: ReportTable): boolean => Boolean(table.roles.sample && table.roles.taxon && table.roles.count);

function newBlockId(prefix: string): string {
  return `${prefix}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function figureKey(analysisId: string, figureName: string): string {
  return `${analysisId}:${figureName}`;
}

/** The editable shape of a report: what the server stores, without the resolved content. */
function toInput(report: ReportView): ReportInput {
  return {
    title: report.title,
    filters: report.filters,
    blocks: report.blocks.map((block): ReportBlock => {
      if (block.type === "text") return { id: block.id, type: "text", markdown: block.markdown, span: block.span };
      if (block.type === "figure") {
        return { id: block.id, type: "figure", analysisId: block.analysisId, figureName: block.figureName, caption: block.caption, span: block.span };
      }
      if (block.type === "chart") {
        return { id: block.id, type: "chart", datasetId: block.datasetId, chart: block.chart, x: block.x, y: block.y, color: block.color, caption: block.caption, span: block.span };
      }
      if (block.type === "metric") return { id: block.id, type: "metric", datasetId: block.datasetId, column: block.column, stats: block.stats, label: block.label, span: block.span };
      if (block.type === "view") return { id: block.id, type: "view", datasetId: block.datasetId, view: block.view, options: block.options, caption: block.caption, span: block.span };
      if (block.type === "taxon-explorer") return { id: block.id, type: "taxon-explorer", datasetId: block.datasetId, taxon: block.taxon, caption: block.caption, span: block.span };
      if (block.type === "subject") return { id: block.id, type: "subject", datasetId: block.datasetId, subject: block.subject, measure: block.measure, caption: block.caption, span: block.span };
      if (block.type === "curated") return { id: block.id, type: "curated", datasetId: block.datasetId, role: block.role, lists: block.lists, limit: block.limit, caption: block.caption, span: block.span };
      if (block.type === "run-metric") return { id: block.id, type: "run-metric", analysisId: block.analysisId, metrics: block.metrics, label: block.label, span: block.span };
      return { id: block.id, type: "table", datasetId: block.datasetId, caption: block.caption, rows: block.rows, span: block.span };
    }),
  };
}

function figureBlockOf(figure: ReportFigure): ReportBlock {
  return {
    id: `figure:${figure.analysisId}:${figure.figureName}`,
    type: "figure",
    analysisId: figure.analysisId,
    figureName: figure.figureName,
    caption: `${figure.figureName} (${figure.analysisName})`,
    span: 1,
  };
}

function tableBlockOf(table: ReportTable): ReportBlock {
  return { id: `table:${table.datasetId}`, type: "table", datasetId: table.datasetId, caption: table.name, span: 2 };
}

/**
 * The report of a scope: the final page where the outputs of the canvas come
 * together with text. Read-only for viewers; editors arrange blocks, write
 * Markdown and pick which figures and tables to show.
 */
export function ExploreReport({ reportId, scope, canEdit, editing: editRequested, onOpenCanvas }: ExploreReportProps) {
  const key = `/api/explore/reports/${encodeURIComponent(reportId)}`;
  const scopeQuery = `?scope=${encodeURIComponent(scope)}`;
  const { data, error, isLoading, mutate } = useSWR<ReportResponse>(key, fetcher, { refreshInterval: 15000 });
  const [draft, setDraft] = useState<ReportInput | null>(null);
  // Changes save on their own a moment after they stop; Undo walks back through them.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [history, setHistory] = useState<ReportInput[]>([]);
  const [dirty, setDirty] = useState(false);
  const savedRef = useRef<string | null>(null);
  const savedInputRef = useRef<ReportInput | null>(null);
  const [storeOpen, setStoreOpen] = useState(false);
  const [active, setActive] = useState<ActiveFilters>({});
  const report = data?.report;

  const editingNow = editRequested && canEdit;

  // Save a moment after the last change while editing.
  useEffect(() => {
    if (!editingNow || !draft || !report) return;
    if (savedRef.current === null) {
      savedInputRef.current = toInput(report);
      savedRef.current = JSON.stringify(savedInputRef.current);
    }
    const payload = JSON.stringify(draft);
    if (payload === savedRef.current) return;
    const timer = setTimeout(() => {
      setSaveState("saving");
      void postJson<ReportResponse>(key, draft, "PUT")
        .then(async (result) => {
          // Every saved step is one Undo step.
          const before = savedInputRef.current;
          if (before) setHistory((entries) => [...entries.slice(-49), before]);
          savedInputRef.current = draft;
          savedRef.current = payload;
          await mutate(result, { revalidate: false });
          setSaveState("saved");
          setDirty(false);
        })
        .catch((err) => {
          setSaveState("error");
          toast.error(err instanceof Error ? err.message : "Could not save the report");
        });
    }, 700);
    return () => clearTimeout(timer);
  }, [draft, editingNow, key, mutate, report]);

  // Leaving the editor saves what is still pending and forgets the session.
  useEffect(() => {
    if (editingNow || !draft) return;
    const payload = JSON.stringify(draft);
    const pending = payload !== savedRef.current;
    void (async () => {
      if (pending) {
        try {
          const result = await postJson<ReportResponse>(key, draft, "PUT");
          savedRef.current = payload;
          await mutate(result, { revalidate: false });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not save the report");
        }
      }
      savedRef.current = null;
      savedInputRef.current = null;
      setDraft(null);
      setHistory([]);
      setDirty(false);
      setSaveState("idle");
    })();
  }, [editingNow, draft, key, mutate]);

  if (error) return <p className="mt-6 text-sm text-destructive">Could not load the report: {String(error.message)}</p>;
  if (!report || (isLoading && !data)) {
    return (
      <div className="mt-6 space-y-3">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const editing = editRequested && canEdit;
  // The working copy starts from the saved page and lives in state once something changes.
  const working: ReportInput | null = editing ? (draft ?? toInput(report)) : null;
  const patchDraft = (fn: (current: ReportInput) => ReportInput) => {
    setDraft(fn(working ?? toInput(report)));
    setDirty(true);
  };
  // Undo first drops what is not saved yet, then walks back one saved step at a time.
  const undo = () => {
    const lastSaved = savedInputRef.current;
    if (draft && lastSaved && JSON.stringify(draft) !== savedRef.current) {
      setDraft(lastSaved);
      setDirty(false);
      return;
    }
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((entries) => entries.slice(0, -1));
    setDraft(previous);
  };
  const outputTables = report.outputs.tables.filter((table) => table.output);
  const hasOutputs = report.outputs.figures.length + outputTables.length > 0;
  const resolvedById = new Map(report.blocks.map((block) => [block.id, block] as const));
  const figureByKey = new Map(report.outputs.figures.map((figure) => [figureKey(figure.analysisId, figure.figureName), figure] as const));
  const tableById = new Map(report.outputs.tables.map((table) => [table.datasetId, table] as const));
  const blocks: ReportBlock[] = working ? working.blocks : report.blocks;
  const filters: ReportFilter[] = working ? (working.filters ?? []) : report.filters;
  const setFilters = (next: ReportFilter[]) => patchDraft((current) => ({ ...current, filters: next }));
  const analysisById = new Map(report.outputs.analyses.map((analysis) => [analysis.analysisId, analysis] as const));
  const headings = blocks.flatMap((block) => (block.type === "text" ? block.markdown.split("\n").filter((line) => /^##\s+/.test(line)).slice(0, 1).map((line) => ({ id: block.id, title: line.replace(/^##\s+/, "").trim() })) : []));
  const usedFigures = new Set(blocks.filter((block) => block.type === "figure").map((block) => figureKey(block.analysisId, block.figureName)));
  const usedTables = new Set(blocks.filter((block) => block.type === "table").map((block) => block.datasetId));
  const usedViews = new Set(blocks.filter((block) => block.type === "view").map((block) => `${block.datasetId}:${block.view}`));

  const update = (mutator: (blocks: ReportBlock[]) => ReportBlock[]) =>
    patchDraft((current) => ({ ...current, blocks: mutator(current.blocks) }));
  const patchBlock = (id: string, patch: Partial<ReportBlock>) =>
    update((current) => current.map((block) => (block.id === id ? ({ ...block, ...patch } as ReportBlock) : block)));
  const moveBlock = (id: string, delta: number) =>
    update((current) => {
      const index = current.findIndex((block) => block.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  const removeBlock = (id: string) => update((current) => current.filter((block) => block.id !== id));
  const addBlock = (block: ReportBlock) => update((current) => (current.some((entry) => entry.id === block.id) ? current : [...current, block]));
  const storeGroups: StoreGroup[] = [
    {
      label: "Build from a table",
      items: [
        { id: "text", title: "Text", hint: "Headings, paragraphs and lists in Markdown", sketch: "text", onSelect: () => addBlock({ id: newBlockId("text"), type: "text", markdown: "" }) },
        { id: "histogram", title: "Histogram", hint: "How the values of a numeric column spread", sketch: "histogram", disabled: report.outputs.tables.length === 0, onSelect: () => addBlock({ ...defaultChartBlock(report.outputs.tables), chart: "histogram" } as ReportBlock) },
        { id: "bar", title: "Bar chart", hint: "How many rows have each value", sketch: "bar", disabled: report.outputs.tables.length === 0, onSelect: () => addBlock({ ...defaultChartBlock(report.outputs.tables), chart: "bar" } as ReportBlock) },
        { id: "scatter", title: "Dot plot", hint: "Two numeric columns against each other", sketch: "scatter", disabled: report.outputs.tables.length === 0, onSelect: () => addBlock({ ...defaultChartBlock(report.outputs.tables), chart: "scatter" } as ReportBlock) },
        { id: "box", title: "Box plot", hint: "A numeric column per group", sketch: "box", disabled: report.outputs.tables.length === 0, onSelect: () => addBlock({ ...defaultChartBlock(report.outputs.tables), chart: "box" } as ReportBlock) },
        { id: "metric", title: "Numbers", hint: "Count, mean, min, max of one column", sketch: "numbers", disabled: report.outputs.tables.length === 0, onSelect: () => addBlock(defaultMetricBlock(report.outputs.tables)) },
        {
          id: "run-metric",
          title: "Run numbers",
          hint: "Numbers an analysis recorded, as cards",
          sketch: "numbers",
          disabled: !report.outputs.analyses.some((analysis) => Object.keys(analysis.metrics).length > 0),
          onSelect: () => {
            const analysis = report.outputs.analyses.find((entry) => Object.keys(entry.metrics).length > 0);
            if (analysis) addBlock({ id: newBlockId("run-metric"), type: "run-metric", analysisId: analysis.analysisId, metrics: Object.keys(analysis.metrics).filter((key) => typeof analysis.metrics[key] === "number").slice(0, 4), span: 2 });
          },
        },
        {
          id: "taxon-explorer",
          title: "Taxon explorer",
          hint: "Pick an organism: prevalence, abundance, carriers",
          sketch: "scatter",
          disabled: !report.outputs.tables.some((table) => table.roles.sample && table.roles.taxon && table.roles.count),
          onSelect: () => {
            const table = report.outputs.tables.find((entry) => entry.roles.sample && entry.roles.taxon && entry.roles.count);
            if (table) addBlock({ id: newBlockId("taxon"), type: "taxon-explorer", datasetId: table.datasetId, span: 2 });
          },
        },
        {
          id: "subject",
          title: "Subject",
          hint: "Pick a subject: composition over time",
          sketch: "timeline",
          disabled: !report.outputs.tables.some((table) => table.views.includes("subject-timeline")),
          onSelect: () => {
            const table = report.outputs.tables.find((entry) => entry.views.includes("subject-timeline"));
            if (table) addBlock({ id: newBlockId("subject"), type: "subject", datasetId: table.datasetId, span: 2 });
          },
        },
        {
          id: "curated",
          title: "Organisms of interest",
          hint: "Which listed organisms occur, how often, in whom",
          sketch: "list",
          disabled: !report.outputs.tables.some(profileTable),
          onSelect: () => {
            const table = report.outputs.tables.find(profileTable);
            if (table) addBlock({ id: newBlockId("curated"), type: "curated", datasetId: table.datasetId, role: "pathogen", span: 2 });
          },
        },
      ],
    },
    {
      label: "Built-in views",
      empty: "Map sample, subject, timepoint, taxon and count roles on a table to unlock these.",
      items: (["subject-timeline", "heatmap"] as const).flatMap((view) =>
        report.outputs.tables
          .filter((table) => table.views.includes(view))
          .map((table) => {
            const used = usedViews.has(`${table.datasetId}:${view}`);
            return {
              id: `${table.datasetId}:${view}`,
              title: BUILT_IN_VIEWS[view].label,
              hint: table.name,
              sketch: view === "heatmap" ? ("heatmap" as const) : ("timeline" as const),
              badge: used ? "added" : undefined,
              disabled: used,
              onSelect: () => addBlock({ id: `view:${table.datasetId}:${view}`, type: "view", datasetId: table.datasetId, view, caption: `${BUILT_IN_VIEWS[view].label} of ${table.name}`, span: 2 }),
            };
          })
      ),
    },
    {
      label: "Figures from your analyses",
      empty: "No analysis has drawn a figure yet. Run one on the canvas and it appears here.",
      items: [
        {
          id: "new-figure",
          title: "New analysis",
          hint: "On the canvas: pick a table, choose a template, run; its figures land here",
          sketch: "analysis" as const,
          onSelect: () => {
            setStoreOpen(false);
            onOpenCanvas();
          },
        },
        ...report.outputs.figures.map((figure) => {
        const used = usedFigures.has(figureKey(figure.analysisId, figure.figureName));
        return {
          id: figureKey(figure.analysisId, figure.figureName),
          title: figure.figureName,
          hint: `${figure.analysisName}, ${figure.runNumber}`,
          sketch: "figure" as const,
          image: figure.thumbnailUrl,
          badge: used ? "added" : undefined,
          disabled: used,
          onSelect: () => addBlock(figureBlockOf(figure)),
        };
        }),
      ],
    },
    {
      label: "Tables",
      empty: "No tables in this scope yet.",
      items: [
        {
          id: "new-table",
          title: "New table",
          hint: "On the canvas: bring one in from samples, sequencing, a pipeline or a file, or let an analysis write one",
          sketch: "import" as const,
          onSelect: () => {
            setStoreOpen(false);
            onOpenCanvas();
          },
        },
        ...report.outputs.tables.map((table) => {
        const used = usedTables.has(table.datasetId);
        return {
          id: table.datasetId,
          title: table.name,
          hint: `${table.rowCount.toLocaleString()} rows, ${table.columnCount} columns`,
          sketch: "table" as const,
          badge: used ? "added" : table.output ? "output" : "input",
          disabled: used,
          onSelect: () => addBlock(tableBlockOf(table)),
        };
        }),
      ],
    },
  ];

  const reset = async () => {
    try {
      const result = await postJson<ReportResponse>(`${key}/reset`, {}, "POST");
      await mutate(result, { revalidate: false });
      setDraft(null);
      toast.success("Report reset to the current outputs");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reset the report");
    }
  };

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              value={working?.title ?? report.title}
              onChange={(event) => patchDraft((current) => ({ ...current, title: event.target.value }))}
              className="max-w-xl text-lg font-semibold"
              aria-label="Report title"
            />
          ) : (
            <h2 className="text-2xl font-semibold tracking-tight">{report.title}</h2>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            {report.draft
              ? "A draft assembled from every output of this report; nothing is saved until you edit the page."
              : `Saved report, last changed ${formatDateTime(report.updatedAt)}.`}{" "}
            Figures and tables follow the latest run of their analysis.
          </p>
        </div>
        {editing ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setStoreOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add block
              </Button>
              <ElementStore
                open={storeOpen}
                onOpenChange={setStoreOpen}
                title="Add to the report"
                description="Build a block from a table, or place a figure or table an analysis produced."
                groups={storeGroups}
              />
              <Button variant="outline" size="sm" onClick={undo} disabled={history.length === 0 && !dirty} title="Take back the last change">
                <Undo2 className="mr-2 h-4 w-4" />
                Undo
              </Button>
              <span className="min-w-16 text-xs text-muted-foreground" aria-live="polite">
                {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Not saved" : ""}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {canEdit && !report.draft && (
                <Button variant="ghost" size="sm" onClick={() => void reset()} title="Forget the saved page and start again from the current outputs">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Start over
                </Button>
              )}
              <SharePopover reportId={reportId} share={report.share} canEdit={canEdit} filters={filters} active={active} onChanged={() => mutate()} />
            </div>
          )}
      </div>

      <FilterBar filters={filters} tables={report.outputs.tables} active={active} onActiveChange={setActive} editing={editing} onFiltersChange={editing ? setFilters : undefined} />

      {!editing && headings.length > 1 && (
        <nav className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Contents">
          {headings.map((heading) => (
            <a key={heading.id} href={`#${heading.id}`} className="hover:text-foreground hover:underline">
              {heading.title}
            </a>
          ))}
        </nav>
      )}

      {!hasOutputs && !editing && (
        <div className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>Nothing to report yet. Outputs are made on the canvas: connect a dataset to an analysis and run it, and its figures and tables land here.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={onOpenCanvas}>
            <LayoutGrid className="mr-2 h-4 w-4" />
            Open the canvas
          </Button>
        </div>
      )}

      {(hasOutputs || editing) && (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {blocks.map((block, index) => (
            <ReportBlockCard
              key={block.id}
              block={block}
              resolved={resolvedById.get(block.id)}
              figure={block.type === "figure" ? (figureByKey.get(figureKey(block.analysisId, block.figureName)) ?? null) : null}
              tableInfo={block.type === "table" ? (tableById.get(block.datasetId) ?? null) : null}
              editing={editing}
              first={index === 0}
              last={index === blocks.length - 1}
              onPatch={(patch) => patchBlock(block.id, patch)}
              onMove={(delta) => moveBlock(block.id, delta)}
              onRemove={() => removeBlock(block.id)}
              scopeQuery={scopeQuery} reportId={reportId}
              scope={scope}
              tables={report.outputs.tables}
              analyses={report.outputs.analyses}
              analysis={block.type === "run-metric" ? (analysisById.get(block.analysisId) ?? null) : null}
              filters={filters}
              active={active}
            />
          ))}
          {editing && blocks.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground md:col-span-2">The page is empty. Add a text block, a figure or a table.</div>
          )}
        </div>
      )}
    </div>
  );
}

interface ReportBlockCardProps {
  block: ReportBlock;
  resolved: ResolvedReportBlock | undefined;
  figure: ReportFigure | null;
  tableInfo: ReportTable | null;
  editing: boolean;
  first: boolean;
  last: boolean;
  onPatch: (patch: Partial<ReportBlock>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
  scopeQuery: string;
  reportId: string;
  tables: ReportTable[];
  analyses: ReportAnalysis[];
  analysis: ReportAnalysis | null;
  filters: ReportFilter[];
  active: ActiveFilters;
  /** The scope, for blocks that read scope-level data such as the curation lists. */
  scope: string;
}

const BLOCK_LABELS: Record<ReportBlock["type"], string> = { text: "Text", figure: "Figure", table: "Table", chart: "Chart", metric: "Numbers", view: "View", "taxon-explorer": "Taxon explorer", subject: "Subject", curated: "Organisms of interest", "run-metric": "Run numbers" };

function ReportBlockCard({ block, resolved, figure, tableInfo, editing, first, last, onPatch, onMove, onRemove, scopeQuery, reportId, tables, analyses, analysis, filters, active, scope }: ReportBlockCardProps) {
  const span = block.span ?? (block.type === "figure" || block.type === "chart" || block.type === "metric" ? 1 : 2);
  const label = BLOCK_LABELS[block.type];
  const blockTable = "datasetId" in block ? (tables.find((table) => table.datasetId === block.datasetId) ?? null) : null;
  const narrowed = filtersApply(blockTable, filters, active);
  const actions = (
    <>
      <button type="button" className="rounded p-1 hover:bg-muted hover:text-foreground" onClick={() => onPatch({ span: span === 2 ? 1 : 2 })} title={span === 2 ? "Make half width" : "Make full width"} aria-label={span === 2 ? "Make half width" : "Make full width"}>
        {span === 2 ? <RectangleHorizontal className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
      </button>
      <button type="button" className="rounded p-1 hover:bg-muted hover:text-foreground disabled:opacity-40" onClick={() => onMove(-1)} disabled={first} title="Move up" aria-label="Move up">
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
      <button type="button" className="rounded p-1 hover:bg-muted hover:text-foreground disabled:opacity-40" onClick={() => onMove(1)} disabled={last} title="Move down" aria-label="Move down">
        <ArrowDown className="h-3.5 w-3.5" />
      </button>
      <button type="button" className="rounded p-1 hover:bg-muted hover:text-destructive" onClick={onRemove} title="Remove block" aria-label="Remove block">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </>
  );
  // A text block being edited is one box: the formatting bar is its header, with the block actions at its end.
  if (editing && block.type === "text") {
    return (
      <section id={block.id} className={cn("min-w-0 scroll-mt-4 rounded-lg border bg-card", span === 2 && "md:col-span-2")} aria-label={`${label} block`}>
        <RichTextEditor value={block.markdown} onChange={(markdown) => onPatch({ markdown })} actions={actions} className="border-0" />
      </section>
    );
  }
  return (
    <section id={block.id} className={cn("min-w-0 scroll-mt-4 rounded-lg border bg-card", span === 2 && "md:col-span-2")} aria-label={`${label} block`}>
      {editing && (
        <div className="flex items-center gap-1 border-b bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
          <span className="font-medium">{label}</span>
          <span className="flex-1" />
          {actions}
        </div>
      )}
      <div className="p-4">
        {block.type === "text" &&
          (block.markdown.trim() ? (
            <Markdown>{block.markdown}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">Empty text block.</p>
          ))}

        {block.type === "figure" && (
          <>
            <Caption editing={editing} value={block.caption ?? ""} fallback={block.figureName} onChange={(caption) => onPatch({ caption })} />
            {figure ? (
              <>
                {Object.values(active).some((values) => values.length > 0) && (
                  <p className="mb-1 text-[11px] text-muted-foreground">Drawn by the analysis run; page filters do not change it.</p>
                )}
                <FigureContent figure={figure} scopeQuery={scopeQuery} reportId={reportId} />
              </>
            ) : (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">This figure is not produced by the analysis any more.</div>
            )}
          </>
        )}

        {block.type === "chart" && (
          <>
            <Caption editing={editing} value={block.caption ?? ""} fallback={chartTitle(block, tables)} onChange={(caption) => onPatch({ caption })} />
            {editing && <ChartControls block={block} tables={tables} onPatch={onPatch} />}
            <ChartBlockView block={block} table={blockTable} filters={filters} active={active} />
          </>
        )}

        {block.type === "view" && (
          <>
            <Caption editing={editing} value={block.caption ?? ""} fallback={viewTitle(block, tables)} onChange={(caption) => onPatch({ caption })} />
            {editing && <ViewControls block={block} tables={tables} onPatch={onPatch} />}
            <ViewBlockView block={block} table={blockTable} scopeQuery={scopeQuery} reportId={reportId} filters={filters} active={active} />
          </>
        )}

        {block.type === "taxon-explorer" && (
          <>
            <Caption editing={editing} value={block.caption ?? ""} fallback={`Taxon explorer${blockTable ? `: ${blockTable.name}` : ""}`} onChange={(caption) => onPatch({ caption })} />
            {editing && <TableOnlyControls value={block.datasetId} tables={tables.filter((table) => table.roles.sample && table.roles.taxon && table.roles.count)} onChange={(datasetId) => onPatch({ datasetId, taxon: undefined } as Partial<ReportBlock>)} />}
            {blockTable ? (
              <TaxonExplorerView table={blockTable} taxon={block.taxon ?? null} onPickTaxon={(taxon) => onPatch({ taxon } as Partial<ReportBlock>)} filters={filters} active={active} editing={editing} />
            ) : (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Choose a table of this scope.</div>
            )}
          </>
        )}

        {block.type === "subject" && (
          <>
            <Caption editing={editing} value={block.caption ?? ""} fallback={`Subject${blockTable ? `: ${blockTable.name}` : ""}`} onChange={(caption) => onPatch({ caption })} />
            {editing && (
              <div className="mb-3 grid gap-2 border-b pb-3 sm:grid-cols-2">
                <label className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
                  <span>Table</span>
                  <TableSelect value={block.datasetId} tables={tables.filter((table) => table.views.includes("subject-timeline"))} onChange={(datasetId) => onPatch({ datasetId, subject: undefined } as Partial<ReportBlock>)} />
                </label>
                <label className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
                  <span>Measure</span>
                  <Select value={block.measure ?? "ra"} onValueChange={(measure) => onPatch({ measure } as Partial<ReportBlock>)}>
                    <SelectTrigger className="h-8 w-full min-w-0 text-xs [&>span]:truncate" aria-label="Measure"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ra">Relative abundance</SelectItem>
                      <SelectItem value="reads">Reads</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>
            )}
            {blockTable ? (
              <SubjectView table={blockTable} subject={block.subject ?? null} measure={block.measure ?? "ra"} onPickSubject={(subject) => onPatch({ subject } as Partial<ReportBlock>)} filters={filters} active={active} editing={editing} />
            ) : (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Choose a table of this scope.</div>
            )}
          </>
        )}

        {block.type === "curated" && (
          <>
            <Caption editing={editing} value={block.caption ?? ""} fallback={`Organisms of interest${blockTable ? `: ${blockTable.name}` : ""}`} onChange={(caption) => onPatch({ caption })} />
            {editing && <CuratedControls block={block} tables={tables.filter(profileTable)} onPatch={onPatch} />}
            {blockTable ? (
              <CuratedOrganismsView table={blockTable} scope={scope} role={block.role ?? "pathogen"} lists={block.lists} limit={block.limit ?? 25} filters={filters} active={active} />
            ) : (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Choose a table of this scope.</div>
            )}
          </>
        )}

        {block.type === "run-metric" && (
          <>
            <Caption editing={editing} value={block.label ?? ""} fallback={analysis ? `${analysis.name} in numbers` : "Run numbers"} onChange={(label) => onPatch({ label } as Partial<ReportBlock>)} />
            {editing && <RunMetricControls block={block} analyses={analyses} onPatch={onPatch} />}
            <RunMetricView analysis={analysis} metrics={block.metrics} />
          </>
        )}

        {block.type === "metric" && (
          <>
            <Caption editing={editing} value={block.label ?? ""} fallback={metricTitle(block, tables)} onChange={(label) => onPatch({ label })} />
            {editing && <MetricControls block={block} tables={tables} onPatch={onPatch} />}
            <MetricBlockView block={block} table={blockTable} filters={filters} active={active} />
          </>
        )}

        {block.type === "table" && (
          <>
            <Caption editing={editing} value={block.caption ?? ""} fallback={tableInfo?.name ?? "Table"} onChange={(caption) => onPatch({ caption })} />
            {narrowed && blockTable ? (
              <FilteredTableContent table={blockTable} rows={block.rows ?? 12} filters={filters} active={active} scopeQuery={scopeQuery} reportId={reportId} />
            ) : resolved && resolved.type === "table" && resolved.table ? (
              <TableContent table={resolved.table} scopeQuery={scopeQuery} reportId={reportId} />
            ) : tableInfo ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                {tableInfo.name}: {tableInfo.rowCount.toLocaleString()} rows × {tableInfo.columnCount} columns. The rows appear once the report is saved.
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">This table is not available in this scope any more.</div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Caption({ editing, value, fallback, onChange }: { editing: boolean; value: string; fallback: string; onChange: (value: string) => void }) {
  if (editing) {
    return (
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={fallback}
        className="mb-3 h-9 border-transparent bg-transparent px-1 text-base font-semibold shadow-none hover:border-input focus-visible:border-input"
        aria-label="Caption"
      />
    );
  }
  return <h3 className="mb-3 text-sm font-semibold">{value || fallback}</h3>;
}

function InteractiveFigure({ url }: { url: string }) {
  const { data, error } = useSWR<{ data?: unknown[]; layout?: Record<string, unknown> }>(url, fetcher);
  if (error) return <p className="text-sm text-destructive">Could not load the figure.</p>;
  if (!data) return <Skeleton className="h-72 w-full" />;
  return <PlotlyChart data={Array.isArray(data.data) ? data.data : []} layout={{ ...(data.layout ?? {}), autosize: true }} height={380} className="w-full" />;
}

function FigureContent({ figure, scopeQuery, reportId }: { figure: ReportFigure; scopeQuery: string; reportId: string }) {
  const image = figure.thumbnailUrl ?? (figure.format === "png" || figure.format === "svg" ? figure.url : null);
  return (
    <figure>
      {figure.format === "plotly-json" ? (
        <InteractiveFigure url={figure.url} />
      ) : image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt={figure.figureName} className="mx-auto max-h-[480px] max-w-full object-contain" />
      ) : (
        <a href={figure.url} className="text-sm underline" target="_blank" rel="noreferrer">
          Open figure
        </a>
      )}
      <figcaption className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>{figure.analysisName}</span>
        <span>{figure.runNumber}</span>
        {figure.unchanged && <span>unchanged since the previous run</span>}
        <span className="flex-1" />
        <Link href={`/explore/reports/${encodeURIComponent(reportId)}${scopeQuery}&mode=edit&view=canvas&focus=${encodeURIComponent(`figure:${figure.analysisId}:${figure.figureName}`)}`} className="inline-flex items-center gap-1 hover:underline" title="Open the canvas at the card that draws this figure">
          <LayoutGrid className="h-3 w-3" /> Show on canvas
        </Link>
        <Link href={`/explore/runs/${figure.runId}${scopeQuery}`} className="inline-flex items-center gap-1 hover:underline">
          Run <ExternalLink className="h-3 w-3" />
        </Link>
      </figcaption>
    </figure>
  );
}

function TableContent({ table, scopeQuery, reportId, note }: { table: ReportTableContent; scopeQuery: string;
  reportId: string; note?: string }) {
  return (
    <div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-left">
            <tr>
              {table.columns.map((column) => (
                <th key={column.key} className="whitespace-nowrap px-2 py-1.5 font-medium" title={column.key}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index} className="border-t">
                {table.columns.map((column) => (
                  <td key={column.key} className={cn("whitespace-nowrap px-2 py-1", column.type === "number" && "text-right tabular-nums")}>
                    {formatCell(row[column.key])}
                  </td>
                ))}
              </tr>
            ))}
            {table.rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-muted-foreground" colSpan={Math.max(1, table.columns.length)}>
                  No rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          {note ?? `${Math.min(table.rows.length, table.rowCount).toLocaleString()} of ${table.rowCount.toLocaleString()} rows, ${table.columnCount} columns${table.version ? `, v${table.version}` : ""}`}
        </span>
        <span className="flex-1" />
        <Link href={`/explore/reports/${encodeURIComponent(reportId)}${scopeQuery}&mode=edit&view=canvas&focus=${encodeURIComponent(`dataset:${table.datasetId}`)}`} className="inline-flex items-center gap-1 hover:underline" title="Open the canvas at this table's card">
          <LayoutGrid className="h-3 w-3" /> Show on canvas
        </Link>
        <Link href={`/explore/datasets/${table.datasetId}${scopeQuery}`} className="inline-flex items-center gap-1 hover:underline">
          Open table <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts and numbers drawn straight from a table; no analysis needed.
// ---------------------------------------------------------------------------

type ChartBlock = Extract<ReportBlock, { type: "chart" }>;
type MetricBlock = Extract<ReportBlock, { type: "metric" }>;

function firstTable(tables: ReportTable[]): ReportTable | undefined {
  return tables.find((table) => table.output && table.columns.length > 0) ?? tables.find((table) => table.columns.length > 0) ?? tables[0];
}

function defaultChartBlock(tables: ReportTable[]): ReportBlock {
  const table = firstTable(tables);
  const numeric = table ? numericColumns(table.columns) : [];
  const x = numeric[0]?.key ?? table?.columns[0]?.key ?? "";
  return { id: newBlockId("chart"), type: "chart", datasetId: table?.datasetId ?? "", chart: numeric.length > 0 ? "histogram" : "bar", x, span: 1 };
}

function defaultMetricBlock(tables: ReportTable[]): ReportBlock {
  const table = firstTable(tables);
  const numeric = table ? numericColumns(table.columns) : [];
  const column = numeric[0]?.key ?? table?.columns[0]?.key ?? "";
  return { id: newBlockId("metric"), type: "metric", datasetId: table?.datasetId ?? "", column, stats: numeric.length > 0 ? ["count", "mean", "min", "max"] : ["count", "distinct", "missing"], span: 1 };
}

function columnLabel(columns: ExploreColumn[], key: string | undefined): string {
  if (!key) return "";
  return columns.find((column) => column.key === key)?.label ?? key;
}

function chartTitle(block: ChartBlock, tables: ReportTable[]): string {
  const table = tables.find((entry) => entry.datasetId === block.datasetId);
  const columns = table?.columns ?? [];
  const kind = CHART_KIND_LABELS[block.chart].label;
  if (block.chart === "scatter") return `${columnLabel(columns, block.y)} by ${columnLabel(columns, block.x)}`;
  if (block.chart === "box") return `${columnLabel(columns, block.y)} per ${columnLabel(columns, block.x)}`;
  return `${kind} of ${columnLabel(columns, block.x)}`;
}

function metricTitle(block: MetricBlock, tables: ReportTable[]): string {
  const table = tables.find((entry) => entry.datasetId === block.datasetId);
  return `${columnLabel(table?.columns ?? [], block.column)}${table ? ` (${table.name})` : ""}`;
}

function TableOnlyControls({ value, tables, onChange }: { value: string; tables: ReportTable[]; onChange: (datasetId: string) => void }) {
  return (
    <div className="mb-3 grid gap-2 border-b pb-3 sm:grid-cols-2">
      <label className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
        <span>Table</span>
        <TableSelect value={value} tables={tables} onChange={onChange} />
      </label>
    </div>
  );
}

function CuratedControls({ block, tables, onPatch }: { block: Extract<ReportBlock, { type: "curated" }>; tables: ReportTable[]; onPatch: (patch: Partial<ReportBlock>) => void }) {
  return (
    <div className="mb-3 grid gap-2 border-b pb-3 sm:grid-cols-3">
      <label className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
        <span>Table</span>
        <TableSelect value={block.datasetId} tables={tables} onChange={(datasetId) => onPatch({ datasetId } as Partial<ReportBlock>)} />
      </label>
      <label className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
        <span>Lists</span>
        <Select value={block.role ?? "pathogen"} onValueChange={(role) => onPatch({ role } as Partial<ReportBlock>)}>
          <SelectTrigger className="h-8 w-full min-w-0 text-xs [&>span]:truncate" aria-label="Lists"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pathogen">Pathogen lists</SelectItem>
            <SelectItem value="flora">Flora lists</SelectItem>
            <SelectItem value="all">Every list</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
        <span>Show at most</span>
        <Select value={String(block.limit ?? 25)} onValueChange={(limit) => onPatch({ limit: Number(limit) } as Partial<ReportBlock>)}>
          <SelectTrigger className="h-8 w-full min-w-0 text-xs [&>span]:truncate" aria-label="Show at most"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[10, 25, 50, 100].map((entry) => (
              <SelectItem key={entry} value={String(entry)}>{entry} organisms</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}

function RunMetricControls({ block, analyses, onPatch }: { block: Extract<ReportBlock, { type: "run-metric" }>; analyses: ReportAnalysis[]; onPatch: (patch: Partial<ReportBlock>) => void }) {
  const analysis = analyses.find((entry) => entry.analysisId === block.analysisId);
  const keys = analysis ? Object.keys(analysis.metrics) : [];
  const toggle = (key: string) => {
    const next = block.metrics.includes(key) ? block.metrics.filter((entry) => entry !== key) : [...block.metrics, key].slice(-4);
    if (next.length > 0) onPatch({ metrics: next } as Partial<ReportBlock>);
  };
  return (
    <div className="mb-3 space-y-2 border-b pb-3">
      <label className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
        <span>Analysis</span>
        <Select value={block.analysisId} onValueChange={(analysisId) => { const target = analyses.find((entry) => entry.analysisId === analysisId); onPatch({ analysisId, metrics: Object.keys(target?.metrics ?? {}).slice(0, 4) } as Partial<ReportBlock>); }}>
          <SelectTrigger className="h-8 w-full min-w-0 text-xs [&>span]:truncate" aria-label="Analysis"><SelectValue placeholder="Choose an analysis" /></SelectTrigger>
          <SelectContent>
            {analyses.filter((entry) => Object.keys(entry.metrics).length > 0).map((entry) => (
              <SelectItem key={entry.analysisId} value={entry.analysisId}>{entry.name}<span className="ml-1.5 text-xs text-muted-foreground">{entry.runNumber}</span></SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Numbers to show">
        {keys.map((key) => (
          <button key={key} type="button" onClick={() => toggle(key)} aria-pressed={block.metrics.includes(key)} className={cn("rounded-full border px-2 py-0.5 text-[11px]", block.metrics.includes(key) ? "border-transparent bg-secondary font-medium" : "text-muted-foreground hover:bg-muted")} title={String(analysis?.metrics[key])}>
            {key}
          </button>
        ))}
        <span className="self-center text-[10px] text-muted-foreground">up to four</span>
      </div>
    </div>
  );
}

/** The whole table for a block, with the page filters that apply to it already removed. */
function useFilteredTable(table: ReportTable | null, filters: ReportFilter[], active: ActiveFilters) {
  const { data, error } = useTableFrame(table ? table.datasetId : null);
  const rows = useMemo(() => (data ? filteredRows(data, filters, active) : []), [data, filters, active]);
  return { frame: data, rows, error };
}

/** A table block while page filters narrow it: the first rows that pass, from the whole table. */
function FilteredTableContent({ table, rows, filters, active, scopeQuery, reportId }: { table: ReportTable; rows: number; filters: ReportFilter[]; active: ActiveFilters; scopeQuery: string; reportId: string }) {
  const { frame, rows: kept, error } = useFilteredTable(table, filters, active);
  if (error) return <p className="text-sm text-destructive">Could not load the rows.</p>;
  if (!frame) return <Skeleton className="h-40 w-full" />;
  return (
    <TableContent
      table={{ datasetId: table.datasetId, name: table.name, version: frame.version, columns: frame.columns, rows: kept.slice(0, rows), rowCount: kept.length, columnCount: frame.columns.length }}
      scopeQuery={scopeQuery} reportId={reportId}
      note={`${kept.length.toLocaleString()} of ${frame.total.toLocaleString()} rows pass the page filters`}
    />
  );
}

function TableSelect({ value, tables, onChange }: { value: string; tables: ReportTable[]; onChange: (datasetId: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-full min-w-0 text-xs [&>span]:truncate" aria-label="Table">
        <SelectValue placeholder="Choose a table" />
      </SelectTrigger>
      <SelectContent>
        {tables.map((table) => (
          <SelectItem key={table.datasetId} value={table.datasetId}>
            {table.name}
            <span className="ml-1.5 text-xs text-muted-foreground">{table.output ? "output" : "input"}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ColumnSelect({ value, columns, onChange, label, allowNone, numericFirst }: { value: string; columns: ExploreColumn[]; onChange: (key: string) => void; label: string; allowNone?: boolean; numericFirst?: boolean }) {
  const ordered = numericFirst ? [...numericColumns(columns), ...columns.filter((column) => column.type !== "number")] : columns;
  return (
    <Select value={value || (allowNone ? "__none__" : undefined)} onValueChange={(next) => onChange(next === "__none__" ? "" : next)}>
      <SelectTrigger className="h-8 w-full min-w-0 text-xs [&>span]:truncate" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value="__none__">None</SelectItem>}
        {ordered.map((column) => (
          <SelectItem key={column.key} value={column.key}>
            {column.label}
            <span className="ml-1.5 text-xs text-muted-foreground">{column.type}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ChartControls({ block, tables, onPatch }: { block: ChartBlock; tables: ReportTable[]; onPatch: (patch: Partial<ReportBlock>) => void }) {
  const columns = tables.find((table) => table.datasetId === block.datasetId)?.columns ?? [];
  const needsY = CHART_KIND_LABELS[block.chart].needsY;
  const patch = (values: Partial<ChartBlock>) => onPatch(values as Partial<ReportBlock>);
  return (
    <div className="mb-3 grid gap-2 border-b pb-3 sm:grid-cols-2">
      <label className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
        <span>Table</span>
        <TableSelect value={block.datasetId} tables={tables} onChange={(datasetId) => patch({ datasetId, x: "", y: undefined, color: undefined })} />
      </label>
      <label className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
        <span>Chart</span>
        <Select value={block.chart} onValueChange={(chart) => patch({ chart: chart as ChartKind })}>
          <SelectTrigger className="h-8 w-full min-w-0 text-xs [&>span]:truncate" aria-label="Chart type"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CHART_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {CHART_KIND_LABELS[kind].label}
                <span className="ml-1.5 text-xs text-muted-foreground">{CHART_KIND_LABELS[kind].description}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
        <span>{block.chart === "box" ? "Groups (x axis)" : block.chart === "scatter" ? "X axis" : "Column"}</span>
        <ColumnSelect value={block.x} columns={columns} onChange={(x) => patch({ x })} label="Column" numericFirst={block.chart !== "box" && block.chart !== "bar"} />
      </label>
      {needsY && (
        <label className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
          <span>{block.chart === "box" ? "Values (numeric)" : "Y axis (numeric)"}</span>
          <ColumnSelect value={block.y ?? ""} columns={numericColumns(columns)} onChange={(y) => patch({ y })} label="Numeric column" />
        </label>
      )}
      {block.chart !== "box" && (
        <label className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
          <span>Colour by</span>
          <ColumnSelect value={block.color ?? ""} columns={columns.filter((column) => column.type !== "number")} onChange={(color) => patch({ color: color || undefined })} label="Colour" allowNone />
        </label>
      )}
    </div>
  );
}

function ChartBlockView({ block, table, filters, active }: { block: ChartBlock; table: ReportTable | null; filters: ReportFilter[]; active: ActiveFilters }) {
  const { frame, rows, error } = useFilteredTable(table && block.x ? table : null, filters, active);
  if (!table) return <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Choose a table of this scope.</div>;
  if (!block.x) return <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Choose a column.</div>;
  if (error) return <p className="text-sm text-destructive">Could not load the rows.</p>;
  if (!frame) return <Skeleton className="h-64 w-full" />;
  const narrowed = filtersApply(table, filters, active);
  const result = buildChart(rows, table.columns, { chart: block.chart, x: block.x, y: block.y, color: block.color }, frame.truncated ? frame.total : undefined);
  return (
    <div>
      {result.data.length > 0 ? (
        <PlotlyChart data={result.data} layout={result.layout} height={300} className="w-full" />
      ) : (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{result.notes[0] ?? "Nothing to draw yet."}</div>
      )}
      {result.data.length > 0 && result.notes.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">{result.notes.join(" ")}</p>}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {table.name}
        {narrowed ? `, ${rows.length.toLocaleString()} rows after page filters` : ""}
      </p>
    </div>
  );
}

function MetricControls({ block, tables, onPatch }: { block: MetricBlock; tables: ReportTable[]; onPatch: (patch: Partial<ReportBlock>) => void }) {
  const columns = tables.find((table) => table.datasetId === block.datasetId)?.columns ?? [];
  const patch = (values: Partial<MetricBlock>) => onPatch(values as Partial<ReportBlock>);
  const toggle = (stat: MetricStat) => {
    const next = block.stats.includes(stat) ? block.stats.filter((entry) => entry !== stat) : [...block.stats, stat].slice(-4);
    if (next.length > 0) patch({ stats: next });
  };
  return (
    <div className="mb-3 space-y-2 border-b pb-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
          <span>Table</span>
          <TableSelect value={block.datasetId} tables={tables} onChange={(datasetId) => patch({ datasetId, column: "" })} />
        </label>
        <label className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
          <span>Column</span>
          <ColumnSelect value={block.column} columns={columns} onChange={(column) => patch({ column })} label="Column" numericFirst />
        </label>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Numbers to show">
        {METRIC_STATS.map((stat) => (
          <button
            key={stat}
            type="button"
            onClick={() => toggle(stat)}
            aria-pressed={block.stats.includes(stat)}
            className={cn("rounded-full border px-2 py-0.5 text-[11px]", block.stats.includes(stat) ? "border-transparent bg-secondary font-medium" : "text-muted-foreground hover:bg-muted")}
          >
            {METRIC_STAT_LABELS[stat]}
          </button>
        ))}
        <span className="self-center text-[10px] text-muted-foreground">up to four</span>
      </div>
    </div>
  );
}

function MetricBlockView({ block, table, filters, active }: { block: MetricBlock; table: ReportTable | null; filters: ReportFilter[]; active: ActiveFilters }) {
  const { frame, rows, error } = useFilteredTable(table && block.column ? table : null, filters, active);
  if (!table) return <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Choose a table of this scope.</div>;
  if (!block.column) return <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Choose a column.</div>;
  if (error) return <p className="text-sm text-destructive">Could not load the rows.</p>;
  if (!frame) return <Skeleton className="h-20 w-full" />;
  const narrowed = filtersApply(table, filters, active);
  const stats = computeStats(rows, block.column);
  return (
    <div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(4, block.stats.length)}, minmax(0, 1fr))` }}>
        {block.stats.map((stat) => (
          <div key={stat} className="rounded-md border bg-muted/20 px-3 py-2">
            <div className="text-xl font-semibold tabular-nums">{formatStat(stats[stat])}</div>
            <div className="text-[11px] text-muted-foreground">{METRIC_STAT_LABELS[stat]}</div>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {table.name}
        {frame.truncated ? `, first ${frame.rows.length.toLocaleString()} of ${frame.total.toLocaleString()} rows` : ""}
        {narrowed ? `, ${rows.length.toLocaleString()} rows after page filters` : ""}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Built-in views: the subject timeline and the heatmap, drawn from a table.
// ---------------------------------------------------------------------------

type ViewBlock = Extract<ReportBlock, { type: "view" }>;

function viewTitle(block: ViewBlock, tables: ReportTable[]): string {
  const table = tables.find((entry) => entry.datasetId === block.datasetId);
  return `${BUILT_IN_VIEWS[block.view].label}${table ? ` of ${table.name}` : ""}`;
}

function ViewControls({ block, tables, onPatch }: { block: ViewBlock; tables: ReportTable[]; onPatch: (patch: Partial<ReportBlock>) => void }) {
  const candidates = tables.filter((table) => table.views.length > 0);
  const patch = (values: Partial<ViewBlock>) => onPatch(values as Partial<ReportBlock>);
  const options = block.options ?? {};
  const setOption = (key: string, value: string | number) => patch({ options: { ...options, [key]: value } });
  return (
    <div className="mb-3 grid gap-2 border-b pb-3 sm:grid-cols-2">
      {block.view === "heatmap" && (
        <>
          <label className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
            <span>Values</span>
            <Select value={String(options.value ?? "log10_ra")} onValueChange={(value) => setOption("value", value)}>
              <SelectTrigger className="h-8 w-full min-w-0 text-xs [&>span]:truncate" aria-label="Heatmap values"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="log10_ra">log10 abundance</SelectItem>
                <SelectItem value="ra">Relative abundance</SelectItem>
                <SelectItem value="reads">Reads</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
            <span>Taxa and order</span>
            <div className="flex gap-1">
              <Select value={String(options.nTaxa ?? 35)} onValueChange={(value) => setOption("nTaxa", Number(value))}>
                <SelectTrigger className="h-8 w-full min-w-0 text-xs [&>span]:truncate" aria-label="Number of taxa"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["20", "35", "50", "80", "120"].map((entry) => <SelectItem key={entry} value={entry}>{entry} taxa</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={String(options.order ?? "prevalence")} onValueChange={(value) => setOption("order", value)}>
                <SelectTrigger className="h-8 w-full min-w-0 text-xs [&>span]:truncate" aria-label="Taxon order"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="prevalence">by prevalence</SelectItem>
                  <SelectItem value="abundance">by abundance</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </label>
        </>
      )}
      <label className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
        <span>Table</span>
        <TableSelect value={block.datasetId} tables={candidates} onChange={(datasetId) => patch({ datasetId })} />
      </label>
      <label className="min-w-0 space-y-1 text-[11px] text-muted-foreground">
        <span>View</span>
        <Select value={block.view} onValueChange={(view) => patch({ view: view as BuiltInView })}>
          <SelectTrigger className="h-8 w-full min-w-0 text-xs [&>span]:truncate" aria-label="View"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.entries(BUILT_IN_VIEWS) as Array<[BuiltInView, { label: string; description: string }]>).map(([id, meta]) => (
              <SelectItem key={id} value={id} title={meta.description}>
                {meta.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}

function ViewBlockView({ block, table, scopeQuery, reportId, filters, active }: { block: ViewBlock; table: ReportTable | null; scopeQuery: string;
  reportId: string; filters: ReportFilter[]; active: ActiveFilters }) {
  if (!table) return <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Choose a table of this scope.</div>;
  if (!table.views.includes(block.view)) {
    return <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{table.name} lacks the roles this view needs (sample, subject, timepoint, taxon and count).</div>;
  }
  // A page filter on the table's group column narrows the heatmap to that group.
  const groupFilter = filters.find((filter) => filter.datasetId === table.datasetId && filter.column === table.roles.group && (active[filter.id]?.length ?? 0) > 0);
  const options = block.options ?? {};
  const heatmapOptions: HeatmapOptions = {
    group: groupFilter ? active[groupFilter.id][0] : null,
    value: (options.value as HeatmapOptions["value"]) ?? "log10_ra",
    order: (options.order as HeatmapOptions["order"]) ?? "prevalence",
    nTaxa: typeof options.nTaxa === "number" ? options.nTaxa : 35,
  };
  return (
    <div>
      {block.view === "heatmap" ? (
        <HeatmapView datasetId={block.datasetId} height={420} options={heatmapOptions} />
      ) : (
        <div className="max-h-[420px] overflow-y-auto rounded-md border">
          <SubjectTimelineOverview datasetId={block.datasetId} />
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>
          {table.name}
          {block.view === "heatmap" && groupFilter ? `, ${frameColumnLabel(table.columns, groupFilter.column)}: ${heatmapOptions.group}` : ""}
          {block.view !== "heatmap" && filtersApply(table, filters, active) ? ", page filters do not apply to this view" : ""}
        </span>
        <span className="flex-1" />
        <Link href={`/explore/reports/${encodeURIComponent(reportId)}${scopeQuery}&mode=edit&view=canvas&focus=${encodeURIComponent(`view:${block.datasetId}:${block.view}`)}`} className="inline-flex items-center gap-1 hover:underline">
          <LayoutGrid className="h-3 w-3" /> Show on canvas
        </Link>
        <Link href={`/explore/datasets/${block.datasetId}/${block.view}${scopeQuery}`} className="inline-flex items-center gap-1 hover:underline">
          Open <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

/**
 * The way out of the app: a link that opens the live page for anyone who has
 * it, carrying the page filters as set. (A downloadable HTML file was tried
 * and set aside until sharing has proper access control.)
 */
function SharePopover({ reportId, share, canEdit, filters, active, onChanged }: { reportId: string; share: ReportShare | null; canEdit: boolean; filters: ReportFilter[]; active: ActiveFilters; onChanged: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const query = new URLSearchParams();
  for (const filter of filters) for (const value of active[filter.id] ?? []) query.append(`f.${filter.id}`, value);
  const hasActive = query.size > 0;
  const sharePath = share ? `/share/reports/${share.token}${hasActive ? `?${query.toString()}` : ""}` : null;
  const shareUrl = () => `${window.location.origin}${sharePath ?? ""}`;
  const create = async () => {
    setBusy(true);
    try {
      await postJson(`/api/explore/reports/${encodeURIComponent(reportId)}/share`, {});
      await onChanged();
      toast.success("Share link created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the link");
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    setBusy(true);
    try {
      await postJson(`/api/explore/reports/${encodeURIComponent(reportId)}/share`, undefined, "DELETE");
      await onChanged();
      toast.success("Sharing stopped; the old link no longer works");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not stop sharing");
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy; select the link and copy it by hand");
    }
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Share2 className="mr-2 h-4 w-4" />
          Share
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0 text-sm" onOpenAutoFocus={(event) => event.preventDefault()}>
        <div className="flex items-center gap-2.5 border-b px-4 py-3">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", share ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
            <Globe className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-tight">Share by link</p>
            <p className="text-xs text-muted-foreground">{share ? "Anyone with the link can read it" : "Not shared"}</p>
          </div>
          {share && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Live
            </span>
          )}
        </div>
        <div className="px-4 py-3">
          {share ? (
            <>
              <div className="flex items-center gap-1.5">
                <Input readOnly value={sharePath ?? ""} title={sharePath ?? undefined} onClick={(event) => event.currentTarget.select()} className="h-9 flex-1 truncate font-mono text-xs" />
                <Button size="sm" variant={copied ? "outline" : "default"} className="h-9 shrink-0" onClick={() => void copy()}>
                  {copied ? <Check className="mr-1.5 h-4 w-4 text-emerald-600" /> : <Copy className="mr-1.5 h-4 w-4" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
                No sign-in needed{hasActive ? "; the current filters are carried in the link" : ""}. Shared since {formatDateTime(share.publishedAt)}.
              </p>
              {canEdit && (
                <div className="mt-3 flex justify-end border-t pt-3">
                  <Button size="sm" variant="ghost" className="h-8 text-muted-foreground hover:text-destructive" onClick={() => void stop()} disabled={busy}>
                    {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Unlink className="mr-1.5 h-3.5 w-3.5" />}
                    Stop sharing
                  </Button>
                </div>
              )}
            </>
          ) : canEdit ? (
            <>
              <p className="text-xs leading-relaxed text-muted-foreground">Create a link that opens the live page without signing in. Anyone with the link can read it; you can stop sharing at any time.</p>
              <Button size="sm" className="mt-3 w-full" onClick={() => void create()} disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Share2 className="mr-2 h-4 w-4" />}
                Create share link
              </Button>
            </>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">This report has no share link. Ask an editor to create one.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
