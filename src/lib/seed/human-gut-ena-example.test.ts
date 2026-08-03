import { describe, expect, it } from "vitest";
import {
  buildHumanGutManifests,
  HUMAN_GUT_ORDER_NUMBERS,
  HUMAN_GUT_RUNS,
} from "@/lib/seed/human-gut-ena-example";
import { HUMAN_GUT_READS } from "@/lib/seed/templates";
describe("human-gut PRJEB54724 dataset", () => {
  it("splits the 12 ENA runs into homogeneous MiSeq and NextSeq 550 orders", () => {
    expect(HUMAN_GUT_RUNS).toHaveLength(12);
    const manifests = buildHumanGutManifests();
    expect(manifests).toHaveLength(2);
    expect(manifests.map((manifest) => manifest.order.orderNumber)).toEqual([
      ...HUMAN_GUT_ORDER_NUMBERS,
    ]);

    const miseq = manifests.find(
      (manifest) => manifest.order.instrumentModel === "Illumina MiSeq",
    );
    const nextseq = manifests.find(
      (manifest) => manifest.order.instrumentModel === "NextSeq 550",
    );
    expect(miseq?.samples).toHaveLength(7);
    expect(nextseq?.samples).toHaveLength(5);
    expect(new Set(miseq?.samples.map((sample) => sample.sequencingRun.instrument))).toEqual(
      new Set(["Illumina MiSeq"]),
    );
    expect(new Set(nextseq?.samples.map((sample) => sample.sequencingRun.instrument))).toEqual(
      new Set(["NextSeq 550"]),
    );

    const samples = manifests.flatMap((manifest) => manifest.samples);
    expect(samples).toHaveLength(12);
    for (const s of samples) {
      expect(s.file1).toMatch(/^reads\/HGM-\d+_R1\.fastq\.gz$/);
      expect(s.file2).toMatch(/^reads\/HGM-\d+_R2\.fastq\.gz$/);
      expect(s.taxId).toBe("408170");
      expect(s.sampleId).toMatch(/^HGM-\d+$/);
      const source = HUMAN_GUT_READS[s.sampleAlias];
      expect(s).toMatchObject({
        checksum1: source.checksum1,
        checksum2: source.checksum2,
        readCount1: source.readCount,
        readCount2: source.readCount,
        runAccessionNumber: source.run,
        experimentAccessionNumber: source.experiment,
      });
      expect(s.customFields).toMatchObject({
        source_bioproject: "PRJEB54724",
        source_biosample_accession: source.biosample,
        source_instrument_model: source.instrumentModel,
        source_library_strategy: "WGS",
        source_library_selection: "other",
      });
      expect(s.sequencingRun).toMatchObject({
        runId: source.run,
        instrument: source.instrumentModel,
        totalReads: source.readCount,
      });
    }
    for (const manifest of manifests) {
      expect(manifest.order.libraryStrategy).toBe("WGS");
      expect(manifest.order.librarySource).toBe("METAGENOMIC");
      expect(manifest.order.librarySelection).toBe("other");
      expect(manifest.study.alias).toBe(manifests[0].study.alias);
    }
  });
});
