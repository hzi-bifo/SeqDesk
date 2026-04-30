import { describe, expect, it } from "vitest";

import type { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";

import {
  ORDER_DETAILS_SECTION_ID,
  ORDER_SEQUENCING_SECTION_ID,
  getFixedOrderSections,
  normalizeOrderFieldSectionId,
  normalizeOrderFormSchema,
} from "./fixed-sections";

const legacyGroups: FormFieldGroup[] = [
  {
    id: "group_project_info",
    name: "Project Information",
    order: 0,
  },
  {
    id: "group_tech_setup",
    name: "Sequencing Setup",
    description: "Instrument and library configuration",
    order: 1,
  },
];

describe("fixed order sections", () => {
  it("maps legacy sequencing groups into the fixed sequencing section", () => {
    const field: FormFieldDefinition = {
      id: "field_platform",
      type: "text",
      label: "Platform notes",
      name: "platform_notes",
      required: false,
      visible: true,
      order: 0,
      groupId: "group_tech_setup",
    };

    expect(normalizeOrderFieldSectionId(field, legacyGroups)).toBe(
      ORDER_SEQUENCING_SECTION_ID
    );
  });

  it("maps legacy non-sequencing groups into the fixed details section", () => {
    const field: FormFieldDefinition = {
      id: "field_project",
      type: "text",
      label: "Project Code",
      name: "project_code",
      required: false,
      visible: true,
      order: 0,
      groupId: "group_project_info",
    };

    expect(normalizeOrderFieldSectionId(field, legacyGroups)).toBe(
      ORDER_DETAILS_SECTION_ID
    );
  });

  it("keeps per-sample fields out of fixed user sections", () => {
    const field: FormFieldDefinition = {
      id: "field_sample_alias",
      type: "text",
      label: "Sample Alias",
      name: "sample_alias",
      required: false,
      visible: true,
      order: 0,
      perSample: true,
      groupId: "group_tech_setup",
    };

    expect(normalizeOrderFieldSectionId(field, legacyGroups)).toBe(
      "group_tech_setup"
    );
  });

  it("returns the fixed sections and rewrites legacy field assignments", () => {
    const fields: FormFieldDefinition[] = [
      {
        id: "field_library",
        type: "select",
        label: "Library Strategy",
        name: "libraryStrategy",
        required: false,
        visible: true,
        order: 0,
        groupId: "group_tech_setup",
      },
      {
        id: "field_project",
        type: "text",
        label: "Project Code",
        name: "project_code",
        required: false,
        visible: true,
        order: 1,
        groupId: "group_project_info",
      },
    ];

    const normalized = normalizeOrderFormSchema({
      fields,
      groups: legacyGroups,
    });

    expect(normalized.groups).toEqual(getFixedOrderSections());
    expect(normalized.fields.map((field) => field.groupId)).toEqual([
      ORDER_SEQUENCING_SECTION_ID,
      ORDER_DETAILS_SECTION_ID,
    ]);
  });

  it("normalizes special field types to the scope rendered by the order wizard", () => {
    const fields: FormFieldDefinition[] = [
      {
        id: "field_organism",
        type: "organism",
        label: "Organism",
        name: "_organism",
        required: true,
        visible: true,
        order: 0,
        perSample: false,
      },
      {
        id: "field_barcode",
        type: "barcode",
        label: "Barcode",
        name: "_barcode",
        required: false,
        visible: true,
        order: 1,
        perSample: false,
      },
      {
        id: "field_funding",
        type: "funding",
        label: "Funding",
        name: "_funding",
        required: false,
        visible: true,
        order: 2,
        perSample: true,
      },
      {
        id: "field_seqtech",
        type: "sequencing-tech",
        label: "Sequencing Technology",
        name: "_sequencing_tech",
        required: false,
        visible: true,
        order: 3,
        perSample: true,
      },
    ];

    const normalized = normalizeOrderFormSchema({ fields });

    expect(
      normalized.fields.find((field) => field.id === "field_organism")?.perSample
    ).toBe(true);
    expect(
      normalized.fields.find((field) => field.id === "field_barcode")?.perSample
    ).toBe(true);
    expect(
      normalized.fields.find((field) => field.id === "field_funding")?.perSample
    ).toBe(false);
    expect(
      normalized.fields.find((field) => field.id === "field_seqtech")?.perSample
    ).toBe(false);
  });
});
