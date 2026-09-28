import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { dryadDatasetImporter } from "./dryad-dataset";
import { ncbiAssemblyImporter } from "./ncbi-assembly";
import { mapSraPreview, ncbiSraRunsImporter, resolveSraRuns } from "./ncbi-sra-runs";
import type { WorkbenchImportPreview, WorkbenchImportStartContext } from "./types";

const runLive = process.env.SEQDESK_WORKBENCH_LIVE === "1";

async function withContext<T>(input: T, preview: WorkbenchImportPreview, run: (context: WorkbenchImportStartContext<T>) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-live-ncbi-"));
  try {
    await run({
      jobId: "live", workspaceId: "ws", userId: "user", input, preview, cacheKey: "live",
      storage: { baseDir: root, cacheRoot: root, jobsRoot: root, cacheDir: path.join(root, "cache"), jobDir: root, logPath: path.join(root, "log") },
      update: async () => {}, log: async () => {},
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe.runIf(runLive)("NCBI and Dryad connectors live", () => {
  it("imports a tiny SRA run as FASTQ from the ENA mirror, MD5-checked", async () => {
    const input = ncbiSraRunsImporter.inputSchema.parse({ accessions: ["SRR10008674"] });
    const preview = await ncbiSraRunsImporter.preview(input);
    expect(preview.assets?.map(asset => asset.filename)).toEqual(["SRR10008674_1.fastq.gz", "SRR10008674_2.fastq.gz"]);
    await withContext(input, preview, async (context) => {
      const result = await ncbiSraRunsImporter.start(context);
      const files = (result.sourceMetadata as { files: { filename: string; md5: string }[] }).files;
      expect(files.map(file => file.filename)).toEqual(["SRR10008674_1.fastq.gz", "SRR10008674_2.fastq.gz", "sra_runs.tsv"]);
      expect(files[0].md5).toBe("948993099eaeb6adb4b308ebb9fc4371");
    });
  }, 180_000);

  it("falls back to NCBI's own .sra file and checks it against NCBI's MD5", async () => {
    const input = ncbiSraRunsImporter.inputSchema.parse({ accessions: ["SRR10008674"] });
    const preview = await mapSraPreview(input, await resolveSraRuns(input.accessions), async () => null);
    expect(preview.assets).toEqual([expect.objectContaining({ filename: "SRR10008674.sra", etag: "md5:68c50ff25b2692e39ae1b7f54dd26006" })]);
    await withContext(input, preview, async (context) => {
      const result = await ncbiSraRunsImporter.start(context);
      expect((result.sourceMetadata as { files: { md5: string }[] }).files[0].md5).toBe("68c50ff25b2692e39ae1b7f54dd26006");
    });
  }, 180_000);

  it("follows a GEO series to its SRA runs", async () => {
    const preview = await ncbiSraRunsImporter.preview(ncbiSraRunsImporter.inputSchema.parse({ accessions: ["GSE52778"], maxRuns: 2 }));
    expect(preview.records?.length).toBe(2);
    expect(preview.records?.every(record => /^SRR\d+$/.test(record.id))).toBe(true);
    expect(preview.sampleMetadata).toMatchObject({ geo: "GSE52778" });
  }, 180_000);

  it("imports a small bacterial genome with its GFF, checked against NCBI's MD5 list", async () => {
    const input = ncbiAssemblyImporter.inputSchema.parse({ accessions: ["GCF_000027325.1"] });
    const preview = await ncbiAssemblyImporter.preview(input);
    expect(preview.assets?.map(asset => asset.filename)).toEqual(["GCF_000027325.1_genomic.fna", "GCF_000027325.1_genomic.gff"]);
    await withContext(input, preview, async (context) => {
      const result = await ncbiAssemblyImporter.start(context);
      const files = (result.sourceMetadata as { files: { filename: string; bytes: number; storedFilename: string }[] }).files;
      expect(files.map(file => file.filename)).toEqual(["GCF_000027325.1_genomic.fna", "GCF_000027325.1_genomic.gff"]);
      const fasta = await fs.readFile(path.join(result.storagePath, files[0].storedFilename), "utf8");
      expect(fasta.startsWith(">NC_000908")).toBe(true);
      // The preview's estimate is close to what arrived.
      expect(Math.abs(files[0].bytes - preview.assets![0].bytes) / files[0].bytes).toBeLessThan(0.05);
    });
  }, 300_000);

  it("previews a small Dryad dataset with sizes, checksums, licence and citation", async () => {
    const preview = await dryadDatasetImporter.preview(dryadDatasetImporter.inputSchema.parse({ dataset: "10.5061/dryad.2bvq83bnv" }));
    expect(preview.choices?.length).toBeGreaterThan(0);
    expect(preview.choices?.every(choice => choice.bytes > 0)).toBe(true);
    expect(preview.sampleMetadata).toMatchObject({ licence: "CC0 1.0", citation: expect.stringMatching(/^Murali, K\..*\(2020\).*\[Dataset\]\. Dryad\. https:\/\/doi\.org\/10\.5061\/dryad\.2bvq83bnv$/) });
    if (process.env.SEQDESK_DRYAD_CLIENT_ID && process.env.SEQDESK_DRYAD_CLIENT_SECRET) {
      const input = dryadDatasetImporter.inputSchema.parse({ dataset: "10.5061/dryad.2bvq83bnv" });
      await withContext(input, preview, async (context) => {
        const result = await dryadDatasetImporter.start(context);
        expect((result.sourceMetadata as { citation?: string }).citation).toContain("Dryad");
      });
    }
  }, 180_000);
});
