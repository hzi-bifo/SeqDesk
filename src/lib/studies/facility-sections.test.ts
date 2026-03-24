import { describe, expect, it } from "vitest";

import type { FormFieldDefinition } from "@/types/form-config";

import {
  buildStudyFacilityFieldSections,
  getStudyFacilityFieldSubsectionAnchorId,
  isStudyFacilityFieldSubsectionId,
} from "./facility-sections";

const fields: FormFieldDefinition[] = [
  {
    id: "study_internal_notes",
    type: "textarea",
    label: "Internal Notes",
    name: "internal_notes",
    required: false,
    visible: true,
    order: 0,
    adminOnly: true,
  },
  {
    id: "sample_internal_qc",
    type: "text",
    label: "Sample QC",
    name: "sample_qc",
    required: false,
    visible: true,
    order: 1,
    adminOnly: true,
    perSample: true,
  },
];

describe("study facility field sections", () => {
  it("returns no sections when facility fields are disabled", () => {
    expect(
      buildStudyFacilityFieldSections({
        fields,
        includeFacilityFields: false,
        study: null,
      })
    ).toEqual([]);
  });

  it("exposes subsection anchors and validates ids", () => {
    expect(getStudyFacilityFieldSubsectionAnchorId("study-fields")).toBe(
      "study-facility-fields-study-fields"
    );
    expect(isStudyFacilityFieldSubsectionId("sample-fields")).toBe(true);
    expect(isStudyFacilityFieldSubsectionId("unknown")).toBe(false);
    expect(isStudyFacilityFieldSubsectionId(null)).toBe(false);
  });

  it("returns empty sections for configured facility fields when no study exists", () => {
    expect(
      buildStudyFacilityFieldSections({
        fields,
        includeFacilityFields: true,
        study: null,
      })
    ).toEqual([
      expect.objectContaining({ id: "study-fields", status: "empty" }),
      expect.objectContaining({ id: "sample-fields", status: "empty" }),
    ]);
  });

  it("builds study and sample sections with independent statuses", () => {
    const sections = buildStudyFacilityFieldSections({
      fields,
      includeFacilityFields: true,
      study: {
        studyMetadata: JSON.stringify({ internal_notes: "Reviewed" }),
        samples: [
          {
            id: "sample-1",
            checklistData: JSON.stringify({ sample_qc: "Pass" }),
          },
          {
            id: "sample-2",
            checklistData: null,
          },
        ],
      },
    });

    expect(sections).toEqual([
      expect.objectContaining({ id: "study-fields", status: "complete" }),
      expect.objectContaining({ id: "sample-fields", status: "partial" }),
    ]);
  });

  it("keeps sample fields present but empty when no samples exist yet", () => {
    const sections = buildStudyFacilityFieldSections({
      fields,
      includeFacilityFields: true,
      study: {
        studyMetadata: null,
        samples: [],
      },
    });

    expect(sections).toEqual([
      expect.objectContaining({ id: "study-fields", status: "empty" }),
      expect.objectContaining({ id: "sample-fields", status: "empty" }),
    ]);
  });

  it("ignores sample-association fields, hidden fields, and malformed metadata", () => {
    const sections = buildStudyFacilityFieldSections({
      fields: [
        {
          id: "study_notes",
          type: "textarea",
          label: "Study Notes",
          name: "internal_notes",
          required: false,
          visible: true,
          order: 0,
          adminOnly: true,
        },
        {
          id: "sample_association",
          type: "text",
          label: "Association",
          name: "_sample_association",
          required: false,
          visible: true,
          order: 1,
          adminOnly: true,
        },
        {
          id: "hidden_sample_field",
          type: "text",
          label: "Hidden Sample Field",
          name: "hidden_sample_field",
          required: false,
          visible: false,
          order: 2,
          adminOnly: true,
          perSample: true,
        },
        {
          id: "sample_qc",
          type: "text",
          label: "Sample QC",
          name: "sample_qc",
          required: false,
          visible: true,
          order: 3,
          adminOnly: true,
          perSample: true,
        },
      ],
      includeFacilityFields: true,
      study: {
        studyMetadata: "{bad-json",
        samples: [
          {
            id: "sample-1",
            checklistData: JSON.stringify({ sample_qc: "Pass" }),
          },
          {
            id: "sample-2",
            checklistData: "{bad-json",
          },
        ],
      },
    });

    expect(sections).toEqual([
      expect.objectContaining({ id: "study-fields", status: "empty" }),
      expect.objectContaining({ id: "sample-fields", status: "partial" }),
    ]);
  });

  it("keeps sample section empty when study has samples but no visible per-sample fields", () => {
    const sections = buildStudyFacilityFieldSections({
      fields: [
        {
          id: "study_internal_notes",
          type: "textarea",
          label: "Internal Notes",
          name: "internal_notes",
          required: false,
          visible: true,
          order: 0,
          adminOnly: true,
        },
      ],
      includeFacilityFields: true,
      study: {
        studyMetadata: JSON.stringify({ internal_notes: "Reviewed" }),
        samples: [
          {
            id: "sample-1",
            checklistData: JSON.stringify({ anything: "value" }),
          },
        ],
      },
    });

    expect(sections).toEqual([
      expect.objectContaining({ id: "study-fields", status: "complete" }),
      expect.objectContaining({ id: "sample-fields", status: "empty" }),
    ]);
  });

  it("treats empty arrays as unfilled study progress values", () => {
    const sections = buildStudyFacilityFieldSections({
      fields: [
        {
          id: "study_tags",
          type: "multiselect",
          label: "Study Tags",
          name: "study_tags",
          required: false,
          visible: true,
          order: 0,
          adminOnly: true,
        },
      ],
      includeFacilityFields: true,
      study: {
        studyMetadata: JSON.stringify({ study_tags: [] }),
        samples: [],
      },
    });

    expect(sections).toEqual([
      expect.objectContaining({ id: "study-fields", status: "empty" }),
    ]);
  });

  it("sorts multiple per-sample fields before computing completion", () => {
    const sections = buildStudyFacilityFieldSections({
      fields: [
        {
          id: "sample_qc_late",
          type: "text",
          label: "Sample QC Late",
          name: "sample_qc_late",
          required: false,
          visible: true,
          order: 5,
          adminOnly: true,
          perSample: true,
        },
        {
          id: "sample_qc_early",
          type: "text",
          label: "Sample QC Early",
          name: "sample_qc_early",
          required: false,
          visible: true,
          order: 1,
          adminOnly: true,
          perSample: true,
        },
      ],
      includeFacilityFields: true,
      study: {
        studyMetadata: null,
        samples: [
          {
            id: "sample-1",
            checklistData: JSON.stringify({
              sample_qc_early: "Pass",
              sample_qc_late: "Pass",
            }),
          },
        ],
      },
    });

    expect(sections).toEqual([
      expect.objectContaining({ id: "study-fields", status: "empty" }),
      expect.objectContaining({ id: "sample-fields", status: "complete" }),
    ]);
  });

  it("omits the sample section when an existing study has neither samples nor sample fields", () => {
    const sections = buildStudyFacilityFieldSections({
      fields: [
        {
          id: "study_internal_notes",
          type: "textarea",
          label: "Internal Notes",
          name: "internal_notes",
          required: false,
          visible: true,
          order: 0,
          adminOnly: true,
        },
      ],
      includeFacilityFields: true,
      study: {
        studyMetadata: null,
        samples: [],
      },
    });

    expect(sections).toEqual([
      expect.objectContaining({ id: "study-fields", status: "empty" }),
    ]);
  });
});
