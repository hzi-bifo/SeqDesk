/**
 * Subject-timeline view: input contract and payload shapes.
 *
 * The compute functions port the INDIVO Explorer's per-patient timeline payloads
 * (analysis.py: patients_table / patient_composition / patient_highlights) to pure
 * TypeScript. The payloads deliberately keep the Python key names (patient,
 * sampletype, ...) so golden comparisons against the reference are direct.
 *
 * Keep this file free of server-only imports so client components can use it.
 */

export interface SubjectTimelineRow {
  /** library id (INDIVO id_mapped) */
  sample: string;
  /** subject id (INDIVO patient_clean) */
  subject: string;
  /** integer study day (INDIVO relDay) */
  timepoint: number;
  /** specimen compartment (INDIVO sampletype), e.g. "Urine" | "Ascites" | "BAL" */
  group: string;
  /** taxon name (INDIVO taxonName) */
  taxon: string;
  taxonId?: string | null;
  superkingdom?: string | null;
  /** assigned reads (INDIVO numReads), may be fractional */
  count: number;
  /** INDIVO site letter or null */
  site?: string | null;
  /** INDIVO depletion_code ("hd" | "nd" | "zymo" | "unknown") */
  protocol?: string | null;
}

export interface CuratedMembership {
  listId: string;
  label: string;
  role: "pathogen" | "flora" | "artifact";
  site: string | null;
  tier: string | null;
  color: string | null;
}

export interface SubjectTimelineCuration {
  /**
   * taxon name (case-insensitive key) -> memberships, equivalent of
   * curation.classification(). The insertion order of the keys is the curated
   * priority order used to break ties among equally abundant hits (INDIVO orders
   * candidates list-by-list, entry-by-entry).
   */
  memberships: Record<string, CuratedMembership[]>;
  /** names removed from composition and RA-renormalized (role artifact) */
  artifacts: string[];
}

export interface SubjectTimelineOptions {
  /** groups treated as the primary compartments, INDIVO uses ["Urine", "Ascites"] */
  primaryGroups?: string[];
  /** number of top taxa for the legacy stacked payload, INDIVO N_TOP_TAXA (18) */
  topTaxa?: number;
}

/** One subject of the overview table (analysis.patients_table). */
export interface SubjectsTableEntry {
  patient: string;
  site: string;
  n_samples: number;
  n_days: number;
  n_paired_days: number;
  day_min: number;
  day_max: number;
  span: number;
  sampletypes: string[];
  days_by_sampletype: Record<string, number[]>;
}

export interface SubjectsTablePayload {
  day_min: number;
  day_max: number;
  patients: SubjectsTableEntry[];
}

/** Per collection day library support (analysis.patient_composition day_support). */
export interface DaySupportEntry {
  day: number;
  n_libraries: number;
  n_profiled_libraries: number;
  assigned_reads: number;
  retained_assigned_reads: number;
  retained_fraction: number | null;
  depletion_protocols: string[];
  mixed_depletion: boolean;
}

export interface CompositionAggregation {
  composition: string;
  reads: string;
  zero_retained_libraries_in_composition: boolean;
}

export interface TaxonSeries {
  ra: number[];
  reads: number[];
}

/** analysis.patient_composition payload. `site` is absent when the subject has no rows in the group. */
export interface SubjectCompositionPayload {
  patient: string;
  sampletype: string;
  site?: string;
  days: number[];
  taxa: string[];
  stacked: Record<string, number[]>;
  stacked_reads: Record<string, number[]>;
  n_samples: number;
  n_samples_by_day: number[];
  series: Record<string, TaxonSeries>;
  collection_days: number[];
  n_libraries: number;
  day_support: DaySupportEntry[];
  aggregation: CompositionAggregation;
  /** The curation list each shown taxon is marked with (pathogen or flora lists only). */
  curated?: Record<string, { role: "pathogen" | "flora"; label: string; color: string | null }>;
}

/** A curated taxon's peak library-level detection (analysis.patient_highlights _role_hit). */
export interface RoleHit {
  name: string;
  peak_ra: number;
  day: number;
  sampletype: string;
  tier: string | null;
  color: string | null;
}

export interface CuratedHitMembership {
  list_id: string;
  label: string | null;
  tier: string | null;
  role: string;
  color: string | null;
}

export interface CuratedHit {
  name: string;
  peak_ra: number;
  day: number;
  sampletype: string;
  memberships: CuratedHitMembership[];
}

export interface DominantTaxon {
  day: number;
  taxon: string;
  ra: number;
}

export interface Transition {
  from_day: number;
  to_day: number;
  value: number;
}

export interface GroupShift {
  n_days: number;
  transitions: Transition[];
  max_turnover: Transition | null;
  n_dominance_changes: number;
  dominant_first: DominantTaxon | null;
  dominant_last: DominantTaxon | null;
}

/** analysis.patient_highlights payload. */
export interface SubjectHighlightsPayload {
  patient: string;
  pathogens: RoleHit[];
  clinical_interest: RoleHit[];
  flora: RoleHit[];
  curated_hits: CuratedHit[];
  shifts: Record<string, GroupShift>;
}
