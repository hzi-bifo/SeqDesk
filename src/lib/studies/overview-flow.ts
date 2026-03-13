import type { FormFieldDefinition } from "@/types/form-config";
import type { OrderProgressCompletionStatus } from "@/lib/orders/progress-status";

export const STUDY_OVERVIEW_ASSOCIATED_SAMPLES_SECTION_ID = "samples";
export const STUDY_OVERVIEW_STUDY_DETAILS_SECTION_ID = "details";
export const STUDY_OVERVIEW_ENVIRONMENT_TYPE_SECTION_ID = "environment";
export const STUDY_OVERVIEW_SAMPLE_METADATA_SECTION_ID = "metadata";
export const STUDY_OVERVIEW_REVIEW_SECTION_ID = "review";

export type StudyOverviewFlowSectionId =
  | typeof STUDY_OVERVIEW_ASSOCIATED_SAMPLES_SECTION_ID
  | typeof STUDY_OVERVIEW_STUDY_DETAILS_SECTION_ID
  | typeof STUDY_OVERVIEW_ENVIRONMENT_TYPE_SECTION_ID
  | typeof STUDY_OVERVIEW_SAMPLE_METADATA_SECTION_ID
  | typeof STUDY_OVERVIEW_REVIEW_SECTION_ID;

export interface StudyOverviewFlowSection {
  id: StudyOverviewFlowSectionId;
  label: string;
  status: OrderProgressCompletionStatus;
}

export interface StudyOverviewSampleLike {
  id: string;
  sampleAlias?: string | null;
  sampleTitle?: string | null;
  taxId?: string | null;
  scientificName?: string | null;
  checklistData?: unknown;
  customFields?: unknown;
}

export interface StudyOverviewStudyLike {
  title: string;
  description?: string | null;
  alias?: string | null;
  checklistType?: string | null;
  studyMetadata?: unknown;
  readyForSubmission?: boolean;
  submitted?: boolean;
  samples: StudyOverviewSampleLike[];
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};

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

export function sampleHasStudyOverviewMetadata(sample: StudyOverviewSampleLike): boolean {
  const hasCoreSampleData = [
    sample.taxId,
    sample.scientificName,
    sample.sampleTitle,
    sample.sampleAlias,
  ].some((value) => hasProgressValue(value));
  if (hasCoreSampleData) return true;

  const customFields = parseJsonObject(sample.customFields);
  if (Object.values(customFields).some((value) => hasProgressValue(value))) {
    return true;
  }

  const checklistData = parseJsonObject(sample.checklistData);
  return Object.values(checklistData).some((value) => hasProgressValue(value));
}

export function buildStudyOverviewFlowSections(options: {
  fields: FormFieldDefinition[];
  study: StudyOverviewStudyLike;
  includeAssociatedSamples: boolean;
  includeEnvironmentType: boolean;
  includeSampleMetadata: boolean;
}): StudyOverviewFlowSection[] {
  const {
    fields,
    study,
    includeAssociatedSamples,
    includeEnvironmentType,
    includeSampleMetadata,
  } = options;

  const parsedStudyMetadata = parseJsonObject(study.studyMetadata);
  const visibleStudyDetailFields = fields.filter(
    (field) =>
      field.visible !== false &&
      !field.perSample &&
      !field.adminOnly &&
      field.name !== "_sample_association" &&
      field.type !== "mixs"
  );
  const detailsTotal = 3 + visibleStudyDetailFields.length;
  const detailsFilled =
    [study.title, study.description, study.alias].filter((value) => hasProgressValue(value))
      .length +
    visibleStudyDetailFields.filter((field) =>
      hasProgressValue(parsedStudyMetadata[field.name])
    ).length;

  const sections: StudyOverviewFlowSection[] = [];

  if (includeAssociatedSamples) {
    sections.push({
      id: STUDY_OVERVIEW_ASSOCIATED_SAMPLES_SECTION_ID,
      label: "Associated Samples",
      status: study.samples.length > 0 ? "complete" : "empty",
    });
  }

  sections.push({
    id: STUDY_OVERVIEW_STUDY_DETAILS_SECTION_ID,
    label: "Study Details",
    status: toCompletionStatus(detailsFilled, detailsTotal),
  });

  if (includeEnvironmentType) {
    sections.push({
      id: STUDY_OVERVIEW_ENVIRONMENT_TYPE_SECTION_ID,
      label: "Environment Type",
      status: hasProgressValue(study.checklistType) ? "complete" : "empty",
    });
  }

  if (includeSampleMetadata) {
    const totalSamples = study.samples.length;
    const samplesWithMetadata = study.samples.filter(sampleHasStudyOverviewMetadata).length;
    sections.push({
      id: STUDY_OVERVIEW_SAMPLE_METADATA_SECTION_ID,
      label: "Sample Metadata",
      status:
        totalSamples === 0
          ? "empty"
          : toCompletionStatus(samplesWithMetadata, totalSamples),
    });
  }

  const hasPriorProgress = sections.some((section) => section.status !== "empty");
  sections.push({
    id: STUDY_OVERVIEW_REVIEW_SECTION_ID,
    label: "Review",
    status:
      study.submitted || study.readyForSubmission
        ? "complete"
        : hasPriorProgress
          ? "partial"
          : "empty",
  });

  return sections;
}
