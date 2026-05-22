import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
  resolveWorkbenchStoreCommand: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: mocks.execFile,
  spawn: mocks.spawn,
}));

vi.mock("@/lib/workbench/store", () => ({
  resolveWorkbenchStoreCommand: mocks.resolveWorkbenchStoreCommand,
}));

import {
  ncbiGenomesTaxonIntegrationTestSpec,
  ncbiGenomesTaxonImporter,
  parseNcbiGenomeSummaryLines,
} from "./ncbi-genomes-taxon";

function mockExecFileSuccess(stdout = "") {
  mocks.execFile.mockImplementation((_command, _args, _options, callback) => {
    callback(null, { stdout, stderr: "" });
  });
}

describe("NCBI genomes by taxon importer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveWorkbenchStoreCommand.mockImplementation(async (command: string) => command);
    mockExecFileSuccess("datasets version 16\n");
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

  it("reports missing NCBI Datasets CLI during preflight", async () => {
    mocks.execFile.mockImplementation((command, _args, _options, callback) => {
      callback(command === "datasets" ? new Error("missing") : null, {
        stdout: "",
        stderr: "",
      });
    });

    await expect(ncbiGenomesTaxonImporter.preflight()).resolves.toEqual({
      ok: false,
      message: "NCBI Datasets CLI is not installed",
      details:
        "Open Workbench Store and install Reference genomes, or install the `datasets` command on the SeqDesk server PATH.",
    });
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
      "not json",
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

  it("previews capped metadata and passes bounded NCBI summary arguments", async () => {
    mockExecFileSuccess(
      [
        JSON.stringify({ accession: "GCF_1", organism: { organism_name: "A" } }),
        JSON.stringify({ accession: "GCF_2", organism: { organism_name: "B" } }),
        JSON.stringify({ accession: "GCF_3", organism: { organism_name: "C" } }),
      ].join("\n")
    );

    const preview = await ncbiGenomesTaxonImporter.preview({
      taxon: "Escherichia coli",
      cap: 2,
      assemblySource: "refseq",
      mag: "exclude",
      excludeAtypical: true,
      referenceOnly: false,
      assemblyLevels: ["complete"],
    });

    expect(mocks.execFile).toHaveBeenCalledWith(
      "datasets",
      expect.arrayContaining([
        "summary",
        "genome",
        "taxon",
        "Escherichia coli",
        "--limit",
        "3",
        "--assembly-source",
        "RefSeq",
      ]),
      expect.objectContaining({ timeout: 90_000 }),
      expect.any(Function)
    );
    expect(preview.summary).toMatchObject({
      selectedCount: 2,
      capped: true,
      cap: 2,
      hardMax: 500,
    });
    expect(preview.genomes.map((genome) => genome.accession)).toEqual(["GCF_1", "GCF_2"]);
  });

  it("uses Store-managed command paths when previewing", async () => {
    mocks.resolveWorkbenchStoreCommand.mockResolvedValue("/managed/ncbi-datasets-cli/bin/datasets");
    mockExecFileSuccess(JSON.stringify({ accession: "GCF_1" }));

    await ncbiGenomesTaxonImporter.preview({
      taxon: "Escherichia coli",
      cap: 1,
      assemblySource: "refseq",
      mag: "exclude",
      excludeAtypical: true,
      referenceOnly: false,
      assemblyLevels: ["complete"],
    });

    expect(mocks.resolveWorkbenchStoreCommand).toHaveBeenCalledWith(
      "datasets",
      "ncbi-datasets-cli"
    );
    expect(mocks.execFile).toHaveBeenCalledWith(
      "/managed/ncbi-datasets-cli/bin/datasets",
      expect.any(Array),
      expect.objectContaining({ timeout: 90_000 }),
      expect.any(Function)
    );
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
