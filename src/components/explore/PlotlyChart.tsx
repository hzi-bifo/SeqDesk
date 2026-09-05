"use client";

import { useEffect, useState, type ComponentType } from "react";
import { Skeleton } from "@/components/ui/skeleton";

type PlotProps = {
  data: unknown[];
  layout?: Record<string, unknown>;
  config?: Record<string, unknown>;
  style?: React.CSSProperties;
  useResizeHandler?: boolean;
  onClick?: (event: unknown) => void;
};

let plotPromise: Promise<ComponentType<PlotProps>> | null = null;

/** Load Plotly once, client-side only, with the cartesian bundle. */
function loadPlot(): Promise<ComponentType<PlotProps>> {
  if (!plotPromise) {
    plotPromise = Promise.all([import("react-plotly.js/factory"), import("plotly.js-cartesian-dist-min")]).then(
      ([factory, plotly]) => (factory.default as unknown as (p: unknown) => ComponentType<PlotProps>)((plotly as { default?: unknown }).default ?? plotly)
    );
  }
  return plotPromise;
}

export interface PlotlyChartProps {
  data: unknown[];
  layout?: Record<string, unknown>;
  height?: number;
  onClick?: (event: unknown) => void;
  className?: string;
  /** Render without toolbar or interaction, for thumbnails. */
  staticPlot?: boolean;
}

const BASE_LAYOUT = {
  margin: { l: 56, r: 16, t: 32, b: 48 },
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { family: "inherit", size: 12 },
  hovermode: "closest",
};

const CONFIG = { displaylogo: false, responsive: true, toImageButtonOptions: { format: "png", scale: 2 }, modeBarButtonsToRemove: ["lasso2d", "select2d"] };

export function PlotlyChart({ data, layout, height = 360, onClick, className, staticPlot = false }: PlotlyChartProps) {
  const [Plot, setPlot] = useState<ComponentType<PlotProps> | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPlot()
      .then((component) => {
        if (!cancelled) setPlot(() => component);
      })
      .catch((error) => {
        if (!cancelled) setFailed(error instanceof Error ? error.message : "Plotly could not be loaded");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return <p className="text-sm text-destructive">{failed}</p>;
  if (!Plot) return <Skeleton className={className} style={{ height }} />;
  return (
    <div className={className}>
      <Plot
        data={data}
        layout={{ ...BASE_LAYOUT, ...layout, height, autosize: true }}
        config={staticPlot ? { ...CONFIG, staticPlot: true, displayModeBar: false } : CONFIG}
        style={{ width: "100%", height }}
        useResizeHandler
        onClick={onClick}
      />
    </div>
  );
}
