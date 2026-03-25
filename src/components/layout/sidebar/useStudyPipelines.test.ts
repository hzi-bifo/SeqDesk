// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

function jsonResponse(data: unknown, ok = true) {
  return {
    ok,
    json: async () => data,
  } as Response;
}

describe("useStudyPipelines hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("returns no pipelines when admin controls are hidden or no study is selected", async () => {
    const { useStudyPipelines } = await import("./useStudyPipelines");

    const { result } = renderHook(() => useStudyPipelines(false, "study-1"));
    expect(result.current).toEqual([]);

    const { result: noStudyResult } = renderHook(() => useStudyPipelines(true, null));
    expect(noStudyResult.current).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps fetched study pipelines to sidebar items using run status", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/admin/settings/pipelines?enabled=true&catalog=study") {
        return jsonResponse({
          pipelines: [
            { pipelineId: "mag", name: "MAG", enabled: true },
            { pipelineId: "submg", name: "SubMG", enabled: true },
          ],
        });
      }
      if (url === "/api/pipelines/runs?studyId=study-1&limit=200") {
        return jsonResponse({
          runs: [
            { pipelineId: "mag", status: "completed" },
            { pipelineId: "submg", status: "running" },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const { useStudyPipelines } = await import("./useStudyPipelines");
    const { result, unmount } = renderHook(() => useStudyPipelines(true, "study-1"));

    await waitFor(() => {
      expect(result.current).toEqual([
        {
          pipelineId: "mag",
          name: "MAG",
          status: "complete",
        },
        {
          pipelineId: "submg",
          name: "SubMG",
          status: "partial",
        },
      ]);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/settings/pipelines?enabled=true&catalog=study"
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/pipelines/runs?studyId=study-1&limit=200");

    unmount();
  });

  it("caches study pipeline definitions across hook instances", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/admin/settings/pipelines?enabled=true&catalog=study") {
        return jsonResponse({
          pipelines: [{ pipelineId: "mag", name: "MAG", enabled: true }],
        });
      }
      if (url.startsWith("/api/pipelines/runs?studyId=")) {
        return jsonResponse({ runs: [] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const { useStudyPipelines } = await import("./useStudyPipelines");
    const first = renderHook(() => useStudyPipelines(true, "study-1"));

    await waitFor(() => {
      expect(first.result.current).toEqual([
        {
          pipelineId: "mag",
          name: "MAG",
          status: "empty",
        },
      ]);
    });
    first.unmount();

    const second = renderHook(() => useStudyPipelines(true, "study-2"));

    await waitFor(() => {
      expect(second.result.current).toEqual([
        {
          pipelineId: "mag",
          name: "MAG",
          status: "empty",
        },
      ]);
    });
    second.unmount();

    expect(
      fetchMock.mock.calls.filter(
        ([url]) => url === "/api/admin/settings/pipelines?enabled=true&catalog=study"
      )
    ).toHaveLength(1);
  });

  it("falls back to an empty study pipeline list when fetching fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));

    const { useStudyPipelines } = await import("./useStudyPipelines");
    const { result } = renderHook(() => useStudyPipelines(true, "study-1"));

    await waitFor(() => {
      expect(result.current).toEqual([]);
    });
  });
});
