/**
 * Per-subject timeline computations, ported from the INDIVO Explorer
 * (nasim-project app/backend/analysis.py: patients_table, patient_composition,
 * patient_highlights). Inputs are already-annotated long rows; the module applies
 * the microbiome() semantics itself (artifact removal + RA renormalization).
 *
 * Everything here is pure and JSON-serializable. Numeric details (Kahan sums for
 * pandas groupby paths, pairwise sums for numpy reductions, Python vs numpy
 * rounding) live in ./helpers so the golden fixtures can be matched exactly.
 */

import {
  brayCurtisSimilarity,
  compareNumbers,
  comparePyStrings,
  dailyMeanProfiles,
  firstArgMax,
  frameRowSum,
  groupBy,
  microbiome,
  numpyRound,
  numpySum,
  pyRound,
  readCount,
  readsByDay,
  siteLabel,
  sortedUnique,
  taxonKey,
  textOrNone,
  topTaxa,
  uniqueInOrder,
  type DailyProfiles,
  type MicrobiomeRow,
} from "./helpers";
import type {
  CompositionAggregation,
  CuratedHit,
  CuratedMembership,
  DaySupportEntry,
  DominantTaxon,
  GroupShift,
  RoleHit,
  SubjectCompositionPayload,
  SubjectHighlightsPayload,
  SubjectTimelineCuration,
  SubjectTimelineOptions,
  SubjectTimelineRow,
  SubjectsTableEntry,
  SubjectsTablePayload,
  Transition,
} from "./types";

export const DEFAULT_PRIMARY_GROUPS: readonly string[] = ["Urine", "Ascites"];
/** INDIVO N_TOP_TAXA */
export const DEFAULT_TOP_TAXA = 18;
/** Flora hits are capped for readability (patient_highlights). */
const FLORA_CAP = 12;

const AGGREGATION: CompositionAggregation = {
  composition: "equal-library mean RA among libraries with retained assignments",
  reads: "sum of retained assigned reads across same-day libraries",
  zero_retained_libraries_in_composition: false,
};

interface ResolvedOptions {
  primaryGroups: readonly string[];
  topTaxa: number;
}

function resolveOptions(options?: SubjectTimelineOptions): ResolvedOptions {
  return {
    primaryGroups: options?.primaryGroups ?? DEFAULT_PRIMARY_GROUPS,
    topTaxa: options?.topTaxa ?? DEFAULT_TOP_TAXA,
  };
}

function countUnique<T>(values: Iterable<T>): number {
  return new Set(values).size;
}

// --------------------------------------------------------------------------- //
//  patients_table
// --------------------------------------------------------------------------- //

/**
 * analysis.patients_table: one row per subject with sampling effort and the actual
 * days per group. `n_paired_days` counts days sampled in every primary group (0 when
 * fewer than two primary groups are configured); INDIVO hardcodes Urine and Ascites.
 */
export function subjectsTable(
  rows: readonly SubjectTimelineRow[],
  options?: SubjectTimelineOptions,
): SubjectsTablePayload {
  const { primaryGroups } = resolveOptions(options);
  let dayMin = 0;
  let dayMax = 0;
  if (rows.length > 0) {
    dayMin = Infinity;
    dayMax = -Infinity;
    for (const row of rows) {
      if (row.timepoint < dayMin) {
        dayMin = row.timepoint;
      }
      if (row.timepoint > dayMax) {
        dayMax = row.timepoint;
      }
    }
  }
  const bySubject = groupBy(rows, (row) => row.subject);
  const patients: SubjectsTableEntry[] = Array.from(bySubject.keys())
    .sort(comparePyStrings)
    .map((subject) => {
      const group = bySubject.get(subject) ?? [];
      const days = sortedUnique(
        group.map((row) => row.timepoint),
        compareNumbers,
      );
      const daysByGroup = new Map<string, Set<number>>();
      for (const row of group) {
        let set = daysByGroup.get(row.group);
        if (!set) {
          set = new Set();
          daysByGroup.set(row.group, set);
        }
        set.add(row.timepoint);
      }
      const sampletypes = Array.from(daysByGroup.keys()).sort(comparePyStrings);
      const days_by_sampletype: Record<string, number[]> = {};
      for (const sampletype of sampletypes) {
        days_by_sampletype[sampletype] = Array.from(daysByGroup.get(sampletype) ?? []).sort(
          compareNumbers,
        );
      }
      let nPairedDays = 0;
      if (primaryGroups.length >= 2) {
        const [first, ...rest] = primaryGroups;
        const firstDays = daysByGroup.get(first) ?? new Set<number>();
        for (const day of firstDays) {
          if (rest.every((name) => daysByGroup.get(name)?.has(day))) {
            nPairedDays += 1;
          }
        }
      }
      return {
        patient: subject,
        site: siteLabel(group[0]?.site),
        n_samples: countUnique(group.map((row) => row.sample)),
        n_days: days.length,
        n_paired_days: nPairedDays,
        day_min: days[0],
        day_max: days[days.length - 1],
        span: days[days.length - 1] - days[0],
        sampletypes,
        days_by_sampletype,
      };
    });
  return { day_min: dayMin, day_max: dayMax, patients };
}

// --------------------------------------------------------------------------- //
//  patient_composition
// --------------------------------------------------------------------------- //

function daySupport(
  raw: readonly SubjectTimelineRow[],
  retained: readonly MicrobiomeRow[],
  collectionDays: readonly number[],
): DaySupportEntry[] {
  const rawByDay = groupBy(raw, (row) => row.timepoint);
  const retainedByDay = groupBy(retained, (row) => row.timepoint);
  return collectionDays.map((day) => {
    const rawDay = rawByDay.get(day) ?? [];
    const retainedDay = retainedByDay.get(day) ?? [];
    const protocols = sortedUnique(
      rawDay.map((row) => textOrNone(row.protocol) ?? "unknown"),
      comparePyStrings,
    );
    // pd.to_numeric(...).fillna(0).sum(): missing counts contribute 0, numpy reduction
    const assigned = numpySum(rawDay.map((row) => (Number.isNaN(row.count) ? 0 : row.count)));
    const retainedReads = numpySum(retainedDay.map((row) => row.count));
    return {
      day,
      n_libraries: countUnique(rawDay.map((row) => row.sample)),
      n_profiled_libraries: countUnique(retainedDay.map((row) => row.sample)),
      assigned_reads: readCount(assigned),
      retained_assigned_reads: readCount(retainedReads),
      retained_fraction: assigned > 0 ? pyRound(retainedReads / assigned, 4) : null,
      depletion_protocols: protocols,
      mixed_depletion: protocols.length > 1,
    };
  });
}

/**
 * analysis.patient_composition(patient, sampletype): the stacked top-taxa payload
 * (cohort-wide top N by summed RA, plus "Other"), the complete per-taxon series and
 * the per-day library support. `stacked` / `series.ra` use numpy rounding (3 and 6
 * decimals), `retained_fraction` uses Python rounding (4 decimals).
 */
export function subjectComposition(
  rows: readonly SubjectTimelineRow[],
  subject: string,
  group: string,
  curation: SubjectTimelineCuration,
  options?: SubjectTimelineOptions,
): SubjectCompositionPayload {
  const { topTaxa: nTop } = resolveOptions(options);
  const raw = rows.filter((row) => row.subject === subject && row.group === group);
  const mv = microbiome(rows, curation);
  const g = mv.filter((row) => row.subject === subject && row.group === group);
  const aggregation = { ...AGGREGATION };
  const collectionDays = sortedUnique(
    raw.map((row) => row.timepoint),
    compareNumbers,
  );
  const support = daySupport(raw, g, collectionDays);

  if (raw.length === 0) {
    return {
      patient: subject,
      sampletype: group,
      days: [],
      taxa: [],
      stacked: {},
      stacked_reads: {},
      n_samples: 0,
      n_samples_by_day: [],
      series: {},
      collection_days: [],
      n_libraries: 0,
      day_support: [],
      aggregation,
    };
  }
  if (g.length === 0) {
    return {
      patient: subject,
      sampletype: group,
      site: siteLabel(raw[0].site),
      days: [],
      taxa: [],
      stacked: {},
      stacked_reads: {},
      n_samples: 0,
      n_samples_by_day: [],
      series: {},
      collection_days: collectionDays,
      n_libraries: countUnique(raw.map((row) => row.sample)),
      day_support: support,
      aggregation,
    };
  }

  const cohortTop = topTaxa(mv, nTop);
  const profiles = dailyMeanProfiles(g);
  const { days, taxa, matrix } = profiles;
  const nDays = days.length;
  const column = new Map(taxa.map((taxon, index) => [taxon, index]));
  const cols = cohortTop.filter((taxon) => column.has(taxon));
  const topSet = new Set(cols);
  const otherColumns = taxa.filter((taxon) => !topSet.has(taxon));
  const reads = readsByDay(g, days, taxa);

  const stacked: Record<string, number[]> = {};
  for (const taxon of cols) {
    const index = column.get(taxon) ?? 0;
    stacked[taxon] = matrix.map((rowValues) => numpyRound(rowValues[index], 3));
  }
  stacked.Other = matrix.map((rowValues) =>
    numpyRound(
      frameRowSum(
        otherColumns.map((taxon) => rowValues[column.get(taxon) ?? 0]),
        nDays,
      ),
      3,
    ),
  );

  const stackedReads: Record<string, number[]> = {};
  for (const taxon of cols) {
    const index = column.get(taxon) ?? 0;
    stackedReads[taxon] = reads.map((rowValues) => rowValues[index]);
  }
  stackedReads.Other = reads.map((rowValues) =>
    frameRowSum(
      otherColumns.map((taxon) => rowValues[column.get(taxon) ?? 0]),
      nDays,
    ),
  );

  // piv.sum(axis=0).sort_values(ascending=False, kind="stable"): column totals are a
  // numpy reduction over the days; ties keep the pivot's sorted column order.
  const totals = taxa.map((_, index) => numpySum(matrix.map((rowValues) => rowValues[index])));
  const patientRank = taxa
    .map((taxon, index) => ({ taxon, index, total: totals[index] }))
    .sort((a, b) => compareNumbers(b.total, a.total));
  const series: SubjectCompositionPayload["series"] = {};
  for (const { taxon, index } of patientRank) {
    series[taxon] = {
      ra: matrix.map((rowValues) => numpyRound(rowValues[index], 6)),
      reads: reads.map((rowValues) => rowValues[index]),
    };
  }

  return {
    patient: subject,
    sampletype: group,
    site: siteLabel(g[0].site),
    days,
    taxa: [...cols, "Other"],
    stacked,
    stacked_reads: stackedReads,
    n_samples: countUnique(g.map((row) => row.sample)),
    n_samples_by_day: profiles.librariesByDay,
    series,
    collection_days: collectionDays,
    n_libraries: countUnique(raw.map((row) => row.sample)),
    day_support: support,
    aggregation,
  };
}

// --------------------------------------------------------------------------- //
//  patient_highlights
// --------------------------------------------------------------------------- //

interface CurationIndex {
  /** taxonKey -> memberships */
  byKey: Map<string, CuratedMembership[]>;
  /** curated keys in priority order (memberships key order) */
  orderedKeys: string[];
}

function indexCuration(curation: SubjectTimelineCuration): CurationIndex {
  const byKey = new Map<string, CuratedMembership[]>();
  const orderedKeys: string[] = [];
  for (const [name, memberships] of Object.entries(curation.memberships)) {
    const key = taxonKey(name);
    const existing = byKey.get(key);
    if (existing) {
      existing.push(...memberships);
    } else {
      byKey.set(key, [...memberships]);
      orderedKeys.push(key);
    }
  }
  return { byKey, orderedKeys };
}

/** curation.pathogen_names() / flora_names(): every taxon with a membership of that role. */
function namesForRole(index: CurationIndex, role: CuratedMembership["role"]): string[] {
  return index.orderedKeys.filter((key) =>
    (index.byKey.get(key) ?? []).some((member) => member.role === role),
  );
}

/**
 * analysis._present_curated_names: the workbook spelling (first occurrence in row
 * order) of every curated taxon present in the rows, in curated order.
 */
function presentCuratedNames(rows: readonly MicrobiomeRow[], curatedKeys: readonly string[]): string[] {
  const present = new Map<string, string>();
  for (const row of rows) {
    const key = taxonKey(row.taxon);
    if (!present.has(key)) {
      present.set(key, row.taxon);
    }
  }
  const names: string[] = [];
  for (const key of curatedKeys) {
    const spelling = present.get(key);
    if (spelling !== undefined) {
      names.push(spelling);
    }
  }
  return names;
}

function roleHit(
  g: readonly MicrobiomeRow[],
  index: CurationIndex,
  taxon: string,
  role: CuratedMembership["role"],
  minRa: number,
): RoleHit | null {
  const members = (index.byKey.get(taxonKey(taxon)) ?? []).filter(
    (member) => member.role === role && Boolean(member.site),
  );
  const eligibleSites = new Set(members.map((member) => member.site));
  const gp = g.filter((row) => row.taxon === taxon && eligibleSites.has(row.group));
  if (gp.length === 0) {
    return null;
  }
  const peak = firstArgMax(gp.map((row) => row.ra));
  const peakRow = gp[peak];
  if (peakRow.ra < minRa) {
    return null;
  }
  const membership = members.find((member) => member.site === peakRow.group);
  return {
    name: taxon,
    peak_ra: pyRound(peakRow.ra, 1),
    day: peakRow.timepoint,
    sampletype: peakRow.group,
    tier: membership?.tier ?? null,
    color: membership?.color ?? null,
  };
}

function roleHits(
  g: readonly MicrobiomeRow[],
  index: CurationIndex,
  role: CuratedMembership["role"],
  minRa: number,
): RoleHit[] {
  const hits: RoleHit[] = [];
  for (const taxon of presentCuratedNames(g, namesForRole(index, role))) {
    const hit = roleHit(g, index, taxon, role, minRa);
    if (hit) {
      hits.push(hit);
    }
  }
  // stable sort: ties keep the curated order
  return hits.sort((a, b) => compareNumbers(b.peak_ra, a.peak_ra));
}

function curatedHits(
  g: readonly MicrobiomeRow[],
  index: CurationIndex,
  profiles: ReadonlyMap<string, DailyProfiles>,
  primaryGroups: readonly string[],
): CuratedHit[] {
  const curatedKeys = uniqueInOrder([
    ...namesForRole(index, "pathogen"),
    ...namesForRole(index, "flora"),
  ]);
  const hits: CuratedHit[] = [];
  for (const taxon of presentCuratedNames(g, curatedKeys)) {
    const memberships = (index.byKey.get(taxonKey(taxon)) ?? []).filter(
      (member) => (member.role === "pathogen" || member.role === "flora") && Boolean(member.site),
    );
    const sites = uniqueInOrder(memberships.map((member) => member.site ?? ""));
    for (const site of sites) {
      const perDay = profiles.get(site);
      if (!perDay) {
        continue;
      }
      const columnIndex = perDay.taxa.indexOf(taxon);
      if (columnIndex < 0) {
        continue;
      }
      const positiveDays: number[] = [];
      const positiveValues: number[] = [];
      perDay.matrix.forEach((rowValues, dayIndex) => {
        if (rowValues[columnIndex] > 0) {
          positiveDays.push(perDay.days[dayIndex]);
          positiveValues.push(rowValues[columnIndex]);
        }
      });
      if (positiveValues.length === 0) {
        continue;
      }
      const peak = firstArgMax(positiveValues);
      hits.push({
        name: taxon,
        peak_ra: pyRound(positiveValues[peak], 6),
        day: positiveDays[peak],
        sampletype: site,
        memberships: memberships
          .filter((member) => member.site === site)
          .map((member) => ({
            list_id: member.listId,
            label: member.label,
            tier: member.tier,
            role: member.role,
            color: member.color,
          })),
      });
    }
  }
  const specimenOrder = (site: string) => {
    const position = primaryGroups.indexOf(site);
    return position < 0 ? primaryGroups.length : position;
  };
  return hits.sort(
    (a, b) =>
      compareNumbers(specimenOrder(a.sampletype), specimenOrder(b.sampletype)) ||
      compareNumbers(b.peak_ra, a.peak_ra) ||
      comparePyStrings(a.name.toLowerCase(), b.name.toLowerCase()),
  );
}

function groupShift(profile: DailyProfiles): GroupShift {
  const { days, taxa, matrix } = profile;
  const dominant: DominantTaxon[] = [];
  if (taxa.length > 0) {
    matrix.forEach((rowValues, dayIndex) => {
      const peak = firstArgMax(rowValues);
      dominant.push({ day: days[dayIndex], taxon: taxa[peak], ra: pyRound(rowValues[peak], 1) });
    });
  }
  const transitions: Transition[] = [];
  let maxTurnover: Transition | null = null;
  for (let i = 1; i < days.length; i++) {
    const before = new Map(taxa.map((taxon, column) => [taxon, matrix[i - 1][column]]));
    const after = new Map(taxa.map((taxon, column) => [taxon, matrix[i][column]]));
    const similarity = brayCurtisSimilarity(before, after);
    if (similarity === null) {
      continue;
    }
    const transition = { from_day: days[i - 1], to_day: days[i], value: pyRound(1 - similarity, 2) };
    transitions.push(transition);
    if (maxTurnover === null || transition.value > maxTurnover.value) {
      maxTurnover = { ...transition };
    }
  }
  let changes = 0;
  for (let i = 1; i < dominant.length; i++) {
    if (dominant[i].taxon !== dominant[i - 1].taxon) {
      changes += 1;
    }
  }
  return {
    n_days: days.length,
    transitions,
    max_turnover: maxTurnover,
    n_dominance_changes: changes,
    dominant_first: dominant.length > 0 ? dominant[0] : null,
    dominant_last: dominant.length > 0 ? dominant[dominant.length - 1] : null,
  };
}

/**
 * analysis.patient_highlights(patient): curated pathogen / flora hits with their
 * peak library-level RA (thresholds 1.0 / 0.0 / 5.0 percent, flora capped at 12),
 * the complete per-compartment curated hit list from the equal-library daily
 * profiles, and per-group community shifts (Bray-Curtis turnover between
 * consecutive days, dominant taxon changes).
 */
export function subjectHighlights(
  rows: readonly SubjectTimelineRow[],
  subject: string,
  curation: SubjectTimelineCuration,
  options?: SubjectTimelineOptions,
): SubjectHighlightsPayload {
  const { primaryGroups } = resolveOptions(options);
  const g = microbiome(rows, curation).filter((row) => row.subject === subject);
  if (g.length === 0) {
    return {
      patient: subject,
      pathogens: [],
      clinical_interest: [],
      flora: [],
      curated_hits: [],
      shifts: {},
    };
  }
  const index = indexCuration(curation);
  const pathogens = roleHits(g, index, "pathogen", 1.0);
  const clinicalInterest = roleHits(g, index, "pathogen", 0.0);
  const flora = roleHits(g, index, "flora", 5.0).slice(0, FLORA_CAP);

  const profiles = new Map<string, DailyProfiles>();
  const byGroup = groupBy(g, (row) => row.group);
  for (const group of Array.from(byGroup.keys()).sort(comparePyStrings)) {
    profiles.set(group, dailyMeanProfiles(byGroup.get(group) ?? []));
  }

  const shifts: Record<string, GroupShift> = {};
  for (const [group, profile] of profiles) {
    shifts[group] = groupShift(profile);
  }

  return {
    patient: subject,
    pathogens,
    clinical_interest: clinicalInterest,
    flora,
    curated_hits: curatedHits(g, index, profiles, primaryGroups),
    shifts,
  };
}
