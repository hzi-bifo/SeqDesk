import { describe, expect, it } from "vitest";
import { buildHumanGutManifest, HUMAN_GUT_RUNS } from "@/lib/seed/human-gut-ena-example";
describe("human-gut PRJEB54724 dataset", () => {
  it("derives 12 runs + paired manifest with taxId", () => {
    expect(HUMAN_GUT_RUNS).toHaveLength(12);
    const m = buildHumanGutManifest();
    expect(m.samples).toHaveLength(12);
    for (const s of m.samples) {
      expect(s.file1).toMatch(/^reads\/HGM-\d+_R1\.fastq\.gz$/);
      expect(s.file2).toMatch(/^reads\/HGM-\d+_R2\.fastq\.gz$/);
      expect(s.taxId).toBe("408170");
      expect(s.sampleId).toMatch(/^HGM-\d+$/);
    }
    expect(m.order.libraryStrategy).toBe("WGS");
    expect(m.order.librarySource).toBe("METAGENOMIC");
  });
});
