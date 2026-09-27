import { describe, expect, it } from "vitest";

import { enaFastqAccessionInputSchema, parseEnaFileRows, selectCompleteEnaRuns } from "./ena-fastq-accession";
import { enaRunTable, enaSamplesTsv, narrowEnaFiles } from "./ena-runs";

// Three runs of PRJEB53465 (faecal amplicons, Cambodia) as the ENA file report returns them, one made single-end.
const ROWS = [
  { run_accession: "ERR10016297", sample_accession: "SAMEA110405680", study_accession: "PRJEB53465", scientific_name: "human gut metagenome", instrument_model: "Illumina MiSeq", library_layout: "PAIRED", library_strategy: "AMPLICON", country: "Cambodia", sample_title: "b302", collection_date: "2020-02-16",
    fastq_ftp: "ftp.sra.ebi.ac.uk/vol1/fastq/ERR100/097/ERR10016297/ERR10016297_1.fastq.gz;ftp.sra.ebi.ac.uk/vol1/fastq/ERR100/097/ERR10016297/ERR10016297_2.fastq.gz", fastq_md5: "0123456789abcdef0123456789abcdef;fedcba9876543210fedcba9876543210", fastq_bytes: "21892;26856" },
  { run_accession: "ERR10016137", sample_accession: "SAMEA110405520", study_accession: "PRJEB53465", scientific_name: "human gut metagenome", instrument_model: "Illumina MiSeq", library_layout: "PAIRED", library_strategy: "AMPLICON", country: "Cambodia", sample_title: "b212", collection_date: "2020-01-19",
    fastq_ftp: "ftp.sra.ebi.ac.uk/vol1/fastq/ERR100/037/ERR10016137/ERR10016137_1.fastq.gz;ftp.sra.ebi.ac.uk/vol1/fastq/ERR100/037/ERR10016137/ERR10016137_2.fastq.gz", fastq_md5: "11111111111111111111111111111111;22222222222222222222222222222222", fastq_bytes: "50144;61401" },
  { run_accession: "ERR10016400", sample_accession: "SAMEA110405900", study_accession: "PRJEB53465", scientific_name: "human gut metagenome", instrument_model: "Illumina NovaSeq 6000", library_layout: "SINGLE", library_strategy: "WGS", country: "Cambodia", sample_title: "b400", collection_date: "",
    fastq_ftp: "ftp.sra.ebi.ac.uk/vol1/fastq/ERR100/000/ERR10016400/ERR10016400.fastq.gz", fastq_md5: "33333333333333333333333333333333", fastq_bytes: "1000" },
];
const files = parseEnaFileRows(ROWS);

describe("ENA study-level run choice", () => {
  it("accepts ticked runs and attribute filters in the input", () => {
    expect(enaFastqAccessionInputSchema.parse({ accession: "prjeb53465", runs: ["err10016297", "ERR10016137", "ERR10016297"], filters: { library_layout: "PAIRED" } }))
      .toMatchObject({ accession: "PRJEB53465", runs: ["ERR10016137", "ERR10016297"], filters: { library_layout: "PAIRED" } });
    expect(() => enaFastqAccessionInputSchema.parse({ accession: "PRJEB53465", runs: ["SRS1"] })).toThrow();
    expect(() => enaFastqAccessionInputSchema.parse({ accession: "PRJEB53465", filters: { "bad key": "x" } })).toThrow();
  });

  it("filters by instrument, layout, strategy and sample attributes, case-insensitively", () => {
    expect(narrowEnaFiles(files, { filters: { library_layout: "paired" } }).map(file => file.runAccession)).toEqual(["ERR10016137", "ERR10016137", "ERR10016297", "ERR10016297"]);
    expect(narrowEnaFiles(files, { filters: { instrument_model: "Illumina NovaSeq 6000", country: "Cambodia" } }).map(file => file.runAccession)).toEqual(["ERR10016400"]);
    expect(narrowEnaFiles(files, { filters: { library_strategy: "RNA-Seq" } })).toEqual([]);
    expect(() => narrowEnaFiles(files, { filters: { fastq_ftp: "x" } })).toThrow("cannot be filtered by fastq_ftp");
  });

  it("keeps only ticked runs and refuses runs the study does not have", () => {
    expect(narrowEnaFiles(files, { runs: ["ERR10016297"] })).toHaveLength(2);
    expect(() => narrowEnaFiles(files, { runs: ["ERR99"] })).toThrow("no public FASTQ for ERR99");
  });

  it("shows one row per run with the columns this study fills, and marks matches and the selection", () => {
    const selected = selectCompleteEnaRuns(narrowEnaFiles(files, { filters: { library_layout: "PAIRED" } }), 2);
    expect(enaRunTable([...files].reverse(), { selected })).toEqual(enaRunTable(files, { selected }));
    const table = enaRunTable(files, { filters: { library_layout: "PAIRED" }, selected });
    expect(table.columns).toEqual(["sample_accession", "scientific_name", "sample_title", "library_strategy", "instrument_model", "library_layout", "country", "collection_date"]);
    expect(table.rows.map(row => [row.run, row.files, row.bytes, row.matches, row.selected])).toEqual([
      ["ERR10016137", 2, 111545, true, true], ["ERR10016297", 2, 48748, true, false], ["ERR10016400", 1, 1000, false, false],
    ]);
    expect(table.truncated).toBe(false);
  });

  it("writes the chosen runs as a Samples table, one row per run", () => {
    const tsv = enaSamplesTsv(narrowEnaFiles(files, { runs: ["ERR10016297", "ERR10016137"] })).trim().split("\n");
    expect(tsv).toHaveLength(3);
    expect(tsv[0].split("\t").slice(0, 4)).toEqual(["run_accession", "sample_accession", "study_accession", "scientific_name"]);
    expect(tsv[2]).toContain("ERR10016297\tSAMEA110405680\tPRJEB53465\thuman gut metagenome");
    expect(tsv[0]).toContain("country");
  });
});
