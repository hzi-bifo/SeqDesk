// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
}));

import { useSidebarEntity } from "./useSidebarEntity";

function jsonResponse(data: unknown, ok = true) {
  return {
    ok,
    json: async () => data,
  } as Response;
}

describe("useSidebarEntity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("returns empty context for non-entity routes", async () => {
    mocks.usePathname.mockReturnValue("/orders/new");

    const { result } = renderHook(() => useSidebarEntity());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current).toEqual({
      entityType: null,
      entityId: null,
      entityData: null,
      isLoading: false,
      currentSubPage: "overview",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("loads order data and parses the current subpage", async () => {
    mocks.usePathname.mockReturnValue("/orders/order-1/sequencing");
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        name: "Order 1",
        orderNumber: "ORD-001",
        status: "COMPLETED",
      })
    );

    const { result } = renderHook(() => useSidebarEntity());

    await waitFor(() => {
      expect(result.current.entityData).toEqual({
        label: "Order 1",
        sublabel: "ORD-001",
        status: "COMPLETED",
      });
    });

    expect(mocks.fetch).toHaveBeenCalledWith("/api/orders/order-1");
    expect(result.current.entityType).toBe("order");
    expect(result.current.entityId).toBe("order-1");
    expect(result.current.currentSubPage).toBe("sequencing");
  });

  it("maps study submission state into sidebar statuses", async () => {
    mocks.usePathname.mockReturnValue("/studies/study-1/facility");
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        title: "Study 1",
        alias: "STD-001",
        submitted: false,
        readyForSubmission: true,
      })
    );

    const { result } = renderHook(() => useSidebarEntity());

    await waitFor(() => {
      expect(result.current.entityData).toEqual({
        label: "Study 1",
        sublabel: "STD-001",
        status: "READY",
      });
    });

    expect(mocks.fetch).toHaveBeenCalledWith("/api/studies/study-1");
    expect(result.current.entityType).toBe("study");
    expect(result.current.currentSubPage).toBe("facility");
  });

  it("clears sidebar entity data when the fetch fails", async () => {
    mocks.usePathname.mockReturnValue("/studies/study-1");
    mocks.fetch.mockResolvedValueOnce(jsonResponse({}, false));

    const { result } = renderHook(() => useSidebarEntity());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.entityData).toBeNull();
  });
});
