import { describe, expect, it } from "vitest";
import { geneSetTsv, geneSymbolTsv, parseGmt, REFERENCE_RESOURCES, referenceResourceImporter, symbolTable } from "./reference-resource";

describe("reference resources", () => {
  it("pins every resource to a version, licence, citation and HTTPS source", () => {
    expect(REFERENCE_RESOURCES.map(resource => resource.id)).toEqual(["go-bp-human", "msigdb-hallmark-human", "ensembl-symbol-human"]);
    for (const resource of REFERENCE_RESOURCES) {
      expect(resource.version).toBeTruthy();
      expect(resource.licence).toMatch(resource.category === "Gene annotation" ? /Artistic-2\.0/ : /CC BY 4\.0/);
      expect(!!resource.build !== !!resource.buildTable).toBe(true);
      expect(resource.citation.length).toBeGreaterThan(20);
      for (const file of resource.files) expect(file.url).toMatch(/^https:\/\//);
    }
    expect(REFERENCE_RESOURCES[0].files.every(file => /^[0-9a-f]{32}$/.test(file.md5 ?? ""))).toBe(true);
  });

  it("reads GMT into sorted gene sets and writes the gene-set table", () => {
    const sets = parseGmt("HALLMARK_TGF_BETA_SIGNALING\thttp://x\tSMAD7\tACVR1\tSMAD7\nHALLMARK_APOPTOSIS\thttp://y\tCASP3\n");
    expect(sets).toEqual([
      { term: "HALLMARK_APOPTOSIS", name: "Apoptosis", genes: ["CASP3"] },
      { term: "HALLMARK_TGF_BETA_SIGNALING", name: "Tgf beta signaling", genes: ["ACVR1", "SMAD7"] },
    ]);
    expect(geneSetTsv(sets)).toBe("term\tname\tn_genes\tgenes\nHALLMARK_APOPTOSIS\tApoptosis\t1\tCASP3\nHALLMARK_TGF_BETA_SIGNALING\tTgf beta signaling\t2\tACVR1 SMAD7\n");
  });

  it("maps each Ensembl id to one symbol (lowest Entrez id wins)", () => {
    const rows = symbolTable([
      { gene_id: "ENSG00000163453", symbol: "IGFBP7", name: "insulin like growth factor binding protein 7", entrez: "3490" },
      { gene_id: "ENSG00000152583", symbol: "SPARCL1", name: "SPARC like 1", entrez: "8404" },
      { gene_id: "ENSG00000152583", symbol: "SPARCL1-AS", name: "later", entrez: "900000" },
      { gene_id: "ENSG00000000001", symbol: "", name: "", entrez: "1" },
    ]);
    expect(rows.map(row => [row.gene_id, row.symbol])).toEqual([["ENSG00000152583", "SPARCL1"], ["ENSG00000163453", "IGFBP7"]]);
    expect(geneSymbolTsv(rows).split("\n")[0]).toBe("gene_id\tsymbol\tname\tentrez");
    expect(REFERENCE_RESOURCES.find(resource => resource.id === "ensembl-symbol-human")?.files[0].md5).toMatch(/^[0-9a-f]{32}$/);
  });

  it("accepts only catalogued resources", () => {
    expect(() => referenceResourceImporter.inputSchema.parse({ resource: "kegg" })).toThrow();
    expect(referenceResourceImporter.inputSchema.parse({ resource: "go-bp-human" }).resource).toBe("go-bp-human");
  });
});
