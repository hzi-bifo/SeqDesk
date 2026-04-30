import { describe, expect, it } from "vitest";

import type { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";

import {
  STUDY_INFORMATION_SECTION_ID,
  STUDY_METADATA_SECTION_ID,
  getFixedStudySections,
  normalizeStudyFieldSectionId,
  normalizeStudyFormSchema,
} from "./fixed-sections";

const legacyGroups: FormFieldGroup[] = [
  {
    id: "group_context",
    name: "Study Context",
    order: 0,
  },
  {
    id: "group_environment",
    name: "Environment Metadata",
    description: "Checklist and metadata fields",
    order: 1,
  },
];

describe("fixed study sections", () => {
  it("maps legacy metadata groups into the fixed metadata section", () => {
    const field: FormFieldDefinition = {
      id: "field_env",
      type: "text",
      label: "Environment package",
      name: "environment_package",
      required: false,
      visible: true,
      order: 0,
      groupId: "group_environment",
    };

    expect(normalizeStudyFieldSectionId(field, legacyGroups)).toBe(
      STUDY_METADATA_SECTION_ID
    );
  });

  it("maps legacy non-metadata groups into the fixed study information section", () => {
    const field: FormFieldDefinition = {
      id: "field_pi",
      type: "text",
      label: "Principal Investigator",
      name: "principal_investigator",
      required: false,
      visible: true,
      order: 0,
      groupId: "group_context",
    };

    expect(normalizeStudyFieldSectionId(field, legacyGroups)).toBe(
      STUDY_INFORMATION_SECTION_ID
    );
  });

  it("keeps per-sample, admin-only, and sample association fields out of fixed user sections", () => {
    const perSampleField: FormFieldDefinition = {
      id: "field_collection_date",
      type: "date",
      label: "Collection Date",
      name: "collection_date",
      required: false,
      visible: true,
      order: 0,
      perSample: true,
      groupId: "group_environment",
    };
    const adminOnlyField: FormFieldDefinition = {
      id: "field_internal_notes",
      type: "textarea",
      label: "Internal Notes",
      name: "internal_notes",
      required: false,
      visible: true,
      order: 1,
      adminOnly: true,
      groupId: "group_context",
    };
    const sampleAssociationField: FormFieldDefinition = {
      id: "field_sample_association",
      type: "text",
      label: "Sample Association",
      name: "_sample_association",
      required: false,
      visible: true,
      order: 2,
      groupId: "group_context",
    };

    expect(normalizeStudyFieldSectionId(perSampleField, legacyGroups)).toBe(
      "group_environment"
    );
    expect(normalizeStudyFieldSectionId(adminOnlyField, legacyGroups)).toBe(
      "group_context"
    );
    expect(normalizeStudyFieldSectionId(sampleAssociationField, legacyGroups)).toBe(
      "group_context"
    );
  });

  it("returns the fixed sections and rewrites legacy field assignments", () => {
    const fields: FormFieldDefinition[] = [
      {
        id: "field_env",
        type: "text",
        label: "Environment package",
        name: "environment_package",
        required: false,
        visible: true,
        order: 0,
        groupId: "group_environment",
      },
      {
        id: "field_pi",
        type: "text",
        label: "Principal Investigator",
        name: "principal_investigator",
        required: false,
        visible: true,
        order: 1,
        groupId: "group_context",
      },
    ];

    const normalized = normalizeStudyFormSchema({
      fields,
      groups: legacyGroups,
    });

    expect(normalized.groups).toEqual(getFixedStudySections());
    expect(normalized.fields.map((field) => field.groupId)).toEqual([
      STUDY_METADATA_SECTION_ID,
      STUDY_INFORMATION_SECTION_ID,
    ]);
  });

  it("normalizes module-managed study field types to study-level scope", () => {
    const fields: FormFieldDefinition[] = [
      {
        id: "field_mixs",
        type: "mixs",
        label: "MIxS Checklist",
        name: "_mixs",
        required: true,
        visible: true,
        order: 0,
        perSample: true,
      },
      {
        id: "field_funding",
        type: "funding",
        label: "Funding",
        name: "study_funding",
        required: false,
        visible: true,
        order: 1,
        perSample: true,
      },
      {
        id: "field_collection_date",
        type: "date",
        label: "Collection Date",
        name: "collection_date",
        required: false,
        visible: true,
        order: 2,
        perSample: true,
      },
    ];

    const normalized = normalizeStudyFormSchema({ fields });

    expect(
      normalized.fields.find((field) => field.id === "field_mixs")?.perSample
    ).toBe(false);
    expect(
      normalized.fields.find((field) => field.id === "field_funding")?.perSample
    ).toBe(false);
    expect(
      normalized.fields.find((field) => field.id === "field_collection_date")?.perSample
    ).toBe(true);
  });
});
