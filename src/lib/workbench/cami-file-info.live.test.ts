import { afterEach, describe, expect, it, vi } from "vitest";
import { getCamiSampleFileInfo } from "./cami-file-info.server";

describe.runIf(process.env.SEQDESK_CAMI_HEADERS_LIVE === "1")("real CAMI sample file headers (no archive download)", () => {
  afterEach(() => vi.restoreAllMocks());
  it("reads and caches real marine archive sizes using HEAD only", async () => {
    // Observe real network calls; do not simulate external responses.
    const fetch = vi.spyOn(globalThis, "fetch");
    const query = { dataset: "cami2-marine", technology: "short" } as const;
    const files = await getCamiSampleFileInfo(query);
    expect(files).toHaveLength(10);
    for (const [sample, file] of files.entries()) {
      expect(file.sample).toBe(sample);
      expect(file.downloadBytes).toBeGreaterThan(0);
    }
    for (const [, options] of fetch.mock.calls) expect(options?.method).toBe("HEAD");
    expect(fetch).toHaveBeenCalledTimes(10);
    fetch.mockClear();
    expect(await getCamiSampleFileInfo(query)).toEqual(files);
    expect(fetch).not.toHaveBeenCalled();
  }, 45_000);
});
