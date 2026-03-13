import { describe, expect, it } from "vitest";

import type { FormFieldDefinition } from "@/types/form-config";

import { buildStudyFacilityFieldSections } from "./facility-sections";

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
});
