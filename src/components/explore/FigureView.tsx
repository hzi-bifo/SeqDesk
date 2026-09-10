"use client";

import { useEffect, useState, type ComponentType, type ReactElement } from "react";
import type { Config, Data, Layout } from "plotly.js";
import type { PlotParams } from "react-plotly.js";
import { Download } from "lucide-react";
import { ExploreLoading } from "./ExploreLoading";
import { ReportImage } from "./ReportImage";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type FigureFormat = "plotly-json" | "png" | "svg" | "html" | "pdf" | "tsv" | "csv" | "md" | "txt" | "json";

export interface FigureViewProps {
  /** Artifact URL (same-origin API route serving the file). */
  url: string;
  format: FigureFormat;
  title?: string;
  description?: string;
  /** Height of the preview area in pixels. Defaults to 420. */
  height?: number;
  className?: string;
}

/** Number of data rows shown for delimited text artifacts. */
export const PREVIEW_ROW_LIMIT = 200;

const FETCHED_FORMATS: ReadonlySet<FigureFormat> = new Set(["plotly-json", "tsv", "csv", "md", "txt", "json"]);

const PLOTLY_CONFIG: Partial<Config> = {
  displaylogo: false,
  responsive: true,
  toImageButtonOptions: { format: "png", scale: 2 },
};

interface PlotlyFigure {
  data: Data[];
  layout: Partial<Layout>;
  config?: Partial<Config>;
}

interface DelimitedPreview {
  columns: string[];
  rows: string[][];
  totalRows: number;
  truncated: boolean;
}

type ArtifactContent =
  | { kind: "figure"; figure: PlotlyFigure }
  | { kind: "table"; table: DelimitedPreview }
  | { kind: "text"; text: string };

type LoadState =
  | { key: string; status: "ready"; content: ArtifactContent }
  | { key: string; status: "error"; message: string };

type PlotComponent = ComponentType<PlotParams>;

let plotComponentPromise: Promise<PlotComponent> | null = null;

/**
 * Loads plotly.js (cartesian bundle, roughly 1 MB minified) together with the
 * react-plotly.js wrapper on first use. Both imports are deferred so the
 * bundle only ships to browsers that actually render a Plotly figure and
 * never executes during server rendering, where plotly.js throws on import.
 */
function loadPlotComponent(): Promise<PlotComponent> {
  if (!plotComponentPromise) {
    const promise = Promise.all([
      import("react-plotly.js/factory"),
      import("plotly.js-cartesian-dist-min"),
    ]).then(([factory, plotly]) => factory.default(plotly.default ?? plotly));
    promise.catch(() => {
      // Allow a later mount to retry after a failed load.
      plotComponentPromise = null;
    });
    plotComponentPromise = promise;
  }
  return plotComponentPromise;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePlotlyFigure(text: string): PlotlyFigure {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`The figure JSON could not be parsed: ${describeError(error)}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.data)) {
    throw new Error('The figure JSON must be an object with a "data" array of traces.');
  }
  return {
    data: parsed.data as Data[],
    layout: (isRecord(parsed.layout) ? parsed.layout : {}) as Partial<Layout>,
    config: isRecord(parsed.config) ? (parsed.config as Partial<Config>) : undefined,
  };
}

function parseDelimitedPreview(text: string, delimiter: "," | "\t"): DelimitedPreview {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  if (lines.length === 0) {
    return { columns: [], rows: [], totalRows: 0, truncated: false };
  }
  const [headerLine, ...dataLines] = lines;
  return {
    columns: headerLine.split(delimiter),
    rows: dataLines.slice(0, PREVIEW_ROW_LIMIT).map((line) => line.split(delimiter)),
    totalRows: dataLines.length,
    truncated: dataLines.length > PREVIEW_ROW_LIMIT,
  };
}

function prettyPrintJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // Show the raw payload rather than hiding a malformed artifact.
    return text;
  }
}

async function fetchArtifact(url: string, format: FigureFormat, signal: AbortSignal): Promise<ArtifactContent> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`The artifact could not be loaded (HTTP ${response.status}).`);
  }
  const text = await response.text();
  switch (format) {
    case "plotly-json":
      return { kind: "figure", figure: parsePlotlyFigure(text) };
    case "tsv":
    case "csv":
      return { kind: "table", table: parseDelimitedPreview(text, format === "csv" ? "," : "\t") };
    case "json":
      return { kind: "text", text: prettyPrintJson(text) };
    default:
      return { kind: "text", text };
  }
}

/** Size-related layout keys are dropped so the plot fills its container. */
function responsiveLayout(layout: Partial<Layout>): Partial<Layout> {
  const next: Partial<Layout> = { ...layout, autosize: true };
  delete next.width;
  delete next.height;
  return next;
}

export function buildDownloadUrl(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

function FigureSkeleton({ height, variant = "chart" }: { height: number; variant?: "table" | "text" | "chart" }): ReactElement {
  return (
    <div style={{ height }} aria-busy="true" data-testid="figure-skeleton">
      <ExploreLoading variant={variant} label="Loading figure…" height={height} />
    </div>
  );
}

function FigureError({ message, height }: { message: string; height: number }): ReactElement {
  return (
    <div
      role="alert"
      className="flex items-center justify-center p-4 text-center text-sm text-destructive"
      style={{ minHeight: Math.min(height, 160) }}
    >
      {message}
    </div>
  );
}

function TablePreview({ table, height }: { table: DelimitedPreview; height: number }): ReactElement {
  if (table.columns.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">The file is empty.</p>;
  }
  return (
    <div>
      <div className="overflow-auto" style={{ maxHeight: height }} data-testid="figure-table">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              {table.columns.map((column, index) => (
                <TableHead key={index} className="h-8 whitespace-nowrap">
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {table.columns.map((_, columnIndex) => (
                  <TableCell key={columnIndex} className="whitespace-nowrap py-1.5">
                    {row[columnIndex] ?? ""}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {table.truncated && (
        <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
          Showing the first {PREVIEW_ROW_LIMIT} of {table.totalRows} rows. Download the file for the full table.
        </p>
      )}
    </div>
  );
}

/**
 * Renders an analysis artifact by format: Plotly figures through
 * react-plotly.js, images, sandboxed HTML, PDF, delimited tables and plain
 * text previews, with a footer carrying the title, description and a
 * download link.
 */
export function FigureView({ url, format, title, description, height = 420, className }: FigureViewProps): ReactElement {
  const key = `${format}\u0000${url}`;
  const [load, setLoad] = useState<LoadState | null>(null);
  const [Plot, setPlot] = useState<PlotComponent | null>(null);
  const [plotError, setPlotError] = useState<string | null>(null);
  const current = load?.key === key ? load : null;
  const downloadUrl = buildDownloadUrl(url);
  const label = title ?? "Artifact";

  useEffect(() => {
    if (!FETCHED_FORMATS.has(format)) return;
    const controller = new AbortController();
    const requestKey = `${format}\u0000${url}`;
    fetchArtifact(url, format, controller.signal).then(
      (content) => {
        if (controller.signal.aborted) return;
        setLoad({ key: requestKey, status: "ready", content });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ key: requestKey, status: "error", message: describeError(error) });
      }
    );
    return () => {
      controller.abort();
    };
  }, [url, format]);

  useEffect(() => {
    if (format !== "plotly-json") return;
    let cancelled = false;
    loadPlotComponent().then(
      (component) => {
        if (!cancelled) setPlot(() => component);
      },
      (error: unknown) => {
        if (!cancelled) setPlotError(`The chart library could not be loaded: ${describeError(error)}`);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [format]);

  let body: ReactElement;
  switch (format) {
    case "png":
    case "svg":
      body = (
        <ReportImage src={url} alt={title ?? "Figure"} height={height} />
      );
      break;
    case "html":
      body = (
        <iframe
          sandbox="allow-scripts"
          src={url}
          title={title ?? "Interactive figure"}
          className="w-full border-0 bg-white"
          style={{ height }}
        />
      );
      break;
    case "pdf":
      body = (
        <object data={url} type="application/pdf" className="w-full" style={{ height }} aria-label={title ?? "PDF document"}>
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
            <p>This browser cannot display PDF files inline.</p>
            <a href={downloadUrl} download className="font-medium text-foreground underline underline-offset-4">
              Download the PDF
            </a>
          </div>
        </object>
      );
      break;
    default: {
      if (!current) {
        body = <FigureSkeleton height={height} variant={format === "plotly-json" ? "chart" : format === "csv" || format === "tsv" ? "table" : "text"} />;
      } else if (current.status === "error") {
        body = <FigureError message={current.message} height={height} />;
      } else if (current.content.kind === "table") {
        body = <TablePreview table={current.content.table} height={height} />;
      } else if (current.content.kind === "text") {
        body = (
          <pre className="overflow-auto p-3 font-mono text-xs leading-relaxed" style={{ maxHeight: height }} data-testid="figure-text">
            {current.content.text}
          </pre>
        );
      } else if (plotError) {
        body = <FigureError message={plotError} height={height} />;
      } else if (!Plot) {
        body = <FigureSkeleton height={height} />;
      } else {
        const { figure } = current.content;
        body = (
          <Plot
            data={figure.data}
            layout={responsiveLayout(figure.layout)}
            config={{ ...figure.config, ...PLOTLY_CONFIG }}
            useResizeHandler
            style={{ width: "100%", height }}
          />
        );
      }
    }
  }

  return (
    <figure
      className={cn("flex flex-col overflow-hidden rounded-lg border bg-card text-card-foreground", className)}
      data-testid="figure-view"
      data-format={format}
    >
      <div className="min-w-0">{body}</div>
      <figcaption className="flex items-start justify-between gap-3 border-t bg-muted/30 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{label}</p>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        <a
          href={downloadUrl}
          download
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium underline-offset-4 hover:underline"
          data-testid="figure-download"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Download
        </a>
      </figcaption>
    </figure>
  );
}
