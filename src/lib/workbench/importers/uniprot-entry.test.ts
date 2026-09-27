import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { importPreviewFingerprint } from "../import-preview-fingerprint";
import { mapUniprotEntry, uniprotEntryImporter, uniprotFastaSequence } from "./uniprot-entry";
import type { WorkbenchImportStartContext } from "./types";

const SEQUENCE = "MVLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHFDLSHGSAQVKGHG";
const md5 = (value: string) => crypto.createHash("md5").update(value).digest("hex").toUpperCase();

// Trimmed shape of https://rest.uniprot.org/uniprotkb/{accession}.json.
const entry = (accession = "P69905", overrides: Record<string, unknown> = {}) => ({
  entryType: "UniProtKB reviewed (Swiss-Prot)",
  primaryAccession: accession,
  entryAudit: { entryVersion: 219 },
  organism: { scientificName: "Homo sapiens", taxonId: 9606 },
  proteinDescription: { recommendedName: { fullName: { value: "Hemoglobin subunit alpha" } } },
  genes: [{ geneName: { value: "HBA1" } }, { geneName: { value: "HBA2" } }],
  sequence: { value: SEQUENCE, length: SEQUENCE.length, md5: md5(SEQUENCE) },
  ...overrides,
});
const fasta = `>sp|P69905|HBA_HUMAN Hemoglobin subunit alpha OS=Homo sapiens\n${SEQUENCE.slice(0, 30)}\n${SEQUENCE.slice(30)}\n`;

function stubFetch(routes: Record<string, () => Response>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => routes[String(url)]?.() ?? new Response(JSON.stringify({ messages: ["Resource not found"] }), { status: 404 })));
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const input = (accessions: unknown) => uniprotEntryImporter.inputSchema.parse({ accessions });

afterEach(() => { vi.unstubAllGlobals(); });

describe("UniProt entry importer", () => {
  it("accepts up to 50 unique accessions", () => {
    expect(input("p69905 P69905 q16665").accessions).toEqual(["P69905", "Q16665"]);
    expect(() => input(Array.from({ length: 51 }, (_, i) => `P${String(10000 + i)}`))).toThrow();
    expect(() => input(["P69905;DROP"])).toThrow();
  });

  it("maps reviewed and unreviewed entries", () => {
    expect(mapUniprotEntry("P69905", entry()).record).toEqual({ id: "P69905", title: "Hemoglobin subunit alpha", detail: "HBA1 · Homo sapiens · 60 aa · reviewed (Swiss-Prot)" });
    const trembl = mapUniprotEntry("A0A023GPI8", entry("A0A023GPI8", { entryType: "UniProtKB unreviewed (TrEMBL)", proteinDescription: { submissionNames: [{ fullName: { value: "Lectin alpha chain" } }] }, genes: undefined }));
    expect(trembl.record).toEqual({ id: "A0A023GPI8", title: "Lectin alpha chain", detail: "Homo sapiens · 60 aa · unreviewed (TrEMBL)" });
  });

  it("explains inactive entries", () => {
    expect(() => mapUniprotEntry("Q00018", { entryType: "Inactive", primaryAccession: "Q00018", inactiveReason: { inactiveReasonType: "MERGED", mergeDemergeTo: ["Q00001"] } }))
      .toThrow("UniProt entry Q00018 was merged into Q00001. Use Q00001 instead.");
    expect(() => mapUniprotEntry("Q0ZZZ9", { entryType: "Inactive", primaryAccession: "Q0ZZZ9", inactiveReason: { inactiveReasonType: "DELETED" } }))
      .toThrow("UniProt entry Q0ZZZ9 is no longer active (it was deleted).");
  });

  it("previews a FASTA and a JSON asset per entry, deterministically", async () => {
    stubFetch({ "https://rest.uniprot.org/uniprotkb/P69905.json": () => json(entry()) });
    const parsed = input(["P69905"]);
    const preview = await uniprotEntryImporter.preview(parsed);
    expect(preview).toMatchObject({
      providerId: "uniprot-entry",
      summary: { label: "UniProt P69905 · Hemoglobin subunit alpha", totalFound: 1, selectedCount: 1, capped: false, cap: 50, hardMax: 50 },
      assets: [
        { url: "https://rest.uniprot.org/uniprotkb/P69905.fasta", filename: "P69905.fasta", bytes: 0, etag: `sequence-md5:${md5(SEQUENCE)}`, role: "sequence" },
        { url: "https://rest.uniprot.org/uniprotkb/P69905.json", filename: "P69905.json", bytes: 0, etag: "entry-version:219", role: "metadata" },
      ],
    });
    expect(importPreviewFingerprint("uniprot-entry", parsed, preview)).toBe(importPreviewFingerprint("uniprot-entry", parsed, await uniprotEntryImporter.preview(parsed)));
  });

  it("names missing and merged entries", async () => {
    stubFetch({ "https://rest.uniprot.org/uniprotkb/Q00018.json": () => json({ entryType: "Inactive", primaryAccession: "Q00018", inactiveReason: { inactiveReasonType: "MERGED", mergeDemergeTo: ["Q00001"] } }, 303) });
    await expect(uniprotEntryImporter.preview(input(["A0A9Z9Z9Z9"]))).rejects.toThrow("UniProt has no entry A0A9Z9Z9Z9.");
    await expect(uniprotEntryImporter.preview(input(["Q00018"]))).rejects.toThrow("was merged into Q00001");
  });

  it("checks the FASTA header", () => {
    expect(uniprotFastaSequence(fasta, "P69905")).toBe(SEQUENCE);
    expect(() => uniprotFastaSequence(fasta, "P69906")).toThrow("unexpected FASTA");
  });

  it("verifies the downloaded sequence against the entry's checksum", async () => {
    stubFetch({ "https://rest.uniprot.org/uniprotkb/P69905.json": () => json(entry()) });
    const parsed = input(["P69905"]);
    const preview = await uniprotEntryImporter.preview(parsed);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "uniprot-test-"));
    const context = (cacheDir: string): WorkbenchImportStartContext<typeof parsed> => ({
      jobId: "job", workspaceId: "ws", userId: "user", input: parsed, preview, cacheKey: "key",
      storage: { baseDir: root, cacheRoot: root, jobsRoot: root, cacheDir, jobDir: root, logPath: path.join(root, "log") },
      update: async () => {}, log: async () => {},
    });
    try {
      stubFetch({ "https://rest.uniprot.org/uniprotkb/P69905.fasta": () => new Response(fasta), "https://rest.uniprot.org/uniprotkb/P69905.json": () => json(entry()) });
      const result = await uniprotEntryImporter.start(context(path.join(root, "ok")));
      expect(result.sourceType).toBe("uniprot-entry");
      expect((result.sourceMetadata as { files: unknown[] }).files).toHaveLength(2);
      stubFetch({ "https://rest.uniprot.org/uniprotkb/P69905.fasta": () => new Response(fasta.replace("MVLS", "MVLT")), "https://rest.uniprot.org/uniprotkb/P69905.json": () => json(entry()) });
      await expect(uniprotEntryImporter.start(context(path.join(root, "bad")))).rejects.toThrow("sequence changed since the preview");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
