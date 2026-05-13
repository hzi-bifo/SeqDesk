import type { OrderProgressCompletionStatus } from "@/lib/orders/progress-status";

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
