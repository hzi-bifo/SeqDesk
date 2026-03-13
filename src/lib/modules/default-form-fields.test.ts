import { describe, expect, it } from "vitest";
import type { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";
import {
  ensureOrderModuleDefaultFields,
  ensureStudyModuleDefaultFields,
  getDefaultFacilityQcField,
  getDefaultStudyMixsField,
  hasFacilityQcField,
  hasFacilityInternalNotesField,
  hasFacilitySampleNotesField,
  hasFacilitySampleQcField,
  hasMixsField,
  hasSequencingTechField,
} from "./default-form-fields";

describe("module default form fields", () => {
  it("adds the facility QC field and sequencing tech selector when the order defaults are upgraded", () => {
    const fields: FormFieldDefinition[] = [
      {
        id: "system_platform",
        type: "select",
        label: "Platform",
        name: "platform",
        required: false,
        visible: true,
        order: 0,
        groupId: "group_sequencing",
      },
    ];

    const updated = ensureOrderModuleDefaultFields(fields, {
      sequencingTech: true,
    });

    expect(updated).toHaveLength(6);
    expect(hasFacilityQcField(updated)).toBe(true);
    expect(hasFacilityInternalNotesField(updated)).toBe(true);
    expect(hasFacilitySampleQcField(updated)).toBe(true);
    expect(hasFacilitySampleNotesField(updated)).toBe(true);
    expect(hasSequencingTechField(updated)).toBe(true);
    expect(updated.at(-1)?.name).toBe("_sequencing_tech");
  });

  it("adds the facility QC field even when sequencing tech is disabled", () => {
    const fields: FormFieldDefinition[] = [
      {
        id: "system_platform",
        type: "select",
        label: "Platform",
        name: "platform",
        required: false,
        visible: true,
        order: 0,
        groupId: "group_sequencing",
      },
    ];

    const updated = ensureOrderModuleDefaultFields(fields, {
      sequencingTech: false,
    });

    expect(updated).toHaveLength(5);
    expect(hasFacilityQcField(updated)).toBe(true);
    expect(hasFacilityInternalNotesField(updated)).toBe(true);
    expect(hasFacilitySampleQcField(updated)).toBe(true);
    expect(hasFacilitySampleNotesField(updated)).toBe(true);
    expect(hasSequencingTechField(updated)).toBe(false);
    expect(updated.at(-1)?.name).toBe("facility_sample_notes");
  });

  it("does not duplicate seeded order defaults", () => {
    const fields = ensureOrderModuleDefaultFields([], { sequencingTech: true });

    expect(
      ensureOrderModuleDefaultFields(fields, { sequencingTech: true })
    ).toBe(fields);
  });

  it("backfills missing facility sample defaults into older configs", () => {
    const fields: FormFieldDefinition[] = [
      getDefaultFacilityQcField([]),
      {
        id: "system_sample_alias",
        type: "text",
        label: "Sample Alias",
        name: "sample_alias",
        required: false,
        visible: true,
        order: 0,
        perSample: true,
      },
    ];

    const updated = ensureOrderModuleDefaultFields(fields, {
      sequencingTech: false,
    });

    expect(hasFacilityInternalNotesField(updated)).toBe(true);
    expect(hasFacilitySampleQcField(updated)).toBe(true);
    expect(hasFacilitySampleNotesField(updated)).toBe(true);
  });

  it("adds the study MIxS field to the metadata group", () => {
    const groups: FormFieldGroup[] = [
      { id: "group_study_info", name: "Study Information", order: 0 },
      { id: "group_metadata", name: "Sample Metadata", order: 1 },
    ];
    const fields: FormFieldDefinition[] = [
      {
        id: "study_abstract",
        type: "textarea",
        label: "Study Abstract",
        name: "study_abstract",
        required: false,
        visible: true,
        order: 2,
        groupId: "group_study_info",
      },
    ];

    const updated = ensureStudyModuleDefaultFields(fields, groups, {
      mixs: true,
    });

    expect(updated).toHaveLength(2);
    expect(hasMixsField(updated)).toBe(true);
    expect(updated.at(-1)).toMatchObject({
      name: "_mixs",
      groupId: "group_metadata",
      order: 3,
    });
  });

  it("keeps the MIxS field removable once it already exists in the config", () => {
    const groups: FormFieldGroup[] = [
      { id: "group_metadata", name: "Sample Metadata", order: 1 },
    ];
    const fields: FormFieldDefinition[] = [
      getDefaultStudyMixsField([], groups),
    ];

    expect(
      ensureStudyModuleDefaultFields(fields, groups, { mixs: true })
    ).toBe(fields);
  });
});
