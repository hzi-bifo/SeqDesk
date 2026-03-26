import { describe, expect, it } from "vitest";

import type { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";
import {
  computeOrderProgressStepStatuses,
  getOrderProgressIndicatorClassName,
  getOrderProgressIndicatorLabel,
} from "./progress-status";

const groups: FormFieldGroup[] = [
  {
    id: "group_details",
    name: "Order Details",
    description: "Basic information",
    icon: "FileText",
    order: 0,
  },
  {
    id: "group_sequencing",
    name: "Sequencing Information",
    description: "Sequencing setup",
    icon: "Settings",
    order: 1,
  },
];

const fields: FormFieldDefinition[] = [
  {
    id: "field_name",
    type: "text",
    label: "Order Name",
    name: "name",
    required: false,
    visible: true,
    order: 0,
    groupId: "group_details",
    isSystem: true,
    systemKey: "name",
  },
  {
    id: "field_platform",
    type: "select",
    label: "Platform",
    name: "platform",
    required: false,
    visible: true,
    order: 1,
    groupId: "group_sequencing",
    isSystem: true,
    systemKey: "platform",
  },
  {
    id: "field_notes",
    type: "textarea",
    label: "Facility Notes",
    name: "facility_notes",
    required: false,
    visible: true,
    order: 2,
    adminOnly: true,
  },
  {
    id: "field_sample_concentration",
    type: "number",
    label: "Concentration",
    name: "sample_concentration",
    required: false,
    visible: true,
    order: 0,
    perSample: true,
  },
  {
    id: "field_internal_sample_qc",
    type: "text",
    label: "Internal Sample QC",
    name: "internal_sample_qc",
    required: false,
    visible: true,
    order: 1,
    perSample: true,
    adminOnly: true,
  },
];

describe("order progress status", () => {
  it("marks grouped order steps based on filled values", () => {
    const statuses = computeOrderProgressStepStatuses({
      fields,
      groups,
      includeFacilityFields: true,
      order: {
        name: "Order A",
        platform: null,
        customFields: JSON.stringify({ facility_notes: "Checked" }),
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
            customFields: JSON.stringify({ internal_sample_qc: "Pass" }),
          },
        ],
      },
    });

    expect(statuses.group_details).toBe("complete");
    expect(statuses.group_sequencing).toBe("empty");
    expect(statuses._facility).toBe("complete");
  });

  it("marks samples as partial when only some sample cells are filled", () => {
    const statuses = computeOrderProgressStepStatuses({
      fields,
      groups,
      order: {
        name: "Order A",
        platform: "ILLUMINA",
        customFields: null,
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
            customFields: JSON.stringify({ sample_concentration: 10 }),
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

    expect(statuses.samples).toBe("partial");
  });

  it("keeps admin-only sample fields under facility progress instead of samples", () => {
    const statuses = computeOrderProgressStepStatuses({
      fields,
      groups,
      includeFacilityFields: true,
      order: {
        name: "Order A",
        platform: "ILLUMINA",
        customFields: null,
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
            customFields: JSON.stringify({
              sample_concentration: 10,
              internal_sample_qc: "Pass",
            }),
          },
          {
            id: "sample-2",
            sampleId: "S2",
            sampleAlias: null,
            sampleTitle: null,
            sampleDescription: null,
            scientificName: null,
            taxId: null,
            customFields: JSON.stringify({
              sample_concentration: 12,
            }),
          },
        ],
      },
    });

    expect(statuses.samples).toBe("complete");
    expect(statuses._facility).toBe("partial");
  });

  it("marks samples as complete when all rows and fields are filled", () => {
    const statuses = computeOrderProgressStepStatuses({
      fields,
      groups,
      order: {
        name: "Order A",
        platform: "ILLUMINA",
        customFields: null,
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
            customFields: JSON.stringify({ sample_concentration: 10 }),
          },
          {
            id: "sample-2",
            sampleId: "S2",
            sampleAlias: null,
            sampleTitle: null,
            sampleDescription: null,
            scientificName: null,
            taxId: null,
            customFields: JSON.stringify({ sample_concentration: 12 }),
          },
        ],
      },
    });

    expect(statuses.samples).toBe("complete");
  });

  it("derives review status from the preceding steps", () => {
    const partialReview = computeOrderProgressStepStatuses({
      fields,
      groups,
      order: {
        name: "Order A",
        platform: null,
        customFields: null,
        numberOfSamples: 0,
        samples: [],
      },
    });
    const completeReview = computeOrderProgressStepStatuses({
      fields,
      groups,
      order: {
        name: "Order A",
        platform: "ILLUMINA",
        customFields: null,
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
            customFields: JSON.stringify({ sample_concentration: 10 }),
          },
        ],
      },
    });

    expect(partialReview.review).toBe("partial");
    expect(completeReview.review).toBe("complete");
  });

  it("returns all steps as empty when order is null", () => {
    const statuses = computeOrderProgressStepStatuses({
      fields,
      groups,
      order: null,
    });

    expect(statuses.group_details).toBe("empty");
    expect(statuses.group_sequencing).toBe("empty");
    expect(statuses.samples).toBe("empty");
    expect(statuses.review).toBe("empty");
  });

  it("marks review as empty when all prior steps are empty", () => {
    const statuses = computeOrderProgressStepStatuses({
      fields,
      groups,
      order: {
        name: null,
        platform: null,
        customFields: null,
        numberOfSamples: 0,
        samples: [],
      },
    });

    expect(statuses.review).toBe("empty");
  });

  it("marks samples step as empty when order has zero samples", () => {
    const statuses = computeOrderProgressStepStatuses({
      fields,
      groups,
      order: {
        name: "Order A",
        platform: "ILLUMINA",
        customFields: null,
        numberOfSamples: 0,
        samples: [],
      },
    });

    expect(statuses.samples).toBe("empty");
  });

  it("counts MiXS step based on checklist and field selections", () => {
    const mixsFields: FormFieldDefinition[] = [
      ...fields,
      {
        id: "field_mixs",
        type: "mixs" as const,
        label: "MiXS Checklist",
        name: "_mixsChecklist",
        required: false,
        visible: true,
        order: 10,
      },
    ];

    const statuses = computeOrderProgressStepStatuses({
      fields: mixsFields,
      groups,
      enabledMixsChecklists: ["soil"],
      order: {
        name: "Order A",
        platform: "ILLUMINA",
        customFields: JSON.stringify({
          _mixsChecklist: "soil",
          _mixsFields: ["collection_date", "depth"],
        }),
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
            customFields: JSON.stringify({ sample_concentration: 10 }),
          },
        ],
      },
    });

    expect(statuses.mixs).toBe("complete");
  });

  it("marks MiXS as empty when no checklist is selected", () => {
    const mixsFields: FormFieldDefinition[] = [
      ...fields,
      {
        id: "field_mixs",
        type: "mixs" as const,
        label: "MiXS Checklist",
        name: "_mixsChecklist",
        required: false,
        visible: true,
        order: 10,
      },
    ];

    const statuses = computeOrderProgressStepStatuses({
      fields: mixsFields,
      groups,
      enabledMixsChecklists: ["soil"],
      order: {
        name: "Order A",
        platform: null,
        customFields: null,
        numberOfSamples: 0,
        samples: [],
      },
    });

    expect(statuses.mixs).toBe("empty");
  });

  it("falls back to _count.samples for numberOfSamples system field", () => {
    const statuses = computeOrderProgressStepStatuses({
      fields: [
        {
          id: "field_num_samples",
          type: "number",
          label: "Number of Samples",
          name: "numberOfSamples",
          required: false,
          visible: true,
          order: 0,
          groupId: "group_details",
          isSystem: true,
          systemKey: "numberOfSamples",
        },
      ],
      groups,
      order: {
        customFields: null,
        numberOfSamples: null,
        _count: { samples: 5 },
        samples: [],
      },
    });

    expect(statuses.group_details).toBe("complete");
  });

  it("handles organism field with scientificName", () => {
    const organismFields: FormFieldDefinition[] = [
      {
        id: "field_organism",
        type: "organism" as const,
        label: "Organism",
        name: "organism",
        required: false,
        visible: true,
        order: 0,
        perSample: true,
      },
    ];

    const statuses = computeOrderProgressStepStatuses({
      fields: organismFields,
      groups: [],
      order: {
        customFields: null,
        numberOfSamples: 1,
        samples: [
          {
            id: "sample-1",
            sampleId: "S1",
            sampleAlias: null,
            sampleTitle: null,
            sampleDescription: null,
            scientificName: "Homo sapiens",
            taxId: null,
            customFields: null,
          },
        ],
      },
    });

    expect(statuses.samples).toBe("complete");
  });

  it("counts ungrouped custom fields as filled", () => {
    const ungroupedField: FormFieldDefinition[] = [
      {
        id: "field_ungrouped",
        type: "text",
        label: "Extra Info",
        name: "extraInfo",
        required: false,
        visible: true,
        order: 0,
        // no groupId -> ungrouped
      },
    ];

    const statuses = computeOrderProgressStepStatuses({
      fields: ungroupedField,
      groups: [],
      order: {
        customFields: JSON.stringify({
          extraInfo: "some value",
          unknownField: "also present",
        }),
        numberOfSamples: 0,
        samples: [],
      },
    });

    expect(statuses._ungrouped).toBe("complete");
  });

  it("handles malformed JSON in order customFields", () => {
    const statuses = computeOrderProgressStepStatuses({
      fields,
      groups,
      order: {
        name: "Order A",
        platform: "ILLUMINA",
        customFields: "not-valid-json",
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
      },
    });

    // Should not throw; customFields parsed as empty object
    expect(statuses.group_details).toBe("complete");
  });

  it("handles customFields that parse as a JSON array", () => {
    const statuses = computeOrderProgressStepStatuses({
      fields,
      groups,
      order: {
        name: "Order A",
        platform: null,
        customFields: JSON.stringify([1, 2, 3]),
        numberOfSamples: 0,
        samples: [],
      },
    });

    // Arrays are not valid objects; should fall back to empty
    expect(statuses.group_sequencing).toBe("empty");
  });
});

describe("getOrderProgressIndicatorClassName", () => {
  it("returns emerald for complete", () => {
    expect(getOrderProgressIndicatorClassName("complete")).toBe("bg-emerald-500");
  });

  it("returns amber for partial", () => {
    expect(getOrderProgressIndicatorClassName("partial")).toBe("bg-amber-400");
  });

  it("returns slate for empty", () => {
    expect(getOrderProgressIndicatorClassName("empty")).toBe("bg-slate-400");
  });
});

describe("getOrderProgressIndicatorLabel", () => {
  it("returns Complete for complete", () => {
    expect(getOrderProgressIndicatorLabel("complete")).toBe("Complete");
  });

  it("returns Partially filled for partial", () => {
    expect(getOrderProgressIndicatorLabel("partial")).toBe("Partially filled");
  });

  it("returns Not filled for empty", () => {
    expect(getOrderProgressIndicatorLabel("empty")).toBe("Not filled");
  });
});
