/**
 * Client-safe part of the Explore canvas: node and edge types, preview column
 * selection and the layered layout. No server imports here so the React Flow
 * component can use it.
 */
import type { ExploreColumn, ExploreRole, ExploreRoleMap, ExploreRowData } from "./types";

/** A JSON-schema-like description of an analysis' parameters, as kits declare it. */
export interface CanvasParamsSchema {
  type?: string;
  properties?: Record<string, { type?: string | string[]; title?: string; description?: string; default?: unknown; enum?: Array<string | number>; minimum?: number; maximum?: number }>;
  required?: string[];
}

/** A view the card cannot offer yet, and the roles that would unlock it. */
export interface CanvasRoleHint {
  view: "subject-timeline" | "heatmap";
  missing: ExploreRole[];
}

export type CanvasNodeKind = "source" | "dataset" | "analysis" | "figure" | "pending" | "view";

/** The views SeqDesk draws from a table without an analysis. */
export type BuiltInView = "subject-timeline" | "heatmap";
export const BUILT_IN_VIEWS: Record<BuiltInView, { label: string; description: string }> = {
  "subject-timeline": { label: "Subject timeline", description: "Sampling days and community composition per subject" },
  heatmap: { label: "Heatmap", description: "Taxa by samples, ordered by specimen type, subject and day" },
};

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
  /** Column key → names of the analyses that read it; these columns stay open and are tinted on the card. */
  usedColumns?: Record<string, string[]>;
  /** For outputs: the latest finished run of the analysis writing this table and whether it changed the table. */
  latestWrite?: { runNumber: string; changed: boolean } | null;
  /** Views the table cannot offer until more roles are mapped. */
  roleHints?: CanvasRoleHint[];
  /** For outputs: true when the report page shows this table. */
  inReport?: boolean;
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
  latestRun: { id: string; runNumber: string; status: string; errorTail?: string | null; completedAt?: string | null } | null;
  /** True while the latest run is pending, queued or running. */
  active: boolean;
  /** Parameters of the current revision and the schema the kit declares for them. */
  params?: Record<string, unknown>;
  paramsSchema?: CanvasParamsSchema | null;
  /** Input bindings of the current revision. */
  inputs?: Array<{ alias: string; datasetId: string }>;
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
  /** The analysis that draws this figure; with the name it identifies the figure across runs. */
  analysisId?: string;
  runNumber?: string;
  /** True when the latest run wrote a byte-identical figure to the run before it. */
  unchanged?: boolean;
  /** True when the report page shows this figure. */
  inReport?: boolean;
  refreshing?: boolean;
}

/** A built-in view drawn straight from a table: no analysis, no run, always current. */
export type CanvasViewData = {
  kind: "view";
  datasetId: string;
  view: BuiltInView;
  name: string;
  /** Name of the table it reads. */
  tableName: string;
  url: string;
  /** True when the report page shows this view. */
  inReport?: boolean;
};

/** Placeholder for outputs of a run that has not finished yet. */
export type CanvasPendingData = {
  kind: "pending";
  analysisId: string;
  runId: string;
  runNumber: string;
  status: string;
}

export type CanvasNodeData = CanvasSourceData | CanvasDatasetData | CanvasAnalysisData | CanvasFigureData | CanvasPendingData | CanvasViewData;

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

/** The human-readable sample column of a table, if it has one next to the database id. */
export function sampleLabelKey(columns: ExploreColumn[]): string | undefined {
  return columns.find((column) => SAMPLE_LABEL_KEYS.has(column.key) || /^sample id$/i.test(column.label))?.key;
}

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
  const sampleLabel = roles.sample && roles.sample.endsWith("_db_id") ? sampleLabelKey(columns) : undefined;
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
  /** Node ids rendered in their expanded size. */
  expanded?: Set<string>;
  /** Explicit sizes (for example after the user resized a card) that win over the defaults. */
  sizes?: Record<string, { width: number; height: number }>;
}

export const CANVAS_SIZES: Record<CanvasNodeKind, { width: number; height: number }> = {
  source: { width: 220, height: 64 },
  dataset: { width: 320, height: 264 },
  analysis: { width: 300, height: 190 },
  figure: { width: 280, height: 210 },
  pending: { width: 280, height: 210 },
  view: { width: 300, height: 230 },
};
export const CANVAS_EXPANDED_DATASET = { width: 680, height: 480 };
export const CANVAS_MIN_SIZES: Record<CanvasNodeKind, { width: number; height: number }> = {
  source: { width: 160, height: 56 },
  dataset: { width: 240, height: 170 },
  analysis: { width: 240, height: 130 },
  figure: { width: 180, height: 140 },
  pending: { width: 180, height: 140 },
  view: { width: 220, height: 150 },
};

/** The size a node renders at: user size, else expanded preset, else the default. */
export function nodeSize(node: CanvasNode, options: Pick<LayoutOptions, "expanded" | "sizes"> = {}): { width: number; height: number } {
  const custom = options.sizes?.[node.id];
  if (custom) return custom;
  if (node.data.kind === "dataset" && options.expanded?.has(node.id)) return CANVAS_EXPANDED_DATASET;
  return CANVAS_SIZES[node.data.kind];
}

const BASE_RANK: Record<CanvasNodeKind, number> = { source: 0, dataset: 1, analysis: 2, figure: 3, pending: 3, view: 2 };

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

  // Column x positions: the widest card of each rank plus the gap.
  const widths = new Map<number, number>();
  for (const node of graph.nodes) {
    const value = rank.get(node.id) ?? 0;
    widths.set(value, Math.max(widths.get(value) ?? 0, nodeSize(node, options).width));
  }
  const xOfRank = new Map<number, number>();
  let x = 0;
  for (const value of [...widths.keys()].sort((a, b) => a - b)) {
    xOfRank.set(value, x);
    x += (widths.get(value) ?? 0) + columnGap;
  }

  // Families: every node hangs from one primary parent (its first input of a
  // lower rank), so an analysis sits at the top of the block of its outputs
  // and a table at the top of the block of everything made from it.
  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const node of graph.nodes) {
    const own = rank.get(node.id) ?? 0;
    const parent = (incoming.get(node.id) ?? []).find((candidate) => (rank.get(candidate) ?? 0) < own) ?? null;
    if (parent) children.set(parent, [...(children.get(parent) ?? []), node.id]);
    else roots.push(node.id);
  }
  const heights = new Map<string, number>();
  const blockHeight = (id: string): number => {
    const cached = heights.get(id);
    if (cached !== undefined) return cached;
    const own = nodeSize(byId.get(id)!, options).height;
    const below = children.get(id) ?? [];
    const stacked = below.reduce((total, child, index) => total + blockHeight(child) + (index > 0 ? rowGap : 0), 0);
    const value = Math.max(own, stacked);
    heights.set(id, value);
    return value;
  };
  const positions: Record<string, { x: number; y: number }> = {};
  const place = (id: string, top: number) => {
    positions[id] = { x: xOfRank.get(rank.get(id) ?? 0) ?? 0, y: top };
    let cursor = top;
    for (const child of children.get(id) ?? []) {
      place(child, cursor);
      cursor += blockHeight(child) + rowGap;
    }
  };
  let cursor = 0;
  for (const root of roots) {
    place(root, cursor);
    cursor += blockHeight(root) + rowGap;
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
    } else if (node.data.kind === "view") {
      // Drawn from the table directly: the table's hue turned like any output.
      const table = (incoming.get(id) ?? []).find((parent) => byId.get(parent)?.data.kind === "dataset");
      const tableHue = table ? hueOf(table) : null;
      value = ((tableHue ?? 250) + OUTPUT_TURN) % 360;
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

// ---------------------------------------------------------------------------
// Which columns an analysis reads, and how a card folds the others away.
// ---------------------------------------------------------------------------

/**
 * Columns of an input table that an analysis reads: the role columns its code
 * asks for (or, when the code names none, the roles its kit declares) plus any
 * column key quoted verbatim in the code. A heuristic, meant to point at the
 * columns worth looking at rather than to be complete.
 */
export function usedColumnKeys(input: { code: string; columns: ExploreColumn[]; roles: ExploreRoleMap; declaredRoles?: string[] }): string[] {
  const keys = new Set(input.columns.map((column) => column.key));
  const used = new Set<string>();
  const codeRoles = new Set<string>();
  for (const match of input.code.matchAll(/role_columns?\([^)]*?["']([a-z_]+)["']/g)) codeRoles.add(match[1]);
  for (const match of input.code.matchAll(/roles?(?:\([^)]*\))?\[["']([a-z_]+)["']\]/g)) codeRoles.add(match[1]);
  const roleNames = codeRoles.size > 0 ? codeRoles : new Set(input.declaredRoles ?? []);
  for (const role of roleNames) {
    const column = input.roles[role as keyof ExploreRoleMap];
    if (!column) continue;
    if (keys.has(column)) used.add(column);
    // Cards hide database ids; point at the human sample label instead.
    if (role === "sample" && column.endsWith("_db_id")) {
      const label = sampleLabelKey(input.columns);
      if (label) used.add(label);
    }
  }
  // Role names passed to the helper are not column names, even when a column happens to share the name.
  const literals = input.code.replace(/role_columns?\([^)]*\)/g, "").replace(/roles?(?:\([^)]*\))?\[["'][a-z_]+["']\]/g, "");
  for (const match of literals.matchAll(/["']([^"'\n]{1,80})["']/g)) if (keys.has(match[1])) used.add(match[1]);
  return input.columns.map((column) => column.key).filter((key) => used.has(key));
}

export type ColumnSegment =
  | { kind: "column"; column: ExploreColumn; fold: number | null; firstOfFold: boolean }
  | { kind: "fold"; fold: number; columns: ExploreColumn[] };

/**
 * Lay a table's columns out like an accordion: the columns worth seeing stay
 * open and each run of other columns between them collapses into one fold.
 * Open folds render their columns, marked so the card can offer to fold them again.
 */
export function foldColumns(columns: ExploreColumn[], keep: Set<string>, openFolds: Set<number> = new Set()): ColumnSegment[] {
  if (![...keep].some((key) => columns.some((column) => column.key === key))) {
    return columns.map((column) => ({ kind: "column", column, fold: null, firstOfFold: false }));
  }
  const segments: ColumnSegment[] = [];
  let pending: ExploreColumn[] = [];
  let foldIndex = 0;
  const flush = () => {
    if (pending.length === 0) return;
    if (openFolds.has(foldIndex)) {
      pending.forEach((column, index) => segments.push({ kind: "column", column, fold: foldIndex, firstOfFold: index === 0 }));
    } else {
      segments.push({ kind: "fold", fold: foldIndex, columns: pending });
    }
    foldIndex += 1;
    pending = [];
  };
  for (const column of columns) {
    if (keep.has(column.key)) {
      flush();
      segments.push({ kind: "column", column, fold: null, firstOfFold: false });
    } else {
      pending.push(column);
    }
  }
  flush();
  return segments;
}

export const CANVAS_COLUMN_WIDTH = 96;
export const CANVAS_FOLD_WIDTH = 28;

/** As many segments as fit the width, left to right; the rest counts as hidden. */
export function fitSegments(segments: ColumnSegment[], available: number): { shown: ColumnSegment[]; hiddenColumns: number } {
  const shown: ColumnSegment[] = [];
  let budget = available;
  for (const segment of segments) {
    const width = segment.kind === "fold" ? CANVAS_FOLD_WIDTH : CANVAS_COLUMN_WIDTH;
    if (budget < width && shown.length > 0) break;
    shown.push(segment);
    budget -= width;
  }
  const visible = shown.filter((segment) => segment.kind === "column").length;
  const total = segments.reduce((count, segment) => count + (segment.kind === "fold" ? segment.columns.length : 1), 0);
  return { shown, hiddenColumns: total - visible };
}
