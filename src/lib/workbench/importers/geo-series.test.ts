import { describe, expect, it } from "vitest";

import {
  geoSeriesFolder,
  geoSeriesImporter,
  isGeoFileUrl,
  mapGeoSeries,
  parseGeoSeriesRef,
  parseIndexFileNames,
  parseSeriesSoft,
  samplesTsv,
  seriesMatrixSamples,
} from "./geo-series";

// Trimmed from GSE52778 (Himes et al. 2014) as NCBI serves it.
const SOFT = `^SERIES = GSE52778
!Series_title = Human Airway Smooth Muscle Transcriptome Changes in Response to Asthma Medications
!Series_geo_accession = GSE52778
!Series_status = Public on Jan 01 2014
!Series_pubmed_id = 24926665
!Series_type = Expression profiling by high throughput sequencing
!Series_sample_id = GSM1275862
!Series_sample_id = GSM1275863
!Series_supplementary_file = ftp://ftp.ncbi.nlm.nih.gov/geo/series/GSE52nnn/GSE52778/suppl/GSE52778_All_Sample_FPKM_Matrix.txt.gz
!Series_platform_id = GPL11154
!Series_relation = BioProject: https://www.ncbi.nlm.nih.gov/bioproject/PRJNA229998
!Series_relation = SRA: https://www.ncbi.nlm.nih.gov/sra?term=SRP033351
`;
const MATRIX = [
  '!Series_title\t"Human Airway Smooth Muscle"',
  '!Sample_title\t"N61311_untreated"\t"N61311_Dex"',
  '!Sample_geo_accession\t"GSM1275862"\t"GSM1275863"',
  '!Sample_source_name_ch1\t"airway smooth muscle cells"\t"airway smooth muscle cells"',
  '!Sample_organism_ch1\t"Homo sapiens"\t"Homo sapiens"',
  '!Sample_characteristics_ch1\t"treatment: Untreated"\t"treatment: Dexamethasone"',
  '!Sample_characteristics_ch1\t"cell line: N61311"\t"cell line: N61311"',
  '!Sample_platform_id\t"GPL11154"\t"GPL11154"',
  '!Sample_instrument_model\t"Illumina HiSeq 2000"\t"Illumina HiSeq 2000"',
  '!Sample_relation\t"BioSample: https://www.ncbi.nlm.nih.gov/biosample/SAMN02422669"\t"BioSample: https://www.ncbi.nlm.nih.gov/biosample/SAMN02422675"',
  '!Sample_relation\t"SRA: https://www.ncbi.nlm.nih.gov/sra?term=SRX384345"\t"SRA: https://www.ncbi.nlm.nih.gov/sra?term=SRX384346"',
  '!series_matrix_table_begin',
  '"ID_REF"\t"GSM1275862"\t"GSM1275863"',
  '!series_matrix_table_end',
].join("\n");

describe("GEO series references", () => {
  it.each([
    ["GSE52778", "GSE52778"], ["gse52778", "GSE52778"], ["geo:GSE52778", "GSE52778"],
    ["https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE52778", "GSE52778"],
    ["https://ftp.ncbi.nlm.nih.gov/geo/series/GSE52nnn/GSE52778/", "GSE52778"],
  ])("reads %s", (value, expected) => expect(parseGeoSeriesRef(value)).toBe(expected));
  it("refuses samples, platforms and other sites", () => {
    for (const value of ["GSM1275862", "GPL11154", "https://example.org/geo/query/acc.cgi?acc=GSE1", "GSE"]) expect(parseGeoSeriesRef(value)).toBeNull();
    expect(() => geoSeriesImporter.inputSchema.parse({ series: "GSM1" })).toThrow("GEO series accession");
  });
  it("finds the series folder and only accepts its own files", () => {
    expect(geoSeriesFolder("GSE52778")).toBe("https://ftp.ncbi.nlm.nih.gov/geo/series/GSE52nnn/GSE52778/");
    expect(geoSeriesFolder("GSE1")).toBe("https://ftp.ncbi.nlm.nih.gov/geo/series/GSEnnn/GSE1/");
    expect(isGeoFileUrl("https://ftp.ncbi.nlm.nih.gov/geo/series/GSE52nnn/GSE52778/matrix/GSE52778_series_matrix.txt.gz")).toBe(true);
    for (const url of ["http://ftp.ncbi.nlm.nih.gov/geo/series/GSE52nnn/GSE52778/suppl/x.gz", "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE52nnn/GSE52778/suppl/../../x",
      "https://evil.example/geo/series/GSE52nnn/GSE52778/suppl/x.gz", "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE52nnn/GSE52778/suppl/x.gz?y=1"]) expect(isGeoFileUrl(url)).toBe(false);
  });
});

describe("GEO series preview", () => {
  const listing = `<html><a href="/geo/series/GSE52nnn/">Parent</a><a href="GSE52778_All_Sample_FPKM_Matrix.txt.gz">x</a>
    <a href="GSE52778_Dex_vs_Untreated_gene_exp.diff.gz">y</a><a href="https://www.hhs.gov/vulnerability">z</a><a href="GSE52778_RAW.tar">r</a><a href="filelist.txt">f</a></html>`;
  it("reads the SOFT header and the index page", () => {
    const soft = parseSeriesSoft(SOFT);
    expect(soft.sample_id).toEqual(["GSM1275862", "GSM1275863"]);
    expect(soft.relation).toHaveLength(2);
    expect(parseIndexFileNames(listing)).toEqual(["filelist.txt", "GSE52778_All_Sample_FPKM_Matrix.txt.gz", "GSE52778_Dex_vs_Untreated_gene_exp.diff.gz", "GSE52778_RAW.tar"]);
  });

  it("lists matrix and supplementary files with sizes, ticks the matrix and small files, never the RAW archive", () => {
    const base = "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE52nnn/GSE52778/";
    const preview = mapGeoSeries(geoSeriesImporter.inputSchema.parse({ series: "GSE52778" }), parseSeriesSoft(SOFT), [
      { filename: "GSE52778_series_matrix.txt.gz", url: `${base}matrix/GSE52778_series_matrix.txt.gz`, bytes: 3150, modified: "Mon, 15 May 2019", role: "series-matrix" },
      { filename: "GSE52778_All_Sample_FPKM_Matrix.txt.gz", url: `${base}suppl/GSE52778_All_Sample_FPKM_Matrix.txt.gz`, bytes: 2_600_000, role: "supplementary" },
      { filename: "GSE52778_RAW.tar", url: `${base}suppl/GSE52778_RAW.tar`, bytes: 20_000_000, role: "supplementary" },
    ]);
    expect(preview.assets?.map(asset => asset.filename)).toEqual(["GSE52778_series_matrix.txt.gz", "GSE52778_All_Sample_FPKM_Matrix.txt.gz"]);
    expect(preview.assets?.[0]).toMatchObject({ bytes: 3150, etag: "modified:Mon, 15 May 2019" });
    expect(preview.choices?.find(choice => choice.filename === "GSE52778_RAW.tar")?.selected).toBe(false);
    expect(preview.records?.[0]).toMatchObject({ id: "GSE52778", detail: expect.stringContaining("2 samples") });
    expect(preview.sampleMetadata).toMatchObject({ rawReads: "PRJNA229998, SRP033351", pubmed: "24926665" });
    expect(preview.warnings?.join(" ")).toMatch(/SRA \(PRJNA229998, SRP033351\)/);
    expect(preview.warnings?.join(" ")).toMatch(/does not publish checksums/);
  });

  it("honours ticked files and refuses unknown ones", () => {
    const soft = parseSeriesSoft(SOFT);
    const files = [{ filename: "a.txt.gz", url: "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE52nnn/GSE52778/suppl/a.txt.gz", bytes: 10, role: "supplementary" }];
    expect(() => mapGeoSeries(geoSeriesImporter.inputSchema.parse({ series: "GSE52778", files: ["b.txt"] }), soft, files)).toThrow("no file named b.txt");
    expect(mapGeoSeries(geoSeriesImporter.inputSchema.parse({ series: "GSE52778", files: ["a.txt.gz"] }), soft, files).warnings?.join(" ")).toMatch(/no series matrix/);
  });

  it("refuses a SOFT answer for another series", () => {
    expect(() => mapGeoSeries(geoSeriesImporter.inputSchema.parse({ series: "GSE1" }), parseSeriesSoft(SOFT), [])).toThrow("different series");
  });
});

describe("series matrix → Samples table", () => {
  it("makes one row per GSM with characteristics as columns and the BioSample/SRA links", () => {
    const table = seriesMatrixSamples(MATRIX);
    expect(table.columns).toEqual(["sample", "title", "source", "organism", "platform", "instrument", "treatment", "cell_line", "biosample", "sra"]);
    expect(table.rows[1]).toEqual(["GSM1275863", "N61311_Dex", "airway smooth muscle cells", "Homo sapiens", "GPL11154", "Illumina HiSeq 2000", "Dexamethasone", "N61311", "SAMN02422675", "SRX384346"]);
    expect(samplesTsv(table).split("\n")[0]).toBe(table.columns.join("\t"));
  });
  it("gives an empty table for a matrix without samples", () => {
    expect(seriesMatrixSamples("!Series_title\t\"x\"")).toEqual({ columns: [], rows: [] });
  });
});
