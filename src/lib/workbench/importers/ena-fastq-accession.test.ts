import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { enaFastqAccessionImporter } from "./ena-fastq-accession";

let tempDir = "";

describe("ENA FASTQ accession importer", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "seqdesk-ena-"));
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("previews real ENA file-report metadata with a bounded file list", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            run_accession: "ERR164407",
            sample_accession: "ERS123",
            study_accession: "ERP123",
            scientific_name: "Escherichia coli",
            library_layout: "PAIRED",
            fastq_ftp:
              "ftp.sra.ebi.ac.uk/vol1/fastq/ERR164/ERR164407/ERR164407_1.fastq.gz;ftp.sra.ebi.ac.uk/vol1/fastq/ERR164/ERR164407/ERR164407_2.fastq.gz",
            fastq_md5:
              "d41d8cd98f00b204e9800998ecf8427e;d41d8cd98f00b204e9800998ecf8427e",
            fastq_bytes: "10;11",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const input = enaFastqAccessionImporter.inputSchema.parse({
      accession: "err164407",
      maxFiles: 1,
    });
    const preview = await enaFastqAccessionImporter.preview(input);

    expect(preview.summary).toMatchObject({
      totalFound: 2,
      selectedCount: 1,
      capped: true,
    });
    expect(preview.files?.[0]).toMatchObject({
      runAccession: "ERR164407",
      filename: "ERR164407_1.fastq.gz",
      bytes: 10,
    });
    expect(preview.files?.[0].url).toMatch(/^https:\/\/ftp\.sra\.ebi\.ac\.uk\//);
  });

  it("rejects unexpected download hosts returned by metadata", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            run_accession: "ERR164407",
            fastq_ftp: "evil.example.test/reads.fastq.gz",
          },
        ]),
        { status: 200 }
      )
    );

    const input = enaFastqAccessionImporter.inputSchema.parse({
      accession: "ERR164407",
    });
    await expect(enaFastqAccessionImporter.preview(input)).rejects.toThrow(
      "unexpected download host"
    );
  });

  it("downloads, verifies, and atomically stores previewed FASTQ files", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("ACGT", { status: 200 }));
    const cacheDir = path.join(tempDir, "cache");
    const jobDir = path.join(tempDir, "job");
    mkdirSync(cacheDir, { recursive: true });
    mkdirSync(jobDir, { recursive: true });
    const input = enaFastqAccessionImporter.inputSchema.parse({
      accession: "ERR164407",
      maxFiles: 1,
    });
    const preview = {
      providerId: enaFastqAccessionImporter.id,
      summary: {
        label: "ENA FASTQ ERR164407",
        totalFound: 1,
        selectedCount: 1,
        capped: false,
        cap: 1,
        hardMax: 100,
      },
      genomes: [],
      files: [
        {
          runAccession: "ERR164407",
          url: "https://ftp.sra.ebi.ac.uk/reads.fastq.gz",
          filename: "reads.fastq.gz",
          md5: "f1f8f4bf413b16ad135722aa4591043e",
          bytes: 4,
        },
      ],
    };
    const cacheKey = enaFastqAccessionImporter.getCacheKey(input, preview);

    const result = await enaFastqAccessionImporter.start({
      jobId: "job-a",
      workspaceId: "workspace-a",
      userId: "user-a",
      input,
      preview,
      cacheKey,
      storage: {
        baseDir: tempDir,
        cacheRoot: path.join(tempDir, "cache-root"),
        jobsRoot: path.join(tempDir, "jobs-root"),
        cacheDir,
        jobDir,
        logPath: path.join(jobDir, "import.log"),
      },
      update: vi.fn().mockResolvedValue(undefined),
      log: vi.fn().mockResolvedValue(undefined),
    });

    expect(readFileSync(path.join(cacheDir, "reads.fastq.gz"), "utf8")).toBe("ACGT");
    expect(result).toMatchObject({
      cacheKey,
      sourceType: "ena-fastq-accession",
      sizeBytes: 4,
    });
    expect(result.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
