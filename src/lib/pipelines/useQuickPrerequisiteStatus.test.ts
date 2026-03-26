// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/lib/pipelines/quick-prerequisite-status", () => ({
  getMemoryQuickPrerequisiteStatus: vi.fn(() => null),
  readCachedQuickPrerequisiteStatus: vi.fn(() => null),
  refreshQuickPrerequisiteStatus: vi.fn(),
  createFallbackQuickPrerequisiteStatus: vi.fn(() => ({
    ready: false,
    summary: "Could not check system",
    checkedAt: 2000,
  })),
}));

import {
  getMemoryQuickPrerequisiteStatus,
  readCachedQuickPrerequisiteStatus,
  refreshQuickPrerequisiteStatus,
  createFallbackQuickPrerequisiteStatus,
} from "@/lib/pipelines/quick-prerequisite-status";
import { useQuickPrerequisiteStatus } from "./useQuickPrerequisiteStatus";

const mockGetMemory = vi.mocked(getMemoryQuickPrerequisiteStatus);
const mockReadCached = vi.mocked(readCachedQuickPrerequisiteStatus);
const mockRefresh = vi.mocked(refreshQuickPrerequisiteStatus);
const mockCreateFallback = vi.mocked(createFallbackQuickPrerequisiteStatus);

const readyStatus = { ready: true, summary: "All good", checkedAt: 1000 };
const fallbackStatus = { ready: false, summary: "Could not check system", checkedAt: 2000 };

beforeEach(() => {
  vi.resetAllMocks();
  mockGetMemory.mockReturnValue(null);
  mockReadCached.mockReturnValue(null);
  mockCreateFallback.mockReturnValue(fallbackStatus);
});

describe("useQuickPrerequisiteStatus", () => {
  it("starts with null systemReady and fetches via refresh", async () => {
    mockRefresh.mockResolvedValue(readyStatus);

    const { result } = renderHook(() => useQuickPrerequisiteStatus());

    expect(result.current.initialCheckPending).toBe(true);

    await waitFor(() => {
      expect(result.current.systemReady).toEqual(readyStatus);
    });

    expect(result.current.checkingSystem).toBe(false);
    expect(result.current.initialCheckPending).toBe(false);
    expect(result.current.systemBlocked).toBe(false);
  });

  it("uses memory cache when available and skips refresh", async () => {
    mockGetMemory.mockReturnValue(readyStatus);

    const { result } = renderHook(() => useQuickPrerequisiteStatus());

    expect(result.current.systemReady).toEqual(readyStatus);
    expect(result.current.checkingSystem).toBe(false);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("reads from session cache when memory cache is empty", async () => {
    mockReadCached.mockReturnValue(readyStatus);

    const { result } = renderHook(() => useQuickPrerequisiteStatus());

    await waitFor(() => {
      expect(result.current.systemReady).toEqual(readyStatus);
    });

    expect(result.current.checkingSystem).toBe(false);
  });

  it("falls back when refresh fails", async () => {
    mockRefresh.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useQuickPrerequisiteStatus());

    await waitFor(() => {
      expect(result.current.systemReady).toEqual(fallbackStatus);
    });

    expect(result.current.checkingSystem).toBe(false);
    expect(result.current.systemBlocked).toBe(true);
  });

  it("refreshSystemReady forces a refresh and returns updated status", async () => {
    mockRefresh.mockResolvedValue(readyStatus);

    const { result } = renderHook(() => useQuickPrerequisiteStatus());

    await waitFor(() => {
      expect(result.current.systemReady).toEqual(readyStatus);
    });

    const updatedStatus = { ready: true, summary: "Updated", checkedAt: 3000 };
    mockRefresh.mockResolvedValue(updatedStatus);

    let refreshResult: typeof readyStatus;
    await act(async () => {
      refreshResult = await result.current.refreshSystemReady();
    });

    expect(refreshResult!).toEqual(updatedStatus);
    expect(result.current.systemReady).toEqual(updatedStatus);
    expect(mockRefresh).toHaveBeenCalledWith({ force: true });
  });

  it("refreshSystemReady returns existing status on error", async () => {
    mockRefresh.mockResolvedValue(readyStatus);

    const { result } = renderHook(() => useQuickPrerequisiteStatus());

    await waitFor(() => {
      expect(result.current.systemReady).toEqual(readyStatus);
    });

    mockRefresh.mockRejectedValue(new Error("fail"));

    let refreshResult: typeof readyStatus;
    await act(async () => {
      refreshResult = await result.current.refreshSystemReady();
    });

    expect(refreshResult!).toEqual(readyStatus);
  });

  it("reports systemBlocked when status is not ready", async () => {
    const blockedStatus = { ready: false, summary: "Missing tools", checkedAt: 1000 };
    mockRefresh.mockResolvedValue(blockedStatus);

    const { result } = renderHook(() => useQuickPrerequisiteStatus());

    await waitFor(() => {
      expect(result.current.systemReady).toEqual(blockedStatus);
    });

    expect(result.current.systemBlocked).toBe(true);
  });
});
