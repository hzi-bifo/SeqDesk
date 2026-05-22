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
    expect(getWorkbenchImporter("ncbi-genomes-taxon")?.label).toBe(
      "NCBI Genomes by Taxon"
    );
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
      label: "NCBI Genomes by Taxon",
      description: "Preview and import capped NCBI genome FASTA packages for a taxon.",
      category: "Reference genomes",
      preflight: {
        ok: false,
        message: "missing",
        details: "Install dependencies",
      },
    });
  });
});
