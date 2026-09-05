/**
 * Shared Explore types used by the server libraries, API routes and the UI.
 * Keep this file free of server-only imports so client components can use it.
 */

export type ExploreDatasetKind =
  | "samples"
  | "sequencing"
  | "pipeline-table"
  | "external"
  | "derived";

export const EXPLORE_DATASET_KINDS: readonly ExploreDatasetKind[] = [
  "samples",
  "sequencing",
  "pipeline-table",
  "external",
  "derived",
] as const;

export type ExploreSensitivity = "standard" | "pseudonymous" | "clinical";

export const EXPLORE_SENSITIVITIES: readonly ExploreSensitivity[] = [
  "standard",
  "pseudonymous",
  "clinical",
] as const;

/** Sensitivity is ordered; derived data inherits the highest tier of its inputs. */
export const SENSITIVITY_RANK: Record<ExploreSensitivity, number> = {
  standard: 0,
  pseudonymous: 1,
  clinical: 2,
};

/**
 * Column roles let views and kits work on any dataset without knowing its
 * column names. A dataset maps column keys to roles once.
 */
export type ExploreRole =
  | "sample"
  | "subject"
  | "timepoint"
  | "group"
  | "taxon"
  | "taxon_id"
  | "rank"
  | "value"
  | "count"
  | "date";

export const EXPLORE_ROLES: readonly ExploreRole[] = [
  "sample",
  "subject",
  "timepoint",
  "group",
  "taxon",
  "taxon_id",
  "rank",
  "value",
  "count",
  "date",
] as const;

export type ExploreColumnType = "string" | "number" | "boolean" | "date" | "json";

export interface ExploreColumn {
  key: string;
  label: string;
  type: ExploreColumnType;
  role?: ExploreRole;
  /** Where the column came from: a builder group label such as "study" or "pipeline". */
  group?: string;
  description?: string;
}

export interface ExploreSchema {
  columns: ExploreColumn[];
}

export type ExploreRoleMap = Partial<Record<ExploreRole, string>>;

export type ExploreCell = string | number | boolean | null;
export type ExploreRowData = Record<string, ExploreCell>;

export interface ExploreRowRecord {
  rowIndex: number;
  sampleId: string | null;
  subjectId: string | null;
  key: string | null;
  data: ExploreRowData;
  /** Stable key used by curation edits; derived from sample id and secondary key when present. */
  rowKey?: string;
  /** Set by the edit layer: flags attached to the row. */
  flags?: string[];
  /** Set by the edit layer when a row-exclude edit applies. */
  excluded?: boolean;
  /** Set by the edit layer: column keys whose value was overridden. */
  edited?: string[];
}

export interface ExploreProvenanceSource {
  type: "study" | "order" | "sample" | "pipeline-run" | "artifact" | "file" | "analysis-run" | "dataset-version";
  id: string;
  label?: string;
  checksum?: string;
}

export interface ExploreProvenance {
  builtAt: string;
  builder: string;
  sources: ExploreProvenanceSource[];
  notes?: string[];
}

export type ExploreEditKind = "cell" | "row-flag" | "row-exclude" | "column-add" | "column-hide";

export interface ExploreEditTarget {
  rowKey?: string;
  column?: string;
}

export interface ExploreDatasetSummary {
  id: string;
  targetKey: string;
  kind: ExploreDatasetKind;
  tableKind: string | null;
  name: string;
  description: string | null;
  sensitivity: ExploreSensitivity;
  roles: ExploreRoleMap;
  currentVersion: {
    id: string;
    number: number;
    rowCount: number;
    contentHash: string;
    createdAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExploreDatasetDetail extends ExploreDatasetSummary {
  schema: ExploreSchema;
  provenance: ExploreProvenance | null;
  sourceConfig: Record<string, unknown> | null;
  versions: Array<{
    id: string;
    number: number;
    rowCount: number;
    contentHash: string;
    buildSource: string;
    createdAt: string;
  }>;
  editCount: number;
}

export interface ExploreRowPage {
  rows: ExploreRowRecord[];
  nextCursor: string | null;
  total: number;
  cacheToken: string;
}

export interface ExploreScope {
  targetKey: string;
  type: "study" | "order" | "workspace";
  /** The study title, the order name or the workspace name. */
  label: string;
  /** A secondary identifier: study alias or order number. */
  detail?: string;
  access: "read" | "write";
}
