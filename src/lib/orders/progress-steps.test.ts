import { describe, expect, it } from "vitest";

import type { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";
import {
  buildOrderProgressSteps,
  getOrderProgressAnchorId,
} from "./progress-steps";

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

const baseFields: FormFieldDefinition[] = [
  {
    id: "name",
    type: "text",
    label: "Order Name",
    name: "name",
    required: false,
    visible: true,
    order: 0,
    groupId: "group_details",
  },
  {
    id: "platform",
    type: "select",
    label: "Platform",
    name: "platform",
    required: false,
    visible: true,
    order: 1,
    groupId: "group_sequencing",
  },
];

describe("order progress steps", () => {
  it("builds the default grouped order flow with samples and review", () => {
    expect(
      buildOrderProgressSteps({
        fields: baseFields,
        groups,
      }).map((step) => step.id)
    ).toEqual([
      "group_details",
      "group_sequencing",
      "samples",
      "review",
    ]);
  });

  it("adds ungrouped, mixs, and facility steps when present", () => {
    const fields: FormFieldDefinition[] = [
      ...baseFields,
      {
        id: "notes",
        type: "textarea",
        label: "Notes",
        name: "notes",
        required: false,
        visible: true,
        order: 2,
      },
      {
        id: "mixs",
        type: "mixs",
        label: "MIxS",
        name: "_mixs",
        required: false,
        visible: true,
        order: 3,
      },
      {
        id: "facility",
        type: "text",
        label: "Facility Notes",
        name: "facilityNotes",
        required: false,
        visible: true,
        adminOnly: true,
        order: 4,
      },
    ];

    expect(
      buildOrderProgressSteps({
        fields,
        groups,
        enabledMixsChecklists: ["MIxS Human Gut"],
        includeFacilityFields: true,
      }).map((step) => step.id)
    ).toEqual([
      "group_details",
      "group_sequencing",
      "_ungrouped",
      "mixs",
      "samples",
      "_facility",
      "review",
    ]);
  });

  it("adds facility step for admin-only sample fields", () => {
    const fields: FormFieldDefinition[] = [
      ...baseFields,
      {
        id: "facility_sample_qc",
        type: "text",
        label: "Internal Sample QC",
        name: "internal_sample_qc",
        required: false,
        visible: true,
        order: 2,
        perSample: true,
        adminOnly: true,
      },
    ];

    expect(
      buildOrderProgressSteps({
        fields,
        groups,
        includeFacilityFields: true,
      }).map((step) => step.id)
    ).toEqual([
      "group_details",
      "group_sequencing",
      "samples",
      "_facility",
      "review",
    ]);
  });

  it("ignores invisible fields when deriving progress sections", () => {
    const fields: FormFieldDefinition[] = [
      {
        id: "hidden",
        type: "text",
        label: "Hidden",
        name: "hidden",
        required: false,
        visible: false,
        order: 0,
        groupId: "group_details",
      },
    ];

    expect(
      buildOrderProgressSteps({
        fields,
        groups,
      }).map((step) => step.id)
    ).toEqual(["samples", "review"]);
  });

  it("creates stable anchor ids for order detail subsections", () => {
    expect(getOrderProgressAnchorId("group_details")).toBe(
      "order-progress-group_details"
    );
  });
});
