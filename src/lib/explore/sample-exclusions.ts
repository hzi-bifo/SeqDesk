/**
 * Samples left out of a pipeline's samples (identity sheet 96): before a run (part of the sample list), while a pipeline
 * runs (one failed sample, where it works sample by sample) or after it (quality). Each keeps its reason, the person
 * and the date. Kept in the Choose samples step that makes the list, or — for a pipeline that runs on every sample in
 * Data — in the pipeline step's own configuration. No imports, so both step kinds can read it.
 */

export type ExclusionStage = "before" | "during" | "after";
export interface SamplePerson { userId: string; memberId: string | null; name: string | null }
export interface SamplesExclusion {
  sample: string;
  reason: string;
  /** Left out before a run (part of the list), while a pipeline ran, or after it (quality). */
  stage: ExclusionStage;
  by: SamplePerson;
  at: string;
  /** The pipeline step it was left out of (during/after). */
  stepId?: string | null;
  /** Left out after a run: the versions of that pipeline step's tables before and after leaving it out (for Undo). */
  tables?: Array<{ datasetId: string; before: string | null; after: string }>;
}

const rec = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown, max = 200): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

export function personOf(value: unknown): SamplePerson {
  const person = rec(value);
  return { userId: text(person.userId, 80) ?? "", memberId: text(person.memberId, 80), name: text(person.name, 200) };
}

/** Samples left out, as stored, tolerantly. */
export function parseExclusions(raw: unknown): SamplesExclusion[] {
  return (Array.isArray(raw) ? raw : []).slice(0, 5000).flatMap((entry) => {
    const exclusion = rec(entry);
    const sample = text(exclusion.sample, 300);
    const stage = (["before", "during", "after"] as const).find((candidate) => candidate === exclusion.stage) ?? "before";
    const tables = (Array.isArray(exclusion.tables) ? exclusion.tables : []).slice(0, 50).flatMap((table) => {
      const value = rec(table);
      const datasetId = text(value.datasetId, 80), after = text(value.after, 80);
      return datasetId && after ? [{ datasetId, before: text(value.before, 80), after }] : [];
    });
    return sample ? [{ sample, reason: text(exclusion.reason, 500) ?? "Left out", stage, by: personOf(exclusion.by), at: text(exclusion.at, 40) ?? "", stepId: text(exclusion.stepId, 80), ...(tables.length ? { tables } : {}) }] : [];
  });
}

/** "A-17, N-03" or "A-17, N-03, … (12)". */
export function samplesList(samples: string[], max = 4): string {
  return `${samples.slice(0, max).join(", ")}${samples.length > max ? `, … (${samples.length})` : ""}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Left out after QC: below 10,000 reads · Amara · 6 Oct". */
export function exclusionWords(exclusion: Pick<SamplesExclusion, "stage" | "reason" | "by" | "at">): string {
  const at = exclusion.at ? new Date(exclusion.at) : null;
  const day = at && !Number.isNaN(at.getTime()) ? `${at.getDate()} ${MONTHS[at.getMonth()]}` : null;
  const when = exclusion.stage === "after" ? "Left out after QC" : exclusion.stage === "during" ? "Left out while it ran" : "Left out";
  return [`${when}: ${exclusion.reason}`, exclusion.by.name?.split(" ")[0] ?? null, day].filter(Boolean).join(" · ");
}
