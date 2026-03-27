// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useSearchParams: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
  useSearchParams: mocks.useSearchParams,
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
    mocks.useSearchParams.mockReturnValue(new URLSearchParams());
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

  it("restores study context on analysis pages from search params", async () => {
    mocks.usePathname.mockReturnValue("/analysis/run-1");
    mocks.useSearchParams.mockReturnValue(new URLSearchParams("studyId=study-1"));
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        title: "Study 1",
        alias: "STD-001",
        submitted: true,
        readyForSubmission: true,
      })
    );

    const { result } = renderHook(() => useSidebarEntity());

    await waitFor(() => {
      expect(result.current.entityData).toEqual({
        label: "Study 1",
        sublabel: "STD-001",
        status: "PUBLISHED",
      });
    });

    expect(mocks.fetch).toHaveBeenCalledWith("/api/studies/study-1");
    expect(result.current.entityType).toBe("study");
    expect(result.current.entityId).toBe("study-1");
    expect(result.current.currentSubPage).toBe("pipelines");
  });

  it("restores order context on analysis pages from search params", async () => {
    mocks.usePathname.mockReturnValue("/analysis/run-1");
    mocks.useSearchParams.mockReturnValue(new URLSearchParams("orderId=order-1"));
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        name: "Order 1",
        orderNumber: "ORD-001",
        status: "RUNNING",
      })
    );

    const { result } = renderHook(() => useSidebarEntity());

    await waitFor(() => {
      expect(result.current.entityData).toEqual({
        label: "Order 1",
        sublabel: "ORD-001",
        status: "RUNNING",
      });
    });

    expect(mocks.fetch).toHaveBeenCalledWith("/api/orders/order-1");
    expect(result.current.entityType).toBe("order");
    expect(result.current.entityId).toBe("order-1");
    expect(result.current.currentSubPage).toBe("sequencing");
  });

  it("reuses cached entity data when revisiting the same entity", async () => {
    let currentPath = "/orders/order-1";
    mocks.usePathname.mockImplementation(() => currentPath);
    mocks.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          name: "Order 1",
          orderNumber: "ORD-001",
          status: "COMPLETED",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          name: "Order 2",
          orderNumber: "ORD-002",
          status: "RUNNING",
        })
      );

    const { result, rerender } = renderHook(() => useSidebarEntity());

    await waitFor(() => {
      expect(result.current.entityData).toEqual({
        label: "Order 1",
        sublabel: "ORD-001",
        status: "COMPLETED",
      });
    });

    currentPath = "/orders/order-2";
    rerender();

    await waitFor(() => {
      expect(result.current.entityData).toEqual({
        label: "Order 2",
        sublabel: "ORD-002",
        status: "RUNNING",
      });
    });

    currentPath = "/orders/order-1";
    rerender();

    await waitFor(() => {
      expect(result.current.entityData).toEqual({
        label: "Order 1",
        sublabel: "ORD-001",
        status: "COMPLETED",
      });
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
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
