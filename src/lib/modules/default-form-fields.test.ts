import { describe, expect, it } from "vitest";
import type { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";
import {
  ensureOrderModuleDefaultFields,
  ensureStudyModuleDefaultFields,
  getDefaultStudyMixsField,
  hasMixsField,
  hasSequencingTechField,
} from "./default-form-fields";

describe("module default form fields", () => {
  it("adds the sequencing tech selector when the order defaults are upgraded", () => {
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

    expect(updated).toHaveLength(2);
    expect(hasSequencingTechField(updated)).toBe(true);
    expect(updated.at(-1)?.name).toBe("_sequencing_tech");
  });

  it("does not duplicate the sequencing tech selector", () => {
    const fields: FormFieldDefinition[] = [
      {
        id: "field_seqtech_default",
        type: "sequencing-tech",
        label: "Sequencing Technology",
        name: "_sequencing_tech",
        required: false,
        visible: true,
        order: 1,
        groupId: "group_sequencing",
      },
    ];

    expect(
      ensureOrderModuleDefaultFields(fields, { sequencingTech: true })
    ).toBe(fields);
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
