import { describe, expect, it } from "vitest";
import { applyFilters, distinctValues, groupBy, median, relativeAbundance, sumBy } from "./frame";

const rows = [
  { sample: "s1", group: "Urine", taxon: "E. coli", reads: 80 },
  { sample: "s1", group: "Urine", taxon: "K. pneumoniae", reads: 20 },
  { sample: "s2", group: "Ascites", taxon: "E. coli", reads: 5 },
  { sample: "s2", group: "Ascites", taxon: "C. albicans", reads: 0 },
  { sample: "s3", group: null, taxon: "E. coli", reads: "10" },
];

describe("frame", () => {
  it("applies only the filters whose column the table has, and ignores empty selections", () => {
    const columns = new Set(["sample", "group", "taxon", "reads"]);
    const filters = [
      { id: "f-group", datasetId: "d", column: "group" },
      { id: "f-site", datasetId: "d", column: "site" },
    ];
    expect(applyFilters(rows, columns, filters, {})).toHaveLength(5);
    expect(applyFilters(rows, columns, filters, { "f-group": ["Urine"] })).toHaveLength(2);
    expect(applyFilters(rows, columns, filters, { "f-group": ["Urine"], "f-site": ["x"] })).toHaveLength(2);
    expect(applyFilters(rows, columns, filters, { "f-group": ["Urine", "Ascites"] })).toHaveLength(4);
  });

  it("counts distinct values, most frequent first, naming missing values", () => {
    // Ties are broken alphabetically.
    expect(distinctValues(rows, "group")).toEqual([
      { value: "Ascites", count: 2 },
      { value: "Urine", count: 2 },
      { value: "(missing)", count: 1 },
    ]);
  });

  it("sums, groups and computes relative abundance per sample", () => {
    expect(sumBy(rows, "sample", "reads").get("s1")).toBe(100);
    expect(sumBy(rows, "sample", "reads").get("s3")).toBe(10);
    expect([...groupBy(rows, "group").keys()]).toEqual(["Urine", "Ascites", ""]);
    const ra = relativeAbundance(rows, "sample", "reads");
    expect(ra.get(rows[0])).toBe(80);
    expect(ra.get(rows[1])).toBe(20);
    expect(ra.has(rows[3])).toBe(false);
    expect(ra.get(rows[4])).toBe(100);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
