import {
  DEFAULT_GROUPS,
  type FormFieldDefinition,
  type FormFieldGroup,
} from "@/types/form-config";

export const ORDER_DETAILS_SECTION_ID = "group_details";
export const ORDER_SEQUENCING_SECTION_ID = "group_sequencing";

const SEQUENCING_TOKENS = [
  "sequencing",
  "library",
  "instrument",
  "platform",
  "technology",
  "software",
  "read",
];

const SEQUENCING_FIELD_NAMES = new Set([
  "platform",
  "instrumentModel",
  "libraryStrategy",
  "librarySource",
  "librarySelection",
  "_sequencing_tech",
]);

const SEQUENCING_SYSTEM_KEYS = new Set([
  "platform",
  "instrumentModel",
  "libraryStrategy",
  "librarySource",
  "librarySelection",
]);

export function getFixedOrderSections(): FormFieldGroup[] {
  return DEFAULT_GROUPS.map((group) => ({ ...group }));
}

function isUserEditableOrderField(field: FormFieldDefinition): boolean {
  return !field.perSample && !field.adminOnly && field.type !== "mixs";
}

export function normalizeOrderFieldSectionId(
  field: FormFieldDefinition,
  groups: FormFieldGroup[] = DEFAULT_GROUPS
): string | undefined {
  if (!isUserEditableOrderField(field)) {
    return field.groupId;
  }

  if (
    field.groupId === ORDER_DETAILS_SECTION_ID ||
    field.groupId === ORDER_SEQUENCING_SECTION_ID
  ) {
    return field.groupId;
  }

  if (field.type === "sequencing-tech") {
    return ORDER_SEQUENCING_SECTION_ID;
  }

  if (SEQUENCING_FIELD_NAMES.has(field.name)) {
    return ORDER_SEQUENCING_SECTION_ID;
  }

  if (field.isSystem && field.systemKey && SEQUENCING_SYSTEM_KEYS.has(field.systemKey)) {
    return ORDER_SEQUENCING_SECTION_ID;
  }

  const matchingGroup = groups.find((group) => group.id === field.groupId);
  const groupText = [field.groupId, matchingGroup?.name, matchingGroup?.description]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();

  if (SEQUENCING_TOKENS.some((token) => groupText.includes(token))) {
    return ORDER_SEQUENCING_SECTION_ID;
  }

  return ORDER_DETAILS_SECTION_ID;
}

export function normalizeOrderFormFields(
  fields: FormFieldDefinition[],
  groups: FormFieldGroup[] = DEFAULT_GROUPS
): FormFieldDefinition[] {
  return fields.map((field) => {
    const normalizedGroupId = normalizeOrderFieldSectionId(field, groups);
    if (normalizedGroupId === field.groupId) {
      return field;
    }

    return {
      ...field,
      groupId: normalizedGroupId,
    };
  });
}

export function normalizeOrderFormSchema(input: {
  fields: FormFieldDefinition[];
  groups?: FormFieldGroup[];
}): {
  fields: FormFieldDefinition[];
  groups: FormFieldGroup[];
} {
  const sourceGroups = input.groups && input.groups.length > 0
    ? input.groups
    : DEFAULT_GROUPS;

  return {
    fields: normalizeOrderFormFields(input.fields, sourceGroups),
    groups: getFixedOrderSections(),
  };
}
