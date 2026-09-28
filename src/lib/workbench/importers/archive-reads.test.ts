import { describe, expect, it } from "vitest";

import { archiveReadImport, type ArchiveReadFile } from "./archive-reads";

const processing = { state: "unknown", evidence: "not_provided" } as const;
const file = (filename: string, over: Partial<ArchiveReadFile> = {}): ArchiveReadFile => ({ filename, path: `/x/${filename}`, url: `https://x/${filename}`, bytes: 1, md5: "m", sha256: "s", records: 10, readNamesSha256: "n", ...over });
const run = (files: ArchiveReadFile[], paired = true) => ({ run: "SRR1", paired, studyKey: "PRJNA1", sampleKey: "SAMN1", metadata: {}, files });

describe("archive read records", () => {
  it("orders mates R1 then R2 and keeps the run as the read key", () => {
    const spec = archiveReadImport(run([file("SRR1_2.fastq.gz"), file("SRR1_1.fastq.gz")]), processing);
    expect(spec.reads.map(read => read.path)).toEqual(["/x/SRR1_1.fastq.gz", "/x/SRR1_2.fastq.gz"]);
    expect(spec).toMatchObject({ technology: "short", readKey: "SRR1", studyKey: "PRJNA1", sampleKey: "SAMN1" });
  });

  it("refuses incomplete, ambiguous or mismatched pairs", () => {
    expect(() => archiveReadImport(run([file("SRR1_1.fastq.gz")]), processing)).toThrow("complete two-file pair");
    expect(() => archiveReadImport(run([file("a.fastq.gz"), file("b.fastq.gz")]), processing)).toThrow("ambiguous mate");
    expect(() => archiveReadImport(run([file("SRR1_1.fastq.gz"), file("SRR1_2.fastq.gz", { records: 9 })]), processing)).toThrow("different read names or counts");
  });

  it("takes one single-end file", () => {
    expect(archiveReadImport(run([file("SRR1.fastq.gz")], false), processing).technology).toBe("single");
  });
});
