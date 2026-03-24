// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildOrderProgressSteps: vi.fn(),
  computeOrderProgressStepStatuses: vi.fn(),
  buildFacilityFieldSections: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/orders/progress-steps", () => ({
  buildOrderProgressSteps: mocks.buildOrderProgressSteps,
}));

vi.mock("@/lib/orders/progress-status", () => ({
  computeOrderProgressStepStatuses: mocks.computeOrderProgressStepStatuses,
}));

vi.mock("@/lib/orders/facility-sections", () => ({
  buildFacilityFieldSections: mocks.buildFacilityFieldSections,
}));

import { useOrderFormSteps } from "./useOrderFormSteps";

function jsonResponse(data: unknown, ok = true) {
  return {
    ok,
    json: async () => data,
  } as Response;
}

describe("useOrderFormSteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.buildOrderProgressSteps.mockReturnValue([]);
    mocks.computeOrderProgressStepStatuses.mockReturnValue({});
    mocks.buildFacilityFieldSections.mockReturnValue([]);
  });

  it("returns empty navigation when no order id is provided", async () => {
    const { result } = renderHook(() => useOrderFormSteps());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current).toEqual({
      steps: [],
      facilitySections: [],
      loading: false,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("builds steps and facility sections from fetched schema and order data", async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          fields: [{ name: "projectTitle" }],
          groups: [{ id: "details", label: "Details", fields: [] }],
          enabledMixsChecklists: ["air"],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: "order-1", samples: [] }));
    mocks.buildOrderProgressSteps.mockReturnValue([
      { id: "details", label: "Details", description: "Project details", icon: "FileText" },
    ]);
    mocks.computeOrderProgressStepStatuses.mockReturnValue({
      details: "complete",
    });
    mocks.buildFacilityFieldSections.mockReturnValue([
      { id: "facility", label: "Facility", status: "partial" },
    ]);

    const { result } = renderHook(() => useOrderFormSteps(true, "order-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.steps).toHaveLength(1);
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).toHaveBeenNthCalledWith(1, "/api/form-schema");
    expect(mocks.fetch).toHaveBeenNthCalledWith(2, "/api/orders/order-1");
    expect(mocks.buildOrderProgressSteps).toHaveBeenCalledWith({
      fields: [{ name: "projectTitle" }],
      groups: [{ id: "details", label: "Details", fields: [] }],
      enabledMixsChecklists: ["air"],
      includeFacilityFields: true,
    });
    expect(mocks.computeOrderProgressStepStatuses).toHaveBeenCalledWith({
      fields: [{ name: "projectTitle" }],
      groups: [{ id: "details", label: "Details", fields: [] }],
      order: { id: "order-1", samples: [] },
      enabledMixsChecklists: ["air"],
      includeFacilityFields: true,
    });
    expect(mocks.buildFacilityFieldSections).toHaveBeenCalledWith({
      fields: [{ name: "projectTitle" }],
      order: { id: "order-1", samples: [] },
      includeFacilityFields: true,
    });
    expect(result.current.steps).toEqual([
      {
        id: "details",
        label: "Details",
        description: "Project details",
        icon: "FileText",
        status: "complete",
      },
    ]);
    expect(result.current.facilitySections).toEqual([
      { id: "facility", label: "Facility", status: "partial" },
    ]);
  });

  it("falls back to the default sidebar steps when fetching fails", async () => {
    mocks.fetch.mockResolvedValueOnce(jsonResponse({}, false));

    const { result } = renderHook(() => useOrderFormSteps(false, "order-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.steps).toHaveLength(4);
    });

    expect(result.current.steps.map((step) => step.id)).toEqual([
      "group_details",
      "group_sequencing",
      "samples",
      "review",
    ]);
    expect(result.current.facilitySections).toEqual([]);
  });
});
