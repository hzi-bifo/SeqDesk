import { describe, expect, it } from "vitest";
import { normalizeReportSummary } from "./report-summary.mjs";

// Synthetic internal unit fixtures, not responses from an external service.
const samples = [{ id: "sample-1", sampleId: "S1" }, { id: "sample-2", sampleId: "S2" }];

describe("package-owned detaxizer summary normalization", () => {
  it.each([
    ["classified with kraken2", "Kraken2"],
    ["classified with bbduk", "BBDuk"],
    ["classified with kraken2 and bbduk", "Kraken2 + BBDuk"],
  ])("normalizes %s without inventing removed or retained counts", (header, classifier) => {
    const rows = normalizeReportSummary(`\t${header}\nS1\t0\nS2_longReads\t12\n`, samples);
    expect(rows).toEqual([
      expect.objectContaining({ sample_record: "sample-1", source_sample: "S1", classifier, classified_read_ids: 0 }),
      expect.objectContaining({ sample_record: "sample-2", source_sample: "S2_longReads", classifier, classified_read_ids: 12 }),
    ]);
    expect(rows[0].blastn_unique_ids).toBeNull();
    expect(rows[0]).not.toHaveProperty("removed_reads");
    expect(rows[0]).not.toHaveProperty("total_reads");
  });

  it("preserves optional validation zeros and treats absent validation as missing", () => {
    const text = "\tclassified with kraken2\tblastn_unique_ids\tblastn_lines\tfilteredblastn_unique_ids\tfilteredblastn_lines\nS1\t4\t0.0\tNA\t\tNaN\n";
    expect(normalizeReportSummary(text, samples)[0]).toMatchObject({ classified_read_ids: 4, blastn_unique_ids: 0, blastn_lines: null, filteredblastn_unique_ids: null, filteredblastn_lines: null });
  });

  it("handles CRLF and the upstream _R1 replacement without guessing other suffixes", () => {
    const text = "\tclassified with kraken2\r\nDonor_lane_longReads\t2\r\n";
    expect(normalizeReportSummary(text, [{ id: "record", sampleId: "Donor_R1_lane" }])[0].sample_record).toBe("record");
  });

  it.each(["-1", "1.5", "NaN", "Infinity", "", "abc", "9007199254740992"])("rejects invalid classification count %s", value => {
    expect(() => normalizeReportSummary(`\tclassified with kraken2\nS1\t${value}\n`, samples)).toThrow(/integer count/);
  });

  it.each([
    "\tclassified with kraken2\nmissing\t2\n",
    "\tclassified with kraken2\nS1\t2\nS1\t3\n",
    "\tclassified with kraken2\tclassified with kraken2\nS1\t2\t2\n",
    "\tclassified with unknown\nS1\t2\n",
    "\tclassified with kraken2\nS1\t2\textra\n",
    "\tclassified with kraken2\n",
  ])("rejects unrecognized or ambiguous table data", text => {
    expect(() => normalizeReportSummary(text, samples)).toThrow();
  });

  it("rejects a long-read alias colliding with another real sample name", () => {
    expect(() => normalizeReportSummary("\tclassified with kraken2\nS1_longReads\t2\n", [...samples, { id: "other", sampleId: "S1_longReads" }])).toThrow(/ambiguous/);
  });

  it("rejects duplicate input labels and invalid optional counts", () => {
    expect(() => normalizeReportSummary("\tclassified with kraken2\nS1\t2\n", [...samples, { id: "other", sampleId: "S1" }])).toThrow(/ambiguous/);
    expect(() => normalizeReportSummary("\tclassified with kraken2\tblastn_lines\nS1\t2\tbad\n", samples)).toThrow(/integer count/);
  });
});
