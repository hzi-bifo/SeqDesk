// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildStudyOverviewFlowSections: vi.fn(),
  buildStudyFacilityFieldSections: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/studies/overview-flow", () => ({
  buildStudyOverviewFlowSections: mocks.buildStudyOverviewFlowSections,
}));

vi.mock("@/lib/studies/facility-sections", () => ({
  buildStudyFacilityFieldSections: mocks.buildStudyFacilityFieldSections,
}));

import { useStudyFormSteps } from "./useStudyFormSteps";

function jsonResponse(data: unknown, ok = true) {
  return {
    ok,
    json: async () => data,
  } as Response;
}

describe("useStudyFormSteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.buildStudyOverviewFlowSections.mockReturnValue([]);
    mocks.buildStudyFacilityFieldSections.mockReturnValue([]);
  });

  it("returns empty navigation when no study id is provided", async () => {
    const { result } = renderHook(() => useStudyFormSteps());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current).toEqual({
      overviewSections: [],
      facilitySections: [],
      loading: false,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("builds overview and facility sections from fetched study schema", async () => {
    const studyData = {
      title: "Study 1",
      description: null,
      alias: "STD-1",
      checklistType: "air",
      studyMetadata: "{}",
      readyForSubmission: true,
      submitted: false,
      samples: [{ id: "sample-1", checklistData: "{}", customFields: null }],
    };

    mocks.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          fields: [{ name: "title" }],
          perSampleFields: [
            { name: "temperature", visible: true, adminOnly: false },
            { name: "internalNote", visible: true, adminOnly: true },
          ],
          modules: {
            mixs: false,
            sampleAssociation: true,
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse(studyData));
    mocks.buildStudyOverviewFlowSections.mockReturnValue([{ id: "overview", label: "Overview" }]);
    mocks.buildStudyFacilityFieldSections.mockReturnValue([{ id: "facility", label: "Facility" }]);

    const { result } = renderHook(() => useStudyFormSteps(true, "study-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.overviewSections).toHaveLength(1);
    });

    expect(mocks.fetch).toHaveBeenNthCalledWith(1, "/api/study-form-schema");
    expect(mocks.fetch).toHaveBeenNthCalledWith(2, "/api/studies/study-1");
    expect(mocks.buildStudyOverviewFlowSections).toHaveBeenCalledWith({
      fields: [{ name: "title" }],
      study: studyData,
      includeAssociatedSamples: true,
      includeEnvironmentType: true,
      includeSampleMetadata: true,
    });
    expect(mocks.buildStudyFacilityFieldSections).toHaveBeenCalledWith({
      fields: [{ name: "title" }],
      study: studyData,
      includeFacilityFields: true,
    });
    expect(result.current.overviewSections).toEqual([{ id: "overview", label: "Overview" }]);
    expect(result.current.facilitySections).toEqual([{ id: "facility", label: "Facility" }]);
  });

  it("falls back to the default overview flow when fetching fails", async () => {
    mocks.fetch.mockResolvedValueOnce(jsonResponse({}, false));
    mocks.buildStudyOverviewFlowSections.mockReturnValue([
      { id: "overview", label: "Overview" },
      { id: "samples", label: "Associated Samples" },
    ]);

    const { result } = renderHook(() => useStudyFormSteps(false, "study-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.overviewSections).toHaveLength(2);
    });

    expect(mocks.buildStudyOverviewFlowSections).toHaveBeenCalledWith({
      fields: [],
      study: {
        title: "",
        description: null,
        alias: null,
        checklistType: null,
        studyMetadata: null,
        samples: [],
        readyForSubmission: false,
        submitted: false,
      },
      includeAssociatedSamples: true,
      includeEnvironmentType: false,
      includeSampleMetadata: false,
    });
    expect(result.current.facilitySections).toEqual([]);
  });
});
