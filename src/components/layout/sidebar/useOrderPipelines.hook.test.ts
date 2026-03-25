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

describe("useOrderPipelines hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("returns no pipelines when admin controls are hidden or no order is selected", async () => {
    const { useOrderPipelines } = await import("./useOrderPipelines");

    const { result } = renderHook(() => useOrderPipelines(false, "order-1"));
    expect(result.current).toEqual([]);

    const { result: noOrderResult } = renderHook(() => useOrderPipelines(true, null));
    expect(noOrderResult.current).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps fetched pipelines and resets read-dependent completions when reads are missing", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/admin/settings/pipelines?enabled=true&catalog=order") {
        return jsonResponse({
          pipelines: [
            {
              pipelineId: "fastq-checksum",
              name: "FASTQ Checksum",
              enabled: true,
              capabilities: { requiresLinkedReads: true },
            },
            {
              pipelineId: "simulate-reads",
              name: "Simulate Reads",
              enabled: true,
              capabilities: { requiresLinkedReads: false },
            },
          ],
        });
      }
      if (url === "/api/pipelines/runs?orderId=order-1&limit=200") {
        return jsonResponse({
          runs: [
            { pipelineId: "fastq-checksum", status: "completed" },
            { pipelineId: "simulate-reads", status: "running" },
          ],
        });
      }
      if (url === "/api/orders/order-1/sequencing") {
        return jsonResponse({
          summary: {
            readsLinkedSamples: 0,
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const { useOrderPipelines } = await import("./useOrderPipelines");
    const { result, unmount } = renderHook(() => useOrderPipelines(true, "order-1"));

    await waitFor(() => {
      expect(result.current).toEqual([
        {
          pipelineId: "fastq-checksum",
          name: "FASTQ Checksum",
          status: "empty",
        },
        {
          pipelineId: "simulate-reads",
          name: "Simulate Reads",
          status: "partial",
        },
      ]);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/settings/pipelines?enabled=true&catalog=order"
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/pipelines/runs?orderId=order-1&limit=200");
    expect(fetchMock).toHaveBeenCalledWith("/api/orders/order-1/sequencing");

    unmount();
  });

  it("caches pipeline definitions across hook instances", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/admin/settings/pipelines?enabled=true&catalog=order") {
        return jsonResponse({
          pipelines: [
            {
              pipelineId: "simulate-reads",
              name: "Simulate Reads",
              enabled: true,
              capabilities: { requiresLinkedReads: false },
            },
          ],
        });
      }
      if (url.startsWith("/api/pipelines/runs?orderId=")) {
        return jsonResponse({ runs: [] });
      }
      if (url.startsWith("/api/orders/")) {
        return jsonResponse({ summary: { readsLinkedSamples: 1 } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const { useOrderPipelines } = await import("./useOrderPipelines");
    const first = renderHook(() => useOrderPipelines(true, "order-1"));

    await waitFor(() => {
      expect(first.result.current).toEqual([
        {
          pipelineId: "simulate-reads",
          name: "Simulate Reads",
          status: "empty",
        },
      ]);
    });
    first.unmount();

    const second = renderHook(() => useOrderPipelines(true, "order-2"));

    await waitFor(() => {
      expect(second.result.current).toEqual([
        {
          pipelineId: "simulate-reads",
          name: "Simulate Reads",
          status: "empty",
        },
      ]);
    });
    second.unmount();

    expect(
      fetchMock.mock.calls.filter(
        ([url]) => url === "/api/admin/settings/pipelines?enabled=true&catalog=order"
      )
    ).toHaveLength(1);
  });

  it("falls back to an empty pipeline list when fetching fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));

    const { useOrderPipelines } = await import("./useOrderPipelines");
    const { result } = renderHook(() => useOrderPipelines(true, "order-1"));

    await waitFor(() => {
      expect(result.current).toEqual([]);
    });
  });
});
