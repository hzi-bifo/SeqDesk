import { describe, expect, it } from "vitest";

import type { FormFieldDefinition } from "@/types/form-config";
import { buildFacilityFieldSections } from "./facility-sections";

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
});
