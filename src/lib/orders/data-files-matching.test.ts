import { describe, expect, it } from "vitest";
import { createReadSetDrafts, readSetLinkRequest, validateReadSetDraft, type MatchingFile } from "./data-files-matching";

const samples = [{ id: "sample-db-a", sampleId: "sample-a", sampleTitle: null }, { id: "sample-db-b", sampleId: "sample-b", sampleTitle: null }];
const file = (name: string, path = `project/${name}`): MatchingFile => ({ name, path, size: 12 });

describe("file-to-sample matching", () => {
  it("keeps separate lanes as separate read sets and suggests an exact sample", () => {
    const drafts = createReadSetDrafts([
      file("sample-a_S1_L001_R1_001.fastq.gz"), file("sample-a_S1_L001_R2_001.fastq.gz"),
      file("sample-a_S1_L002_R1_001.fastq.gz"), file("sample-a_S1_L002_R2_001.fastq.gz"),
    ], samples);
    expect(drafts).toHaveLength(2);
    for (const draft of drafts) { expect(draft.sampleId).toBe("sample-db-a"); expect(validateReadSetDraft(draft)).toEqual([]); }
  });
  it("preselects the requested sample over a filename suggestion", () => {
    const [draft] = createReadSetDrafts([file("sample-a_R1.fastq.gz"), file("sample-a_R2.fastq.gz")], samples, "sample-db-b");
    expect(readSetLinkRequest(draft, "unknown", "")).toEqual({ sampleId: "sample-db-b", read1: "project/sample-a_R1.fastq.gz", read2: "project/sample-a_R2.fastq.gz", processing: "unknown" });
  });
  it("does not silently treat an orphan R1 as a complete paired read set", () => {
    const [draft] = createReadSetDrafts([file("sample-a_R1.fastq.gz")], samples);
    expect(validateReadSetDraft(draft).join(" ")).toContain("R2 file is missing");
    expect(validateReadSetDraft({ ...draft, layout: "single" })).toEqual([]);
  });
  it("blocks duplicate mates, swapped roles, and mismatched pairs", () => {
    const [ambiguous] = createReadSetDrafts([file("sample-a_R1.fastq.gz"), file("sample-a_R1.fq.gz"), file("sample-a_R2.fastq.gz")], samples);
    expect(validateReadSetDraft(ambiguous).join(" ")).toContain("Multiple files have the same read role");
    const [draft] = createReadSetDrafts([file("sample-a_R1.fastq.gz"), file("sample-a_R2.fastq.gz")], samples);
    expect(validateReadSetDraft({ ...draft, read2: draft.read1 }).join(" ")).toContain("different files");
    expect(validateReadSetDraft({ ...draft, read1: draft.read2, read2: draft.read1 }).join(" ")).toContain("named as an R2");
    const mismatch = { ...draft, files: [file("sample-a_R1.fastq.gz"), file("sample-b_R2.fastq.gz")], read2: "project/sample-b_R2.fastq.gz" };
    expect(validateReadSetDraft(mismatch).join(" ")).toContain("different read sets");
  });
  it("requires explicit sample selection for ambiguous identities and allows reviewed new samples", () => {
    const [draft] = createReadSetDrafts([file("unmatched.fastq.gz")], samples);
    expect(validateReadSetDraft(draft)).toEqual(["Choose a destination sample."]);
    expect(readSetLinkRequest({ ...draft, sampleId: "new", newSampleIdentifier: " new-sample ", newSampleTitle: " Title " }, "cleaned", "adapter trimming")).toEqual({ newSample: { sampleId: "new-sample", sampleTitle: "Title" }, read1: "project/unmatched.fastq.gz", processing: "cleaned", processingNote: "adapter trimming" });
  });
});
