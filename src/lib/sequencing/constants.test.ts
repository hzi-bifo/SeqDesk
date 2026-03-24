import { describe, expect, it } from "vitest";
import {
  FACILITY_SAMPLE_STATUS_BADGE_CLASSNAMES,
  FACILITY_SAMPLE_STATUS_LABELS,
  FILES_ASSIGNABLE_STATUSES,
  SEQUENCING_ARTIFACT_STAGE_LABELS,
  SEQUENCING_ARTIFACT_TYPE_LABELS,
  getSequencingIntegrityIndicatorClassName,
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
    expect(
      getSequencingIntegrityStatus({
        file2: "reads/sample_R2.fastq.gz",
        checksum2: "def456",
      })
    ).toBe("complete");
  });

  it("exposes human-readable integrity labels", () => {
    expect(getSequencingIntegrityLabel("empty")).toBe("No linked files");
    expect(getSequencingIntegrityLabel("missing")).toBe(
      "Linked files are missing checksums"
    );
    expect(getSequencingIntegrityLabel("partial")).toBe(
      "Some linked files have checksums"
    );
    expect(getSequencingIntegrityLabel("complete")).toBe(
      "All linked files have checksums"
    );
  });

  it("validates fixed facility statuses", () => {
    expect(isFacilitySampleStatus("READY")).toBe(true);
    expect(isFacilitySampleStatus("custom")).toBe(false);
  });

  it("returns indicator class names for each integrity state", () => {
    expect(getSequencingIntegrityIndicatorClassName("empty")).toBe("bg-slate-300");
    expect(getSequencingIntegrityIndicatorClassName("missing")).toBe("bg-slate-400");
    expect(getSequencingIntegrityIndicatorClassName("partial")).toBe("bg-amber-500");
    expect(getSequencingIntegrityIndicatorClassName("complete")).toBe("bg-emerald-500");
  });

  it("exposes labels and badge classnames for fixed sequencing enums", () => {
    expect(FILES_ASSIGNABLE_STATUSES).toEqual(["SUBMITTED", "COMPLETED"]);
    expect(FACILITY_SAMPLE_STATUS_LABELS.QC_REVIEW).toBe("QC Review");
    expect(FACILITY_SAMPLE_STATUS_BADGE_CLASSNAMES.ISSUE).toContain("rose");
    expect(SEQUENCING_ARTIFACT_STAGE_LABELS.sample_receipt).toBe("Sample Receipt");
    expect(SEQUENCING_ARTIFACT_TYPE_LABELS.multiqc_report).toBe("MultiQC Report");
  });
});
