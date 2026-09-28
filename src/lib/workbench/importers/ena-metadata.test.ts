import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnaMetadata } from "./ena-metadata";

const xml = (accession: string) => new Response(`<ROOT><SAMPLE accession="${accession}"/></ROOT>`, { status: 200 });

/** A fetch that never answers until its signal aborts, as the ENA browser API does when it is slow. */
const hang = (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
  init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
});

describe("loadEnaMetadata", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retries a record once after a timeout instead of failing the import", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => (++calls === 1 ? hang(url, init) : Promise.resolve(xml("SAMEA1")))));
    const records = await loadEnaMetadata(["SAMEA1"], undefined, 20);
    expect(calls).toBe(2);
    expect(records.SAMEA1.xml).toContain('accession="SAMEA1"');
  });

  it("gives up after the second timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(hang));
    await expect(loadEnaMetadata(["SAMEA1"], undefined, 20)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a missing record or a cancelled job", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await expect(loadEnaMetadata(["SAMEA1"])).rejects.toThrow("Metadata unavailable for SAMEA1");
    expect(fetch).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(hang));
    const loading = loadEnaMetadata(["SAMEA1"], controller.signal, 60_000);
    controller.abort();
    await expect(loading).rejects.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("loads the records in parallel", async () => {
    let open = 0, peak = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      open += 1; peak = Math.max(peak, open);
      await new Promise(resolve => setTimeout(resolve, 5));
      open -= 1;
      return xml(url.split("/").pop()!);
    }));
    const records = await loadEnaMetadata(["PRJEB1", "SAMEA1", "ERX1", "ERR1", "ERR1"]);
    expect(Object.keys(records).sort()).toEqual(["ERR1", "ERX1", "PRJEB1", "SAMEA1"]);
    expect(peak).toBe(4);
  });
});
