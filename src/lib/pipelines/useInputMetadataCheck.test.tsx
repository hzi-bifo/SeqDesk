// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInputMetadataCheck } from "./useInputMetadataCheck";

const valid = { valid: true, issues: [], metadata: {} };
const options = { orderId: "order-1", pipelineId: "fastqc", sampleIdsKey: '["sample-a"]', inputRevision: "read-a", enabled: true };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

describe("useInputMetadataCheck", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset().mockResolvedValue(response(valid)); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("starts unresolved and only accepts a completed valid check", async () => {
    const { result } = renderHook(() => useInputMetadataCheck(options));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toEqual(valid));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it.each([401, 403, 500])("keeps HTTP %s failures unresolved until retry succeeds", async status => {
    fetchMock.mockResolvedValueOnce(response({ error: "Check failed" }, status));
    const { result } = renderHook(() => useInputMetadataCheck(options));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBeNull();
    if (status === 401) expect(result.current.error).toContain("session has expired");
    act(() => result.current.retry());
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.data).toEqual(valid));
  });

  it.each(["network", "invalid-json", "invalid-payload"])("reports %s errors instead of treating them as successful checks", async kind => {
    if (kind === "network") fetchMock.mockRejectedValueOnce(new TypeError("Network unavailable"));
    if (kind === "invalid-json") fetchMock.mockResolvedValueOnce(new Response("not JSON", { status: 200 }));
    if (kind === "invalid-payload") fetchMock.mockResolvedValueOnce(response({ valid: true, issues: [null] }));
    const { result } = renderHook(() => useInputMetadataCheck(options));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("invalidates a successful check immediately when the read selection changes", async () => {
    const { result, rerender } = renderHook(args => useInputMetadataCheck(args), { initialProps: options });
    await waitFor(() => expect(result.current.data).toEqual(valid));
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    rerender({ ...options, inputRevision: "read-b" });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it("aborts old checks and ignores stale replies after rapid sample switches", async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    const { result, rerender, unmount } = renderHook(args => useInputMetadataCheck(args), { initialProps: options });
    const oldSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    rerender({ ...options, sampleIdsKey: '["sample-b"]' });
    await waitFor(() => expect(result.current.data).toEqual(valid));
    expect(oldSignal.aborted).toBe(true);
    await act(async () => { finish(response({ valid: false, issues: [{ field: "sample-a", severity: "error", message: "Old sample" }], metadata: {} })); });
    expect(result.current.data).toEqual(valid);
    const latestSignal = fetchMock.mock.calls[1][1].signal as AbortSignal;
    unmount();
    expect(latestSignal.aborted).toBe(true);
  });

  it.each([{ ...options, enabled: false }, { ...options, sampleIdsKey: "[]" }])("does not validate a read-only view or an empty selection", async args => {
    const { result } = renderHook(() => useInputMetadataCheck(args));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
