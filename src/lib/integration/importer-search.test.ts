import { afterEach, describe, expect, it, vi } from "vitest";

import { searchPdb, searchUniprot, searchZenodo } from "./importer-search";

type Call = { url: string; init?: RequestInit };
function stubFetch(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return handler(call);
  }));
  return calls;
}
const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers });

afterEach(() => { vi.unstubAllGlobals(); });

describe("public-record connector search", () => {
  it("searches Zenodo with plain words", async () => {
    const calls = stubFetch(() => json({ hits: { total: 1020, hits: [{ id: 6977322, doi: "10.5281/zenodo.6977322", metadata: { title: "binny", version: "3.1", license: { id: "cc-by-4.0" }, publication_date: "2022-05-30" } }] } }));
    const group = await searchZenodo("binny binning", ["binny", "binning"]);
    expect(new URL(calls[0].url).searchParams.get("q")).toBe("binny binning");
    expect(group).toEqual({ kind: "doi", connector: "zenodo-record", source: "Zenodo", total: 1020,
      hits: [{ id: "6977322", value: "6977322", title: "binny", detail: "Zenodo · 10.5281/zenodo.6977322 · v3.1 · cc-by-4.0 · 2022" }] });
  });

  it("looks a Zenodo DOI up directly", async () => {
    const calls = stubFetch(() => json({ id: 6977322, doi: "10.5281/zenodo.6977322", metadata: { title: "binny" } }));
    const group = await searchZenodo("10.5281/zenodo.6977322", ["10", "5281", "zenodo", "6977322"]);
    expect(calls.map(call => call.url)).toEqual(["https://zenodo.org/api/records/6977322"]);
    expect(group.hits[0].value).toBe("6977322");
  });

  it("searches UniProt and reads the total header", async () => {
    const calls = stubFetch(() => json({ results: [{ entryType: "UniProtKB reviewed (Swiss-Prot)", primaryAccession: "P69905", organism: { scientificName: "Homo sapiens" },
      proteinDescription: { recommendedName: { fullName: { value: "Hemoglobin subunit alpha" } } }, genes: [{ geneName: { value: "HBA1" } }], sequence: { length: 142 } }] }, { "x-total-results": "11265" }));
    const group = await searchUniprot(["hemoglobin", "alpha"]);
    expect(new URL(calls[0].url).searchParams.get("query")).toBe("hemoglobin AND alpha");
    expect(group).toMatchObject({ kind: "proteins", connector: "uniprot-entry", total: 11265,
      hits: [{ id: "P69905", value: "P69905", title: "Hemoglobin subunit alpha", detail: "UniProt · P69905 · HBA1 · Homo sapiens · 142 aa · reviewed (Swiss-Prot)" }] });
  });

  it("searches PDB and adds titles, keeping search order", async () => {
    const calls = stubFetch(({ url }) => url.includes("search.rcsb.org")
      ? json({ total_count: 2, result_set: [{ identifier: "1LM8" }, { identifier: "6GFX" }] })
      : json({ data: { entries: [{ rcsb_id: "6GFX", struct: { title: "Second" } }, { rcsb_id: "1LM8", struct: { title: "First" }, exptl: [{ method: "X-RAY DIFFRACTION" }], rcsb_entry_info: { resolution_combined: [1.85] } }] } }));
    const group = await searchPdb(["hif-1a", "pvhl"]);
    expect(JSON.parse(String(calls[0].init?.body)).query.parameters.value).toBe("hif-1a pvhl");
    expect(JSON.parse(String(calls[1].init?.body)).variables).toEqual({ ids: ["1LM8", "6GFX"] });
    expect(group).toMatchObject({ kind: "structures", connector: "pdb-entry", total: 2, hits: [
      { id: "1LM8", value: "1LM8", title: "First", detail: "PDB · 1LM8 · X-ray Diffraction · 1.85 Å" },
      { id: "6GFX", title: "Second" },
    ] });
  });

  it("treats an empty PDB answer as no hits", async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    expect(await searchPdb(["zzqqxx"])).toMatchObject({ total: 0, hits: [] });
  });
});

describe("search words and errors", () => {
  it("keeps a very long word short and words few", async () => {
    const { searchWords } = await import("./importers");
    expect(searchWords("a".repeat(3000))[0]).toHaveLength(60);
    expect(searchWords("one two three four five six seven")).toHaveLength(5);
  });
  it("never shows a parser's message for a source that sent something unreadable", async () => {
    const { searchErrorWords } = await import("./importers");
    let parsed: unknown;
    try { JSON.parse('[{"a":1}\n{'); } catch (error) { parsed = error; }
    expect(searchErrorWords(parsed)).toBe("The source sent an answer that could not be read. Try again in a moment.");
    expect(searchErrorWords(new Error("ENA search failed (HTTP 500)"))).toBe("ENA search failed (HTTP 500)");
    expect(searchErrorWords(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe("The source did not answer in time.");
  });
});
