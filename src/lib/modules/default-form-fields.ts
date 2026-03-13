import {
  FACILITY_QC_STATUS_OPTIONS,
  FACILITY_SAMPLE_QC_RESULT_OPTIONS,
  type FormFieldDefinition,
  type FormFieldGroup,
} from "@/types/form-config";

export const ORDER_FORM_DEFAULTS_VERSION = 3;
export const STUDY_FORM_DEFAULTS_VERSION = 1;

export function hasSequencingTechField(fields: FormFieldDefinition[]): boolean {
  return fields.some(
    (field) => field.type === "sequencing-tech" || field.name === "_sequencing_tech"
  );
}

export function hasMixsField(fields: FormFieldDefinition[]): boolean {
  return fields.some((field) => field.type === "mixs" || field.name === "_mixs");
}

export function hasFacilityQcField(fields: FormFieldDefinition[]): boolean {
  return fields.some(
    (field) =>
      field.id === "field_facility_qc_status" || field.name === "facility_qc_status"
  );
}

export function hasFacilityInternalNotesField(fields: FormFieldDefinition[]): boolean {
  return fields.some(
    (field) =>
      field.id === "field_facility_internal_notes" ||
      field.name === "facility_internal_notes"
  );
}

export function hasFacilitySampleQcField(fields: FormFieldDefinition[]): boolean {
  return fields.some(
    (field) =>
      field.id === "field_facility_sample_qc_result" ||
      field.name === "facility_sample_qc_result"
  );
}

export function hasFacilitySampleNotesField(fields: FormFieldDefinition[]): boolean {
  return fields.some(
    (field) =>
      field.id === "field_facility_sample_notes" ||
      field.name === "facility_sample_notes"
  );
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

export function getDefaultFacilityQcField(
  fields: FormFieldDefinition[]
): FormFieldDefinition {
  const nextOrder =
    fields
      .filter((field) => !field.perSample)
      .reduce((maxOrder, field) => Math.max(maxOrder, field.order), -1) + 1;

  return {
    id: "field_facility_qc_status",
    type: "select",
    label: "Internal QC Status",
    name: "facility_qc_status",
    required: false,
    visible: true,
    helpText: "Facility-only QC checkpoint for tracking internal review on this order.",
    options: FACILITY_QC_STATUS_OPTIONS,
    order: nextOrder,
    adminOnly: true,
  };
}

export function getDefaultFacilityInternalNotesField(
  fields: FormFieldDefinition[]
): FormFieldDefinition {
  const nextOrder =
    fields
      .filter((field) => !field.perSample)
      .reduce((maxOrder, field) => Math.max(maxOrder, field.order), -1) + 1;

  return {
    id: "field_facility_internal_notes",
    type: "textarea",
    label: "Internal Notes",
    name: "facility_internal_notes",
    required: false,
    visible: true,
    helpText: "Facility-only notes about intake, coordination, or follow-up for this order.",
    placeholder: "Internal notes for the sequencing team...",
    order: nextOrder,
    adminOnly: true,
  };
}

export function getDefaultFacilitySampleQcField(
  fields: FormFieldDefinition[]
): FormFieldDefinition {
  const nextOrder =
    fields
      .filter((field) => field.perSample)
      .reduce((maxOrder, field) => Math.max(maxOrder, field.order), -1) + 1;

  return {
    id: "field_facility_sample_qc_result",
    type: "select",
    label: "Sample QC Result",
    name: "facility_sample_qc_result",
    required: false,
    visible: true,
    helpText: "Facility-only QC result for this sample after internal review.",
    options: FACILITY_SAMPLE_QC_RESULT_OPTIONS,
    order: nextOrder,
    perSample: true,
    adminOnly: true,
  };
}

export function getDefaultFacilitySampleNotesField(
  fields: FormFieldDefinition[]
): FormFieldDefinition {
  const nextOrder =
    fields
      .filter((field) => field.perSample)
      .reduce((maxOrder, field) => Math.max(maxOrder, field.order), -1) + 1;

  return {
    id: "field_facility_sample_notes",
    type: "textarea",
    label: "Sample Notes",
    name: "facility_sample_notes",
    required: false,
    visible: true,
    helpText: "Facility-only notes for this sample, such as handling issues or follow-up comments.",
    placeholder: "Internal sample notes...",
    order: nextOrder,
    perSample: true,
    adminOnly: true,
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
  let withFacilityDefaults = fields;

  if (!hasFacilityQcField(withFacilityDefaults)) {
    withFacilityDefaults = [
      ...withFacilityDefaults,
      getDefaultFacilityQcField(withFacilityDefaults),
    ];
  }

  if (!hasFacilityInternalNotesField(withFacilityDefaults)) {
    withFacilityDefaults = [
      ...withFacilityDefaults,
      getDefaultFacilityInternalNotesField(withFacilityDefaults),
    ];
  }

  if (!hasFacilitySampleQcField(withFacilityDefaults)) {
    withFacilityDefaults = [
      ...withFacilityDefaults,
      getDefaultFacilitySampleQcField(withFacilityDefaults),
    ];
  }

  if (!hasFacilitySampleNotesField(withFacilityDefaults)) {
    withFacilityDefaults = [
      ...withFacilityDefaults,
      getDefaultFacilitySampleNotesField(withFacilityDefaults),
    ];
  }

  if (
    !options.sequencingTech ||
    hasSequencingTechField(withFacilityDefaults)
  ) {
    return withFacilityDefaults;
  }

  return [...withFacilityDefaults, getDefaultSequencingTechField()];
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
