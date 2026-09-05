/**
 * Client-safe part of the Explore canvas: node and edge types, preview column
 * selection and the layered layout. No server imports here so the React Flow
 * component can use it.
 */
import type { ExploreColumn, ExploreRoleMap, ExploreRowData } from "./types";

export type CanvasNodeKind = "source" | "dataset" | "analysis" | "figure" | "pending";

export type CanvasSourceData = {
  kind: "source";
  sourceType: string; // study | order | pipeline-run | file | artifact | analysis-run
  label: string;
}

export type CanvasDatasetData = {
  kind: "dataset";
  datasetId: string;
  name: string;
  datasetKind: string;
  tableKind: string | null;
  sensitivity: string;
  /** Where the data came from, shown on the card instead of a separate source box. */
  origin: string;
  version: number | null;
  rowCount: number;
  columnCount: number;
  /** Columns chosen for the small preview, most telling first. */
  previewColumns: ExploreColumn[];
  /** All columns in schema order, for the expanded card. */
  columns: ExploreColumn[];
  roles: ExploreRoleMap;
  previewRows: ExploreRowData[];
  views: Array<"subject-timeline" | "heatmap">;
  /** True while the analysis that writes this dataset is running again. */
  refreshing?: boolean;
}

export type CanvasAnalysisData = {
  kind: "analysis";
  analysisId: string;
  name: string;
  kitId: string | null;
  language: string;
  revision: number | null;
  /** First lines of the current revision, so the card reads as a function. */
  codePreview: string;
  codeLines: number;
  latestRun: { id: string; runNumber: string; status: string } | null;
  /** True while the latest run is pending, queued or running. */
  active: boolean;
}

export type CanvasFigureData = {
  kind: "figure";
  artifactId: string;
  runId: string;
  name: string;
  format: string;
  url: string;
  /** A static image of the same figure, when the run wrote one next to the interactive version. */
  thumbnailUrl: string | null;
  refreshing?: boolean;
}

/** Placeholder for outputs of a run that has not finished yet. */
export type CanvasPendingData = {
  kind: "pending";
  analysisId: string;
  runId: string;
  runNumber: string;
  status: string;
}

export type CanvasNodeData = CanvasSourceData | CanvasDatasetData | CanvasAnalysisData | CanvasFigureData | CanvasPendingData;

export interface CanvasNode {
  id: string;
  data: CanvasNodeData;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface CanvasGraph {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export const PREVIEW_ROWS = 3;
const PREVIEW_COLUMNS = 3;
const ROLE_PREFERENCE = ["sample", "subject", "taxon", "group", "timepoint", "count", "value"] as const;
const SAMPLE_LABEL_KEYS = new Set(["sample_id", "_sampleId", "sampleId", "sample"]);

/** Pick the columns that tell the most about a table: role columns first, ids last. */
export function pickPreviewColumns(columns: ExploreColumn[], roles: ExploreRoleMap, limit = PREVIEW_COLUMNS): ExploreColumn[] {
  const byKey = new Map(columns.map((column) => [column.key, column] as const));
  const chosen: ExploreColumn[] = [];
  const take = (key: string | undefined) => {
    if (!key) return;
    const column = byKey.get(key);
    if (column && !chosen.includes(column)) chosen.push(column);
  };
  // A human sample label beats the database id used for joins.
  const sampleLabel =
    roles.sample && roles.sample.endsWith("_db_id")
      ? columns.find((column) => SAMPLE_LABEL_KEYS.has(column.key) || /^sample id$/i.test(column.label))?.key
      : undefined;
  if (sampleLabel) take(sampleLabel);
  for (const role of ROLE_PREFERENCE) {
    if (chosen.length >= limit) break;
    if (role === "sample" && sampleLabel) continue;
    take(roles[role]);
  }
  for (const column of columns) {
    if (chosen.length >= limit) break;
    if (column.key.endsWith("_db_id")) continue;
    take(column.key);
  }
  return chosen.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Layout: a layered left-to-right arrangement computed from the edges.
// ---------------------------------------------------------------------------

export interface LayoutOptions {
  columnGap?: number;
  rowGap?: number;
  heights?: Partial<Record<CanvasNodeKind, number>>;
  widths?: Partial<Record<CanvasNodeKind, number>>;
  /** Node ids rendered in their expanded size. */
  expanded?: Set<string>;
  expandedHeight?: number;
}

export const CANVAS_SIZES: Record<CanvasNodeKind, { width: number; height: number }> = {
  source: { width: 220, height: 64 },
  dataset: { width: 300, height: 236 },
  analysis: { width: 300, height: 190 },
  figure: { width: 280, height: 210 },
  pending: { width: 280, height: 210 },
};
export const CANVAS_EXPANDED_DATASET = { width: 680, height: 480 };

const BASE_RANK: Record<CanvasNodeKind, number> = { source: 0, dataset: 1, analysis: 2, figure: 3, pending: 3 };

/**
 * Rank every node by the longest path from a root, never below the base rank
 * of its kind, then stack the nodes of each rank vertically. Derived datasets
 * therefore land to the right of the analysis that wrote them.
 */
export function layoutCanvas(graph: CanvasGraph, options: LayoutOptions = {}): Record<string, { x: number; y: number }> {
  const columnGap = options.columnGap ?? 80;
  const rowGap = options.rowGap ?? 28;
  const incoming = new Map<string, string[]>();
  for (const node of graph.nodes) incoming.set(node.id, []);
  for (const edge of graph.edges) {
    if (incoming.has(edge.target) && incoming.has(edge.source)) incoming.get(edge.target)!.push(edge.source);
  }
  const kindOf = new Map(graph.nodes.map((node) => [node.id, node.data.kind] as const));
  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    const cached = rank.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return BASE_RANK[kindOf.get(id) ?? "dataset"];
    visiting.add(id);
    const base = BASE_RANK[kindOf.get(id) ?? "dataset"];
    const parents = incoming.get(id) ?? [];
    const value = parents.length ? Math.max(base, ...parents.map((parent) => rankOf(parent) + 1)) : base;
    visiting.delete(id);
    rank.set(id, value);
    return value;
  };
  for (const node of graph.nodes) rankOf(node.id);

  const columns = new Map<number, CanvasNode[]>();
  for (const node of graph.nodes) {
    const value = rank.get(node.id) ?? 0;
    columns.set(value, [...(columns.get(value) ?? []), node]);
  }
  const positions: Record<string, { x: number; y: number }> = {};
  let x = 0;
  for (const value of [...columns.keys()].sort((a, b) => a - b)) {
    const column = columns.get(value)!;
    let y = 0;
    let widest = 0;
    for (const node of column) {
      const expanded = options.expanded?.has(node.id) && node.data.kind === "dataset";
      const size = expanded ? CANVAS_EXPANDED_DATASET : CANVAS_SIZES[node.data.kind];
      positions[node.id] = { x, y };
      y += size.height + rowGap;
      widest = Math.max(widest, size.width);
    }
    x += widest + columnGap;
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Colour: inputs are green, compute is amber, outputs take the input hue turned
// a third of the wheel. A second generation turns again, so lineage depth is
// visible at a glance.
// ---------------------------------------------------------------------------

export const COMPUTE_HUE = 42;
export const OUTPUT_TURN = 120;
const ROOT_DATASET_HUES: Record<string, number> = {
  samples: 165,
  sequencing: 195,
  "pipeline-table": 140,
  external: 110,
  derived: 250,
};

function circularMean(hues: number[]): number {
  if (hues.length === 0) return 250;
  let x = 0;
  let y = 0;
  for (const hue of hues) {
    const radians = (hue * Math.PI) / 180;
    x += Math.cos(radians);
    y += Math.sin(radians);
  }
  const degrees = (Math.atan2(y, x) * 180) / Math.PI;
  return ((Math.round(degrees) % 360) + 360) % 360;
}

/** Hue per node id; sources are null (neutral). */
export function assignCanvasHues(graph: CanvasGraph): Record<string, number | null> {
  const incoming = new Map<string, string[]>();
  for (const node of graph.nodes) incoming.set(node.id, []);
  for (const edge of graph.edges) if (incoming.has(edge.target) && incoming.has(edge.source)) incoming.get(edge.target)!.push(edge.source);
  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const hues: Record<string, number | null> = {};
  const visiting = new Set<string>();

  const hueOf = (id: string): number | null => {
    if (id in hues) return hues[id];
    const node = byId.get(id);
    if (!node) return null;
    if (visiting.has(id)) return null;
    visiting.add(id);
    let value: number | null;
    if (node.data.kind === "source") {
      value = null;
    } else if (node.data.kind === "analysis") {
      value = COMPUTE_HUE;
    } else if (node.data.kind === "figure" || node.data.kind === "pending") {
      value = outputHue(id);
    } else {
      const producer = (incoming.get(id) ?? []).find((parent) => byId.get(parent)?.data.kind === "analysis");
      value = producer ? outputHue(id) : ROOT_DATASET_HUES[node.data.datasetKind] ?? 250;
    }
    visiting.delete(id);
    hues[id] = value;
    return value;
  };

  // An output's hue comes from the datasets that fed the analysis which wrote it.
  const outputHue = (id: string): number => {
    const analysis = (incoming.get(id) ?? []).find((parent) => byId.get(parent)?.data.kind === "analysis");
    const inputs = analysis ? (incoming.get(analysis) ?? []).filter((parent) => byId.get(parent)?.data.kind === "dataset") : [];
    const inputHues = inputs.map((input) => hueOf(input)).filter((hue): hue is number => hue !== null);
    return (circularMean(inputHues) + OUTPUT_TURN) % 360;
  };

  for (const node of graph.nodes) hueOf(node.id);
  return hues;
}
