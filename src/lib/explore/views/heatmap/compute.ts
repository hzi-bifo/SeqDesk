import type { CuratedMembership, SubjectTimelineRow } from "../subject-timeline/types";

export interface HeatmapOptions {
  /** Restrict to one group (specimen type); null uses every row. */
  group?: string | null;
  /** Number of taxa to show. */
  nTaxa?: number;
  /** Values: relative abundance in percent, log10 of it, or raw reads. */
  value?: "ra" | "log10_ra" | "reads";
  /** Order taxa by prevalence (default) or by mean abundance. */
  order?: "prevalence" | "abundance";
  /** Taxa removed before renormalization (curated artifacts). */
  artifacts?: string[];
  /** Curation lists by lower-cased taxon name; when given, each taxon carries the list it is marked with. */
  memberships?: Record<string, CuratedMembership[]>;
}

/** The curation list a taxon is marked with in the views. */
export interface HeatmapCurated {
  listId: string;
  role: "pathogen" | "flora";
  label: string;
  tier: string | null;
  color: string | null;
}

export interface HeatmapPayload {
  samples: Array<{ sample: string; subject: string; group: string; timepoint: number; site: string | null }>;
  taxa: Array<{ taxon: string; prevalence: number; meanRa: number; curated?: HeatmapCurated | null }>;
  /** taxa x samples matrix in the order of `taxa` and `samples`; null where absent. */
  values: Array<Array<number | null>>;
  value: "ra" | "log10_ra" | "reads";
  nSamplesTotal: number;
}

const LOG_PSEUDOCOUNT = 0.01;
const ROLE_ORDER: Record<string, number> = { pathogen: 0, flora: 1 };

function siteRank(membership: CuratedMembership, group: string | null | undefined): number {
  return !membership.site || !group || membership.site.toLowerCase() === group.toLowerCase() ? 0 : 1;
}

/**
 * The list a taxon is marked with: pathogen lists before flora lists, lists for
 * the current group (site) before lists for other sites. Artifact lists never
 * mark a taxon; their taxa are removed instead.
 */
export function pickMembership(memberships: readonly CuratedMembership[] | undefined, group?: string | null): HeatmapCurated | null {
  const candidates = (memberships ?? []).filter((membership) => membership.role === "pathogen" || membership.role === "flora");
  if (candidates.length === 0) return null;
  const [best] = [...candidates].sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || siteRank(a, group) - siteRank(b, group));
  return { listId: best.listId, role: best.role as "pathogen" | "flora", label: best.label, tier: best.tier, color: best.color };
}

/**
 * A taxa-by-samples matrix for the heatmap view. Relative abundance is
 * renormalized per sample after removing artifact taxa, like the subject
 * timeline does, so the two views agree.
 */
export function computeHeatmap(rows: readonly SubjectTimelineRow[], options: HeatmapOptions = {}): HeatmapPayload {
  const nTaxa = Math.min(Math.max(options.nTaxa ?? 35, 1), 200);
  const value = options.value ?? "log10_ra";
  const artifactKeys = new Set((options.artifacts ?? []).map((name) => name.trim().toLowerCase()));
  const kept = rows.filter((row) => (options.group ? row.group === options.group : true) && !artifactKeys.has(row.taxon.trim().toLowerCase()));

  const totals = new Map<string, number>();
  for (const row of kept) totals.set(row.sample, (totals.get(row.sample) ?? 0) + row.count);

  const perSampleTaxon = new Map<string, Map<string, { ra: number; reads: number }>>();
  const sampleInfo = new Map<string, HeatmapPayload["samples"][number]>();
  for (const row of kept) {
    const total = totals.get(row.sample) ?? 0;
    if (!sampleInfo.has(row.sample)) {
      sampleInfo.set(row.sample, { sample: row.sample, subject: row.subject, group: row.group, timepoint: row.timepoint, site: row.site ?? null });
    }
    const bySample = perSampleTaxon.get(row.sample) ?? new Map<string, { ra: number; reads: number }>();
    const current = bySample.get(row.taxon) ?? { ra: 0, reads: 0 };
    current.reads += row.count;
    current.ra += total > 0 ? (100 * row.count) / total : 0;
    bySample.set(row.taxon, current);
    perSampleTaxon.set(row.sample, bySample);
  }

  const samples = [...sampleInfo.values()].sort(
    (a, b) => a.group.localeCompare(b.group) || a.subject.localeCompare(b.subject) || a.timepoint - b.timepoint || a.sample.localeCompare(b.sample)
  );
  const nSamples = samples.length;
  const taxonStats = new Map<string, { present: number; raSum: number }>();
  for (const bySample of perSampleTaxon.values()) {
    for (const [taxon, entry] of bySample) {
      const stats = taxonStats.get(taxon) ?? { present: 0, raSum: 0 };
      if (entry.ra > 0) stats.present += 1;
      stats.raSum += entry.ra;
      taxonStats.set(taxon, stats);
    }
  }
  const taxa = [...taxonStats.entries()]
    .map(([taxon, stats]) => ({ taxon, prevalence: nSamples ? stats.present / nSamples : 0, meanRa: nSamples ? stats.raSum / nSamples : 0 }))
    .sort((a, b) =>
      options.order === "abundance"
        ? b.meanRa - a.meanRa || b.prevalence - a.prevalence || a.taxon.localeCompare(b.taxon)
        : b.prevalence - a.prevalence || b.meanRa - a.meanRa || a.taxon.localeCompare(b.taxon)
    )
    .slice(0, nTaxa);

  const values = taxa.map((entry) =>
    samples.map((sample) => {
      const cell = perSampleTaxon.get(sample.sample)?.get(entry.taxon);
      if (!cell || cell.ra <= 0) return null;
      if (value === "reads") return Math.round(cell.reads * 1000) / 1000;
      if (value === "ra") return Math.round(cell.ra * 1000) / 1000;
      return Math.round(Math.log10(cell.ra + LOG_PSEUDOCOUNT) * 1000) / 1000;
    })
  );

  return {
    samples,
    taxa: taxa.map((entry) => ({
      ...entry,
      prevalence: Math.round(entry.prevalence * 1000) / 1000,
      meanRa: Math.round(entry.meanRa * 1000) / 1000,
      ...(options.memberships ? { curated: pickMembership(options.memberships[entry.taxon.trim().toLowerCase()], options.group) } : {}),
    })),
    values,
    value,
    nSamplesTotal: nSamples,
  };
}
