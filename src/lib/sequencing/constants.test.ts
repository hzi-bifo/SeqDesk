import { describe, expect, it } from "vitest";
import {
  getSequencingIntegrityLabel,
  getSequencingIntegrityStatus,
  isFacilitySampleStatus,
} from "./constants";

describe("sequencing constants", () => {
  it("classifies read integrity based on linked files and checksums", () => {
    expect(getSequencingIntegrityStatus({})).toBe("empty");
    expect(
      getSequencingIntegrityStatus({
        file1: "reads/sample_R1.fastq.gz",
      })
    ).toBe("missing");
    expect(
      getSequencingIntegrityStatus({
        file1: "reads/sample_R1.fastq.gz",
        file2: "reads/sample_R2.fastq.gz",
        checksum1: "abc123",
      })
    ).toBe("partial");
    expect(
      getSequencingIntegrityStatus({
        file1: "reads/sample_R1.fastq.gz",
        file2: "reads/sample_R2.fastq.gz",
        checksum1: "abc123",
        checksum2: "def456",
      })
    ).toBe("complete");
  });

  it("exposes human-readable integrity labels", () => {
    expect(getSequencingIntegrityLabel("empty")).toBe("No linked files");
    expect(getSequencingIntegrityLabel("complete")).toBe(
      "All linked files have checksums"
    );
  });

  it("validates fixed facility statuses", () => {
    expect(isFacilitySampleStatus("READY")).toBe(true);
    expect(isFacilitySampleStatus("custom")).toBe(false);
  });
});
