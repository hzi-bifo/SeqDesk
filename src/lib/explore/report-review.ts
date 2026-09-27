/**
 * The review of a report page: which sections a person checked and the list of
 * saved versions (identity sheet 48 f3, 84). Kept in ExploreReportReview, apart
 * from the page, so a check never moves the page's updatedAt (the two-editor
 * save guard) and every browser sees the same Released state and versions.
 *
 * Raw SQL keeps this working on a server whose Prisma client predates the table.
 */
import { db } from "@/lib/db";

export interface ReportCheck { by: string; at: string }
export type ReportChecks = Record<string, ReportCheck>;
export interface ReportVersion { n: number; at: string; by: string; title: string; blocks: unknown[]; checked?: boolean }
export interface ReportReview { checks: ReportChecks; versions: ReportVersion[]; updatedAt: string | null }

export const MAX_REPORT_VERSIONS = 40;
/** A save by the same person within ten minutes amends the newest version instead of adding one. */
const AMEND_MS = 10 * 60 * 1000;
const MAX_VERSION_BYTES = 400_000;

const isCheck = (value: unknown): value is ReportCheck =>
  !!value && typeof value === "object" && typeof (value as ReportCheck).by === "string" && typeof (value as ReportCheck).at === "string" &&
  (value as ReportCheck).by.length <= 200 && !Number.isNaN(Date.parse((value as ReportCheck).at));
const sectionId = (id: string) => id.length > 0 && id.length <= 120;

export function parseChecks(raw: unknown): ReportChecks {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([id, value]) => sectionId(id) && isCheck(value)).map(([id, value]) => [id, { by: (value as ReportCheck).by, at: (value as ReportCheck).at }]));
}
export function parseVersions(raw: unknown): ReportVersion[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const value = entry as Partial<ReportVersion> | null;
    if (!value || typeof value.n !== "number" || typeof value.at !== "string" || typeof value.by !== "string" || typeof value.title !== "string" || !Array.isArray(value.blocks)) return [];
    return [{ n: value.n, at: value.at, by: value.by, title: value.title, blocks: value.blocks, ...(value.checked ? { checked: true } : {}) }];
  }).sort((a, b) => a.n - b.n);
}
/** Blocks as a version keeps them: no resolved data, and no stored drawings (a Map's SVG) that would bloat the list. */
export function versionBlocks(blocks: unknown): unknown[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.filter((block) => block && typeof block === "object").map((block) => {
    const { figure: _f, table: _t, available: _a, analysis: _an, finding: _fi, svg: _svg, ...rest } = block as Record<string, unknown>;
    return rest;
  });
}

/** Merge a check change ({section: check | null}) into the stored checks. */
export function mergeChecks(stored: ReportChecks, change: Record<string, unknown>): ReportChecks {
  const next = { ...stored };
  for (const [id, value] of Object.entries(change)) {
    if (!sectionId(id)) continue;
    if (value === null) delete next[id];
    else if (isCheck(value)) next[id] = { by: value.by, at: value.at };
  }
  return next;
}
/** A save: amend the newest version (same person, within ten minutes) or add the next one; the oldest fall off. */
export function appendVersion(list: ReportVersion[], entry: Omit<ReportVersion, "n">): { versions: ReportVersion[]; current: ReportVersion } {
  const last = list[list.length - 1];
  let current: ReportVersion;
  let versions: ReportVersion[];
  if (last && last.by === entry.by && Date.parse(entry.at) - Date.parse(last.at) < AMEND_MS && Date.parse(entry.at) >= Date.parse(last.at)) {
    current = { ...last, ...entry, n: last.n };
    versions = [...list.slice(0, -1), current];
  } else {
    current = { ...entry, n: (last?.n ?? 0) + 1 };
    versions = [...list, current];
  }
  return { versions: versions.slice(-MAX_REPORT_VERSIONS), current };
}

type Row = { checks: unknown; versions: unknown; updatedAt: Date };
const view = (row: Row | null): ReportReview => ({ checks: parseChecks(row?.checks), versions: parseVersions(row?.versions), updatedAt: row ? row.updatedAt.toISOString() : null });

export async function getReportReview(reportId: string): Promise<ReportReview> {
  const rows = await db.$queryRaw<Row[]>`SELECT "checks", "versions", "updatedAt" FROM "ExploreReportReview" WHERE "reportId" = ${reportId}`;
  return view(rows[0] ?? null);
}

/** One read-modify-write per change; a row lock on the row keeps two browsers from losing each other's check. */
async function change(reportId: string, apply: (review: ReportReview) => { checks: ReportChecks; versions: ReportVersion[] }): Promise<ReportReview> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "ExploreReportReview" ("reportId") VALUES (${reportId}) ON CONFLICT ("reportId") DO NOTHING`;
    const rows = await tx.$queryRaw<Row[]>`SELECT "checks", "versions", "updatedAt" FROM "ExploreReportReview" WHERE "reportId" = ${reportId} FOR UPDATE`;
    const next = apply(view(rows[0] ?? null));
    await tx.$executeRaw`UPDATE "ExploreReportReview" SET "checks" = ${JSON.stringify(next.checks)}::jsonb, "versions" = ${JSON.stringify(next.versions)}::jsonb, "updatedAt" = NOW() WHERE "reportId" = ${reportId}`;
    return { ...next, updatedAt: new Date().toISOString() };
  });
}

export async function changeReportChecks(reportId: string, changes: Record<string, unknown>): Promise<ReportReview> {
  return change(reportId, (review) => ({ checks: mergeChecks(review.checks, changes), versions: review.versions }));
}

export class ReportReviewError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function recordReportVersion(reportId: string, raw: Record<string, unknown>): Promise<{ review: ReportReview; current: ReportVersion }> {
  const at = typeof raw.at === "string" && !Number.isNaN(Date.parse(raw.at)) ? raw.at : new Date().toISOString();
  const by = typeof raw.by === "string" ? raw.by.slice(0, 200) : "";
  const title = typeof raw.title === "string" ? raw.title.slice(0, 200) : "";
  const blocks = versionBlocks(raw.blocks);
  if (JSON.stringify(blocks).length > MAX_VERSION_BYTES) throw new ReportReviewError(413, "This version is too large to keep.");
  let current: ReportVersion | null = null;
  const review = await change(reportId, (stored) => {
    const result = appendVersion(stored.versions, { at, by, title, blocks, ...(raw.checked === true ? { checked: true } : {}) });
    current = result.current;
    return { checks: stored.checks, versions: result.versions };
  });
  return { review, current: current! };
}

/**
 * One-time move of what a browser kept before the server stored reviews: checks
 * of sections nobody checked on the server yet, and versions only while the
 * server has none. Nothing already on the server is overwritten.
 */
export async function importReportReview(reportId: string, raw: Record<string, unknown>): Promise<ReportReview> {
  const checks = parseChecks(raw.checks);
  const versions = parseVersions(raw.versions).map((version) => ({ ...version, blocks: versionBlocks(version.blocks) })).slice(-MAX_REPORT_VERSIONS);
  return change(reportId, (stored) => ({
    checks: { ...checks, ...stored.checks },
    versions: stored.versions.length || JSON.stringify(versions).length > MAX_VERSION_BYTES * 4 ? stored.versions : versions,
  }));
}

/** Checks and the current version number of many reports at once, for the reports list. */
export async function reviewSummaries(reportIds: string[]): Promise<Map<string, { checks: ReportChecks; version: number }>> {
  if (!reportIds.length) return new Map();
  const rows = await db.$queryRaw<{ reportId: string; checks: unknown; version: number | null }[]>`SELECT "reportId", "checks", (SELECT MAX((v->>'n')::int) FROM jsonb_array_elements("versions") v) AS "version" FROM "ExploreReportReview" WHERE "reportId" = ANY(${reportIds})`;
  return new Map(rows.map((row) => [row.reportId, { checks: parseChecks(row.checks), version: row.version ?? 1 }]));
}
