import { describe, expect, it } from "vitest";
import {
  getWorkbenchImporter,
  listWorkbenchImporters,
  serializeWorkbenchImporter,
} from "./registry";

describe("workbench importer registry", () => {
  it("exposes the framework-backed NCBI importer", () => {
    const importers = listWorkbenchImporters();

    expect(importers.map((importer) => importer.id)).toContain("ncbi-genomes-taxon");
    expect(getWorkbenchImporter("ncbi-genomes-taxon")?.label).toBe("NCBI genomes by taxon");
  });

  it("exposes the public-record connectors with their fixed ids", () => {
    expect(listWorkbenchImporters().map((importer) => [importer.id, importer.label, importer.category])).toEqual(expect.arrayContaining([
      ["zenodo-record", "Zenodo record", "dataset"],
      ["pdb-entry", "PDB structures", "structures"],
      ["alphafold-model", "AlphaFold models", "structures"],
      ["uniprot-entry", "UniProt entries", "proteins"],
      ["geo-series", "GEO series", "dataset"],
      ["link-download", "Any DOI or link", "dataset"],
    ]));
  });

  it("returns null for unknown providers", () => {
    expect(getWorkbenchImporter("not-real")).toBeNull();
  });

  it("serializes provider metadata without leaking implementation functions", () => {
    const provider = getWorkbenchImporter("ncbi-genomes-taxon");

    expect(provider).not.toBeNull();
    expect(
      serializeWorkbenchImporter(provider!, {
        ok: false,
        message: "missing",
        details: "Install dependencies",
      })
    ).toEqual({
      id: "ncbi-genomes-taxon",
      label: "NCBI genomes by taxon",
      description: "Preview and import capped NCBI genome FASTA packages for a taxon through the NCBI Datasets API, verified against NCBI's MD5 list.",
      category: "Reference genomes",
      preflight: {
        ok: false,
        message: "missing",
        details: "Install dependencies",
      },
    });
  });
});
