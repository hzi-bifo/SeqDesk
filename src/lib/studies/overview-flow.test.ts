import { describe, expect, it } from "vitest";

import {
  buildStudyOverviewFlowSections,
  sampleHasStudyOverviewMetadata,
  STUDY_OVERVIEW_ASSOCIATED_SAMPLES_SECTION_ID,
  STUDY_OVERVIEW_ENVIRONMENT_TYPE_SECTION_ID,
  STUDY_OVERVIEW_REVIEW_SECTION_ID,
  STUDY_OVERVIEW_SAMPLE_METADATA_SECTION_ID,
  STUDY_OVERVIEW_STUDY_DETAILS_SECTION_ID,
} from "./overview-flow";
import type { FormFieldDefinition } from "@/types/form-config";

function makeField(overrides: Partial<FormFieldDefinition>): FormFieldDefinition {
  return {
    id: overrides.id ?? "field-1",
    type: overrides.type ?? "text",
    label: overrides.label ?? "Field",
    name: overrides.name ?? "field_name",
    required: overrides.required ?? false,
    visible: overrides.visible ?? true,
    order: overrides.order ?? 0,
    ...overrides,
  };
}

describe("sampleHasStudyOverviewMetadata", () => {
  it("detects metadata in core fields, custom fields, and checklist data", () => {
    expect(
      sampleHasStudyOverviewMetadata({
        id: "sample-1",
        scientificName: "Escherichia coli",
      })
    ).toBe(true);

    expect(
      sampleHasStudyOverviewMetadata({
        id: "sample-2",
        customFields: JSON.stringify({ habitat: "soil" }),
      })
    ).toBe(true);

    expect(
      sampleHasStudyOverviewMetadata({
        id: "sample-3",
        checklistData: { collection_date: "2026-03-18" },
      })
    ).toBe(true);
  });

  it("ignores empty and malformed metadata payloads", () => {
    expect(
      sampleHasStudyOverviewMetadata({
        id: "sample-1",
        customFields: "{bad-json",
        checklistData: JSON.stringify({ habitat: "" }),
      })
    ).toBe(false);
  });
});

describe("buildStudyOverviewFlowSections", () => {
  it("builds section statuses from study details, environment data, and sample metadata", () => {
    const fields = [
      makeField({ id: "visible-detail", name: "bioproject", label: "BioProject" }),
      makeField({ id: "hidden-detail", name: "hidden", visible: false }),
      makeField({ id: "admin-only", name: "internal", adminOnly: true }),
      makeField({ id: "per-sample", name: "sample_field", perSample: true }),
      makeField({ id: "mixs-field", name: "mixs_field", type: "mixs" }),
      makeField({ id: "sample-association", name: "_sample_association" }),
    ];

    const sections = buildStudyOverviewFlowSections({
      fields,
      includeAssociatedSamples: true,
      includeEnvironmentType: true,
      includeSampleMetadata: true,
      study: {
        title: "Gut Recovery Cohort",
        description: "Longitudinal gut study",
        alias: "",
        checklistType: "host-associated",
        readyForSubmission: false,
        submitted: false,
        studyMetadata: JSON.stringify({
          bioproject: "PRJNA000001",
          hidden: "ignore-me",
          internal: "ignore-me",
        }),
        samples: [
          { id: "sample-1", taxId: "408170" },
          { id: "sample-2" },
        ],
      },
    });

    expect(sections).toEqual([
      {
        id: STUDY_OVERVIEW_ASSOCIATED_SAMPLES_SECTION_ID,
        label: "Associated Samples",
        status: "complete",
      },
      {
        id: STUDY_OVERVIEW_STUDY_DETAILS_SECTION_ID,
        label: "Study Details",
        status: "partial",
      },
      {
        id: STUDY_OVERVIEW_ENVIRONMENT_TYPE_SECTION_ID,
        label: "Environment Type",
        status: "complete",
      },
      {
        id: STUDY_OVERVIEW_SAMPLE_METADATA_SECTION_ID,
        label: "Sample Metadata",
        status: "partial",
      },
      {
        id: STUDY_OVERVIEW_REVIEW_SECTION_ID,
        label: "Review",
        status: "partial",
      },
    ]);
  });

  it("marks review complete when the study is ready or submitted", () => {
    const sections = buildStudyOverviewFlowSections({
      fields: [],
      includeAssociatedSamples: false,
      includeEnvironmentType: false,
      includeSampleMetadata: false,
      study: {
        title: "Study",
        readyForSubmission: true,
        samples: [],
      },
    });

    expect(sections).toEqual([
      {
        id: STUDY_OVERVIEW_STUDY_DETAILS_SECTION_ID,
        label: "Study Details",
        status: "partial",
      },
      {
        id: STUDY_OVERVIEW_REVIEW_SECTION_ID,
        label: "Review",
        status: "complete",
      },
    ]);
  });

  it("keeps all sections empty when nothing has been filled yet", () => {
    const sections = buildStudyOverviewFlowSections({
      fields: [],
      includeAssociatedSamples: true,
      includeEnvironmentType: true,
      includeSampleMetadata: true,
      study: {
        title: "",
        description: null,
        alias: null,
        checklistType: null,
        samples: [],
      },
    });

    expect(sections).toEqual([
      {
        id: STUDY_OVERVIEW_ASSOCIATED_SAMPLES_SECTION_ID,
        label: "Associated Samples",
        status: "empty",
      },
      {
        id: STUDY_OVERVIEW_STUDY_DETAILS_SECTION_ID,
        label: "Study Details",
        status: "empty",
      },
      {
        id: STUDY_OVERVIEW_ENVIRONMENT_TYPE_SECTION_ID,
        label: "Environment Type",
        status: "empty",
      },
      {
        id: STUDY_OVERVIEW_SAMPLE_METADATA_SECTION_ID,
        label: "Sample Metadata",
        status: "empty",
      },
      {
        id: STUDY_OVERVIEW_REVIEW_SECTION_ID,
        label: "Review",
        status: "empty",
      },
    ]);
  });
});
