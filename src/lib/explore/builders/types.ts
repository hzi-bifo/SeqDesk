import type { ExploreTargetKey } from "../target-key";
import type {
  ExploreDatasetKind,
  ExploreProvenance,
  ExploreRoleMap,
  ExploreRowData,
  ExploreSchema,
  ExploreSensitivity,
} from "../types";

export interface BuiltDataset {
  kind: ExploreDatasetKind;
  tableKind: string | null;
  name: string;
  description: string | null;
  sensitivity: ExploreSensitivity;
  roles: ExploreRoleMap;
  schema: ExploreSchema;
  rows: ExploreRowData[];
  provenance: ExploreProvenance;
  /** Column keys used to fill the indexed sample / subject / key columns. */
  keys: { sample?: string; subject?: string; key?: string };
  /** Builder configuration to persist so the dataset can be rebuilt. */
  sourceConfig: Record<string, unknown>;
  warnings: string[];
}

export interface BuildContext {
  target: ExploreTargetKey;
  targetKey: string;
  /** Derived from the authenticated server principal, never request options. */
  userId: string;
  installation: boolean;
  /** Operational form-field visibility; not system-administrator status. */
  isFacilityAdmin: boolean;
}

/** A source exists but cannot produce a trustworthy table; show actionable feedback. */
export class ExploreBuildInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExploreBuildInputError";
  }
}
