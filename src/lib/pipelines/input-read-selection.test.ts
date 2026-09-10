import { describe, expect, it } from "vitest";
import { selectPipelineInputRead } from "./input-read-selection";

describe("selectPipelineInputRead", () => {
  it("ignores superseded pairs and keeps legacy active records eligible", () => {
    const superseded = { id: "a", file1: "old_R1.fastq", file2: "old_R2.fastq", isActive: false };
    const current = { id: "b", file1: "current.fastq", isActive: true };
    const legacy = { id: "c", file1: "legacy.fastq" };

    expect(selectPipelineInputRead([superseded, current, legacy])).toBe(current);
    expect(selectPipelineInputRead([superseded, legacy])).toBe(legacy);
    expect(selectPipelineInputRead([superseded])).toBeNull();
  });

  it("prefers a complete pair even when a cleaned single read is available", () => {
    const cleanedSingle = { id: "a", file1: "cleaned.fastq", dataClass: "cleaned" };
    const rawPair = { id: "b", file1: "raw_R1.fastq", file2: "raw_R2.fastq", dataClass: "raw" };

    expect(selectPipelineInputRead([cleanedSingle, rawPair])).toBe(rawPair);
    expect(selectPipelineInputRead([rawPair, cleanedSingle], { paired: false })).toBe(cleanedSingle);
  });

  it("prefers cleaned reads and uses stable IDs within the same data class", () => {
    const raw = { id: "a", file1: "raw_R1.fastq", file2: "raw_R2.fastq", dataClass: "raw" };
    const cleanedLater = { id: "c", file1: "cleaned_later_R1.fastq", file2: "cleaned_later_R2.fastq", dataClass: "cleaned" };
    const cleanedFirst = { id: "b", file1: "cleaned_first_R1.fastq", file2: "cleaned_first_R2.fastq", dataClass: "cleaned" };
    const reads = [raw, cleanedLater, cleanedFirst];

    expect(selectPipelineInputRead(reads)).toBe(cleanedFirst);
    expect(reads).toEqual([raw, cleanedLater, cleanedFirst]);
  });

  it("selects protected raw or unknown data when requested by Read Cleaning", () => {
    const cleanedPair = { id: "a", file1: "cleaned_R1.fastq", file2: "cleaned_R2.fastq", dataClass: "cleaned" };
    const unknown = { id: "b", file1: "unknown.fastq", dataClass: "unknown" };
    const raw = { id: "c", file1: "raw.fastq", dataClass: "raw" };

    expect(selectPipelineInputRead([cleanedPair, unknown, raw], {
      dataClassIn: ["raw", "unknown"],
    })).toBe(raw);
    expect(selectPipelineInputRead([cleanedPair, unknown, raw], { dataClass: "unknown" })).toBe(unknown);
    expect(selectPipelineInputRead([cleanedPair], { dataClassIn: ["raw", "unknown"] })).toBeNull();
  });

  it("does not invent a pair from separate read records or accept R2 alone", () => {
    const r1 = { file1: "R1.fastq" };
    const r2 = { file2: "R2.fastq" };

    expect(selectPipelineInputRead([r1, r2], { paired: true })).toBeNull();
    expect(selectPipelineInputRead([r2])).toBeNull();
    expect(selectPipelineInputRead([])).toBeNull();
  });

  it("preserves legacy data class normalization and the input record metadata", () => {
    const raw = { id: "a", file1: "raw.fastq", dataClass: "raw", checksum1: "raw-checksum" };
    const legacy = { id: "b", file1: "legacy.fastq", checksum1: "legacy-checksum" };

    expect(selectPipelineInputRead([raw, legacy], { dataClass: "cleaned" })).toBe(legacy);
    expect(selectPipelineInputRead([raw, legacy])?.checksum1).toBe("legacy-checksum");
  });
});
