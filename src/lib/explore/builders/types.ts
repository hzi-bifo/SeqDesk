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
  isFacilityAdmin: boolean;
}
