import type { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";

export const ORDER_FORM_DEFAULTS_VERSION = 1;
export const STUDY_FORM_DEFAULTS_VERSION = 1;

export function hasSequencingTechField(fields: FormFieldDefinition[]): boolean {
  return fields.some(
    (field) => field.type === "sequencing-tech" || field.name === "_sequencing_tech"
  );
}

export function hasMixsField(fields: FormFieldDefinition[]): boolean {
  return fields.some((field) => field.type === "mixs" || field.name === "_mixs");
}

export function getDefaultSequencingTechField(): FormFieldDefinition {
  return {
    id: "field_seqtech_default",
    type: "sequencing-tech",
    label: "Sequencing Technology",
    name: "_sequencing_tech",
    required: false,
    visible: true,
    helpText: "Select the sequencing technology for your samples",
    order: 1,
    groupId: "group_sequencing",
    moduleSource: "sequencing-tech",
  };
}

export function getDefaultStudyMixsField(
  fields: FormFieldDefinition[],
  groups: FormFieldGroup[]
): FormFieldDefinition {
  const metadataGroupId = groups.find((group) =>
    group.name.toLowerCase().includes("metadata")
  )?.id;
  const nextOrder =
    fields
      .filter((field) => !field.perSample)
      .reduce((maxOrder, field) => Math.max(maxOrder, field.order), -1) + 1;

  return {
    id: "field_mixs_default",
    type: "mixs",
    label: "MIxS Metadata",
    name: "_mixs",
    required: false,
    visible: true,
    helpText: "Environment-specific metadata fields following MIxS standards",
    order: nextOrder,
    groupId: metadataGroupId,
    moduleSource: "mixs-metadata",
  };
}

export function ensureOrderModuleDefaultFields(
  fields: FormFieldDefinition[],
  options: { sequencingTech: boolean }
): FormFieldDefinition[] {
  if (!options.sequencingTech || hasSequencingTechField(fields)) {
    return fields;
  }

  return [...fields, getDefaultSequencingTechField()];
}

export function ensureStudyModuleDefaultFields(
  fields: FormFieldDefinition[],
  groups: FormFieldGroup[],
  options: { mixs: boolean }
): FormFieldDefinition[] {
  if (!options.mixs || hasMixsField(fields)) {
    return fields;
  }

  return [...fields, getDefaultStudyMixsField(fields, groups)];
}
