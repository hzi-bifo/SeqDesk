import { describe, expect, it } from "vitest";
import { missingRequiredRoles, suggestRoles } from "./dataset-kinds";

describe("explore table kinds", () => {
  it("suggests roles for a metaxpath-style long table", () => {
    const roles = suggestRoles(
      ["A-ID", "taxonName", "taxonID", "superkingdom", "numReads", "abundance", "sample", "depletion"],
      "taxon-profile-long"
    );
    expect(roles).toMatchObject({
      sample: "A-ID",
      taxon: "taxonName",
      taxon_id: "taxonID",
      count: "numReads",
      value: "abundance",
      group: "sample",
    });
    expect(missingRequiredRoles(roles, "taxon-profile-long")).toEqual([]);
  });

  it("reports missing required roles", () => {
    expect(missingRequiredRoles({ sample: "id" }, "taxon-profile-long")).toEqual(["taxon", "count"]);
    expect(missingRequiredRoles({}, "unknown-kind")).toEqual([]);
  });

  it("never assigns one column to two roles", () => {
    const roles = suggestRoles(["sample"], "taxon-profile-long");
    expect(Object.values(roles)).toEqual(["sample"]);
  });
});
