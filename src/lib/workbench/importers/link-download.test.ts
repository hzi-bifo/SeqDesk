import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ safeFetch: vi.fn() }));
vi.mock("./safe-url", async (original) => ({ ...(await original<typeof import("./safe-url")>()), safeFetch: mocks.safeFetch }));

import { fileNameFor, linkDownloadImporter, mapCsl, parseDoi, previewLink, recognise, UNKNOWN_LICENCE } from "./link-download";

function answer(status: number, headers: Record<string, string>, body = "", url = "https://example.org/data.csv") {
  const stream = new PassThrough();
  stream.end(body);
  return { status, headers, body: stream, url };
}
const parse = (link: string, extra: Record<string, unknown> = {}) => linkDownloadImporter.inputSchema.parse({ link, ...extra });

describe("recognise", () => {
  it.each([
    ["10.5281/zenodo.4950125", "zenodo-record", "4950125"],
    ["https://doi.org/10.5281/zenodo.4950125", "zenodo-record", "4950125"],
    ["https://zenodo.org/records/7474876", "zenodo-record", "7474876"],
    ["10.6084/m9.figshare.33917185.v6", "figshare-article", "33917185.v6"],
    ["https://figshare.com/articles/dataset/x/32121403", "figshare-article", "32121403"],
    ["10.5061/dryad.2bvq83bnv", "dryad-dataset", "10.5061/dryad.2bvq83bnv"],
    ["https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE52778", "geo-series", "GSE52778"],
  ])("hands %s to %s", (value, providerId, id) => expect(recognise(value)).toMatchObject({ providerId, value: id }));
  it("leaves other DOIs and links alone", () => {
    expect(recognise("10.1038/s41586-020-2649-2")).toBeNull();
    expect(recognise("https://example.org/data.csv")).toBeNull();
    expect(recognise("33917185")).toBeNull();
  });
});

describe("parts", () => {
  it("parses DOIs in their usual spellings", () => {
    expect(parseDoi("doi:10.1038/nature12373")).toBe("10.1038/nature12373");
    expect(parseDoi("https://doi.org/10.1038/nature12373.")).toBe("10.1038/nature12373");
    expect(parseDoi("https://example.org/10.1038/x")).toBeNull();
  });
  it("reads CSL JSON", () => {
    expect(mapCsl({ title: "A study", URL: "https://example.org/s", publisher: "Pub", license: [{ URL: "https://creativecommons.org/licenses/by/4.0/" }], issued: { "date-parts": [[2021, 3]] }, type: "dataset" }))
      .toEqual({ title: "A study", url: "https://example.org/s", publisher: "Pub", licence: "creativecommons.org/licenses/by/4.0/", licenceUrl: "https://creativecommons.org/licenses/by/4.0/", year: "2021", type: "dataset" });
  });
  it("names files safely", () => {
    expect(fileNameFor("https://example.org/a/b/data%20set.csv")).toBe("data_set.csv");
    expect(fileNameFor("https://example.org/x", 'attachment; filename="../../etc/passwd"')).toBe("passwd");
    expect(fileNameFor("https://example.org/")).toBe("download");
  });
});

describe("previewLink", () => {
  beforeEach(() => mocks.safeFetch.mockReset());

  it("hands a known DOI to its connector without asking anyone", async () => {
    const preview = await previewLink(parse("10.5281/zenodo.4950125"));
    expect(preview.handoff).toEqual({ providerId: "zenodo-record", value: "4950125", what: "a Zenodo record" });
    expect(preview.assets).toBeUndefined();
    expect(mocks.safeFetch).not.toHaveBeenCalled();
  });

  it("resolves other DOIs through doi.org content negotiation and hands off by landing page", async () => {
    mocks.safeFetch.mockResolvedValueOnce(answer(200, { "content-type": "application/vnd.citationstyles.csl+json" }, JSON.stringify({ title: "Data", URL: "https://zenodo.org/records/123456" })));
    const preview = await previewLink(parse("10.9999/example.1"));
    expect(mocks.safeFetch.mock.calls[0][0]).toBe("https://doi.org/10.9999/example.1");
    expect(mocks.safeFetch.mock.calls[0][1].headers.accept).toBe("application/vnd.citationstyles.csl+json");
    expect(preview.handoff).toMatchObject({ providerId: "zenodo-record", value: "123456" });
  });

  it("explains that an unknown publisher's DOI is a landing page, licence unknown", async () => {
    mocks.safeFetch.mockResolvedValueOnce(answer(200, {}, JSON.stringify({ title: "Paper", URL: "https://publisher.example/article/1", publisher: "Publisher" })));
    const preview = await previewLink(parse("10.1234/abc"));
    expect(preview.assets).toBeUndefined();
    expect(preview.sampleMetadata).toMatchObject({ licence: UNKNOWN_LICENCE, landingPage: "https://publisher.example/article/1" });
    expect(preview.warnings?.[0]).toMatch(/landing page/);
  });

  it("previews a file link with size, type and an unknown licence", async () => {
    mocks.safeFetch.mockResolvedValueOnce(answer(200, { "content-length": "4096", "content-type": "text/csv; charset=utf-8", etag: '"abc"' }));
    const preview = await previewLink(parse("https://example.org/data.csv"));
    expect(preview.assets).toEqual([{ url: "https://example.org/data.csv", filename: "data.csv", bytes: 4096, etag: 'etag:"abc"', role: "file" }]);
    expect(preview.sampleMetadata).toMatchObject({ licence: UNKNOWN_LICENCE, contentType: "text/csv", site: "example.org" });
    expect(preview.warnings?.join(" ")).toMatch(/no checksum/);
  });

  it("falls back to a one-byte ranged GET when HEAD is refused", async () => {
    mocks.safeFetch
      .mockResolvedValueOnce(answer(405, {}))
      .mockResolvedValueOnce(answer(206, { "content-range": "bytes 0-0/9000", "content-type": "application/gzip" }));
    const preview = await previewLink(parse("https://example.org/data.tsv.gz"));
    expect(mocks.safeFetch.mock.calls[1][1]).toMatchObject({ method: "GET", headers: { range: "bytes=0-0" } });
    expect(preview.assets?.[0].bytes).toBe(9000);
  });

  it("refuses web pages and warns over the size limit", async () => {
    mocks.safeFetch.mockResolvedValueOnce(answer(200, { "content-type": "text/html" }));
    await expect(previewLink(parse("https://example.org/page"))).rejects.toThrow("web page, not a file");
    mocks.safeFetch.mockResolvedValueOnce(answer(200, { "content-length": String(10 * 1024 ** 2), "content-type": "application/zip" }));
    const preview = await previewLink(parse("https://example.org/big.zip", { maxBytes: 1024 ** 2 }));
    expect(preview.warnings?.[0]).toMatch(/larger than the limit/);
  });

  it("refuses private addresses and other schemes before any request", async () => {
    for (const link of ["https://192.168.1.10/data.csv", "file:///etc/passwd", "http://example.org/x", "https://localhost/x"]) {
      await expect(previewLink(parse(link))).rejects.toThrow();
    }
    expect(mocks.safeFetch).not.toHaveBeenCalled();
  });
});
