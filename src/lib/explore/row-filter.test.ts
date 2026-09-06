import { describe, expect, it } from "vitest";
import { applyRowFilter, compileRowFilter, rowFilterProblem } from "./row-filter";
import type { ExploreRowData } from "./types";

const rows: ExploreRowData[] = [
  { taxon: "Escherichia coli", specimen_type: "Urine", n_samples: 12, q_value: 0.001, significant: true },
  { taxon: "Klebsiella pneumoniae", specimen_type: "Urine", n_samples: 4, q_value: 0.2, significant: false },
  { taxon: "Streptococcus mitis", specimen_type: "Ascites", n_samples: 30, q_value: null, significant: false },
  { taxon: "Candida albicans", specimen_type: "", n_samples: 1, q_value: 0.04, significant: "true" },
];
const names = (kept: ExploreRowData[]) => kept.map((row) => String(row.taxon).split(" ")[0]);

describe("row filters in R notation", () => {
  it("compares text and numbers and combines with & | !", () => {
    expect(names(applyRowFilter(rows, 'specimen_type == "Urine" & n_samples >= 10'))).toEqual(["Escherichia"]);
    expect(names(applyRowFilter(rows, "n_samples < 5 | n_samples > 20"))).toEqual(["Klebsiella", "Streptococcus", "Candida"]);
    expect(names(applyRowFilter(rows, '!(specimen_type == "Urine")'))).toEqual(["Streptococcus", "Candida"]);
    expect(names(applyRowFilter(rows, "significant == TRUE"))).toEqual(["Escherichia", "Candida"]);
  });

  it("knows %in%, is.na, grepl and startsWith, and treats missing values carefully", () => {
    expect(names(applyRowFilter(rows, 'taxon %in% c("Escherichia coli", "Candida albicans")'))).toEqual(["Escherichia", "Candida"]);
    expect(names(applyRowFilter(rows, "!is.na(q_value) & q_value < 0.05"))).toEqual(["Escherichia", "Candida"]);
    expect(names(applyRowFilter(rows, "is.na(specimen_type)"))).toEqual(["Candida"]);
    expect(names(applyRowFilter(rows, 'grepl("coccus", taxon)'))).toEqual(["Streptococcus"]);
    expect(names(applyRowFilter(rows, 'startsWith(taxon, "K")'))).toEqual(["Klebsiella"]);
    expect(names(applyRowFilter(rows, "q_value > 0"))).toEqual(["Escherichia", "Klebsiella", "Candida"]);
    expect(names(applyRowFilter(rows, "`n_samples` == 4"))).toEqual(["Klebsiella"]);
  });

  it("keeps everything for a blank filter and reports problems instead of throwing at readers", () => {
    expect(applyRowFilter(rows, "   ")).toHaveLength(4);
    expect(rowFilterProblem("", ["taxon"])).toBeNull();
    expect(rowFilterProblem('specimen_type == "Urine', ["specimen_type"])).toMatch(/closing quote/);
    expect(rowFilterProblem("n_samples >", ["n_samples"])).toMatch(/ends too early/);
    expect(rowFilterProblem("nope == 1", ["taxon"])).toBe('No column called "nope"');
    expect(rowFilterProblem("sqrt(n_samples) > 1", ["n_samples"])).toMatch(/Unknown function/);
    expect(compileRowFilter("a == 1 & b %in% c(2, 3)").columns).toEqual(["a", "b"]);
  });

  it("accepts column labels as aliases and refuses patterns that could run away", () => {
    const options = { aliases: { "Specimen type": "specimen_type", Samples: "n_samples" } };
    expect(names(applyRowFilter(rows, '`Specimen type` == "Urine" & samples >= 10', options))).toEqual(["Escherichia"]);
    expect(rowFilterProblem('`specimen TYPE` == "Urine"', ["specimen_type"], options)).toBeNull();
    expect(rowFilterProblem('grepl("(a+)+b", taxon)', ["taxon"])).toMatch(/nested repeats/);
    expect(rowFilterProblem(`grepl("${"a".repeat(201)}", taxon)`, ["taxon"])).toMatch(/longer than/);
    expect(rowFilterProblem('grepl("[", taxon)', ["taxon"])).toMatch(/not a valid pattern/);
  });
});
