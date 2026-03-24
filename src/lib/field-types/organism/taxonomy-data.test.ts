import { describe, expect, it } from "vitest";

import {
  getTaxonomyByCategory,
  getTaxonomyByTaxId,
  searchTaxonomy,
} from "./taxonomy-data";

describe("taxonomy data helpers", () => {
  it("returns no matches for empty or too-short queries", () => {
    expect(searchTaxonomy("")).toEqual([]);
    expect(searchTaxonomy("a")).toEqual([]);
  });

  it("prioritizes exact taxId matches and respects result limits", () => {
    expect(searchTaxonomy("9606")[0]).toMatchObject({
      taxId: "9606",
      scientificName: "Homo sapiens",
    });
    expect(searchTaxonomy("metagenome", 3)).toHaveLength(3);
  });

  it("matches scientific names, common names, and categories case-insensitively", () => {
    expect(searchTaxonomy("Escherichia")[0]).toMatchObject({
      taxId: "562",
      scientificName: "Escherichia coli",
    });
    expect(searchTaxonomy("zebra")[0]).toMatchObject({
      taxId: "7955",
      scientificName: "Danio rerio",
    });
    expect(searchTaxonomy("gut").some((entry) => entry.scientificName.includes("gut"))).toBe(
      true
    );
    expect(searchTaxonomy("fly")[0]).toMatchObject({
      taxId: "7227",
      scientificName: "Drosophila melanogaster",
    });
    expect(searchTaxonomy("cherich")[0]).toMatchObject({
      taxId: "562",
      scientificName: "Escherichia coli",
    });
    expect(searchTaxonomy("aker")[0]).toMatchObject({
      taxId: "4932",
      scientificName: "Saccharomyces cerevisiae",
    });
    expect(searchTaxonomy("archaea").every((entry) => entry.category === "Archaea")).toBe(
      true
    );
  });

  it("looks up entries by taxId and groups them by category", () => {
    expect(getTaxonomyByTaxId("2697049")).toMatchObject({
      scientificName: "Severe acute respiratory syndrome coronavirus 2",
      commonName: "SARS-CoV-2",
    });
    expect(getTaxonomyByTaxId("missing")).toBeUndefined();

    const grouped = getTaxonomyByCategory();

    expect(grouped["Host Organism"]?.some((entry) => entry.taxId === "9606")).toBe(true);
    expect(grouped["Virus"]?.some((entry) => entry.taxId === "2697049")).toBe(true);
    expect(Object.keys(grouped).length).toBeGreaterThan(5);
  });
});
