import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDatasetReportUrl,
  ncbiGenomesTaxonIntegrationTestSpec,
  ncbiGenomesTaxonImporter,
  parseMd5List,
  parseNcbiGenomeSummaryLines,
} from "./ncbi-genomes-taxon";

const fetchMock = vi.fn();
const reportResponse = (reports: unknown[], total = reports.length) => new Response(JSON.stringify({ reports, total_count: total }), { status: 200, headers: { "content-type": "application/json" } });

describe("NCBI genomes by taxon importer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("validates capped taxon import input", () => {
    expect(() =>
      ncbiGenomesTaxonImporter.inputSchema.parse({ taxon: "E. coli", cap: 501 })
    ).toThrow();
    expect(
      ncbiGenomesTaxonImporter.inputSchema.parse({ taxon: "E. coli" })
    ).toMatchObject({
      taxon: "E. coli",
      cap: 100,
      assemblySource: "refseq",
      mag: "exclude",
      excludeAtypical: true,
      referenceOnly: false,
      assemblyLevels: ["complete", "chromosome"],
    });
  });

  it("declares the required Workbench integration test baseline", () => {
    expect(ncbiGenomesTaxonIntegrationTestSpec).toMatchObject({
      id: "ncbi-genomes-taxon",
      kind: "importer",
      fixtureMode: "fixture-and-live",
      requiredLayers: ["contract", "execution", "security", "ui-api"],
    });
    expect(ncbiGenomesTaxonIntegrationTestSpec.liveSmoke?.input).toMatchObject({
      cap: 1,
      referenceOnly: true,
    });
  });

  // The connector moved from the `datasets` CLI (never installed on most servers, so it was unreachable) to the
  // NCBI Datasets REST API: preflight has nothing to install.
  it("needs no command-line tool", async () => {
    await expect(ncbiGenomesTaxonImporter.preflight()).resolves.toMatchObject({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses NCBI JSON-lines genome metadata from direct and report payloads", () => {
    const output = [
      JSON.stringify({
        accession: "GCF_000005845.2",
        organism: { organism_name: "Escherichia coli str. K-12", tax_id: 83333 },
        assembly_info: {
          assembly_name: "ASM584v2",
          assembly_level: "Complete Genome",
          refseq_category: "reference genome",
        },
        assembly_stats: { total_sequence_length: 4641652 },
        source_database: "SOURCE_DATABASE_REFSEQ",
      }),
      JSON.stringify({
        report: {
          accession: "GCA_000008865.2",
          organism: { name: "Escherichia coli O157:H7", tax_id: 83334 },
          assembly_info: {
            assembly_name: "ASM886v2",
            assembly_level: "Chromosome",
          },
          sourceDatabase: "SOURCE_DATABASE_GENBANK",
        },
      }),
    ].join("\n");

    expect(parseNcbiGenomeSummaryLines(output)).toEqual([
      {
        accession: "GCF_000005845.2",
        organismName: "Escherichia coli str. K-12",
        taxId: 83333,
        assemblyName: "ASM584v2",
        assemblyLevel: "Complete Genome",
        sourceDatabase: "RefSeq",
        representativeCategory: "reference genome",
        totalSequenceLength: 4641652,
      },
      {
        accession: "GCA_000008865.2",
        organismName: "Escherichia coli O157:H7",
        taxId: 83334,
        assemblyName: "ASM886v2",
        assemblyLevel: "Chromosome",
        sourceDatabase: "GenBank",
        representativeCategory: undefined,
        totalSequenceLength: undefined,
      },
    ]);
  });

  it("maps the CLI filters onto dataset_report parameters", () => {
    const url = new URL(buildDatasetReportUrl(ncbiGenomesTaxonImporter.inputSchema.parse({ taxon: "Escherichia phage T4", cap: 2, assemblyLevels: ["complete", "chromosome"], referenceOnly: true }), 3));
    expect(url.origin + url.pathname).toBe("https://api.ncbi.nlm.nih.gov/datasets/v2/genome/taxon/Escherichia%20phage%20T4/dataset_report");
    expect(url.searchParams.get("page_size")).toBe("3");
    expect(url.searchParams.get("filters.assembly_source")).toBe("refseq");
    expect(url.searchParams.getAll("filters.assembly_level")).toEqual(["complete_genome", "chromosome"]);
    expect(url.searchParams.get("filters.is_metagenome_derived")).toBe("METAGENOME_DERIVED_EXCLUDE");
    expect(url.searchParams.get("filters.exclude_atypical")).toBe("true");
    expect(url.searchParams.get("filters.reference_only")).toBe("true");
    const all = new URL(buildDatasetReportUrl(ncbiGenomesTaxonImporter.inputSchema.parse({ taxon: "562", assemblySource: "all", excludeAtypical: false }), 1));
    expect(all.searchParams.has("filters.assembly_source")).toBe(false);
    expect(all.searchParams.has("filters.exclude_atypical")).toBe(false);
  });

  it("previews capped metadata from the REST dataset report, string lengths included", async () => {
    fetchMock.mockResolvedValue(reportResponse([
      { accession: "GCF_1.1", organism: { organism_name: "A", tax_id: 1 }, assembly_stats: { total_sequence_length: "168903" } },
      { accession: "GCF_2.1", organism: { organism_name: "B" } },
      { accession: "GCF_3.1", organism: { organism_name: "C" } },
    ], 40));
    const preview = await ncbiGenomesTaxonImporter.preview(ncbiGenomesTaxonImporter.inputSchema.parse({ taxon: "Escherichia coli", cap: 2, assemblyLevels: ["complete"] }));
    expect(String(fetchMock.mock.calls[0][0])).toContain("page_size=3");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "error" });
    expect(preview.summary).toMatchObject({ selectedCount: 2, totalFound: 40, capped: true, cap: 2, hardMax: 500 });
    expect(preview.genomes.map((genome) => genome.accession)).toEqual(["GCF_1.1", "GCF_2.1"]);
    expect(preview.genomes[0].totalSequenceLength).toBe(168903);
    expect(preview.sampleMetadata?.licence).toMatch(/NCBI/);
  });

  it("says plainly when NCBI does not know the taxon or refuses", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 400 }));
    await expect(ncbiGenomesTaxonImporter.preview(ncbiGenomesTaxonImporter.inputSchema.parse({ taxon: "Not a taxon" }))).rejects.toThrow("does not know the taxon");
    fetchMock.mockResolvedValue(new Response("", { status: 429 }));
    await expect(ncbiGenomesTaxonImporter.preview(ncbiGenomesTaxonImporter.inputSchema.parse({ taxon: "562" }))).rejects.toThrow("limiting requests");
  });

  it("reads NCBI's md5sum.txt", () => {
    const list = parseMd5List("0123456789abcdef0123456789abcdef  README.md\nfedcba9876543210fedcba9876543210  ncbi_dataset/data/GCF_000836945.1/GCF_000836945.1_ViralProj14044_genomic.fna\nnot a line\n");
    expect([...list.keys()]).toEqual(["README.md", "ncbi_dataset/data/GCF_000836945.1/GCF_000836945.1_ViralProj14044_genomic.fna"]);
  });

  it("builds stable cache keys from normalized input and selected accessions", () => {
    const input = ncbiGenomesTaxonImporter.inputSchema.parse({
      taxon: "Escherichia coli",
      cap: 2,
      assemblySource: "refseq",
      mag: "exclude",
      excludeAtypical: true,
      referenceOnly: false,
      assemblyLevels: ["complete"],
    });
    const preview = {
      providerId: "ncbi-genomes-taxon",
      summary: {
        label: "NCBI genomes for Escherichia coli",
        totalFound: 2,
        selectedCount: 2,
        capped: false,
        cap: 2,
        hardMax: 500,
      },
      genomes: [{ accession: "GCF_1" }, { accession: "GCF_2" }],
    };

    const first = ncbiGenomesTaxonImporter.getCacheKey(input, preview);
    const second = ncbiGenomesTaxonImporter.getCacheKey({ ...input }, preview);
    const changedSelection = ncbiGenomesTaxonImporter.getCacheKey(input, {
      ...preview,
      genomes: [{ accession: "GCF_2" }, { accession: "GCF_1" }],
    });

    expect(first).toBe(second);
    expect(first).not.toBe(changedSelection);
  });
});
