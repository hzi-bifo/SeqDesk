import { describe, expect, it } from "vitest";
import { buildSequencingSourceGroups, safeSourceUrl, sourceMetadataRecord, type SourceMetadataOrder } from "./source-metadata";

const camiSample: SourceMetadataOrder["samples"][number] = {
  id: "cami-sample", sampleId: "sample_0", sampleTitle: "My local sample title",
  customFields: JSON.stringify({ sourceType: "cami-benchmark", dataset: "cami2-marine", sourceKey: "sample_0", synthetic: true,
    originalMetadata: { environment: "marine seafloor (simulated)" } }),
  reads: [{ id: "short-reads", file1: "R1.fastq.gz", file2: "R2.fastq.gz", dataClass: "unknown",
    pipelineSources: JSON.stringify({ sourceType: "cami-benchmark", dataset: "cami2-marine", technology: "short", moduleVersion: 2,
      retrievedAt: "2026-09-08T10:00:00Z", sourcePage: "https://cami-challenge.org/datasets/marine/", citation: "https://doi.org/10.4126/FRL01-006425521",
      sourceArchive: { url: "https://frl.publisso.de/data/frl:6425521/marine/short_read/marmgCAMI2_sample_0_reads.tar.gz" },
      sampleMetadata: { environment: "marine seafloor (simulated)", platform: "Illumina HiSeq", layout: "paired", readLengthBp: 150 },
      processing: { effectiveState: "unknown", source: { details: "Pair splitting is not cleaning." } },
    }) }],
};

describe("sequencing source metadata", () => {
  it("combines the collection source index with the saved sample and read provenance", () => {
    const groups = buildSequencingSourceGroups({ dataOrigin: "import", samples: [camiSample], sourceMetadata: JSON.stringify({
      sources: [{ sourceType: "cami-benchmark", sourceKey: "cami2-marine", title: "CAMI II Marine", synthetic: true }],
    }) });
    expect(groups).toHaveLength(1);
    const [source] = groups;
    expect(source.moduleName).toBe("CAMI benchmark reads");
    expect(source.title).toBe("CAMI II Marine");
    expect(source.synthetic).toBe(true);
    expect(source.entries[0].sampleLabel).toBe("My local sample title");
    expect(source.entries[0].details).toEqual(expect.arrayContaining([
      { label: "Source sample", value: "sample_0" }, { label: "Environment", value: "marine seafloor (simulated)" },
      { label: "Read layout", value: "Paired-end" }, { label: "File format", value: "FASTQ" },
      { label: "Read processing", value: "Processing unknown" }, { label: "Import module version", value: "2" },
      { label: "Recorded at", value: "2026-09-08T10:00:00.000Z" },
    ]));
    expect(source.hosts).toEqual(["HTTPS · frl.publisso.de"]);
    expect(source.links).toHaveLength(2);
  });

  it("retains multiple read technologies without duplicating the source or sample identity", () => {
    const sample = { ...camiSample, reads: [...camiSample.reads!, { id: "long-reads", file1: "reads.fastq.gz", dataClass: "unknown",
      pipelineSources: JSON.stringify({ sourceType: "cami-benchmark", dataset: "cami2-marine", technology: "long", sampleMetadata: { layout: "single", platform: "Pacific Biosciences" } }),
    }] };
    const groups = buildSequencingSourceGroups({ dataOrigin: "import", samples: [sample] });
    expect(groups).toHaveLength(1);
    expect(new Set(groups[0].entries.map(entry => entry.sampleId)).size).toBe(1);
    expect(groups[0].entries).toHaveLength(2);
    expect(groups[0].entries[1].details).toContainEqual({ label: "Read layout", value: "Single-end" });
    expect(groups[0].entries[1].details).toContainEqual({ label: "Read technology", value: "Long reads" });
  });

  it("keeps different modules distinct and retains ENA original records and identifiers", () => {
    const groups = buildSequencingSourceGroups({ dataOrigin: "import", samples: [camiSample, {
      id: "ena-sample", sampleId: "source-sample", customFields: JSON.stringify({ sourceType: "ena-fastq-accession", dataset: "source-study", sourceKey: "source-sample" }),
      reads: [{ id: "ena-reads", file1: "reads.fastq.gz", dataClass: "raw", runAccessionNumber: "source-run",
        pipelineSources: JSON.stringify({ sourceType: "ena-fastq-accession", study_accession: "source-study", technology: "single",
          sampleAccession: "source-sample", originalStudy: { title: "Original source study" }, instrument_platform: "OXFORD_NANOPORE" }) }],
    }] });
    expect(groups.map(source => source.moduleName)).toEqual(["CAMI benchmark reads", "SRA / ENA reads"]);
    const entry = groups[1].entries[0];
    expect(entry.details).toContainEqual({ label: "Run accession", value: "source-run" });
    expect(entry.details).toContainEqual({ label: "Read processing", value: "Unprocessed reads" });
    // A single-end archive record is not evidence that its reads are short.
    expect(entry.details).not.toContainEqual({ label: "Read technology", value: "Short reads" });
    expect(entry.original.read).toMatchObject({ originalStudy: { title: "Original source study" } });
  });

  it("shows pending selections separately from imported sample provenance", () => {
    const sources = buildSequencingSourceGroups({ dataOrigin: "import", samples: [], sourceImports: [{
      id: "pending", providerId: "cami-benchmark", status: "queued", sourceKey: "cami2-marine", title: "CAMI II Marine", createdAt: "2026-09-08T10:00:00Z",
      metadata: { dataset: "cami2-marine", sampleMetadata: { environment: "marine seafloor (simulated)" } },
    }] });
    expect(sources).toHaveLength(1);
    expect(sources[0].entries).toEqual([]);
    expect(sources[0].imports).toHaveLength(1);
    expect(buildSequencingSourceGroups({ dataOrigin: "import", samples: [], sourceMetadata: '{"sources":[]}' })).toEqual([]);
  });

  it("uses truthful fallbacks for uploads, future providers and missing provenance", () => {
    const sources = buildSequencingSourceGroups({ dataOrigin: "import", sourceMetadata: "invalid json", samples: [
      { id: "upload", sampleId: "upload", reads: [{ id: "r1", file1: "file.fastq", pipelineSources: '{"sourceType":"upload"}' }] },
      { id: "future", sampleId: "future", reads: [{ id: "r2", pipelineSources: '{"sourceType":"new-module","additionalField":"preserved"}' }] },
      { id: "unknown", sampleId: "unknown", customFields: "null", reads: [{ id: "r3", pipelineSources: "[]" }] },
    ] });
    expect(sources.map(source => source.moduleName)).toEqual(["Local file upload", "new-module", "Source not recorded"]);
    expect(sources[0].entries[0].details).toContainEqual({ label: "Read processing", value: "Processing unknown" });
    expect(sources[1].entries[0].original.read).toMatchObject({ additionalField: "preserved" });
  });

  it("does not render invalid or unsafe source URLs as links", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,test", "file:///tmp/reads", "https://user:password@example.test/data", "not-a-url"]) expect(safeSourceUrl(url)).toBeNull();
    expect(safeSourceUrl("https://cami-challenge.org/datasets/marine/")).toBe("https://cami-challenge.org/datasets/marine/");
    for (const value of [null, "null", "[]", "bad json", [1, 2]]) expect(sourceMetadataRecord(value)).toEqual({});
  });
});
