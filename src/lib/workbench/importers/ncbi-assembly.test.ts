import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { siteSettings: { findUnique: vi.fn(async () => null) } } }));

import { resetNcbiApiKeyCache, resetNcbiLimiter } from "./ncbi-client";
import { estimateFastaBytes, mapAssemblyPreview, ncbiAssemblyImporter, readAssemblyReports } from "./ncbi-assembly";
import type { WorkbenchImportStartContext } from "./types";

// Recorded from the NCBI Datasets API on 2026-09-28: Mycoplasmoides genitalium G37 (580 kb, RefSeq, annotated).
const report = async () => JSON.parse(await fs.readFile(path.join(__dirname, "__fixtures__", "ncbi", "assembly-GCF_000027325.1.json"), "utf8")) as { reports: Record<string, unknown>[] };
const input = (value: Record<string, unknown>) => ncbiAssemblyImporter.inputSchema.parse(value);
const md5 = (value: string) => crypto.createHash("md5").update(value).digest("hex");

beforeEach(() => { resetNcbiLimiter(); resetNcbiApiKeyCache(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/** A minimal Datasets package ZIP (stored entries) with an md5sum.txt. */
async function packageZip(entries: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("NCBI assembly importer", () => {
  it("accepts versioned and unversioned GCF_/GCA_ accessions only", () => {
    expect(input({ accessions: "gcf_000027325.1, GCA_000027325" }).accessions).toEqual(["GCF_000027325.1", "GCA_000027325"]);
    expect(() => input({ accessions: ["GCF_1.1"] })).toThrow("is not an assembly accession");
  });

  it("previews genome FASTA and GFF with estimated sizes, licence and citation", async () => {
    const reports = readAssemblyReports(await report());
    const preview = mapAssemblyPreview(input({ accessions: ["GCF_000027325.1"] }), reports);
    expect(preview.choices).toEqual([
      { filename: "GCF_000027325.1_genomic.fna", bytes: estimateFastaBytes(580076), selected: true, table: false },
      { filename: "GCF_000027325.1_genomic.gff", bytes: expect.any(Number), selected: true, table: false },
    ]);
    expect(preview.records?.[0]).toMatchObject({ id: "GCF_000027325.1", title: "Mycoplasmoides genitalium G37 · ASM2732v1", detail: expect.stringContaining("annotated") });
    expect(preview.sampleMetadata?.citation).toMatch(/^TIGR \(2006\) Mycoplasmoides genitalium G37 ASM2732v1, RefSeq assembly GCF_000027325\.1\. https:\/\/www\.ncbi\.nlm\.nih\.gov\/datasets\/genome\/GCF_000027325\.1\/$/);
  });

  it("ticks nothing above the size cap, so a large genome needs its files ticked", async () => {
    const reports = readAssemblyReports(await report());
    const capped = mapAssemblyPreview(input({ accessions: ["GCF_000027325.1"] }), reports, 100_000);
    expect(capped.assets).toEqual([]);
    expect(capped.choices?.every(choice => !choice.selected)).toBe(true);
    expect(capped.warnings).toContainEqual(expect.stringContaining("Tick the files you want to confirm the download"));
    const ticked = mapAssemblyPreview(input({ accessions: ["GCF_000027325.1"], files: ["GCF_000027325.1_genomic.fna"] }), reports, 100_000);
    expect(ticked.assets?.map(asset => asset.filename)).toEqual(["GCF_000027325.1_genomic.fna"]);
    expect(() => mapAssemblyPreview(input({ accessions: ["GCF_000027325.1"], files: ["other.fna"] }), reports)).toThrow("no file named other.fna");
  });

  it("resolves an unversioned accession and says which are missing", async () => {
    const reports = readAssemblyReports(await report());
    const preview = mapAssemblyPreview(input({ accessions: ["GCF_000027325", "GCF_999999999.1"] }), reports);
    expect(preview.genomes.map(genome => genome.accession)).toEqual(["GCF_000027325.1"]);
    expect(preview.warnings).toContainEqual("NCBI has no current assembly GCF_999999999.1.");
    expect(preview.warnings).toContainEqual(expect.stringContaining("resolved to the current version: GCF_000027325.1"));
  });

  it("refuses to start above the cap without ticks, then downloads and checks NCBI's MD5s", async () => {
    const fna = ">NC_000908.2 Mycoplasma genitalium G37\nACGT\n";
    const gff = "##gff-version 3\nNC_000908.2\tRefSeq\tregion\t1\t4\t.\t+\t.\tID=x\n";
    const zip = await packageZip({
      "ncbi_dataset/data/GCF_000027325.1/GCF_000027325.1_ASM2732v1_genomic.fna": fna,
      "ncbi_dataset/data/GCF_000027325.1/genomic.gff": gff,
      "md5sum.txt": `${md5(fna)}  ncbi_dataset/data/GCF_000027325.1/GCF_000027325.1_ASM2732v1_genomic.fna\n${md5(gff)}  ncbi_dataset/data/GCF_000027325.1/genomic.gff\n`,
    });
    const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => { requests.push(new URL(String(url))); return new Response(new Uint8Array(zip)); }));
    const reports = readAssemblyReports(await report());
    const parsed = input({ accessions: ["GCF_000027325.1"] });
    const preview = mapAssemblyPreview(parsed, reports);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "assembly-test-"));
    const context = (cacheDir: string, over: Partial<WorkbenchImportStartContext<typeof parsed>> = {}): WorkbenchImportStartContext<typeof parsed> => ({
      jobId: "job", workspaceId: "ws", userId: "user", input: parsed, preview, cacheKey: "key",
      storage: { baseDir: root, cacheRoot: root, jobsRoot: root, cacheDir, jobDir: root, logPath: path.join(root, "log") },
      update: async () => {}, log: async () => {}, ...over,
    });
    try {
      const big = { ...preview, sampleMetadata: { ...preview.sampleMetadata, capBytes: "10" } };
      await expect(ncbiAssemblyImporter.start(context(path.join(root, "big"), { preview: big }))).rejects.toThrow("tick their files to confirm");
      const result = await ncbiAssemblyImporter.start(context(path.join(root, "ok")));
      expect(requests[0].searchParams.getAll("include_annotation_type")).toEqual(["GENOME_FASTA", "GENOME_GFF"]);
      const meta = result.sourceMetadata as { files: { filename: string; role: string; md5: string; storedFilename: string }[]; citation: string };
      expect(meta.files.map(file => [file.filename, file.role, file.md5])).toEqual([
        ["GCF_000027325.1_genomic.fna", "genome", md5(fna)],
        ["GCF_000027325.1_genomic.gff", "annotation", md5(gff)],
      ]);
      expect(await fs.readFile(path.join(result.storagePath, meta.files[1].storedFilename), "utf8")).toBe(gff);
      expect(meta.citation).toContain("GCF_000027325.1");
      const broken = await packageZip({ "ncbi_dataset/data/GCF_000027325.1/GCF_000027325.1_ASM2732v1_genomic.fna": fna, "md5sum.txt": `${md5("other")}  ncbi_dataset/data/GCF_000027325.1/GCF_000027325.1_ASM2732v1_genomic.fna\n` });
      vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(broken))));
      await expect(ncbiAssemblyImporter.start(context(path.join(root, "bad")))).rejects.toThrow("did not match the MD5 NCBI published");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
