import type { ExploreDatasetKind, ExploreRole, ExploreRoleMap, ExploreSchema } from "./types";
import type { InputRequirements } from "./table-contract";

export interface ExploreDatasetKindDefinition {
  id: ExploreDatasetKind;
  label: string;
  description: string;
  /** Kinds a builder can produce automatically for a scope. */
  buildable: boolean;
}

export const DATASET_KIND_DEFINITIONS: Record<ExploreDatasetKind, ExploreDatasetKindDefinition> = {
  samples: {
    id: "samples",
    label: "Samples",
    description: "One row per sample with identity, order fields, study fields, checklist metadata and output columns.",
    buildable: true,
  },
  sequencing: {
    id: "sequencing",
    label: "Sequencing",
    description: "One row per sample per sequencing run with barcode, run quality and read statistics.",
    buildable: true,
  },
  "pipeline-table": {
    id: "pipeline-table",
    label: "Pipeline table",
    description: "Rows parsed from a table output that a pipeline run declared in its manifest.",
    buildable: true,
  },
  external: {
    id: "external",
    label: "Imported table",
    description: "An uploaded XLSX or CSV mapped onto known columns and roles.",
    buildable: false,
  },
  derived: {
    id: "derived",
    label: "Analysis output",
    description: "A table written by an analysis run.",
    buildable: false,
  },
};

/**
 * Table kinds describe the shape of a table so views and kits can accept any
 * dataset that fits, regardless of which pipeline or file it came from.
 */
export interface ExploreTableKindDefinition {
  id: string;
  label: string;
  description: string;
  requiredRoles: ExploreRole[];
  optionalRoles: ExploreRole[];
  /** Column-name hints used to suggest a role map for a new dataset. */
  roleHints: Record<ExploreRole, string[]>;
}

const NO_HINTS: Record<ExploreRole, string[]> = {
  sample: [],
  subject: [],
  timepoint: [],
  group: [],
  taxon: [],
  taxon_id: [],
  rank: [],
  value: [],
  count: [],
  date: [],
};

export const TABLE_KIND_DEFINITIONS: Record<string, ExploreTableKindDefinition> = {
  "taxon-abundance-long": {
    id: "taxon-abundance-long",
    label: "Taxon relative abundance (long)",
    description: "Per-sample taxonomic relative abundances, not read counts.",
    requiredRoles: ["sample", "taxon", "value"],
    optionalRoles: ["subject", "timepoint", "group", "taxon_id", "rank"],
    roleHints: {
      ...NO_HINTS,
      sample: ["sample_db_id", "sample_id"],
      taxon: ["TAXPATHSN", "taxon", "clade_name"],
      taxon_id: ["TAXID", "taxon_id"],
      rank: ["RANK", "rank"],
      value: ["PERCENTAGE", "relative_abundance", "abundance"],
      group: ["cohort_group", "group"],
      subject: ["subject", "host_subject_id"],
      timepoint: ["timepoint", "collection_day"],
    },
  },
  "taxon-profile-long": {
    id: "taxon-profile-long",
    label: "Taxon profile (long)",
    description: "One row per taxon detected in one sample, with read counts or abundances.",
    requiredRoles: ["sample", "taxon", "count"],
    optionalRoles: ["subject", "timepoint", "group", "taxon_id", "rank", "value"],
    roleHints: {
      ...NO_HINTS,
      sample: ["id_mapped", "A-ID", "sampleId", "sample_id", "sampleName", "sample_name", "library", "sample"],
      subject: ["subject", "patient", "patient_clean", "host_subject_id", "subject_id"],
      timepoint: ["timepoint", "relDay", "rel_day", "day", "visit"],
      group: ["sampletype", "sample_type", "specimen", "sample", "group", "site"],
      taxon: ["taxonName", "speciesName", "taxon", "species", "name"],
      taxon_id: ["taxonID", "taxon_id", "speciesTaxID", "taxid", "ncbi_taxid"],
      rank: ["taxRank", "rank"],
      value: ["abundance", "RA", "relative_abundance", "perctReads", "fraction"],
      count: ["numReads", "reads", "count", "read_count", "n_reads"],
    },
  },
  "sample-summary": {
    id: "sample-summary",
    label: "Sample summary",
    description: "One row per sample with summary statistics.",
    requiredRoles: ["sample"],
    optionalRoles: ["subject", "timepoint", "group", "value", "count", "date"],
    roleHints: {
      ...NO_HINTS,
      sample: ["sample", "sampleId", "sample_id", "sampleName", "sample_name", "id"],
      subject: ["subject", "patient", "host_subject_id"],
      timepoint: ["timepoint", "day", "visit"],
      group: ["group", "condition", "sampletype", "sample_type"],
      count: ["reads", "read_count", "numReads", "total_reads"],
      value: ["value", "score", "quality"],
      date: ["date", "collection_date", "collected"],
    },
  },
};

export function getTableKind(id: string | null | undefined): ExploreTableKindDefinition | null {
  if (!id) return null;
  return TABLE_KIND_DEFINITIONS[id] ?? null;
}

/**
 * Suggest a role map for a set of column keys using the table kind's hints.
 * Matching is case-insensitive and ignores punctuation, so `A-ID` matches
 * `a_id` and `% humanPert` never matches anything by accident.
 */
export function suggestRoles(
  columnKeys: string[],
  tableKindId: string | null | undefined
): Partial<Record<ExploreRole, string>> {
  const kind = getTableKind(tableKindId) ?? TABLE_KIND_DEFINITIONS["sample-summary"];
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalized = new Map(columnKeys.map((key) => [normalize(key), key] as const));
  const result: Partial<Record<ExploreRole, string>> = {};
  const used = new Set<string>();
  for (const role of [...kind.requiredRoles, ...kind.optionalRoles]) {
    for (const hint of kind.roleHints[role] ?? []) {
      const match = normalized.get(normalize(hint));
      if (match && !used.has(match)) {
        result[role] = match;
        used.add(match);
        break;
      }
    }
  }
  return result;
}

export function missingRequiredRoles(
  roles: Partial<Record<ExploreRole, string>>,
  tableKindId: string | null | undefined
): ExploreRole[] {
  const kind = getTableKind(tableKindId);
  if (!kind) return [];
  return kind.requiredRoles.filter((role) => !roles[role]);
}

// ---------------------------------------------------------------------------
// Fit checks shared by the analysis wizard and the canvas.
// ---------------------------------------------------------------------------

export type DatasetFit = { ok: true } | { ok: false; reason: "table-kind"; tableKind: string } | { ok: false; reason: "roles"; missing: ExploreRole[] }
  | { ok: false; reason: "contract"; message: string };

/** Whether a table can be bound to a kit input: right table kind, required roles mapped. */
export function datasetFitsInput(
  dataset: { tableKind: string | null; roles: ExploreRoleMap; schema?: ExploreSchema },
  input: { tableKind?: string | null; requiredRoles: ExploreRole[] } & InputRequirements
): DatasetFit {
  if (input.tableKind && dataset.tableKind !== input.tableKind) return { ok: false, reason: "table-kind", tableKind: input.tableKind };
  const missing = input.requiredRoles.filter((role) => !dataset.roles[role]);
  if (missing.length > 0) return { ok: false, reason: "roles", missing };
  const reject = (message: string): DatasetFit => ({ ok: false, reason: "contract", message });
  if (input.schemaId && dataset.schema?.schemaId !== input.schemaId) return reject(`Needs data schema ${input.schemaId}.`);
  if (input.schemaVersions && !input.schemaVersions.includes(dataset.schema?.schemaVersion ?? "")) return reject(`Needs schema version ${input.schemaVersions.join(" or ")}.`);
  if (input.rowEntity && dataset.schema?.rowEntity !== input.rowEntity) return reject(`Needs one row per ${input.rowEntity}.`);
  const requirements = [
    ...Object.entries(input.requiredColumns ?? {}),
    ...Object.entries(input.requiredRoleTypes ?? {}).map(([role, requirement]) => [dataset.roles[role as ExploreRole] ?? `(${role} role)`, requirement] as const),
  ];
  for (const [key, requirement] of requirements) {
    const column = dataset.schema?.columns.find(column => column.key === key);
    if (!column) return reject(`Required column ${key} is missing.`);
    if (column.type !== requirement.type) return reject(`${column.label} must contain ${requirement.type} values.`);
    if (requirement.unit && column.unit !== requirement.unit) return reject(`${column.label} needs unit ${requirement.unit}; found ${column.unit ?? "unspecified units"}.`);
  }
  return { ok: true };
}

export function datasetFitMessage(fit: DatasetFit): string | null {
  if (fit.ok) return null;
  if (fit.reason === "contract") return fit.message;
  if (fit.reason === "table-kind") return `Needs a ${TABLE_KIND_DEFINITIONS[fit.tableKind]?.label ?? fit.tableKind} table.`;
  return `Map the ${fit.missing.join(", ")} role${fit.missing.length === 1 ? "" : "s"} first.`;
}

/** Roles each built-in view needs before a table can open in it. */
export const VIEW_ROLE_REQUIREMENTS: Record<"subject-timeline" | "heatmap", ExploreRole[]> = {
  "subject-timeline": ["sample", "subject", "timepoint", "taxon", "count"],
  heatmap: ["sample", "subject", "timepoint", "taxon", "count"],
};

/** The views a table cannot offer yet and the roles that would unlock them. */
export function viewRoleHints(roles: ExploreRoleMap): Array<{ view: "subject-timeline" | "heatmap"; missing: ExploreRole[] }> {
  const hints: Array<{ view: "subject-timeline" | "heatmap"; missing: ExploreRole[] }> = [];
  for (const [view, required] of Object.entries(VIEW_ROLE_REQUIREMENTS) as Array<["subject-timeline" | "heatmap", ExploreRole[]]>) {
    const missing = required.filter((role) => !roles[role]);
    if (missing.length > 0) hints.push({ view, missing });
  }
  return hints;
}
