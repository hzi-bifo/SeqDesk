import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mgnifyDownloadsImporter, parseMgnifyRef } from "./mgnify-downloads";
import type { WorkbenchImportStartContext } from "./types";

const API = "https://www.ebi.ac.uk/metagenomics/api/v1/";
const fileUrl = (version: string, name: string) => `${API}studies/MGYS00002008/pipelines/${version}/file/${name}`;
const download = (version: string, name: string, label: string) => ({
  id: name, type: "downloads", attributes: { alias: name, description: { label }, "file-format": { name: "TSV" }, "file-checksum": { checksum: "", "checksum-algorithm": "" } },
  relationships: { pipeline: { data: { type: "pipelines", id: version } } }, links: { self: fileUrl(version, name) },
});
const study = { data: { id: "MGYS00002008", attributes: { "study-name": "Tara  Oceans prokaryotes", "secondary-accession": "ERP104174", bioproject: "PRJEB22493", "samples-count": 136, "is-private": false, "last-update": "2022-01-16T11:17:46" }, relationships: {} } };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
function stubFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const mock = vi.fn(async (url: string | URL, init?: RequestInit) => routes[`${init?.method ?? "GET"} ${String(url)}`]?.(init) ?? new Response("missing", { status: 404 }));
  vi.stubGlobal("fetch", mock);
  return mock;
}
const head = (bytes: number) => () => new Response(null, { status: 200, headers: { "content-length": String(bytes) } });
const input = (value: string, extra: Record<string, unknown> = {}) => mgnifyDownloadsImporter.inputSchema.parse({ accession: value, ...extra });

function routes(extra: Record<string, (init?: RequestInit) => Response> = {}) {
  return {
    [`GET ${API}studies/MGYS00002008`]: () => json(study),
    [`GET ${API}studies/MGYS00002008/downloads?page=1&page_size=100`]: () => json({ links: { next: null }, data: [
      download("4.0", "ERP104174_taxonomy_abundances_SSU_v4.0.tsv", "Taxonomic assignments SSU"),
      download("4.1", "ERP104174_taxonomy_abundances_SSU_v4.1.tsv", "Taxonomic assignments SSU"),
      download("4.1", "ERP104174_reads.fasta.gz", "Reads"),
    ] }),
    [`HEAD ${fileUrl("4.0", "ERP104174_taxonomy_abundances_SSU_v4.0.tsv")}`]: head(5),
    [`HEAD ${fileUrl("4.1", "ERP104174_taxonomy_abundances_SSU_v4.1.tsv")}`]: head(5),
    [`HEAD ${fileUrl("4.1", "ERP104174_reads.fasta.gz")}`]: head(900),
    ...extra,
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("MGnify downloads importer", () => {
  it.each([["MGYS00002008", "MGYS00002008"], ["mgya00585259", "MGYA00585259"], ["https://www.ebi.ac.uk/metagenomics/studies/MGYS00002008", "MGYS00002008"]])("reads %s", (value, accession) => {
    expect(parseMgnifyRef(value)).toBe(accession);
  });
  it.each(["", "MGYS1", "ERP104174", "https://evil.example/MGYS00002008"])("rejects %s", (value) => { expect(() => input(value)).toThrow(); });

  it("lists every file with its measured size and ticks the newest pipeline's tables", async () => {
    stubFetch(routes());
    const preview = await mgnifyDownloadsImporter.preview(input("MGYS00002008"));
    expect(preview).toMatchObject({
      providerId: "mgnify-downloads",
      summary: { label: "MGnify MGYS00002008 · Tara Oceans prokaryotes", totalFound: 3, selectedCount: 1 },
      records: [{ id: "MGYS00002008", detail: "ERP104174 · PRJEB22493 · 136 samples · 2022" }],
      sampleMetadata: { licence: "EMBL-EBI terms of use" },
    });
    expect(preview.assets?.map(asset => [asset.filename, asset.bytes])).toEqual([["ERP104174_taxonomy_abundances_SSU_v4.1.tsv", 5]]);
    expect(preview.choices?.find(choice => choice.filename.endsWith(".fasta.gz"))).toMatchObject({ bytes: 900, selected: false });
    expect(preview.warnings).toContainEqual(expect.stringContaining("pipelines 4.0, 4.1"));
    expect(preview.warnings).toContainEqual(expect.stringContaining("does not publish checksums"));
  });

  it("refuses download links outside the record", async () => {
    stubFetch(routes({ [`GET ${API}studies/MGYS00002008/downloads?page=1&page_size=100`]: () => json({ links: {}, data: [{ ...download("4.1", "x.tsv", "x"), links: { self: `${API}studies/MGYS00000001/pipelines/4.1/file/x.tsv` } }] }) }));
    await expect(mgnifyDownloadsImporter.preview(input("MGYS00002008"))).rejects.toThrow("unexpected download address");
  });

  it("downloads the ticked table, checks its size and records SHA-256 and the terms", async () => {
    stubFetch(routes());
    const parsed = input("MGYS00002008");
    const preview = await mgnifyDownloadsImporter.preview(parsed);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mgnify-test-"));
    const context = (cacheDir: string): WorkbenchImportStartContext<typeof parsed> => ({
      jobId: "job", workspaceId: "ws", userId: "user", input: parsed, preview, cacheKey: "key",
      storage: { baseDir: root, cacheRoot: root, jobsRoot: root, cacheDir, jobDir: root, logPath: path.join(root, "log") },
      update: async () => {}, log: async () => {},
    });
    try {
      stubFetch({ [`GET ${fileUrl("4.1", "ERP104174_taxonomy_abundances_SSU_v4.1.tsv")}`]: () => new Response("a\tb\nc") });
      const result = await mgnifyDownloadsImporter.start(context(path.join(root, "ok")));
      expect(result.sourceMetadata).toMatchObject({ source: "MGnify", record: "MGYS00002008", licence: "EMBL-EBI terms of use", sourcePage: "https://www.ebi.ac.uk/metagenomics/studies/MGYS00002008" });
      expect((result.sourceMetadata as { files: Array<{ sha256: string }> }).files[0].sha256).toBe(crypto.createHash("sha256").update("a\tb\nc").digest("hex"));
      stubFetch({ [`GET ${fileUrl("4.1", "ERP104174_taxonomy_abundances_SSU_v4.1.tsv")}`]: () => new Response("a\tb\ncd") });
      await expect(mgnifyDownloadsImporter.start(context(path.join(root, "bad")))).rejects.toThrow("larger than MGnify declared");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
