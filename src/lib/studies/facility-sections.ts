import type { FormFieldDefinition } from "@/types/form-config";
import type { OrderProgressCompletionStatus } from "@/lib/orders/progress-status";

export const STUDY_FACILITY_FIELD_SUBSECTIONS = [
  {
    id: "study-fields",
    label: "Study Fields",
    description: "Internal study-level facility data",
  },
  {
    id: "sample-fields",
    label: "Sample Fields",
    description: "Internal per-sample facility data",
  },
] as const;

export type StudyFacilityFieldSubsectionId =
  (typeof STUDY_FACILITY_FIELD_SUBSECTIONS)[number]["id"];

export interface StudyFacilityFieldSection {
  id: StudyFacilityFieldSubsectionId;
  label: string;
  description: string;
  status: OrderProgressCompletionStatus;
}

export interface StudyFacilityStatusSample {
  id: string;
  checklistData: string | null;
}

export interface StudyFacilityStatusStudy {
  studyMetadata: string | null;
  samples: StudyFacilityStatusSample[];
}

interface BuildStudyFacilityFieldSectionsOptions {
  fields: FormFieldDefinition[];
  study: StudyFacilityStatusStudy | null;
  includeFacilityFields?: boolean;
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed JSON and fall back to an empty object.
  }

  return {};
}

function hasProgressValue(value: unknown): boolean {
  return !(
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function toCompletionStatus(
  filled: number,
  total: number
): OrderProgressCompletionStatus {
  if (filled <= 0) return "empty";
  if (total > 0 && filled >= total) return "complete";
  return "partial";
}

export function getStudyFacilityFieldSubsectionAnchorId(
  subsectionId: StudyFacilityFieldSubsectionId
): string {
  return `study-facility-fields-${subsectionId}`;
}

export function isStudyFacilityFieldSubsectionId(
  value: string | null
): value is StudyFacilityFieldSubsectionId {
  return STUDY_FACILITY_FIELD_SUBSECTIONS.some((section) => section.id === value);
}

export function buildStudyFacilityFieldSections({
  fields,
  study,
  includeFacilityFields = false,
}: BuildStudyFacilityFieldSectionsOptions): StudyFacilityFieldSection[] {
  if (!includeFacilityFields) {
    return [];
  }

  const visibleAdminFields = fields.filter((field) => field.visible && field.adminOnly);
  const studyFields = visibleAdminFields.filter(
    (field) => !field.perSample && field.name !== "_sample_association"
  );
  const sampleFields = visibleAdminFields
    .filter((field) => field.perSample)
    .slice()
    .sort((a, b) => a.order - b.order);

  if (!study) {
    return STUDY_FACILITY_FIELD_SUBSECTIONS.filter((section) =>
      section.id === "study-fields" ? studyFields.length > 0 : sampleFields.length > 0
    ).map((section) => ({
      ...section,
      status: "empty" satisfies OrderProgressCompletionStatus,
    }));
  }

  const parsedStudyMetadata = parseJsonObject(study.studyMetadata);
  const parsedChecklistDataBySample = Object.fromEntries(
    study.samples.map((sample) => [sample.id, parseJsonObject(sample.checklistData)])
  ) as Record<string, Record<string, unknown>>;

  const sections: StudyFacilityFieldSection[] = [];

  const filledStudyFields = studyFields.filter((field) =>
    hasProgressValue(parsedStudyMetadata[field.name])
  ).length;
  sections.push({
    ...STUDY_FACILITY_FIELD_SUBSECTIONS[0],
    status: toCompletionStatus(filledStudyFields, studyFields.length),
  });

  if (sampleFields.length > 0 || study.samples.length > 0) {
    if (study.samples.length === 0 || sampleFields.length === 0) {
      sections.push({
        ...STUDY_FACILITY_FIELD_SUBSECTIONS[1],
        status: "empty",
      });
    } else {
      let filled = 0;
      let total = 0;

      for (const sample of study.samples) {
        for (const field of sampleFields) {
          total += 1;
          if (hasProgressValue(parsedChecklistDataBySample[sample.id]?.[field.name])) {
            filled += 1;
          }
        }
      }

      sections.push({
        ...STUDY_FACILITY_FIELD_SUBSECTIONS[1],
        status: toCompletionStatus(filled, total),
      });
    }
  }

  return sections;
}
