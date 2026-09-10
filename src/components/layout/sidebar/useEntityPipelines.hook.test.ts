// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const polling = vi.hoisted(() => ({ callback: null as (() => void) | null, stop: vi.fn() }));
vi.mock("@/lib/polling", () => ({
  startVisiblePolling: (callback: () => void) => {
    polling.callback = callback;
    return polling.stop;
  },
}));

const fetchMock = vi.fn();
const definitions = [{
  pipelineId: "paired-qc",
  name: "Paired QC",
  enabled: true,
  input: { perSample: { reads: true, pairedEnd: true } },
  sequencingCompatibility: { readLengthClass: "short", readLayouts: ["paired"] },
}];
const pairedSample = {
  read: { file1: "reads_R1.fastq.gz", file2: "reads_R2.fastq.gz", filesMissing: false },
  sequencingTechnology: { readLengthClass: "short", readLayout: "paired" },
};
const jsonResponse = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response;

describe.each(["order", "study"] as const)("%s sidebar input compatibility", (entityType) => {
  const sampleUrl = (id: string) => entityType === "order" ? `/api/orders/${id}/pipeline-input` : `/api/studies/${id}`;
  const definitionsUrl = `/api/admin/settings/pipelines?enabled=true&catalog=${entityType}`;

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    polling.callback = null;
    polling.stop.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function loadHook() {
    return (await import("./useEntityPipelines")).useEntityPipelines;
  }

  it("uses each sample's files and metadata to summarize partial compatibility", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === definitionsUrl) return jsonResponse({ pipelines: definitions });
      if (url === sampleUrl("entity-1")) return jsonResponse({ samples: [pairedSample, { ...pairedSample, read: { ...pairedSample.read, file2: null } }] });
      return jsonResponse({ runs: [{ id: "run-1", pipelineId: "paired-qc", status: "completed" }] });
    });
    const useEntityPipelines = await loadHook();
    const { result } = renderHook(() => useEntityPipelines(entityType, true, "entity-1", false));
    await waitFor(() => expect(result.current[0]?.compatibility.status).toBe("partial"));
    expect(result.current[0]).toMatchObject({
      status: "complete",
      runIds: ["run-1"],
      compatibility: { compatibleSamples: 1, totalSamples: 2, reasons: [{ reason: "Missing R2 file", count: 1 }] },
    });
  });

  it.each(["network", "http", "invalid"])("keeps pipeline links with unknown compatibility on %s sample failures", async (failure) => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === definitionsUrl) return jsonResponse({ pipelines: definitions });
      if (url === sampleUrl("entity-1")) {
        if (failure === "network") throw new Error("Offline");
        if (failure === "http") return jsonResponse({}, false);
        return jsonResponse({});
      }
      return jsonResponse({ runs: [] });
    });
    const useEntityPipelines = await loadHook();
    const { result } = renderHook(() => useEntityPipelines(entityType, true, "entity-1", false));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].compatibility.status).toBe("unknown");
  });

  it("clears the previous entity immediately and ignores its late response", async () => {
    let finishOldRequest: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === definitionsUrl) return jsonResponse({ pipelines: definitions });
      if (url === sampleUrl("entity-1")) return new Promise<Response>((resolve) => { finishOldRequest = resolve; });
      if (url === sampleUrl("entity-2")) return jsonResponse({ samples: [{ read: null }] });
      return jsonResponse({ runs: [] });
    });
    const useEntityPipelines = await loadHook();
    const { result, rerender } = renderHook(({ id }) => useEntityPipelines(entityType, true, id, false), { initialProps: { id: "entity-1" } });
    await waitFor(() => expect(finishOldRequest).toBeTypeOf("function"));
    rerender({ id: "entity-2" });
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current[0]?.compatibility.status).toBe("incompatible"));
    await act(async () => finishOldRequest?.(jsonResponse({ samples: [pairedSample] })));
    expect(result.current[0].compatibility.status).toBe("incompatible");
  });

  it("does not retain old compatibility while a new entity loads", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === definitionsUrl) return jsonResponse({ pipelines: definitions });
      if (url === sampleUrl("entity-1")) return jsonResponse({ samples: [pairedSample] });
      if (url === sampleUrl("entity-2")) return new Promise<Response>(() => {});
      return jsonResponse({ runs: [] });
    });
    const useEntityPipelines = await loadHook();
    const { result, rerender } = renderHook(({ id }) => useEntityPipelines(entityType, true, id, false), { initialProps: { id: "entity-1" } });
    await waitFor(() => expect(result.current[0]?.compatibility.status).toBe("compatible"));
    rerender({ id: "entity-2" });
    expect(result.current).toEqual([]);
  });

  it("refreshes file availability and pipeline requirements while preserving completed runs", async () => {
    let now = 100_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let samples: unknown[] = [pairedSample];
    let currentDefinitions = definitions;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === definitionsUrl) return jsonResponse({ pipelines: currentDefinitions });
      if (url === sampleUrl("entity-1")) return jsonResponse({ samples });
      return jsonResponse({ runs: [{ id: "run-1", pipelineId: "paired-qc", status: "completed" }] });
    });
    const useEntityPipelines = await loadHook();
    const { result, unmount } = renderHook(() => useEntityPipelines(entityType, true, "entity-1", true));
    await waitFor(() => expect(result.current[0]?.compatibility.status).toBe("compatible"));
    samples = [{ ...pairedSample, read: { ...pairedSample.read, filesMissing: true } }];
    act(() => polling.callback?.());
    await waitFor(() => expect(result.current[0]?.compatibility.status).toBe("incompatible"));
    expect(result.current[0].status).toBe("complete");
    expect(fetchMock.mock.calls.filter(([url]) => url === definitionsUrl)).toHaveLength(1);

    samples = [pairedSample];
    currentDefinitions = [{ ...definitions[0], sequencingCompatibility: { readLengthClass: "long", readLayouts: ["paired"] } }];
    now += 60_001;
    act(() => polling.callback?.());
    await waitFor(() => expect(result.current[0]?.compatibility.reasons[0]?.reason).toContain("Requires long reads"));
    expect(fetchMock.mock.calls.filter(([url]) => url === definitionsUrl)).toHaveLength(2);
    unmount();
    expect(polling.stop).toHaveBeenCalled();
  });
});
