import { describe, expect, it } from "vitest";

import {
  buildStudyOverviewFlowSections,
  sampleHasStudyOverviewMetadata,
  STUDY_OVERVIEW_SAMPLE_METADATA_SECTION_ID,
} from "./overview-flow";

describe("sampleHasStudyOverviewMetadata", () => {
  it("does not treat core sample identifiers as completed metadata", () => {
    expect(
      sampleHasStudyOverviewMetadata({
        id: "sample-1",
        taxId: "9606",
        scientificName: "Homo sapiens",
        sampleTitle: "Sample 1",
        sampleAlias: "S1",
        customFields: null,
        checklistData: null,
      })
    ).toBe(false);
  });

  it("counts checklist or custom-field values as metadata", () => {
    expect(
      sampleHasStudyOverviewMetadata({
        id: "sample-1",
        customFields: JSON.stringify({ depth: "10m" }),
        checklistData: null,
      })
    ).toBe(true);
  });
});

describe("buildStudyOverviewFlowSections", () => {
  it("marks sample metadata complete only when metadata values are present", () => {
    const sections = buildStudyOverviewFlowSections({
      fields: [],
      study: {
        title: "Study",
        description: "Desc",
        alias: "alias-1",
        checklistType: "ERC000011",
        studyMetadata: null,
        readyForSubmission: false,
        submitted: false,
        samples: [
          {
            id: "sample-1",
            taxId: "9606",
            scientificName: "Homo sapiens",
            checklistData: JSON.stringify({
              "geographic location (country and/or sea)": "Germany",
            }),
          },
        ],
      },
      includeAssociatedSamples: true,
      includeEnvironmentType: true,
      includeSampleMetadata: true,
    });

    const metadataSection = sections.find(
      (section) => section.id === STUDY_OVERVIEW_SAMPLE_METADATA_SECTION_ID
    );

    expect(metadataSection?.status).toBe("complete");
  });
});
