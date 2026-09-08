import type { ExploreRoleMap, ExploreRowRecord } from "../../types";
import type { CuratedMembership, SubjectTimelineCuration, SubjectTimelineRow } from "./types";

export const SUBJECT_TIMELINE_REQUIRED_ROLES = ["sample", "subject", "timepoint", "taxon", "count"] as const;

const SUPERKINGDOM_COLUMNS = ["superkingdom", "domain", "kingdom"];
const SITE_COLUMNS = ["site", "study_site", "center"];
const PROTOCOL_COLUMNS = ["depletion_protocol", "depletion", "protocol"];
const COHORT_COLUMNS = ["cohort"];
const ISOLATE_COLUMNS = ["is_isolate", "isIsolate", "isolate"];

function pick(columns: string[], candidates: string[]): string | null {
  const lower = new Map(columns.map((column) => [column.toLowerCase(), column] as const));
  for (const candidate of candidates) {
    const match = lower.get(candidate.toLowerCase());
    if (match) return match;
  }
  return null;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out ? out : null;
}

function truthy(value: unknown): boolean {
  if (value === true || value === 1) return true;
  const lower = String(value ?? "").trim().toLowerCase();
  return lower === "1" || lower === "true" || lower === "yes";
}

export interface SubjectTimelineAdapterResult {
  rows: SubjectTimelineRow[];
  dropped: { missingKeys: number; control: number; isolate: number };
  missingRoles: string[];
}

/**
 * Turn dataset rows plus their role map into the subject-timeline contract.
 * Rows that are controls (cohort column) or isolates (isolate flag) or that
 * lack a subject, timepoint, taxon or sample are dropped and counted.
 */
export function adaptRowsForSubjectTimeline(
  records: ExploreRowRecord[],
  roles: ExploreRoleMap,
  columns: string[]
): SubjectTimelineAdapterResult {
  const missingRoles = SUBJECT_TIMELINE_REQUIRED_ROLES.filter((role) => !roles[role]);
  if (missingRoles.length > 0) return { rows: [], dropped: { missingKeys: 0, control: 0, isolate: 0 }, missingRoles };

  const sampleKey = roles.sample!;
  const subjectKey = roles.subject!;
  const timepointKey = roles.timepoint!;
  const taxonKey = roles.taxon!;
  const countKey = roles.count!;
  const groupKey = roles.group ?? null;
  const taxonIdKey = roles.taxon_id ?? null;
  const superkingdomKey = pick(columns, SUPERKINGDOM_COLUMNS);
  const siteKey = pick(columns, SITE_COLUMNS);
  const protocolKey = pick(columns, PROTOCOL_COLUMNS);
  const cohortKey = pick(columns, COHORT_COLUMNS);
  const isolateKey = pick(columns, ISOLATE_COLUMNS);

  const rows: SubjectTimelineRow[] = [];
  const dropped = { missingKeys: 0, control: 0, isolate: 0 };
  for (const record of records) {
    const data = record.data;
    if (cohortKey && String(data[cohortKey] ?? "").toLowerCase() === "control") {
      dropped.control += 1;
      continue;
    }
    if (isolateKey && truthy(data[isolateKey])) {
      dropped.isolate += 1;
      continue;
    }
    const sample = text(data[sampleKey]);
    const subject = text(data[subjectKey]);
    const taxon = text(data[taxonKey]);
    const timepointRaw = data[timepointKey];
    const timepoint = timepointRaw === null || timepointRaw === undefined || timepointRaw === "" ? Number.NaN : Number(timepointRaw);
    const count = Number(data[countKey] ?? Number.NaN);
    if (!sample || !subject || !taxon || !Number.isFinite(timepoint) || !Number.isFinite(count)) {
      dropped.missingKeys += 1;
      continue;
    }
    rows.push({
      sample,
      subject,
      timepoint: Math.trunc(timepoint),
      group: groupKey ? text(data[groupKey]) ?? "Unknown" : "All",
      taxon,
      taxonId: taxonIdKey ? text(data[taxonIdKey]) : null,
      superkingdom: superkingdomKey ? text(data[superkingdomKey]) : null,
      count,
      site: siteKey ? text(data[siteKey]) : null,
      protocol: protocolKey ? text(data[protocolKey]) : null,
    });
  }
  return { rows, dropped, missingRoles: [] };
}

export interface CurationListLike {
  listId: string;
  label: string;
  role: string;
  site: string | null;
  tier: string | null;
  color: string | null;
  entries: string[];
}

/** Build the view's curation input from the scope's curation lists. */
export function curationFromLists(lists: CurationListLike[]): SubjectTimelineCuration {
  const memberships: Record<string, CuratedMembership[]> = {};
  const artifacts = new Set<string>();
  for (const list of lists) {
    if (!["pathogen", "flora", "artifact"].includes(list.role)) continue;
    for (const entry of list.entries) {
      const name = entry.trim();
      if (!name) continue;
      if (list.role === "artifact") {
        artifacts.add(name);
        continue;
      }
      const key = name.toLowerCase();
      const membership: CuratedMembership = {
        listId: list.listId,
        label: list.label,
        role: list.role as "pathogen" | "flora",
        site: list.site,
        tier: list.tier,
        color: list.color,
      };
      (memberships[key] ??= []).push(membership);
    }
  }
  return { memberships, artifacts: [...artifacts].sort() };
}
