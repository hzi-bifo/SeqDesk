import { describe, expect, it } from "vitest";
import { computeHeatmap } from "./compute";
import type { SubjectTimelineRow } from "../subject-timeline/types";

function row(sample: string, subject: string, group: string, timepoint: number, taxon: string, count: number): SubjectTimelineRow {
  return { sample, subject, timepoint, group, taxon, count, taxonId: null, superkingdom: null, site: null, protocol: null };
}

const rows = [
  row("S1", "A", "Urine", 1, "E. coli", 80),
  row("S1", "A", "Urine", 1, "K. pneumoniae", 20),
  row("S2", "A", "Urine", 5, "E. coli", 50),
  row("S2", "A", "Urine", 5, "Toxoplasma", 50),
  row("S3", "B", "Ascites", 2, "K. pneumoniae", 10),
];

describe("computeHeatmap", () => {
  it("renormalizes after removing artifacts and orders taxa by prevalence", () => {
    const payload = computeHeatmap(rows, { artifacts: ["toxoplasma"], value: "ra" });
    expect(payload.samples.map((sample) => sample.sample)).toEqual(["S3", "S1", "S2"]);
    expect(payload.taxa.map((taxon) => taxon.taxon)).toEqual(["E. coli", "K. pneumoniae"]);
    // S2 has only E. coli left after the artifact is removed, so it is 100 %.
    const ecoli = payload.values[0];
    expect(ecoli).toEqual([null, 80, 100]);
    expect(payload.taxa[0].prevalence).toBeCloseTo(2 / 3, 3);
  });

  it("restricts to a group and supports log and read values", () => {
    const log = computeHeatmap(rows, { group: "Urine", value: "log10_ra", nTaxa: 1 });
    expect(log.samples.map((sample) => sample.sample)).toEqual(["S1", "S2"]);
    expect(log.taxa).toHaveLength(1);
    expect(log.values[0][0]).toBeCloseTo(Math.log10(80.01), 3);
    const reads = computeHeatmap(rows, { group: "Ascites", value: "reads" });
    expect(reads.values).toEqual([[10]]);
    expect(reads.nSamplesTotal).toBe(1);
  });

  it("orders by abundance when asked", () => {
    const payload = computeHeatmap(rows, { order: "abundance" });
    expect(payload.taxa[0].taxon).toBe("E. coli");
  });
});

describe("curated marks", () => {
  const memberships = {
    "e. coli": [
      { listId: "urine_flora", label: "Urine flora", role: "flora" as const, site: "Urine", tier: "flora", color: "#2E8B57" },
      { listId: "ascites_verified", label: "Ascites pathogen", role: "pathogen" as const, site: "Ascites", tier: "verified", color: "#C0392B" },
      { listId: "urine_verified", label: "Urine pathogen", role: "pathogen" as const, site: "Urine", tier: "verified", color: "#C0392B" },
    ],
    toxoplasma: [{ listId: "artifacts", label: "Artifacts", role: "artifact" as const, site: null, tier: null, color: null }],
  };

  it("marks taxa with the pathogen list of the current group, and never with artifact lists", () => {
    const urine = computeHeatmap(rows, { memberships, group: "Urine" });
    expect(urine.taxa.find((taxon) => taxon.taxon === "E. coli")?.curated).toMatchObject({ listId: "urine_verified", role: "pathogen" });
    expect(urine.taxa.find((taxon) => taxon.taxon === "Toxoplasma")?.curated).toBeNull();
    const ascites = computeHeatmap(rows, { memberships, group: "Ascites" });
    expect(ascites.taxa.find((taxon) => taxon.taxon === "K. pneumoniae")?.curated).toBeNull();
  });

  it("prefers pathogen lists over flora lists without a group, and leaves taxa unmarked without lists", () => {
    const all = computeHeatmap(rows, { memberships });
    expect(all.taxa.find((taxon) => taxon.taxon === "E. coli")?.curated?.role).toBe("pathogen");
    expect(computeHeatmap(rows).taxa[0]).not.toHaveProperty("curated");
  });
});
