import type { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";

export const STUDY_INFORMATION_SECTION_ID = "group_study_info";
export const STUDY_METADATA_SECTION_ID = "group_metadata";
export const STUDY_ADDITIONAL_DETAILS_SECTION_ID = "_ungrouped";

const METADATA_TOKENS = [
  "metadata",
  "mixs",
  "checklist",
  "environment",
  "funding",
];

const METADATA_FIELD_NAMES = new Set([
  "_mixs",
  "checklist_type",
  "checklistType",
  "study_funding",
]);

const FIXED_STUDY_GROUPS: FormFieldGroup[] = [
  {
    id: STUDY_INFORMATION_SECTION_ID,
    name: "Study Information",
    description: "Core study context and descriptive information",
    icon: "FileText",
    order: 0,
  },
  {
    id: STUDY_METADATA_SECTION_ID,
    name: "Metadata",
    description: "Environment, submission, and structured metadata fields",
    icon: "Leaf",
    order: 1,
  },
];

function isUserEditableStudyField(field: FormFieldDefinition): boolean {
  return !field.perSample && !field.adminOnly && field.name !== "_sample_association";
}

export function getFixedStudySections(): FormFieldGroup[] {
  return FIXED_STUDY_GROUPS.map((group) => ({ ...group }));
}

export function getStudyOverviewSectionAnchorId(sectionId: string): string {
  return `study-overview-${sectionId}`;
}

export function normalizeStudyFieldSectionId(
  field: FormFieldDefinition,
  groups: FormFieldGroup[] = getFixedStudySections()
): string | undefined {
  if (!isUserEditableStudyField(field)) {
    return field.groupId;
  }

  if (
    field.groupId === STUDY_INFORMATION_SECTION_ID ||
    field.groupId === STUDY_METADATA_SECTION_ID
  ) {
    return field.groupId;
  }

  if (field.type === "mixs" || field.type === "funding") {
    return STUDY_METADATA_SECTION_ID;
  }

  if (METADATA_FIELD_NAMES.has(field.name)) {
    return STUDY_METADATA_SECTION_ID;
  }

  const searchableText = [
    field.name,
    field.label,
    field.helpText,
    field.groupId,
    groups.find((group) => group.id === field.groupId)?.name,
    groups.find((group) => group.id === field.groupId)?.description,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();

  if (METADATA_TOKENS.some((token) => searchableText.includes(token))) {
    return STUDY_METADATA_SECTION_ID;
  }

  return STUDY_INFORMATION_SECTION_ID;
}

export function normalizeStudyFormFields(
  fields: FormFieldDefinition[],
  groups: FormFieldGroup[] = getFixedStudySections()
): FormFieldDefinition[] {
  return fields.map((field) => {
    const normalizedGroupId = normalizeStudyFieldSectionId(field, groups);
    if (normalizedGroupId === field.groupId) {
      return field;
    }

    return {
      ...field,
      groupId: normalizedGroupId,
    };
  });
}

export function normalizeStudyFormSchema(input: {
  fields: FormFieldDefinition[];
  groups?: FormFieldGroup[];
}): {
  fields: FormFieldDefinition[];
  groups: FormFieldGroup[];
} {
  const sourceGroups =
    input.groups && input.groups.length > 0 ? input.groups : getFixedStudySections();

  return {
    fields: normalizeStudyFormFields(input.fields, sourceGroups),
    groups: getFixedStudySections(),
  };
}
