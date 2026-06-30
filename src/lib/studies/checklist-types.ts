import type { OrderProgressCompletionStatus } from "@/lib/orders/progress-status";
import { LEGACY_CHECKLIST_ALIASES } from "@/lib/mixs/checklist-aliases";

export const STUDY_CHECKLIST_TYPE_IDS = [
  "human-gut",
  "human-oral",
  "human-skin",
  "human-associated",
  "host-associated",
  "plant-associated",
  "soil",
  "water",
  "wastewater-sludge",
  "air",
  "sediment",
  "microbial-mat",
  "misc-environment",
] as const;

export type StudyChecklistTypeId = (typeof STUDY_CHECKLIST_TYPE_IDS)[number];

const STUDY_CHECKLIST_TYPE_ID_SET = new Set<string>(STUDY_CHECKLIST_TYPE_IDS);

export function normalizeStudyChecklistType(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isStudyChecklistTypeId(value: unknown): value is StudyChecklistTypeId {
  return typeof value === "string" && STUDY_CHECKLIST_TYPE_ID_SET.has(value);
}

export function getStudyChecklistTypeStatus(
  value: unknown
): OrderProgressCompletionStatus {
  const normalizedValue = normalizeStudyChecklistType(value);
  if (!normalizedValue) return "empty";
  return isStudyChecklistTypeId(normalizedValue) ? "complete" : "partial";
}

function normalizeChecklistKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Reverse of LEGACY_CHECKLIST_ALIASES: ENA accession (ERC######) -> canonical slug id.
const ACCESSION_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(LEGACY_CHECKLIST_ALIASES).map(([slug, accession]) => [
    accession.toUpperCase(),
    slug,
  ])
);

/** Canonical slug -> ENA checklist accession (for registry lookups). Passes through a
 *  value that is already an accession or has no mapping. */
export function studyChecklistTypeToAccession(value: string): string {
  return LEGACY_CHECKLIST_ALIASES[value] ?? value;
}

/**
 * Resolve a stored `Study.checklistType` to its canonical slug id, regardless of which
 * surface wrote it. Three formats exist in the wild because the layers disagreed:
 *   - the study edit form stores the slug        ("water")
 *   - the new-study wizard stores the ENA accession ("ERC000024")
 *   - seed/demo data stored the display name      ("Water", "Human Gut")
 * This bridges all three so environment pre-selection works everywhere. Returns "" when
 * unresolvable (e.g. a custom registry checklist with no standard slug).
 */
export function resolveStudyChecklistTypeId(value: unknown): string {
  const raw = normalizeStudyChecklistType(value);
  if (!raw) return "";
  if (isStudyChecklistTypeId(raw)) return raw;
  const byAccession = ACCESSION_TO_SLUG[raw.toUpperCase()];
  if (byAccession) return byAccession;
  const key = normalizeChecklistKey(raw);
  for (const slug of STUDY_CHECKLIST_TYPE_IDS) {
    if (normalizeChecklistKey(slug) === key) return slug;
  }
  return "";
}
