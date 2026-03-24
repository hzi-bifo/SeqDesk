import { describe, expect, it } from "vitest";

import type { FormFieldDefinition } from "@/types/form-config";
import {
  buildFacilityFieldSections,
  getFacilityFieldSubsectionAnchorId,
  isFacilityFieldSubsectionId,
} from "./facility-sections";

const fields: FormFieldDefinition[] = [
  {
    id: "facility_order_notes",
    type: "textarea",
    label: "Facility Notes",
    name: "facility_notes",
    required: false,
    visible: true,
    order: 0,
    adminOnly: true,
  },
  {
    id: "facility_sample_qc",
    type: "text",
    label: "Internal Sample QC",
    name: "internal_sample_qc",
    required: false,
    visible: true,
    order: 1,
    adminOnly: true,
    perSample: true,
  },
];

describe("facility field sections", () => {
  it("returns no sections when facility fields are disabled", () => {
    expect(
      buildFacilityFieldSections({
        fields,
        includeFacilityFields: false,
        order: null,
      })
    ).toEqual([]);
  });

  it("exposes subsection anchors and validates subsection ids", () => {
    expect(getFacilityFieldSubsectionAnchorId("order-fields")).toBe(
      "facility-fields-order-fields"
    );
    expect(isFacilityFieldSubsectionId("sample-fields")).toBe(true);
    expect(isFacilityFieldSubsectionId("unknown")).toBe(false);
    expect(isFacilityFieldSubsectionId(null)).toBe(false);
  });

  it("returns empty sections for configured facility fields when no order exists", () => {
    expect(
      buildFacilityFieldSections({
        fields,
        includeFacilityFields: true,
        order: null,
      })
    ).toEqual([
      expect.objectContaining({ id: "order-fields", status: "empty" }),
      expect.objectContaining({ id: "sample-fields", status: "empty" }),
    ]);
  });

  it("builds order and sample sections with independent statuses", () => {
    const sections = buildFacilityFieldSections({
      fields,
      includeFacilityFields: true,
      order: {
        customFields: JSON.stringify({ facility_notes: "Checked" }),
        numberOfSamples: 2,
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            sampleAlias: null,
            sampleTitle: null,
            sampleDescription: null,
            scientificName: null,
            taxId: null,
            customFields: JSON.stringify({ internal_sample_qc: "Pass" }),
          },
          {
            id: "sample-2",
            sampleId: "S2",
            sampleAlias: null,
            sampleTitle: null,
            sampleDescription: null,
            scientificName: null,
            taxId: null,
            customFields: null,
          },
        ],
      },
    });

    expect(sections).toEqual([
      expect.objectContaining({ id: "order-fields", status: "complete" }),
      expect.objectContaining({ id: "sample-fields", status: "partial" }),
    ]);
  });

  it("uses system order fields, mapped sample columns, and organism fallbacks", () => {
    const sections = buildFacilityFieldSections({
      fields: [
        {
          id: "order_name",
          type: "text",
          label: "Order Name",
          name: "name",
          required: false,
          visible: true,
          order: 0,
          adminOnly: true,
          isSystem: true,
          systemKey: "name",
        },
        {
          id: "sample_alias",
          type: "text",
          label: "Sample Alias",
          name: "sample_alias",
          required: false,
          visible: true,
          order: 1,
          adminOnly: true,
          perSample: true,
        },
        {
          id: "organism",
          type: "organism",
          label: "Organism",
          name: "organism",
          required: false,
          visible: true,
          order: 2,
          adminOnly: true,
          perSample: true,
        },
      ],
      includeFacilityFields: true,
      order: {
        name: "Facility order",
        customFields: "{bad-json",
        numberOfSamples: 2,
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            sampleAlias: "Alias 1",
            sampleTitle: null,
            sampleDescription: null,
            scientificName: "Homo sapiens",
            taxId: "9606",
            customFields: null,
          },
          {
            id: "sample-2",
            sampleId: "S2",
            sampleAlias: "",
            sampleTitle: null,
            sampleDescription: null,
            scientificName: "",
            taxId: "10090",
            customFields: "{}",
          },
        ],
      } as never,
    });

    expect(sections).toEqual([
      expect.objectContaining({ id: "order-fields", status: "complete" }),
      expect.objectContaining({ id: "sample-fields", status: "partial" }),
    ]);
  });

  it("treats empty arrays and empty organism values as unfilled progress", () => {
    const sections = buildFacilityFieldSections({
      fields: [
        {
          id: "order_tags",
          type: "multiselect",
          label: "Order Tags",
          name: "order_tags",
          required: false,
          visible: true,
          order: 0,
          adminOnly: true,
        },
        {
          id: "organism",
          type: "organism",
          label: "Organism",
          name: "organism",
          required: false,
          visible: true,
          order: 1,
          adminOnly: true,
          perSample: true,
        },
      ],
      includeFacilityFields: true,
      order: {
        customFields: JSON.stringify({ order_tags: [] }),
        numberOfSamples: 1,
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            sampleAlias: null,
            sampleTitle: null,
            sampleDescription: null,
            scientificName: "   ",
            taxId: null,
            customFields: null,
          },
        ],
      } as never,
    });

    expect(sections).toEqual([
      expect.objectContaining({ id: "order-fields", status: "empty" }),
      expect.objectContaining({ id: "sample-fields", status: "empty" }),
    ]);
  });

  it("keeps sample section empty when there are samples but no per-sample facility fields", () => {
    const sections = buildFacilityFieldSections({
      fields: [
        {
          id: "mixs_internal",
          type: "mixs",
          label: "Hidden mixs",
          name: "mixs_internal",
          required: false,
          visible: true,
          order: 0,
          adminOnly: true,
        },
        {
          id: "hidden_notes",
          type: "textarea",
          label: "Hidden Notes",
          name: "hidden_notes",
          required: false,
          visible: false,
          order: 1,
          adminOnly: true,
        },
      ],
      includeFacilityFields: true,
      order: {
        customFields: "{}",
        numberOfSamples: 1,
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            sampleAlias: null,
            sampleTitle: null,
            sampleDescription: null,
            scientificName: null,
            taxId: null,
            customFields: null,
          },
        ],
      } as never,
    });

    expect(sections).toEqual([
      expect.objectContaining({ id: "order-fields", status: "empty" }),
      expect.objectContaining({ id: "sample-fields", status: "empty" }),
    ]);
  });

  it("omits the sample section when an existing order has neither samples nor sample fields", () => {
    const sections = buildFacilityFieldSections({
      fields: [
        {
          id: "facility_order_notes",
          type: "textarea",
          label: "Facility Notes",
          name: "facility_notes",
          required: false,
          visible: true,
          order: 0,
          adminOnly: true,
        },
      ],
      includeFacilityFields: true,
      order: {
        customFields: null,
        numberOfSamples: 0,
        samples: [],
      } as never,
    });

    expect(sections).toEqual([
      expect.objectContaining({ id: "order-fields", status: "empty" }),
    ]);
  });
});
