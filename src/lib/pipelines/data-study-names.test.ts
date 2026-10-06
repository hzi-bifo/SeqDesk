/** Sample names from Data's FASTQ files as a pipeline's samplesheet takes them (edge cases round 2, sheet 96, 6 Oct 2026). */
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { pairFastqFiles } from "./data-study";

const file = (name: string, i: number) => ({ id: `f${i}`, name, sizeBytes: 1 });
describe("sample names from FASTQ file names", () => {
  it("cleans spaces, unicode and signs, keeps names that differ only there apart, and cuts very long names", () => {
    const long = "x".repeat(140);
    const pairs = pairFastqFiles([
      "Probe ä 1_R1.fastq.gz", "Probe ä 1_R2.fastq.gz", "Probe ö 1_R1.fastq.gz", "Probe ö 1_R2.fastq.gz",
      "Patient #12 (gut)_1.fq.gz", "Patient #12 (gut)_2.fq.gz", `${long}_R1_001.fastq.gz`, `${long}_R2_001.fastq.gz`, "日本_S1_R1.fastq.gz", "solo.fastq",
    ].map(file));
    const ids = pairs.map((pair) => pair.sampleId);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9._-]{1,80}$/);
    expect(ids).toContain("Probe_1");
    expect(ids).toContain("Probe_1_2");
    expect(ids).toContain("Patient_12_gut_");
    expect(ids.find((id) => id.startsWith("xxx"))).toHaveLength(76);
    expect(pairs.find((pair) => pair.sampleId === "solo")?.r2).toBeNull();
    expect(new Set(ids.map((id) => id.toLowerCase())).size).toBe(ids.length);
  });
});
