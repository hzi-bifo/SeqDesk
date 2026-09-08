import { describe, expect, it } from "vitest";
import { parseEnaFileRows, selectCompleteEnaRuns } from "./ena-fastq-accession";

// Internal parser inputs, not simulated external API responses or live evidence.
const first = "ftp.sra.ebi.ac.uk/internal-test/a.fastq.gz";
const second = "ftp.sra.ebi.ac.uk/internal-test/b.fastq.gz";
describe("ENA file metadata normalization", () => {
  it("preserves empty checksum and size positions", () => {
    const files = parseEnaFileRows([{ run_accession: "ERR1", fastq_ftp: `${first};${second}`,
      fastq_md5: ";0123456789abcdef0123456789abcdef", fastq_bytes: ";20" }]);
    expect(files[0].md5).toBeUndefined();
    expect(files[0].bytes).toBeUndefined();
    expect(files[1].md5).toBe("0123456789abcdef0123456789abcdef");
    expect(files[1].bytes).toBe(20);
  });
  it("rejects unequal metadata lists", () => {
    expect(() => parseEnaFileRows([{ run_accession: "ERR1", fastq_ftp: `${first};${second}`, fastq_bytes: "10" }])).toThrow("different lengths");
  });
  it.each(["-1", "1.5", "1e3", "9007199254740992", "not-a-number"])("rejects invalid size %s", (size) => {
    expect(() => parseEnaFileRows([{ run_accession: "ERR1", fastq_ftp: first, fastq_bytes: size }])).toThrow("invalid file size");
  });
  it.each(["https://internal.invalid/a.gz", "https://user:pass@ftp.sra.ebi.ac.uk/a.gz", "https://ftp.sra.ebi.ac.uk:8443/a.gz"])("rejects unsafe URL %s", (url) => {
    expect(() => parseEnaFileRows([{ run_accession: "ERR1", fastq_ftp: url }])).toThrow("unexpected download host");
  });
  it("does not split a run at the selection cap", () => {
    const files = parseEnaFileRows([{ run_accession: "ERR1", fastq_ftp: `${first};${second}` }]);
    expect(selectCompleteEnaRuns(files, 1)).toEqual([]);
    expect(selectCompleteEnaRuns(files, 2)).toEqual(files);
  });
  it("rejects duplicate URLs", () => {
    const files = parseEnaFileRows([{ run_accession: "ERR1", fastq_ftp: first }]);
    expect(() => selectCompleteEnaRuns([...files, ...files], 20)).toThrow("duplicate");
  });
});
